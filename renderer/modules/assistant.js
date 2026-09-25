/**
 * Module Assistant vocal — orbe circulaire + Gemini Multimodal Live
 * (WebSocket bidirectionnel audio temps réel), reconstruit le 2026-09-25 sur
 * demande explicite après une suppression complète de la version Groq.
 *
 * Adapté du code fourni à l'API réelle de l'app : réglages via
 * `window.matin.store` (`gemini_api_key`/`assistant_lang`, voir config.js),
 * déclencheur du raccourci global via `window.matin.assistant.onTrigger`,
 * état de l'orbe = classes `orb-*` sur la carte `#module-assistant` (voir
 * style.css). Commandes dashboard limitées à ce qui existe vraiment dans
 * l'app (thème, Paramètres, actualiser) — pas de contrôle Spotify (le module
 * Spotify est en lecture seule, aucun bouton lecture/suivant à déclencher).
 *
 * ATTENTION : l'API Live demande normalement un compte Gemini facturé ; la
 * clé de test avait renvoyé "prepayment credits are depleted" (402). Les
 * erreurs de connexion/fermeture sont loggées telles quelles en console.
 */
window.MatinModules = window.MatinModules || {};

const ASSISTANT_SAMPLE_RATE_IN = 16000;
const ASSISTANT_SAMPLE_RATE_OUT = 24000;
const ASSISTANT_CHUNK_SIZE = 4096;
const ASSISTANT_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const ASSISTANT_VOICE_MAP = { 'fr-FR': 'Aoede', 'en-US': 'Charon', 'es-ES': 'Fenrir' };

const ASSISTANT_SYSTEM_PROMPT = `Tu es Matin, un assistant vocal généraliste intégré à un dashboard Windows.
Réponds de façon concise et naturelle — ta réponse sera lue à voix haute, ne cite jamais de lien.
Tu peux exécuter des commandes sur le dashboard via l'outil execute_dashboard_command.
Commandes disponibles : TOGGLE_THEME (bascule clair/sombre), OPEN_SETTINGS (ouvre les Paramètres), REFRESH_ALL (actualise tous les modules).`;

let assistantCard = null;
let assistantWs = null;
let assistantCaptureCtx = null;
let assistantPlayCtx = null;
let assistantMediaStream = null;
let assistantSourceNode = null;
let assistantProcessorNode = null;
let assistantPlaybackSources = [];
let assistantSessionReady = false;
let assistantNextPlayTime = 0;
let assistantPlaybackTimer = null;

function assistantSetState(state) {
  if (!assistantCard) return;
  assistantCard.classList.remove('orb-idle', 'orb-listening', 'orb-thinking', 'orb-speaking');
  assistantCard.classList.add('orb-' + state);
}

function assistantFloatToInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) out[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  return out;
}

function assistantBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Commandes réellement disponibles dans l'app — voir ASSISTANT_SYSTEM_PROMPT.
function assistantExecuteCommand(command) {
  switch (command) {
    case 'TOGGLE_THEME': {
      const next = document.documentElement.dataset.colorScheme === 'light' ? 'dark' : 'light';
      window.matin.theme.set(next).catch(() => {});
      break;
    }
    case 'OPEN_SETTINGS':
      document.getElementById('btnConfig')?.click();
      break;
    case 'REFRESH_ALL':
      document.getElementById('btnRefresh')?.click();
      break;
    default:
      console.warn('[Assistant] Commande inconnue :', command);
  }
}

function assistantEnqueueAudio(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

  if (!assistantPlayCtx || assistantPlayCtx.state === 'closed') {
    assistantPlayCtx = new AudioContext({ sampleRate: ASSISTANT_SAMPLE_RATE_OUT });
    assistantNextPlayTime = assistantPlayCtx.currentTime;
  }
  const buffer = assistantPlayCtx.createBuffer(1, float32.length, ASSISTANT_SAMPLE_RATE_OUT);
  buffer.copyToChannel(float32, 0);
  const source = assistantPlayCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(assistantPlayCtx.destination);
  const startAt = Math.max(assistantNextPlayTime, assistantPlayCtx.currentTime + 0.01);
  source.start(startAt);
  assistantNextPlayTime = startAt + buffer.duration;
  assistantPlaybackSources.push(source);
}

function assistantWaitPlaybackEnd(callback) {
  clearTimeout(assistantPlaybackTimer);
  if (!assistantPlayCtx || assistantNextPlayTime <= assistantPlayCtx.currentTime) { callback(); return; }
  const remaining = (assistantNextPlayTime - assistantPlayCtx.currentTime) * 1000 + 200;
  assistantPlaybackTimer = setTimeout(() => { assistantPlaybackSources = []; callback(); }, remaining);
}

function assistantClearPlayback() {
  clearTimeout(assistantPlaybackTimer);
  assistantPlaybackSources.forEach((s) => { try { s.stop(); } catch {} });
  assistantPlaybackSources = [];
  assistantNextPlayTime = 0;
}

function assistantDisconnect() {
  assistantClearPlayback();
  if (assistantProcessorNode) { assistantProcessorNode.disconnect(); assistantProcessorNode = null; }
  if (assistantSourceNode) { assistantSourceNode.disconnect(); assistantSourceNode = null; }
  if (assistantMediaStream) { assistantMediaStream.getTracks().forEach((t) => t.stop()); assistantMediaStream = null; }
  if (assistantCaptureCtx) { assistantCaptureCtx.close().catch(() => {}); assistantCaptureCtx = null; }
  if (assistantPlayCtx) { assistantPlayCtx.close().catch(() => {}); assistantPlayCtx = null; }
  if (assistantWs) { const ws = assistantWs; assistantWs = null; ws.onclose = null; ws.close(); }
  assistantSessionReady = false;
}

async function assistantStartMic() {
  try {
    assistantCaptureCtx = new AudioContext({ sampleRate: ASSISTANT_SAMPLE_RATE_IN });
    assistantMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    assistantSourceNode = assistantCaptureCtx.createMediaStreamSource(assistantMediaStream);
    assistantProcessorNode = assistantCaptureCtx.createScriptProcessor(ASSISTANT_CHUNK_SIZE, 1, 1);
    assistantProcessorNode.onaudioprocess = (e) => {
      if (!assistantSessionReady || !assistantWs || assistantWs.readyState !== WebSocket.OPEN) return;
      const int16 = assistantFloatToInt16(e.inputBuffer.getChannelData(0));
      assistantWs.send(JSON.stringify({
        realtime_input: { audio: { mime_type: `audio/pcm;rate=${ASSISTANT_SAMPLE_RATE_IN}`, data: assistantBufferToBase64(int16.buffer) } },
      }));
    };
    assistantSourceNode.connect(assistantProcessorNode);
    assistantProcessorNode.connect(assistantCaptureCtx.destination);
    return true;
  } catch (err) {
    console.error('[Assistant] Micro inaccessible :', err.message || err);
    return false;
  }
}

function assistantHandleMessage(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }

  if (data.setupComplete) {
    assistantSessionReady = true;
    assistantStartMic().then((ok) => {
      if (ok) assistantSetState('listening');
      else { assistantDisconnect(); assistantSetState('idle'); }
    });
    return;
  }

  const content = data.serverContent;
  if (content) {
    if (content.modelTurn?.parts) {
      assistantSetState('speaking');
      content.modelTurn.parts.forEach((part) => { if (part.inlineData?.data) assistantEnqueueAudio(part.inlineData.data); });
    }
    if (content.turnComplete) assistantWaitPlaybackEnd(() => { if (assistantWs) assistantSetState('listening'); });
    if (content.interrupted) { assistantClearPlayback(); assistantSetState('listening'); }
  }

  if (data.toolCall?.functionCalls) {
    data.toolCall.functionCalls.forEach((call) => {
      if (call.name !== 'execute_dashboard_command') return;
      assistantExecuteCommand(call.args?.command);
      assistantWs?.send(JSON.stringify({
        tool_response: { function_responses: [{ id: call.id, name: call.name, response: { result: 'ok' } }] },
      }));
    });
  }
}

// Modèle Live choisi via ListModels (2026-09-25) : `gemini-2.0-flash-live-001`
// codé en dur avait été retiré ("not found ... for bidiGenerateContent").
// Garde uniquement les modèles déclarant `bidiGenerateContent`, préfère
// "live"/"native-audio" puis "flash". Catalogue loggé en console.
let assistantLiveModel = null;
async function assistantPickLiveModel(apiKey) {
  if (assistantLiveModel) return assistantLiveModel;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `ListModels ${res.status}`);
  const live = (data?.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'));
  console.log('[Assistant] Modèles Live disponibles :', live.map((m) => m.name));
  const score = (n) => (/native-audio|live/i.test(n) ? 2 : 0) + (/flash/i.test(n) ? 1 : 0) - (/preview|exp/i.test(n) ? 0.5 : 0);
  live.sort((a, b) => score(b.name) - score(a.name));
  if (!live.length) throw new Error('Aucun modèle compatible Live pour cette clé.');
  assistantLiveModel = live[0].name;
  return assistantLiveModel;
}

async function assistantStartSession() {
  const apiKey = (await window.matin.store.get('gemini_api_key')) || '';
  const lang = (await window.matin.store.get('assistant_lang')) || 'fr-FR';
  if (!apiKey) {
    console.warn('[Assistant] Aucune clé API Gemini configurée (Paramètres → Utile → Assistant vocal).');
    return;
  }

  assistantSetState('thinking'); // transitoire pendant la connexion
  let model;
  try { model = await assistantPickLiveModel(apiKey); }
  catch (err) { console.error('[Assistant] Sélection du modèle Live impossible :', err.message); assistantSetState('idle'); return; }
  console.log('[Assistant] Modèle Live utilisé :', model);
  const ws = new WebSocket(`${ASSISTANT_WS_BASE}?key=${encodeURIComponent(apiKey)}`);
  assistantWs = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      setup: {
        model,
        generation_config: {
          response_modalities: ['AUDIO'],
          speech_config: { voice_config: { prebuilt_voice_config: { voice_name: ASSISTANT_VOICE_MAP[lang] || 'Aoede' } } },
        },
        system_instruction: { parts: [{ text: ASSISTANT_SYSTEM_PROMPT }] },
        tools: [
          { google_search: {} },
          {
            function_declarations: [{
              name: 'execute_dashboard_command',
              description: 'Exécute une commande sur le dashboard Matin',
              parameters: {
                type: 'OBJECT',
                properties: { command: { type: 'STRING', enum: ['TOGGLE_THEME', 'OPEN_SETTINGS', 'REFRESH_ALL'] } },
                required: ['command'],
              },
            }],
          },
        ],
      },
    }));
  };
  ws.onmessage = (event) => {
    // Les messages Live arrivent souvent en Blob (binaire), pas en texte.
    if (event.data instanceof Blob) event.data.text().then((text) => assistantHandleMessage({ data: text }));
    else assistantHandleMessage(event);
  };
  ws.onerror = (e) => { console.error('[Assistant] Erreur WebSocket Gemini Live :', e); };
  ws.onclose = (e) => {
    console.warn(`[Assistant] Session Gemini Live fermée (code ${e.code}) : ${e.reason || '(aucune raison fournie)'}`);
    if (assistantWs === ws) { assistantDisconnect(); assistantSetState('idle'); }
  };
}

function assistantToggle() {
  if (assistantWs) { assistantDisconnect(); assistantSetState('idle'); }
  else assistantStartSession();
}

window.MatinModules.assistant = {
  async render(container, _config, _google, setBadge) {
    setBadge('');
    container.innerHTML = `
      <div class="orb-ring"></div>
      <div class="orb-bg"></div>
      <div class="orb-waves">
        <svg class="wave-idle w1" viewBox="0 0 200 200" preserveAspectRatio="none"><path d="M0,110 Q50,75 100,105 T200,95 L200,200 L0,200 Z" fill="rgba(56,184,248,0.18)"/></svg>
        <svg class="wave-idle w2" viewBox="0 0 200 200" preserveAspectRatio="none"><path d="M0,125 Q60,95 120,120 T200,108 L200,200 L0,200 Z" fill="rgba(124,77,255,0.14)"/></svg>
        <svg class="wave-listen wl1" viewBox="0 0 200 200" preserveAspectRatio="none" style="transform-origin:50% 60%"><path d="M0,100 Q50,65 100,95 T200,85 L200,200 L0,200 Z" fill="rgba(56,184,248,0.22)"/></svg>
        <svg class="wave-listen wl2" viewBox="0 0 200 200" preserveAspectRatio="none" style="transform-origin:50% 70%"><path d="M0,120 Q55,85 110,115 T200,100 L200,200 L0,200 Z" fill="rgba(100,160,255,0.16)"/></svg>
        <svg class="wave-listen wl3" viewBox="0 0 200 200" preserveAspectRatio="none" style="transform-origin:50% 55%"><path d="M0,135 Q65,110 130,132 T200,118 L200,200 L0,200 Z" fill="rgba(56,184,248,0.10)"/></svg>
        <svg class="wave-speak ws1" viewBox="0 0 200 200" preserveAspectRatio="none" style="transform-origin:50% 55%"><path d="M0,90 Q50,55 100,85 T200,72 L200,200 L0,200 Z" fill="rgba(56,184,248,0.28)"/></svg>
        <svg class="wave-speak ws2" viewBox="0 0 200 200" preserveAspectRatio="none" style="transform-origin:50% 65%"><path d="M0,112 Q60,78 120,108 T200,94 L200,200 L0,200 Z" fill="rgba(100,180,255,0.18)"/></svg>
        <svg class="wave-speak ws3" viewBox="0 0 200 200" preserveAspectRatio="none" style="transform-origin:50% 72%"><path d="M0,130 Q70,105 140,128 T200,116 L200,200 L0,200 Z" fill="rgba(124,77,255,0.16)"/></svg>
      </div>
      <div class="orb-think-dots"><span></span><span></span><span></span></div>
      <div class="orb-mic-icon">
        <svg width="54" height="54" viewBox="0 0 48 48" fill="none">
          <rect x="17" y="6" width="14" height="22" rx="7" fill="white"/>
          <path d="M11 24c0 7.18 5.82 13 13 13s13-5.82 13-13" stroke="white" stroke-width="2.8" stroke-linecap="round" fill="none"/>
          <line x1="24" y1="37" x2="24" y2="44" stroke="white" stroke-width="2.8" stroke-linecap="round"/>
          <line x1="16" y1="44" x2="32" y2="44" stroke="white" stroke-width="2.8" stroke-linecap="round"/>
        </svg>
      </div>
    `;

    const card = container.closest('.module-card');
    if (!card) return;
    assistantCard = card;
    assistantSetState(assistantWs ? 'listening' : 'idle');

    // Écouteurs posés une seule fois (render() peut être ré-exécuté).
    if (card.dataset.assistantBound === '1') return;
    card.dataset.assistantBound = '1';

    // `tap` interact.js (pas `click`) : toute la carte est zone de glisser
    // (voir dashboard.js makeInteractive, allowFrom), interact.js consomme le
    // pointerdown avant le `click` natif.
    interact(card).on('tap', assistantToggle);
    window.matin.assistant.onTrigger(assistantToggle);
    window.addEventListener('beforeunload', assistantDisconnect);
  },
};
