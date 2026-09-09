const { contextBridge, ipcRenderer } = require('electron');

// Thème clair/sombre — LU DE FAÇON SYNCHRONE ici (une seule fois, à
// l'exécution de ce preload, avant que la page ne s'affiche) pour pouvoir
// l'exposer comme une simple valeur (`window.matin.initialTheme`), pas une
// Promise : le <script> en tête de <head> d'index.html/config.html pose
// `document.documentElement.dataset.colorScheme` de façon synchrone, AVANT
// le premier rendu, pour éviter un flash du mauvais thème (voir main.js,
// ipcMain.on('theme:getInitial', ...) — sync exprès, pas .handle()).
const initialTheme = ipcRenderer.sendSync('theme:getInitial');

// API exposée au renderer — aucun accès Node direct
contextBridge.exposeInMainWorld('matin', {
  initialTheme,

  // ── Config store ──────────────────────────────────────────────────────────
  store: {
    get:    (key)        => ipcRenderer.invoke('store:get', key),
    set:    (key, value) => ipcRenderer.invoke('store:set', key, value),
    getAll: ()           => ipcRenderer.invoke('store:getAll'),
  },

  // ── Sauvegardes (voir main.js writeLaunchBackup, 2026-08-10 ; export/import
  // manuel + protection anti-perte ajoutés le 2026-08-30) ────────────────────
  backups: {
    list:         ()     => ipcRenderer.invoke('backups:list'),
    restore:      (file) => ipcRenderer.invoke('backups:restore', file),
    exportManual: ()     => ipcRenderer.invoke('backups:exportManual'),
    importManual: ()     => ipcRenderer.invoke('backups:importManual'),
  },

  // ── Données manquantes (2026-08-30, voir main.js isUserdataEmpty) —
  // vérifié en direct par le renderer (dashboard.js), pas un flag figé au
  // lancement, pour rester à jour après une restauration survenue en cours
  // de session (auto/Drive/manuelle). ─────────────────────────────────────
  userdata: {
    isEmpty: () => ipcRenderer.invoke('userdata:isEmpty'),
  },

  // ── Thème clair/sombre — voir main.js (titleBarColorsForTheme, IPC
  // app:setTheme) pour la synchronisation avec titleBarOverlay/backgroundColor.
  theme: {
    set:       (theme) => ipcRenderer.invoke('app:setTheme', theme),
    // `setAuto`/app:applyAutoTheme (mode auto luminosité) SUPPRIMÉS
    // ENTIÈREMENT le 2026-08-31, sur demande explicite (voir CONTEXT.md).
    onUpdated: (cb)     => ipcRenderer.on('theme:updated', (_e, theme) => cb(theme)),
  },

  // ── Fond personnalisé du dashboard (2026-08-11, voir main.js app:setBackground) ──
  background: {
    set:       (key) => ipcRenderer.invoke('app:setBackground', key),
    onUpdated: (cb)   => ipcRenderer.on('background:updated', (_e, key) => cb(key)),
  },

  // ── Mode d'affichage — Icône flottante (2026-08-23, voir main.js
  // applyDisplayMode et "🎨 Personnaliser" → section "Mode d'affichage") —
  // `expandFromSun` est appelé depuis sun.html (fenêtre séparée, mais qui
  // charge ce même preload.js), tous les autres depuis le dashboard
  // (renderer/dashboard.js, initDisplayMode). Volet latéral SUPPRIMÉ
  // ENTIÈREMENT le 2026-09-01, sur demande explicite (voir CONTEXT.md) :
  // `setSidebarEdge`/`sidebarStripClick`/`hideSidebarToStrip` retirés. ─────
  displayMode: {
    set:              (mode) => ipcRenderer.invoke('app:setDisplayMode', mode),
    collapseToSun:    ()     => ipcRenderer.invoke('dashboard:collapseToSun'),
    expandFromSun:    ()     => ipcRenderer.invoke('sun:expand'),
    forceShowFromSun: ()     => ipcRenderer.invoke('sun:forceShow'),
    showSunContextMenu:()    => ipcRenderer.invoke('sun:contextMenu'),
    getSunPosition:   ()     => ipcRenderer.invoke('sun:getPosition'),
    moveSunWindow:    (x, y) => ipcRenderer.send('sun:move', { x, y }),
    onUpdated:        (cb)   => ipcRenderer.on('displayMode:updated', (_e, mode) => cb(mode)),
  },

  // ── Restauration automatique au lancement (voir main.js
  // autoRestoreUserdataIfEmpty, 2026-08-10) ───────────────────────────────────
  getAutoRestoreNotice: () => ipcRenderer.invoke('app:getAutoRestoreNotice'),

  // ── Modules ───────────────────────────────────────────────────────────────
  modules: {
    getAll: ()        => ipcRenderer.invoke('modules:getAll'),
    update: (data)    => ipcRenderer.invoke('modules:update', data),
    updateLayout: (data) => ipcRenderer.invoke('modules:updateLayout', data),
    updateCollapsed: (key, collapsed) => ipcRenderer.invoke('modules:updateCollapsed', { key, collapsed }),
    onUpdated: (cb)   => ipcRenderer.on('modules:updated', (_e, data) => cb(data)),
  },

  // ── Emplacements de disposition sauvegardés (2026-08-31, voir main.js
  // layoutSlots:get/save) — 2 emplacements fixes ("1"/"2"), stockés dans
  // matin-userdata (synchronisé automatiquement via Drive). `save` renvoie
  // l'entrée fraîchement écrite `{ name, layout, savedAt }`. ────────────────
  layoutSlots: {
    get:  ()                    => ipcRenderer.invoke('layoutSlots:get'),
    save: (slot, layout, name)  => ipcRenderer.invoke('layoutSlots:save', { slot, layout, name }),
  },

  // ── Profils (2026-08-31, voir main.js profiles:*) — 2 profils nommés,
  // chacun capturant enabled/layout de tous les modules + le thème + son
  // propre nom (PAS le `config` de chaque module, voir main.js). `getAll`
  // renvoie `{ active, profile1, profile2 }` en entier (utilisé à la fois par
  // Paramètres et par le sélecteur du titrebar, voir dashboard.js). ─────────
  profiles: {
    getAll:        ()                    => ipcRenderer.invoke('profiles:getAll'),
    save:          (key, name)           => ipcRenderer.invoke('profiles:save', { key, name }),
    rename:        (key, name)           => ipcRenderer.invoke('profiles:rename', { key, name }),
    switch:        (key)                 => ipcRenderer.invoke('profiles:switch', key),
    setAutoSwitch: (key, enabled, days)  => ipcRenderer.invoke('profiles:setAutoSwitch', { key, enabled, days }),
  },

  // ── Fenêtres ──────────────────────────────────────────────────────────────
  window: {
    openConfig: (opts) => ipcRenderer.invoke('window:openConfig', opts),
    closeConfig: () => ipcRenderer.invoke('window:closeConfig'),
    // Portrait (2026-09-09, sur demande explicite) — s'assure que la fenêtre
    // fait au moins `minW` de large (jamais ne la rétrécit) au moment où le
    // mode portrait s'active, voir dashboard.js btnPortraitMode. `send` (pas
    // `invoke`) : fire-and-forget, aucune réponse attendue, même schéma que
    // `sun:move` ci-dessous.
    ensureWidth: (minW) => ipcRenderer.send('window:ensure-width', minW),
  },

  // ── Shell ─────────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    // 2026-08-30, voir bouton "📥 Exporter mes données" (Paramètres →
    // Sauvegardes) — révèle le fichier fraîchement exporté dans l'Explorateur.
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  },

  // ── RSS (fetch sans restriction CORS, exécuté dans le process main) ────────
  rss: {
    fetchFeed: (url) => ipcRenderer.invoke('rss:fetchFeed', url),
  },

  // ── Suivi de prix Marchand (2026-08-30) — le fetch lui-même a déménagé côté
  // process main le 2026-08-31 (voir main.js priceTracking:fetchPrice,
  // cascade jina.ai/allorigins/direct/rainforestapi) : le renderer
  // n'orcheste plus rien, juste `fetchPrice` puis `reportPrices` (persistance
  // + notification, inchangé). ────────────────────────────────────────────
  priceTracking: {
    fetchPrice:   (url)     => ipcRenderer.invoke('priceTracking:fetchPrice', url),
    reportPrices: (fetched) => ipcRenderer.invoke('priceTracking:reportPrices', fetched),
  },

  // ── FDJ (résultats Loto/EuroMillions/EuroDreams, exécuté dans le process main) ──
  fdj: {
    fetchLatestDraw: (game) => ipcRenderer.invoke('fdj:fetchLatestDraw', game),
    fetchWinningCodes: () => ipcRenderer.invoke('fdj:fetchWinningCodes'),
  },

  // ── Philips Hue (pont local, exécuté dans le process main — pas de CORS côté pont) ──
  hue: {
    discoverBridge: () => ipcRenderer.invoke('hue:discoverBridge'),
    pair: (bridgeIp) => ipcRenderer.invoke('hue:pair', bridgeIp),
    getGroups: (params) => ipcRenderer.invoke('hue:getGroups', params),
    setGroupState: (params) => ipcRenderer.invoke('hue:setGroupState', params),
    // ── Sans pont — compte cloud (2026-08-31, voir main.js hue-oauth.js) ──
    // Le rafraîchissement du token est géré ENTIÈREMENT côté main
    // (getValidHueCloudToken, voir main.js) — `cloudGetGroups`/
    // `cloudSetGroupState` n'ont besoin d'aucun identifiant en paramètre.
    cloudLogin:        (params) => ipcRenderer.invoke('hue:cloudLogin', params),
    cloudGetGroups:    ()       => ipcRenderer.invoke('hue:cloudGetGroups'),
    cloudSetGroupState:(params) => ipcRenderer.invoke('hue:cloudSetGroupState', params),
  },

  // ── TP-Link Kasa (réseau local, exécuté dans le process main — vraies
  // sockets UDP/TCP nécessaires pour ce protocole, impossibles depuis le
  // renderer contextIsolation) ────────────────────────────────────────────────
  kasa: {
    discover: (subnet) => ipcRenderer.invoke('kasa:discover', { subnet }),
    getDevices: () => ipcRenderer.invoke('kasa:getDevices'),
    setPower: (params) => ipcRenderer.invoke('kasa:setPower', params),
    setBulbState: (params) => ipcRenderer.invoke('kasa:setBulbState', params),
    turnAll: (on) => ipcRenderer.invoke('kasa:turnAll', { on }),
  },

  // ── IKEA Trådfri (passerelle locale CoAP/DTLS, exécuté dans le process
  // main — vraie socket UDP DTLS nécessaire, impossible depuis le renderer
  // contextIsolation) — gatewayIp/identity/psk toujours transmis par
  // l'appelant (mod.config déjà en mémoire côté renderer), jamais relus
  // depuis electron-store ici, même logique que window.matin.hue ──────────
  tradfri: {
    connect: (gatewayIp, code) => ipcRenderer.invoke('tradfri:connect', { gatewayIp, code }),
    getState: (params) => ipcRenderer.invoke('tradfri:getState', params),
    setLightState: (params) => ipcRenderer.invoke('tradfri:setLightState', params),
    setPlugState: (params) => ipcRenderer.invoke('tradfri:setPlugState', params),
    activateScene: (params) => ipcRenderer.invoke('tradfri:activateScene', params),
    turnAll: (params) => ipcRenderer.invoke('tradfri:turnAll', params),
  },

  // ── Carburants (data.economie.gouv.fr, exécuté dans le process main) ───────
  fuel: {
    fetchNearby: (coords) => ipcRenderer.invoke('fuel:fetchNearby', coords),
  },

  // ── Promos Steam (exécuté dans le process main) ─────────────────────────────
  steamPromos: {
    fetchDeals: () => ipcRenderer.invoke('steamPromos:fetchDeals'),
  },

  // ── Promos Epic Games (exécuté dans le process main) ────────────────────────
  epicPromos: {
    fetchDeals: () => ipcRenderer.invoke('epicPromos:fetchDeals'),
  },

  // ── Réglages applicatifs divers, non liés à un module (2026-08-30) ──────────
  app: {
    // Démarrage automatique Windows — voir main.js app:setStartOnBoot.
    setStartOnBoot: (enabled) => ipcRenderer.invoke('app:setStartOnBoot', enabled),
  },

  // ── Google OAuth ──────────────────────────────────────────────────────────
  google: {
    getToken:       ()         => ipcRenderer.invoke('google:getToken'),
    getValidToken:  ()         => ipcRenderer.invoke('google:getValidToken'),
    setToken:       (data)     => ipcRenderer.invoke('google:setToken', data),
    login:          ()         => ipcRenderer.invoke('google:login'),
    logout:         ()         => ipcRenderer.invoke('google:logout'),
    onTokenUpdated: (cb)       => ipcRenderer.on('google:tokenUpdated', (_e, data) => cb(data)),
  },

  // ── Spotify OAuth ─────────────────────────────────────────────────────────
  spotify: {
    getToken:       ()         => ipcRenderer.invoke('spotify:getToken'),
    getValidToken:  ()         => ipcRenderer.invoke('spotify:getValidToken'),
    setToken:       (data)     => ipcRenderer.invoke('spotify:setToken', data),
    login:          ()         => ipcRenderer.invoke('spotify:login'),
    logout:         ()         => ipcRenderer.invoke('spotify:logout'),
    onTokenUpdated: (cb)       => ipcRenderer.on('spotify:tokenUpdated', (_e, data) => cb(data)),
  },

  // ── Sync Google Drive (dossier appData, voir main.js performDriveLaunchSync/
  // scheduleDriveUploadAfterChange, 2026-08-21) — entièrement automatique côté
  // process main (aucune action renderer requise pour déclencher une sync) ;
  // le renderer se contente d'afficher un indicateur transitoire.
  // `getLastStatus` rattrape un statut de sync déjà survenu avant que le
  // dashboard ait fini d'enregistrer son écouteur `onStatus` (voir dashboard.js).
  driveSync: {
    getLastStatus: () => ipcRenderer.invoke('driveSync:getLastStatus'),
    onStatus:      (cb) => ipcRenderer.on('drive:syncStatus', (_e, status) => cb(status)),
    // Canal dédié (2026-08-30, bug trouvé : réutiliser modules:updated
    // provoquait un window.location.reload() complet à chaque restauration
    // automatique, voir main.js driveApplyDownloadedUserdata) — un re-rendu
    // EN PLACE des seules cartes concernées, pas un rechargement de page.
    onUserdataRestored: (cb) => ipcRenderer.on('drive:userdataRestored', (_e, modules) => cb(modules)),
    // Section "☁️ Google Drive" de la popup Sauvegardes (2026-08-31, voir
    // main.js driveSync:getInfo/driveSync:forceRestore) — getInfo interroge
    // Drive en direct (connecté ? dernière modification distante ?),
    // forceRestore télécharge et applique le contenu de Drive SANS comparer
    // les horodatages (contrairement à la sync automatique de lancement).
    getInfo:       () => ipcRenderer.invoke('driveSync:getInfo'),
    forceRestore:  () => ipcRenderer.invoke('driveSync:forceRestore'),
  },

  // ── Alertes (bandeau plein écran, voir main.js checkAlerts) ─────────────────
  // Le check tourne côté process main (fetch direct, notifications natives) —
  // getCurrent() renvoie l'instantané déjà calculé, onUpdate() pousse chaque
  // nouveau calcul (toutes les 15 min, ou aussitôt après un changement de
  // config sauvegardé) sans que le renderer ait besoin de re-fetcher lui-même.
  alerts: {
    getCurrent: ()   => ipcRenderer.invoke('alerts:getCurrent'),
    onUpdate:   (cb) => ipcRenderer.on('alerts:updated', (_e, data) => cb(data)),
  },
});
