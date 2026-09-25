/**
 * Module Assistant vocal — orbe circulaire + Gemini Multimodal Live
 * (WebSocket bidirectionnel audio temps réel), reconstruit le 2026-09-25 sur
 * demande explicite après une suppression complète de la version Groq.
 *
 * Adapté du code fourni à l'API réelle de l'app : réglages via
 * `window.matin.store` (`gemini_api_key`/`assistant_lang`, voir config.js),
 * déclencheur du raccourci global via `window.matin.assistant.onTrigger`,
 * état de l'orbe = classes `orb-*` sur la carte `#module-assistant`, rendu
 * visuel par l'avatar holographique (modules/avatar.js). Outils disponibles :
 * voir ASSISTANT_SYSTEM_PROMPT.
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
Tu as accès au dashboard de l'utilisateur via des outils :
- web_search : recherche sur internet. Utilise-le pour toute question d'actualité ou d'information récente, puis reformule les résultats avec tes mots.
- read_dashboard : lit le contenu affiché des modules (météo, matchs, agenda…) — utilise-le pour répondre à toute question sur ce que le dashboard affiche.
- execute_dashboard_command : TOGGLE_THEME, OPEN_SETTINGS, CLOSE_SETTINGS, REFRESH_ALL.
- set_module_enabled : active ou désactive un module.
- switch_profile : bascule sur le profil 1 ou 2.
- control_lights : allume/éteint/règle la luminosité des lumières (Hue, Kasa, Trådfri), toutes ou par nom.
- control_shutters : ouvre/ferme ou règle le pourcentage des volets Somfy, tous ou par nom.
- control_climate : climatisation (marche/arrêt, mode, température).
- control_music : Spotify (play, pause, suivant, précédent).
- open_shortcut : ouvre Gmail, Drive, YouTube, Agenda, Photos ou Maps.
Confirme brièvement à voix haute ce que tu as fait, ou dis clairement si une action a échoué.`;

// ── Lecture du dashboard ─────────────────────────────────────────────────
// Texte affiché de chaque carte (titre + contenu), tronqué : pas d'accès aux
// données brutes des modules, seulement ce que l'utilisateur voit à l'écran.
function assistantDashboardSummary(onlyModule, maxPerModule = 500) {
  const wanted = (onlyModule || '').trim().toLowerCase();
  const parts = [];
  document.querySelectorAll('.module-card').forEach((card) => {
    if (card.id === 'module-assistant') return;
    const key = card.id.replace('module-', '');
    const title = (card.querySelector('.module-title')?.textContent || key).replace(/\s+/g, ' ').trim();
    if (wanted && !key.toLowerCase().includes(wanted) && !title.toLowerCase().includes(wanted)) return;
    const text = (card.querySelector('.module-content')?.innerText || '').replace(/\s+/g, ' ').trim();
    if (text) parts.push(`[${title}] ${text.slice(0, wanted ? 2000 : maxPerModule)}`);
  });
  return parts.join('\n');
}

// Liste "clé (libellé)" des modules pour que le modèle puisse les désigner.
function assistantModuleList() {
  const reg = typeof MODULE_REGISTRY !== 'undefined' ? MODULE_REGISTRY : {};
  return Object.entries(reg).map(([k, m]) => `${k} (${m.label})`).join(', ');
}

// Outils d'action : chacun renvoie un objet résultat (jamais d'exception vers
// le WebSocket — une action ratée est rapportée au modèle, qui la dit à l'oral).
async function assistantSetModuleEnabled({ module, enabled }) {
  const all = await window.matin.modules.getAll();
  const wanted = String(module || '').toLowerCase();
  const key = Object.keys(all).find((k) => k.toLowerCase() === wanted)
    || Object.keys(all).find((k) => (typeof MODULE_REGISTRY !== 'undefined' && MODULE_REGISTRY[k]?.label || '').toLowerCase() === wanted);
  if (!key) return { error: `Module inconnu : ${module}` };
  if (key === 'assistant' && !enabled) return { error: "Je ne peux pas me désactiver moi-même." };
  all[key].enabled = !!enabled;
  await window.matin.modules.update(all);
  return { result: `${key} ${enabled ? 'activé' : 'désactivé'}` };
}

async function assistantSwitchProfile({ profile }) {
  const n = Number(profile);
  if (n !== 1 && n !== 2) return { error: 'Profil invalide (1 ou 2).' };
  await window.matin.profiles.switch(`profile${n}`);
  return { result: `Profil ${n} activé` };
}

// Recherche floue d'un appareil/pièce par nom (insensible à la casse/aux accents).
const assistantNorm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function assistantFind(list, name, getName) {
  const n = assistantNorm(name);
  return list.filter((x) => { const g = assistantNorm(getName(x)); return g === n || g.includes(n) || n.includes(g); });
}

// Lumières : Hue (pièces), Kasa (appareils), Trådfri (tout/rien seulement).
// Sans `target` → toutes ; avec `target` → pièces/appareils dont le nom correspond.
// `brightness` (0-100) : Hue et ampoules Kasa uniquement.
async function assistantControlLights({ on, target, brightness }) {
  const all = await window.matin.modules.getAll();
  const done = [];
  const failed = [];
  const known = [];
  const hasBri = brightness !== undefined && brightness !== null;
  const bri = hasBri ? Math.max(0, Math.min(100, Number(brightness))) : null;
  const run = async (name, fn) => { try { await fn(); done.push(name); } catch (e) { failed.push(`${name}: ${e.message}`); } };
  const wantOn = on !== undefined ? !!on : (hasBri ? bri > 0 : true);

  const hue = all.hue;
  if (hue?.enabled && typeof hueDetectMode === 'function') {
    const mode = hueDetectMode(hue.config);
    if (mode) {
      try {
        const c = hue.config;
        const groups = mode === 'cloud' ? await window.matin.hue.cloudGetGroups() : await window.matin.hue.getGroups({ bridgeIp: c.bridgeIp.trim(), username: c.username.trim() });
        groups.forEach((g) => known.push(g.name));
        const targets = target ? assistantFind(groups, target, (g) => g.name) : groups;
        for (const g of targets) {
          const state = { on: wantOn };
          if (hasBri && bri > 0) state.bri = Math.max(1, Math.round((bri / 100) * 254));
          await run(`Hue ${g.name}`, () => mode === 'cloud'
            ? window.matin.hue.cloudSetGroupState({ groupId: g.id, state })
            : window.matin.hue.setGroupState({ bridgeIp: c.bridgeIp.trim(), username: c.username.trim(), groupId: g.id, state }));
        }
      } catch (e) { failed.push(`Hue: ${e.message}`); }
    }
  }
  if (all.kasa?.enabled) {
    try {
      const devices = await window.matin.kasa.getDevices();
      devices.forEach((d) => known.push(d.alias));
      const bulbState = () => ({ on_off: wantOn ? 1 : 0, ...(bri > 0 ? { brightness: bri } : {}) });
      if (!target) {
        if (!hasBri) await run('Kasa (tout)', () => window.matin.kasa.turnAll(wantOn));
        else for (const d of devices.filter((x) => x.deviceType === 'bulb')) {
          await run(`Kasa ${d.alias}`, () => window.matin.kasa.setBulbState({ host: d.host, state: bulbState() }));
        }
      } else {
        for (const d of assistantFind(devices, target, (x) => x.alias)) {
          await run(`Kasa ${d.alias}`, () => d.deviceType === 'bulb'
            ? window.matin.kasa.setBulbState({ host: d.host, state: bulbState() })
            : window.matin.kasa.setPower({ host: d.host, childId: d.childId || null, on: wantOn }));
        }
      }
    } catch (e) { failed.push(`Kasa: ${e.message}`); }
  }
  const tr = all.tradfri;
  if (!target && !hasBri && tr?.enabled && tr.config?.gatewayIp) {
    await run('Trådfri', () => window.matin.tradfri.turnAll({ gatewayIp: tr.config.gatewayIp, identity: tr.config.identity, psk: tr.config.psk, on: wantOn }));
  }
  if (!done.length) {
    if (target && known.length) return { error: `Aucune pièce/appareil « ${target} ». Disponibles : ${known.join(', ')}`, ...(failed.length ? { errors: failed } : {}) };
    return { error: 'Aucun module de lumières activé et configuré.', ...(failed.length ? { errors: failed } : {}) };
  }
  return { result: `${wantOn ? 'Allumé' : 'Éteint'}${hasBri ? ` (luminosité ${bri}%)` : ''} : ${done.join(', ')}`, ...(failed.length ? { errors: failed } : {}) };
}

// Volets Somfy : `action` open/close, ou `position` = % d'ouverture (0 fermé,
// 100 ouvert ; la box travaille en fermeture : 100 - position). `target` = nom.
async function assistantControlShutters({ action, position, target }) {
  const all = await window.matin.modules.getAll();
  const c = all.somfyTahoma?.config;
  if (!all.somfyTahoma?.enabled || !c?.ip || !c?.token) return { error: 'Module Somfy non activé ou non configuré.' };
  const hasPos = position !== undefined && position !== null;
  if (!hasPos && action !== 'open' && action !== 'close') return { error: 'Précise action (open/close) ou position (0-100).' };
  const devices = await window.matin.somfyTahoma.discover({ ip: c.ip, token: c.token });
  const chosen = target ? assistantFind(devices, target, (d) => d.label) : devices;
  if (!chosen.length) return { error: `Aucun volet « ${target} ». Disponibles : ${devices.map((d) => d.label).join(', ')}` };
  const failed = [];
  for (const d of chosen) {
    const payload = hasPos
      ? { command: 'setClosure', value: 100 - Math.max(0, Math.min(100, Number(position))) }
      : { command: action };
    try { await window.matin.somfyTahoma.sendCommand({ ip: c.ip, token: c.token, deviceURL: d.deviceURL, ...payload }); }
    catch (e) { failed.push(`${d.label}: ${e.message}`); }
  }
  return { result: `${chosen.length - failed.length}/${chosen.length} volet(s) commandé(s)`, ...(failed.length ? { errors: failed } : {}) };
}

// Climatisation FGLair : marche/arrêt, mode, consigne (°C).
async function assistantControlClimate({ power, mode, temperature, target }) {
  const all = await window.matin.modules.getAll();
  if (!all.fglair?.enabled) return { error: 'Module Climatisation non activé.' };
  const devices = await window.matin.fglair.getDevices();
  const list = target ? assistantFind(devices, target, (d) => d.customName || d.name || d.dsn) : devices;
  if (!list.length) return { error: `Aucun climatiseur « ${target} ».` };
  const MODES = { auto: 2, cool: 3, dry: 4, fan: 5, heat: 6 };
  const done = [];
  const failed = [];
  for (const d of list) {
    const label = d.customName || d.name || d.dsn;
    try {
      const props = fglairPropMap(await window.matin.fglair.getProperties(d.dsn));
      const send = async (name, value) => {
        if (!props[name]?.key) throw new Error(`propriété ${name} introuvable`);
        await window.matin.fglair.setProperty(props[name].key, value);
      };
      if (power === false) await send('operation_mode', 0);
      else if (mode && MODES[mode]) await send('operation_mode', MODES[mode]);
      else if (power === true) await send('operation_mode', props.operation_mode?.value > 0 ? props.operation_mode.value : MODES.auto);
      if (temperature !== undefined && temperature !== null) await send('adjust_temperature', Math.round(Number(temperature) * 10));
      done.push(label);
    } catch (e) { failed.push(`${label}: ${e.message}`); }
  }
  return done.length ? { result: `Climatisation mise à jour : ${done.join(', ')}`, ...(failed.length ? { errors: failed } : {}) } : { error: failed.join(' ; ') };
}

// Spotify via l'API Web (scope user-modify-playback-state déjà demandé à la
// connexion) — nécessite un compte PREMIUM et un appareil Spotify actif.
async function assistantControlMusic({ action }) {
  const tokenData = await window.matin.spotify.getValidToken();
  if (!tokenData?.accessToken) return { error: 'Spotify non connecté (Paramètres → Compte Spotify).' };
  const routes = {
    play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'],
    next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'],
  };
  const r = routes[action];
  if (!r) return { error: 'Action invalide (play, pause, next, previous).' };
  const res = await fetch(`https://api.spotify.com/v1${r[1]}`, { method: r[0], headers: { Authorization: `Bearer ${tokenData.accessToken}` } });
  if (res.ok || res.status === 204) return { result: `Spotify : ${action}` };
  if (res.status === 403) return { error: 'Spotify refuse : compte Premium requis, ou scope à re-consentir (déconnecter/reconnecter Spotify).' };
  if (res.status === 404) return { error: 'Aucun appareil Spotify actif : lance la lecture une fois sur un appareil.' };
  return { error: `Spotify a répondu ${res.status}` };
}

// Recherche web DuckDuckGo (exécutée côté main, voir main.js assistant:webSearch).
// Remplace `google_search` : déclaré à côté des fonctions, il n'était en
// pratique jamais utilisé par le modèle audio natif.
async function assistantWebSearch({ query }) {
  if (!query) return { error: 'Requête vide.' };
  const results = await window.matin.assistant.webSearch(String(query));
  if (!results.length) return { error: 'Aucun résultat.' };
  return { result: results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}`).join('\n') };
}

// Lance un raccourci du module Raccourcis (services Google) dans le navigateur.
async function assistantOpenShortcut({ name }) {
  const defs = window.ShortcutsDefs || [];
  const found = assistantFind(defs, name, (s) => s.label)[0] || assistantFind(defs, name, (s) => s.id)[0];
  if (!found) return { error: `Raccourci inconnu : ${name}. Disponibles : ${defs.map((s) => s.label).join(', ')}` };
  await window.matin.shell.openExternal(found.url);
  return { result: `${found.label} ouvert` };
}

// Rafraîchit la carte du module commandé (2026-09-25) : sans ça, une action
// faite par l'assistant (clim allumée, lumière…) n'apparaissait pas sur le
// dashboard avant le prochain rafraîchissement périodique. Léger délai : les
// API cloud/box mettent un instant à refléter le nouvel état.
const ASSISTANT_TOOL_MODULES = {
  control_climate: ['fglair'],
  control_lights: ['hue', 'kasa', 'tradfri'],
  control_shutters: ['somfyTahoma'],
};
async function assistantRefreshModulesFor(tool) {
  const keys = ASSISTANT_TOOL_MODULES[tool];
  if (!keys || typeof renderModuleOnce !== 'function') return;
  await new Promise((r) => setTimeout(r, 1500));
  const all = await window.matin.modules.getAll();
  for (const key of keys) {
    if (all[key]?.enabled && document.getElementById(`content-${key}`)) renderModuleOnce(key, MODULE_REGISTRY[key], all[key].config);
  }
}

async function assistantRunTool(name, args) {
  const out = await assistantRunToolRaw(name, args);
  if (!out.error) assistantRefreshModulesFor(name).catch(() => {});
  return out;
}

async function assistantRunToolRaw(name, args) {
  try {
    switch (name) {
      case 'web_search': return await assistantWebSearch(args || {});
      case 'execute_dashboard_command': assistantExecuteCommand(args?.command); return { result: 'ok' };
      case 'read_dashboard': return { result: assistantDashboardSummary(args?.module, 1500) || 'Aucun contenu lisible.' };
      case 'set_module_enabled': return await assistantSetModuleEnabled(args || {});
      case 'switch_profile': return await assistantSwitchProfile(args || {});
      case 'control_lights': return await assistantControlLights(args || {});
      case 'control_shutters': return await assistantControlShutters(args || {});
      case 'control_climate': return await assistantControlClimate(args || {});
      case 'control_music': return await assistantControlMusic(args || {});
      case 'open_shortcut': return await assistantOpenShortcut(args || {});
      default: return { error: `Outil inconnu : ${name}` };
    }
  } catch (err) {
    console.error('[Assistant] Échec outil', name, err);
    return { error: err.message || String(err) };
  }
}

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

// Avatar holographique (voir modules/avatar.js) monté dans l'orbe, et
// analyseur branché sur la sortie audio de Gemini pour animer la bouche et
// la waveform pendant `speaking`.
const ASSISTANT_AVATAR_SRC = 'assets/avatar-holo.webp'; // relatif à renderer/index.html
let assistantAvatar = null;
let assistantOutAnalyser = null;
let assistantOutTime = null;
let assistantOutFreq = null;
let assistantSpeakRaf = 0;

function assistantPumpSpeakingLevel() {
  if (!assistantOutAnalyser || !assistantAvatar) { assistantSpeakRaf = 0; return; }
  assistantOutAnalyser.getFloatTimeDomainData(assistantOutTime);
  let s = 0;
  for (let i = 0; i < assistantOutTime.length; i++) s += assistantOutTime[i] * assistantOutTime[i];
  const rms = Math.sqrt(s / assistantOutTime.length);
  assistantOutAnalyser.getByteFrequencyData(assistantOutFreq);
  assistantAvatar.setAudio(Math.min(1, rms * 5), assistantOutFreq);
  assistantSpeakRaf = requestAnimationFrame(assistantPumpSpeakingLevel);
}
function assistantStopSpeakingPump() {
  if (assistantSpeakRaf) cancelAnimationFrame(assistantSpeakRaf);
  assistantSpeakRaf = 0;
  assistantAvatar?.setAudio(0);
}

// Les classes orb-* sur la carte restent la source d'état (lues par le
// minuteur de silence) ; l'avatar suit.
function assistantSetState(state) {
  if (!assistantCard) return;
  assistantCard.classList.remove('orb-idle', 'orb-listening', 'orb-thinking', 'orb-speaking');
  assistantCard.classList.add('orb-' + state);
  if (!assistantAvatar) return;
  assistantAvatar.setState(state);
  if (state === 'speaking') { if (!assistantSpeakRaf) assistantPumpSpeakingLevel(); }
  else assistantStopSpeakingPump();
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
    case 'CLOSE_SETTINGS':
      window.matin.window.closeConfig().catch(() => {});
      break;
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
    assistantOutAnalyser = assistantPlayCtx.createAnalyser();
    assistantOutAnalyser.fftSize = 512;
    assistantOutAnalyser.smoothingTimeConstant = 0.6;
    assistantOutAnalyser.connect(assistantPlayCtx.destination);
    assistantOutTime = new Float32Array(assistantOutAnalyser.fftSize);
    assistantOutFreq = new Uint8Array(assistantOutAnalyser.frequencyBinCount);
  }
  const buffer = assistantPlayCtx.createBuffer(1, float32.length, ASSISTANT_SAMPLE_RATE_OUT);
  buffer.copyToChannel(float32, 0);
  const source = assistantPlayCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(assistantOutAnalyser);
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

// Sons système (2026-09-25) — contexte fermé après lecture (un AudioContext
// laissé ouvert par bip finirait par atteindre la limite du navigateur).
function assistantPlayTones(steps) {
  const ctx = new AudioContext();
  steps.forEach(({ delay, from, to, dur, vol }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur);
  });
  const total = Math.max(...steps.map((s) => s.delay + s.dur));
  setTimeout(() => ctx.close().catch(() => {}), total * 1000 + 200);
}
// Double bip montant : "je t'écoute".
function assistantPlayListenSound() {
  assistantPlayTones([
    { delay: 0, from: 660, to: 660, dur: 0.18, vol: 0.25 },
    { delay: 0.18, from: 880, to: 880, dur: 0.18, vol: 0.25 },
  ]);
}
// Bip descendant doux : fin de conversation.
function assistantPlayEndSound() {
  assistantPlayTones([{ delay: 0, from: 660, to: 330, dur: 0.3, vol: 0.2 }]);
}

// Coupure auto après ASSISTANT_SILENCE_MS sans voix (RMS sous le seuil).
const ASSISTANT_SILENCE_THR = 0.005;
const ASSISTANT_SILENCE_MS = 6000;
let assistantSpokeSinceTurn = false;
let assistantSilenceTimer = null;
let assistantGain = 1; // lu depuis `assistant_gain` à chaque début de session
function assistantResetSilenceTimer() {
  if (assistantSilenceTimer) { clearTimeout(assistantSilenceTimer); assistantSilenceTimer = null; }
}

function assistantDisconnect() {
  assistantResetSilenceTimer();
  assistantSpokeSinceTurn = false;
  if (assistantSessionReady) assistantPlayEndSound(); // seulement si une session était réellement active
  assistantClearPlayback();
  if (assistantProcessorNode) { assistantProcessorNode.disconnect(); assistantProcessorNode = null; }
  if (assistantSourceNode) { assistantSourceNode.disconnect(); assistantSourceNode = null; }
  if (assistantMediaStream) { assistantMediaStream.getTracks().forEach((t) => t.stop()); assistantMediaStream = null; }
  if (assistantCaptureCtx) { assistantCaptureCtx.close().catch(() => {}); assistantCaptureCtx = null; }
  assistantStopSpeakingPump();
  if (assistantPlayCtx) { assistantPlayCtx.close().catch(() => {}); assistantPlayCtx = null; }
  assistantOutAnalyser = null;
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
      // Sensibilité micro (Paramètres → Assistant vocal) : gain logiciel
      // appliqué AVANT le calcul RMS (le seuil de silence suit) et l'envoi ;
      // la conversion int16 écrête, pas de débordement.
      const raw = e.inputBuffer.getChannelData(0);
      const float32 = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) float32[i] = raw[i] * assistantGain;
      let sum = 0;
      for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
      const rms = Math.sqrt(sum / float32.length);
      if (assistantCard?.classList.contains('orb-listening')) assistantAvatar?.setAudio(Math.min(1, rms * 6));
      // Timer de silence : uniquement pendant l'écoute (jamais pendant la
      // réponse), et SEULEMENT tant que l'utilisateur n'a rien dit depuis le
      // dernier tour du modèle — une fois qu'on a parlé, le silence qui suit
      // est l'attente de la réponse de Gemini (recherche, outil… parfois >3s),
      // pas un abandon : c'était la cause des conversations coupées d'elles-mêmes.
      if (assistantCard?.classList.contains('orb-listening')) {
        if (rms > ASSISTANT_SILENCE_THR) { assistantSpokeSinceTurn = true; assistantResetSilenceTimer(); }
        else if (!assistantSilenceTimer && !assistantSpokeSinceTurn) {
          assistantSilenceTimer = setTimeout(() => {
            assistantSilenceTimer = null;
            assistantDisconnect();
            assistantSetState('idle');
          }, ASSISTANT_SILENCE_MS);
        }
      } else assistantResetSilenceTimer();

      const int16 = assistantFloatToInt16(float32);
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
    assistantPlayListenSound();
    assistantStartMic().then((ok) => {
      if (ok) assistantSetState('listening');
      else { assistantDisconnect(); assistantSetState('idle'); }
    });
    return;
  }

  const content = data.serverContent;
  if (content) {
    if (content.modelTurn?.parts) {
      assistantSpokeSinceTurn = false;
      assistantResetSilenceTimer();
      assistantSetState('speaking');
      content.modelTurn.parts.forEach((part) => { if (part.inlineData?.data) assistantEnqueueAudio(part.inlineData.data); });
    }
    if (content.turnComplete) assistantWaitPlaybackEnd(() => { if (assistantWs) assistantSetState('listening'); });
    if (content.interrupted) { assistantClearPlayback(); assistantSetState('listening'); }
  }

  if (data.toolCall?.functionCalls) {
    assistantResetSilenceTimer();
    data.toolCall.functionCalls.forEach(async (call) => {
      const response = await assistantRunTool(call.name, call.args);
      if (assistantWs?.readyState === WebSocket.OPEN) {
        assistantWs.send(JSON.stringify({
          tool_response: { function_responses: [{ id: call.id, name: call.name, response }] },
        }));
      }
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
  assistantGain = Math.max(0.5, Math.min(6, Number(await window.matin.store.get('assistant_gain')) || 1));
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
        // Aperçu du dashboard injecté au démarrage de session (read_dashboard
        // permet ensuite de relire à jour un module précis).
        system_instruction: { parts: [{ text: `${ASSISTANT_SYSTEM_PROMPT}\n\nModules disponibles : ${assistantModuleList()}.\n\nContenu actuel du dashboard (aperçu) :\n${assistantDashboardSummary('', 350).slice(0, 6000)}` }] },
        tools: [
          {
            function_declarations: [
              {
                name: 'web_search',
                description: "Recherche sur internet (actualité, faits récents, météo, résultats, infos que tu ne connais pas). À utiliser dès qu'une question demande une information à jour.",
                parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Requête de recherche' } }, required: ['query'] },
              },
              {
                name: 'execute_dashboard_command',
                description: 'Exécute une commande simple sur le dashboard Matin',
                parameters: {
                  type: 'OBJECT',
                  properties: { command: { type: 'STRING', enum: ['TOGGLE_THEME', 'OPEN_SETTINGS', 'CLOSE_SETTINGS', 'REFRESH_ALL'] } },
                  required: ['command'],
                },
              },
              {
                name: 'read_dashboard',
                description: "Lit le contenu actuellement affiché par les modules du dashboard (météo, matchs, agenda, actus…). Sans argument : aperçu de tous les modules ; avec `module` : contenu détaillé de celui-là.",
                parameters: { type: 'OBJECT', properties: { module: { type: 'STRING', description: 'Clé ou nom du module (optionnel)' } } },
              },
              {
                name: 'set_module_enabled',
                description: 'Active ou désactive un module du dashboard.',
                parameters: {
                  type: 'OBJECT',
                  properties: { module: { type: 'STRING', description: 'Clé ou libellé du module' }, enabled: { type: 'BOOLEAN' } },
                  required: ['module', 'enabled'],
                },
              },
              {
                name: 'switch_profile',
                description: 'Bascule le dashboard sur le profil 1 ou 2.',
                parameters: { type: 'OBJECT', properties: { profile: { type: 'INTEGER', description: '1 ou 2' } }, required: ['profile'] },
              },
              {
                name: 'control_lights',
                description: "Allume/éteint des lumières (Hue par pièce, Kasa par appareil, Trådfri tout/rien) et règle la luminosité. Sans `target` : toutes les lumières.",
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    on: { type: 'BOOLEAN' },
                    target: { type: 'STRING', description: 'Nom de la pièce ou de l\'appareil (optionnel)' },
                    brightness: { type: 'INTEGER', description: 'Luminosité 0-100 (Hue et ampoules Kasa)' },
                  },
                },
              },
              {
                name: 'control_shutters',
                description: "Commande les volets Somfy : ouvrir/fermer, ou mettre à un pourcentage d'ouverture. Sans `target` : tous les volets.",
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    action: { type: 'STRING', enum: ['open', 'close'] },
                    position: { type: 'INTEGER', description: "Pourcentage d'ouverture 0 (fermé) à 100 (ouvert)" },
                    target: { type: 'STRING', description: 'Nom du volet (optionnel)' },
                  },
                },
              },
              {
                name: 'control_climate',
                description: 'Commande la climatisation : marche/arrêt, mode, température de consigne en °C.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    power: { type: 'BOOLEAN' },
                    mode: { type: 'STRING', enum: ['auto', 'cool', 'heat', 'dry', 'fan'] },
                    temperature: { type: 'NUMBER', description: 'Consigne en °C' },
                    target: { type: 'STRING', description: 'Nom du climatiseur (optionnel)' },
                  },
                },
              },
              {
                name: 'control_music',
                description: 'Contrôle la lecture Spotify : play, pause, morceau suivant ou précédent.',
                parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['play', 'pause', 'next', 'previous'] } }, required: ['action'] },
              },
              {
                name: 'open_shortcut',
                description: 'Ouvre un raccourci du dashboard dans le navigateur : Gmail, Drive, YouTube, Agenda, Photos, Maps.',
                parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] },
              },
            ],
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
    // Avatar monté UNE fois : render() peut être ré-exécuté (réactivation du
    // module) — on ne remonte que si le conteneur a changé ou a été vidé.
    if (!assistantAvatar || !container.contains(assistantAvatar.el)) {
      assistantAvatar?.destroy();
      container.innerHTML = '';
      assistantAvatar = window.createMatinAvatar(container, { src: ASSISTANT_AVATAR_SRC });
    }

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
    // Tap sur l'orbe SEULEMENT (`container` = zone centrale), pas sur la
    // couronne de bordure qui sert au glisser (voir dashboard.js ignoreFrom).
    interact(container).on('tap', assistantToggle);
    window.matin.assistant.onTrigger(assistantToggle);
    window.addEventListener('beforeunload', assistantDisconnect);
  },
};
