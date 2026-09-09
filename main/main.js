const { app, BrowserWindow, ipcMain, shell, nativeTheme, Notification, screen, Menu, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client: TplinkClient } = require('tplink-smarthome-api'); // TP-Link Kasa (broadcast UDP/TCP local, voir ipcMain.handle('kasa:...'))
const { TradfriClient: TradfriGwClient, AccessoryTypes: TradfriAccessoryTypes } = require('node-tradfri-client'); // IKEA Trådfri (CoAP/DTLS local, voir ipcMain.handle('tradfri:...'))
const Store = require('electron-store');
const { runGoogleAuthFlow, refreshAccessToken } = require('./auth/google-oauth');
const { runSpotifyAuthFlow, refreshAccessToken: refreshSpotifyAccessToken } = require('./auth/spotify-oauth');
const { runHueAuthFlow, refreshHueAccessToken } = require('./auth/hue-oauth');

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

// ─── Migration du dossier de données : matin-windows → matin-app (2026-08-30,
// sur demande explicite — `name` de package.json renommé, voir plus bas) ────
// `app.getPath('userData')` dérive du champ `name` de package.json (voir le
// log de diagnostic historique plus bas, "ETF/Crypto perdus via Matin.bat") —
// renommer ce champ déplace donc TOUT le dossier de données (matin-config,
// matin-userdata, backups/, tokens OAuth...) vers un NOUVEAU chemin
// (%AppData%\matin-app au lieu de %AppData%\matin-windows), invisible sous
// l'ancien nom. Sans cette migration, une installation existante perdrait
// l'ACCÈS à toutes ses données dès ce lancement — les fichiers resteraient
// sur disque sous l'ancien dossier, mais l'app ne les y chercherait plus —
// exactement le type d'incident déjà vécu avec ce même dossier (voir
// CONTEXT.md, protection anti-perte du 2026-08-30).
//
// EXÉCUTÉE ICI, avant toute construction de Store plus bas : `new Store(...)`
// crée son fichier dès sa construction, donc la migration doit être terminée
// AVANT ce point pour que le tout premier `store.get(...)` voie déjà les
// vraies données copiées, pas un store neuf vide.
//
// COPIE (jamais un déplacement/suppression) : l'ancien dossier reste intact
// comme filet de sécurité — coûte quelques Mo de disque contre un risque de
// perte de données bien plus grave. Ne s'exécute QUE si le NOUVEAU dossier
// n'a PAS DÉJÀ de vraies données ET que l'ANCIEN existe : idempotent (sans
// effet sur une installation déjà migrée) et sans effet sur une toute
// nouvelle installation qui n'a jamais connu l'ancien nom (rien à copier).
//
// PIÈGE VÉRIFIÉ EN DIRECT (2026-08-31) : `fs.existsSync(newDir)` seul est
// un mauvais test de "déjà migré" — Chromium crée LUI-MÊME le dossier
// `userData` (Cache/, Preferences, Local State...) dans le cadre de son
// propre bootstrap natif, AVANT même la première ligne de ce script, donc
// TOUJOURS vrai dès le 1er lancement sous le nouveau nom, migré ou pas.
// Testé en conditions réelles : avec ce seul test, la copie ne se déclenchait
// JAMAIS — l'app démarrait avec un store neuf 100% par défaut (token Google
// perdu, disposition des cartes réinitialisée...) sous le nouveau dossier,
// alors que l'ancien contenait les vraies données. Corrigé en testant la
// présence de `matin-config.json` PRÉCISÉMENT (jamais créé par Chromium
// lui-même, seulement par ce code) plutôt que le dossier dans son ensemble.
function migrateUserDataFolderIfNeeded() {
  const oldDir = path.join(app.getPath('appData'), 'matin-windows');
  const newDir = app.getPath('userData'); // résout déjà vers ".../matin-app" (voir package.json)
  const alreadyMigrated = fs.existsSync(path.join(newDir, 'matin-config.json'));
  if (alreadyMigrated || !fs.existsSync(oldDir)) return;
  try {
    fs.cpSync(oldDir, newDir, { recursive: true });
    console.log('[Matin] Migration du dossier de données utilisateur — copié', oldDir, '→', newDir);
  } catch (err) {
    console.error('[Matin] Échec de la migration du dossier de données (matin-windows → matin-app)', err);
  }
}
migrateUserDataFolderIfNeeded();

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
  // Suivi de prix Marchand (2026-08-30, sur demande explicite) — jusqu'à 10
  // produits (URL Amazon.fr + libellé + prix cible), voir renderer/modules/
  // price-tracking.js pour le scraping (jina.ai) et plus bas dans ce fichier
  // pour la persistance/notification (priceTracking:reportPrices). Dans
  // USERDATA_MODULE_KEYS (voir plus haut) : `items` porte le dernier prix
  // connu par produit, mérite la même protection anti-perte/backup/sync que
  // ETF/Crypto plutôt que de vivre dans matin-config.
  priceTracking: { enabled: false, position: 8.35, config: { items: [] } },
  cinema:     { enabled: true,  position: 8.4, config: {} },              // scraping direct AlloCiné, aucune clé requise (2026-08-05)
  steamPromos:{ enabled: true,  position: 8.5, config: {} },              // aucune config nécessaire
  epicPromos: { enabled: true,  position: 8.55, config: {} },             // aucune config nécessaire
  // `mode` (2026-08-31, sur demande explicite — support des ampoules Hue
  // SANS pont, via le compte cloud Hue au lieu du pont local) : "bridge"
  // (défaut, comportement historique inchangé) ou "cloud". Champs cloud
  // (`clientId`/`clientSecret`/tokens) toujours présents dans `config`, même
  // en mode bridge — jamais utilisés dans ce cas, mais évite un `undefined`
  // si l'utilisateur bascule le mode sans avoir encore rien saisi.
  hue: {
    enabled: false, position: 8.6,
    config: {
      mode: 'bridge', bridgeIp: '', username: '',
      clientId: '', clientSecret: '', accessToken: null, refreshToken: null, expiresAt: null,
    },
  }, // appairage manuel requis (pont) ou compte Hue (cloud)
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
  // vigilance météo/le trafic routier (sources dépendant d'un département,
  // voir alertsCheckMeteo/alertsCheckTrafic) restent silencieuses tant qu'il
  // n'est pas renseigné dans Paramètres.
  alerts: {
    enabled: true,
    position: 21,
    config: {
      department: '',
      // "Rappels produits" retiré entièrement (2026-09-01, sur demande
      // explicite) — voir alertsCheckRappelConso, supprimée. "Perturbations
      // SNCF" (`sncf`/`sncfApiKey`) retiré entièrement à son tour le même
      // jour (2e demande explicite) — voir alertsCheckSncf, supprimée.
      types: { enlevement: true, meteo: true, vigipirate: true, trafic: true },
    },
  },
  // Prêts immobiliers (2026-08-08, sur demande explicite) — instances
  // multiples comme "ol" (Sports), voir dashboard.js/config.js (isPretsKey) :
  // un groupe de prêts = une instance = une carte. `enabled: false` par
  // défaut (comme les autres modules nécessitant une saisie avant d'être
  // utiles, ex. Colis/Rappels) — rien à afficher tant qu'aucun prêt n'est
  // configuré.
  prets: { enabled: false, position: 22, config: { name: '', loans: [] } },
  // LIVE FOOT! — scores en direct d'une compétition entière (2026-08-11,
  // réécrit intégralement le 2026-09-04 sur ESPN "site API" seul, mode
  // "Équipe" retiré ENTIÈREMENT le 2026-09-05 sur demande explicite — un seul
  // mode reste, voir renderer/modules/live.js/config.js renderLiveConfigSection).
  // `competitionSlug`/`competitionLabel` par défaut sur Ligue 1 — 2e instance
  // possible ("live_2", voir isLiveKey) créée avec les mêmes valeurs par
  // défaut via config.js addLiveInstance, jamais ici.
  live: {
    enabled: false,
    position: 23,
    config: { competitionSlug: 'fra.1', competitionLabel: 'Ligue 1' },
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
      // Mode auto luminosité — SUPPRIMÉ ENTIÈREMENT le 2026-08-31, sur
      // demande explicite (voir CONTEXT.md) : `autoBrightness` n'a plus
      // d'usage, retiré des defaults (une installation existante qui
      // porterait encore ce champ sur disque le garde, mais rien ne le lit
      // plus nulle part — donnée orpheline inoffensive).
      // Fond personnalisé du dashboard (2026-08-11, sur demande explicite) —
      // voir app:setBackground plus bas. `undefined` sur une installation
      // existante (defaults ne comble pas un champ manquant dans un objet
      // `app` déjà présent sur disque, même limite que les autres champs de
      // ce bloc) est traité comme 'none' côté renderer (dashboard.js).
      background: 'none',
      // Mode d'affichage (2026-08-23, sur demande explicite — voir
      // "🎨 Personnaliser" → section "Mode d'affichage" ; volet latéral
      // SUPPRIMÉ ENTIÈREMENT le 2026-09-01, sur demande explicite, voir
      // CONTEXT.md — `sidebarEdge` n'a plus d'usage, retiré des defaults,
      // orphelin et inoffensif sur une installation existante qui le
      // porterait encore sur disque) — même limite d'`defaults` que
      // `background` ci-dessus sur une installation existante : chaque
      // lecture retombe sur ces mêmes valeurs via `|| ...` plutôt que de
      // compter sur ce bloc pour les combler. Voir applyDisplayMode/
      // createSunWindow plus bas.
      displayMode: 'fullscreen',
      floatingSunPosition: null,
      // Moteur de recherche de la barre du titlebar (2026-09-03, sur demande
      // explicite) — voir config.js createSearchEngineRow (Paramètres →
      // Services) et dashboard.js initTitlebarSearch (construit l'URL de
      // recherche à partir de cette clé au submit du formulaire).
      searchEngine: 'google',
      // Défilement automatique du dashboard — SUPPRIMÉ ENTIÈREMENT le
      // 2026-09-01, sur demande explicite (voir CONTEXT.md) : `autoScroll`/
      // `autoScrollSpeed` n'ont plus d'usage, retirés des defaults (une
      // installation existante qui les porterait encore sur disque les
      // garde, orpheline et inoffensive — rien ne les lit plus).
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
const USERDATA_MODULE_KEYS = new Set(['etf', 'crypto', 'prets', 'fdjLoto', 'fdjEuromillions', 'fdjEurodreams', 'podcast', 'reminders', 'priceTracking']);

const userdataStore = new Store({ name: 'matin-userdata', cwd: app.getPath('userData'), defaults: {} });

// ─── Détection centralisée du contenu réel de matin-userdata (2026-08-30,
// suite à l'incident de perte de données ETF/Crypto/Prêts) ─────────────────
// UNE SEULE définition de "vide"/"contenu réel", réutilisée PARTOUT
// (protection avant upload Drive, sauvegardes automatiques déclenchées par
// changement, protection au démarrage, restauration manuelle, import/export)
// plutôt que plusieurs implémentations qui pourraient diverger avec le temps.
// "Contenu réel" = au moins 1 élément dans lines/grids/loans/feeds/items
// d'AU MOINS UN module userdata — pas juste "la clé existe" (une installation
// neuve a déjà des tableaux vides par défaut, ce qui est normal et ne doit
// jamais être traité comme une perte de donnée).
function summarizeUserdataModules(modules) {
  const out = {};
  for (const key of USERDATA_MODULE_KEYS) {
    const cfg = modules?.[key]?.config;
    const arr = cfg && (cfg.lines || cfg.grids || cfg.loans || cfg.feeds || cfg.items);
    out[key] = Array.isArray(arr) ? arr.length : 0;
  }
  return out;
}
function userdataEntryCount(modules) {
  return Object.values(summarizeUserdataModules(modules)).reduce((a, b) => a + b, 0);
}
function isUserdataEmptyModules(modules) {
  return userdataEntryCount(modules) === 0;
}
function isUserdataEmpty() {
  return isUserdataEmptyModules(userdataStore.get('modules'));
}

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

// ─── Disposition (position/taille) de TOUS les modules — pour les
// sauvegardes/export (2026-08-31, sur demande explicite) ───────────────────
// Les sauvegardes automatiques/l'export manuel (voir writeUserdataBackupTo/
// backups:exportManual plus bas) sont volontairement scopées à userdata SEUL
// (jamais matin-config, voir USERDATA_MODULE_KEYS) — correct pour les
// DONNÉES (ETF/Crypto/Prêts...), mais ça laissait la disposition des
// modules NON-userdata (Météo, RSS, Sports, la grande majorité des cartes)
// hors de portée de ces 2 mécanismes. `collectAllLayouts`/`applyLayoutSection`
// traitent la disposition à part, dans une section "layout" DÉDIÉE (demandée
// explicitement) qui couvre les 2 stores — `writeLaunchBackup`/
// `backups:restore` (sauvegarde/restauration COMPLÈTE des 2 stores) n'en ont
// pas besoin, ils capturent déjà tout, layout inclus, par construction.
function collectAllLayouts() {
  const merged = getMergedModules();
  const layout = {};
  for (const [key, mod] of Object.entries(merged)) {
    if (mod?.layout) layout[key] = mod.layout;
  }
  return layout;
}

function applyLayoutSection(layoutByKey) {
  if (!layoutByKey || typeof layoutByKey !== 'object') return;
  const configModules = store.get('modules') || {};
  const userdataModules = userdataStore.get('modules') || {};
  let configChanged = false;
  let userdataChanged = false;
  for (const [key, layout] of Object.entries(layoutByKey)) {
    if (!layout) continue;
    if (USERDATA_MODULE_KEYS.has(key)) {
      if (userdataModules[key]) { userdataModules[key].layout = layout; userdataChanged = true; }
    } else if (configModules[key]) {
      configModules[key].layout = layout;
      configChanged = true;
    }
  }
  if (configChanged) safeStoreSet('modules', configModules);
  if (userdataChanged) userdataStore.set('modules', userdataModules);
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
  scheduleUserdataBackup(); // voir "Sauvegardes automatiques déclenchées par changement" plus bas
  uploadToDriveAfterChange(); // voir Sync Google Drive plus bas — point 3 de la demande, upload silencieux différé
}

// ─── Profils (2026-08-31, sur demande explicite) ───────────────────────────
// 2 profils nommés ("Semaine"/"Weekend" dans l'exemple de la demande),
// chacun capturant enabled/layout de TOUS les modules + le thème clair/
// sombre + son propre nom — PAS le `config` de chaque module (lignes ETF,
// équipe suivie, etc.) : hors périmètre de la demande ("Which modules are
// enabled/disabled, Module positions and sizes, Theme"), et dupliquer TOUTE
// la config par profil aurait été un changement d'architecture bien plus
// lourd que ce qui a été demandé. Stocké dans matin-userdata (demandé
// explicitement, "synced via Google Drive") sous `profiles`, JAMAIS
// matin-config — même raison que layoutSlots plus bas (profiter de la sync
// Drive déjà en place sur ce store).
const PROFILE_KEYS = ['profile1', 'profile2'];

function defaultProfile(name) {
  return { name, theme: null, modules: {}, layouts: {}, autoSwitch: { enabled: false, days: [] } };
}

// Initialise `profiles` au 1er accès (installation neuve OU existante d'avant
// cette fonctionnalité) et MIGRE l'ancien `layoutSlots` plat (voir
// layoutSlots:get/save plus bas, existait déjà avant les profils) vers
// `profiles.profile1.layouts` — sans cette migration, les dispositions déjà
// sauvegardées par l'utilisateur avant cette mise à jour deviendraient
// invisibles du jour au lendemain (toujours sur disque, mais plus jamais lues
// une fois layoutSlots:get repointé sur le profil actif). Écrit la structure
// initialisée/migrée pour la rendre stable dès le 1er appel.
function getProfilesState() {
  let profiles = userdataStore.get('profiles');
  if (!profiles || typeof profiles !== 'object') {
    const legacyLayoutSlots = userdataStore.get('layoutSlots');
    profiles = {
      active: 'profile1',
      profile1: { ...defaultProfile('Profil 1'), layouts: (legacyLayoutSlots && typeof legacyLayoutSlots === 'object') ? legacyLayoutSlots : {} },
      profile2: defaultProfile('Profil 2'),
    };
    userdataStore.set('profiles', profiles);
  }
  // Comble un profil manquant/mal formé sans écraser celui déjà valide à
  // côté (ex. objet `profiles` présent mais `profile2` absent après un futur
  // ajout de champ) — même logique défensive que `defaults` ailleurs dans ce
  // fichier, qui ne comble jamais un objet déjà partiellement présent tout
  // seul.
  let patched = false;
  for (const key of PROFILE_KEYS) {
    if (!profiles[key] || typeof profiles[key] !== 'object') {
      profiles[key] = defaultProfile(key === 'profile1' ? 'Profil 1' : 'Profil 2');
      patched = true;
    }
  }
  if (!PROFILE_KEYS.includes(profiles.active)) { profiles.active = 'profile1'; patched = true; }
  if (patched) userdataStore.set('profiles', profiles);
  return profiles;
}

function getActiveProfileKey() {
  return getProfilesState().active;
}

// `{enabled, layout}` de CHAQUE module connu des 2 stores — même source
// (getMergedModules) que collectAllLayouts plus haut, étendue avec `enabled`.
function snapshotModuleStates() {
  const merged = getMergedModules();
  const out = {};
  for (const [key, mod] of Object.entries(merged)) {
    out[key] = { enabled: mod?.enabled === true, layout: mod?.layout || null };
  }
  return out;
}

// Applique `{enabled, layout}` par clé sur les 2 stores, selon
// USERDATA_MODULE_KEYS — même répartition que applyLayoutSection/
// setMergedModules plus haut. Une clé du profil absente des modules ACTUELS
// (module retiré du catalogue depuis la sauvegarde du profil) est ignorée
// plutôt que ressuscitée.
//
// DURCI le 2026-09-09 (sur demande explicite, bug signalé : "activer/
// désactiver LIVE FOOT dans un profil affecte tous les profils") — l'ancienne
// version ne traitait QUE les clés présentes dans `statesByKey` (le snapshot
// du profil) : une clé ACTUELLEMENT présente dans le store mais jamais
// capturée dans CE profil (module ajouté/modifié après le dernier 💾 de ce
// profil précis) n'était TOUCHÉE PAR AUCUNE des 2 branches — ni "restaurée"
// (absente de statesByKey), ni "ignorée proprement" (le commentaire ci-dessus
// ne couvre que le cas inverse) : elle gardait silencieusement sa valeur
// PARTAGÉE d'avant le changement de profil, donnant l'impression que ce
// module ignore le système de profils alors que tous les autres (déjà
// capturés dans les 2 profils) basculent normalement. Toute clé du store
// ABSENTE de `statesByKey` est désormais explicitement désactivée pour ce
// profil — un profil qui n'a jamais capturé un module le traite comme
// éteint, jamais comme "whatever the previous profile left behind".
function applyModuleStatesSection(statesByKey) {
  if (!statesByKey || typeof statesByKey !== 'object') return;
  const configModules = store.get('modules') || {};
  const userdataModules = userdataStore.get('modules') || {};
  let configChanged = false;
  let userdataChanged = false;

  const applyState = (key, state) => {
    const target = USERDATA_MODULE_KEYS.has(key) ? userdataModules : configModules;
    if (!target[key]) return;
    target[key].enabled = state.enabled === true;
    if (state.layout) target[key].layout = state.layout;
    if (USERDATA_MODULE_KEYS.has(key)) userdataChanged = true; else configChanged = true;
  };

  for (const [key, state] of Object.entries(statesByKey)) {
    if (!state) continue;
    applyState(key, state);
  }
  for (const key of new Set([...Object.keys(configModules), ...Object.keys(userdataModules)])) {
    if (!(key in statesByKey)) applyState(key, { enabled: false, layout: null });
  }

  if (configChanged) safeStoreSet('modules', configModules);
  if (userdataChanged) userdataStore.set('modules', userdataModules);
}

// Capture l'état ACTUEL (modules + thème) dans `profiles[key]`, en gardant
// `layouts`/`autoSwitch` déjà sauvegardés INTACTS (voir demande, point 1 —
// "Sauvegarder ce profil" ne concerne que modules/thème/nom, jamais les
// dispositions Réorganiser ni le réglage d'activation automatique, qui ont
// chacun leur propre action dédiée ailleurs).
function saveProfileSnapshot(key, name) {
  const profiles = getProfilesState();
  const existing = profiles[key] || defaultProfile(key);
  profiles[key] = {
    ...existing,
    name: (name || '').trim() || existing.name,
    theme: store.get('app.theme') || 'dark',
    modules: snapshotModuleStates(),
  };
  backupStoreBeforeWrite();
  userdataStore.set('profiles', profiles);
  scheduleUserdataBackup();
  uploadToDriveAfterChange();
  return profiles[key];
}

// Applique `profiles[key]` au dashboard (modules + thème) et le marque
// actif — utilisée à la fois par l'IPC profiles:switch (clic manuel) ET par
// checkProfileAutoSwitch (activation automatique par jour), voir plus bas.
function performProfileSwitch(key) {
  const profiles = getProfilesState();
  const target = profiles[key];
  if (!target) return null;

  backupStoreBeforeWrite(); // même précaution que les autres écritures larges de ce fichier (layoutSlots:save, setMergedModules...) — modifie enabled/layout de nombreux modules d'un coup
  applyModuleStatesSection(target.modules);
  if (target.theme) {
    safeStoreSet('app.theme', target.theme);
    broadcastTheme(target.theme);
  }
  profiles.active = key;
  userdataStore.set('profiles', profiles);
  scheduleUserdataBackup();
  uploadToDriveAfterChange();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('modules:updated', getMergedModules());
  }
  return target;
}

// ─── Activation automatique par jour (point 4 de la demande — jour de la
// semaine, pas de plage horaire : c'est le seul cas concret donné dans la
// demande, "Weekend" activé samedi/dimanche) ────────────────────────────────
const AUTO_SWITCH_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // aligné sur Date.getDay() (0 = dimanche)
const PROFILE_AUTOSWITCH_CHECK_MS = 15 * 60 * 1000; // réglage par tranche horaire/jour, pas seconde près — pas besoin d'une cadence plus fine

// Si un profil NON actif a l'activation auto activée pour AUJOURD'HUI, on y
// bascule. Si les 2 profils la revendiquent pour le même jour (config
// utilisateur ambiguë, jamais empêchée à la saisie), profile1 l'emporte
// (ordre de PROFILE_KEYS) — cas de bord assumé, à corriger si signalé.
function checkProfileAutoSwitch() {
  const profiles = getProfilesState();
  const today = AUTO_SWITCH_DAY_KEYS[new Date().getDay()];
  for (const key of PROFILE_KEYS) {
    if (key === profiles.active) continue;
    const auto = profiles[key]?.autoSwitch;
    if (auto?.enabled && Array.isArray(auto.days) && auto.days.includes(today)) {
      console.log(`[Profils] Activation automatique de "${profiles[key].name}" (${key}) — aujourd'hui = ${today}`);
      performProfileSwitch(key);
      return;
    }
  }
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

// ─── Sauvegardes déclenchées par CHANGEMENT (2026-08-30, sur demande
// explicite, suite à l'incident de perte de données ETF/Crypto/Prêts) ──────
// Différent de writeLaunchBackup ci-dessus (1 instantané par LANCEMENT,
// {config,userdata} combinés, plafond 7) : ici, 1 instantané par CHANGEMENT
// RÉEL de matin-userdata (ETF/Crypto/Prêts/FDJ/Podcasts/Rappels), userdata
// SEUL — jamais matin-config, donc jamais de token OAuth dans un fichier
// dont la variante Documents est justement pensée pour être copiée sur clé
// USB ou envoyée par email. Plafond 30 (demandé explicitement), débounce
// (mêmes constantes que l'upload Drive plus bas) pour coalescer une rafale
// de changements rapprochés (ex. plusieurs lignes ETF ajoutées à la suite)
// en un seul fichier plutôt que d'en écrire un par changement isolé.
// N'écrit JAMAIS si matin-userdata est vide au moment du déclenchement — un
// instantané vide n'a aucune valeur de sauvegarde et, plafond oblige,
// finirait par chasser les 30 derniers instantanés UTILES si on le laissait
// s'accumuler (même philosophie que la protection Drive plus bas : ne
// jamais préserver/propager un vide accidentel comme s'il s'agissait d'un
// état légitime à conserver).
const USERDATA_BACKUP_PREFIX = 'userdata-backup-';
// 30 → 6 → 3 (2026-08-31, 2e réduction le même jour sur demande explicite) —
// désormais visibles/restaurables depuis la popup Sauvegardes (voir
// listAllLocalUserdataBackups/backups:list plus bas), un plafond plus élevé
// encombrait la liste pour peu de valeur ajoutée au-delà des plus récents.
const MAX_USERDATA_BACKUPS = 3;
// Point 1 de la demande : export "lisible" dans Documents, en plus de la
// copie technique dans AppData — "lisible" ici veut dire facile à
// RETROUVER/COPIER (Documents plutôt que le dossier caché AppData), pas un
// format différent : le JSON pretty-printé est déjà celui utilisé pour
// toutes les sauvegardes de cette app.
const DOCUMENTS_BACKUPS_DIR = path.join(app.getPath('documents'), 'Matin', 'backups');

function pruneUserdataBackupsIn(dir) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith(USERDATA_BACKUP_PREFIX) && f.endsWith('.json'))
      .map(f => ({ name: f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const extra of files.slice(MAX_USERDATA_BACKUPS)) {
      fs.unlinkSync(path.join(dir, extra.name));
    }
  } catch (err) {
    console.error('[Sauvegardes] Échec du nettoyage des sauvegardes userdata dans', dir, err);
  }
}

function writeUserdataBackupTo(dir) {
  const modules = userdataStore.get('modules');
  if (isUserdataEmptyModules(modules)) {
    console.log('[Sauvegardes] Aucune sauvegarde écrite dans', dir, '— matin-userdata est vide (rien de réel à protéger).');
    return;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${USERDATA_BACKUP_PREFIX}${launchBackupTimestamp(new Date())}.json`);
    // `layout` (2026-08-31, sur demande explicite, point 1) : position/taille
    // de TOUS les modules (userdata ET config), voir collectAllLayouts —
    // section à part de `modules` (qui reste strictement userdata).
    const payload = { savedAt: new Date().toISOString(), modules, layout: collectAllLayouts() };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    pruneUserdataBackupsIn(dir);
    console.log('[Sauvegardes] Instantané userdata écrit :', file, `(${userdataEntryCount(modules)} entrée(s) au total)`);
  } catch (err) {
    console.error('[Sauvegardes] Échec de l\'écriture de la sauvegarde userdata dans', dir, err);
  }
}

function writeUserdataBackups() {
  writeUserdataBackupTo(LAUNCH_BACKUPS_DIR);
  writeUserdataBackupTo(DOCUMENTS_BACKUPS_DIR);
}

const USERDATA_BACKUP_SETTLE_MS = 5 * 1000;
const USERDATA_BACKUP_MAX_WAIT_MS = 30 * 1000;
let userdataBackupTimer = null;
let userdataBackupFirstPendingAt = null;

// Débounce à plafond dur (coalesce une rafale de changements en 1 seul
// instantané de sauvegarde locale, tout en garantissant un instantané au
// plus tard 30s après le TOUT PREMIER changement en attente) — appelée à
// CHAQUE écriture réelle de matin-userdata (mêmes points d'appel que
// uploadToDriveAfterChange plus bas : setMergedModules, modules:updateLayout,
// checkReminders, backups:restore, restauration/import Drive et import
// manuel). Volontairement DIFFÉRENT de uploadToDriveAfterChange (2026-08-31,
// sur demande explicite) : l'upload Drive part maintenant IMMÉDIATEMENT à
// chaque changement, sans débounce — mais écrire un fichier de sauvegarde
// local à CHAQUE frappe/glisser-déposer resterait excessif (30 sauvegardes
// consommées en quelques secondes), ce débounce-ci reste donc justifié.
function scheduleUserdataBackup() {
  const now = Date.now();
  if (!userdataBackupFirstPendingAt) userdataBackupFirstPendingAt = now;
  if (userdataBackupTimer) clearTimeout(userdataBackupTimer);

  const waited = now - userdataBackupFirstPendingAt;
  const delay = Math.min(USERDATA_BACKUP_SETTLE_MS, Math.max(0, USERDATA_BACKUP_MAX_WAIT_MS - waited));
  userdataBackupTimer = setTimeout(() => {
    userdataBackupTimer = null;
    userdataBackupFirstPendingAt = null;
    writeUserdataBackups();
  }, delay);
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
// VIDE (2026-08-10, sur demande explicite ; étendue le 2026-08-30 suite à
// l'incident de perte de données — voir isUserdataEmpty/summarizeUserdataModules
// plus haut, juste après la définition de userdataStore) ────────────────────
// Ne se déclenche que s'il existe une sauvegarde RÉCENTE qui, elle, contient
// des données — sur un tout premier lancement légitime (aucune sauvegarde
// existante), rien ne se passe.

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
  return !isUserdataEmptyModules(extractUserdataModulesFromBackup(backupJson));
}

// Liste FUSIONNÉE des 2 mécanismes de sauvegarde locale (2026-08-30) — les
// instantanés par lancement (`backup-*.json`, voir writeLaunchBackup) ET les
// instantanés par changement (`userdata-backup-*.json`, voir
// scheduleUserdataBackup plus haut, bien plus granulaires) dans LE MÊME
// dossier, triés ensemble par date réelle : peu importe LEQUEL des 2
// mécanismes a produit la sauvegarde la plus récente avec du contenu, c'est
// celle-là qui doit être proposée en premier à la restauration automatique.
// Réutilisée aussi par `backups:list` depuis le 2026-08-31 (popup Paramètres
// → Sauvegardes, section "💾 Sauvegardes locales") — `type` ('launch'/
// 'change') laissé sur chaque entrée pour que le renderer puisse distinguer
// les 2 origines à l'affichage sans reparser le nom de fichier.
function listAllLocalUserdataBackups() {
  try {
    return fs.readdirSync(LAUNCH_BACKUPS_DIR)
      .filter(f => /^backup-.*\.json$/.test(f) || (f.startsWith(USERDATA_BACKUP_PREFIX) && f.endsWith('.json')))
      .map(f => ({
        file: f,
        mtimeMs: fs.statSync(path.join(LAUNCH_BACKUPS_DIR, f)).mtimeMs,
        type: f.startsWith(USERDATA_BACKUP_PREFIX) ? 'change' : 'launch',
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

const AUTO_RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Lu par le renderer une fois (voir IPC app:getAutoRestoreNotice) pour
// afficher une notice au premier rendu du dashboard, en plus de la
// notification native ci-dessous.
let autoRestoreNotice = null;

function autoRestoreUserdataIfEmpty() {
  try {
    if (!isUserdataEmpty()) return;
    const backups = listAllLocalUserdataBackups(); // déjà trié, plus récent d'abord
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
      // Section "layout" dédiée (2026-08-31) — absente des sauvegardes plus
      // anciennes, `applyLayoutSection` l'ignore silencieusement le cas
      // échéant (le layout userdata déjà embarqué dans `extractUserdata
      // ModulesFromBackup` ci-dessus reste restauré dans tous les cas).
      applyLayoutSection(data.layout);
      autoRestoreNotice = { file: b.file, mtimeMs: b.mtimeMs };
      scheduleUserdataBackup(); // le contenu retrouvé mérite son propre instantané frais, indépendant de celui qui vient de le fournir
      console.warn(`[Matin] matin-userdata semblait vide au lancement — restauration automatique depuis ${b.file}`);
      if (Notification.isSupported()) {
        try {
          new Notification({
            title: 'Matin — Restauration automatique',
            body: `Vos données (ETF, Crypto, Mon Prêt...) semblaient vides au lancement : restaurées depuis la sauvegarde du ${new Date(b.mtimeMs).toLocaleString('fr-FR')}.`,
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

// ─── Modes d'affichage — Icône flottante (2026-08-23, sur demande explicite,
// voir "🎨 Personnaliser" → section "Mode d'affichage" ; volet latéral
// supprimé entièrement le 2026-09-01, voir CONTEXT.md) ────────────────────
// `sunWindow` : 2e BrowserWindow, minuscule/sans cadre/transparente, utilisée
// UNIQUEMENT en mode "floating" (voir showSunWindow) — n'existe pas tant que
// ce mode n'a jamais été activé, recréée à la demande plutôt que gardée
// cachée en permanence.
let sunWindow = null;
let currentDisplayMode = 'fullscreen';
// Volet latéral ("sidebar") — SUPPRIMÉ ENTIÈREMENT le 2026-09-01, sur
// demande explicite (voir CONTEXT.md) : `stripWindow`/`preSidebarBounds`/
// `SIDEBAR_STRIP_WIDTH` et toutes les fonctions dédiées (computeStripBounds/
// showStripWindow/hideStripWindow/hideSidebarToStrip/enterSidebarMode/
// exitSidebarMode/sidebarStripClick) retirés, ainsi que
// `renderer/strip.html`/`renderer/strip.js` (fichiers supprimés).
const SUN_WINDOW_SIZE = 60;

// ─── Outil dev : test responsive multi-résolutions (2026-09-03, sur demande
// explicite) ─────────────────────────────────────────────────────────────
// Cycle mainWindow.setSize() entre 5 presets de résolution CSS EFFECTIVE
// (résolution physique / échelle DPI Windows la plus courante donnant cette
// résolution) pour tester le responsive 13"/14"/15" sans matériel physique.
// Raccourci Ctrl+Shift+R (voir enregistrement dans app.whenReady() plus bas) —
// vérifié sans conflit : aucun globalShortcut/accelerator n'existait ailleurs
// dans le projet avant cet ajout.
const DEV_WINDOW_SIZE_PRESETS = [
  { name: '13" @150%', width: 1280, height: 720 },
  { name: '14" @125-150%', width: 1366, height: 768 },
  { name: '14" @125%', width: 1536, height: 864 },
  { name: '15" @150% QHD', width: 1707, height: 960 },
  { name: '15" @100-125% FHD', width: 1920, height: 1080 },
];

// -1 = mode inactif (taille normale). 0..4 = index du preset actuellement
// appliqué. Pas de valeur d'index dédiée pour "retour à la taille normale" —
// c'est l'appui qui suit le dernier preset (5e), qui réinitialise directement
// à -1 avant de reboucler sur le preset 0 au prochain appui : cycle complet à
// 6 temps (5 presets + normal) plutôt que de reboucler du 5e preset
// directement au 1er, pour que "revenir à la taille normale" (demandé
// explicitement) reste toujours atteignable par le même raccourci.
let devWindowSizeTestIndex = -1;

// true tant qu'une taille de TEST (preset, ou le court instant où l'on
// revient à la taille normale) est appliquée par setSize — sans ce garde-fou,
// le listener mainWindow.on('resize', ...) ci-dessous sauvegarderait CHAQUE
// redimensionnement de test dans app.windowBounds, écrasant la vraie taille
// de l'utilisateur avec une taille de preset. Repassé à false après un court
// délai plutôt qu'immédiatement après l'appel à setSize : `animate: true`
// déclenche des événements 'resize' intermédiaires de façon asynchrone
// pendant l'animation, après le retour (synchrone) de setSize.
let devWindowSizeTestSuppressBoundsSave = false;

function cycleDevWindowSizeTest() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  devWindowSizeTestSuppressBoundsSave = true;
  devWindowSizeTestIndex++;

  if (devWindowSizeTestIndex >= DEV_WINDOW_SIZE_PRESETS.length) {
    // Appui supplémentaire après le 5e preset → retour à la taille normale/sauvegardée.
    devWindowSizeTestIndex = -1;
    const bounds = store.get('app.windowBounds');
    mainWindow.setSize(bounds.width, bounds.height, true);
    mainWindow.center();
    mainWindow.setTitle('Matin');
    console.log(`[DevTools] Fenêtre redimensionnée : taille normale (${bounds.width}x${bounds.height})`);
  } else {
    const preset = DEV_WINDOW_SIZE_PRESETS[devWindowSizeTestIndex];
    mainWindow.setSize(preset.width, preset.height, true);
    mainWindow.center();
    mainWindow.setTitle(`Matin — Test ${preset.name} (${preset.width}x${preset.height})`);
    console.log(`[DevTools] Fenêtre redimensionnée : ${preset.name} (${preset.width}x${preset.height})`);
  }

  setTimeout(() => { devWindowSizeTestSuppressBoundsSave = false; }, 500);
}

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
  // (2026-08-23) — masque déjà le dashboard (mode "floating") avant que
  // showOnce ci-dessous ne rende quoi que ce soit visible, pour éviter un
  // flash de la fenêtre pleine taille au lancement. Voir applyDisplayMode
  // plus bas.
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
    // Voir devWindowSizeTestSuppressBoundsSave plus haut — ignore les
    // redimensionnements déclenchés par l'outil dev de test responsive, pour
    // ne jamais écraser la vraie taille utilisateur avec une taille de preset.
    if (devWindowSizeTestSuppressBoundsSave) return;
    const [width, height] = mainWindow.getSize();
    safeStoreSet('app.windowBounds', { width, height });
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function createConfigWindow(opts = {}) {
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

  // Hauteur adaptative (2026-08-23, sur demande explicite ; revu le
  // 2026-09-01, 2e demande explicite — "hauteur d'écran disponible MAXIMALE
  // à l'ouverture", remplace le plafond fixe 800px par 95% de la zone de
  // travail SANS plafond, pour utiliser tout l'écran disponible plutôt qu'un
  // maximum arbitraire) — `workAreaSize` (PAS `size`, qui inclut la barre des
  // tâches Windows) de l'écran où se trouve mainWindow, jamais l'écran
  // principal si l'utilisateur a déplacé Matin sur un 2e écran.
  // `resizable: true` (inchangé) laisse l'utilisateur redimensionner
  // manuellement au-delà ou en-deçà si besoin.
  const workArea = (mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()).workAreaSize;
  const configHeight = Math.round(workArea.height * 0.95);

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

  // `openBackups` (2026-08-30, voir bouton "Ouvrir Sauvegardes" du bandeau
  // "⚠️ Données manquantes", dashboard.js initMissingDataWarning) — ouvre la
  // fenêtre Paramètres directement sur la popup Sauvegardes plutôt que de
  // laisser l'utilisateur la retrouver lui-même. Ne s'applique qu'à un
  // NOUVEL ouverture (voir le early-return juste au-dessus si la fenêtre est
  // déjà ouverte — cas marginal accepté, pas de message inter-fenêtres pour
  // un simple raccourci de confort).
  configWindow.loadFile(path.join(__dirname, '../renderer/config.html'), opts.openBackups ? { search: 'openBackups=1' } : undefined);
  configWindow.once('ready-to-show', () => configWindow.show());
  configWindow.on('closed', () => { configWindow = null; });
}

// ─── Mode d'affichage — Icône flottante (2026-08-23, sur demande explicite)
// ────────────────────────────────────────────────────────────────────────
// Point d'entrée UNIQUE pour changer de mode (appelé au lancement avec la
// valeur restaurée du store, ET à chaque changement depuis Personnaliser) —
// nettoie toujours l'ancien mode avant d'appliquer le nouveau, jamais de
// chevauchement (ex. fenêtre encore alwaysOnTop en repassant en plein
// écran).
function applyDisplayMode(mode) {
  const previousMode = currentDisplayMode;
  const safeMode = mode === 'floating' ? mode : 'fullscreen';
  currentDisplayMode = safeMode;

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

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Config store
ipcMain.handle('store:get', (_e, key) => store.get(key));
ipcMain.handle('store:set', (_e, key, value) => { safeStoreSet(key, value); return true; });
ipcMain.handle('store:getAll', () => store.store);

// Sauvegardes locales — liste/restaure (voir writeLaunchBackup plus haut et
// renderer/config.js, popup Paramètres → Sauvegardes, 2026-08-10 sur demande
// explicite). `listAllLocalUserdataBackups` (pas `listLaunchBackups` seul,
// changé le 2026-08-31 sur demande explicite) : la popup doit montrer les 2
// mécanismes de sauvegarde locale — instantanés par LANCEMENT ET par
// CHANGEMENT (voir scheduleUserdataBackup plus haut) — pas seulement les
// premiers comme avant, sinon la plupart des instantanés récents restaient
// invisibles/impossibles à restaurer depuis l'UI.
ipcMain.handle('backups:list', () => listAllLocalUserdataBackups());

// `file` vient de backups:list (jamais saisi librement par l'utilisateur) —
// motif validé quand même avant de construire le chemin, filet de sécurité
// contre toute traversée de répertoire si ce contrat venait à changer.
// Accepte les 2 préfixes (2026-08-31, étendu en même temps que backups:list
// ci-dessus) : `backup-` (instantané de lancement) et `userdata-backup-`
// (instantané par changement).
const BACKUP_FILE_RE = /^(?:backup|userdata-backup)-[\d-_]+\.json$/;
// Comprend maintenant 3 formats de sauvegarde : le NOUVEAU `{ config,
// userdata }` (instantané de LANCEMENT, restaure chaque partie dans SON
// store), l'ANCIEN format à plat (tout restauré dans matin-config tel quel —
// c'est bien là qu'était TOUTE la donnée à l'époque où ces sauvegardes-là ont
// été écrites, matin-userdata n'existait pas encore, donc son contenu ACTUEL
// est conservé, jamais vidé par une restauration antérieure à son
// existence), et depuis le 2026-08-31 `{ savedAt, modules, layout }`
// (instantané par CHANGEMENT, voir writeUserdataBackupTo — userdata SEUL,
// jamais matin-config par design, `layout` réappliqué séparément via
// applyLayoutSection plutôt que via un `store.store =` global qui écraserait
// aussi le reste de matin-config).
// (summarizeUserdataModules — voir plus haut, juste après userdataStore —
// résume le contenu utile d'un objet `modules` pour le diagnostic, points
// 1/5 de la demande de debug "Restaurer ne fait rien" : juste le nombre
// d'entrées par module userdata, pas le contenu entier, qui peut contenir
// des données perso — ISIN, montants de prêts... — jamais loggé en clair.)

ipcMain.handle('backups:restore', (_e, file) => {
  console.log('[Backups] Restauration demandée, fichier =', file);
  if (!BACKUP_FILE_RE.test(file)) throw new Error('Nom de sauvegarde invalide');
  const filePath = path.join(LAUNCH_BACKUPS_DIR, file);
  console.log('[Backups] Chemin résolu =', filePath, '— existe :', fs.existsSync(filePath));
  if (!fs.existsSync(filePath)) throw new Error('Sauvegarde introuvable');

  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  console.log('[Backups] Sauvegarde lue —', raw.length, 'octets, clés de premier niveau :', Object.keys(data));

  const isChangeBackup = file.startsWith(USERDATA_BACKUP_PREFIX);
  const isNewFormat = !isChangeBackup && !!(data.config || data.userdata);
  console.log('[Backups] Format détecté :', isChangeBackup ? 'instantané par changement {modules,layout}' : isNewFormat ? '{config,userdata}' : 'ancien format à plat (tout dans matin-config)');

  // Point 5 : contenu RÉEL du fichier de sauvegarde avant toute écriture —
  // confirme si les données ETF/Crypto/Prêts/etc. sont VRAIMENT dedans ou si
  // la sauvegarde elle-même est déjà vide (dans ce dernier cas, aucun code de
  // restauration ne peut faire réapparaître une donnée qui n'y est pas).
  const backupUserdataModules = isChangeBackup ? (data.modules || null) : isNewFormat ? (data.userdata?.modules || null) : (data.modules || null);
  console.log('[Backups] Contenu userdata DANS LA SAUVEGARDE (nb d\'entrées par module) :', JSON.stringify(summarizeUserdataModules(backupUserdataModules)));

  backupStoreBeforeWrite(); // trace de l'état juste avant l'écrasement par la restauration
  console.log('[Backups] État AVANT restauration (nb d\'entrées par module, store actuel) :', JSON.stringify(summarizeUserdataModules(userdataStore.get('modules'))));

  if (isChangeBackup) {
    userdataStore.set('modules', data.modules || {});
    applyLayoutSection(data.layout); // voir collectAllLayouts/applyLayoutSection plus haut — patch la position/taille de chaque module concerné, dans SON store respectif, sans toucher au reste de matin-config
    console.log('[Backups] Instantané par changement — matin-userdata écrasé depuis data.modules, layout réappliqué (matin-config non touché)');
  } else if (isNewFormat) {
    if (data.config) { store.store = data.config; console.log('[Backups] matin-config écrasé depuis data.config'); }
    if (data.userdata) { userdataStore.store = data.userdata; console.log('[Backups] matin-userdata écrasé depuis data.userdata'); }
    else console.log('[Backups] Aucune clé "userdata" dans cette sauvegarde — matin-userdata conservé TEL QUEL (voir commentaire ci-dessus sur les sauvegardes pré-scission)');
  } else {
    store.store = data;
    console.log('[Backups] Ancien format — matin-config entièrement écrasé, matin-userdata conservé TEL QUEL');
  }

  // Point 3 : relecture immédiate du store RÉEL (pas la variable `data` en
  // mémoire) pour confirmer que l'écriture a bien atteint matin-userdata.
  console.log('[Backups] État APRÈS restauration, relu depuis userdataStore.get (nb d\'entrées par module) :', JSON.stringify(summarizeUserdataModules(userdataStore.get('modules'))));
  console.log('[Backups] Chemin réel du fichier matin-userdata sur disque :', userdataStore.path);

  scheduleUserdataBackup(); // voir "Sauvegardes automatiques déclenchées par changement" plus bas
  uploadToDriveAfterChange(); // restauration manuelle = changement de donnée local, voir Sync Google Drive plus bas
  console.log('[Backups] Rechargement de mainWindow —', mainWindow ? 'présent' : 'absent');
  if (mainWindow) mainWindow.reload();
  return true;
});

// ─── Export / Import manuel (2026-08-30, sur demande explicite, suite à
// l'incident de perte de données ; section "layout" ajoutée le 2026-08-31,
// sur demande explicite) — bouton "📥 Exporter mes données" / "📤 Importer
// des données" de Paramètres → Sauvegardes. `modules` reste portable PAR
// DESIGN : userdata SEULEMENT (ETF/Crypto/Prêts/FDJ/Podcasts/Rappels/Suivi
// de prix), JAMAIS matin-config — ce fichier est pensé pour être copié sur
// une clé USB ou envoyé par email, il ne doit donc JAMAIS contenir de token
// OAuth (Google/Spotify) ni aucun autre secret local à cette installation.
// `layout` (position/taille), en revanche, couvre TOUS les modules (voir
// collectAllLayouts) — une position de carte n'est pas un secret, et
// exclure les modules non-userdata en aurait laissé la grande majorité des
// cartes sans disposition restaurable à l'import.
const DOCUMENTS_MATIN_DIR = path.join(app.getPath('documents'), 'Matin');

ipcMain.handle('backups:exportManual', () => {
  const modules = userdataStore.get('modules');
  const dateLabel = launchBackupTimestamp(new Date());
  const filePath = path.join(DOCUMENTS_MATIN_DIR, `matin-backup-${dateLabel}.json`);
  fs.mkdirSync(DOCUMENTS_MATIN_DIR, { recursive: true });
  const payload = { exportedAt: new Date().toISOString(), source: 'Matin! — export manuel', modules, layout: collectAllLayouts() };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log('[Backups] Export manuel écrit :', filePath, `(${userdataEntryCount(modules)} entrée(s) au total)`);
  return { filePath, counts: summarizeUserdataModules(modules) };
});

// Accepte les mêmes formats que backups:restore (voir
// extractUserdataModulesFromBackup plus haut) — l'utilisateur peut aussi
// bien sélectionner un export manuel qu'une sauvegarde technique récupérée
// depuis AppData/Documents, peu importe laquelle des variantes de forme.
ipcMain.handle('backups:importManual', async () => {
  const win = BrowserWindow.getFocusedWindow() || configWindow || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Importer une sauvegarde Matin',
    defaultPath: DOCUMENTS_MATIN_DIR,
    filters: [{ name: 'Sauvegarde Matin (JSON)', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };

  const filePath = filePaths[0];
  console.log('[Backups] Import manuel demandé, fichier =', filePath);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const modules = extractUserdataModulesFromBackup(data);
  if (isUserdataEmptyModules(modules)) {
    throw new Error('Ce fichier ne contient aucune donnée Matin reconnue (ou est vide).');
  }

  backupStoreBeforeWrite();
  userdataStore.set('modules', modules);
  // Point 3 de la demande (2026-08-31) : restaure aussi la disposition si le
  // fichier en contient une (absente des exports antérieurs à cette date —
  // `applyLayoutSection` ignore silencieusement une section manquante/vide).
  applyLayoutSection(data.layout);
  console.log('[Backups] Import manuel appliqué —', JSON.stringify(summarizeUserdataModules(modules)), '— disposition incluse :', !!data.layout);
  scheduleUserdataBackup();
  uploadToDriveAfterChange(); // import manuel = changement de donnée local légitime, voir Sync Google Drive plus bas
  if (mainWindow) mainWindow.reload();
  return { canceled: false, counts: summarizeUserdataModules(modules) };
});

ipcMain.handle('shell:showItemInFolder', (_e, filePath) => { shell.showItemInFolder(filePath); return true; });

// Point 5 de la demande "backup système" (2026-08-30) — vérifié en LIVE par
// le renderer (pas un flag figé au lancement) : recalculé à chaque appel
// contre l'état RÉEL du store, donc toujours à jour même après une
// restauration automatique/Drive/manuelle survenue après le premier rendu.
ipcMain.handle('userdata:isEmpty', () => isUserdataEmpty());

// Mode auto luminosité — SUPPRIMÉ ENTIÈREMENT le 2026-08-31, sur demande
// explicite (voir CONTEXT.md) : `autoThemeForHour` n'a plus d'usage, retirée.
// `broadcastTheme` reste (utilisée par app:setTheme ET profiles:switch, voir
// performProfileSwitch plus haut) — extraite à l'origine du corps de
// app:setTheme pour être réutilisable par plusieurs chemins qui appliquent
// un thème sans forcément le traiter comme LE dernier choix persisté.
function broadcastTheme(safeTheme) {
  const { color, symbolColor } = titleBarColorsForTheme(safeTheme);
  for (const win of [mainWindow, configWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.setBackgroundColor(color);
    win.setTitleBarOverlay({ color, symbolColor, height: 38 });
    win.webContents.send('theme:updated', safeTheme);
  }
}

// Thème clair/sombre — voir titleBarColorsForTheme plus haut pour le détail
// des 3 couches synchronisées. `theme:getInitial` est SYNCHRONE
// (ipcMain.on/event.returnValue, pas ipcMain.handle) exprès : appelé depuis
// le tout début de preload.js (avant que la page ne s'affiche), pour pouvoir
// poser `document.documentElement.dataset.colorScheme` dans un <script>
// synchrone en tête de <head> — sans ça, le thème ne serait connu qu'après
// un aller-retour IPC asynchrone, provoquant un flash visible du mauvais
// thème à chaque lancement/rechargement.
// Mode auto (calculait le thème depuis l'heure courante) SUPPRIMÉ le
// 2026-08-31, sur demande explicite — `theme:getInitial` relit simplement
// `app.theme`, comme avant l'introduction du mode auto.
ipcMain.on('theme:getInitial', (event) => {
  event.returnValue = store.get('app.theme') || 'dark';
});

ipcMain.handle('app:setTheme', (_e, theme) => {
  const safeTheme = theme === 'light' ? 'light' : 'dark'; // toute valeur inattendue retombe sur le défaut sombre
  safeStoreSet('app.theme', safeTheme);
  broadcastTheme(safeTheme);
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

// Mode d'affichage — Icône flottante (2026-08-23, sur demande explicite, voir
// "🎨 Personnaliser" → section "Mode d'affichage" et applyDisplayMode/
// showSunWindow plus haut ; volet latéral SUPPRIMÉ ENTIÈREMENT le 2026-09-01,
// sur demande explicite, voir CONTEXT.md) — même mécanisme instantané que
// app:setBackground ci-dessus (store + notification au dashboard), avec en
// plus l'effet de bord réel (masquer/repositionner des BrowserWindow) que
// ipcMain.handle('store:set', ...) seul ne ferait pas.
ipcMain.handle('app:setDisplayMode', (_e, mode) => {
  const safeMode = mode === 'floating' ? mode : 'fullscreen';
  safeStoreSet('app.displayMode', safeMode);
  applyDisplayMode(safeMode);
  return true;
});

// Défilement automatique du dashboard — SUPPRIMÉ ENTIÈREMENT le 2026-09-01,
// sur demande explicite (voir CONTEXT.md) : `app:setAutoScroll`/
// `app:setAutoScrollSpeed` n'ont plus d'usage, retirés.

// ─── Démarrage automatique Windows (2026-08-30, sur demande explicite,
// Paramètres → Utile) ────────────────────────────────────────────────────
// `app.setLoginItemSettings` est l'API Electron native pour s'inscrire dans
// le registre Windows (démarrage session) — appliqué immédiatement au clic
// (voir config.js, même principe que le bascule thème/fond/mode d'affichage
// ci-dessus), PAS différé au bouton Enregistrer : un réglage système doit
// refléter l'état réel de l'inscription tout de suite, pas rester
// désynchronisé le temps que l'utilisateur sauvegarde. Persisté dans
// `app.startOnBoot` pour pouvoir réappliquer le réglage au lancement (voir
// app.whenReady plus bas) — `setLoginItemSettings` lui-même n'est pas
// interrogeable de façon fiable comme source de vérité entre 2 lancements
// (ex. après une réinstallation, un déplacement du dossier projet, ou un
// changement du binaire lancé — voir CONTEXT.md "raccourci de lancement
// corrigé" pour un exemple concret de ce genre de dérive).
//
// BUG CORRIGÉ le 2026-09-01 (sur demande explicite, "launching Electron but
// not the Matin app — it shows the default Electron welcome page instead")
// — cause racine : l'appel d'origine ne passait QUE `{ openAtLogin }`, sans
// jamais préciser `path`/`args`. Sans ces 2 champs, Windows lance le binaire
// par défaut associé (`process.execPath`) SANS AUCUN ARGUMENT lui indiquant
// quel dossier d'app charger — en dev (`npm run dev`/`electron .`),
// `process.execPath` pointe vers le electron.exe GÉNÉRIQUE du package
// `electron`, qui, lancé nu, retombe sur sa page d'accueil par défaut au
// lieu de Matin : exactement le symptôme rapporté. `computeLoginItemSettings`
// ci-dessous corrige ça en 2 temps selon le contexte :
//  - PACKAGÉ (`app.isPackaged === true`, vrai build electron-builder) :
//    `process.execPath` pointe déjà directement vers l'exécutable Matin.exe
//    lui-même — AUCUN argument supplémentaire nécessaire (`process.argv[1]`
//    n'y désigne plus un script à charger comme en dev, le passer quand même
//    risquerait de casser le lancement packagé pour rien).
//  - DEV : `args: [path.resolve(process.argv[1])]` (chemin absolu du point
//    d'entrée) indique explicitement à electron.exe générique QUEL dossier
//    d'app charger, exactement comme `electron /chemin/vers/matin-app` en
//    ligne de commande.
// NON VÉRIFIÉ EN CONDITIONS RÉELLES (pas de redémarrage Windows possible
// dans cet environnement) : le correctif suit le mécanisme Electron/Windows
// documenté (et le comportement par défaut sans `path`/`args` reproduit
// exactement le symptôme rapporté), mais l'inscription effective au
// registre ET le lancement au redémarrage restent à confirmer au premier
// usage réel (Paramètres → Utile → activer, relancer Windows, vérifier
// Gestionnaire des tâches → Démarrage).
function computeLoginItemSettings(enabled) {
  const settings = {
    openAtLogin: enabled,
    path: process.execPath,
    args: app.isPackaged ? [] : [path.resolve(process.argv[1])],
  };
  console.log('[Démarrage auto] app.setLoginItemSettings appelé avec :', settings, `(app.isPackaged=${app.isPackaged})`);
  return settings;
}

ipcMain.handle('app:setStartOnBoot', (_e, enabled) => {
  const safeEnabled = enabled === true;
  safeStoreSet('app.startOnBoot', safeEnabled);
  app.setLoginItemSettings(computeLoginItemSettings(safeEnabled));
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
    scheduleUserdataBackup(); // voir "Sauvegardes automatiques déclenchées par changement" plus bas
    uploadToDriveAfterChange(); // voir Sync Google Drive plus bas
  }
  return true;
});

// ─── Emplacements de disposition sauvegardés ("⊞ Réorganiser" → Sauvegarder/
// Charger disposition 1/2, 2026-08-31 sur demande explicite) — 2 emplacements
// fixes, stockés dans matin-userdata (jamais matin-config, pour profiter de la
// sync Google Drive automatique déjà en place sur ce store, voir Sync Google
// Drive plus bas) sous la clé `layoutSlots` = { "1": { name, layout, savedAt },
// "2": { name, layout, savedAt } }. `layout` est un instantané { <clé
// module>: {x,y,width,height,z} } fourni TEL QUEL par le renderer
// (dashboard.js, snapshotCurrentLayout, lu directement depuis les cartes
// affichées) — le process main ne recalcule rien, il se contente de dater et
// stocker. `name` est le libellé choisi par l'utilisateur (ex: "Sport"),
// déjà retombé sur "Disposition 1"/"2" côté renderer si laissé vide (voir
// dashboard.js requestSaveLayoutSlot) — jamais recalculé ici non plus.
// `savedAt` est un ISO string, formaté côté renderer (toLocaleDateString)
// pour l'affichage "sauvegardée le 30 août".
//
// DEVENU spécifique au PROFIL ACTIF (2026-08-31, même jour, sur demande
// explicite — "each profile has its own Disposition 1/2, stored under
// profiles.profile1.layouts / profiles.profile2.layouts") : ne change QUE le
// CHEMIN de stockage (getProfilesState()[active].layouts au lieu de la clé
// plate `layoutSlots`) — le renderer (dashboard.js) et sa forme `{ slot,
// layout, name }` restent identiques, aucun changement ailleurs. La migration
// de l'ancienne clé plate vers `profiles.profile1.layouts` est gérée UNE
// SEULE FOIS par getProfilesState() (voir plus haut), pas ici.
// ─── Clé de résolution effective (2026-09-03, sur demande explicite) ───────
// Isole les dispositions sauvegardées par résolution CSS effective —
// résolution physique du moniteur ajustée par l'échelle DPI Windows, en
// pixels indépendants du périphérique (exactement ce que `screen.width`/
// `screen.height` retourne côté renderer, DOM Screen) — pour que 2 PC de
// résolutions différentes (ex. PC fixe 1920×1080 + laptop 1280×720) ne
// s'écrasent plus mutuellement les dispositions "1"/"2" lors d'une
// restauration Drive (voir layoutSlots:get/save juste en dessous, et Sync
// Google Drive plus bas — le mécanisme d'upload/téléchargement de
// matin-userdata lui-même ne change pas, seule la structure interne de
// `profiles[key].layouts` change). `screen.getPrimaryDisplay().size` (PAS
// `workAreaSize`, qui exclut la barre des tâches — donnerait par ex.
// 1920x1040 au lieu de 1920x1080, une clé différente à chaque variation de
// hauteur de la barre des tâches) est l'équivalent main-process de
// `window.screen.width/height`.
function getEffectiveScreenKey() {
  const { width, height } = screen.getPrimaryDisplay().size;
  return `${Math.round(width)}x${Math.round(height)}`;
}
ipcMain.handle('app:getScreenKey', () => getEffectiveScreenKey());

// Le contrat IPC (layoutSlots:get renvoie { "1": {...}, "2": {...} },
// layoutSlots:save(slot, layout, name) écrit sous ce même "1"/"2") reste
// IDENTIQUE côté renderer (dashboard.js, jamais modifié par ce changement) :
// on insère juste un niveau `[screenKey]` entre `profiles[active].layouts`
// et les slots "1"/"2" existants, invisible pour l'appelant. Les anciennes
// clés plates `profiles[key].layouts["1"]`/`["2"]` (format d'avant ce patch)
// restent orphelines sur disque, jamais lues ni migrées (pas de collision
// possible, une clé numérique "1"/"2" ne ressemble à aucune clé de résolution
// "1920x1080" — voir CONTEXT.md).
ipcMain.handle('layoutSlots:get', () => {
  const profiles = getProfilesState();
  const screenKey = getEffectiveScreenKey();
  return profiles[profiles.active]?.layouts?.[screenKey] || {};
});
ipcMain.handle('layoutSlots:save', (_e, { slot, layout, name }) => {
  const profiles = getProfilesState();
  const active = profiles.active;
  const screenKey = getEffectiveScreenKey();
  const byResolution = profiles[active].layouts || {};
  const slots = byResolution[screenKey] || {};
  slots[slot] = { name, layout, savedAt: new Date().toISOString() };
  byResolution[screenKey] = slots;
  profiles[active].layouts = byResolution;
  backupStoreBeforeWrite();
  userdataStore.set('profiles', profiles);
  scheduleUserdataBackup(); // voir "Sauvegardes automatiques déclenchées par changement" plus bas
  uploadToDriveAfterChange(); // voir Sync Google Drive plus bas
  return slots[slot];
});

// ─── Profils — IPC (2026-08-31, sur demande explicite) ─────────────────────
ipcMain.handle('profiles:getAll', () => getProfilesState());
ipcMain.handle('profiles:save', (_e, { key, name }) => {
  if (!PROFILE_KEYS.includes(key)) return null;
  return saveProfileSnapshot(key, name);
});
// Renomme SEULEMENT (voir ✏️ dans Paramètres/le titrebar) — contrairement à
// profiles:save, ne touche NI modules/layout NI thème : un simple changement
// de libellé ne doit jamais capturer un instantané de l'état actuel.
ipcMain.handle('profiles:rename', (_e, { key, name }) => {
  if (!PROFILE_KEYS.includes(key)) return null;
  const profiles = getProfilesState();
  profiles[key].name = (name || '').trim() || profiles[key].name;
  userdataStore.set('profiles', profiles);
  scheduleUserdataBackup();
  uploadToDriveAfterChange();
  return profiles[key];
});
ipcMain.handle('profiles:switch', (_e, key) => {
  if (!PROFILE_KEYS.includes(key)) return null;
  return performProfileSwitch(key);
});
ipcMain.handle('profiles:setAutoSwitch', (_e, { key, enabled, days }) => {
  if (!PROFILE_KEYS.includes(key)) return null;
  const profiles = getProfilesState();
  profiles[key].autoSwitch = {
    enabled: enabled === true,
    days: Array.isArray(days) ? days.filter(d => AUTO_SWITCH_DAY_KEYS.includes(d)) : [],
  };
  userdataStore.set('profiles', profiles);
  scheduleUserdataBackup();
  uploadToDriveAfterChange();
  return profiles[key];
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
ipcMain.handle('window:openConfig', (_e, opts) => createConfigWindow(opts));
ipcMain.handle('window:closeConfig', () => { if (configWindow) configWindow.close(); });
// Portrait (2026-09-09, sur demande explicite — la disposition "Portrait
// rangé 4" va jusqu'à x:1062, largeur insuffisante si la fenêtre reste plus
// étroite que ça) — n'AGRANDIT que si besoin, ne rétrécit jamais une fenêtre
// déjà plus large (voir dashboard.js btnPortraitMode, qui appelle ceci
// uniquement quand on ACTIVE le portrait, jamais en le désactivant).
ipcMain.on('window:ensure-width', (_e, minW) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getSize();
  if (w < minW) mainWindow.setSize(minW, h);
});
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

// ─── Philips Hue SANS pont — compte cloud (2026-08-31, sur demande
// explicite, support des ampoules Hue de nouvelle génération) ─────────────
// Contrairement au pont (réseau local, aucun compte), ce mode passe par le
// compte cloud Hue de l'utilisateur — OAuth2 (voir main/auth/hue-oauth.js),
// `clientId`/`clientSecret` saisis par l'utilisateur lui-même (Hue n'accorde
// pas d'accès "partenaire" au grand public, voir renderHueCloudConfigSection
// dans config.js), jamais dans le `.env` de cette app.
ipcMain.handle('hue:cloudLogin', async (_e, { clientId, clientSecret }) => {
  return runHueAuthFlow(clientId, clientSecret);
});

// Renvoie un accessToken cloud Hue garanti valide, en le rafraîchissant si
// besoin — MÊME PRINCIPE que getValidGoogleToken/refreshSpotifyAccessToken
// plus haut (lu/persisté directement depuis/vers le store, jamais transité
// par le renderer) : contrairement à Google/Spotify, Hue n'a pas de store
// dédié (`store.google`/`store.spotify`), ses identifiants vivent dans
// `modules.hue.config` comme bridgeIp/username — lus/réécrits ici via
// `store.get`/`safeStoreSet` directement plutôt que reçus en paramètres
// IPC, pour que le renderer n'ait JAMAIS à se soucier de persister un token
// rafraîchi (même limite structurelle que la fenêtre Paramètres séparée déjà
// documentée ailleurs dans ce fichier pour Google/Spotify).
async function getValidHueCloudToken() {
  const cfg = store.get('modules.hue.config') || {};
  if (!cfg.accessToken) return null;
  if (cfg.expiresAt && cfg.expiresAt > Date.now() + 60 * 1000) return cfg.accessToken;
  if (!cfg.refreshToken || !cfg.clientId || !cfg.clientSecret) return null;
  try {
    const refreshed = await refreshHueAccessToken(cfg.refreshToken, cfg.clientId, cfg.clientSecret);
    safeStoreSet('modules.hue.config', { ...cfg, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt });
    return refreshed.accessToken;
  } catch (err) {
    console.error('[Hue Cloud] Échec du rafraîchissement du token', err);
    return null;
  }
}

// Contrôle des ampoules via le cloud Hue (ressources CLIP v2 "grouped_light").
// AVERTISSEMENT (même statut que Colis/Suivi de prix à leur création) : NON
// VÉRIFIÉ en conditions réelles — aucun compte Hue "sans pont"/aucune
// application developers.meethue.com disponible pendant ce développement.
// Le format exact de l'API cloud pour ces ampoules n'est pas documenté
// publiquement de façon fiable à ce jour ; cette implémentation suit la
// convention CLIP v2 la plus répandue pour un pont Hue exposé au cloud, à
// ajuster au premier usage réel si les appels échouent (voir logs
// `[Hue Cloud]`, CONTEXT.md).
const HUE_CLOUD_API_BASE = 'https://api.meethue.com/route/clip/v2/resource';

ipcMain.handle('hue:cloudGetGroups', async () => {
  const accessToken = await getValidHueCloudToken();
  if (!accessToken) throw new Error('Compte Hue non connecté ou session expirée — reconnectez-vous dans Paramètres.');

  const res = await fetch(`${HUE_CLOUD_API_BASE}/grouped_light`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  console.log(`[Hue Cloud] GET grouped_light → HTTP ${res.status} :`, text.slice(0, 300));
  if (!res.ok) throw new Error(`Compte Hue injoignable (${res.status})`);
  const data = JSON.parse(text);
  const items = data.data || [];
  // Échelle de luminosité CLIP v2 (0-100%) reconvertie vers l'échelle 0-254
  // du pont local, déjà utilisée par le reste de ce module/hue.js — pour que
  // le renderer manipule TOUJOURS la même échelle, peu importe le mode.
  return items.map((g) => ({
    id: g.id,
    name: g.metadata?.name || 'Groupe',
    type: 'cloud',
    on: !!g.on?.on,
    allOn: !!g.on?.on,
    bri: Math.round((g.dimming?.brightness ?? 100) * 2.54),
  }));
});

ipcMain.handle('hue:cloudSetGroupState', async (_e, { groupId, state }) => {
  const accessToken = await getValidHueCloudToken();
  if (!accessToken) throw new Error('Compte Hue non connecté ou session expirée — reconnectez-vous dans Paramètres.');

  const body = {};
  if (typeof state.on === 'boolean') body.on = { on: state.on };
  if (typeof state.bri === 'number') body.dimming = { brightness: Math.round(state.bri / 2.54) };
  const res = await fetch(`${HUE_CLOUD_API_BASE}/grouped_light/${groupId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`[Hue Cloud] PUT grouped_light/${groupId} → HTTP ${res.status} :`, text.slice(0, 300));
  if (!res.ok) throw new Error(`Compte Hue injoignable (${res.status})`);
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
// aplatis confirmés sur une vraie réponse À CETTE DATE : sp95_prix/sp98_prix/
// gazole_prix/e10_prix (nombre ou null si le carburant n'est pas vendu — SP95
// classique est souvent absent, remplacé par l'E10 dans beaucoup de
// stations), geom.lat/geom.lon, cp, ville, adresse.
//
// Rayon élargi de 15 à 20km et limite brute portée à 40 (2026-08-05, suite à
// un signalement "aucune station près du 01090") : en zone rurale peu dense,
// un rayon de 15km peut ne contenir presque aucune station, et un `limit`
// trop bas risque de tronquer les résultats de l'API avant même le tri par
// distance réel côté renderer (fuel-prices.js). Le vrai bug rapporté n'était
// en fait PAS ce rayon mais le géocodage en amont (voir fuel-prices.js) —
// élargi quand même par précaution pour les zones rurales.
//
// `select=` RETIRÉ (2026-09-01, sur demande explicite, "SP95 price is still
// not displaying... the government fuel API may have changed field names")
// — nommer explicitement `sp95_prix` dans `select=` ne peut QUE renvoyer ce
// nom précis (ou rien) : si l'API a renommé ce champ depuis la vérification
// du 2026-08-05 ci-dessus, un `select=` figé sur l'ancien nom masque
// silencieusement le problème plutôt que de le révéler. Sans restriction, la
// réponse contient maintenant TOUS les champs bruts de chaque station — la
// résolution du nom réel du champ SP95 (parmi plusieurs candidats connus) se
// fait désormais dynamiquement côté renderer, voir fuel-prices.js
// FUEL_FIELD_CANDIDATES/fuelResolveFieldMap, avec logging explicite pour
// vérifier en direct quel nom l'API utilise réellement aujourd'hui.
const FUEL_API_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

ipcMain.handle('fuel:fetchNearby', async (_e, { lat, lon }) => {
  const where = `within_distance(geom, geom'POINT(${lon} ${lat})', 20km)`;
  const url = `${FUEL_API_URL}?where=${encodeURIComponent(where)}&limit=40`;
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

// Cinéma — scraping direct d'AlloCiné (2026-08-05, sur demande explicite,
// remplace TMDb : plus de clé API). Aucun IPC dédié : le renderer
// (cinema.js) réutilise directement `rss:fetchFeed` ci-dessus pour la
// cascade fetch direct → allorigins.win → jina.ai Reader.

// ─── Suivi de prix Marchand (2026-08-30, sur demande explicite ; cascade de
// repli ajoutée le 2026-08-31, suite au rapport "jina.ai renvoie
// Indisponible, Amazon bloque le scraping" ; matrice proxy×motif
// d'extraction + CDiscount étendue le même jour sur nouvelle demande
// explicite, suite au rapport "échoue sur CDiscount et probablement
// d'autres sites") ──────────────────────────────────────────────────────────
// Le fetch lui-même vit ENTIÈREMENT côté process main (avant le 2026-08-31,
// le renderer appelait directement `rss:fetchFeed`) : tous les proxys
// tentés sont sujets à CORS depuis le renderer sauf jina.ai (déjà proxifié
// via rss:fetchFeed) — centraliser la cascade entière ici évite d'ajouter un
// canal IPC par proxy pour un seul et même besoin ("obtenir un prix"), et
// garde le contrôle fin des en-têtes (User-Agent/Accept-Language "navigateur
// réel") que `rss:fetchFeed` n'expose pas (en-tête fixe, partagé par tous
// ses appelants — RSS/Colis/Cinéma/ETF).
//
// MATRICE proxy × motif d'extraction (2026-08-31) : chaque site marchand
// structure sa page différemment (JSON-LD Schema.org, meta Open Graph,
// attributs `itemprop`, classes CSS "price"/"prix", ou juste un montant en
// euros dans le texte visible) — un seul motif figé (l'ancien PRICE_EURO_RE
// seul) ne couvrait qu'Amazon. Chaque PROXY est maintenant essayé dans
// l'ordre demandé, et pour CHAQUE réponse obtenue, TOUS les motifs sont
// essayés dans l'ordre de fiabilité décroissante (JSON structuré d'abord,
// texte visible en dernier recours) — la 1re combinaison proxy+motif qui
// produit un prix l'emporte.
//
// AVERTISSEMENT (même statut que Colis à sa création) : non vérifié en
// conditions réelles pour CDiscount spécifiquement (seul Amazon.fr a pu être
// testé en conditions réelles jusqu'ici, voir CONTEXT.md — succès confirmé
// via "fetch direct" + motif générique) — les motifs JSON-LD/meta/CSS/
// CDiscount sont des best-effort à ajuster au premier usage réel si le prix
// affiché semble faux (voir logs `[Suivi de prix]`, point 6 de la demande).
// ÉTENDU (2026-09-03, sur demande explicite, debug CDiscount — point 4) :
// 2 branches — virgule décimale FR (existante, "1 299,99 €"/"129,99 €",
// milliers point OU espace) OU point décimal (NOUVELLE, "429.99 €", milliers
// espace SEULEMENT — jamais point, qui serait ambigu avec le point décimal
// lui-même : "1.299.99" n'a pas de lecture non ambiguë). `priceNormalizeAmount`
// (ci-dessous) gère déjà correctement les 2 formes de capture sans
// modification — seule la capture elle-même ratait la variante point avant
// ce correctif (un prix "429.99 €" n'était jusqu'ici JAMAIS capturé du tout,
// quel que soit le motif, puisque ce motif générique sert aussi de base à
// priceLogAllAmountsFound/priceExtractGenericEuro plus bas).
const PRICE_EURO_RE = /(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d{1,3}(?:\s\d{3})*\.\d{2})\s?€/;

// Normalise un montant capturé par n'importe lequel des motifs ci-dessous —
// gère à la fois "129.99" (point décimal, JSON/meta) et "1 299,99"/"129,99"
// (virgule décimale FR, avec séparateur de milliers point ou espace éventuel).
function priceNormalizeAmount(raw) {
  const cleaned = (raw || '').trim();
  if (/,\d{1,2}$/.test(cleaned)) {
    const n = parseFloat(cleaned.replace(/[.\s]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(cleaned.replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Motif 1 (le plus fiable) : JSON-LD Schema.org RÉELLEMENT parsé — pas juste
// une recherche de `"price":` n'importe où dans le texte (2026-08-31, sur
// demande explicite, suite au rapport "FNAC renvoie le prix d'un accessoire/
// garantie au lieu du produit principal" — une page produit peut contenir
// PLUSIEURS blocs JSON-LD, ex. le produit principal ET des accessoires/
// ventes croisées ; matcher `"price"` en aveugle attrape le 1er trouvé, pas
// forcément celui du produit). Extrait chaque `<script type="application/
// ld+json">`, le PARSE réellement (`JSON.parse`, pas un regex sur son
// contenu), ne retient que les nœuds `"@type":"Product"` puis leur
// `offers.price` (ou `offers[].price`, ou `priceSpecification.price`) — le
// chemin exact demandé explicitement ("@type":"Product" et "offers" →
// "price"). Le 1er bloc Product+offers+price valide gagne : sur une page
// produit normale, le JSON-LD du produit PRINCIPAL est structurellement
// quasi toujours présent en 1er (c'est le sujet de la page), les éventuels
// blocs JSON-LD d'accessoires/ventes croisées étant l'exception plutôt que
// la norme.
// Point 2 de la demande Amazon "prix barré" (2026-08-31, 3e révision même
// sujet) : quand un nœud Product a PLUSIEURS offres (ex. neuf + occasion, ou
// prix "conseillé" vs prix de vente réel dans le même tableau `offers`), le
// prix de VENTE est toujours le plus bas des 2 — retient désormais le
// MINIMUM de tous les prix trouvés dans TOUTES les offres de TOUS les nœuds
// Product, jamais juste le 1er rencontré.
// ÉTENDU (2026-09-03, sur demande explicite, debug CDiscount — point 2) :
// gère maintenant AUSSI un nœud `"@type":"Offer"` AUTONOME (pas imbriqué
// dans `.offers` d'un Product) — sur CDiscount, le prix peut vivre
// directement sur ce nœud (`"price"` ou `"priceSpecification"."price"`),
// pas seulement accessible via `Product.offers[].price` comme sur les sites
// déjà vérifiés (Amazon/FNAC). Les 2 formes sont cherchées dans TOUS les
// blocs `<script type="application/ld+json">` de la page, le prix le plus
// bas retenu tous nœuds/toutes formes confondus (même logique "plusieurs
// offres" que la version précédente, voir commentaire plus haut sur le prix
// barré/de référence FNAC).
function priceExtractJsonLdProduct(text) {
  const scripts = text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  let lowest = null;
  let matchedForm = null;
  for (const [, raw] of scripts) {
    let json;
    try { json = JSON.parse(raw.trim()); } catch { continue; } // bloc JSON-LD malformé/tronqué — passe au suivant plutôt que planter
    const nodes = Array.isArray(json) ? json : (Array.isArray(json?.['@graph']) ? json['@graph'] : [json]);
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const type = node['@type'];
      const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      const isOffer = type === 'Offer' || (Array.isArray(type) && type.includes('Offer'));
      if (isProduct) {
        const offers = node.offers;
        const offerList = Array.isArray(offers) ? offers : (offers ? [offers] : []);
        for (const offer of offerList) {
          const rawPrice = offer?.price ?? offer?.priceSpecification?.price;
          if (rawPrice == null) continue;
          const price = priceNormalizeAmount(String(rawPrice));
          if (price != null && (lowest == null || price < lowest)) { lowest = price; matchedForm = 'Product → offers → price'; }
        }
      } else if (isOffer) {
        // CDiscount (point 2) : "price" directement sur le nœud Offer, ou
        // "priceSpecification"."price" — jamais via une clé "offers"
        // puisque ce nœud N'EST PAS un Product qui en contiendrait une.
        const rawPrice = node.price ?? node.priceSpecification?.price;
        if (rawPrice != null) {
          const price = priceNormalizeAmount(String(rawPrice));
          if (price != null && (lowest == null || price < lowest)) { lowest = price; matchedForm = 'Offer autonome → price'; }
        }
      }
    }
  }
  return lowest != null ? { price: lowest, pattern: `JSON-LD "@type":"Product"/"Offer" → price (le plus bas, via ${matchedForm})` } : null;
}

// Motifs Amazon SPÉCIFIQUES (2026-08-31, sur demande explicite, suite au
// rapport "la cascade renvoie le mauvais prix") — Amazon.fr NE POSE NI
// JSON-LD Schema.org NI meta `product:price:amount` (vérifié en direct sur
// une VRAIE page produit réellement suivie par l'utilisateur : les 2 sont
// absents), donc `priceExtractJsonLdProduct`/`priceExtractMetaTag` sont
// systématiquement inopérants sur Amazon — ces motifs dédiés ciblent la
// structure RÉELLE de ses pages produit (`.a-offscreen`, le conteneur
// `#corePriceDisplay_desktop_feature_div`).
//
// BUG RÉEL confirmé sur cette même page (899 € renvoyé au lieu de 27,99 €) :
// le motif générique de dernier recours (voir priceExtractGenericEuro plus
// bas) retient désormais le prix LE PLUS ÉLEVÉ trouvé sur toute la page
// (ajouté le 2026-08-31 pour corriger le cas FNAC, où les décoys —
// accessoires/garanties — sont moins chers que le produit) — sur une page
// Amazon, à l'inverse, les carrousels "les clients ont aussi acheté"/
// "produits similaires" contiennent presque toujours des articles PLUS
// CHERS que le produit suivi (899 € trouvé ailleurs sur cette page de
// 1,8 Mo, aucun rapport avec le pyjama à 27,99 € réellement suivi) : "le
// plus élevé" est donc une heuristique dangereuse ICI. D'où la priorité
// ABSOLUE de ces motifs Amazon ciblés — dès que l'un d'eux réussit, la
// cascade s'arrête avant même d'atteindre ce motif générique risqué.
//
// Point 4 de la demande initiale ("toujours le prix du bloc produit
// principal, pas le 1er prix trouvé") RENFORCÉ le 2026-08-31 (2e demande, même
// jour, "le bon prix est dans la case 'buy box' à droite, pas le 1er prix
// trouvé sur la page") : cible maintenant explicitement le "buy box" — 3
// ancres HTML possibles essayées DANS L'ORDRE demandé
// (`corePriceDisplay_desktop_feature_div` → `apex_desktop` → `buybox`,
// PAS de repli "1re occurrence sur toute la page" comme dans la version
// précédente de ce correctif, EXPLICITEMENT retiré : c'est précisément ce
// qui pouvait remonter un prix hors du buy box sur une page où l'ancre
// habituelle serait absente/renommée). Pour CHAQUE ancre trouvée, ne
// cherche QUE dans une fenêtre de texte après elle, jamais toute la page.
const PRICE_AMAZON_BUYBOX_ANCHORS = ['corePriceDisplay_desktop_feature_div', 'apex_desktop', 'buybox'];
// Largement suffisant pour couvrir le bloc de prix lui-même (vérifié en
// direct sur une vraie page : le prix apparaît ~2700 caractères après
// l'ancre `corePriceDisplay_desktop_feature_div`), sans dériver vers des
// sections totalement différentes plus loin dans une page de plusieurs
// centaines de Ko.
const PRICE_AMAZON_ANCHOR_WINDOW = 8000;

// Prix BARRÉ / de référence (2026-08-31, 3e révision du correctif Amazon,
// suite au rapport "affiche le prix AVANT promotion") — confirmé en direct
// sur la VRAIE page réellement suivie : Amazon marque le prix "Prix le plus
// bas des 30 derniers jours" (une mention réglementaire FR/UE, PAS le prix
// actuellement facturé) avec `data-a-strike="true"` sur l'élément `.a-price`
// englobant, et/ou une classe `basisPrice`/`a-text-strike` à proximité — ce
// marqueur est FIABLE (posé par Amazon lui-même pour l'accessibilité/le
// style), contrairement à une heuristique de position dans le DOM. C'est
// exactement ce bloc que la 2e révision du correctif Amazon (voir décision
// précédente) attrapait par erreur en prenant "le 1er `.a-offscreen`
// trouvé" : sur cette page réelle, il se trouve être le TOUT PREMIER
// `.a-offscreen` de la fenêtre de recherche.
// BUG trouvé ET corrigé PENDANT ce même correctif (vérifié en direct, avant
// tout dégât) : une 1re version regardait juste "y a-t-il data-a-strike dans
// les 400 caractères précédents", sans respecter la structure des balises —
// un `.a-offscreen` GÉNUINEMENT valide situé peu après un `.a-offscreen`
// barré se faisait donc lui aussi étiqueter à tort "barré", parce que
// l'attribut du span barré restait dans la fenêtre de recherche même après
// sa fermeture. Corrigé en ne regardant QUE le `<span` PARENT DIRECT de CE
// `.a-offscreen` précis (le `<span` juste avant le sien propre) plutôt que
// tout ce qui précède dans une fenêtre de caractères fixe.
function priceIsStruckPriceContext(text, matchIndex) {
  const before = text.slice(Math.max(0, matchIndex - 500), matchIndex);
  const ownTagPos = before.lastIndexOf('<span'); // le <span ...> de ce .a-offscreen lui-même
  if (ownTagPos === -1) return false;
  const parentArea = before.slice(0, ownTagPos);
  const parentTagPos = parentArea.lastIndexOf('<span'); // son span PARENT direct
  if (parentTagPos === -1) return false;
  const parentTagText = parentArea.slice(parentTagPos);
  return /data-a-strike=["']true["']/i.test(parentTagText) || /\bbasisPrice\b/.test(parentTagText) || /\ba-text-strike\b/.test(parentTagText);
}

// Parcourt TOUS les `.a-offscreen` d'une fenêtre de texte (pas juste le 1er)
// et retient le 1er qui n'est PAS dans un contexte de prix barré (voir
// ci-dessus) — mémorise au passage le 1er prix barré rencontré : à la fois
// pour le log demandé (point 3, format exact "[Prix] Prix barré trouvé...")
// QUAND un prix final différent est aussi trouvé, ET comme dernier recours
// pour l'appelant si AUCUN prix non barré n'existe nulle part (voir
// priceExtractAmazonBuyBox) — vérifié en direct sur la vraie page suivie
// par l'utilisateur : son prix actuel n'est structurellement présent NULLE
// PART ailleurs que ce bloc "Prix le plus bas des 30 derniers jours"
// (probablement injecté par JS côté client, invisible à un simple fetch) ;
// refuser catégoriquement ce prix barré ferait retomber la cascade sur le
// motif générique "page entière", déjà prouvé capable de renvoyer un prix
// totalement sans rapport (899€, voir décision précédente) — un prix de
// référence potentiellement correct (aucune promo active = référence et
// prix réel identiques) reste un bien meilleur pari que ce risque connu.
function priceFindNonStruckOffscreen(windowText) {
  const re = /class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>\s*([\d]{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/gi;
  let m;
  let struckPrice = null;
  while ((m = re.exec(windowText))) {
    const price = priceNormalizeAmount(m[1]);
    if (price == null) continue;
    if (priceIsStruckPriceContext(windowText, m.index)) {
      if (struckPrice == null) struckPrice = price;
      continue; // JAMAIS retenir un prix barré/de référence comme prix affiché s'il existe une alternative
    }
    if (struckPrice != null) {
      // Format de log EXACT demandé (2026-08-31, point 3).
      console.log(`[Prix] Prix barré trouvé: ${struckPrice}€, Prix final: ${price}€ → affichage: ${price}€`);
    }
    return { price, struckPrice };
  }
  return { price: null, struckPrice }; // aucun prix NON barré dans cette fenêtre — struckPrice reste dispo pour l'appelant en dernier recours
}

// Sélecteurs Amazon DÉDIÉS "prix de vente" (2026-08-31, 3e révision, ordre
// EXACT demandé) — nommés explicitement par Amazon pour désigner LE prix à
// payer, prioritaires sur la recherche générique par ancre ci-dessous :
// `#priceblock_saleprice` (prix promo), `#priceblock_dealprice` (offre
// éclair), `.apexPriceToPay`/`.a-price.a-text-price.a-size-medium.apexPriceToPay`
// (le conteneur "prix à payer" du nouveau design Amazon — traités ensemble,
// la recherche par sous-chaîne de classe couvre les 2 formulations).
function priceExtractAmazonSaleSelectors(text) {
  let m = text.match(/id=["']priceblock_saleprice["'][^>]*>\s*([\d]{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/i);
  if (m) { const price = priceNormalizeAmount(m[1]); if (price != null) return { price, pattern: 'Amazon #priceblock_saleprice' }; }

  m = text.match(/id=["']priceblock_dealprice["'][^>]*>\s*([\d]{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/i);
  if (m) { const price = priceNormalizeAmount(m[1]); if (price != null) return { price, pattern: 'Amazon #priceblock_dealprice' }; }

  const anchorIdx = text.indexOf('apexPriceToPay');
  if (anchorIdx !== -1) {
    const windowText = text.slice(anchorIdx, anchorIdx + 2000);
    m = windowText.match(/class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>\s*([\d]{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/i);
    if (m) { const price = priceNormalizeAmount(m[1]); if (price != null) return { price, pattern: 'Amazon .apexPriceToPay .a-offscreen' }; }
  }
  return null;
}

function priceExtractAmazonBuyBox(text) {
  const dedicated = priceExtractAmazonSaleSelectors(text);
  if (dedicated) {
    console.log(`[Prix] Amazon buy box price found: ${dedicated.price}€`);
    return dedicated;
  }

  // 1re passe sur les 3 ancres : uniquement des prix NON barrés — mémorise
  // le 1er prix barré rencontré (toutes ancres confondues) comme filet de
  // secours, voir justification détaillée sur priceFindNonStruckOffscreen.
  let struckFallback = null;
  for (const anchorId of PRICE_AMAZON_BUYBOX_ANCHORS) {
    const anchorIdx = text.indexOf(anchorId);
    if (anchorIdx === -1) continue;
    const windowText = text.slice(anchorIdx, anchorIdx + PRICE_AMAZON_ANCHOR_WINDOW);
    const { price, struckPrice } = priceFindNonStruckOffscreen(windowText);
    if (price != null) {
      // Format de log EXACT demandé (2026-08-31).
      console.log(`[Prix] Amazon buy box price found: ${price}€`);
      return { price, pattern: `Amazon buy box (#${anchorId} .a-price .a-offscreen, 1er non barré)` };
    }
    if (struckFallback == null && struckPrice != null) struckFallback = { price: struckPrice, anchorId };
  }

  // 2e passe : AUCUN prix non barré nulle part — le prix réellement facturé
  // n'est probablement présent dans AUCUNE réponse statique (injecté par JS
  // côté client). Le prix barré/de référence reste un bien meilleur pari que
  // de laisser la cascade retomber sur le motif générique "page entière"
  // (déjà prouvé capable de renvoyer un prix totalement sans rapport, voir
  // décision précédente) — mais avec un avertissement explicite, ce prix
  // n'étant PAS garanti identique au prix actuellement facturé si une
  // promotion est active.
  if (struckFallback) {
    console.warn(`[Prix] Amazon — aucun prix final (non barré) trouvé près de #${struckFallback.anchorId}, repli sur le prix de référence : ${struckFallback.price}€ (peut être inexact si une promotion est active)`);
    console.log(`[Prix] Amazon buy box price found: ${struckFallback.price}€`);
    return { price: struckFallback.price, pattern: `Amazon buy box (repli prix barré/référence, #${struckFallback.anchorId})` };
  }
  return null;
}

// Variante JSON du buy box — `"buyingPrice"`, alternative aux ancres HTML
// ci-dessus pour une page où le prix serait injecté depuis un état JS
// plutôt que déjà présent dans le HTML statique.
function priceExtractAmazonBuyingPriceJson(text) {
  const m = text.match(/"buyingPrice"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i);
  if (!m) return null;
  const price = priceNormalizeAmount(m[1]);
  if (price == null) return null;
  console.log(`[Prix] Amazon buy box price found: ${price}€`);
  return { price, pattern: 'Amazon JSON "buyingPrice"' };
}

// Motif 2 : JSON embarqué EN VRAC dans la page (state Next.js/Nuxt/React,
// pas forcément un `<script type="ld+json">` conforme Schema.org) — la
// variante CDiscount demandée explicitement (`"salePrice"`, prioritaire sur
// `"price"` générique quand les 2 sont présents : le prix de vente réel
// plutôt qu'un prix barré/de référence).
function priceExtractJsonLike(text) {
  let m = text.match(/"salePrice"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i);
  if (m) return { price: priceNormalizeAmount(m[1]), pattern: 'JSON "salePrice" (CDiscount)' };
  m = text.match(/"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i);
  if (m) return { price: priceNormalizeAmount(m[1]), pattern: 'JSON "price" (générique, hors ld+json)' };
  return null;
}

// `#priceblock_ourprice` — sélecteur Amazon hérité (prix "normal", pas une
// promo) sur d'éventuelles pages/mises en page plus anciennes ; `saleprice`/
// `dealprice` sont maintenant couverts par priceExtractAmazonSaleSelectors
// plus haut (priorité plus haute, ce sont eux les vrais prix PROMO), celui-ci
// reste en repli pour le cas "prix normal sans promo" sous l'ancien layout.
function priceExtractAmazonLegacyBlocks(text) {
  const m = text.match(/id=["']priceblock_ourprice["'][^>]*>\s*([\d]{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/i);
  return m ? { price: priceNormalizeAmount(m[1]), pattern: 'Amazon #priceblock_ourprice' } : null;
}

// Motif 3 : meta Open Graph / Product (og:price:amount, product:price:amount
// — CDiscount utilise CETTE 2e forme, voir en-tête de section, "amount" DÉJÀ
// couvert avant ce correctif, vérifié le 2026-09-03) — attribut `content`
// avant OU après le nom de propriété selon les sites, les 2 ordres sont
// essayés. `product:price:currency` (2026-09-03, sur demande explicite,
// point 3) capturée en plus, UNIQUEMENT pour le log diagnostic ci-dessous —
// jamais utilisée pour la valeur du prix elle-même (l'app est FR-only,
// affichage toujours en €, voir price-tracking.js priceFmt) : sert juste à
// repérer en direct dans le terminal un cas où le prix trouvé ne serait PAS
// réellement en euros (ex. marketplace international), plutôt qu'un bug
// silencieux.
function priceExtractMetaTag(text) {
  let m = text.match(/<meta[^>]+(?:og:price:amount|product:price:amount)[^>]+content=["']([\d.,]+)["']/i)
    || text.match(/<meta[^>]+content=["']([\d.,]+)["'][^>]+(?:og:price:amount|product:price:amount)/i);
  if (!m) return null;
  const currencyMatch = text.match(/<meta[^>]+(?:og:price:currency|product:price:currency)[^>]+content=["']([A-Za-z]{3})["']/i)
    || text.match(/<meta[^>]+content=["']([A-Za-z]{3})["'][^>]+(?:og:price:currency|product:price:currency)/i);
  const currency = currencyMatch ? currencyMatch[1].toUpperCase() : null;
  if (currency && currency !== 'EUR') {
    console.warn(`[Suivi de prix] meta product:price:currency="${currency}" (≠ EUR) — le prix affiché suppose des euros, vérifier manuellement.`);
  }
  return { price: priceNormalizeAmount(m[1]), pattern: `meta og:price/product:price${currency ? ` (devise: ${currency})` : ''}` };
}

// Motifs 4/5 (les moins fiables, gardés en dernier recours) : marquage CSS
// (`itemprop="price"`, classes contenant "price"/"prix") puis montant en
// euros visible dans le texte — TOUS DEUX sujets au même risque signalé pour
// FNAC (plusieurs prix sur une même page : accessoires/garanties/options).
// Point 1/2 de la demande FNAC ("prendre le prix le plus élevé trouvé sur la
// page" + "vérification de cohérence si le prix semble trop bas") : ces 2
// motifs collectent DÉSORMAIS TOUTES les occurrences plutôt que la 1re, et
// retiennent la PLUS ÉLEVÉE — un accessoire/une garantie/une option est
// presque toujours moins cher que le produit principal lui-même, donc le
// montant maximal trouvé sur la page est une heuristique simple et sûre
// contre ce biais précis (jamais pire que "prendre le 1er trouvé au hasard",
// et directement alignée sur ce que la demande suggère elle-même comme
// stratégie alternative). Point 3 de la demande : TOUTES les valeurs
// trouvées sont logguées, pas seulement celle retenue.
function priceExtractCssPattern(text) {
  const contentMatches = [...text.matchAll(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/gi)]
    .map(m => priceNormalizeAmount(m[1])).filter(n => n != null);
  if (contentMatches.length) {
    console.log('[Suivi de prix] Prix trouvés (itemprop="price" content) :', contentMatches.join(', '), '€ — le plus élevé est retenu');
    return { price: Math.max(...contentMatches), pattern: `itemprop="price" (content, max de ${contentMatches.length})` };
  }
  const textMatches = [...text.matchAll(/itemprop=["']price["'][^>]*>\s*([\d]{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})?)\s*€/gi)]
    .map(m => priceNormalizeAmount(m[1])).filter(n => n != null);
  if (textMatches.length) {
    console.log('[Suivi de prix] Prix trouvés (itemprop="price" texte) :', textMatches.join(', '), '€ — le plus élevé est retenu');
    return { price: Math.max(...textMatches), pattern: `itemprop="price" (texte, max de ${textMatches.length})` };
  }
  const classMatches = [...text.matchAll(/class=["'][^"']*\b(?:price|prix)\b[^"']*["'][^>]*>\s*([\d]{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/gi)]
    .map(m => priceNormalizeAmount(m[1])).filter(n => n != null);
  if (classMatches.length) {
    console.log('[Suivi de prix] Prix trouvés (class~="price"/"prix") :', classMatches.join(', '), '€ — le plus élevé est retenu');
    return { price: Math.max(...classMatches), pattern: `class~="price"/"prix" (max de ${classMatches.length})` };
  }
  return null;
}

// Motif 6 (dernier recours absolu) : montant en euros visible n'importe où
// dans le texte, format FR "12,34 €" — l'ancien (et jusqu'ici SEUL) motif de
// cette fonctionnalité ; conservé, mais retient désormais le MAXIMUM de
// toutes les occurrences (voir justification ci-dessus) plutôt que la 1re.
function priceExtractGenericEuro(text) {
  const matches = [...text.matchAll(new RegExp(PRICE_EURO_RE, 'g'))]
    .map(m => priceNormalizeAmount(m[1])).filter(n => n != null);
  if (!matches.length) return null;
  console.log('[Suivi de prix] Prix trouvés (motif générique "XX,XX €") :', matches.join(', '), '€ — le plus élevé est retenu');
  return { price: Math.max(...matches), pattern: `motif générique "XX,XX €" (max de ${matches.length})` };
}

// Ordre EXACT demandé (2026-08-31, 2e révision même jour) : JSON-LD Product
// → buy box Amazon (3 ancres HTML dans l'ordre → JSON "buyingPrice") →
// sélecteurs Amazon hérités → meta og:price → repli générique (JSON en
// vrac, CSS itemprop/class, texte "XX,XX €"). PLUS de repli Amazon "1re
// occurrence non scopée" (retiré à la 2e révision, voir
// priceExtractAmazonBuyBox) — un prix hors buy box ne doit plus jamais être
// retenu au nom d'Amazon spécifiquement, seuls les replis GÉNÉRIQUES
// (identiques pour tous les sites) restent en dernier recours.
const PRICE_EXTRACTORS = [
  priceExtractJsonLdProduct,
  priceExtractAmazonBuyBox,
  priceExtractAmazonBuyingPriceJson,
  priceExtractAmazonLegacyBlocks,
  priceExtractMetaTag,
  priceExtractJsonLike,
  priceExtractCssPattern,
  priceExtractGenericEuro,
];

// Point 3 de la demande de debug Amazon (2026-08-31) : logge TOUS les
// montants "XX,XX €" présents sur la page AVANT de tenter quoi que ce soit
// — indépendant du motif qui finit par gagner, pour pouvoir comparer à l'œil
// la valeur retenue face à toutes les autres candidates (utile précisément
// pour repérer un futur cas comme celui du 899 € trouvé sur la page Amazon
// testée ce jour-là, sans rapport avec le produit réellement suivi).
// Plafonné à 40 valeurs pour ne pas noyer le terminal sur une page dense.
function priceLogAllAmountsFound(text) {
  const all = [...text.matchAll(new RegExp(PRICE_EURO_RE, 'g'))].map(m => m[1]);
  if (!all.length) { console.log('[Suivi de prix] Aucun montant "XX,XX €" trouvé sur la page.'); return; }
  console.log(`[Suivi de prix] TOUS les montants "XX,XX €" trouvés sur la page (${all.length}) :`, all.slice(0, 40).join(', ') + (all.length > 40 ? ', …' : ''));
}

// CDiscount (2026-09-03, sur demande explicite, points 1 et 5 du debug) —
// détection de domaine pour le log détaillé ci-dessous UNIQUEMENT (jamais
// pour changer l'ordre des proxys/motifs pour ce site précis, voir la longue
// note sur PRICE_PROXIES plus bas : jina.ai reste nécessaire en 1er pour
// CDiscount, retiré serait une régression).
function isCdiscountUrl(url) {
  try { return new URL(url).hostname.toLowerCase().includes('cdiscount.com'); }
  catch { return false; }
}

// `proxyName` optionnel : quand fourni (voir priceTryProxy ci-dessous, posé
// UNIQUEMENT pour une URL CDiscount) logge CHAQUE motif tenté avec son
// résultat (point 5 de la demande, format EXACT demandé) — jamais pour les
// autres sites, qui gardent le log générique existant (priceLogAllAmountsFound
// ci-dessus), pas besoin d'alourdir le terminal pour un site qui fonctionne
// déjà.
function priceExtractPrice(text, proxyName) {
  priceLogAllAmountsFound(text);
  for (const extractor of PRICE_EXTRACTORS) {
    const result = extractor(text);
    if (proxyName) {
      const outcome = (result && result.price != null) ? `${result.price}€ (${result.pattern})` : 'ÉCHEC';
      console.log(`[Suivi de prix][CDiscount] proxy=${proxyName} motif=${extractor.name} résultat=${outcome}`);
    }
    if (result && result.price != null) return result;
  }
  return null;
}

// En-têtes "navigateur réel" — un site marchand bloque plus volontiers un
// User-Agent par défaut de librairie HTTP (souvent absent ou générique)
// qu'un Chrome desktop classique + Accept-Language cohérent avec un site .fr.
const PRICE_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
};

// Proxys tentés DANS L'ORDRE demandé (jina.ai, allorigins.win, corsproxy.io),
// PLUS le fetch direct — conservé après les 3 demandés explicitement car
// déjà confirmé comme la méthode qui fonctionne réellement pour Amazon.fr en
// conditions réelles (voir CONTEXT.md) : le retirer aurait été une
// régression sur un chemin déjà prouvé.
//
// corsproxy.io — BUG RÉEL trouvé le 2026-08-31 en testant ce lot sur une
// VRAIE URL CDiscount : l'URL "legacy" sans clé (`corsproxy.io/?{url}`, ce
// que ce code envoyait) ne fonctionne PLUS DU TOUT — le service répond
// systématiquement `403 keyless_legacy_url`, quelle que soit l'URL cible
// (vérifié aussi sur https://example.com), le service a changé son API et
// exige désormais `?key=VOTRE_CLE&url=...`. Traité comme rainforestapi
// juste en dessous : DÉSACTIVÉ sans clé (`CORSPROXY_API_KEY` absente du
// `.env`), aucun échec bruyant tant qu'aucune clé n'est fournie — la fonction
// bascule automatiquement vers le nouveau format dès qu'une clé est ajoutée.
const CORSPROXY_API_KEY = process.env.CORSPROXY_API_KEY || null;

// ─── ASIN + méthodes dédiées Amazon (2026-08-31, sur demande explicite,
// "DRASTIC FIX" suite au rapport "Amazon obfusque trop ses prix") ──────────
// Amazon encode toujours l'ASIN (10 caractères alphanumériques) dans le
// chemin après /dp/ ou /product/, quel que soit le reste de l'URL (slug
// produit, paramètres de tracking...).
function priceExtractAsin(url) {
  const m = url.match(/\/(?:dp|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// Keepa — tentée AVANT toute la cascade de scraping (voir priceTracking:
// fetchPrice plus bas) pour les URLs Amazon avec un ASIN détecté : une API
// structurée, quand elle répond, est intrinsèquement plus fiable qu'un
// scraping HTML tributaire de la mise en page du jour. DÉSACTIVÉE sans clé
// (`KEEPA_API_KEY` absente du `.env`, même convention que
// CORSPROXY_API_KEY/RAINFOREST_API_KEY ci-dessus/plus bas) — Keepa exige un
// compte (gratuit possible, quota de tokens limité/jour) ET une clé API,
// PAS un accès anonyme malgré la formulation "API gratuite" de la demande.
//
// Endpoint RÉEL (celui suggéré dans la demande, `keepa.com/api/deals`,
// n'existe pas sous cette forme — corrigé vers le véritable endpoint produit
// documenté par Keepa) : `api.keepa.com/product?key=...&domain=4&asin=...`
// (domain 4 = amazon.fr, comme demandé — code de domaine confirmé exact).
// La réponse encode l'HISTORIQUE de prix en CENTIMES dans
// `products[0].csv[<index>]` (un seul tableau À PLAT de paires [timestamp
// Keepa-minutes, prix], -1 = absence de donnée à ce point), PAS un simple
// champ "prix actuel" — `csv[1]` (index "New", 3ᵉ partie/buy box en
// pratique) est utilisé ici, dernière valeur valide (≠ -1) de la série
// retenue comme prix courant.
// NON VÉRIFIÉ EN CONDITIONS RÉELLES (aucune clé Keepa dans cet
// environnement) : structure implémentée au plus près de la documentation
// publique Keepa, à ajuster au premier usage réel si la réponse diffère
// (voir logs `[Prix Amazon]`).
const KEEPA_API_KEY = process.env.KEEPA_API_KEY || null;
const KEEPA_DOMAIN_FR = 4;

async function priceTryKeepa(asin) {
  if (!KEEPA_API_KEY) throw new Error('KEEPA_API_KEY absente du .env — étape ignorée (compte + clé gratuits requis sur keepa.com)');
  const res = await fetch(`https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=${KEEPA_DOMAIN_FR}&asin=${asin}`);
  if (!res.ok) throw new Error(`Keepa HTTP ${res.status}`);
  const data = await res.json();
  const series = data.products?.[0]?.csv?.[1]; // index 1 = historique prix "New", voir commentaire ci-dessus
  if (!Array.isArray(series)) throw new Error('Keepa : pas d\'historique de prix "New" dans la réponse');
  for (let i = series.length - 1; i >= 1; i -= 2) { // parcourt à rebours les valeurs de prix (indices impairs) de la série [timestamp, prix] aplatie
    if (series[i] !== -1) return series[i] / 100; // centimes → euros
  }
  throw new Error('Keepa : aucune valeur de prix valide dans l\'historique');
}

// Endpoint AJAX mobile Amazon — utilisé par la page produit pour rafraîchir
// le bloc "options d'achat" sans recharger toute la page. Tentée en dernier
// recours (voir priceTracking:fetchPrice), AVANT rainforestapi (payant) :
// contrairement à la demande initiale, la réponse n'est PAS un JSON propre
// avec un champ "priceAmount" — c'est un FRAGMENT HTML, comme le reste des
// pages Amazon scrapées ici — routée à travers le MÊME pipeline
// d'extraction que le reste (priceExtractPrice), qui sait déjà cibler le
// buy box Amazon spécifiquement, plutôt que de chercher un champ JSON qui
// n'existe pas dans cette réponse.
function priceAmazonMobileAjaxUrl(asin) {
  return `https://www.amazon.fr/gp/product/ajax/ref=dp_aod_NEW_mbc?asin=${asin}&experienceId=aodAjaxMain`;
}

// CDiscount — jina.ai VÉRIFIÉ EN CONDITIONS RÉELLES le 2026-09-03 (point 1 du
// debug, "tester l'endpoint jina.ai sur une URL CDiscount") : CDiscount sert
// un CHALLENGE anti-bot JS ("Baleen", `__blnChallengeStore`/"challengejs")
// à un fetch direct (`fetch direct` confirmé : réponse HTTP 200 mais page
// de challenge générique, AUCUNE donnée produit, testé en direct sur une
// vraie URL produit CDiscount) — un fetch serveur-à-serveur sans exécution
// JS ne peut structurellement JAMAIS passer ce challenge. jina.ai Reader, à
// l'inverse, restitue le VRAI contenu de la page (confirmé : aucun marqueur
// "Baleen"/"challengejs" dans sa réponse pour la même URL) — donc jina.ai
// reste NÉCESSAIRE en 1er pour CDiscount, le retirer serait une régression.
// CONTREPARTIE (explique pourquoi les motifs JSON-LD/meta ci-dessus peuvent
// échouer sur CDiscount même une fois ce challenge passé) : jina.ai convertit
// la page en MARKDOWN — `<script>`/`<meta>`/attributs `class` sont
// STRUCTURELLEMENT ABSENTS de sa réponse (vérifié : 0 occurrence de
// "application/ld+json" dans le texte renvoyé), donc `priceExtractJsonLdProduct`/
// `priceExtractMetaTag`/`priceExtractCssPattern` ne PEUVENT PAS matcher sur
// une réponse jina.ai, quel que soit l'ajustement de leurs motifs — seul
// `priceExtractGenericEuro` (montant "XX,XX €" visible dans le texte,
// confirmé PRÉSENT en nombre dans la réponse jina.ai) a une chance réelle
// pour ce site via ce proxy. Ces 3 motifs restent utiles quand même : pour
// TOUS les autres sites (Amazon, FNAC...) ET pour CDiscount lui-même si un
// proxy renvoyant du HTML brut (allorigins.win/fetch direct) finit par
// réussir un jour (ex. challenge assoupli), sans exécution JS ils échoueront
// probablement au même titre que "fetch direct" ci-dessus — non vérifié en
// conditions réelles pour allorigins.win spécifiquement (HTTP 520,
// indisponibilité du service au moment du test, pas une confirmation de
// blocage CDiscount).
const PRICE_PROXIES = [
  // `X-No-Cache` (2026-08-31, sur demande explicite) — jina.ai Reader met en
  // cache ses réponses ; ce header lui demande de re-fetcher la page
  // d'origine plutôt que de servir un prix potentiellement périmé. (La
  // demande proposait `?no_cache=true` en paramètre d'URL, mais ce
  // paramètre irait sur l'URL AMAZON cible, pas sur jina.ai lui-même — sans
  // effet réel. Le vrai mécanisme jina.ai est ce header, voir sa doc.)
  ['jina.ai', (url) => fetch(`https://r.jina.ai/${url}`, { headers: { ...PRICE_BROWSER_HEADERS, 'X-No-Cache': 'true' } })],
  ['allorigins.win', (url) => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, { headers: PRICE_BROWSER_HEADERS })],
  ['corsproxy.io', (url) => {
    if (!CORSPROXY_API_KEY) return Promise.reject(new Error('CORSPROXY_API_KEY absente du .env — étape ignorée (API legacy sans clé abandonnée par corsproxy.io, confirmé le 2026-08-31)'));
    return fetch(`https://corsproxy.io/?key=${CORSPROXY_API_KEY}&url=${encodeURIComponent(url)}`, { headers: PRICE_BROWSER_HEADERS });
  }],
  ['fetch direct', (url) => fetch(url, { headers: PRICE_BROWSER_HEADERS })],
];

// Longueur de l'extrait loggué pour chaque réponse brute (point 2 de la
// demande de debug CDiscount, 2026-08-31) — la réponse entière (souvent
// 10-60 Ko de HTML) noierait le terminal ; un extrait suffit à repérer une
// page de blocage/challenge anti-bot (titre "Just a moment"/"Maintenance",
// mention JavaScript requis...) sans avoir à relire des dizaines de Ko.
const PRICE_RAW_LOG_LENGTH = 400;

// `proxyName` (2026-09-03, sur demande explicite, point 5 du debug
// CDiscount) — transmis à priceExtractPrice UNIQUEMENT si `url` est une URL
// CDiscount (voir isCdiscountUrl plus haut), pour déclencher son log détaillé
// par motif SANS alourdir le terminal pour les autres sites marchands.
async function priceTryProxy(proxyName, fetchFn, url) {
  const res = await fetchFn(url);
  const text = await res.text();
  console.log(`[Suivi de prix] Réponse brute (${text.length} caractères, HTTP ${res.status}) :`, text.slice(0, PRICE_RAW_LOG_LENGTH).replace(/\s+/g, ' '));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const extracted = priceExtractPrice(text, isCdiscountUrl(url) ? proxyName : null);
  if (!extracted) throw new Error(`aucun motif de prix reconnu dans la réponse (${text.length} caractères)`);
  return extracted;
}

// Étape optionnelle, tentée en tout dernier recours : API tierce payante
// (rainforestapi.com ou équivalent) — DÉSACTIVÉE par défaut, aucune clé
// `RAINFOREST_API_KEY` dans le `.env` de ce développement (voir CONTEXT.md
// pour la liste des clés disponibles) : ignorée silencieusement plutôt
// qu'un échec bruyant tant qu'aucune clé n'est fournie. À activer en
// ajoutant `RAINFOREST_API_KEY=...` au `.env` — aucun autre changement de
// code nécessaire. Réponse déjà structurée (JSON de l'API elle-même), donc
// aucun des 4 motifs d'extraction ci-dessus ne s'applique ici.
async function priceTryRainforest(url) {
  const apiKey = process.env.RAINFOREST_API_KEY;
  if (!apiKey) throw new Error('RAINFOREST_API_KEY absente du .env — étape ignorée');
  const res = await fetch(`https://api.rainforestapi.com/request?api_key=${apiKey}&type=product&amazon_domain=amazon.fr&url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`rainforestapi HTTP ${res.status}`);
  const data = await res.json();
  const price = data.product?.buybox_winner?.price?.value ?? null;
  if (price == null) throw new Error('rainforestapi : prix introuvable dans la réponse');
  return price;
}

// Tente chaque proxy DANS L'ORDRE, chacun avec TOUS les motifs d'extraction
// (voir PRICE_EXTRACTORS), s'arrête à la 1re combinaison qui réussit. Point 6
// de la demande : logge le proxy ET le motif d'extraction qui ont réussi,
// ainsi que chaque échec intermédiaire (avec sa raison) — pour diagnostiquer
// lequel des chemins fonctionne réellement pour un site marchand donné.
// Format de log EXACT demandé (2026-08-31, "DRASTIC FIX") pour toute URL
// Amazon avec un ASIN détecté, quelle que soit la méthode qui a fini par
// réussir — en plus (pas à la place) des logs `[Suivi de prix]`/`[Prix]`
// existants, plus détaillés mais génériques à tous les sites marchands.
function priceLogAmazonAsinResult(asin, price, method) {
  console.log(`[Prix Amazon] ASIN: ${asin} → Prix trouvé: ${price}€ via method ${method}`);
}

ipcMain.handle('priceTracking:fetchPrice', async (_e, url) => {
  const asin = priceExtractAsin(url);
  if (asin) console.log(`[Prix Amazon] ASIN détecté : ${asin} (depuis ${url})`);

  // Keepa EN PREMIER pour les URLs Amazon (voir priceTryKeepa ci-dessus) —
  // silencieusement ignorée sans clé, comme rainforestapi plus bas.
  if (asin) {
    try {
      const price = await priceTryKeepa(asin);
      priceLogAmazonAsinResult(asin, price, 'Keepa');
      return { price, method: 'Keepa' };
    } catch (err) {
      console.warn(`[Suivi de prix] ${url} — échec via "Keepa" :`, err.message);
    }
  }

  for (const [name, fetchFn] of PRICE_PROXIES) {
    try {
      const { price, pattern } = await priceTryProxy(name, fetchFn, url);
      const method = `${name} — ${pattern}`;
      console.log(`[Suivi de prix] ${url} — succès via proxy "${name}", motif "${pattern}" : ${price} €`);
      if (asin) priceLogAmazonAsinResult(asin, price, method);
      return { price, method };
    } catch (err) {
      console.warn(`[Suivi de prix] ${url} — échec via proxy "${name}" :`, err.message);
    }
  }

  // Endpoint AJAX mobile Amazon (voir priceAmazonMobileAjaxUrl ci-dessus) —
  // dernier recours SPÉCIFIQUE Amazon avant l'API tierce payante, tenté
  // seulement si un ASIN a été détecté (URL construite à partir de lui, pas
  // de l'URL produit d'origine).
  if (asin) {
    try {
      const ajaxUrl = priceAmazonMobileAjaxUrl(asin);
      const { price, pattern } = await priceTryProxy('Amazon AJAX mobile', (u) => fetch(u, { headers: PRICE_BROWSER_HEADERS }), ajaxUrl);
      const method = `Amazon AJAX mobile — ${pattern}`;
      priceLogAmazonAsinResult(asin, price, method);
      return { price, method };
    } catch (err) {
      console.warn(`[Suivi de prix] ${url} — échec via "Amazon AJAX mobile" :`, err.message);
    }
  }

  try {
    const price = await priceTryRainforest(url);
    console.log(`[Suivi de prix] ${url} — succès via "rainforestapi" : ${price} €`);
    if (asin) priceLogAmazonAsinResult(asin, price, 'rainforestapi');
    return { price, method: 'rainforestapi' };
  } catch (err) {
    console.warn(`[Suivi de prix] ${url} — échec via "rainforestapi" :`, err.message);
  }
  console.error(`[Suivi de prix] ${url} — TOUTES les méthodes ont échoué`);
  throw new Error('Prix introuvable (toutes les méthodes ont échoué)');
});

// Ce handler-ci ne fait PAS le fetch (voir priceTracking:fetchPrice
// ci-dessus) : il persiste le résultat déjà obtenu et décide si une
// notification est due — séparé du fetch pour que la comparaison "prix
// précédent" et la décision de notifier restent une SEULE source de vérité
// (le store), jamais recalculées indépendamment par chaque fenêtre qui
// pourrait avoir cette carte ouverte.
ipcMain.handle('priceTracking:reportPrices', (_e, fetched) => {
  if (!Array.isArray(fetched)) return [];

  const existing = userdataStore.get('modules.priceTracking.config.items') || [];
  const byUrl = new Map(existing.map(i => [i.url, i]));

  const updated = fetched.map(f => {
    const prev = byUrl.get(f.url);
    // `lastKnownPrice`/`lastKnownAt` (point 5 de la demande, 2026-08-31) :
    // JAMAIS remis à null par un échec — contrairement à `price` (l'état du
    // DERNIER essai, qui peut légitimement être null), ce champ ne progresse
    // que sur un succès et survit à n'importe quelle série d'échecs
    // ultérieurs, pour permettre au renderer d'afficher "dernier prix connu
    // (non mis à jour)" plutôt que juste "Indisponible".
    const lastKnownPrice = f.price ?? prev?.lastKnownPrice ?? null;
    const lastKnownAt = f.price != null ? new Date().toISOString() : (prev?.lastKnownAt || null);
    return {
      url: f.url,
      label: f.label || '',
      // `vendor` (2026-09-01, sur demande explicite — affichage renderer,
      // voir price-tracking.js priceVendorLabel) : replié sur l'entrée
      // EXISTANTE (`prev?.vendor`) si `f.vendor` est absent — sans repli, CE
      // handler écrase `modules.priceTracking.config.items` en ENTIER
      // (ci-dessous) à CHAQUE cycle de vérification (toutes les 2h), donc un
      // vendeur saisi dans Paramètres serait silencieusement effacé au
      // rafraîchissement suivant si on ne le reportait pas ici.
      vendor: f.vendor ?? prev?.vendor ?? null,
      targetPrice: f.targetPrice ?? null,
      price: f.price ?? null,
      previousPrice: prev?.price ?? null,
      lastKnownPrice,
      lastKnownAt,
      fetchMethod: f.fetchMethod || null,
      error: f.error || null,
      lastCheckedAt: new Date().toISOString(),
    };
  });

  // Persisté (+ backup/sync Drive, voir plus haut) seulement si au moins un
  // prix a réellement changé depuis la dernière vérification — évite une
  // écriture disque/upload Drive toutes les 2h pour rien quand rien n'a
  // bougé, même principe que le garde-fou `changed` de checkReminders.
  const pricesChanged = updated.length !== existing.length
    || updated.some(u => (byUrl.get(u.url)?.price ?? null) !== u.price);
  if (pricesChanged) {
    backupStoreBeforeWrite();
    userdataStore.set('modules.priceTracking.config.items', updated);
    scheduleUserdataBackup();
    uploadToDriveAfterChange();
  }

  // Notification native seulement au FRANCHISSEMENT du seuil (prix cible pas
  // encore atteint puis atteint) — jamais répétée à chaque vérification tant
  // que le prix reste bas, sinon une notification toutes les 2h à l'infini.
  for (const item of updated) {
    if (item.targetPrice == null || item.price == null) continue;
    const wasAboveOrUnknown = item.previousPrice == null || item.previousPrice > item.targetPrice;
    if (item.price <= item.targetPrice && wasAboveOrUnknown && Notification.isSupported()) {
      try {
        new Notification({
          title: `🔔 Prix atteint — ${item.label || 'Produit suivi'}`,
          body: `${item.price.toFixed(2)} € (objectif : ${item.targetPrice.toFixed(2)} €)`,
        }).show();
      } catch (err) {
        console.error('[Suivi de prix] Échec notification', err);
      }
    }
  }

  return updated;
});

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
// bas) : `performDriveLaunchSync`/`uploadToDriveAfterChange` ont
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

// Pousse un événement au dashboard pour l'indicateur "✓ Saved"
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
  console.log('[Drive Sync] notifyDriveSync appelé à', new Date(lastDriveSyncStatus.at).toISOString(), '(', lastDriveSyncStatus.at, 'ms epoch) — statut :', JSON.stringify(status));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('drive:syncStatus', lastDriveSyncStatus);
  }
}
ipcMain.handle('driveSync:getLastStatus', () => lastDriveSyncStatus);

// ─── Section "☁️ Google Drive" de la popup Paramètres → Sauvegardes
// (2026-08-31, sur demande explicite) — au-delà du simple indicateur
// transitoire ci-dessus, cette section affiche l'état RÉEL de Drive à la
// DEMANDE (interrogé en direct à chaque ouverture de la popup, pas un flag
// figé) : connecté ou non, et l'horodatage de dernière modification du
// fichier distant LUI-MÊME (`modifiedTime`, répond à "Drive a-t-il des
// données que je n'ai pas encore ?" — plus utile ici qu'un simple horodatage
// de dernière synchro déjà tentée par CETTE installation).
ipcMain.handle('driveSync:getInfo', async () => {
  const token = await getValidGoogleToken();
  if (!token?.accessToken) return { connected: false };
  try {
    const remote = await driveFindUserdataFile(token.accessToken);
    return { connected: true, modifiedTime: remote?.modifiedTime || null };
  } catch (err) {
    console.error('[Drive Sync] Échec driveSync:getInfo', err);
    return { connected: true, error: err.message };
  }
});

// Bouton "Restaurer depuis Drive" (même popup) — contrairement à
// performDriveLaunchSync plus bas (qui ne restaure QUE si Drive est plus
// récent que le local, comparaison d'horodatages), télécharge et applique le
// contenu de Drive INCONDITIONNELLEMENT : couvre le scénario "je sais que
// Drive a la bonne version, écrase le local" qu'aucune comparaison
// automatique ne gère (ex. local corrompu mais horodaté plus récemment que
// Drive). Même garde anti-perte que le reste de ce fichier (voir
// isUserdataEmptyModules) : refuse si Drive lui-même n'a rien de réel, jamais
// d'écrasement par du vide même sur une action explicite de l'utilisateur.
ipcMain.handle('driveSync:forceRestore', async () => {
  const token = await getValidGoogleToken();
  if (!token?.accessToken) throw new Error('Aucun compte Google connecté (Paramètres → Compte Google)');

  const remote = await driveFindUserdataFile(token.accessToken);
  if (!remote) throw new Error('Aucune sauvegarde trouvée sur Google Drive pour ce compte');

  const data = await driveDownloadUserdata(token.accessToken, remote.id);
  const downloadedModules = data?.modules && typeof data.modules === 'object' ? data.modules : data;
  if (isUserdataEmptyModules(downloadedModules)) throw new Error('La sauvegarde sur Google Drive est vide — rien à restaurer');

  store.set('driveSync.fileId', remote.id);
  driveApplyDownloadedUserdata(data);
  notifyDriveSync({ type: 'synced' });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  return { modifiedTime: remote.modifiedTime };
});

// Recherche le fichier matin-userdata.json dans appDataFolder (il n'y a qu'un
// seul fichier de ce nom possible côté Matin, mais Drive n'empêche pas
// techniquement les doublons de nom — `files[0]` suffit ici, jamais créé
// plus d'une fois par ce code). `null` si absent (1er lancement avec ce
// compte, ou appData jamais initialisée).
// Corps d'erreur Google systématiquement loggé (2026-08-30, sur demande
// explicite "logger la réponse complète de l'API Drive") — un simple code
// HTTP (403, 404...) ne dit pas POURQUOI (quota dépassé, scope insuffisant,
// API désactivée côté Cloud Console... tous des 403 différents avec des
// causes très différentes) ; le corps JSON de l'erreur Google, lui, le dit.
async function logDriveErrorBody(res, label) {
  try {
    const text = await res.text();
    console.error(`[Drive Sync] Réponse d'erreur complète (${label}) :`, text);
  } catch (err) {
    console.error(`[Drive Sync] Impossible de lire le corps de l'erreur (${label})`, err);
  }
}

async function driveFindUserdataFile(accessToken) {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    await logDriveErrorBody(res, 'recherche');
    throw new Error(`Drive (recherche) ${res.status}`);
  }
  const data = await res.json();
  return (data.files && data.files[0]) || null;
}

async function driveDownloadUserdata(accessToken, fileId) {
  const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    await logDriveErrorBody(res, 'téléchargement');
    throw new Error(`Drive (téléchargement) ${res.status}`);
  }
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
    if (!res.ok) {
      await logDriveErrorBody(res, 'envoi (mise à jour)');
      throw new Error(`Drive (envoi) ${res.status}`);
    }
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
  if (!res.ok) {
    await logDriveErrorBody(res, 'création');
    throw new Error(`Drive (création) ${res.status}`);
  }
  return res.json();
}

// Remplace `userdataStore` par le contenu téléchargé — tolère un fichier
// distant qui serait déjà `{ modules: {...} }` (format normal, ce que ce
// code écrit) ou, par prudence, un objet `modules` nu (jamais écrit par ce
// code mais coûte rien à accepter). `backupStoreBeforeWrite` avant
// d'écraser, comme tout autre remplacement complet du store dans ce fichier
// (voir backups:restore).
//
// Pousse `drive:userdataRestored` pour un re-rendu EN PLACE — PAS
// `modules:updated` (bug réel trouvé le 2026-08-30, 4e passe de diagnostic
// de l'indicateur Drive) : ce dernier a UN SEUL écouteur côté renderer
// (`window.matin.modules.onUpdated`, voir dashboard.js) et fait
// `window.location.reload()` INCONDITIONNELLEMENT — exactement le
// rechargement perceptible que ce commentaire prétendait éviter depuis
// l'origine (2026-08-21), alors qu'il l'envoyait sur ce même canal. Symptôme
// observé : dès que Drive a des données plus récentes (branche "restaure"),
// toute la fenêtre se rechargeait — nouveau splash rejoué en entier,
// indicateur de sync coupé net en plein affichage. `drive:userdataRestored`
// est un canal dédié, écouté séparément (voir dashboard.js) pour ne
// ré-afficher QUE le contenu des cartes concernées via `renderModuleOnce`,
// sans jamais toucher position/taille/disposition (que Drive ne synchronise
// de toute façon jamais, voir USERDATA_MODULE_KEYS) ni recharger la page.
function driveApplyDownloadedUserdata(data) {
  if (!data || typeof data !== 'object') return;
  const modules = data.modules && typeof data.modules === 'object' ? data.modules : data;
  backupStoreBeforeWrite();
  userdataStore.set('modules', modules);
  scheduleUserdataBackup(); // 2026-08-30 — le contenu qui vient d'arriver de Drive mérite lui aussi son propre instantané local
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('drive:userdataRestored', getMergedModules());
  }
}

// Upload silencieux de l'état ACTUEL de matin-userdata — utilisé à la fois
// par la sync de lancement (aucune version distante, ou version locale plus
// récente) et par l'upload IMMÉDIAT déclenché après chaque changement de
// donnée (voir uploadToDriveAfterChange plus bas, plus de débounce depuis le
// 2026-08-31). Jamais de notifyDriveSync ici : silencieux par design, seule
// la sync de LANCEMENT affiche l'indicateur.
//
// PROTECTION ANTI-PERTE (2026-08-30, sur demande explicite, suite à
// l'incident de perte de données ETF/Crypto/Prêts) : vérifie le contenu
// RÉEL de matin-userdata AVANT tout appel réseau — si local est vide, aucun
// upload n'est tenté, quelle que soit la raison de l'appel (1re synchro,
// "local plus récent", debounce après changement). Sans ce garde-fou, un
// vide LOCAL accidentel (bug, store corrompu, course entre process...)
// finit par écraser la seule copie potentiellement bonne restante — celle
// sur Drive — exactement le scénario qui a causé l'incident du 2026-08-30
// (voir CONTEXT.md). Retourne `null` (jamais une exception) : chaque
// appelant doit gérer ce cas comme "rien à faire", pas comme une erreur.
async function driveUploadCurrent(accessToken) {
  const modules = userdataStore.get('modules');
  if (isUserdataEmptyModules(modules)) {
    console.warn('[Drive Sync] Upload IGNORÉ — matin-userdata est vide localement (protection anti-perte). Drive conservé tel quel, rien envoyé.');
    return null;
  }
  let fileId = store.get('driveSync.fileId') || null;
  const result = await driveUploadUserdata(accessToken, fileId);
  store.set('driveSync.fileId', result.id);
  return result;
}

// ─── Upload IMMÉDIAT après changement de donnée (2026-08-31, sur demande
// explicite, point 1 — remplace le débounce 5s/plafond 30s introduit le
// 2026-08-21) : plus aucun délai artificiel, l'upload part dès l'appel,
// simplement pas attendu par l'appelant (fire-and-forget — un
// `Enregistrer`/glisser-déposer ne doit pas se bloquer sur un aller-retour
// réseau Drive). Pas de file d'attente/verrou entre appels concurrents : les
// PATCH Drive sont idempotents sur le MÊME fileId (dernier écrit gagne), et
// des changements assez rapprochés pour se chevaucher réellement en pratique
// portent de toute façon un contenu quasi identique.
function uploadToDriveAfterChange() {
  (async () => {
    const token = await getValidGoogleToken();
    if (!token?.accessToken) return; // pas connecté — ignoré silencieusement
    try {
      const result = await driveUploadCurrent(token.accessToken);
      if (result) console.log('[Drive] Local plus récent → upload vers Drive', result.id, result.modifiedTime);
      // sinon déjà loggé (avertissement, protection anti-perte) par driveUploadCurrent
    } catch (err) {
      console.error('[Drive] Échec de l’upload immédiat après changement', err);
    }
  })();
}

// ─── Sync au lancement (points 2, 4 et 5 de la demande) ────────────────────
// Appelée une seule fois par lancement, APRÈS autoRestoreUserdataIfEmpty
// (déjà exécutée de façon synchrone plus haut dans ce fichier au chargement
// du module) : évalue donc l'état local FINAL de la session, restauration
// locale automatique déjà prise en compte le cas échéant.
async function performDriveLaunchSync() {
  console.log('[Drive Sync] Démarrage de la synchronisation au lancement');
  const token = await getValidGoogleToken();
  if (!token?.accessToken) {
    // point 6 : pas de compte Google connecté, ignoré silencieusement CÔTÉ
    // UTILISATEUR (aucune UI, aucun blocage) — ce log reste réservé à la
    // console développeur, dans le même esprit que les logs d'état déjà en
    // place pour chaque module (FDJ, RSS, Promos...).
    console.log('[Drive Sync] Google non connecté — synchronisation ignorée');
    return;
  }
  console.log('[Drive Sync] Token Google valide, email =', token.email);

  try {
    const remote = await driveFindUserdataFile(token.accessToken);
    console.log('[Drive Sync] Recherche du fichier distant —', remote ? `trouvé (id=${remote.id}, modifiedTime=${remote.modifiedTime})` : 'aucun fichier distant');

    if (!remote) {
      // Rien sur Drive pour ce compte — 1re synchronisation, envoie l'état
      // local actuel. `driveUploadCurrent` refuse tout seul si local est
      // vide (protection anti-perte, voir sa définition plus haut) : dans ce
      // cas on ne crée PAS de fichier Drive vide, on attend d'avoir de
      // vraies données à envoyer.
      const result = await driveUploadCurrent(token.accessToken);
      if (result) {
        console.log('[Drive Sync] 1re synchronisation — envoi local effectué, id =', result.id);
        notifyDriveSync({ type: 'synced' });
      } else {
        console.warn('[Drive Sync] 1re synchronisation IGNORÉE — local vide, aucun fichier Drive créé (protection anti-perte)');
        notifyDriveSync({ type: 'emptyLocal' });
      }
      console.log('[Drive Sync] notifyDriveSync envoyé, mainWindow présent =', !!(mainWindow && !mainWindow.isDestroyed()));
      return;
    }
    store.set('driveSync.fileId', remote.id);

    const localEmpty = isUserdataEmpty();
    if (localEmpty) {
      // Drive a un fichier, le local n'en a pas — tente une restauration
      // automatique, mais vérifie le contenu RÉEL du téléchargement avant de
      // prétendre avoir "synchronisé" : si Drive lui-même est vide (voir
      // l'incident du 2026-08-30, où c'était exactement le cas), il n'y a
      // rien à appliquer — la restauration locale par sauvegarde
      // (autoRestoreUserdataIfEmpty, déjà tentée avant cette fonction) reste
      // la seule chance, et si elle a échoué aussi, il faut le signaler
      // plutôt que d'afficher un "✓ synchronisé" trompeur.
      const data = await driveDownloadUserdata(token.accessToken, remote.id);
      const downloadedModules = data?.modules && typeof data.modules === 'object' ? data.modules : data;
      if (isUserdataEmptyModules(downloadedModules)) {
        console.warn('[Drive Sync] Local vide ET Drive vide — rien à restaurer depuis Drive');
        notifyDriveSync({ type: 'emptyLocal' });
      } else {
        driveApplyDownloadedUserdata(data);
        console.log('[Drive Sync] Local vide — restauration depuis Drive effectuée');
        notifyDriveSync({ type: 'synced' });
      }
      console.log('[Drive Sync] notifyDriveSync envoyé, mainWindow présent =', !!(mainWindow && !mainWindow.isDestroyed()));
      return;
    }

    // Local ET Drive ont tous deux des données — comparaison des horodatages
    // réels (mtime du fichier matin-userdata.json sur disque, modifiedTime
    // renvoyé par Drive) plutôt qu'un horodatage maison à maintenir en
    // parallèle : toujours exact, mis à jour par electron-store/Drive
    // eux-mêmes à chaque écriture, aucun risque de désynchronisation.
    const localMtimeMs = fs.existsSync(userdataStore.path) ? fs.statSync(userdataStore.path).mtimeMs : 0;
    const remoteMtimeMs = new Date(remote.modifiedTime).getTime();

    // Comparaison STRICTE (2026-08-31, sur demande explicite, points 2/3/4 —
    // remplace la fenêtre de conflit d'1h du 2026-08-21, qui faisait gagner
    // Drive même quand le local était RÉELLEMENT plus récent de quelques
    // minutes) : Drive ne l'emporte QUE s'il est STRICTEMENT plus récent que
    // le local. Une égalité exacte (cas limite improbable) reste local par
    // défaut — jamais Drive n'écrase une donnée locale plus récente ou de
    // même âge, conformément au point 4 ("Never overwrite local data that is
    // newer than Drive data").
    const driveWins = remoteMtimeMs > localMtimeMs;
    console.log('[Drive Sync] Comparaison horodatages — local =', new Date(localMtimeMs).toISOString(), ', distant =', new Date(remoteMtimeMs).toISOString(), ', driveWins =', driveWins);

    if (driveWins) {
      const data = await driveDownloadUserdata(token.accessToken, remote.id);
      const downloadedModules = data?.modules && typeof data.modules === 'object' ? data.modules : data;
      // Garde-fou symétrique (défense en profondeur, 2026-08-30) : Drive
      // "gagne" sur l'horodatage mais son contenu est VIDE alors que le
      // local, lui, a du contenu réel — appliquer quand même écraserait de
      // bonnes données locales avec du vide. On refuse le téléchargement et
      // on renvoie le local vers Drive à la place (auto-réparation).
      if (isUserdataEmptyModules(downloadedModules)) {
        console.warn('[Drive Sync] Drive plus récent mais VIDE, et le local a du contenu — téléchargement refusé (protection anti-perte), le local est renvoyé vers Drive à la place');
        await driveUploadCurrent(token.accessToken);
      } else {
        driveApplyDownloadedUserdata(data);
        console.log('[Drive] Drive plus récent → téléchargement'); // format exact demandé (point 5)
        console.log('[Drive Sync] Drive plus récent — téléchargement + application effectués');
      }
    } else {
      await driveUploadCurrent(token.accessToken); // ne peut pas être vide ici (localEmpty déjà écarté plus haut), gardé par cohérence/défense en profondeur
      console.log('[Drive] Local plus récent → upload vers Drive'); // format exact demandé (point 5)
      console.log('[Drive Sync] Local plus récent — envoi effectué');
    }
    notifyDriveSync({ type: 'synced' });
    console.log('[Drive Sync] notifyDriveSync({type:"synced"}) envoyé, mainWindow présent =', !!(mainWindow && !mainWindow.isDestroyed()));
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
// si la liste de catégories change. Mise à jour le 2026-09-01 (sur demande
// explicite, catégories remplacées : health/call/task/birthday/other →
// health/call/event/admin/home/work).
const REMINDER_ICONS = { health: '💊', call: '📞', event: '🎂', admin: '💰', home: '🏠', work: '💼' };

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
    scheduleUserdataBackup(); // voir "Sauvegardes automatiques déclenchées par changement" plus bas
    uploadToDriveAfterChange(); // voir Sync Google Drive plus bas
  }
}

// Vérifié toutes les 30s (pas 60s malgré la consigne "check every minute") :
// un setInterval(fn, 60000) dérive légèrement au fil du temps (le délai entre
// deux appels n'est jamais exactement 60000ms) et pourrait sauter la minute
// exacte ciblée par un rappel. Vérifier deux fois par minute élimine ce risque
// sans jamais notifier deux fois (voir le garde-fou `lastFired` ci-dessus) —
// c'est donc une vérification AU MOINS chaque minute, en plus fiable.
const REMINDERS_CHECK_MS = 30 * 1000;

// ─── Alertes — bandeau plein écran (enlèvement, météo, Vigipirate) ─────────
// "Rappels produits" (RappelConso) retiré ENTIÈREMENT le 2026-09-01, sur
// demande explicite — voir alertsCheckRappelConso, ALERTS_RAPPELCONSO_URL/
// _WINDOW_H, supprimées (plus aucune trace, y compris dans le type par
// défaut de la config, voir MODULE_DEFAULTS.alerts plus haut).
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

// ─── Trafic routier — DATEX II (2026-09-01, sur demande explicite) ─────────
// PAS IMPLÉMENTÉ CONTRE UN VRAI ENDPOINT — délibérément, contrairement à
// toutes les autres sources de ce fichier (même les moins vérifiées, ex.
// Météo France ci-dessus, appellent au moins une URL précise avec un schéma
// d'auth documenté). DATEX II est un FORMAT d'échange XML normalisé
// européen, pas une API REST unique : les 2 URLs données
// (diffusion.datex2.fr, bison-fute.gouv.fr) ne sont pas, à connaissance
// vérifiable ici, des endpoints JSON/XML publics interrogeables sans
// inscription — `diffusion.datex2.fr` ressemble à un nœud de diffusion
// professionnel (accès généralement soumis à convention/abonnement entre
// gestionnaires de voirie), et bison-fute.gouv.fr est le site web grand
// public (pages HTML), pas une API. Aucune requête n'est donc tentée contre
// ces URLs telles quelles : le risque était d'implémenter un appel qui
// échoue silencieusement à chaque cycle (401/403/page HTML au lieu de
// XML) et de faire croire la fonctionnalité opérationnelle alors qu'elle ne
// le serait jamais. Le toggle "Trafic routier" existe déjà dans Paramètres
// (voir config.js) et ce garde-fou explicite ci-dessous — reste à brancher
// une VRAIE source (URL + identifiants confirmés, ou un jeu de données
// data.gouv.fr équivalent) une fois connue.
async function alertsCheckTrafic() {
  const department = store.get('modules.alerts.config.department');
  if (!department) return [];
  console.warn('[Alertes] Trafic routier (DATEX II) : aucun endpoint confirmé pour l\'instant — voir le commentaire au-dessus d\'alertsCheckTrafic dans main.js. Fonctionnalité désactivée en pratique tant qu\'une source réelle n\'est pas branchée ici.');
  return [];
}

let alertsKnownIds = new Set(store.get('alertsCache.knownIds') || []);
let alertsCurrent = [];

// SNCF retiré entièrement le 2026-09-01 (sur demande explicite) — c'était le
// seul type d'alerte sur un cycle séparé (10 min contre 15 min pour le
// reste), d'où l'ancien découpage alertsNonSncfCurrent/alertsSncfCurrent +
// alertsMergeAndNotify pour les recombiner sans qu'un cycle écrase la
// mémoire "déjà notifié" de l'autre. Plus qu'UN SEUL cycle désormais
// (checkAlerts, ALERTS_CHECK_MS) : notification simplifiée en une fonction
// unique, plus de fusion nécessaire.
function alertsNotify(alerts) {
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
  return alertsCurrent;
}

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
  if (types.meteo !== false) {
    checks.push(alertsCheckMeteo()
      .catch(err => { console.warn('[Alertes] Vigilance météo indisponible', err.message); return []; }));
  }
  if (types.trafic !== false) {
    checks.push(alertsCheckTrafic()
      .catch(err => { console.warn('[Alertes] Trafic routier indisponible', err.message); return []; }));
  }

  const results = await Promise.all(checks);
  return alertsNotify(results.flat());
}

ipcMain.handle('alerts:getCurrent', () => alertsCurrent);

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  // Réapplique l'inscription registre à CHAQUE lancement (voir
  // app:setStartOnBoot/computeLoginItemSettings plus haut) — pas juste au
  // moment du clic dans Paramètres, pour rester cohérent même si le
  // binaire/raccourci lancé a changé entre-temps (ex. déplacement du
  // dossier projet, voir CONTEXT.md).
  app.setLoginItemSettings(computeLoginItemSettings(store.get('app.startOnBoot') === true));
  performDriveLaunchSync().catch(err => console.error('[Drive Sync] Échec inattendu de la synchronisation au lancement', err));
  checkReminders();
  setInterval(checkReminders, REMINDERS_CHECK_MS);
  checkAlerts();
  setInterval(checkAlerts, ALERTS_CHECK_MS);
  checkProfileAutoSwitch();
  setInterval(checkProfileAutoSwitch, PROFILE_AUTOSWITCH_CHECK_MS);

  // Raccourci dev "test responsive" (voir cycleDevWindowSizeTest plus haut) —
  // UNIQUEMENT en dev (même convention que mainWindow.webContents.
  // openDevTools() dans createMainWindow, seul autre endroit du projet qui
  // distingue dev/prod), pour ne jamais l'exposer dans le build Store.
  if (process.argv.includes('--dev')) {
    const registered = globalShortcut.register('CommandOrControl+Shift+R', cycleDevWindowSizeTest);
    if (!registered) console.warn('[DevTools] Échec de l\'enregistrement du raccourci Ctrl+Shift+R (test responsive)');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
