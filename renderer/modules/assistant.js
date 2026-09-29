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

const ASSISTANT_SAMPLE_RATE_IN  = 16000;  // Gemini input
const ASSISTANT_SAMPLE_RATE_OUT = 24000;  // Gemini output + OpenAI I/O
const ASSISTANT_CHUNK_SIZE = 4096;
const ASSISTANT_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const ASSISTANT_VOICE_MAP = { 'fr-FR': 'Aoede', 'en-US': 'Charon', 'es-ES': 'Fenrir' };

// ── OpenAI Realtime ──────────────────────────────────────────────────────────
const ASSISTANT_OPENAI_WS_BASE   = 'wss://api.openai.com/v1/realtime';
const ASSISTANT_OPENAI_SAMPLE_RATE = 24000; // I/O OpenAI : même taux que la sortie Gemini
const ASSISTANT_OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];

// Convertit une déclaration d'outil au format Gemini (types MAJ, behavior) vers
// le format OpenAI (types minuscules, type:"function", sans behavior).
function assistantGeminiToolToOpenAI(d) {
  const lower = (v) => {
    if (!v || typeof v !== 'object') return v;
    const r = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'type' && typeof val === 'string') r[k] = val.toLowerCase();
      else if (k === 'properties') r[k] = Object.fromEntries(Object.entries(val).map(([pk, pv]) => [pk, lower(pv)]));
      else if (k === 'items') r[k] = lower(val);
      else r[k] = val;
    }
    return r;
  };
  const { behavior: _b, ...rest } = d;
  return { type: 'function', ...rest, ...(d.parameters ? { parameters: lower(d.parameters) } : {}) };
}

const ASSISTANT_SYSTEM_PROMPT = `Tu es Matin, un assistant vocal généraliste intégré à un dashboard Windows.
Réponds de façon concise et naturelle — ta réponse sera lue à voix haute, ne cite jamais de lien.
Tu as accès au dashboard de l'utilisateur via des outils :
- google_search : pour toute information à jour (cours de bourse, de l'or, des devises, prix, actualité, résultats sportifs, horaires). Donne le chiffre précis et l'heure si disponible.
- web_search : uniquement si l'utilisateur veut une source ou un lien affiché dans le bloc-notes, ou si google_search n'a rien donné. Chaque résultat est numéroté [source n].
- read_dashboard : lit le contenu affiché des modules (météo, matchs, agenda…) — utilise-le pour répondre à toute question sur ce que le dashboard affiche.
- execute_dashboard_command : TOGGLE_THEME, OPEN_SETTINGS, CLOSE_SETTINGS, REFRESH_ALL.
- set_module_enabled : active ou désactive UN module.
- set_modules_enabled : active et/ou désactive PLUSIEURS modules en une seule action (listes enable / disable). À préférer dès que la demande concerne plus d'un module : un seul rechargement du dashboard au lieu d'un par module.
- execute_dashboard_command REORGANIZE : réorganise automatiquement la disposition des modules (style tiré au hasard, tailles inchangées) ; UNDO_REORGANIZE annule la dernière réorganisation.
- switch_profile : bascule sur le profil 1 ou 2.
- control_lights : allume/éteint/règle la luminosité des lumières (Hue, Kasa, Trådfri), toutes ou par nom.
- control_shutters : ouvre/ferme ou règle le pourcentage des volets Somfy, tous ou par nom.
- control_climate : climatisation (marche/arrêt, mode, température).
- control_music : contrôle le lecteur audio actif sur le PC (Spotify, Deezer, Chrome…) via Windows : play, pause, suivant, précédent. Aucun compte requis.
- open_shortcut : ouvre Gmail, Drive, YouTube, Agenda, Photos ou Maps.
- set_wallpaper : change le fond d'écran du dashboard (Paramètres → Personnaliser). Nom du fond (ex. « aurore boréale », « plage », « neige », « aucun »), ou « aléatoire »/« suivant ». Certains fonds ne vont qu'avec le thème sombre, d'autres qu'avec le thème clair : si le fond demandé ne correspond pas au thème actuel, dis-le et propose de basculer le thème (execute_dashboard_command TOGGLE_THEME).
- open_web_search : ouvre une recherche dans Google Chrome via la barre de recherche du dashboard. À utiliser dès que l'utilisateur veut VOIR une recherche (« fais une recherche sur… », « cherche … sur Internet/Google », « ouvre Chrome et cherche … »). Après l'appel, dis seulement que c'est ouvert. Pour une question dont tu donnes toi-même la réponse à voix haute (« quel est le cours de l'or ? »), n'utilise pas cet outil (utilise web_search si besoin).
- show_note : affiche un texte écrit dans un bloc-notes à l'écran (recette, liste, résumé, explication longue…). Dès que l'utilisateur demande quelque chose d'écrit ou de long à consulter, utilise show_note avec le contenu COMPLET en texte simple (une ligne par élément, "- " pour les listes, lignes vides entre sections, jamais de markdown ni de HTML), puis dis seulement à voix haute que c'est affiché. Si le texte vient d'une recherche web, passe source = numéro [source n] du résultat web ; ne recopie jamais d'URL.
- show_source : ajoute un lien de source (icône internet) au dernier bloc-notes, ou en crée un. À utiliser quand l'utilisateur demande la source ou le lien : passe source = numéro [source n] du résultat web ; ne recopie jamais d'URL, et ne lis jamais de lien à voix haute.
Confirme brièvement à voix haute ce que tu as fait, ou dis clairement si une action a échoué.
EXCEPTION : après set_module_enabled ou set_modules_enabled (activation/désactivation de modules) réussi, réponds UNIQUEMENT « Fait ! », sans rien ajouter (le dashboard se recharge juste après, une phrase plus longue serait coupée). En cas d'échec ou de module inconnu, dis-le normalement.`;

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
  return Object.entries(reg).filter(([k]) => !(typeof HIDDEN_MODULE_KEYS !== 'undefined' && HIDDEN_MODULE_KEYS.includes(k))).map(([k, m]) => `${k} (${m.label})`).join(', ');
}

// Outils d'action : chacun renvoie un objet résultat (jamais d'exception vers
// le WebSocket — une action ratée est rapportée au modèle, qui la dit à l'oral).
async function assistantSetModuleEnabled({ module, enabled }) {
  const all = await window.matin.modules.getAll();
  const wanted = String(module || '').toLowerCase();
  const key = Object.keys(all).find((k) => k.toLowerCase() === wanted)
    || Object.keys(all).find((k) => (typeof MODULE_REGISTRY !== 'undefined' && MODULE_REGISTRY[k]?.label || '').toLowerCase() === wanted);
  if (!key || (typeof HIDDEN_MODULE_KEYS !== 'undefined' && HIDDEN_MODULE_KEYS.includes(key))) return { error: `Module inconnu : ${module}` };
  if (key === 'assistant' && !enabled) return { error: "Je ne peux pas me désactiver moi-même." };
  all[key].enabled = !!enabled;
  await window.matin.modules.update(all);
  return { result: `${key} ${enabled ? 'activé' : 'désactivé'}` };
}

// Plusieurs modules en UNE écriture (2026-09-25, sur demande explicite) :
// chaque modules.update déclenche un rechargement complet du dashboard, le
// faire module par module en enchaînerait autant (et couperait l'écoute de
// l'assistant à chaque fois). `enable`/`disable` : tableaux de clés ou
// libellés (une chaîne séparée par des virgules est aussi acceptée).
async function assistantSetModulesEnabled({ enable, disable }) {
  const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const on = toList(enable);
  const off = toList(disable);
  if (!on.length && !off.length) return { error: 'Aucun module indiqué (enable / disable).' };
  const all = await window.matin.modules.getAll();
  const reg = typeof MODULE_REGISTRY !== 'undefined' ? MODULE_REGISTRY : {};
  const resolve = (name) => {
    const wanted = assistantNorm(name);
    return Object.keys(all).find((k) => assistantNorm(k) === wanted)
      || Object.keys(all).find((k) => assistantNorm(reg[k]?.label || '') === wanted)
      || Object.keys(all).find((k) => assistantNorm(reg[k]?.label || '').includes(wanted) && wanted.length > 2);
  };
  const changed = [];
  const unknown = [];
  const skipped = [];
  for (const [names, value] of [[on, true], [off, false]]) {
    for (const name of names) {
      const key = resolve(name);
      if (!key || (typeof HIDDEN_MODULE_KEYS !== 'undefined' && HIDDEN_MODULE_KEYS.includes(key))) { unknown.push(name); continue; }
      if (key === 'assistant' && !value) { skipped.push('assistant (je ne peux pas me désactiver moi-même)'); continue; }
      if (all[key].enabled === value) continue;
      all[key].enabled = value;
      changed.push(`${key} ${value ? 'activé' : 'désactivé'}`);
    }
  }
  if (changed.length) await window.matin.modules.update(all);
  if (!changed.length && !unknown.length && !skipped.length) return { result: 'Rien à changer : les modules étaient déjà dans cet état.' };
  return {
    result: changed.length ? `${changed.join(', ')}. Le dashboard se recharge.` : 'Aucun changement.',
    ...(unknown.length ? { unknown: `Modules inconnus : ${unknown.join(', ')}` } : {}),
    ...(skipped.length ? { skipped: skipped.join(', ') } : {}),
  };
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

/** Commande SMTC + retour formaté pour l'assistant. */
async function assistantSmtcControl(cmd) {
  try { return await window.matin.smtc.send(cmd); } catch { return false; }
}

// Contrôle du lecteur média Windows (SMTC) — sans compte, sans Premium.
// play/pause/next/previous via les System Media Transport Controls Windows.
async function assistantControlMusic({ action }) {
  if (!['play', 'pause', 'next', 'previous'].includes(action)) return { error: 'Action invalide.' };
  const ok = await assistantSmtcControl(action);
  if (!ok) return { error: 'Aucun lecteur actif sur le PC. Lance un lecteur (Spotify, Deezer…) et réessaie.' };
  const labels = { play: 'Lecture lancée.', pause: 'Lecture en pause.', next: 'Morceau suivant.', previous: 'Morceau précédent.' };
  return { result: labels[action] };
}

// Recherche web DuckDuckGo (exécutée côté main, voir main.js assistant:webSearch).
// Remplace `google_search` : déclaré à côté des fonctions, il n'était en
// pratique jamais utilisé par le modèle audio natif.
// Registre des sources (2026-09-25) : un modèle audio ne sait pas recopier une
// URL exacte (il la tronque ou l'invente). Le modèle ne voit donc que des
// numéros [source n] ; les vraies URLs restent ici et show_note/show_source
// les résolvent par numéro. Une URL fournie par le modèle n'est jamais utilisée.
let assistantLastSources = []; // [{ n, url, title }]
function assistantAddSources(items) {
  let n = assistantLastSources.reduce((max, s) => Math.max(max, s.n), 0);
  const added = [];
  for (const { url, title } of items) {
    const safe = assistantSafeUrl(url);
    if (!safe || assistantLastSources.some((s) => s.url === safe)) continue;
    const s = { n: ++n, url: safe, title: String(title || 'Source') };
    assistantLastSources.push(s);
    added.push(s);
  }
  return added;
}
function assistantSourceByNumber(source) {
  return assistantLastSources.find((s) => s.n === Number(source)) || null;
}

// Sources Google Search (grounding) : ajoutées au registre à la suite des
// numéros existants ; si un bloc-notes vient d'être créé (< 30s), il reçoit
// aussi jusqu'à 3 de ces liens. Ils passent par une redirection Google.
function assistantAddGroundingSources(chunks) {
  assistantAddSources(chunks.map((c) => c?.web).filter((w) => w?.uri).map((w) => ({ url: w.uri, title: w.title })))
    .forEach((s) => { s.grounding = true; });
  // Toutes les sources Google connues (pas seulement les nouvelles) : le
  // bloc-notes peut avoir été créé après un premier envoi de ces sources.
  const added = assistantLastSources.filter((s) => s.grounding);
  if (!added.length || !assistantCard) return;
  const notes = assistantNotesLoad();
  const last = notes[notes.length - 1];
  if (!last || Date.now() - last.ts > 30 * 1000) return;
  if (!last.sources) last.sources = [];
  let attached = last.sources.filter((x) => x.grounding).length;
  let changed = false;
  for (const s of added) {
    if (attached >= 3) break;
    if (last.sources.some((x) => x.url === s.url)) continue;
    last.sources.push({ url: s.url, label: s.title.slice(0, 60), grounding: true });
    attached++;
    changed = true;
  }
  if (!changed) return;
  assistantNotesSave(notes);
  assistantOpenNotes(assistantCard, notes.length - 1);
}

async function assistantWebSearch({ query }) {
  if (!query) return { error: 'Requête vide.' };
  const results = await window.matin.assistant.webSearch(String(query));
  if (!results.length) return { error: 'Aucun résultat.' };
  // Nouvelle recherche = nouvelle numérotation à partir de 1.
  assistantLastSources = [];
  const numbered = results.map((r) => ({ r, s: assistantAddSources([{ url: r.url, title: r.title }])[0] }));
  return { result: numbered.map(({ r, s }, i) => `${i + 1}. ${r.title} — ${r.snippet}${s ? ` [source ${s.n}]` : ''}`).join('\n') };
}

// ── Bloc-notes de l'assistant (2026-09-25, sur demande explicite) ─────────
// Panneau déplié sous (ou au-dessus de) l'orbe, DANS la carte : il suit donc
// le déplacement du module. Notes gardées 24 h dans localStorage (historique
// consultable avec ‹ ›), puis purgées. Texte posé en textContent (jamais
// d'HTML venant du modèle) ; liens limités à http(s).
const ASSISTANT_NOTES_KEY = 'matin-assistant-notes-v1';
const ASSISTANT_NOTES_TTL_MS = 24 * 60 * 60 * 1000;
const ASSISTANT_NOTES_MAX = 30;
let assistantNoteIdx = 0;

function assistantNotesLoad() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(ASSISTANT_NOTES_KEY) || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const fresh = list.filter((n) => n && Date.now() - n.ts < ASSISTANT_NOTES_TTL_MS);
  if (fresh.length !== list.length) assistantNotesSave(fresh);
  return fresh; // du plus ancien au plus récent
}
function assistantNotesSave(list) {
  try { localStorage.setItem(ASSISTANT_NOTES_KEY, JSON.stringify(list.slice(-ASSISTANT_NOTES_MAX))); } catch (e) { console.warn('[Assistant] Notes non sauvegardées', e); }
}
const assistantSafeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

function assistantEnsurePanel(card) {
  if (card.querySelector('.asst-panel')) return card.querySelector('.asst-panel');
  const panel = document.createElement('div');
  panel.className = 'asst-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="asst-panel-head">
      <span class="asst-panel-title"></span>
      <span class="asst-panel-nav">
        <button type="button" data-a="prev" title="Note précédente">‹</button>
        <span class="asst-panel-count"></span>
        <button type="button" data-a="next" title="Note suivante">›</button>
      </span>
      <button type="button" data-a="source" title="Ouvrir la source" hidden>🌐</button>
      <button type="button" data-a="copy" title="Copier le texte">📋</button>
      <button type="button" data-a="del" title="Supprimer cette note">🗑</button>
      <button type="button" data-a="close" title="Fermer (Échap)">✕</button>
    </div>
    <div class="asst-panel-body"></div>
    <div class="asst-panel-foot"></div>`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'asst-notes-btn';
  btn.hidden = true;
  btn.title = "Notes de l'assistant (24 h)";
  btn.innerHTML = '📝<span class="asst-notes-count"></span>';
  card.append(panel, btn);

  btn.addEventListener('click', () => assistantOpenNotes(card, assistantNotesLoad().length - 1));
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const notes = assistantNotesLoad();
    const note = notes[assistantNoteIdx];
    switch (b.dataset.a) {
      case 'close': assistantClosePanel(card); break;
      case 'del': {
        // Supprime la note affichée puis montre sa voisine (ou ferme s'il n'en reste plus).
        notes.splice(assistantNoteIdx, 1);
        assistantNotesSave(notes);
        if (notes.length) assistantOpenNotes(card, Math.min(assistantNoteIdx, notes.length - 1));
        else assistantClosePanel(card);
        break;
      }
      case 'delall': {
        // Double clic de confirmation (3 s) : évite d'effacer tout l'historique par erreur.
        if (b.dataset.armed) { assistantNotesSave([]); assistantClosePanel(card); break; }
        b.dataset.armed = '1'; b.textContent = 'Confirmer ?';
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Tout effacer'; } }, 3000);
        break;
      }
      case 'prev': assistantOpenNotes(card, Math.max(0, assistantNoteIdx - 1)); break;
      case 'next': assistantOpenNotes(card, Math.min(notes.length - 1, assistantNoteIdx + 1)); break;
      case 'copy':
        if (note) navigator.clipboard.writeText(`${note.title}\n\n${note.content}`).then(() => {
          b.textContent = '✓'; setTimeout(() => { b.textContent = '📋'; }, 1200);
        }).catch((err) => console.warn('[Assistant] Copie impossible', err));
        break;
      case 'source': {
        const url = assistantSafeUrl(note?.sources?.[0]?.url);
        if (url) window.matin.shell.openExternal(url);
        break;
      }
      case 'src-i': {
        const url = assistantSafeUrl(note?.sources?.[Number(b.dataset.i)]?.url);
        if (url) window.matin.shell.openExternal(url);
        break;
      }
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) assistantClosePanel(card); });
  setInterval(() => assistantRefreshNotesUi(card), 10 * 60 * 1000);
  assistantRefreshNotesUi(card);
  return panel;
}

function assistantRefreshNotesUi(card) {
  const btn = card.querySelector('.asst-notes-btn');
  const panel = card.querySelector('.asst-panel');
  if (!btn || !panel) return;
  const n = assistantNotesLoad().length;
  btn.hidden = n === 0 || !panel.hidden;
  btn.querySelector('.asst-notes-count').textContent = n > 1 ? String(n) : '';
  if (n === 0 && !panel.hidden) assistantClosePanel(card);
}

function assistantClosePanel(card) {
  const panel = card.querySelector('.asst-panel');
  if (panel) panel.hidden = true;
  assistantRefreshNotesUi(card);
}

function assistantOpenNotes(card, idx) {
  const panel = assistantEnsurePanel(card);
  const notes = assistantNotesLoad();
  if (!notes.length) { assistantClosePanel(card); return; }
  assistantNoteIdx = Math.max(0, Math.min(notes.length - 1, idx));
  const note = notes[assistantNoteIdx];
  panel.querySelector('.asst-panel-title').textContent = note.title || 'Note';
  panel.querySelector('.asst-panel-count').textContent = `${assistantNoteIdx + 1}/${notes.length}`;
  panel.querySelector('[data-a="prev"]').disabled = assistantNoteIdx === 0;
  panel.querySelector('[data-a="next"]').disabled = assistantNoteIdx === notes.length - 1;
  const body = panel.querySelector('.asst-panel-body');
  body.textContent = note.content || (note.sources?.length ? 'Source :' : '');
  body.scrollTop = 0;
  const srcs = (note.sources || []).filter((s) => assistantSafeUrl(s.url));
  panel.querySelector('[data-a="source"]').hidden = srcs.length === 0;
  const foot = panel.querySelector('.asst-panel-foot');
  foot.textContent = '';
  const age = Math.max(1, Math.round((Date.now() - note.ts) / 60000));
  const stamp = document.createElement('span');
  stamp.textContent = age < 60 ? `il y a ${age} min` : `il y a ${Math.round(age / 60)} h`;
  foot.append(stamp);
  if (srcs.length > 1 || (srcs.length === 1 && !note.content)) {
    srcs.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.a = 'src-i'; b.dataset.i = String(i);
      b.textContent = `🌐 ${s.label || 'Source'}`;
      foot.append(b);
    });
  }
  if (notes.length > 1) {
    const all = document.createElement('button');
    all.type = 'button'; all.dataset.a = 'delall'; all.textContent = 'Tout effacer';
    all.style.marginLeft = 'auto';
    foot.append(all);
  }
  // Ouvre vers le bas, ou vers le haut s'il n'y a pas la place sous la carte.
  const r = card.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  panel.classList.toggle('asst-up', below < 320 && r.top > below);
  panel.hidden = false;
  if (typeof bringToFront === 'function') bringToFront(card);
  assistantRefreshNotesUi(card);
}

async function assistantShowNote({ title, content, source }) {
  if (!assistantCard) return { error: 'Module assistant indisponible.' };
  const text = String(content || '').trim();
  if (!text) return { error: 'Contenu vide.' };
  // Source résolue par numéro dans le registre (jamais une URL du modèle).
  let src = null;
  if (source !== undefined && source !== null && source !== '') {
    src = assistantSourceByNumber(source);
    if (!src) return { error: 'Source inconnue : relance web_search.' };
  }
  const notes = assistantNotesLoad();
  const note = { id: Date.now(), ts: Date.now(), title: String(title || 'Note').slice(0, 80), content: text.slice(0, 8000), sources: [] };
  if (src) note.sources.push({ url: src.url, label: src.title.slice(0, 60) });
  notes.push(note);
  assistantNotesSave(notes);
  assistantOpenNotes(assistantCard, notes.length - 1);
  return { result: "Note affichée à l'écran." };
}

async function assistantShowSource({ source }) {
  if (!assistantCard) return { error: 'Module assistant indisponible.' };
  const found = assistantSourceByNumber(source);
  if (!found) return { error: 'Source inconnue : relance web_search.' };
  const safe = found.url;
  const notes = assistantNotesLoad();
  const last = notes[notes.length - 1];
  const src = { url: safe, label: found.title.slice(0, 60) };
  if (last && Date.now() - last.ts < 5 * 60 * 1000) {
    if (!last.sources) last.sources = [];
    if (!last.sources.some((s) => s.url === safe)) last.sources.push(src);
  } else {
    notes.push({ id: Date.now(), ts: Date.now(), title: src.label, content: '', sources: [src] });
  }
  assistantNotesSave(notes);
  assistantOpenNotes(assistantCard, notes.length - 1);
  return { result: "Source disponible via l'icône internet." };
}

// ── Fonds d'écran (2026-09-25, sur demande explicite) ─────────────────────
// Catalogue miroir de PERSONNALISER_OPTIONS (config.js, fenêtre Paramètres —
// pas accessible depuis le dashboard, d'où la copie ; à tenir à jour avec lui).
// Appliqué via le MÊME canal que le clic dans Paramètres → Personnaliser
// (window.matin.background.set) : effet immédiat, AUCUN rechargement de page,
// donc la session vocale n'est pas coupée.
const ASSISTANT_WALLPAPERS = [
  { key: 'none', label: 'Aucun fond', theme: null },
  { key: 'stars', label: 'Fond étoilé', theme: 'dark' },
  { key: 'rain', label: 'Pluie', theme: 'dark' },
  { key: 'snow', label: 'Neige', theme: 'dark' },
  { key: 'matrix', label: 'Matrix', theme: 'dark' },
  { key: 'nebula', label: 'Nébuleuse', theme: 'dark' },
  { key: 'beach', label: 'Plage au lever du soleil', theme: 'dark' },
  { key: 'mountain', label: 'Lever de soleil en montagne', theme: 'dark' },
  { key: 'lac', label: 'Lac et forêt', theme: 'dark' },
  { key: 'dawnlake', label: "Lac à l'aube", theme: null },
  { key: 'earth-horizon', label: "Terre depuis l'espace", theme: null },
  { key: 'paper', label: 'Grain de papier', theme: 'light' },
  { key: 'geometric', label: 'Lignes géométriques', theme: 'light' },
  { key: 'gradient', label: 'Dégradé doux', theme: 'light' },
  { key: 'winter-frost', label: 'Givre sur vitre', theme: 'light' },
  { key: 'winter-pines', label: 'Sapins dans la brume', theme: 'light' },
  { key: 'winter-peaks', label: 'Cime enneigée', theme: 'light' },
  { key: 'winter-mist', label: 'Arbres dans la neige', theme: 'light' },
  { key: 'winter-illus', label: 'Montagnes illustrées', theme: 'light' },
  { key: 'winter-sea', label: "Horizon d'hiver", theme: 'light' },
];

async function assistantSetWallpaper({ name }) {
  const theme = document.documentElement.dataset.colorScheme === 'light' ? 'light' : 'dark';
  const usable = ASSISTANT_WALLPAPERS.filter((w) => w.theme === null || w.theme === theme);
  const query = assistantNorm(name);
  if (!query) return { error: `Précise le fond. Disponibles (thème ${theme === 'dark' ? 'sombre' : 'clair'}) : ${usable.map((w) => w.label).join(', ')}` };

  let chosen = null;
  if (/^(aleatoire|hasard|au hasard|surprends)/.test(query)) {
    const pool = usable.filter((w) => w.key !== 'none' && w.key !== lastAppBackgroundKey);
    chosen = pool[Math.floor(Math.random() * pool.length)];
  } else if (/^(suivant|prochain|autre|change)/.test(query)) {
    const i = usable.findIndex((w) => w.key === lastAppBackgroundKey);
    chosen = usable[(i + 1) % usable.length];
  } else if (/^(aucun|sans|pas de|enleve|supprime|retire)/.test(query)) {
    chosen = ASSISTANT_WALLPAPERS[0];
  } else {
    const match = (list) => list.find((w) => assistantNorm(w.label) === query || w.key === query)
      || list.find((w) => assistantNorm(w.label).includes(query) || query.includes(assistantNorm(w.label)) || query.includes(w.key));
    chosen = match(usable);
    if (!chosen) {
      // Existe-t-il pour l'AUTRE thème ? On le dit plutôt que de répondre « inconnu ».
      const other = match(ASSISTANT_WALLPAPERS);
      if (other) return { error: `« ${other.label} » n'existe qu'en thème ${other.theme === 'dark' ? 'sombre' : 'clair'} (actuellement ${theme === 'dark' ? 'sombre' : 'clair'}). Propose de basculer le thème.` };
      return { error: `Fond inconnu : ${name}. Disponibles : ${usable.map((w) => w.label).join(', ')}` };
    }
  }
  if (!chosen) return { error: 'Aucun fond disponible.' };
  await window.matin.background.set(chosen.key);
  return { result: `Fond « ${chosen.label} » appliqué` };
}

// Recherche ouverte dans Chrome via la barre de recherche du dashboard
// (2026-09-25, sur demande explicite) : moteur choisi dans Paramètres →
// Services (window.SearchEngines), voir dashboard.js runTitlebarSearch.
// Aucun module à rafraîchir : volontairement absent d'ASSISTANT_TOOL_MODULES.
async function assistantOpenWebSearch({ query }) {
  if (typeof window.runTitlebarSearch !== 'function') return { error: 'Barre de recherche indisponible.' };
  const r = await window.runTitlebarSearch(query, { browser: 'chrome', assistant: true });
  if (!r.ok) return { error: r.reason === 'empty' ? 'Requête vide.' : "Impossible d'ouvrir la recherche." };
  return { result: `Recherche « ${r.query} » ouverte sur ${r.engine} dans ${r.browser === 'chrome' ? 'Google Chrome' : 'le navigateur par défaut (Chrome introuvable)'}.` };
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
  control_music: ['spotify'],
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
      case 'set_modules_enabled': return await assistantSetModulesEnabled(args || {});
      case 'switch_profile': return await assistantSwitchProfile(args || {});
      case 'control_lights': return await assistantControlLights(args || {});
      case 'control_shutters': return await assistantControlShutters(args || {});
      case 'control_climate': return await assistantControlClimate(args || {});
      case 'control_music': return await assistantControlMusic(args || {});
      case 'open_shortcut': return await assistantOpenShortcut(args || {});
      case 'set_wallpaper': return await assistantSetWallpaper(args || {});
      case 'open_web_search': return await assistantOpenWebSearch(args || {});
      case 'show_note': return await assistantShowNote(args || {});
      case 'show_source': return await assistantShowSource(args || {});
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
let assistantCurrentProvider = 'gemini'; // 'gemini' | 'openai'
let assistantCurrentSampleRateIn = ASSISTANT_SAMPLE_RATE_IN;
let assistantGeminiApiKey = '';
let assistantNextPlayTime = 0;
let assistantPlaybackTimer = null;

// Avatar holographique (voir modules/avatar.js) monté dans l'orbe, et
// analyseur branché sur la sortie audio de Gemini pour animer la bouche et
// la waveform pendant `speaking`.
const ASSISTANT_AVATAR_SRC = 'assets/avatar-holo-2k.webp'; // relatif à renderer/index.html
let assistantAvatar = null;
let assistantOutAnalyser = null;
let assistantOutTime = null;
let assistantOutFreq = null;
let assistantSpeakRaf = 0;

function assistantPumpSpeakingLevel() {
  if (!assistantAvatar) { assistantSpeakRaf = 0; return; }
  // Analyseur pas encore créé (1er chunk audio : l'état 'speaking' est posé
  // AVANT assistantEnqueueAudio) : on continue de tourner au lieu de s'arrêter,
  // sinon la bouche restait figée pour toute la réponse.
  if (!assistantOutAnalyser) { assistantSpeakRaf = requestAnimationFrame(assistantPumpSpeakingLevel); return; }
  assistantOutAnalyser.getFloatTimeDomainData(assistantOutTime);
  let s = 0;
  for (let i = 0; i < assistantOutTime.length; i++) s += assistantOutTime[i] * assistantOutTime[i];
  const rms = Math.sqrt(s / assistantOutTime.length);
  assistantOutAnalyser.getByteFrequencyData(assistantOutFreq);
  assistantAvatar.setAudio(Math.min(1, rms * 8), assistantOutFreq);
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
  // Point de départ du compte à rebours de silence (voir ASSISTANT_SILENCE_MS).
  if (state === 'listening' && !assistantCard.classList.contains('orb-listening')) assistantListenSince = performance.now();
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
    case 'REORGANIZE':
      // Réutilise TEL QUEL le bouton "⊞ Réorganiser" (dashboard.js
      // performAutoArrange, style aléatoire, snapshot pour annuler, sauvegarde
      // du layout) : ouvre la popup de confirmation puis la valide, sans
      // dupliquer ni exposer la logique de disposition. Seule la POSITION
      // des cartes change, jamais leur taille.
      document.getElementById('btnAutoArrange')?.click();
      document.getElementById('autoArrangeConfirmOk')?.click();
      break;
    case 'UNDO_REORGANIZE':
      document.getElementById('autoArrangeUndo')?.click();
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

// ── Fin de conversation automatique (2026-09-25, refonte) ────────────────
// Avant : seuil fixe 0.005 — le simple bruit ambiant (a fortiori avec le gain
// de sensibilité) passait pour de la parole, marquait "l'utilisateur a parlé"
// et désactivait le minuteur : la session restait ouverte indéfiniment.
// Maintenant : horodatages vérifiés à chaque bloc audio (~256ms) et seuil de
// parole relatif au bruit de fond mesuré en continu.
//  - en écoute, sans parole depuis la fin de la réponse → fin après 1,5s
//    (5s au tout début de session, le temps de commencer à parler) ;
//  - après avoir parlé, en attente de la réponse (recherche, outil…) → fin
//    seulement si rien ne vient de Gemini pendant 12s (fausse détection).
const ASSISTANT_SILENCE_MS = 1500;
const ASSISTANT_FIRST_SILENCE_MS = 5000;
const ASSISTANT_AWAIT_REPLY_MS = 12000;
const ASSISTANT_SPEECH_MIN = 0.012;   // plancher absolu du seuil de parole
const ASSISTANT_SPEECH_RATIO = 3.5;   // parole = RMS > bruit de fond × ce ratio
let assistantSpokeSinceTurn = false;
let assistantHadModelTurn = false;
let assistantOpenAICommitted = false; // buffer audio commité, en attente de réponse OpenAI
let assistantListenSince = 0;   // entrée dans l'état 'listening'
let assistantLastActivity = 0;  // dernière parole détectée ou message de Gemini
let assistantNoiseFloor = 0.004;
let assistantCalib = [];
let assistantLoudBlocks = 0;
let assistantGain = 1; // lu depuis `assistant_gain` à chaque début de session
// Toute activité de Gemini (réponse, outil) repousse l'échéance d'attente.
function assistantResetSilenceTimer() {
  assistantLastActivity = performance.now();
}
function assistantEndForSilence(reason) {
  console.log(`[Assistant] Fin automatique : ${reason}`);
  assistantDisconnect();
  assistantSetState('idle');
}

function assistantDisconnect() {
  assistantSpokeSinceTurn = false;
  assistantHadModelTurn = false;
  assistantOpenAICommitted = false;
  assistantNoiseFloor = 0.004;
  assistantCalib = [];
  assistantLoudBlocks = 0;
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
    assistantCaptureCtx = new AudioContext({ sampleRate: assistantCurrentSampleRateIn });
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
      // OpenAI : VAD géré par le serveur. On ferme seulement après 30s sans parole.
      if (assistantCurrentProvider === 'openai' && assistantCard?.classList.contains('orb-listening')) {
        const now = performance.now();
        if (now - assistantListenSince > 30000) { assistantEndForSilence('30s sans activité'); return; }
      }

      // Fin de conversation automatique (voir ASSISTANT_SILENCE_MS).
      if (assistantCurrentProvider !== 'openai' && assistantCard?.classList.contains('orb-listening')) {
        const now = performance.now();
        // Étalonnage : les 3 premiers blocs (~0,8s, juste après le bip)
        // mesurent le bruit de la pièce au lieu d'être jugés comme parole.
        if (assistantCalib.length < 3) {
          assistantCalib.push(rms);
          if (assistantCalib.length === 3) assistantNoiseFloor = [...assistantCalib].sort((a, b) => a - b)[1];
        } else {
          const threshold = Math.max(ASSISTANT_SPEECH_MIN, assistantNoiseFloor * ASSISTANT_SPEECH_RATIO);
          // Parole = au moins 2 blocs consécutifs (~0,5s) au-dessus du seuil :
          // un claquement ou un bruit bref ne compte pas.
          assistantLoudBlocks = rms > threshold ? assistantLoudBlocks + 1 : 0;
          if (assistantLoudBlocks >= 2) {
            assistantSpokeSinceTurn = true;
            assistantLastActivity = now;
          } else if (rms <= threshold) {
            assistantNoiseFloor = assistantNoiseFloor * 0.8 + rms * 0.2; // suivi du bruit hors parole
          }
        }
        if (!assistantSpokeSinceTurn) {
          const limit = assistantHadModelTurn ? ASSISTANT_SILENCE_MS : ASSISTANT_FIRST_SILENCE_MS;
          if (now - assistantListenSince > limit) { assistantEndForSilence(`${limit / 1000}s sans parole`); return; }
        } else if (now - assistantLastActivity > ASSISTANT_AWAIT_REPLY_MS) {
          assistantEndForSilence('aucune réponse après la dernière parole');
          return;
        }
      }

      const int16 = assistantFloatToInt16(float32);
      if (assistantCurrentProvider === 'openai') {
        assistantWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: assistantBufferToBase64(int16.buffer) }));
      } else {
        assistantWs.send(JSON.stringify({
          realtime_input: { audio: { mime_type: `audio/pcm;rate=${assistantCurrentSampleRateIn}`, data: assistantBufferToBase64(int16.buffer) } },
        }));
      }
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
  if (content?.groundingMetadata?.groundingChunks) assistantAddGroundingSources(content.groundingMetadata.groundingChunks);
  if (content) {
    if (content.modelTurn?.parts) {
      assistantSpokeSinceTurn = false;
      assistantHadModelTurn = true;
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

// ── Gestionnaire de messages OpenAI Realtime ─────────────────────────────────
function assistantHandleOpenAIMessage(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  console.log('[OpenAI]', data.type, data);
  switch (data.type) {
    case 'response.audio.delta':       // beta (conservé pour compatibilité)
    case 'response.output_audio.delta': // GA
      assistantResetSilenceTimer();
      assistantHadModelTurn = true;
      assistantSpokeSinceTurn = false;
      assistantSetState('speaking');
      if (data.delta) assistantEnqueueAudio(data.delta);
      break;
    case 'response.done':
      assistantOpenAICommitted = false;
      assistantWaitPlaybackEnd(() => {
        if (assistantWs) {
          assistantSpokeSinceTurn = false;
          assistantCalib = [];
          assistantListenSince = performance.now();
          assistantSetState('listening');
        }
      });
      break;
    case 'input_audio_buffer.speech_started':
      assistantLastActivity = performance.now();
      if (assistantCard?.classList.contains('orb-speaking')) {
        assistantClearPlayback();
        if (assistantWs?.readyState === WebSocket.OPEN) assistantWs.send(JSON.stringify({ type: 'response.cancel' }));
        assistantSetState('listening');
      }
      break;
    case 'response.function_call_arguments.done': {
      assistantResetSilenceTimer();
      const { call_id: callId, name: fnName, arguments: fnArgsStr } = data;
      let fnArgs;
      try { fnArgs = JSON.parse(fnArgsStr || '{}'); } catch { fnArgs = {}; }
      assistantRunTool(fnName, fnArgs).then((response) => {
        if (assistantWs?.readyState === WebSocket.OPEN) {
          assistantWs.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(response) } }));
          assistantWs.send(JSON.stringify({ type: 'response.create' }));
        }
      });
      break;
    }
    case 'error':
      console.error('[Assistant] OpenAI Realtime erreur :', data.error?.message || JSON.stringify(data.error));
      break;
  }
}

// Modèle Live choisi via ListModels (2026-09-25) : `gemini-2.0-flash-live-001`
// codé en dur avait été retiré ("not found ... for bidiGenerateContent").
// Garde uniquement les modèles déclarant `bidiGenerateContent`. Ordre de choix
// (2026-09-25) : réglage `assistant_model` s'il existe dans la liste, puis
// ASSISTANT_MODEL_PREFERENCE, puis un score sans bonus "flash" (qui faisait
// retenir un aperçu remplacé, sans Google Search, au lieu de gemini-3.8-live).
// `gemini-2.5-flash-native-audio-latest` : celui qui fonctionnait sur le
// niveau gratuit avant ce classement ; repli si 3.8-live dépasse son quota.
const ASSISTANT_MODEL_PREFERENCE = ['gemini-3.8-live', 'gemini-2.5-flash-native-audio-latest', 'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-3.1-flash-live-preview'];
// Modèles Live qui refusent l'outil google_search.
const ASSISTANT_NO_GOOGLE_SEARCH = ['gemini-3.1-flash-live-preview'];
// Appels d'outils synchrones : le modèle attend la réponse avant de parler.
const assistantBlocking = (decls) => decls.map((d) => ({ ...d, behavior: 'BLOCKING' }));
let assistantLiveModel = null;
let assistantQuotaRetries = 0; // relances auto sur quota épuisé, remis à 0 à chaque clic
async function assistantPickLiveModel(apiKey) {
  if (assistantLiveModel) return assistantLiveModel;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `ListModels ${res.status}`);
  const live = (data?.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'));
  console.log('[Assistant] Modèles Live disponibles :', live.map((m) => m.name));
  if (!live.length) throw new Error('Aucun modèle compatible Live pour cette clé.');
  const bare = (m) => m.name.replace(/^models\//, '');
  const byBare = (id) => live.find((m) => bare(m) === id);

  const exhausted = await assistantExhaustedModels();
  const usable = (m) => m && !exhausted.includes(bare(m));
  if (exhausted.length) console.log('[Assistant] Quota épuisé aujourd\'hui (ignorés) :', exhausted);

  const forced = String((await window.matin.store.get('assistant_model')) || '').replace(/^models\//, '');
  if (forced && usable(byBare(forced))) {
    assistantLiveModel = byBare(forced).name;
    console.log('[Assistant] Choix du modèle : réglage assistant_model');
    return assistantLiveModel;
  }
  if (forced) console.warn(`[Assistant] assistant_model « ${forced} » absent de la liste ou quota épuisé, choix automatique.`);
  for (const id of ASSISTANT_MODEL_PREFERENCE) {
    if (usable(byBare(id))) {
      assistantLiveModel = byBare(id).name;
      console.log(`[Assistant] Choix du modèle : ordre de préférence (${id})`);
      return assistantLiveModel;
    }
  }
  // Repli : jamais les modèles Live spécialisés (transcription, traduction,
  // robotique), qui ne font pas de conversation.
  const candidates = live.filter((m) => usable(m) && !/transcribe|translate|robotics/i.test(m.name));
  if (!candidates.length) throw new Error('Quota épuisé sur tous les modèles Live disponibles aujourd\'hui.');
  const score = (n) => (/native-audio|live/i.test(n) ? 2 : 0) - (/preview|exp/i.test(n) ? 0.5 : 0);
  candidates.sort((a, b) => score(b.name) - score(a.name));
  assistantLiveModel = candidates[0].name;
  console.log('[Assistant] Choix du modèle : repli par score (aucun modèle préféré disponible)');
  return assistantLiveModel;
}

// Modèles au quota gratuit épuisé (2026-09-25) : mémorisés pour la journée
// (les quotas gratuits se renouvellent chaque jour), pour ne pas retenter à
// chaque session un modèle qui échouera. Remis à zéro au changement de date.
const ASSISTANT_EXHAUSTED_KEY = 'assistant_quota_exhausted';
const assistantToday = () => new Date().toISOString().slice(0, 10);
async function assistantExhaustedModels() {
  const saved = await window.matin.store.get(ASSISTANT_EXHAUSTED_KEY);
  return saved?.date === assistantToday() && Array.isArray(saved.models) ? saved.models : [];
}
async function assistantMarkExhausted(model) {
  const models = await assistantExhaustedModels();
  const id = model.replace(/^models\//, '');
  if (!models.includes(id)) models.push(id);
  await window.matin.store.set(ASSISTANT_EXHAUSTED_KEY, { date: assistantToday(), models });
}

async function assistantStartGeminiSession(apiKey) {
  assistantCurrentProvider = 'gemini';
  assistantCurrentSampleRateIn = ASSISTANT_SAMPLE_RATE_IN;
  assistantGeminiApiKey = apiKey;
  const lang = (await window.matin.store.get('assistant_lang')) || 'fr-FR';
  const voice = (await window.matin.store.get('assistant_voice')) || ''; // '' = voix par langue
  console.log('[Assistant] Voix Gemini :', voice || `${ASSISTANT_VOICE_MAP[lang] || 'Aoede'} (auto)`);
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
  const withGoogleSearch = !ASSISTANT_NO_GOOGLE_SEARCH.includes(model.replace(/^models\//, ''));
  if (!withGoogleSearch) console.log('[Assistant] Google Search désactivé : non géré par ce modèle.');
  const ws = new WebSocket(`${ASSISTANT_WS_BASE}?key=${encodeURIComponent(apiKey)}`);
  assistantWs = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      setup: {
        model,
        generation_config: {
          response_modalities: ['AUDIO'],
          speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voice || ASSISTANT_VOICE_MAP[lang] || 'Aoede' } } },
        },
        // Aperçu du dashboard injecté au démarrage de session (read_dashboard
        // permet ensuite de relire à jour un module précis).
        system_instruction: { parts: [{ text: `${ASSISTANT_SYSTEM_PROMPT}\n\nModules disponibles : ${assistantModuleList()}.\n\nContenu actuel du dashboard (aperçu) :\n${assistantDashboardSummary('', 350).slice(0, 6000)}` }] },
        tools: [
          ...(withGoogleSearch ? [{ google_search: {} }] : []),
          {
            // `behavior: 'BLOCKING'` ajouté à chaque déclaration juste après
            // (voir assistantBlocking) : sur gemini-3.8-live les appels sont
            // NON_BLOCKING par défaut.
            function_declarations: assistantBlocking([
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
                  properties: { command: { type: 'STRING', enum: ['TOGGLE_THEME', 'OPEN_SETTINGS', 'CLOSE_SETTINGS', 'REFRESH_ALL', 'REORGANIZE', 'UNDO_REORGANIZE'] } },
                  required: ['command'],
                },
              },
              {
                name: 'set_modules_enabled',
                description: 'Active et/ou désactive PLUSIEURS modules du dashboard en une seule fois (un seul rechargement). Listes de clés ou libellés.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    enable: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Modules à activer' },
                    disable: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Modules à désactiver' },
                  },
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
                description: 'Contrôle le lecteur audio actif (Spotify, Deezer, Chrome…) via Windows : play, pause, morceau suivant ou précédent.',
                parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['play', 'pause', 'next', 'previous'] } }, required: ['action'] },
              },
              {
                name: 'open_shortcut',
                description: 'Ouvre un raccourci du dashboard dans le navigateur : Gmail, Drive, YouTube, Agenda, Photos, Maps.',
                parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] },
              },
              {
                name: 'set_wallpaper',
                description: "Change le fond d'écran du dashboard. name = nom du fond (aurore boréale, plage, neige, pluie, matrix, étoilé, nébuleuse, lac et forêt, montagne, particules, papier, dégradé, givre, sapins…), « aucun », « aléatoire » ou « suivant ».",
                parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] },
              },
              {
                name: 'open_web_search',
                description: "Ouvre une recherche Internet dans Google Chrome via la barre de recherche du dashboard (moteur configuré par l'utilisateur). À utiliser quand l'utilisateur demande de faire/lancer/ouvrir une recherche, de chercher quelque chose sur Internet ou sur Google, ou d'ouvrir Chrome pour chercher.",
                parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Termes à rechercher, reformulés proprement' } }, required: ['query'] },
              },
              {
                name: 'show_note',
                description: "Affiche un texte écrit (recette, liste, résumé…) dans un bloc-notes à l'écran. Contenu complet en texte simple.",
                parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, content: { type: 'STRING' }, source: { type: 'INTEGER', description: 'Numéro [source n] du résultat web (optionnel)' } }, required: ['title', 'content'] },
              },
              {
                name: 'show_source',
                description: 'Ajoute un lien de source (icône internet) au dernier bloc-notes ou en crée un.',
                parameters: { type: 'OBJECT', properties: { source: { type: 'INTEGER', description: 'Numéro [source n] du résultat web' } }, required: ['source'] },
              },
            ]),
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
  ws.onclose = async (e) => {
    console.warn(`[Assistant] Session Gemini Live fermée (code ${e.code}) : ${e.reason || '(aucune raison fournie)'}`);
    if (assistantWs !== ws) return;
    // Quota dépassé : on écarte ce modèle pour la journée et on relance
    // aussitôt avec le suivant (limité : au plus une relance par modèle).
    const quota = /quota|exceeded|RESOURCE_EXHAUSTED|rate limit/i.test(e.reason || '');
    const sessionWasLive = assistantHadModelTurn;
    assistantDisconnect();
    assistantSetState('idle');
    if (quota && !sessionWasLive && assistantQuotaRetries < ASSISTANT_MODEL_PREFERENCE.length + 2) {
      assistantQuotaRetries++;
      await assistantMarkExhausted(model);
      assistantLiveModel = null;
      console.warn(`[Assistant] Quota épuisé sur ${model} : essai du modèle suivant…`);
      assistantStartGeminiSession(assistantGeminiApiKey);
    }
  };
}

// ── Session OpenAI Realtime ──────────────────────────────────────────────────
async function assistantStartOpenAISession(apiKey) {
  assistantCurrentProvider = 'openai';
  assistantCurrentSampleRateIn = ASSISTANT_OPENAI_SAMPLE_RATE;
  const lang   = (await window.matin.store.get('assistant_lang'))  || 'fr-FR';
  const voice  = (await window.matin.store.get('openai_voice'))    || 'alloy';
  const storedModel = (await window.matin.store.get('openai_model')) || '';
  // Migration : les noms sans date (ancienne beta) ne fonctionnent plus en GA.
  const MODEL_ALIASES = { 'gpt-4o-realtime-preview': 'gpt-4o-realtime-preview-2024-12-17', 'gpt-4o-mini-realtime-preview': 'gpt-4o-mini-realtime-preview-2024-12-17' };
  const model = MODEL_ALIASES[storedModel] || storedModel || 'gpt-4o-realtime-preview-2024-12-17';
  if (MODEL_ALIASES[storedModel]) window.matin.store.set('openai_model', model);
  assistantGain = Math.max(0.5, Math.min(6, Number(await window.matin.store.get('assistant_gain')) || 1));

  console.log(`[Assistant] OpenAI Realtime — modèle: ${model}, voix: ${voice}`);
  assistantSetState('thinking');

  const sysPrompt = `${ASSISTANT_SYSTEM_PROMPT}\n\nModules disponibles : ${assistantModuleList()}.\n\nContenu actuel du dashboard (aperçu) :\n${assistantDashboardSummary('', 350).slice(0, 6000)}`;

  // Déclarations d'outils partagées avec Gemini, converties au format OpenAI.
  // google_search est une capacité native Gemini uniquement — non incluse ici.
  const openaiTools = [
    { name: 'web_search', description: "Recherche sur internet (actualité, faits récents, météo, résultats, infos que tu ne connais pas). À utiliser dès qu'une question demande une information à jour.", parameters: { type: 'object', properties: { query: { type: 'string', description: 'Requête de recherche' } }, required: ['query'] } },
    { name: 'execute_dashboard_command', description: 'Exécute une commande simple sur le dashboard Matin', parameters: { type: 'object', properties: { command: { type: 'string', enum: ['TOGGLE_THEME', 'OPEN_SETTINGS', 'CLOSE_SETTINGS', 'REFRESH_ALL', 'REORGANIZE', 'UNDO_REORGANIZE'] } }, required: ['command'] } },
    { name: 'set_modules_enabled', description: 'Active et/ou désactive PLUSIEURS modules du dashboard en une seule fois.', parameters: { type: 'object', properties: { enable: { type: 'array', items: { type: 'string' }, description: 'Modules à activer' }, disable: { type: 'array', items: { type: 'string' }, description: 'Modules à désactiver' } } } },
    { name: 'read_dashboard', description: "Lit le contenu actuellement affiché par les modules du dashboard.", parameters: { type: 'object', properties: { module: { type: 'string', description: 'Clé ou nom du module (optionnel)' } } } },
    { name: 'set_module_enabled', description: 'Active ou désactive un module du dashboard.', parameters: { type: 'object', properties: { module: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['module', 'enabled'] } },
    { name: 'switch_profile', description: 'Bascule le dashboard sur le profil 1 ou 2.', parameters: { type: 'object', properties: { profile: { type: 'integer', description: '1 ou 2' } }, required: ['profile'] } },
    { name: 'control_lights', description: "Allume/éteint des lumières et règle la luminosité.", parameters: { type: 'object', properties: { on: { type: 'boolean' }, target: { type: 'string' }, brightness: { type: 'integer', description: '0-100' } } } },
    { name: 'control_shutters', description: "Commande les volets.", parameters: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'close'] }, position: { type: 'integer', description: '0-100' }, target: { type: 'string' } } } },
    { name: 'control_climate', description: 'Commande la climatisation.', parameters: { type: 'object', properties: { power: { type: 'boolean' }, mode: { type: 'string', enum: ['auto', 'cool', 'heat', 'dry', 'fan'] }, temperature: { type: 'number' }, target: { type: 'string' } } } },
    { name: 'control_music', description: 'Contrôle le lecteur audio actif.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'previous'] } }, required: ['action'] } },
    { name: 'open_shortcut', description: 'Ouvre un raccourci : Gmail, Drive, YouTube, Agenda, Photos, Maps.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'set_wallpaper', description: "Change le fond d'écran du dashboard.", parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'open_web_search', description: "Ouvre une recherche dans Google Chrome via la barre du dashboard.", parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'show_note', description: "Affiche un texte écrit dans un bloc-notes à l'écran.", parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, source: { type: 'integer', description: 'Numéro [source n] du résultat web (optionnel)' } }, required: ['title', 'content'] } },
    { name: 'show_source', description: 'Ajoute un lien de source au dernier bloc-notes.', parameters: { type: 'object', properties: { source: { type: 'integer' } }, required: ['source'] } },
  ].map((d) => ({ type: 'function', ...d }));

  const ws = new WebSocket(
    `${ASSISTANT_OPENAI_WS_BASE}?model=${encodeURIComponent(model)}`,
    ['realtime', `openai-insecure-api-key.${apiKey}`]
  );
  assistantWs = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: sysPrompt,
        tools: openaiTools,
        tool_choice: 'auto',
      },
    }));
    assistantSessionReady = true;
    assistantPlayListenSound();
    assistantStartMic().then((ok) => {
      if (ok) assistantSetState('listening');
      else { assistantDisconnect(); assistantSetState('idle'); }
    });
  };
  ws.onmessage = (event) => {
    if (event.data instanceof Blob) event.data.text().then((text) => assistantHandleOpenAIMessage({ data: text }));
    else assistantHandleOpenAIMessage(event);
  };
  ws.onerror = (e) => { console.error('[Assistant] Erreur WebSocket OpenAI Realtime :', e); };
  ws.onclose = (e) => {
    console.warn(`[Assistant] Session OpenAI Realtime fermée (code ${e.code}) : ${e.reason || '(aucune raison)'}`);
    if (assistantWs !== ws) return;
    assistantDisconnect();
    assistantSetState('idle');
  };
}

// ── Dispatcher : OpenAI si clé disponible, sinon Gemini ─────────────────────
async function assistantStartSession() {
  const openaiKey = (await window.matin.store.get('openai_api_key')) || '';
  if (openaiKey) return assistantStartOpenAISession(openaiKey);
  const geminiKey = (await window.matin.store.get('gemini_api_key')) || '';
  return assistantStartGeminiSession(geminiKey);
}

function assistantToggle() {
  if (assistantWs) { assistantDisconnect(); assistantSetState('idle'); }
  else { assistantQuotaRetries = 0; assistantStartSession(); }
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
    assistantEnsurePanel(card);
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
