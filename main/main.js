const { app, BrowserWindow, ipcMain, shell, nativeTheme, Notification, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client: TplinkClient } = require('tplink-smarthome-api'); // TP-Link Kasa (broadcast UDP/TCP local, voir ipcMain.handle('kasa:...'))
const { TradfriClient: TradfriGwClient, AccessoryTypes: TradfriAccessoryTypes } = require('node-tradfri-client'); // IKEA Trådfri (CoAP/DTLS local, voir ipcMain.handle('tradfri:...'))
const Store = require('electron-store');
const { runGoogleAuthFlow, refreshAccessToken } = require('./auth/google-oauth');
const { runSpotifyAuthFlow, refreshAccessToken: refreshSpotifyAccessToken } = require('./auth/spotify-oauth');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── Verrou mono-instance (2026-08-10, sur demande explicite — CORRECTIF
// RÉEL de la perte de données intermittente signalée plusieurs fois) ────────
// Plusieurs `electron.exe` tournant SIMULTANÉMENT contre le MÊME fichier
// electron-store se marchent dessus à chaque écriture : chacune garde sa
// PROPRE copie de `modules` en mémoire depuis son propre lancement, et la
// DERNIÈRE à écrire — même une instance ancienne avec des données
// périmées/vides — écrase silencieusement ce que l'autre venait d'enregistrer.
// Constaté en direct le 2026-08-10 : 6 processus electron.exe actifs
// simultanément, et une sauvegarde de lancement datée montrant
// ETF/Crypto/Prêts/Podcast tous VIDES, encadrée par 2 sauvegardes montrant
// les bonnes données — signature exacte d'une instance périmée ayant écrit
// par-dessus une instance à jour. AUCUN rapport avec `defaults` d'electron-
// store (déjà vérifié correctement scopé, voir backfillMissingModules
// plus bas) : c'est une vraie course entre processus, pas un souci de
// fusion de config.
//
// `requestSingleInstanceLock()` empêche catégoriquement une 2e instance de
// démarrer : `process.exit()` STOPPE l'exécution de CE script AVANT toute
// construction de Store plus bas (`app.quit()` seul ne suffit pas : il ne
// fait que PROGRAMMER la fermeture, sans interrompre le JS synchrone qui
// suit — le reste de ce fichier continuerait sinon à s'exécuter et à ouvrir
// sa propre copie du store avant que la fermeture ne prenne effet).
// L'instance déjà ouverte reprend simplement le focus (voir 'second-instance'
// ci-dessous, câblé une fois `mainWindow` créée plus bas dans ce fichier).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  // (2026-08-11) Une tentative de relance (Matin.bat, raccourci...) pendant
  // qu'une instance tourne déjà ne fait que refocaliser CETTE fenêtre, qui
  // peut avoir en mémoire un `modules` chargé il y a longtemps — sans ce
  // broadcast, l'utilisateur croit voir des données "perdues" alors qu'il
  // s'agit juste d'un affichage périmé d'une fenêtre jamais fermée ; on
  // renvoie donc l'état actuel du disque à chaque tentative de relance.
  mainWindow.webContents.send('modules:updated', getMergedModules());
});

// ─── Store de configuration ───────────────────────────────────────────────────
// DEFAULT_MODULES est gardé en constante séparée (pas juste inline dans
// `defaults` ci-dessous) pour pouvoir le réutiliser dans backfillMissingModules
// (voir plus bas) — electron-store applique `defaults` uniquement quand la clé
// TOP-LEVEL correspondante (ici `modules`) est entièrement absente du fichier
// existant ; il ne fusionne PAS en profondeur un nouveau module ajouté au code
// dans un objet `modules` déjà présent sur disque (constaté : le module Maps
// ajouté après coup restait invisible pour toute installation ayant déjà
// sauvegardé sa config au moins une fois, silencieusement — aucune erreur,
// juste absent de `store.get('modules')`).
const DEFAULT_MODULES = {
  weather:  { enabled: true,  position: 0, config: { city: 'Lyon', unit: 'celsius' } },
  france:   { enabled: true,  position: 1, config: {} },
  tech:     { enabled: true,  position: 9, config: {} },
  bourse:   { enabled: true,  position: 10, config: {} },
  calendar: { enabled: false, position: 2, config: {} },
  etf:      { enabled: true,  position: 3, config: { lines: [] } },
  gmail:    { enabled: false, position: 4, config: {} },
  ol:       { enabled: true,  position: 5, config: { team: 'Olympique Lyonnais' } },
  // FDJ scindé en 3 modules dashboard indépendants (2026-08-04, sur demande
  // explicite) — chacun activable/déplaçable/redimensionnable séparément.
  // Positions groupées juste après "ol" (5) et avant "crypto" (7), en
  // fractionnaire pour ne pas avoir à renuméroter les modules existants.
  fdjLoto:         { enabled: true, position: 6,   config: { grids: [], codes: [] } },
  fdjEuromillions: { enabled: true, position: 6.1, config: { grids: [], codes: [] } },
  fdjEurodreams:   { enabled: true, position: 6.2, config: { grids: [] } },
  crypto:   { enabled: false, position: 7, config: { lines: [] } },
  spotify:  { enabled: false, position: 11, config: {} },
  maps:     { enabled: true,  position: 8, config: {} },
  // 6 modules ajoutés en autonomie (2026-08-05, voir CONTEXT.md) —
  // enabled:true seulement pour ceux qui fonctionnent sans configuration
  // préalable (aucune clé/adresse/appairage à saisir), même convention que
  // les modules existants (ex. calendar/gmail/crypto désactivés par défaut
  // car ils exigent une action de config avant d'être utiles).
  airQuality: { enabled: true,  position: 8.1, config: {} },              // réutilise la ville de weather, rien à configurer
  fuelPrices: { enabled: false, position: 8.2, config: { city: '' } },    // ville/CP à saisir
  parcels:    { enabled: false, position: 8.3, config: { items: [] } },   // numéros de suivi à saisir (transporteur auto-détecté, aucune clé requise)
  cinema:     { enabled: true,  position: 8.4, config: {} },              // scraping direct AlloCiné, aucune clé requise (2026-08-05)
  steamPromos:{ enabled: true,  position: 8.5, config: {} },              // aucune config nécessaire
  epicPromos: { enabled: true,  position: 8.55, config: {} },             // aucune config nécessaire
  hue:        { enabled: false, position: 8.6, config: { bridgeIp: '', username: '' } }, // appairage manuel requis
  // TP-Link Kasa (2026-08-10, sur demande explicite) — AUCUN compte cloud ni
  // clé requis, contrairement à Hue/TaHoma : `enabled: false` par défaut quand
  // même, le temps que l'utilisateur lance une 1re découverte réseau (sinon
  // carte vide sans qu'aucune configuration ne soit possible avant coup, la
  // liste d'appareils elle-même vit dans `kasa.devices`, pas dans ce config).
  kasa:       { enabled: false, position: 8.66, config: { subnet: '' } },
  // IKEA Trådfri (2026-08-11, sur demande explicite) — CoAP/DTLS local comme
  // Kasa (aucun compte cloud), mais nécessite un appairage explicite (IP de
  // la passerelle + code de sécurité imprimé dessous) contrairement à Kasa :
  // `identity`/`psk` générés une seule fois par `tradfri:connect` puis
  // enregistrés ici (voir renderTradfriConfigSection dans config.js, même
  // mécanisme que `hue.username` — la persistance passe par l'Enregistrer
  // normal de Paramètres, PAS par le handler IPC lui-même), le code de
  // sécurité n'étant lui jamais stocké.
  tradfri:    { enabled: false, position: 8.68, config: { gatewayIp: '', identity: '', psk: '' } },
  // YouTube Notifications (2026-08-15, sur demande explicite) — `channels`
  // saisis par l'utilisateur en Paramètres → Services (résolution d'ID via
  // l'API Search, voir config.js renderYoutubeConfigSection), `lastCheckSlot`
  // écrit par le planificateur horaire fixe du module (voir youtube.js,
  // YT_FIXED_TIMES) pour ne jamais redéclencher 2 fois le même créneau.
  // VOLONTAIREMENT PAS dans USERDATA_MODULE_KEYS malgré une nature de donnée
  // "curée par l'utilisateur" comparable à Podcasts : `window.matin.store.
  // get/set` (chemin étroit générique, utilisé par youtube.js pour
  // lastCheckSlot/lastSeenVideoId) cible directement `store` (matin-config),
  // PAS la vue fusionnée — l'ajouter à USERDATA_MODULE_KEYS casserait donc
  // silencieusement ces écritures (elles atterriraient dans le mauvais
  // store). `modules:getAll`/`modules:update` restent inchangés (déjà basés
  // sur la vue fusionnée), donc la carte du dashboard fonctionne à
  // l'identique quel que soit le store choisi ici.
  youtube:    { enabled: false, position: 8.75, config: { channels: [], lastCheckSlot: '' } },
  reminders:  { enabled: false, position: 8.7, config: { items: [] } },                  // rappels à saisir
  // 4 modules ajoutés le 2026-08-06 (sur demande explicite) — voir CONTEXT.md
  // pour le détail des sources retenues (open.er-api.com, Google Tasks API,
  // flux RSS Science/Gaming).
  currency:    { enabled: true,  position: 12, config: {} },                             // aucune config : devises/montant en état local du module (comme maps.js)
  googleTasks: { enabled: false, position: 13, config: {} },                             // nécessite le compte Google déjà connecté (scope tasks)
  science:     { enabled: true,  position: 14, config: {} },
  gaming:      { enabled: true,  position: 15, config: {} },
  // 3 modules ajoutés le 2026-08-07 (sur demande explicite) — voir CONTEXT.md.
  sante:     { enabled: true,  position: 16, config: {} },
  // Nécessite le scope People API (contacts.readonly) ajouté ce même jour à
  // google-oauth.js — un compte DÉJÀ connecté avant cet ajout n'a PAS ce
  // scope sur son token existant (Google ne l'accorde qu'au moment du
  // consentement) : reconnexion manuelle nécessaire depuis Paramètres pour
  // que le module fonctionne, même schéma que l'ajout du scope Tasks le
  // 2026-08-06.
  birthdays: { enabled: false, position: 17, config: {} },
  // Défaut resserré à CAC 40 + S&P 500 le 2026-08-08 (sur demande explicite —
  // remplace l'ancien défaut "tous affichés", `selected: null`). Voir
  // migrateIndicesDefaultSelection ci-dessous pour les installations ayant
  // déjà persisté l'ancien défaut `null`.
  indices:   { enabled: true,  position: 18, config: { selected: ['^FCHI', '^GSPC'] } },
  // 2 modules ajoutés le 2026-08-08 (sur demande explicite).
  podcast: { enabled: true, position: 19, config: { feeds: [] } },
  // Clé API NASA (2026-08-24, sur demande explicite) — DEMO_KEY intégrée en
  // dur côté nasa.js, plus de champ `apiKey` à configurer : fonctionne
  // immédiatement, sans .env ni réglage dans Paramètres.
  nasa:    { enabled: true, position: 20, config: {} },
  // Alertes (2026-08-08, sur demande explicite) — PAS un module carte comme
  // les autres (voir dashboard.js, contourne délibérément MODULE_REGISTRY/
  // createModuleCard) : un bandeau plein écran au-dessus de tout, visible
  // seulement s'il y a au moins une alerte active. `department` vide = la
  // vigilance météo (seule source dépendant d'un département) reste
  // silencieuse tant qu'il n'est pas renseigné dans Paramètres.
  alerts: {
    enabled: true,
    position: 21,
    config: {
      department: '',
      types: { enlevement: true, meteo: true, vigipirate: true, rappels: true },
    },
  },
  // Prêts immobiliers (2026-08-08, sur demande explicite) — instances
  // multiples comme "ol" (Sports), voir dashboard.js/config.js (isPretsKey) :
  // un groupe de prêts = une instance = une carte. `enabled: false` par
  // défaut (comme les autres modules nécessitant une saisie avant d'être
  // utiles, ex. Colis/Rappels) — rien à afficher tant qu'aucun prêt n'est
  // configuré.
  prets: { enabled: false, position: 22, config: { name: '', loans: [] } },
  // LIVE! — scores en direct football, club ou championnat (2026-08-11, sur
  // demande explicite, 2e révision le même jour — remplace la version 1
  // multi-sports par un ciblage club/championnat, voir renderer/modules/
  // live.js). `enabled: false` par défaut, même convention que Carburants/
  // Colis/Prêts : le mode par défaut ('club') n'affiche rien tant qu'un club
  // n'est pas saisi, contrairement à Cinéma/Promos qui fonctionnent sans
  // aucune saisie préalable.
  live: {
    enabled: false,
    position: 23,
    config: { club: '', championship: 'ligue1', mode: 'club' },
  },
  // Mon Équipe (2026-08-15, sur demande explicite) — suivi 100% MANUEL d'une
  // équipe (calendrier + résultats saisis à la main), contrairement à "ol"
  // qui interroge TheSportsDB/RSS automatiquement. Pensé pour un club sans
  // couverture par ces sources externes (ex. clubs amateurs/régionaux — voir
  // "USAM Francheleins Basket" dans l'exemple de la demande). `upcoming`/
  // `results` : jusqu'à 20 entrées chacun (voir MON_EQUIPE_MAX_MATCHES,
  // renderer/config.js). Aucun réseau, aucune clé API — juste du texte
  // structuré affiché tel quel côté dashboard (voir renderer/modules/
  // mon-equipe.js).
  monEquipe: {
    enabled: false,
    position: 24,
    config: { teamName: '', sport: 'football', upcoming: [], results: [] },
  },
};

const store = new Store({
  name: 'matin-config',
  // `cwd` explicite (2026-08-11, sur demande explicite, re-rapport du même
  // symptôme déjà diagnostiqué et corrigé le 2026-08-11 plus tôt — voir
  // l'entrée CONTEXT.md "Diagnostic ETF/Crypto perdus via Matin.bat") : SANS
  // effet réel, electron-store retombe déjà sur `app.getPath('userData')`
  // par défaut en l'absence de `cwd` (vérifié : ni `store` ni `userdataStore`
  // n'en passaient un, et les 2 lancements réels comparés — `npm run dev`
  // depuis le dossier projet, `Matin.bat` depuis un autre dossier — donnaient
  // EXACTEMENT le même chemin loggé). Ajouté ici uniquement pour rendre
  // l'intention explicite dans le code plutôt que de reposer sur un défaut
  // implicite de la librairie, sans rien changer au comportement réel.
  cwd: app.getPath('userData'),
  defaults: {
    modules: DEFAULT_MODULES,
    google: {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      email: null,
    },
    spotify: {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      email: null,
      displayName: null,
    },
    // IDs des alertes déjà notifiées (voir checkAlerts) — namespace dédié,
    // séparé de `modules.alerts.config` qui ne doit contenir QUE des réglages
    // utilisateur (département, types activés), jamais un cache interne.
    alertsCache: {
      knownIds: [],
    },
    app: {
      theme: 'dark',
      language: 'fr',
      startOnBoot: false,
      windowBounds: { width: 1400, height: 900 },
      firstName: '',
      // Mode auto luminosité (2026-08-08, sur demande explicite) — voir
      // dashboard.js pour la logique d'assombrissement par tranche horaire.
      autoBrightness: false,
      // Fond personnalisé du dashboard (2026-08-11, sur demande explicite) —
      // voir app:setBackground plus bas. `undefined` sur une installation
      // existante (defaults ne comble pas un champ manquant dans un objet
      // `app` déjà présent sur disque, même limite que les autres champs de
      // ce bloc) est traité comme 'none' côté renderer (dashboard.js).
      background: 'none',
      // Mode d'affichage (2026-08-23, sur demande explicite — voir
      // "🎨 Personnaliser" → section "Mode d'affichage") — même limite
      // d'`defaults` que `background` ci-dessus sur une installation
      // existante : chaque lecture retombe sur ces mêmes valeurs via `|| ...`
      // plutôt que de compter sur ce bloc pour les combler. Voir
      // applyDisplayMode/createSunWindow/enterSidebarMode plus bas.
      displayMode: 'fullscreen',
      floatingSunPosition: null,
      sidebarEdge: 'right',
    }
  }
});

// ─── Store SÉPARÉ pour les données utilisateur (2026-08-10, sur demande
// explicite, 2e révision suite à la découverte de la vraie cause — voir le
// verrou mono-instance plus haut) ───────────────────────────────────────────
// `matin-config` (ci-dessus) reste le SEUL store à accepter des `defaults`
// electron-store — réglages d'app, activé/désactivé, position des cartes.
// `matin-userdata` ci-dessous n'a AUCUN `defaults` et n'est JAMAIS écrit par
// backfillMissingModules/une quelconque migration de VALEUR PAR DÉFAUT : ETF,
// Crypto, Prêts, les 3 modules FDJ et Podcasts (voir USERDATA_MODULE_KEYS)
// y vivent, jamais dans matin-config. Séparation par CLÉ DE MODULE ENTIÈRE
// (enabled+position+config ensemble, jamais un champ isolé) plutôt qu'un
// éclatement champ par champ : chaque module reste un tout atomique à lire/
// écrire, seul le store de destination change selon sa clé — voir
// getMergedModules/setMergedModules ci-dessous, seul point d'accès à
// `modules` pour le reste de ce fichier (IPC modules:*, checkReminders...).
//
// NOTE IMPORTANTE : cette séparation est une protection SUPPLÉMENTAIRE, pas
// LE correctif du bug réellement observé (voir le verrou mono-instance
// ci-dessus, qui élimine la VRAIE cause — plusieurs processus electron.exe
// concurrents). Elle répond à la demande explicite de l'utilisateur et rend
// structurellement impossible qu'un futur bug de merge de defaults touche ces
// clés, mais n'aurait pas, à elle seule, empêché l'incident constaté (une
// course entre 2 PROCESSUS, pas un souci de fusion de valeurs par défaut).
const USERDATA_MODULE_KEYS = new Set(['etf', 'crypto', 'prets', 'fdjLoto', 'fdjEuromillions', 'fdjEurodreams', 'podcast', 'reminders']);

const userdataStore = new Store({ name: 'matin-userdata', cwd: app.getPath('userData'), defaults: {} });

// Log de diagnostic demandé explicitement (2026-08-11, suite au rapport
// "ETF/Crypto perdus via Matin.bat mais visibles via npm run dev") — confirme
// à l'écran, à CHAQUE lancement (peu importe la méthode), que les 2 stores
// résolvent bien sous app.getPath('userData') et non un chemin relatif au
// dossier de travail courant (ni `store` ni `userdataStore` ci-dessus ne
// passent d'option `cwd` : electron-store retombe alors sur userData par
// défaut — ce log vérifie que c'est bien le cas en pratique, pas seulement en théorie).
console.log('[Matin] process.cwd() =', process.cwd());
console.log('[Matin] app.getPath("userData") =', app.getPath('userData'));
console.log('[Matin] Store location (matin-config):', store.path);
console.log('[Matin] Store location (matin-userdata):', userdataStore.path);

// Fusionne les 2 stores en UN SEUL objet `modules`, pour que tout le reste de
// ce fichier (IPC modules:*, checkReminders, etc.) continue de manipuler
// `modules` comme un objet unique, exactement comme avant cette scission —
// AUCUN changement côté renderer (dashboard.js/config.js voient toujours un
// seul `modules` via modules:getAll).
function getMergedModules() {
  return { ...(store.get('modules') || {}), ...(userdataStore.get('modules') || {}) };
}

// Répartit un objet `modules` reçu (ex. du renderer via modules:update) entre
// les 2 stores selon USERDATA_MODULE_KEYS, puis écrit chacun dans SON store —
// jamais un mélange, jamais une clé userdata qui finit dans matin-config ou
// l'inverse.
function setMergedModules(modules) {
  const configPart = {};
  const userdataPart = {};
  for (const [key, val] of Object.entries(modules)) {
    if (USERDATA_MODULE_KEYS.has(key)) userdataPart[key] = val;
    else configPart[key] = val;
  }
  safeStoreSet('modules', configPart);
  userdataStore.set('modules', userdataPart);
  scheduleDriveUploadAfterChange(); // voir Sync Google Drive plus bas — point 3 de la demande, upload silencieux différé
}

// ─── Sauvegarde de secours avant chaque écriture ───────────────────────────────
// Ajoutée le 2026-08-08 suite à un signalement "lignes de portefeuille ETF
// disparues" — enquête faite ce jour-là : les données étaient en fait
// INTACTES sur disque (`modules.etf.config.lines`, 8 lignes) et le module les
// affichait correctement (vérifié en direct, DOM + logs), fausse alerte très
// probablement due au mode confidentialité (🔒, floute les montants) combiné
// aux groupes ETF repliés par défaut à chaque rendu (aucune ligne détaillée
// visible tant qu'on n'a pas cliqué sur le groupe). Mais l'enquête a révélé un
// VRAI risque structurel distinct (voir le correctif juste en dessous sur
// modules:update/updateLayout) : ce filet de sécurité est un second niveau de
// protection, indépendant de ce correctif, pour tout futur bug d'écriture non
// anticipé.
//
// Un seul fichier, écrasé à chaque écriture (pas un historique) : contient
// TOUJOURS l'état du store juste AVANT la dernière modification — suffisant
// pour annuler manuellement une écriture qui viendrait de mal tourner (copier
// backupPath par-dessus le fichier principal, store fermé), sans la
// complexité d'une rotation de plusieurs versions non demandée. Écriture
// SYNCHRONE (fs.writeFileSync) : ces sauvegardes sont rares (une par
// store.set, jamais en boucle chaude) et doivent être garanties terminées
// avant l'écriture réelle qui suit.
const STORE_BACKUP_PATH = path.join(app.getPath('userData'), 'matin-config.backup.json');
// Format `{ config, userdata }` depuis la scission matin-config/matin-userdata
// (2026-08-10, voir plus haut) — les 2 stores ensemble, jamais un mélange
// à plat. Les anciennes sauvegardes (avant cette scission) sont au format
// PLAT (le contenu de matin-config directement, sans clé `config`/`userdata`)
// — voir backups:restore, seul endroit qui doit encore comprendre l'ancien
// format pour rester restaurable.
function backupStoreBeforeWrite() {
  try {
    fs.writeFileSync(STORE_BACKUP_PATH, JSON.stringify({ config: store.store, userdata: userdataStore.store }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Matin] Échec de la sauvegarde de secours du store', err);
  }
}

// Remplace TOUT `store.set(...)` de ce fichier (voir plus bas) — sauvegarde
// l'état actuel avant d'écrire le nouveau, puis délègue à `store.set` normal.
function safeStoreSet(key, value) {
  backupStoreBeforeWrite();
  store.set(key, value);
}

// ─── Sauvegardes datées, un instantané par LANCEMENT (2026-08-10, sur
// demande explicite, distinct de backupStoreBeforeWrite ci-dessus) ─────────
// backupStoreBeforeWrite ne garde qu'UN SEUL fichier, toujours écrasé (l'état
// juste avant la DERNIÈRE écriture) — utile pour annuler un souci immédiat,
// mais sans aucun historique au-delà. Ici : un fichier horodaté distinct à
// CHAQUE démarrage de l'app, conservant les 7 derniers, pour pouvoir revenir
// à un état antérieur même après plusieurs lancements/sessions. Appelé tout
// en haut, juste après la construction de `store` et AVANT migrateFdjModule/
// backfillMissingModules (voir plus bas) : capture l'état RÉEL tel que
// l'utilisateur l'a laissé au lancement précédent, avant toute migration
// éventuelle de cette session.
const LAUNCH_BACKUPS_DIR = path.join(app.getPath('userData'), 'backups');
const MAX_LAUNCH_BACKUPS = 7;

function launchBackupTimestamp(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
}

function pruneLaunchBackups() {
  try {
    const files = fs.readdirSync(LAUNCH_BACKUPS_DIR)
      .filter(f => /^backup-.*\.json$/.test(f))
      .map(f => ({ name: f, mtimeMs: fs.statSync(path.join(LAUNCH_BACKUPS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const extra of files.slice(MAX_LAUNCH_BACKUPS)) {
      fs.unlinkSync(path.join(LAUNCH_BACKUPS_DIR, extra.name));
    }
  } catch (err) {
    console.error('[Matin] Échec du nettoyage des sauvegardes de lancement', err);
  }
}

// Format `{ config, userdata }`, comme backupStoreBeforeWrite ci-dessus —
// capture les 2 stores. Appelée AVANT migrateUserdataToSeparateStore (voir
// plus bas) : la toute première sauvegarde datée après cette mise à jour peut
// donc encore avoir `userdata` vide et tout dans `config` (ancien format
// pré-scission) — sans conséquence, backups:restore gère les 2 cas.
function writeLaunchBackup() {
  try {
    fs.mkdirSync(LAUNCH_BACKUPS_DIR, { recursive: true });
    const file = path.join(LAUNCH_BACKUPS_DIR, `backup-${launchBackupTimestamp(new Date())}.json`);
    fs.writeFileSync(file, JSON.stringify({ config: store.store, userdata: userdataStore.store }, null, 2), 'utf-8');
    pruneLaunchBackups();
  } catch (err) {
    console.error('[Matin] Échec de la sauvegarde de lancement', err);
  }
}
writeLaunchBackup();

// Liste les sauvegardes de lancement disponibles pour le bouton "Restaurer
// une sauvegarde" de Paramètres (voir renderer/config.js) — la plus récente
// en premier.
function listLaunchBackups() {
  try {
    return fs.readdirSync(LAUNCH_BACKUPS_DIR)
      .filter(f => /^backup-.*\.json$/.test(f))
      .map(f => ({ file: f, mtimeMs: fs.statSync(path.join(LAUNCH_BACKUPS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

// Comble dans le fichier PERSISTÉ toute clé de DEFAULT_MODULES absente de
// `modules` — nécessaire précisément parce qu'electron-store ne le fait pas
// tout seul (voir commentaire ci-dessus). Écrit immédiatement sur disque
// (store.set, pas juste une copie en mémoire) pour que le correctif survive
// à la prochaine sauvegarde silencieuse d'une disposition (modules:updateLayout,
// qui réécrit tout l'objet `modules` tel qu'il l'a reçu).
// Migration ponctuelle : l'ancien module FDJ unique (config imbriquée par jeu,
// `modules.fdj.config.{loto,euromillions,eurodreams}`) devient 3 modules
// indépendants. Sans ce transfert explicite, les grilles/codes déjà
// enregistrés sous l'ancienne clé "fdj" seraient perdus silencieusement au
// premier lancement après la mise à jour — `backfillMissingModules`
// ci-dessous ne fait que COMBLER des clés absentes, il ne migre pas le
// contenu d'une clé existante vers de nouvelles clés. Idempotent (guards
// `if (!current.fdjXxx)`) : sans effet si déjà exécutée une fois.
function migrateFdjModule() {
  const current = store.get('modules') || {};
  const old = current.fdj;
  if (!old) return;

  const basePosition = typeof old.position === 'number' ? old.position : 6;
  if (!current.fdjLoto) {
    current.fdjLoto = { enabled: !!old.enabled, position: basePosition, config: old.config?.loto || { grids: [], codes: [] } };
  }
  if (!current.fdjEuromillions) {
    current.fdjEuromillions = { enabled: !!old.enabled, position: basePosition + 0.1, config: old.config?.euromillions || { grids: [], codes: [] } };
  }
  if (!current.fdjEurodreams) {
    current.fdjEurodreams = { enabled: !!old.enabled, position: basePosition + 0.2, config: old.config?.eurodreams || { grids: [] } };
  }
  delete current.fdj;
  safeStoreSet('modules', current);
}
migrateFdjModule();

// Migration UNIQUE vers matin-userdata (2026-08-10, voir la scission
// matin-config/matin-userdata plus haut) — sur une installation existante,
// TOUT vivait jusqu'ici dans matin-config (y compris ETF/Crypto/Prêts/FDJ/
// Podcasts). Déplace chaque clé de USERDATA_MODULE_KEYS encore présente dans
// matin-config vers matin-userdata, PUIS la retire de matin-config — jamais
// l'inverse, jamais une copie qui laisserait la donnée dans LES DEUX stores
// (source de confusion sur laquelle fait foi). Lancée APRÈS migrateFdjModule
// (pour que fdjLoto/fdjEuromillions/fdjEurodreams existent déjà si une
// migration FDJ vient d'avoir lieu) et AVANT backfillMissingModules (pour
// qu'un module encore absent des 2 stores soit comblé au bon endroit du 1er
// coup). Idempotente : `store.has()` garde toute clé déjà migrée (ou jamais
// présente) intouchée.
function migrateUserdataToSeparateStore() {
  for (const key of USERDATA_MODULE_KEYS) {
    if (!store.has(`modules.${key}`)) continue;
    if (!userdataStore.has(`modules.${key}`)) {
      userdataStore.set(`modules.${key}`, store.get(`modules.${key}`));
    }
    store.delete(`modules.${key}`);
  }
}
migrateUserdataToSeparateStore();

// DURCI le 2026-08-10 (sur demande explicite, suite à une inquiétude de perte
// de données — enquête faite ce jour-là : AUCUNE perte réelle constatée sur
// cette machine, matin-config.json et matin-config.backup.json identiques au
// caractère près, ETF/Crypto/Prêts/Podcast/FDJ tous intacts ; voir
// CONTEXT.md). Réécrit avec `store.has()` (au lieu d'une vérification manuelle
// `key in current`) — fonctionnellement identique, mais AUCUNE ambiguïté
// possible : `store.has('modules.<clé>')` interroge l'état RÉEL persisté par
// electron-store lui-même, pas une copie locale qu'un futur refactor pourrait
// faire diverger par erreur. INVARIANT À NE JAMAIS CASSER : cette fonction ne
// doit QUE combler des clés de module ABSENTES — jamais fusionner ni
// réécrire le `config` d'une clé déjà présente (lines/grids/loans/feeds/items
// saisis par l'utilisateur ne doivent JAMAIS être touchés ici). Si un jour ce
// besoin change (ex. ajouter un champ à un module existant), ça doit passer
// par une fonction de MIGRATION dédiée et nommée comme telle (voir
// migrateFdjModule/migrateIndicesDefaultSelection ci-dessus), jamais ici.
// Route chaque clé DEFAULT_MODULES vers SON store (2026-08-10, voir la
// scission matin-config/matin-userdata plus haut) — une clé userdata absente
// de matin-userdata (ex. toute nouvelle installation) y reçoit son défaut
// (portefeuille vide, etc.), jamais dans matin-config ; toutes les autres
// clés restent comblées dans matin-config comme avant. `store.has()`/
// `userdataStore.has()` interrogent chacun LEUR store réel — jamais de
// confusion entre les 2.
function backfillMissingModules() {
  // Un seul backup + une seule écriture PAR STORE pour TOUTES les clés
  // manquantes (plutôt qu'un .set() par clé dans la boucle) : reste
  // atomique, comme avant ce durcissement.
  const configCurrent = store.get('modules') || {};
  const userdataCurrent = userdataStore.get('modules') || {};
  let configChanged = false;
  let userdataChanged = false;

  for (const [key, def] of Object.entries(DEFAULT_MODULES)) {
    if (USERDATA_MODULE_KEYS.has(key)) {
      if (!userdataStore.has(`modules.${key}`)) {
        userdataCurrent[key] = def;
        userdataChanged = true;
      }
    } else if (!store.has(`modules.${key}`)) {
      configCurrent[key] = def;
      configChanged = true;
    }
  }
  if (configChanged) safeStoreSet('modules', configCurrent);
  if (userdataChanged) userdataStore.set('modules', userdataCurrent);
}
backfillMissingModules();

// ─── Validation au lancement : auto-restauration si matin-userdata semble
// VIDE (2026-08-10, sur demande explicite) ──────────────────────────────────
// "Vide" = aucune des clés USERDATA_MODULE_KEYS n'a de contenu RÉEL (au moins
// 1 élément dans lines/grids/loans/feeds/items) — pas juste "la clé existe"
// (backfillMissingModules ci-dessus vient justement d'y créer des tableaux
// vides par défaut pour toute installation neuve, ce qui est normal et ne
// doit PAS déclencher une restauration). Ne se déclenche que s'il existe une
// sauvegarde de MOINS DE 24H qui, elle, contient des données — sur un tout
// premier lancement légitime (aucune sauvegarde existante), rien ne se passe.
function isUserdataEmpty() {
  const modules = userdataStore.get('modules') || {};
  for (const key of USERDATA_MODULE_KEYS) {
    const cfg = modules[key]?.config;
    if (!cfg) continue;
    const arr = cfg.lines || cfg.grids || cfg.loans || cfg.feeds || cfg.items;
    if (Array.isArray(arr) && arr.length > 0) return false;
  }
  return true;
}

// Une sauvegarde peut être dans l'un des 3 formats rencontrés par cette app
// (voir backups:restore) : nouveau `{config,userdata}` déjà migré, nouveau
// `{config,userdata}` mais PAS ENCORE migré (userdata.modules vide, tout
// encore dans config.modules — le cas de la toute 1re sauvegarde écrite après
// cette mise à jour, AVANT que migrateUserdataToSeparateStore n'ait tourné),
// ou ancien format à plat (modules directement, avant la scission). Cette
// fonction cherche les clés userdata dans les 3 emplacements possibles,
// userdata.modules prioritaire s'il contient quelque chose.
function extractUserdataModulesFromBackup(backupJson) {
  const fromUserdata = backupJson.userdata?.modules || {};
  const fromConfig = backupJson.config?.modules || backupJson.modules || {};
  const result = {};
  for (const key of USERDATA_MODULE_KEYS) {
    const val = fromUserdata[key] || fromConfig[key];
    if (val) result[key] = val;
  }
  return result;
}

function backupHasUserdata(backupJson) {
  const modules = extractUserdataModulesFromBackup(backupJson);
  for (const key of USERDATA_MODULE_KEYS) {
    const cfg = modules[key]?.config;
    if (!cfg) continue;
    const arr = cfg.lines || cfg.grids || cfg.loans || cfg.feeds || cfg.items;
    if (Array.isArray(arr) && arr.length > 0) return true;
  }
  return false;
}

const AUTO_RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Lu par le renderer une fois (voir IPC app:getAutoRestoreNotice) pour
// afficher une notice au premier rendu du dashboard, en plus de la
// notification native ci-dessous.
let autoRestoreNotice = null;

function autoRestoreUserdataIfEmpty() {
  try {
    if (!isUserdataEmpty()) return;
    const backups = listLaunchBackups(); // déjà trié, plus récent d'abord
    if (!backups.length) return; // rien à restaurer — 1er lancement légitime

    const now = Date.now();
    for (const b of backups) {
      if (now - b.mtimeMs > AUTO_RESTORE_MAX_AGE_MS) break; // trié desc : rien d'assez récent après ce point
      let data;
      try {
        data = JSON.parse(fs.readFileSync(path.join(LAUNCH_BACKUPS_DIR, b.file), 'utf-8'));
      } catch {
        continue; // sauvegarde illisible/corrompue — essaie la précédente
      }
      if (!backupHasUserdata(data)) continue; // cette sauvegarde-là est vide aussi, essaie la précédente

      backupStoreBeforeWrite();
      userdataStore.set('modules', extractUserdataModulesFromBackup(data));
      autoRestoreNotice = { file: b.file, mtimeMs: b.mtimeMs };
      console.warn(`[Matin] matin-userdata semblait vide au lancement — restauration automatique depuis ${b.file}`);
      if (Notification.isSupported()) {
        try {
          new Notification({
            title: 'Matin — Restauration automatique',
            body: `Vos données (ETF, Crypto, Prêts...) semblaient vides au lancement : restaurées depuis la sauvegarde du ${new Date(b.mtimeMs).toLocaleString('fr-FR')}.`,
          }).show();
        } catch (err) {
          console.error('[Matin] Échec notification de restauration automatique', err);
        }
      }
      return;
    }
  } catch (err) {
    console.error('[Matin] Échec de la restauration automatique', err);
  }
}
autoRestoreUserdataIfEmpty();

// BUG CORRIGÉ LE 2026-08-08 — le module Indices était introuvable dans
// Paramètres (jamais ajouté à TAB_MODULE_ORDER.finance côté config.js lors de
// son ajout le 2026-08-07, voir CONTEXT.md), donc son défaut d'origine
// (`selected: null`, "tous affichés") n'a jamais pu être changé par
// l'utilisateur — resserré à CAC 40 + S&P 500 dans DEFAULT_MODULES ci-dessus,
// mais ça ne change QUE le défaut pour une toute nouvelle installation
// (`backfillMissingModules` ne comble que des clés de module ABSENTES, jamais
// un champ à l'intérieur d'un module déjà persisté). Cette installation a
// déjà `modules.indices.config.selected = null` sur disque : sans ce
// correctif ponctuel, le nouveau défaut resterait invisible ici. `null` ne
// peut être QUE l'état jamais-touché (le sélecteur de Paramètres écrit
// toujours un tableau, jamais `null`, une fois utilisé) — migration donc sans
// risque d'écraser un vrai choix utilisateur. Idempotente (guard sur
// `selected == null`).
function migrateIndicesDefaultSelection() {
  const current = store.get('modules') || {};
  if (current.indices && current.indices.config && current.indices.config.selected == null) {
    current.indices.config.selected = ['^FCHI', '^GSPC'];
    safeStoreSet('modules', current);
  }
}
migrateIndicesDefaultSelection();

// Module TaHoma retiré du projet le 2026-08-10 (sur demande explicite) — plus
// aucune entrée dans DEFAULT_MODULES/MODULE_REGISTRY/MODULE_META. `dashboard.
// js`/`config.js` ignorent déjà gracieusement une clé de module sans meta
// connue (juste absente de l'écran, aucun crash — vérifié dans les 2
// fichiers), mais la clé `modules.tahoma` restait persistée sur disque sur
// cette installation qui l'avait activée (constaté : `enabled: true`),
// invisible partout mais toujours là. Purgée pour de bon plutôt que laissée
// à traîner sans plus aucun code pour la lire — idempotente (`current.tahoma`
// absent après la 1re exécution sur une installation donnée).
function removeStaleTahomaModule() {
  const current = store.get('modules') || {};
  if (current.tahoma) {
    delete current.tahoma;
    safeStoreSet('modules', current);
  }
}
removeStaleTahomaModule();

// ─── Thème clair/sombre (2026-08-08, sur demande explicite) ────────────────
// `app.theme` ('dark'|'light') pilote 3 couches distinctes qui doivent rester
// synchronisées : (1) les variables CSS de style.css, appliquées côté
// renderer via `document.documentElement.dataset.colorScheme` (voir
// index.html/config.html/dashboard.js/config.js) ; (2) `backgroundColor` de
// chaque `BrowserWindow` (évite un flash de la mauvaise couleur avant que le
// CSS ait fini de charger) ; (3) `titleBarOverlay` — la bande de contrôles
// natifs Windows (minimize/maximize/close) est un calque composé par l'OS,
// PAS par le CSS de la page (déjà documenté ailleurs dans ce fichier pour
// l'overlay de démarrage) : sa couleur doit être mise à jour explicitement
// via `BrowserWindow.setTitleBarOverlay()`, elle ne suit jamais le CSS toute
// seule. Couleurs alignées sur --bg-base/--text-primary de style.css pour
// que cette bande reste visuellement invisible (même couleur que le contenu
// juste en dessous), exactement le principe déjà retenu pour corriger le bug
// de "seam" documenté plus haut sur l'overlay de lever de soleil.
function titleBarColorsForTheme(theme) {
  return theme === 'light'
    ? { color: '#f5f5f0', symbolColor: '#1a1a2e' }
    : { color: '#0f1117', symbolColor: '#ffffff' };
}

// Fenêtre Paramètres AUPARAVANT figée en thème clair en dur (2026-08-06) —
// suit désormais `app.theme` comme le dashboard, sur demande explicite du
// 2026-08-08 (voir config.html : l'ancien `:root` clair permanent a été
// retiré, remplacé par le même mécanisme `[data-color-scheme]` partagé via
// style.css).

// ─── Fenêtre principale ───────────────────────────────────────────────────────
let mainWindow;
let configWindow;

// ─── Modes d'affichage — Icône flottante / Volet latéral (2026-08-23, sur
// demande explicite, voir "🎨 Personnaliser" → section "Mode d'affichage")
// ────────────────────────────────────────────────────────────────────────────
// `sunWindow` : 2e BrowserWindow, minuscule/sans cadre/transparente, utilisée
// UNIQUEMENT en mode "floating" (voir showSunWindow) — n'existe pas tant que
// ce mode n'a jamais été activé, recréée à la demande plutôt que gardée
// cachée en permanence.
let sunWindow = null;
let currentDisplayMode = 'fullscreen';
// Bornes de `mainWindow` sauvegardées juste avant d'entrer en mode "sidebar"
// (voir enterSidebarMode/exitSidebarMode) — permet de les restaurer telles
// quelles à la sortie, sans dépendre de `app.windowBounds` qui continue par
// ailleurs de suivre le dernier redimensionnement "normal" de la fenêtre.
let preSidebarBounds = null;
const SIDEBAR_STRIP_WIDTH = 20; // 12px→20px (2026-08-23, sur demande explicite — trop étroit pour viser correctement)
const SUN_WINDOW_SIZE = 60;
const sidebarState = {
  edge: 'right',
  pinned: false,
  expanded: false,
  collapseTimer: null,
  animTimer: null,
};

function createMainWindow() {
  const bounds = store.get('app.windowBounds');
  const theme = store.get('app.theme') || 'dark';
  const { color, symbolColor } = titleBarColorsForTheme(theme);

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: color,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color,
      symbolColor,
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../renderer/assets/icons/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Mode d'affichage restauré tout de suite, AVANT le premier `show()`
  // (2026-08-23) — pose déjà les bornes "sidebar" collapsées ou masque le
  // dashboard (mode "floating") avant que showOnce ci-dessous ne rende quoi
  // que ce soit visible, pour éviter un flash de la fenêtre pleine taille au
  // lancement. Voir applyDisplayMode plus bas.
  applyDisplayMode(store.get('app.displayMode') || 'fullscreen');

  // Filet de sécurité : 'ready-to-show' ne se déclenche pas de façon fiable
  // dans certains environnements (observé sans crash ni erreur associée) —
  // on force l'affichage après un court délai si l'événement n'est jamais
  // arrivé, pour ne jamais laisser la fenêtre invisible indéfiniment.
  // `currentDisplayMode` lu au moment du show (pas figé à l'appel) : en mode
  // "floating" c'est le soleil flottant qui doit apparaître à sa place, pas
  // le dashboard (voir applyDisplayMode/showSunWindow).
  let shown = false;
  const showOnce = () => {
    if (shown) return;
    shown = true;
    if (currentDisplayMode !== 'floating') mainWindow.show();
  };
  mainWindow.once('ready-to-show', showOnce);
  setTimeout(showOnce, 2000);

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error('[Matin] did-fail-load', errorCode, errorDescription);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Matin] render-process-gone', details);
  });

  mainWindow.on('resize', () => {
    // Ignoré en mode "sidebar" (2026-08-23) : enterSidebarMode redimensionne
    // la fenêtre à la hauteur pleine de l'écran pour le volet — sans cette
    // garde, cette taille "sidebar" écraserait app.windowBounds (la taille
    // "normale" restaurée en mode plein écran, voir preSidebarBounds/
    // exitSidebarMode) au lieu de la préserver.
    if (currentDisplayMode === 'sidebar') return;
    const [width, height] = mainWindow.getSize();
    safeStoreSet('app.windowBounds', { width, height });
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function createConfigWindow() {
  if (configWindow && !configWindow.isDestroyed()) {
    if (configWindow.isMinimized()) configWindow.restore();
    configWindow.show();
    configWindow.focus();
    return;
  }
  configWindow = null; // référence périmée (fenêtre détruite sans déclencher 'closed')

  // En-tête dégradé FIXE (2026-08-10, sur demande explicite, voir config.html
  // .titlebar/.theme-toggle-row) : n'utilise plus titleBarColorsForTheme
  // (thème clair/sombre) pour CETTE fenêtre — le dégradé demandé est le même
  // dans les 2 thèmes. `color` ci-dessous approxime la teinte du dégradé la
  // plus proche du coin où s'affichent les boutons natifs réduire/agrandir/
  // fermer (extrême droite) : l'API titleBarOverlay n'accepte qu'une couleur
  // UNIE, jamais un dégradé CSS — ce petit décalage de teinte à cet endroit
  // précis est un compromis assumé, pas un bug.
  const color = '#1a3040';
  const symbolColor = '#ffffff';

  // Hauteur adaptative (2026-08-23, sur demande explicite) — 900px fixe
  // dépassait la zone de travail sur un 14" 1920×1080 avec mise à l'échelle
  // Windows 125-150% (hauteur logique effective ~700-865px) : la fenêtre
  // s'ouvrait rognée, une partie (souvent le bouton Enregistrer) hors écran.
  // min(800, 90% de la zone de travail de l'écran où se trouve mainWindow)
  // — jamais plus que nécessaire, jamais plus que l'espace réellement
  // disponible. `resizable: true` (inchangé) laisse l'utilisateur agrandir
  // manuellement au-delà si besoin.
  const workArea = (mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()).workAreaSize;
  const configHeight = Math.round(Math.min(800, workArea.height * 0.9));

  configWindow = new BrowserWindow({
    width: 800,
    height: configHeight,
    minWidth: 640,
    minHeight: 500,
    resizable: true,
    parent: mainWindow,
    modal: false,
    backgroundColor: color,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color,
      symbolColor,
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  configWindow.loadFile(path.join(__dirname, '../renderer/config.html'));
  configWindow.once('ready-to-show', () => configWindow.show());
  configWindow.on('closed', () => { configWindow = null; });
}

// ─── Mode d'affichage — Icône flottante / Volet latéral (2026-08-23, sur
// demande explicite) ─────────────────────────────────────────────────────────
// Point d'entrée UNIQUE pour changer de mode (appelé au lancement avec la
// valeur restaurée du store, ET à chaque changement depuis Personnaliser) —
// nettoie toujours l'ancien mode avant d'appliquer le nouveau, jamais de
// chevauchement (ex. fenêtre sidebar encore alwaysOnTop en repassant en
// plein écran).
function applyDisplayMode(mode) {
  const previousMode = currentDisplayMode;
  const safeMode = ['floating', 'sidebar'].includes(mode) ? mode : 'fullscreen';
  currentDisplayMode = safeMode;

  if (previousMode === 'sidebar' && safeMode !== 'sidebar') exitSidebarMode();
  if (previousMode === 'floating' && safeMode !== 'floating' && sunWindow && !sunWindow.isDestroyed()) {
    sunWindow.hide();
  }

  if (safeMode === 'floating') {
    // mainWindow doit TOUJOURS déjà exister ici (2026-08-23, sur demande
    // explicite, point 4) — cette fonction n'est appelée qu'au lancement
    // (depuis createMainWindow, APRÈS `mainWindow = new BrowserWindow(...)`,
    // voir plus haut) ou depuis app:setDisplayMode (IPC atteignable
    // uniquement via la fenêtre Paramètres, elle-même enfant de mainWindow —
    // donc jamais avant que mainWindow n'existe). On ne fait donc QUE la
    // masquer ici, jamais la (re)créer : la recréer serait redondant dans le
    // cas normal, et dans le cas anormal (détruite entre-temps) c'est
    // expandFromSun/forceShowMainWindow, pas ce chemin, qui doit la
    // reconstruire — voir leurs commentaires plus bas.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    showSunWindow();
  } else if (safeMode === 'sidebar') {
    if (sunWindow && !sunWindow.isDestroyed()) sunWindow.hide();
    // mainWindow doit être VISIBLE en mode "sidebar" (2026-08-23, correctif
    // — même s'il ne reste qu'une bande de 20px à l'écran une fois repliée,
    // voir enterSidebarMode) : sans ce `.show()`, venir du mode "floating"
    // (où elle est cachée) laisserait la fenêtre invisible malgré un
    // repositionnement réussi — repéré en testant la bascule floating→sidebar.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    enterSidebarMode();
  } else {
    if (sunWindow && !sunWindow.isDestroyed()) sunWindow.hide();
    // `previousMode !== safeMode` : ne force PAS `.show()` au tout premier
    // appel (lancement, mainWindow pas encore affichée une 1re fois — voir
    // createMainWindow, showOnce reste seul responsable de ce 1er affichage,
    // sans quoi le flash blanc que `show:false`+'ready-to-show' évite
    // habituellement réapparaîtrait).
    if (previousMode !== safeMode && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('displayMode:updated', safeMode);
  }
}

// ── Icône flottante ─────────────────────────────────────────────────────────
function showSunWindow() {
  if (sunWindow && !sunWindow.isDestroyed()) {
    console.log('[Matin] showSunWindow — réutilise la fenêtre existante');
    sunWindow.show();
    return;
  }
  console.log('[Matin] showSunWindow — création d\'une nouvelle fenêtre soleil');

  const saved = store.get('app.floatingSunPosition');
  const display = screen.getPrimaryDisplay();
  const defaultX = display.workArea.x + display.workArea.width - SUN_WINDOW_SIZE - 24;
  const defaultY = display.workArea.y + display.workArea.height - SUN_WINDOW_SIZE - 24;

  sunWindow = new BrowserWindow({
    width: SUN_WINDOW_SIZE,
    height: SUN_WINDOW_SIZE,
    x: Number.isFinite(saved?.x) ? saved.x : defaultX,
    y: Number.isFinite(saved?.y) ? saved.y : defaultY,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    // Toujours visible par-dessus tout, y compris d'autres fenêtres
    // "always-on-top" classiques (voir aussi setAlwaysOnTop plus bas, niveau
    // 'screen-saver' — sans ça un lecteur vidéo ou une autre appli en mode
    // plein écran pourrait la recouvrir).
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  sunWindow.setAlwaysOnTop(true, 'screen-saver');
  sunWindow.loadFile(path.join(__dirname, '../renderer/sun.html'));
  sunWindow.once('ready-to-show', () => {
    console.log('[Matin] sunWindow ready-to-show');
    sunWindow.show();
  });
  sunWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error('[Matin] sunWindow did-fail-load', errorCode, errorDescription);
  });
  sunWindow.webContents.on('console-message', (_e, level, message) => {
    // Relaie la console DevTools de sunWindow (pas ouverte par défaut — pas
    // de --dev dédié pour cette petite fenêtre) vers la console du process
    // main, seule visible dans les logs `npm run dev` (2026-08-23, ajouté
    // pour diagnostiquer le rapport "cliquer sur le soleil ne fait rien").
    console.log('[Matin/sun console]', message);
  });

  // Position sauvegardée après chaque glisser-déposer (2026-08-23) — 'moved'
  // se déclenche en rafale pendant le drag, d'où le debounce (300ms sans
  // nouveau mouvement) plutôt qu'une écriture disque à chaque pixel.
  let moveSaveTimer = null;
  sunWindow.on('moved', () => {
    clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (!sunWindow || sunWindow.isDestroyed()) return;
      const [x, y] = sunWindow.getPosition();
      safeStoreSet('app.floatingSunPosition', { x, y });
    }, 300);
  });
  sunWindow.on('closed', () => { sunWindow = null; });
}

function expandFromSun() {
  if (sunWindow && !sunWindow.isDestroyed()) sunWindow.hide();
  if (!mainWindow || mainWindow.isDestroyed()) {
    // Filet de sécurité (2026-08-23, sur demande explicite, suite au rapport
    // "cliquer sur le soleil ne fait rien") — ne devrait normalement jamais
    // arriver : createMainWindow() construit TOUJOURS mainWindow avant son
    // propre appel à applyDisplayMode (voir plus bas), donc le mode
    // "floating" ne tourne jamais sans mainWindow déjà créée. Si elle a
    // quand même disparu (fermée/détruite entre-temps), la recréer plutôt
    // que de laisser l'utilisateur bloqué avec seulement le soleil à
    // l'écran et aucun moyen d'ouvrir le dashboard.
    forceShowMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

// Filet de secours INCONDITIONNEL (2026-08-23, sur demande explicite, point
// 5) — appelé par expandFromSun ci-dessus (mainWindow manquante) ET par le
// double-clic sur le soleil (voir sun.js/preload.js sun:forceShow) : force
// l'affichage de mainWindow quel que soit l'état courant (mode, fenêtre
// détruite...), sans dépendre d'un clic simple qui aurait pu rester sans
// effet. Recrée mainWindow si besoin, puis réaffirme l'affichage une 2e fois
// après un court délai — nécessaire car createMainWindow() réapplique
// applyDisplayMode(mode courant du store) en interne, qui recacherait
// aussitôt une fenêtre tout juste recréée si ce mode est encore "floating" ;
// ce 2e appel, plus tardif, a toujours le dernier mot.
function forceShowMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (sunWindow && !sunWindow.isDestroyed()) sunWindow.hide();

  const forceShow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  };
  forceShow();
  setTimeout(forceShow, 400);
}

// Menu contextuel du soleil flottant (2026-08-23, sur demande explicite) —
// construit et affiché depuis le process main (seul endroit où l'API Menu
// est disponible ; sun.html se contente de relayer l'événement contextmenu,
// voir sun.js). "Ouvrir Matin" réutilise EXACTEMENT le même chemin que le
// clic simple (expandFromSun, avec son propre filet de sécurité ci-dessus).
function showSunContextMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir Matin', click: () => expandFromSun() },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]);
  if (sunWindow && !sunWindow.isDestroyed()) {
    menu.popup({ window: sunWindow });
  }
}

function collapseToSun() {
  // Ignoré hors mode "floating" (ex. Échap pressée par réflexe alors que
  // l'utilisateur est repassé en plein écran entre-temps) — voir
  // dashboard.js initDisplayMode, qui appelle ceci sans vérifier le mode
  // lui-même, cette garde est la seule protection réelle.
  if (currentDisplayMode !== 'floating') return;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  showSunWindow();
}

// ── Volet latéral ────────────────────────────────────────────────────────────
// Le "glissement" est une VRAIE fenêtre qu'on repositionne (mainWindow.
// setBounds en boucle, voir animateSidebarX) — pas une transition CSS : la
// position OS d'une BrowserWindow ne peut pas être animée en CSS. Seule sa
// largeur reste constante pendant toute l'animation ; seul `x` bouge, entre
// une position "collapsed" (12px visibles, le reste hors de l'écran physique)
// et une position "expanded" (fenêtre entière visible, alignée sur le bord
// choisi). Les 2 côtés (gauche/droite) restent symétriques par construction :
// voir sidebarExpandedX/sidebarCollapsedX.
// Filet obligatoire avant TOUT positionnement manuel de mainWindow en mode
// "sidebar" (2026-08-23, correctif suite au rapport "cliquer sur la bande ne
// referme pas le volet en plein écran") — une fenêtre en VRAI plein écran OS
// (mainWindow.isFullScreen()) ignore silencieusement setBounds/setPosition :
// tenter de la faire glisser sans en sortir d'abord ne fait donc RIEN, d'où
// le symptôme rapporté. `unmaximize()` couvre au passage le cas voisin
// (maximisée via le bouton natif ☐ du titleBarOverlay) — moins strict que
// isFullScreen() mais setBounds s'y comporte tout aussi mal en pratique.
//
// `MIN_SETTLE_MS` (2026-08-24, correctif — un 2e clic restait nécessaire
// pour réduire depuis le plein écran) : 'leave-full-screen' peut se
// déclencher AVANT que l'OS n'ait fini d'animer le retour en fenêtré — un
// setBounds lancé à ce moment-là reste silencieusement sans effet, exactement
// comme si la fenêtre était encore en plein écran.Plutôt qu'une course
// "premier arrivé, premier servi" entre l'évènement et le filet, on impose
// désormais un délai MINIMUM garanti depuis l'appel à setFullScreen(false),
// peu importe quand l'évènement arrive — pour ne plus jamais dépendre du
// timing exact de l'animation OS.
const FULLSCREEN_EXIT_SETTLE_MS = 300;
function ensureWindowNotFullScreen(callback) {
  if (!mainWindow || mainWindow.isDestroyed()) { callback(); return; }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  if (!mainWindow.isFullScreen()) { callback(); return; }

  const startedAt = Date.now();
  let done = false;
  const runOnce = () => {
    if (done) return;
    done = true;
    const remaining = Math.max(0, FULLSCREEN_EXIT_SETTLE_MS - (Date.now() - startedAt));
    setTimeout(callback, remaining);
  };
  mainWindow.once('leave-full-screen', runOnce);
  mainWindow.setFullScreen(false);
  // Filet si l'évènement ne se déclenche jamais (même principe que showOnce
  // dans createMainWindow), avec une marge au-delà de FULLSCREEN_EXIT_SETTLE_MS.
  setTimeout(runOnce, FULLSCREEN_EXIT_SETTLE_MS + 200);
}

// Fait glisser mainWindow vers sa position "collapsed" (bande visible) —
// factorisé (2026-08-24) car appelé à la fois par enterSidebarMode (1re
// entrée en mode "sidebar") et par sidebarTogglePin (clic sur la bande) :
// les 2 doivent produire EXACTEMENT le même résultat, `ensureWindowNotFullScreen`
// compris, pour qu'un plein écran hérité de n'importe où se réduise en un
// seul geste peu importe son origine.
function sidebarSnapToCollapsed() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!preSidebarBounds) preSidebarBounds = mainWindow.getBounds();
  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  const winWidth = preSidebarBounds.width;

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  const collapsedX = sidebarState.edge === 'right'
    ? workArea.x + workArea.width - SIDEBAR_STRIP_WIDTH
    : workArea.x - (winWidth - SIDEBAR_STRIP_WIDTH);
  mainWindow.setBounds({
    x: Math.round(collapsedX),
    y: workArea.y,
    width: winWidth,
    height: workArea.height,
  });
}

function enterSidebarMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  sidebarState.edge = store.get('app.sidebarEdge') || 'right';
  sidebarState.pinned = false;
  sidebarState.expanded = false;
  clearTimeout(sidebarState.collapseTimer);
  clearInterval(sidebarState.animTimer);
  sidebarState.collapseTimer = null;
  sidebarState.animTimer = null;

  if (!preSidebarBounds) preSidebarBounds = mainWindow.getBounds();

  // Le mode "sidebar" implique désormais le plein écran (2026-08-24, sur
  // demande explicite, point 2 — "default to fullscreen when sidebar mode is
  // activated" + "on next app launch... start fullscreen then slide") : son
  // état "de base" est TOUJOURS mainWindow en VRAI plein écran OS, que ce
  // soit ici (activation depuis Personnaliser) ou au lancement (voir
  // applyDisplayMode, qui appelle cette même fonction dans les 2 cas). On
  // l'y met, on laisse l'ENTRÉE en plein écran se stabiliser (même
  // justification que FULLSCREEN_EXIT_SETTLE_MS ci-dessus, mais dans l'autre
  // sens), puis on la fait immédiatement glisser vers l'état "réduit" via
  // EXACTEMENT le même chemin que le clic sur la bande (ensureWindowNotFullScreen
  // + sidebarSnapToCollapsed) — un seul comportement partagé, jamais 2
  // implémentations séparées du même geste.
  mainWindow.setFullScreen(true);
  setTimeout(() => {
    ensureWindowNotFullScreen(sidebarSnapToCollapsed);
  }, FULLSCREEN_EXIT_SETTLE_MS);
}

function exitSidebarMode() {
  clearTimeout(sidebarState.collapseTimer);
  clearInterval(sidebarState.animTimer);
  sidebarState.collapseTimer = null;
  sidebarState.animTimer = null;
  sidebarState.pinned = false;
  sidebarState.expanded = false;

  // Sort du plein écran AVANT de restaurer les bornes normales (2026-08-24) —
  // même raison que partout ailleurs dans ce fichier : setBounds resterait
  // sans effet si l'état "déplié" hérité du mode "sidebar" était encore le
  // vrai plein écran OS au moment de basculer vers un AUTRE mode d'affichage.
  ensureWindowNotFullScreen(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
      if (preSidebarBounds) mainWindow.setBounds(preSidebarBounds);
    }
    preSidebarBounds = null;
  });
}

function sidebarExpandedX() {
  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  const winWidth = mainWindow.getBounds().width;
  return sidebarState.edge === 'right'
    ? workArea.x + workArea.width - winWidth
    : workArea.x;
}

function sidebarCollapsedX() {
  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  const winWidth = mainWindow.getBounds().width;
  return sidebarState.edge === 'right'
    ? workArea.x + workArea.width - SIDEBAR_STRIP_WIDTH
    : workArea.x - (winWidth - SIDEBAR_STRIP_WIDTH);
}

// Anime `mainWindow` vers `targetX` en ~300ms (ease-out cubique) — seul `x`
// change à chaque pas, `y`/largeur/hauteur restent ceux du pas précédent
// (jamais recalculés ici) pour ne jamais déclencher l'événement 'resize' de
// mainWindow pendant l'anim (voir la garde `currentDisplayMode === 'sidebar'`
// sur ce même événement plus haut — redondant mais volontaire, aucune des 2
// protections ne doit être LA seule).
function animateSidebarX(targetX) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearInterval(sidebarState.animTimer);

  const startBounds = mainWindow.getBounds();
  const startX = startBounds.x;
  const distance = targetX - startX;
  if (distance === 0) return;

  const durationMs = 300;
  const stepMs = 16;
  const steps = Math.max(1, Math.round(durationMs / stepMs));
  let step = 0;

  sidebarState.animTimer = setInterval(() => {
    step++;
    const t = Math.min(1, step / steps);
    const eased = 1 - Math.pow(1 - t, 3);
    const x = Math.round(startX + distance * eased);
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(sidebarState.animTimer);
      sidebarState.animTimer = null;
      return;
    }
    mainWindow.setBounds({ x, y: startBounds.y, width: startBounds.width, height: startBounds.height });
    if (t >= 1) {
      clearInterval(sidebarState.animTimer);
      sidebarState.animTimer = null;
    }
  }, stepMs);
}

function sidebarExpand() {
  if (currentDisplayMode !== 'sidebar') return;
  // `clearTimeout` AVANT le early-return "déjà ouvert" (2026-08-23, correctif) —
  // sinon un survol qui revient PENDANT le délai d'1s de sidebarScheduleCollapse
  // (fenêtre encore visuellement ouverte, `expanded` toujours true à ce
  // moment-là) ressortait immédiatement sans annuler le minuteur en cours, et
  // le volet se refermait quand même 1s plus tard sous le curseur.
  clearTimeout(sidebarState.collapseTimer);
  sidebarState.collapseTimer = null;
  if (sidebarState.expanded) return;
  sidebarState.expanded = true;
  animateSidebarX(sidebarExpandedX());
}

// Appelé quand le curseur quitte la fenêtre (voir dashboard.js, mouseleave
// sur <html>) — n'effectue rien tant que la fenêtre est épinglée ouverte
// (voir sidebarTogglePin), reporté de 1s à chaque nouvel appel pour laisser
// le temps à l'utilisateur de revenir sans provoquer un clignotement.
function sidebarScheduleCollapse() {
  if (currentDisplayMode !== 'sidebar' || sidebarState.pinned) return;
  clearTimeout(sidebarState.collapseTimer);
  sidebarState.collapseTimer = setTimeout(() => {
    sidebarState.collapseTimer = null;
    sidebarState.expanded = false;
    animateSidebarX(sidebarCollapsedX());
  }, 1000);
}

function sidebarTogglePin() {
  if (currentDisplayMode !== 'sidebar') return;
  clearTimeout(sidebarState.collapseTimer);
  sidebarState.collapseTimer = null;

  // Sort du plein écran AVANT tout (2026-08-24, sur demande explicite,
  // point 1 — "the sidebar should retract in ONE click from fullscreen, not
  // two") : c'est le clic sur la bande qui était rapporté cassé en plein
  // écran. `ensureWindowNotFullScreen` impose désormais un délai de
  // stabilisation FIXE après setFullScreen(false) (voir sa définition plus
  // haut, FULLSCREEN_EXIT_SETTLE_MS) au lieu de faire la course avec
  // l'évènement 'leave-full-screen' — c'est CE correctif-là qui rendait un
  // 2e clic nécessaire (le setBounds du repli partait parfois trop tôt,
  // pendant que l'OS finissait encore d'animer la sortie du plein écran, et
  // restait donc silencieusement sans effet).
  ensureWindowNotFullScreen(() => {
    if (currentDisplayMode !== 'sidebar') return; // re-vérifié après la transition (asynchrone)
    if (sidebarState.pinned) {
      sidebarState.pinned = false;
      sidebarState.expanded = false;
      // Repli en un seul geste NET (2026-08-24) — sidebarSnapToCollapsed
      // (positionnement direct, pas d'anim de 300ms par-dessus) plutôt
      // qu'animateSidebarX : depuis le plein écran, l'OS vient déjà d'animer
      // la sortie ; empiler notre propre glissement dessus aurait paru
      // saccadé/redondant. Toujours utilisé même hors plein écran (la garde
      // ci-dessus ne coûte rien dans ce cas), pour un seul comportement.
      sidebarSnapToCollapsed();
    } else {
      sidebarState.pinned = true;
      sidebarState.expanded = true;
      animateSidebarX(sidebarExpandedX());
    }
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Config store
ipcMain.handle('store:get', (_e, key) => store.get(key));
ipcMain.handle('store:set', (_e, key, value) => { safeStoreSet(key, value); return true; });
ipcMain.handle('store:getAll', () => store.store);

// Sauvegardes de lancement — liste/restaure (voir writeLaunchBackup plus
// haut et renderer/config.js, bouton "Restaurer une sauvegarde" de
// Paramètres → App, 2026-08-10 sur demande explicite).
ipcMain.handle('backups:list', () => listLaunchBackups());

// `file` vient de backups:list (jamais saisi librement par l'utilisateur) —
// motif validé quand même avant de construire le chemin, filet de sécurité
// contre toute traversée de répertoire si ce contrat venait à changer.
const BACKUP_FILE_RE = /^backup-[\d-_]+\.json$/;
// Comprend 2 formats de sauvegarde (2026-08-10, depuis la scission matin-
// config/matin-userdata) : le NOUVEAU `{ config, userdata }` (restaure
// chaque partie dans SON store), et l'ANCIEN format à plat (tout restauré
// dans matin-config tel quel — c'est bien là qu'était TOUTE la donnée à
// l'époque où ces sauvegardes-là ont été écrites, matin-userdata n'existait
// pas encore) : matin-userdata garde alors son contenu ACTUEL, jamais vidé
// par une restauration d'une sauvegarde antérieure à son existence.
ipcMain.handle('backups:restore', (_e, file) => {
  if (!BACKUP_FILE_RE.test(file)) throw new Error('Nom de sauvegarde invalide');
  const filePath = path.join(LAUNCH_BACKUPS_DIR, file);
  if (!fs.existsSync(filePath)) throw new Error('Sauvegarde introuvable');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  backupStoreBeforeWrite(); // trace de l'état juste avant l'écrasement par la restauration
  if (data.config || data.userdata) {
    if (data.config) store.store = data.config;
    if (data.userdata) userdataStore.store = data.userdata;
  } else {
    store.store = data;
  }
  scheduleDriveUploadAfterChange(); // restauration manuelle = changement de donnée local, voir Sync Google Drive plus bas
  if (mainWindow) mainWindow.reload();
  return true;
});

// Thème clair/sombre — voir titleBarColorsForTheme plus haut pour le détail
// des 3 couches synchronisées. `theme:getInitial` est SYNCHRONE
// (ipcMain.on/event.returnValue, pas ipcMain.handle) exprès : appelé depuis
// le tout début de preload.js (avant que la page ne s'affiche), pour pouvoir
// poser `document.documentElement.dataset.colorScheme` dans un <script>
// synchrone en tête de <head> — sans ça, le thème ne serait connu qu'après
// un aller-retour IPC asynchrone, provoquant un flash visible du mauvais
// thème à chaque lancement/rechargement.
ipcMain.on('theme:getInitial', (event) => {
  event.returnValue = store.get('app.theme') || 'dark';
});

ipcMain.handle('app:setTheme', (_e, theme) => {
  const safeTheme = theme === 'light' ? 'light' : 'dark'; // toute valeur inattendue retombe sur le défaut sombre
  safeStoreSet('app.theme', safeTheme);

  const { color, symbolColor } = titleBarColorsForTheme(safeTheme);
  for (const win of [mainWindow, configWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.setBackgroundColor(color);
    win.setTitleBarOverlay({ color, symbolColor, height: 38 });
    win.webContents.send('theme:updated', safeTheme);
  }
  return true;
});

// Notice de restauration automatique au lancement (voir
// autoRestoreUserdataIfEmpty plus haut, 2026-08-10) — lue une seule fois par
// le dashboard à son premier rendu pour afficher un rappel visuel en plus de
// la notification native déjà envoyée côté process main.
ipcMain.handle('app:getAutoRestoreNotice', () => autoRestoreNotice);

// Fond personnalisé du dashboard (2026-08-11, sur demande explicite — voir
// "🎨 Personnaliser" dans Paramètres, config.js/renderPersonnaliserModal) —
// même mécanisme de diffusion que app:setTheme ci-dessus : la sélection se
// fait dans la fenêtre Paramètres, mais c'est le dashboard (mainWindow) qui
// doit l'appliquer EN DIRECT, d'où l'IPC dédié plutôt qu'un simple
// store:set générique (qui n'aurait notifié personne).
ipcMain.handle('app:setBackground', (_e, background) => {
  const safeBackground = typeof background === 'string' ? background : 'none';
  safeStoreSet('app.background', safeBackground);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('background:updated', safeBackground);
  }
  return true;
});

// Mode d'affichage — Icône flottante / Volet latéral (2026-08-23, sur demande
// explicite, voir "🎨 Personnaliser" → section "Mode d'affichage" et
// applyDisplayMode/enterSidebarMode/showSunWindow plus haut) — même
// mécanisme instantané que app:setBackground ci-dessus (store + notification
// au dashboard), avec en plus l'effet de bord réel (masquer/repositionner
// des BrowserWindow) que ipcMain.handle('store:set', ...) seul ne ferait pas.
ipcMain.handle('app:setDisplayMode', (_e, mode) => {
  const safeMode = ['floating', 'sidebar'].includes(mode) ? mode : 'fullscreen';
  safeStoreSet('app.displayMode', safeMode);
  applyDisplayMode(safeMode);
  return true;
});

ipcMain.handle('app:setSidebarEdge', (_e, edge) => {
  const safeEdge = edge === 'left' ? 'left' : 'right';
  safeStoreSet('app.sidebarEdge', safeEdge);
  if (currentDisplayMode === 'sidebar') {
    sidebarState.edge = safeEdge;
    animateSidebarX(sidebarState.expanded ? sidebarExpandedX() : sidebarCollapsedX());
  }
  return true;
});

// Glisser-déposer du soleil (2026-08-23, 2e correctif — voir sun.js/
// sun.html : plus de -webkit-app-region: drag, tout le déplacement passe par
// ces 2 canaux). `sun:move` en `.on` (fire-and-forget) plutôt que `.handle` —
// appelé à CHAQUE mousemove pendant un glisser, une réponse attendue à
// chaque appel ajouterait une latence perceptible sans aucune utilité (le
// renderer n'a besoin d'aucun retour).
ipcMain.handle('sun:getPosition', () => {
  if (sunWindow && !sunWindow.isDestroyed()) {
    const [x, y] = sunWindow.getPosition();
    return { x, y };
  }
  return { x: 0, y: 0 };
});
ipcMain.on('sun:move', (_e, pos) => {
  if (!sunWindow || sunWindow.isDestroyed()) return;
  const x = Math.round(pos?.x);
  const y = Math.round(pos?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) sunWindow.setPosition(x, y);
});

// Appelé par sun.html (clic sur le soleil) et par le dashboard (bouton
// "Réduire"/Échap, voir dashboard.js initDisplayMode) — 2 fenêtres
// distinctes, d'où ces 2 canaux dédiés plutôt qu'un simple store:set.
ipcMain.handle('sun:expand', () => {
  console.log('[Matin] IPC sun:expand reçu — currentDisplayMode =', currentDisplayMode, ', mainWindow =', !!mainWindow, ', destroyed =', mainWindow?.isDestroyed());
  expandFromSun();
  return true;
});
// Double-clic sur le soleil (2026-08-23, sur demande explicite, point 5) —
// voir forceShowMainWindow plus haut : marche MÊME si le clic simple
// ci-dessus est resté sans effet, aucune condition de mode/état.
ipcMain.handle('sun:forceShow', () => { forceShowMainWindow(); return true; });
// Clic droit sur le soleil (2026-08-23, sur demande explicite, point 3).
ipcMain.handle('sun:contextMenu', () => { showSunContextMenu(); return true; });
ipcMain.handle('dashboard:collapseToSun', () => { collapseToSun(); return true; });

// Volet latéral — survol/clic sur la bande de 12px (voir dashboard.js,
// #sidebarStrip) : ces 3 gestes vivent tous côté process main (seul endroit
// qui peut réellement déplacer mainWindow), le renderer se contente de
// relayer les événements souris.
ipcMain.handle('sidebar:hoverEnter', () => { sidebarExpand(); return true; });
ipcMain.handle('sidebar:hoverLeave', () => { sidebarScheduleCollapse(); return true; });
ipcMain.handle('sidebar:togglePin', () => { sidebarTogglePin(); return true; });

// Modules
//
// RISQUE STRUCTUREL IDENTIFIÉ ET CORRIGÉ LE 2026-08-08 (suite à un
// signalement "lignes de portefeuille ETF disparues" — fausse alerte, voir
// backupStoreBeforeWrite ci-dessus, mais l'enquête a mis au jour ce vrai
// risque distinct) : le dashboard (fenêtre principale, `layout` uniquement,
// canal SILENCIEUX ci-dessous) et la page de config (`enabled`/`position`/
// `config`, bouton "Enregistrer") chargent CHACUN une copie complète de
// `modules` en mémoire à l'ouverture de leur fenêtre, puis RÉÉCRIVENT
// L'OBJET ENTIER au moment de sauvegarder — jamais une fusion. Si l'une des
// deux fenêtres écrit APRÈS que l'autre a sauvegardé un changement (ex. un
// glisser-déposer sur le dashboard juste après un clic "Enregistrer" en
// Paramètres, ou l'inverse), la copie en mémoire la plus ancienne écrase
// silencieusement le changement le plus récent sur TOUT `modules` — y
// compris `config.lines` d'ETF/Crypto, jamais touché par la fenêtre qui
// écrit en dernier mais entraîné dans l'écrasement quand même. Corrigé en
// limitant chaque canal à SA responsabilité réelle : `modules:updateLayout`
// ne fusionne plus que le champ `layout` dans l'état ACTUEL du disque (jamais
// enabled/position/config, qu'il n'a jamais eu vocation à modifier) ;
// `modules:update` préserve le `layout` actuel du disque pour chaque module
// plutôt que celui de sa propre copie potentiellement périmée (la page de
// config n'édite jamais le layout, qui n'est un concept que côté dashboard).
// Lecture/écriture FUSIONNÉES (2026-08-10, voir getMergedModules/
// setMergedModules plus haut) — matin-config et matin-userdata restent 2
// stores distincts sur disque, mais le renderer continue de voir/envoyer un
// seul objet `modules`, exactement comme avant la scission.
ipcMain.handle('modules:getAll', () => getMergedModules());
ipcMain.handle('modules:update', (_e, modules) => {
  const current = getMergedModules();
  for (const [key, mod] of Object.entries(modules)) {
    if (current[key]?.layout) mod.layout = current[key].layout;
  }
  setMergedModules(modules);
  // Notifier la fenêtre principale
  if (mainWindow) mainWindow.webContents.send('modules:updated', modules);
  // Un changement de config Alertes (département, types activés/désactivés)
  // doit se refléter immédiatement dans le bandeau plutôt que d'attendre
  // jusqu'à 15 min (voir ALERTS_CHECK_MS) — recheck best-effort (déclaration
  // hoistée, définie plus bas dans ce fichier), une panne ici ne doit jamais
  // faire échouer la sauvegarde de la config elle-même.
  checkAlerts().catch(err => console.error('[Alertes] Échec recheck après sauvegarde config', err));
  return true;
});
// Sauvegarde silencieuse de la disposition (drag/resize) — pas de broadcast
// 'modules:updated', sinon le dashboard se rechargerait lui-même à chaque
// glisser-déposer puisque c'est lui qui déclenche cet appel. Ne fusionne QUE
// `layout` (voir commentaire ci-dessus) : un module disparu du disque entre
// temps (supprimé depuis Paramètres, ex. une instance Sports retirée) est
// ignoré plutôt que ressuscité.
// Fusionne UNIQUEMENT `layout`, mais dans LE BON store selon la clé (2026-08-10,
// voir USERDATA_MODULE_KEYS) — ETF/Crypto/Prêts/FDJ/Podcasts ont aussi une
// position/taille de carte sur le dashboard, donc leur layout vit dans
// matin-userdata comme le reste de leur entrée. Un seul backupStoreBeforeWrite
// (dump les 2 stores) avant d'écrire, jamais deux (pas de double appel via
// safeStoreSet ici, pour ne backup qu'une fois même si les 2 stores changent).
ipcMain.handle('modules:updateLayout', (_e, modules) => {
  const configCurrent = store.get('modules') || {};
  const userdataCurrent = userdataStore.get('modules') || {};
  let configChanged = false;
  let userdataChanged = false;

  for (const [key, mod] of Object.entries(modules)) {
    if (USERDATA_MODULE_KEYS.has(key)) {
      if (userdataCurrent[key] && mod.layout) { userdataCurrent[key].layout = mod.layout; userdataChanged = true; }
    } else if (configCurrent[key] && mod.layout) {
      configCurrent[key].layout = mod.layout;
      configChanged = true;
    }
  }
  if (configChanged || userdataChanged) backupStoreBeforeWrite();
  if (configChanged) store.set('modules', configCurrent);
  if (userdataChanged) {
    userdataStore.set('modules', userdataCurrent);
    scheduleDriveUploadAfterChange(); // voir Sync Google Drive plus bas
  }
  return true;
});

// Repli/dépli d'un groupe Prêts (2026-08-10, sur demande explicite — le
// clic sur la flèche déclenchait un rechargement complet du dashboard) :
// canal SILENCIEUX dédié, même principe que `modules:updateLayout`
// ci-dessus (fusionne un seul champ dans l'état ACTUEL du disque, aucun
// broadcast 'modules:updated' — c'est justement ce broadcast qui causait
// `window.location.reload()` côté dashboard.js à chaque clic, voir prets.js).
// Route vers LE BON store selon la clé (2026-08-10) — "prets" est une clé
// userdata (voir USERDATA_MODULE_KEYS), c'est d'ailleurs le seul module à
// utiliser ce canal aujourd'hui.
ipcMain.handle('modules:updateCollapsed', (_e, { key, collapsed }) => {
  const targetStore = USERDATA_MODULE_KEYS.has(key) ? userdataStore : store;
  const current = targetStore.get('modules') || {};
  if (!current[key]) return false;
  current[key].config = current[key].config || {};
  current[key].config.collapsed = collapsed;
  backupStoreBeforeWrite();
  targetStore.set('modules', current);
  return true;
});

// Navigation
ipcMain.handle('window:openConfig', () => createConfigWindow());
ipcMain.handle('window:closeConfig', () => { if (configWindow) configWindow.close(); });
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

// Flux RSS nécessitant un fetch sans restriction CORS (le process main n'est
// pas un contexte navigateur — contrairement au renderer, aucun proxy tiers
// n'est nécessaire pour joindre des flux qui n'envoient pas d'en-têtes CORS).
ipcMain.handle('rss:fetchFeed', async (_e, url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  // Log URL + statut HTTP (2026-08-15, sur demande explicite côté module
  // Sports, mais posé ici plutôt que dans ol.js : ce handler est le seul
  // point de passage RÉEL de la requête réseau — tout module RSS de l'app
  // (Sports, France/Tech/Bourse/Science/Gaming/Santé, Podcasts, YouTube...)
  // en profite pour le même coût. Toujours dans les logs du process main
  // (terminal `npm run dev`), pas besoin du pont console renderer pour le
  // consulter.
  console.log(`[RSS] ${url} → HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Flux inaccessible (${res.status})`);
  return res.text();
});

// Résultats FDJ (Loto/EuroMillions/EuroDreams) — le site officiel fdj.fr est
// une SPA Next.js dont le HTML brut ne contient pas les numéros tirés
// (vérifié : aucune clé "winningNumbers"/"combination" dans un fetch simple ;
// re-testé le 2026-08-05 sur la piste `/api/historique-des-resultats`
// suggérée en repli : 403. `/jeux-de-tirage/{jeu}/resultats` répond 200 mais
// ne contient que les RÈGLES du jeu en JSON embarqué — descriptions de types
// de mise "Simple"/"Mul 5+3" etc. — jamais un tirage réel), et le domaine de
// repli suggéré à l'origine (api.api-dev.fr) ne résout même pas en DNS.
// Source retenue : mes-resultats-fdj.fr.
//
// BUG CORRIGÉ LE 2026-08-05 : le CSV `/api/telecharger/{jeu}` peut être en
// retard d'un tirage entier sur la page d'accueil du MÊME site — confirmé en
// direct le jour même : le CSV EuroMillions affichait encore le tirage du
// 31/07 alors que la page d'accueil (`/`) avait déjà celui du 04/08 avec sa
// propre date affichée ("EuroMillions Mardi 4 août"). Ce n'est PAS un souci
// de cache HTTP côté requête (le process main utilise `fetch` de Node, sans
// couche de cache implicite contrairement à un navigateur) — la donnée est
// réellement en retard côté serveur sur cette route précise, probablement un
// export batch désynchronisé du rendu live de la page d'accueil. Le
// paramètre anti-cache + les en-têtes no-cache ci-dessous (`fdjNoCacheFetch`)
// sont conservés en filet de sécurité au cas où un CDN intermédiaire (le site
// est un déploiement Next.js, potentiellement derrière une mise en cache
// d'edge) jouerait aussi un rôle, mais le vrai correctif est côté SOURCE : la
// page d'accueil (déjà utilisée pour les codes gagnants) sert désormais de
// source PRINCIPALE pour Loto et EuroMillions, avec repli sur le CSV si son
// motif de parsing ne matche plus. EuroDreams n'a pas de carte sur cette page
// (site à la marque "Loto & EuroMillions" — EuroDreams n'apparaît qu'en pied
// de page) : CSV uniquement pour ce jeu, inchangé.
function fdjNoCacheFetch(url) {
  const bust = `${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
  return fetch(`${url}${bust}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
  });
}

const FDJ_CSV_URLS = {
  loto:         'https://www.mes-resultats-fdj.fr/api/telecharger/loto',
  euromillions: 'https://www.mes-resultats-fdj.fr/api/telecharger/euromillions',
  eurodreams:   'https://www.mes-resultats-fdj.fr/api/telecharger/eurodreams',
};

// Page d'accueil — sert à la fois de source principale pour les tirages
// Loto/EuroMillions (voir fdj:fetchLatestDraw) et de source pour les codes
// gagnants (voir fdj:fetchWinningCodes, plus bas) : une seule URL, deux
// usages, jamais deux fetches séparés pour la même page.
const FDJ_CODES_URL = 'https://www.mes-resultats-fdj.fr/';

// Le fichier contient tout l'historique (parfois depuis 1976) ; on n'a besoin
// que du dernier tirage, donc on s'arrête à la 2e ligne plutôt que de parser
// des milliers de lignes en mémoire pour ne garder que la première.
function parseFdjLatestRow(csvText) {
  const clean = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  const newlineIdx1 = clean.indexOf('\n');
  if (newlineIdx1 === -1) return null;
  const newlineIdx2 = clean.indexOf('\n', newlineIdx1 + 1);
  const headerLine = clean.slice(0, newlineIdx1).trim();
  const dataLine = (newlineIdx2 === -1 ? clean.slice(newlineIdx1 + 1) : clean.slice(newlineIdx1 + 1, newlineIdx2)).trim();
  if (!headerLine || !dataLine) return null;

  const headers = headerLine.split(';').map(h => h.trim());
  const values = dataLine.split(';').map(v => v.trim());
  const row = {};
  headers.forEach((h, i) => { row[h] = values[i]; });
  return row;
}

// Page d'accueil — mois français SANS accent car c'est tel quel dans le HTML
// de la page (vérifié sur une vraie réponse : "Lundi 3 aout", "Mardi 4
// aout", jamais "août") ; les deux formes acceptées quand même par prudence.
const FDJ_MONTHS_FR = {
  janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, août: 7, septembre: 8, octobre: 9, novembre: 10,
  decembre: 11, décembre: 11,
};

// "Lundi 3 aout" (jamais d'année affichée) → Date réelle. Suppose l'année en
// cours ; recule d'un an si le résultat tombe plus de 3 jours dans le futur
// (ne peut arriver qu'à cheval sur le nouvel an, un tirage de fin décembre
// lu début janvier).
function parseFdjHomepageDate(text) {
  const m = text.match(/(\d{1,2})\s+([a-zA-Zéûôîàç]+)/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = FDJ_MONTHS_FR[m[2].toLowerCase()];
  if (month == null) return null;

  const now = new Date();
  let date = new Date(now.getFullYear(), month, day);
  if (date.getTime() - now.getTime() > 3 * 86400000) date = new Date(now.getFullYear() - 1, month, day);
  return date;
}

// Extrait un tirage (numéros + spécial + date) depuis la carte "Derniers
// tirages" de la page d'accueil pour loto/euromillions. Structure réelle
// vérifiée le 2026-08-05 : `<span ...>{Loto|EuroMillions}</span><p
// class="text-xs text-ink-dim">{date}</p>` puis des boules `role="img"
// aria-label="Numero N"` (numéros principaux, communs aux deux jeux),
// `aria-label="Numero Chance N"` (spécial Loto) ou `aria-label="Etoile N"` ×2
// (spécial EuroMillions). Renvoie null si un motif ne matche plus (structure
// HTML changée côté site tiers) plutôt que de renvoyer un tirage à moitié
// rempli — le point d'appel retombe alors sur le CSV.
function parseFdjHomepageGame(html, game) {
  const label = game === 'loto' ? 'Loto' : game === 'euromillions' ? 'EuroMillions' : null;
  if (!label) return null;

  // `>{label}</span>` seul est ambigu : "Loto"/"EuroMillions" apparaissent
  // aussi ailleurs sur la page (résumé des jours de tirage en pied de page,
  // notamment) et un indexOf naïf peut tomber sur cette occurrence au lieu de
  // la vraie carte de résultat — bug réel rencontré en testant ce correctif :
  // le résumé du pied de page ("Loto Lun, Mer, Sam") précède la carte de
  // résultat dans le HTML, donc le premier indexOf tombait toujours dessus.
  // On ancre d'abord sur le titre de section (unique, `sr-only`) puis on
  // cherche le libellé du jeu seulement après ce point.
  const sectionStart = html.indexOf('Resultats du Loto');
  if (sectionStart === -1) return null;

  const labelIdx = html.indexOf(`>${label}</span>`, sectionStart);
  if (labelIdx === -1) return null;
  const section = html.slice(labelIdx, labelIdx + 3000);

  const dateMatch = section.match(/<p class="text-xs text-ink-dim">([^<]+)<\/p>/);
  const date = dateMatch ? parseFdjHomepageDate(dateMatch[1]) : null;
  if (!date) return null;

  const numbers = [];
  const numRe = /aria-label="Numero (\d+)"/g;
  let m;
  while ((m = numRe.exec(section))) numbers.push(parseInt(m[1], 10));
  if (numbers.length < 5) return null;

  let special = [];
  if (game === 'loto') {
    const sm = section.match(/aria-label="Numero Chance (\d+)"/);
    if (sm) special = [parseInt(sm[1], 10)];
  } else {
    const starRe = /aria-label="Etoile (\d+)"/g;
    let sm;
    while ((sm = starRe.exec(section))) special.push(parseInt(sm[1], 10));
  }
  if (!special.length) return null;

  return { date, numbers: numbers.slice(0, 5), special };
}

// Formate en date locale JJ/MM/AAAA — PAS `.toISOString()`, qui convertit en
// UTC et décale la date d'un jour à minuit local pour tout fuseau en avance
// sur UTC (France l'été = UTC+2) : un tirage du 3 août à minuit local
// affichait "2026-08-02" dans les logs de diagnostic (repéré en testant ce
// correctif — le champ `date` réellement utilisé par le module n'était pas
// affecté, seul le message de log l'était, mais un log de diagnostic faux
// est pire qu'utile).
function fdjFormatLocalDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

// Reconstruit un objet à la forme d'une ligne CSV (voir parseFdjLatestRow) à
// partir d'un tirage extrait de la page d'accueil — garde le contrat de
// retour de l'IPC identique quelle que soit la source, aucun changement côté
// renderer (fdj-games.js normalizeDrawRow) nécessaire.
function fdjHomepageResultToRow(game, result) {
  const row = { date: fdjFormatLocalDate(result.date) };
  result.numbers.forEach((n, i) => { row[`boule_${i + 1}`] = String(n); });
  if (game === 'loto') {
    row.numero_chance = String(result.special[0]);
  } else {
    row.etoile_1 = String(result.special[0]);
    row.etoile_2 = String(result.special[1]);
  }
  return row;
}

ipcMain.handle('fdj:fetchLatestDraw', async (_e, game) => {
  if (game === 'loto' || game === 'euromillions') {
    try {
      const res = await fdjNoCacheFetch(FDJ_CODES_URL);
      if (res.ok) {
        const html = await res.text();
        const result = parseFdjHomepageGame(html, game);
        if (result) {
          console.log(`[FDJ] ${game} — tirage lu sur la page d'accueil, date ${fdjFormatLocalDate(result.date)}`);
          return fdjHomepageResultToRow(game, result);
        }
        console.warn(`[FDJ] ${game} — motif de la page d'accueil introuvable, repli sur le CSV`);
      }
    } catch (err) {
      console.warn(`[FDJ] ${game} — page d'accueil indisponible, repli sur le CSV`, err);
    }
  }

  const url = FDJ_CSV_URLS[game];
  if (!url) throw new Error(`Jeu FDJ inconnu : ${game}`);
  const res = await fdjNoCacheFetch(url);
  if (!res.ok) throw new Error(`FDJ ${game} inaccessible (${res.status})`);
  const text = await res.text();
  const row = parseFdjLatestRow(text);
  if (!row) throw new Error(`CSV FDJ ${game} vide ou invalide`);
  console.log(`[FDJ] ${game} — tirage lu depuis le CSV, date ${row.date}`);
  return row;
});

// Codes gagnants (Loto Gagnant / MyMillion) — absents du CSV ci-dessus (aucune
// colonne "code" dedans, vérifié). Seule source gratuite trouvée les publiant :
// la page d'accueil de mes-resultats-fdj.fr elle-même, server-rendue (Next.js
// SSR — confirmé par fetch brut, le HTML contient déjà le texte sans exécuter
// de JS). Les deux jeux partagent cette même page, d'où un seul fetch pour les
// deux plutôt qu'un par jeu.
//
// Parsing par recherche de motif autour des libellés "Codes Loto"/"My Million"
// plutôt qu'un vrai parseur DOM (pas de librairie DOM côté main process) — plus
// fragile qu'un CSV avec contrat de colonnes stable : ceci dépend de la
// structure HTML actuelle d'un site tiers non documenté, qui peut changer sans
// préavis à son prochain déploiement. D'où la dégradation gracieuse côté
// renderer (fdj.js) : si le motif ne matche plus, on retombe silencieusement
// sur le dernier code connu en cache, jamais une carte cassée.
// (FDJ_CODES_URL déclarée plus haut, juste après FDJ_CSV_URLS — partagée
// avec fdj:fetchLatestDraw.)

function parseFdjWinningCodes(html) {
  const result = { loto: [], euromillions: null };

  const lotoLabelIdx = html.indexOf('Codes Loto');
  if (lotoLabelIdx !== -1) {
    const section = html.slice(lotoLabelIdx, lotoLabelIdx + 2000);
    const spanRe = /<span class="[^"]*font-mono[^"]*"[^>]*>([^<]+)<\/span>/g;
    let m;
    while ((m = spanRe.exec(section))) {
      result.loto.push(m[1].trim());
    }
  }

  const millionLabelIdx = html.indexOf('My Million');
  if (millionLabelIdx !== -1) {
    const section = html.slice(millionLabelIdx, millionLabelIdx + 400);
    const codeMatch = section.match(/<p class="[^"]*font-mono[^"]*"[^>]*>([^<]+)<\/p>/);
    if (codeMatch) result.euromillions = codeMatch[1].trim();
  }

  return result;
}

ipcMain.handle('fdj:fetchWinningCodes', async () => {
  const res = await fdjNoCacheFetch(FDJ_CODES_URL);
  if (!res.ok) throw new Error(`Codes FDJ inaccessibles (${res.status})`);
  const html = await res.text();
  const codes = parseFdjWinningCodes(html);
  if (!codes.loto.length && !codes.euromillions) throw new Error('Aucun code trouvé (structure de page inattendue)');
  return codes;
});

// Philips Hue — pont local, aucune clé API externe (API REST locale v1,
// stable depuis des années, HTTP simple non chiffré — toujours supporté en
// parallèle du HTTPS plus récent). Découverte du pont via le portail N-UPnP
// officiel (discovery.meethue.com, cloud mais sans clé, renvoie juste l'IP
// locale du pont) ; tout le reste est un appel HTTP direct au pont sur le
// réseau LOCAL, jamais internet. Passé par le process main comme les autres
// fetches de l'app : le pont n'envoie pas d'en-têtes CORS (ce n'est pas un
// serveur pensé pour être appelé depuis du JS navigateur), un fetch direct
// depuis le renderer échouerait.
//
// L'appairage (POST /api avec devicetype) exige que l'utilisateur appuie sur
// le bouton physique du pont dans les ~30s précédant l'appel — mesure de
// sécurité Hue volontaire, IMPOSSIBLE À AUTOMATISER (aucune action à distance
// ne peut appuyer sur un bouton physique). Le handler ci-dessous se contente
// de relayer l'appel une fois que l'utilisateur l'a fait lui-même ; si le
// bouton n'a pas été pressé, le pont renvoie une erreur explicite (type 101)
// remontée telle quelle côté config.
const HUE_DISCOVERY_URL = 'https://discovery.meethue.com/';

ipcMain.handle('hue:discoverBridge', async () => {
  const res = await fetch(HUE_DISCOVERY_URL);
  if (!res.ok) throw new Error(`Découverte échouée (${res.status})`);
  const data = await res.json();
  if (!data.length) throw new Error('Aucun pont Hue trouvé sur le réseau');
  return data[0].internalipaddress;
});

ipcMain.handle('hue:pair', async (_e, bridgeIp) => {
  const res = await fetch(`http://${bridgeIp}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devicetype: 'matin-windows#dashboard' }),
  });
  if (!res.ok) throw new Error(`Pont injoignable (${res.status})`);
  const data = await res.json();
  const entry = data[0];
  if (entry?.error) throw new Error(entry.error.description || 'Appairage refusé');
  if (!entry?.success?.username) throw new Error('Réponse du pont inattendue');
  return entry.success.username;
});

ipcMain.handle('hue:getGroups', async (_e, { bridgeIp, username }) => {
  const res = await fetch(`http://${bridgeIp}/api/${username}/groups`);
  if (!res.ok) throw new Error(`Pont injoignable (${res.status})`);
  const data = await res.json();
  if (Array.isArray(data) && data[0]?.error) throw new Error(data[0].error.description || 'Erreur du pont');
  return Object.entries(data).map(([id, g]) => ({
    id,
    name: g.name,
    type: g.type,
    on: !!g.state?.any_on,
    allOn: !!g.state?.all_on,
    bri: g.action?.bri ?? 254,
  }));
});

ipcMain.handle('hue:setGroupState', async (_e, { bridgeIp, username, groupId, state }) => {
  const res = await fetch(`http://${bridgeIp}/api/${username}/groups/${groupId}/action`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`Pont injoignable (${res.status})`);
  return true;
});

// TP-Link Kasa — API LOCALE (2026-08-10, sur demande explicite), AUCUN compte
// cloud ni clé API, contrairement à Hue (appairage cloud discovery) et TaHoma
// (identifiants du compte TaHoma) : tout tourne en broadcast UDP/TCP sur le
// réseau local via le paquet npm `tplink-smarthome-api`, qui gère nativement
// le protocole propriétaire (chiffrement XOR, port UDP 9999) de ces appareils.
//
// Contrairement à Hue/TaHoma (simples requêtes HTTP relayées par le process
// main pour éviter le CORS), cette intégration a RÉELLEMENT besoin du process
// main : la librairie ouvre de vraies sockets UDP/TCP Node (`dgram`/`net`),
// impossibles à utiliser depuis le renderer (`contextIsolation: true`,
// `nodeIntegration: false`).
//
// `breakoutChildren` (option par défaut de la librairie, laissée à sa valeur
// par défaut `true`) : une multiprise (HS300/KP303) expose chaque prise comme
// un Plug DISTINCT dès la découverte (même `host`, un `childId` différent
// chacun) — aucune logique "enfants" à gérer à la main ici, chaque prise
// d'une multiprise est déjà un appareil autonome dans la liste retournée,
// contrôlable individuellement comme demandé.
//
// Persistance légère dans electron-store (`kasa.devices` : host/childId/
// alias/model/deviceType, PAS l'état on/off/puissance qui change en
// permanence) écrite après chaque découverte réussie (`kasa:discover`) —
// permet à `kasa:getDevices` (rafraîchissement toutes les 30s, voir
// dashboard.js MODULE_REGISTRY.kasa) de RECONNECTER directement chaque
// appareil par son host plutôt que de relancer un balayage UDP complet à
// chaque cycle (un balayage prend plusieurs secondes, bien trop lent pour un
// rafraîchissement de routine).
//
// Chaque lecture réseau (état lumière, énergie) est protégée par son propre
// try/catch dans `kasaDescribeDevice` : un appareil qui ne répond qu'à une
// partie des requêtes (firmware ancien, fonctionnalité non supportée par ce
// modèle précis) ne doit jamais faire échouer toute sa description, juste
// laisser ce champ précis à `null` — même philosophie de dégradation
// gracieuse que le reste de l'app (ex. NASA/Prêts).
//
// Non testé contre du matériel réel dans cet environnement (aucun appareil
// Kasa physique disponible ici) — implémenté à partir de la lecture directe
// des définitions TypeScript du paquet installé (`node_modules/
// tplink-smarthome-api/lib/**/*.d.ts`), pas juste la documentation en ligne,
// pour garantir des noms de méthodes/champs exacts. La vraie vérification est
// le bouton "Rechercher les appareils" de Paramètres sur le réseau réel de
// l'utilisateur.
const KASA_DISCOVERY_TIMEOUT_MS = 5000;

let kasaClient = null;
function getKasaClient() {
  if (!kasaClient) kasaClient = new TplinkClient();
  return kasaClient;
}

async function kasaDescribeDevice(device) {
  const base = {
    id: device.id,
    host: device.host,
    childId: device.childId || null,
    alias: device.alias,
    model: device.model,
    deviceType: device.deviceType,
  };

  if (device.deviceType === 'bulb') {
    let light = {};
    try {
      light = await device.lighting.getLightState();
    } catch (err) {
      console.error(`[Kasa] getLightState échoué pour "${device.alias}"`, err);
    }
    return {
      ...base,
      on: !!light.on_off,
      brightness: device.supportsBrightness ? (light.brightness ?? null) : null,
      hue: light.hue ?? null,
      saturation: light.saturation ?? null,
      colorTemp: light.color_temp ?? null,
      supportsBrightness: !!device.supportsBrightness,
      supportsColor: !!device.supportsColor,
      supportsColorTemperature: !!device.supportsColorTemperature,
    };
  }

  // Prise (deviceType 'plug') — chaque prise d'une multiprise est déjà un
  // Plug séparé grâce à breakoutChildren, `isOutlet` (childId non nul) sert
  // uniquement à l'affichage groupé côté renderer (voir kasa.js).
  let on = false;
  try {
    on = await device.getPowerState();
  } catch (err) {
    console.error(`[Kasa] getPowerState échoué pour "${device.alias}"`, err);
  }
  let power = null;
  if (device.supportsEmeter) {
    try {
      const rt = await device.emeter.getRealtime();
      power = rt?.power ?? (rt?.power_mw != null ? rt.power_mw / 1000 : null);
    } catch (err) {
      console.error(`[Kasa] emeter.getRealtime échoué pour "${device.alias}"`, err);
    }
  }
  return { ...base, on, power, supportsEmeter: !!device.supportsEmeter, isOutlet: !!device.childId };
}

ipcMain.handle('kasa:discover', async (_e, { subnet } = {}) => {
  const client = getKasaClient();
  const found = [];
  const onNew = (device) => found.push(device);
  client.on('device-new', onNew);

  try {
    client.startDiscovery({
      broadcast: subnet ? `${subnet}.255` : '255.255.255.255',
      discoveryTimeout: KASA_DISCOVERY_TIMEOUT_MS,
    });
    // Marge après discoveryTimeout : laisse le temps aux toutes dernières
    // réponses UDP en transit d'arriver avant qu'on arrête d'écouter.
    await new Promise((resolve) => setTimeout(resolve, KASA_DISCOVERY_TIMEOUT_MS + 1000));
  } finally {
    client.removeListener('device-new', onNew);
    client.stopDiscovery();
  }

  const described = (await Promise.all(found.map(d =>
    kasaDescribeDevice(d).catch(err => { console.error('[Kasa] Description d\'appareil échouée', err); return null; })
  ))).filter(Boolean);

  // Liste légère persistée (PAS l'état on/off/puissance, voir commentaire
  // au-dessus) pour permettre un refresh rapide sans rebalayer le réseau.
  const lightweight = described.map(d => ({ id: d.id, host: d.host, childId: d.childId, deviceType: d.deviceType, alias: d.alias, model: d.model }));
  safeStoreSet('kasa.devices', lightweight);

  return described;
});

ipcMain.handle('kasa:getDevices', async () => {
  const saved = store.get('kasa.devices') || [];
  const client = getKasaClient();
  return Promise.all(saved.map(async (d) => {
    try {
      const device = await client.getDevice({ host: d.host, childId: d.childId || undefined });
      return await kasaDescribeDevice(device);
    } catch (err) {
      console.error(`[Kasa] Appareil injoignable : "${d.alias}" (${d.host})`, err);
      return { ...d, on: false, power: null, unreachable: true };
    }
  }));
});

ipcMain.handle('kasa:setPower', async (_e, { host, childId, on }) => {
  const client = getKasaClient();
  const device = await client.getDevice({ host, childId: childId || undefined });
  await device.setPowerState(on);
  return true;
});

ipcMain.handle('kasa:setBulbState', async (_e, { host, state }) => {
  const client = getKasaClient();
  const device = await client.getDevice({ host });
  await device.lighting.setLightState(state);
  return true;
});

// "Tout allumer"/"Tout éteindre" (2026-08-10, sur demande explicite) —
// Promise.allSettled : un appareil hors ligne ne doit jamais empêcher les
// autres de recevoir la commande.
ipcMain.handle('kasa:turnAll', async (_e, { on }) => {
  const saved = store.get('kasa.devices') || [];
  const client = getKasaClient();
  const results = await Promise.allSettled(saved.map(async (d) => {
    const device = await client.getDevice({ host: d.host, childId: d.childId || undefined });
    return device.setPowerState(on);
  }));
  return {
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  };
});

// IKEA Trådfri — CoAP/DTLS local (2026-08-11, sur demande explicite), AUCUN
// compte cloud, mais contrairement à Kasa un VRAI appairage cryptographique
// est requis : `authenticate(code)` négocie une identité + clé pré-partagée
// (PSK) auprès de la passerelle à partir du code de sécurité imprimé dessous
// — cette étape ne peut se faire qu'une fois par code (la passerelle le
// consomme), d'où `identity`/`psk` à conserver définitivement (voir
// DEFAULT_MODULES.tradfri plus haut) pour ne plus jamais redemander le code.
//
// Contrairement à Hue/Kasa (requête ponctuelle à chaque appel), cette
// librairie fonctionne par OBSERVATION CoAP continue : `observeDevices()`/
// `observeGroupsAndScenes()` ouvrent un flux qui pousse les mises à jour en
// tâche de fond dans `client.devices`/`client.groups` tant que la connexion
// reste active — on ne "récupère" donc jamais activement l'état à chaque
// appel de `tradfri:getState`, on lit simplement le dictionnaire déjà tenu à
// jour. D'où un client CoAP mémorisé par passerelle (`getTradfriConnection`)
// plutôt qu'une reconnexion complète toutes les 30s (coûteuse : négociation
// DTLS + 2 observations initiales) — connecté UNE fois, puis réutilisé pour
// toute la durée de vie de l'app (ou jusqu'à erreur, voir le .catch qui
// réinitialise `tradfriClient` pour permettre une nouvelle tentative propre
// au prochain appel plutôt que de rester bloqué sur une promesse rejetée).
// `watchConnection: true` (option native du paquet) gère lui-même les
// coupures/reprises réseau — c'est ce qui satisfait la reconnexion
// automatique demandée, pas une logique écrite à la main ici.
//
// "Pièce" IKEA = un `Group` CoAP (`client.groups[id].group`), dont
// `deviceIDs` liste les `instanceId` des appareils qui lui appartiennent —
// aucune notion de pièce au niveau de l'appareil lui-même, la reconstituer
// exige de croiser les deux dictionnaires (voir tradfriBuildState). Les
// scènes ("Moods" dans l'app IKEA) sont elles aussi rattachées à une pièce
// (`client.groups[id].scenes`), jamais globales.
//
// Non testé contre une passerelle réelle dans cet environnement (aucune
// passerelle Trådfri physique disponible ici) — implémenté à partir de la
// lecture directe des définitions TypeScript du paquet installé
// (`node_modules/node-tradfri-client/build/**/*.d.ts`), même démarche que
// Kasa en son temps. La vraie vérification est le formulaire IP + code de
// sécurité de Paramètres → Maison sur la passerelle réelle de l'utilisateur.
let tradfriClient = null;
let tradfriConnectPromise = null;

function getTradfriConnection(gatewayIp, identity, psk) {
  if (tradfriClient && tradfriClient.hostname === gatewayIp && tradfriConnectPromise) return tradfriConnectPromise;
  if (tradfriClient) tradfriClient.destroy();
  tradfriClient = new TradfriGwClient(gatewayIp, { watchConnection: true });
  tradfriConnectPromise = (async () => {
    await tradfriClient.connect(identity, psk);
    await Promise.all([tradfriClient.observeDevices(), tradfriClient.observeGroupsAndScenes()]);
    return tradfriClient;
  })();
  tradfriConnectPromise.catch((err) => {
    console.error('[Trådfri] Connexion échouée', err);
    tradfriClient = null;
    tradfriConnectPromise = null;
  });
  return tradfriConnectPromise;
}

function tradfriFindAccessory(client, instanceId) {
  return Object.values(client.devices).find(a => a.instanceId === instanceId);
}

// Un seul champ affiché par type (`lightList[0]`/`plugList[0]`) — les
// appareils Trådfri de cette app n'exposent chacun qu'une seule "puce"
// lumière/prise (contrairement à une multiprise Kasa qui expose plusieurs
// `Plug` distincts) : la lire une fois par accessoire suffit.
function tradfriDescribeAccessory(accessory) {
  if (accessory.type === TradfriAccessoryTypes.lightbulb && accessory.lightList[0]) {
    const light = accessory.lightList[0];
    return {
      instanceId: accessory.instanceId,
      name: accessory.name,
      kind: 'bulb',
      unreachable: !accessory.alive,
      on: !!light.onOff,
      brightness: light.isDimmable ? (light.dimmer ?? null) : null,
      supportsBrightness: !!light.isDimmable,
      colorTemperature: light.colorTemperature ?? null,
      supportsColorTemp: light.spectrum === 'white' || light.spectrum === 'rgb',
    };
  }
  if (accessory.type === TradfriAccessoryTypes.plug && accessory.plugList[0]) {
    const plug = accessory.plugList[0];
    return { instanceId: accessory.instanceId, name: accessory.name, kind: 'plug', unreachable: !accessory.alive, on: !!plug.onOff };
  }
  return null; // télécommandes/capteurs/répéteurs — hors périmètre demandé (ampoules/prises/scènes uniquement)
}

// Reconstruit la vue "groupé par pièce" attendue côté renderer à partir des 2
// dictionnaires bruts de la librairie (voir commentaire au-dessus). Les
// appareils qui n'appartiennent à AUCUNE pièce (jamais rangés dans l'appli
// IKEA Home Smart) sont remontés à part plutôt que silencieusement ignorés.
function tradfriBuildState(client) {
  const allAccessories = Object.values(client.devices);
  const assignedIds = new Set();

  const rooms = Object.values(client.groups).map(({ group, scenes }) => {
    const members = group.deviceIDs.map(id => allAccessories.find(a => a.instanceId === id)).filter(Boolean);
    members.forEach(a => assignedIds.add(a.instanceId));
    return {
      id: group.instanceId,
      name: group.name,
      devices: members.map(tradfriDescribeAccessory).filter(Boolean),
      scenes: Object.values(scenes).map(s => ({ id: s.instanceId, name: s.name })),
    };
  }).filter(r => r.devices.length || r.scenes.length);

  const unassigned = allAccessories
    .filter(a => !assignedIds.has(a.instanceId))
    .map(tradfriDescribeAccessory)
    .filter(Boolean);

  return { rooms, unassigned };
}

// Relais d'authentification (2026-08-11, sur demande explicite) — même
// philosophie que 'hue:pair' : ce handler ne fait QUE négocier identité+PSK
// et les retourner, il ne les écrit PAS lui-même dans electron-store. C'est
// le renderer (config.js, comme cfg.username pour Hue) qui les place dans
// `mod.config` ; ils ne sont réellement persistés qu'au prochain "Enregistrer"
// de Paramètres — cohérent avec le reste de l'app, aucun mécanisme de
// sauvegarde parallèle à inventer ici.
ipcMain.handle('tradfri:connect', async (_e, { gatewayIp, code }) => {
  if (!gatewayIp || !code) throw new Error('IP et code de sécurité requis');
  const tempClient = new TradfriGwClient(gatewayIp);
  try {
    const { identity, psk } = await tempClient.authenticate(code);
    return { identity, psk };
  } finally {
    tempClient.destroy();
  }
});

ipcMain.handle('tradfri:getState', async (_e, { gatewayIp, identity, psk }) => {
  if (!gatewayIp || !identity || !psk) throw new Error('Passerelle Trådfri non configurée');
  const client = await getTradfriConnection(gatewayIp, identity, psk);
  return tradfriBuildState(client);
});

ipcMain.handle('tradfri:setLightState', async (_e, { gatewayIp, identity, psk, instanceId, on, brightness, colorTemperature }) => {
  const client = await getTradfriConnection(gatewayIp, identity, psk);
  const light = tradfriFindAccessory(client, instanceId)?.lightList?.[0];
  if (!light) throw new Error('Ampoule introuvable');
  if (on !== undefined) await (on ? light.turnOn() : light.turnOff());
  if (brightness !== undefined) await light.setBrightness(brightness);
  if (colorTemperature !== undefined) await light.setColorTemperature(colorTemperature);
  return true;
});

ipcMain.handle('tradfri:setPlugState', async (_e, { gatewayIp, identity, psk, instanceId, on }) => {
  const client = await getTradfriConnection(gatewayIp, identity, psk);
  const plug = tradfriFindAccessory(client, instanceId)?.plugList?.[0];
  if (!plug) throw new Error('Prise introuvable');
  await (on ? plug.turnOn() : plug.turnOff());
  return true;
});

ipcMain.handle('tradfri:activateScene', async (_e, { gatewayIp, identity, psk, groupId, sceneId }) => {
  const client = await getTradfriConnection(gatewayIp, identity, psk);
  const groupInfo = Object.values(client.groups).find(g => g.group.instanceId === groupId);
  if (!groupInfo) throw new Error('Pièce introuvable');
  await groupInfo.group.activateScene(sceneId);
  return true;
});

// "Tout allumer"/"Tout éteindre" (2026-08-11, sur demande explicite) —
// Promise.allSettled comme kasa:turnAll : un appareil hors ligne ne doit
// jamais empêcher les autres de recevoir la commande.
ipcMain.handle('tradfri:turnAll', async (_e, { gatewayIp, identity, psk, on }) => {
  const client = await getTradfriConnection(gatewayIp, identity, psk);
  const results = await Promise.allSettled(Object.values(client.devices).map(a => {
    const target = a.lightList[0] || a.plugList[0];
    if (!target) return Promise.resolve();
    return on ? target.turnOn() : target.turnOff();
  }));
  return {
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  };
});

// Prix des carburants — API officielle data.economie.gouv.fr (OpenDataSoft
// v2.1), gratuite et sans clé, vérifiée en direct le 2026-08-05 : le filtre
// géographique `within_distance(geom, geom'POINT(lon lat)', 20km)` fonctionne
// tel quel (testé sur Lyon : 86 stations dans un rayon de 10km). Champs
// aplatis confirmés sur une vraie réponse : sp95_prix/sp98_prix/gazole_prix/
// e10_prix (nombre ou null si le carburant n'est pas vendu — SP95 classique
// est souvent absent, remplacé par l'E10 dans beaucoup de stations), geom.lat/
// geom.lon, cp, ville, adresse.
//
// Rayon élargi de 15 à 20km et limite brute portée à 40 (2026-08-05, suite à
// un signalement "aucune station près du 01090") : en zone rurale peu dense,
// un rayon de 15km peut ne contenir presque aucune station, et un `limit`
// trop bas risque de tronquer les résultats de l'API avant même le tri par
// distance réel côté renderer (fuel-prices.js). Le vrai bug rapporté n'était
// en fait PAS ce rayon mais le géocodage en amont (voir fuel-prices.js) —
// élargi quand même par précaution pour les zones rurales.
const FUEL_API_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

ipcMain.handle('fuel:fetchNearby', async (_e, { lat, lon }) => {
  const where = `within_distance(geom, geom'POINT(${lon} ${lat})', 20km)`;
  const url = `${FUEL_API_URL}?where=${encodeURIComponent(where)}&limit=40&select=ville,cp,adresse,geom,sp95_prix,sp98_prix,gazole_prix,e10_prix`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Prix carburants indisponibles (${res.status})`);
  const data = await res.json();
  return data.results || [];
});

// Promos Steam — remplace l'ancien module "Jeux gratuits" (2026-08-10, sur
// demande explicite : les offres temporaires listées jusqu'ici (weekend
// gratuit) sont trop rares pour un module utile ; place à toutes les grosses
// remises en cours). Endpoint `featuredcategories` vérifié en direct
// (2026-08-10) : `specials.items` contient déjà discount_percent,
// original_price/final_price (en centimes) et discount_expiration exploitables
// directement, PAS de scraping HTML nécessaire. Limite Valve : ce endpoint
// est plafonné à 10 entrées (la sélection "à la une" de la page d'accueil
// boutique, pas une recherche exhaustive) — testé aussi `storesearch` avec
// `specials=1` en alternative, qui renvoie le même volume mais mélange des
// F2P sans remise réelle (aucun champ price) : moins fiable, non retenu.
const STEAM_FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?l=french&cc=fr';
const STEAM_PROMO_MIN_DISCOUNT = 50;

ipcMain.handle('steamPromos:fetchDeals', async () => {
  const res = await fetch(STEAM_FEATURED_URL);
  if (!res.ok) throw new Error(`Steam indisponible (${res.status})`);
  const data = await res.json();
  const items = data.specials?.items || [];
  console.log('[SteamPromos] Réponse brute specials.items:', JSON.stringify(items));

  return items
    .filter(g => g.discounted && g.discount_percent >= STEAM_PROMO_MIN_DISCOUNT)
    .sort((a, b) => b.discount_percent - a.discount_percent)
    .map(g => ({
      title: g.name,
      image: g.small_capsule_image || g.header_image || null,
      discountPercent: g.discount_percent,
      originalPrice: g.original_price,
      finalPrice: g.final_price,
      currency: g.currency || 'EUR',
      url: `https://store.steampowered.com/app/${g.id}`,
    }));
});

// Promos Epic Games — jeux gratuits + réductions, même rail promotionnel que
// l'ancien module "Jeux gratuits" avant sa suppression (2026-08-10, sur
// demande explicite de le réintroduire en module dédié, même style que Promos
// Steam ci-dessus). Endpoint freeGamesPromotions vérifié en direct : ouvert
// (pas de CORS/clé), MAIS scope limité à ~11 entrées — le rail "Jeux
// gratuits" de la boutique (jeux actuellement gratuits + quelques titres à
// venir), PAS un scan storewide de toutes les soldes Epic. Les 2 AUTRES
// sources demandées ont été testées en direct et écartées, toutes les 2
// bloquées par le même mur anti-bot Cloudflare (403 sur une requête directe
// avec User-Agent standard, contournement non tenté — hors politique) :
//   - GraphQL store.epicgames.com/graphql (utilisé par le site pour ses
//     propres recherches storewide).
//   - Page HTML store.epicgames.com/fr/deals elle-même.
// Résultat concret : ce module reflète le rail "Jeux gratuits" (gratuits +
// réductions ponctuelles de ce même rail), pas un catalogue de soldes
// storewide comme Steam — c'est la seule donnée Epic accessible sans clé ni
// contournement anti-bot.
// `discountSetting.discountPercentage` = pourcentage du prix ENCORE PAYÉ (pas
// le pourcentage de réduction) — confirmé sur les jeux gratuits actifs
// (discountPercentage: 0 ↔ prix payé = 0 ↔ gratuit). Réduction affichée =
// 100 - discountPercentage.
const EPIC_FREE_GAMES_URL = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr&country=FR&allowCountries=FR';
const EPIC_PROMO_MIN_DISCOUNT_OFF = 50; // "-50% ou plus" (hors gratuit, jamais filtré)

function epicResolveSlug(el) {
  return el.offerMappings?.[0]?.pageSlug
    || el.catalogNs?.mappings?.[0]?.pageSlug
    || el.productSlug
    || el.urlSlug
    || null;
}

// Offre ACTIVE (start <= maintenant <= end) uniquement — une offre "upcoming"
// (pas encore commencée) n'est pas disponible à l'achat/récupération
// aujourd'hui, jamais affichée (même principe que Promos Steam : pas de
// promesse d'une offre pas encore live).
function epicActiveOffer(el, now) {
  const groups = el.promotions?.promotionalOffers || [];
  for (const group of groups) {
    for (const offer of group.promotionalOffers || []) {
      const start = new Date(offer.startDate).getTime();
      const end = new Date(offer.endDate).getTime();
      if (start <= now && now <= end) return offer;
    }
  }
  return null;
}

ipcMain.handle('epicPromos:fetchDeals', async () => {
  const res = await fetch(EPIC_FREE_GAMES_URL);
  if (!res.ok) throw new Error(`Epic Games indisponible (${res.status})`);
  const data = await res.json();
  const elements = data?.data?.Catalog?.searchStore?.elements || [];
  console.log('[EpicPromos] Réponse brute elements :', JSON.stringify(elements));
  const now = Date.now();

  return elements
    .map(el => ({ el, offer: epicActiveOffer(el, now) }))
    .filter(({ offer }) => offer)
    .map(({ el, offer }) => {
      const payPercent = offer.discountSetting?.discountPercentage;
      const isFree = payPercent === 0;
      const discountPercent = typeof payPercent === 'number' ? 100 - payPercent : null;
      const slug = epicResolveSlug(el);
      return {
        title: el.title,
        image: el.keyImages?.find(i => i.type === 'OfferImageWide')?.url || el.keyImages?.find(i => i.type === 'Thumbnail')?.url || el.keyImages?.[0]?.url || null,
        isFree,
        discountPercent,
        originalPrice: el.price?.totalPrice?.originalPrice ?? 0,
        finalPrice: el.price?.totalPrice?.discountPrice ?? 0,
        currency: el.price?.totalPrice?.currencyCode || 'EUR',
        url: slug ? `https://store.epicgames.com/fr/p/${slug}` : 'https://store.epicgames.com/fr/free-games',
      };
    })
    .filter(g => g.isFree || (g.discountPercent != null && g.discountPercent >= EPIC_PROMO_MIN_DISCOUNT_OFF))
    .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
});

// Suivi de colis — scraping direct des pages de suivi publiques des
// transporteurs (2026-08-05, sur demande explicite, remplace 17TRACK/
// AfterShip) : plus de clé API, plus de compte, plus de quota. Aucun IPC
// dédié nécessaire ici — le renderer (parcels.js) réutilise directement le
// canal générique `rss:fetchFeed` ci-dessus (proxy sans restriction CORS côté
// process main) pour la cascade jina.ai Reader → allorigins.win → fetch
// direct, exactement comme le module ETF (voir etf.js). Détection du
// transporteur et construction des URL dans renderer/modules/
// parcels-carriers.js (partagé avec la page de config).

// Cinéma — scraping direct d'AlloCiné (2026-08-05, sur demande explicite,
// remplace TMDb : plus de clé API). Aucun IPC dédié : le renderer
// (cinema.js) réutilise directement `rss:fetchFeed` ci-dessus pour la
// cascade fetch direct → allorigins.win → jina.ai Reader.

// Google OAuth
ipcMain.handle('google:getToken', () => store.get('google'));
ipcMain.handle('google:setToken', (_e, tokenData) => {
  safeStoreSet('google', tokenData);
  if (mainWindow) mainWindow.webContents.send('google:tokenUpdated', tokenData);
  return true;
});
ipcMain.handle('google:login', async () => {
  const tokenData = await runGoogleAuthFlow();
  safeStoreSet('google', tokenData);
  if (mainWindow) mainWindow.webContents.send('google:tokenUpdated', tokenData);
  return tokenData;
});
ipcMain.handle('google:logout', () => {
  safeStoreSet('google', { accessToken: null, refreshToken: null, expiresAt: null, email: null });
  if (mainWindow) mainWindow.webContents.send('google:tokenUpdated', null);
  return true;
});

// Renvoie un accessToken garanti valide — rafraîchit via refreshToken si le
// token stocké a expiré (durée de vie standard Google : 1h). Sans ça, tout
// appel aux API Calendar/Gmail échoue en 401 dès que la session dépasse 1h.
// Extraite en fonction nommée (2026-08-21, pour le Sync Google Drive plus
// bas) : `performDriveLaunchSync`/`scheduleDriveUploadAfterChange` ont
// besoin du MÊME token garanti valide, sans passer par un aller-retour IPC
// vers son propre process (ipcMain.handle n'est appelable que depuis un
// renderer) — `ipcMain.handle('google:getValidToken', ...)` délègue
// maintenant à cette fonction plutôt que de dupliquer sa logique.
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
async function getValidGoogleToken() {
  const current = store.get('google');
  if (!current?.accessToken) return current;

  if (current.expiresAt && current.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    return current;
  }

  if (!current.refreshToken) {
    safeStoreSet('google', { accessToken: null, refreshToken: null, expiresAt: null, email: null });
    if (mainWindow) mainWindow.webContents.send('google:tokenUpdated', null);
    return null;
  }

  try {
    const refreshed = await refreshAccessToken(current.refreshToken);
    const updated = { ...current, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
    safeStoreSet('google', updated);
    if (mainWindow) mainWindow.webContents.send('google:tokenUpdated', updated);
    return updated;
  } catch (err) {
    console.error('[Google OAuth] Échec du rafraîchissement du token', err);
    safeStoreSet('google', { accessToken: null, refreshToken: null, expiresAt: null, email: null });
    if (mainWindow) mainWindow.webContents.send('google:tokenUpdated', null);
    return null;
  }
}
ipcMain.handle('google:getValidToken', getValidGoogleToken);

// Spotify OAuth — store séparé de Google (voir spotify-oauth.js), même schéma
// de rafraîchissement automatique du token.
ipcMain.handle('spotify:getToken', () => store.get('spotify'));
ipcMain.handle('spotify:setToken', (_e, tokenData) => {
  safeStoreSet('spotify', tokenData);
  if (mainWindow) mainWindow.webContents.send('spotify:tokenUpdated', tokenData);
  return true;
});
ipcMain.handle('spotify:login', async () => {
  const tokenData = await runSpotifyAuthFlow();
  safeStoreSet('spotify', tokenData);
  if (mainWindow) mainWindow.webContents.send('spotify:tokenUpdated', tokenData);
  return tokenData;
});
ipcMain.handle('spotify:logout', () => {
  safeStoreSet('spotify', { accessToken: null, refreshToken: null, expiresAt: null, email: null, displayName: null });
  if (mainWindow) mainWindow.webContents.send('spotify:tokenUpdated', null);
  return true;
});
ipcMain.handle('spotify:getValidToken', async () => {
  const current = store.get('spotify');
  if (!current?.accessToken) return current;

  if (current.expiresAt && current.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    return current;
  }

  if (!current.refreshToken) {
    safeStoreSet('spotify', { accessToken: null, refreshToken: null, expiresAt: null, email: null, displayName: null });
    if (mainWindow) mainWindow.webContents.send('spotify:tokenUpdated', null);
    return null;
  }

  try {
    const refreshed = await refreshSpotifyAccessToken(current.refreshToken);
    const updated = { ...current, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt };
    safeStoreSet('spotify', updated);
    if (mainWindow) mainWindow.webContents.send('spotify:tokenUpdated', updated);
    return updated;
  } catch (err) {
    console.error('[Spotify OAuth] Échec du rafraîchissement du token', err);
    safeStoreSet('spotify', { accessToken: null, refreshToken: null, expiresAt: null, email: null, displayName: null });
    if (mainWindow) mainWindow.webContents.send('spotify:tokenUpdated', null);
    return null;
  }
});

// ─── Sync Google Drive — sauvegarde/restauration automatique de matin-userdata
// (2026-08-21, sur demande explicite) ───────────────────────────────────────
// Synchronise UNIQUEMENT `userdataStore` (voir USERDATA_MODULE_KEYS/
// matin-userdata plus haut : ETF, Crypto, Prêts, les 3 modules FDJ, Podcasts,
// Rappels) — jamais `store`/matin-config (tokens OAuth, position de fenêtre,
// disposition des cartes, thème...), qui reste strictement local à CETTE
// installation. Stocké dans le dossier caché "appDataFolder" de Drive (scope
// `drive.appdata`, voir google-oauth.js) : invisible dans le Drive normal de
// l'utilisateur, lisible/écrivable UNIQUEMENT par Matin, jamais par une autre
// appli ni consultable manuellement sur drive.google.com.
//
// AUCUNE toggle Paramètres dédiée : la synchronisation suit simplement l'état
// de connexion Google déjà existant (connecté = synchronise, déconnecté =
// ignore silencieusement, point 6 de la demande) — cohérent avec le fait que
// Calendar/Gmail/Tâches/Anniversaires/YouTube fonctionnent déjà de la même
// façon, sans interrupteur séparé.
const DRIVE_FILE_NAME = 'matin-userdata.json';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// Pousse un événement au dashboard pour l'indicateur "✓ Données synchronisées"
// (voir index.html/dashboard.js, .drive-sync-indicator) — mémorisé aussi dans
// `lastDriveSyncStatus` pour le cas où le dashboard n'a pas encore fini de
// charger/enregistrer son écouteur au moment où la sync de lancement termine
// (course possible : la sync réseau peut techniquement se terminer avant que
// le renderer ait exécuté son DOMContentLoaded, même si peu probable vu la
// latence réseau en jeu) — `driveSync:getLastStatus` (IPC ci-dessous) permet
// au dashboard de rattraper un statut manqué au premier rendu.
let lastDriveSyncStatus = null;
function notifyDriveSync(status) {
  lastDriveSyncStatus = { ...status, at: Date.now() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('drive:syncStatus', lastDriveSyncStatus);
  }
}
ipcMain.handle('driveSync:getLastStatus', () => lastDriveSyncStatus);

// Recherche le fichier matin-userdata.json dans appDataFolder (il n'y a qu'un
// seul fichier de ce nom possible côté Matin, mais Drive n'empêche pas
// techniquement les doublons de nom — `files[0]` suffit ici, jamais créé
// plus d'une fois par ce code). `null` si absent (1er lancement avec ce
// compte, ou appData jamais initialisée).
async function driveFindUserdataFile(accessToken) {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive (recherche) ${res.status}`);
  const data = await res.json();
  return (data.files && data.files[0]) || null;
}

async function driveDownloadUserdata(accessToken, fileId) {
  const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive (téléchargement) ${res.status}`);
  return res.json();
}

// Crée le fichier (multipart, seul moyen de poser `parents`/`name` en même
// temps que le contenu) s'il n'existe pas encore (`fileId` absent), sinon
// remplace juste son contenu (media seul, `name`/`parents` ne changent
// jamais après création). Pas de dépendance `form-data` : le corps multipart
// est construit à la main, format simple et stable (2 parties, JSON pur des
// deux côtés).
async function driveUploadUserdata(accessToken, fileId) {
  const content = JSON.stringify(userdataStore.store);

  if (fileId) {
    const res = await fetch(`${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: content,
    });
    if (res.status === 404) return driveUploadUserdata(accessToken, null); // fileId caché périmé (supprimé côté Drive) — recrée
    if (!res.ok) throw new Error(`Drive (envoi) ${res.status}`);
    return res.json();
  }

  const boundary = 'matin-drive-sync-boundary';
  const metadata = JSON.stringify({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive (création) ${res.status}`);
  return res.json();
}

// Remplace `userdataStore` par le contenu téléchargé — tolère un fichier
// distant qui serait déjà `{ modules: {...} }` (format normal, ce que ce
// code écrit) ou, par prudence, un objet `modules` nu (jamais écrit par ce
// code mais coûte rien à accepter). `backupStoreBeforeWrite` avant
// d'écraser, comme tout autre remplacement complet du store dans ce fichier
// (voir backups:restore). Pousse `modules:updated` pour un re-rendu en
// place — PAS de `mainWindow.reload()` (contrairement à backups:restore,
// une action manuelle explicite) : une restauration automatique au
// lancement doit rester invisible/silencieuse (point 3 de la demande),
// jamais un rechargement de page perceptible.
function driveApplyDownloadedUserdata(data) {
  if (!data || typeof data !== 'object') return;
  const modules = data.modules && typeof data.modules === 'object' ? data.modules : data;
  backupStoreBeforeWrite();
  userdataStore.set('modules', modules);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('modules:updated', getMergedModules());
  }
}

// Upload silencieux de l'état ACTUEL de matin-userdata — utilisé à la fois
// par la sync de lancement (aucune version distante, ou version locale plus
// récente) et par le debounce déclenché après chaque changement de donnée
// (voir scheduleDriveUploadAfterChange plus bas). Jamais de notifyDriveSync
// ici : silencieux par design (point 3 de la demande), seule la sync de
// LANCEMENT affiche l'indicateur (point 4).
async function driveUploadCurrent(accessToken) {
  let fileId = store.get('driveSync.fileId') || null;
  const result = await driveUploadUserdata(accessToken, fileId);
  store.set('driveSync.fileId', result.id);
  return result;
}

// ─── Upload différé après changement de donnée (point 3 de la demande) ─────
// Debounce avec plafond dur : coalesce les écritures rapprochées (plusieurs
// champs modifiés en quelques secondes dans Paramètres) en UN seul upload,
// tout en garantissant qu'il parte au plus tard 30s après le TOUT PREMIER
// changement en attente — jamais repoussé indéfiniment par des changements
// continus (contrairement à un debounce simple sans plafond).
const DRIVE_UPLOAD_SETTLE_MS = 5 * 1000;
const DRIVE_UPLOAD_MAX_WAIT_MS = 30 * 1000;
let driveUploadTimer = null;
let driveUploadFirstPendingAt = null;

function scheduleDriveUploadAfterChange() {
  const now = Date.now();
  if (!driveUploadFirstPendingAt) driveUploadFirstPendingAt = now;
  if (driveUploadTimer) clearTimeout(driveUploadTimer);

  const waited = now - driveUploadFirstPendingAt;
  const delay = Math.min(DRIVE_UPLOAD_SETTLE_MS, Math.max(0, DRIVE_UPLOAD_MAX_WAIT_MS - waited));
  driveUploadTimer = setTimeout(() => {
    driveUploadTimer = null;
    driveUploadFirstPendingAt = null;
    (async () => {
      const token = await getValidGoogleToken();
      if (!token?.accessToken) return; // pas connecté (point 6) — ignoré silencieusement
      try {
        const result = await driveUploadCurrent(token.accessToken);
        console.log('[Drive Sync] Upload différé réussi', result.id, result.modifiedTime);
      } catch (err) {
        console.error('[Drive Sync] Échec de l’upload différé', err);
      }
    })();
  }, delay);
}

// ─── Sync au lancement (points 2, 4 et 5 de la demande) ────────────────────
// Appelée une seule fois par lancement, APRÈS autoRestoreUserdataIfEmpty
// (déjà exécutée de façon synchrone plus haut dans ce fichier au chargement
// du module) : évalue donc l'état local FINAL de la session, restauration
// locale automatique déjà prise en compte le cas échéant.
async function performDriveLaunchSync() {
  const token = await getValidGoogleToken();
  if (!token?.accessToken) {
    // point 6 : pas de compte Google connecté, ignoré silencieusement CÔTÉ
    // UTILISATEUR (aucune UI, aucun blocage) — ce log reste réservé à la
    // console développeur, dans le même esprit que les logs d'état déjà en
    // place pour chaque module (FDJ, RSS, Promos...).
    console.log('[Drive Sync] Google non connecté — synchronisation ignorée');
    return;
  }

  try {
    const remote = await driveFindUserdataFile(token.accessToken);

    if (!remote) {
      // Rien sur Drive pour ce compte — 1re synchronisation, envoie l'état local actuel.
      await driveUploadCurrent(token.accessToken);
      notifyDriveSync({ type: 'synced' });
      return;
    }
    store.set('driveSync.fileId', remote.id);

    const localEmpty = isUserdataEmpty();
    if (localEmpty) {
      // Drive a des données, le local n'en a pas — restauration automatique.
      const data = await driveDownloadUserdata(token.accessToken, remote.id);
      driveApplyDownloadedUserdata(data);
      notifyDriveSync({ type: 'synced' });
      return;
    }

    // Local ET Drive ont tous deux des données — comparaison des horodatages
    // réels (mtime du fichier matin-userdata.json sur disque, modifiedTime
    // renvoyé par Drive) plutôt qu'un horodatage maison à maintenir en
    // parallèle : toujours exact, mis à jour par electron-store/Drive
    // eux-mêmes à chaque écriture, aucun risque de désynchronisation.
    const localMtimeMs = fs.existsSync(userdataStore.path) ? fs.statSync(userdataStore.path).mtimeMs : 0;
    const remoteMtimeMs = new Date(remote.modifiedTime).getTime();
    const deltaMs = Math.abs(remoteMtimeMs - localMtimeMs);
    const CONFLICT_WINDOW_MS = 60 * 60 * 1000; // point 5 : conflit si les 2 changées à moins d'1h d'écart

    // Point 5 : en cas de conflit potentiel (fenêtre d'1h), Drive gagne
    // systématiquement (>=, pas seulement >, pour trancher aussi une égalité
    // exacte en faveur de Drive comme demandé). Hors fenêtre de conflit :
    // simplement la version la plus récente qui l'emporte (point 2).
    const driveWins = deltaMs <= CONFLICT_WINDOW_MS ? remoteMtimeMs >= localMtimeMs : remoteMtimeMs > localMtimeMs;

    if (driveWins) {
      const data = await driveDownloadUserdata(token.accessToken, remote.id);
      driveApplyDownloadedUserdata(data);
    } else {
      await driveUploadCurrent(token.accessToken);
    }
    notifyDriveSync({ type: 'synced' });
  } catch (err) {
    console.error('[Drive Sync] Échec de la synchronisation au lancement', err);
  }
}

// ─── Rappels — vérification + notification Windows native ─────────────────────
// Tourne côté process main plutôt que dans le renderer : un setInterval côté
// renderer est throttlé par Chromium (backgroundThrottling) quand la fenêtre
// est minimisée/masquée, ce qui casserait justement l'exigence "fonctionne
// même minimisé" — le process main, lui, n'est jamais throttlé et reste actif
// tant que l'appli tourne, fenêtre visible ou non.
//
// Copie minimale des emojis de reminders-categories.js (window global côté
// renderer, pas un module CommonJS require()-able ici) — à garder synchronisée
// si la liste de catégories change.
const REMINDER_ICONS = { health: '💊', call: '📞', task: '🔧', birthday: '🎂', other: '⏰' };

function remindersPad2(n) { return String(n).padStart(2, '0'); }
function remindersDateStr(d) { return `${d.getFullYear()}-${remindersPad2(d.getMonth() + 1)}-${remindersPad2(d.getDate())}`; }

// Le rappel déclenche-t-il MAINTENANT ? `lastFired` (date du jour où il a
// déjà notifié) empêche un double envoi si l'intervalle de vérification (30s,
// voir plus bas) retombe deux fois sur la même minute cible, et empêche un
// rappel récurrent de renotifier plusieurs fois le même jour.
function reminderIsDueNow(item, nowDate, nowDateStr, nowHH, nowMM) {
  const [rH, rM] = (item.time || '00:00').split(':').map(Number);
  if (rH !== nowHH || rM !== nowMM) return false;
  if (item.lastFired === nowDateStr) return false;

  if (!item.recurrence || item.recurrence === 'once') return item.date === nowDateStr;
  if (item.recurrence === 'daily') return true;

  if (!item.date) return false;
  const ref = new Date(`${item.date}T00:00:00`);
  if (item.recurrence === 'weekly') return ref.getDay() === nowDate.getDay();
  if (item.recurrence === 'monthly') {
    const targetDay = ref.getDate();
    // Rappel du 31 dans un mois de 30 jours (ou février) : se cale sur le
    // dernier jour du mois plutôt que de ne jamais se déclencher ce mois-là.
    const lastDayThisMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
    return Math.min(targetDay, lastDayThisMonth) === nowDate.getDate();
  }
  return false;
}

// "reminders" est une clé userdata (voir USERDATA_MODULE_KEYS, 2026-08-10) —
// lu/écrit dans matin-userdata, pas matin-config.
function checkReminders() {
  const items = userdataStore.get('modules.reminders.config.items');
  if (!Array.isArray(items) || !items.length) return;

  const nowDate = new Date();
  const nowDateStr = remindersDateStr(nowDate);
  const nowHH = nowDate.getHours();
  const nowMM = nowDate.getMinutes();

  let changed = false;
  for (const item of items) {
    if (!reminderIsDueNow(item, nowDate, nowDateStr, nowHH, nowMM)) continue;

    if (Notification.isSupported()) {
      try {
        new Notification({
          title: `${REMINDER_ICONS[item.icon] || '⏰'} ${item.title || 'Rappel'}`,
          body: item.time || '',
        }).show();
      } catch (err) {
        console.error('[Rappels] Échec notification', err);
      }
    } else {
      console.warn('[Rappels] Notifications natives non supportées sur cette machine');
    }

    item.lastFired = nowDateStr;
    changed = true;
  }

  // Persisté seulement si au moins un rappel a effectivement notifié — évite
  // une écriture disque à chaque tick de 30s pour rien.
  if (changed) {
    backupStoreBeforeWrite();
    userdataStore.set('modules.reminders.config.items', items);
    scheduleDriveUploadAfterChange(); // voir Sync Google Drive plus bas
  }
}

// Vérifié toutes les 30s (pas 60s malgré la consigne "check every minute") :
// un setInterval(fn, 60000) dérive légèrement au fil du temps (le délai entre
// deux appels n'est jamais exactement 60000ms) et pourrait sauter la minute
// exacte ciblée par un rappel. Vérifier deux fois par minute élimine ce risque
// sans jamais notifier deux fois (voir le garde-fou `lastFired` ci-dessus) —
// c'est donc une vérification AU MOINS chaque minute, en plus fiable.
const REMINDERS_CHECK_MS = 30 * 1000;

// ─── Alertes — bandeau plein écran (enlèvement, météo, Vigipirate, rappels) ────
// Même principe que les rappels ci-dessus : tourne côté process main (fetch
// direct, notifications natives jamais throttlées même fenêtre minimisée),
// pousse l'état calculé au renderer plutôt que de le laisser fetcher lui-même
// — la comparaison "alerte nouvelle ?" pour les notifications vit de toute
// façon au même endroit que le dernier état connu.
//
// SOURCES VÉRIFIÉES EN DIRECT LE 2026-08-08 :
//  - Alerte enlèvement : le domaine demandé (www.alerteenlevement.gouv.fr,
//    sans tiret) n'existe pas (échec DNS). La vraie URL est
//    alerte-enlevement.gouv.fr (AVEC tiret), qui redirige vers
//    www.alerte-enlevement.justice.gouv.fr — utilisée directement ci-dessous.
//    Aucun indicateur structuré "alerte active" trouvé sur cette page (sa
//    page d'accueil est l'explicatif générique du dispositif tant qu'aucune
//    alerte n'est diffusée, titre connu "Le dispositif Alerte enlèvement") :
//    heuristique par comparaison de titre — tout titre DIFFÉRENT de cette
//    baseline est traité comme une alerte potentiellement active. Jamais
//    vérifiable en conditions réelles (par nature un évènement rare, aucune
//    alerte active au moment du développement) — à surveiller au premier cas
//    réel, la structure de page pourrait différer de ce qui est supposé ici.
//  - Vigipirate : l'URL demandée fonctionne telle quelle. Pas d'API
//    structurée, mais la page contient la phrase "Positionnée au [nouveau]
//    stade «X»" qui donne le niveau RÉELLEMENT en vigueur (vérifié en
//    direct : "vigilance renforcée" au moment du test) — extrait par regex.
//  - Rappel Conso : l'URL demandée (rappel.conso.gouv.fr/api/v1/recall) est
//    un vrai 404. Les données réelles sont publiées sur le catalogue
//    OpenDataSoft data.economie.gouv.fr (même plateforme déjà utilisée pour
//    les prix carburants, voir FUEL_API_URL) sous le jeu
//    "rappelconso-v2-gtin-espaces" — trouvé via son catalogue de recherche,
//    vérifié en direct (18000+ fiches, champs confirmés : date_publication/
//    libelle/categorie_produit/risques_encourus/lien_vers_la_fiche_rappel).
//    Ce jeu n'a PAS de champ de gravité structuré : "rappels récents"
//    interprété comme les 7 derniers jours plutôt qu'un vrai filtre de
//    criticité (qui n'existe simplement pas dans la donnée disponible).
//  - Vigilance météo : l'URL demandée renvoie bien 401 "you must provide a
//    token" — nécessite une clé API Météo France gratuite
//    (portail-api.meteofrance.fr), même schéma que NASA_API_KEY (.env).
//    AUCUNE clé disponible pour tester en conditions réelles : implémentée
//    sur la convention d'authentification/réponse la plus documentée
//    (en-tête `apikey`, `color_id` 1-4 par département), NON VÉRIFIÉE — à
//    corriger au premier usage réel si le format diffère, même statut que
//    Colissimo/Amazon (voir plus haut dans ce fichier, module Colis).
const ALERTS_CHECK_MS = 15 * 60 * 1000;

const ALERTS_VIGIPIRATE_URL = 'https://www.sgdsn.gouv.fr/vigipirate';
const ALERTS_ENLEVEMENT_URL = 'https://www.alerte-enlevement.justice.gouv.fr/';
// limit=50 : marge de sécurité au-delà des ~17 fiches/48h mesurées en direct
// (voir ALERTS_RAPPELCONSO_WINDOW_H) pour ne jamais tronquer la fenêtre un
// jour de volume plus élevé que la normale.
const ALERTS_RAPPELCONSO_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso-v2-gtin-espaces/records?limit=50&order_by=date_publication%20desc';
const ALERTS_METEO_URL = 'https://webservice.meteofrance.com/vigilance/v3/vigicarteDept';
const ALERTS_ENLEVEMENT_BASELINE_TITLE = 'Le dispositif Alerte enlèvement';

async function alertsFetchText(url, extraHeaders) {
  const res = await fetch(url, extraHeaders ? { headers: extraHeaders } : undefined);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function alertsCheckVigipirate() {
  const html = await alertsFetchText(ALERTS_VIGIPIRATE_URL);
  const m = html.match(/Positionn[ée]e? au[^«]*«\s*(?:&nbsp;)?\s*([^»]+?)\s*(?:&nbsp;)?\s*»/i);
  if (!m) return null;
  const stage = m[1].replace(/&nbsp;/g, ' ').trim().toLowerCase();
  if (stage === 'vigilance') return null; // niveau de base, pas une alerte à signaler
  const severity = stage.includes('attentat') ? 'red' : 'orange';
  return {
    id: `vigipirate:${stage}`,
    severity,
    icon: '🔴',
    text: `Vigipirate — stade « ${stage} »`,
    link: ALERTS_VIGIPIRATE_URL,
  };
}

async function alertsCheckEnlevement() {
  const html = await alertsFetchText(ALERTS_ENLEVEMENT_URL);
  const m = html.match(/<meta property="og:title" content="([^"]+)"/i);
  const title = m ? m[1].trim() : null;
  if (!title || title === ALERTS_ENLEVEMENT_BASELINE_TITLE) return null;
  return {
    id: `enlevement:${title}`,
    severity: 'red',
    icon: '🚸',
    text: `Alerte enlèvement en cours — ${title}`,
    link: ALERTS_ENLEVEMENT_URL,
  };
}

// RappelConso publie très fréquemment (58 fiches en 7 jours mesuré en
// direct, ~6-17/jour) : lister une ligne de bandeau par fiche noierait
// complètement l'alerte sous le volume. Le jeu n'a par ailleurs AUCUN champ
// de gravité structuré à filtrer dessus (voir avertissement en-tête de
// section). Compromis retenu : UNE seule ligne agrégée ("N rappels récents"),
// fenêtre resserrée à 48h (17 fiches mesuré, déjà beaucoup mais restant
// lisible en une ligne) plutôt que 7 jours, lien vers le site officiel pour
// le détail. `id` basé sur la fiche la PLUS RÉCENTE (pas sur le compte) :
// une nouvelle fiche fait toujours changer cet id même si le total reste
// coïncidemment identique, donc redéclenche bien une notification.
const ALERTS_RAPPELCONSO_WINDOW_H = 48;

async function alertsCheckRappelConso() {
  const text = await alertsFetchText(ALERTS_RAPPELCONSO_URL);
  const data = JSON.parse(text);
  const cutoff = Date.now() - ALERTS_RAPPELCONSO_WINDOW_H * 3600000;
  const recent = (data.results || []).filter(r => r.date_publication && new Date(r.date_publication).getTime() >= cutoff);
  if (!recent.length) return [];

  const mostRecent = recent[0]; // déjà trié desc par date_publication (order_by de la requête)
  const count = recent.length;
  return [{
    id: `rappel:${mostRecent.id ?? mostRecent.numero_fiche}`,
    severity: 'orange',
    icon: '🏥',
    text: `${count} rappel${count > 1 ? 's' : ''} produit${count > 1 ? 's' : ''} récent${count > 1 ? 's' : ''} (48h) — dernier : ${mostRecent.libelle || 'voir détail'}`,
    link: 'https://rappel.conso.gouv.fr/',
  }];
}

async function alertsCheckMeteo() {
  const apiKey = process.env.METEOFRANCE_API_KEY;
  const department = store.get('modules.alerts.config.department');
  if (!apiKey || !department) return [];

  const url = `${ALERTS_METEO_URL}?domain=${encodeURIComponent(department)}`;
  const text = await alertsFetchText(url, { apikey: apiKey });
  const data = JSON.parse(text);
  // Structure de réponse présumée (NON vérifiée, voir avertissement en-tête
  // de section) — cascade de chemins plausibles pour encaisser une structure
  // légèrement différente sans planter plutôt qu'un seul chemin rigide.
  const domains = data?.product?.periods?.[0]?.timelaps?.domain_ids
    || data?.periods?.[0]?.timelaps?.domain_ids
    || [];
  const entry = domains.find(d => String(d.domain_id) === String(department));
  const colorId = entry?.color_id ?? entry?.colorId;
  // Échelle couleur Météo France documentée : 1=vert, 2=jaune, 3=orange, 4=rouge.
  if (colorId !== 3 && colorId !== 4) return [];
  const severity = colorId === 4 ? 'red' : 'orange';
  return [{
    id: `meteo:${department}:${colorId}`,
    severity,
    icon: '🌪️',
    text: `Vigilance météo ${severity === 'red' ? 'rouge' : 'orange'} — département ${department}`,
    link: 'https://vigilance.meteofrance.fr/',
  }];
}

let alertsKnownIds = new Set(store.get('alertsCache.knownIds') || []);
let alertsCurrent = [];

async function checkAlerts() {
  const mod = store.get('modules.alerts');
  if (!mod || !mod.enabled) {
    alertsCurrent = [];
    if (mainWindow) mainWindow.webContents.send('alerts:updated', []);
    return alertsCurrent;
  }

  const types = mod.config?.types || {};
  const checks = [];
  if (types.vigipirate !== false) {
    checks.push(alertsCheckVigipirate().then(a => a ? [a] : [])
      .catch(err => { console.warn('[Alertes] Vigipirate indisponible', err.message); return []; }));
  }
  if (types.enlevement !== false) {
    checks.push(alertsCheckEnlevement().then(a => a ? [a] : [])
      .catch(err => { console.warn('[Alertes] Alerte enlèvement indisponible', err.message); return []; }));
  }
  if (types.rappels !== false) {
    checks.push(alertsCheckRappelConso()
      .catch(err => { console.warn('[Alertes] RappelConso indisponible', err.message); return []; }));
  }
  if (types.meteo !== false) {
    checks.push(alertsCheckMeteo()
      .catch(err => { console.warn('[Alertes] Vigilance météo indisponible', err.message); return []; }));
  }

  const results = await Promise.all(checks);
  const alerts = results.flat();

  const currentIds = new Set(alerts.map(a => a.id));
  for (const alert of alerts) {
    if (alertsKnownIds.has(alert.id)) continue;
    if (Notification.isSupported()) {
      try {
        new Notification({ title: `${alert.icon} Nouvelle alerte`, body: alert.text }).show();
      } catch (err) {
        console.error('[Alertes] Échec notification', err);
      }
    }
  }
  alertsKnownIds = currentIds;
  safeStoreSet('alertsCache.knownIds', Array.from(currentIds));

  alertsCurrent = alerts;
  if (mainWindow) mainWindow.webContents.send('alerts:updated', alerts);
  return alerts;
}

ipcMain.handle('alerts:getCurrent', () => alertsCurrent);

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  performDriveLaunchSync().catch(err => console.error('[Drive Sync] Échec inattendu de la synchronisation au lancement', err));
  checkReminders();
  setInterval(checkReminders, REMINDERS_CHECK_MS);
  checkAlerts();
  setInterval(checkAlerts, ALERTS_CHECK_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
