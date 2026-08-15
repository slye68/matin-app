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

  // ── Sauvegardes (voir main.js writeLaunchBackup, 2026-08-10) ───────────────
  backups: {
    list:    ()     => ipcRenderer.invoke('backups:list'),
    restore: (file) => ipcRenderer.invoke('backups:restore', file),
  },

  // ── Thème clair/sombre — voir main.js (titleBarColorsForTheme, IPC
  // app:setTheme) pour la synchronisation avec titleBarOverlay/backgroundColor.
  theme: {
    set:       (theme) => ipcRenderer.invoke('app:setTheme', theme),
    onUpdated: (cb)     => ipcRenderer.on('theme:updated', (_e, theme) => cb(theme)),
  },

  // ── Fond personnalisé du dashboard (2026-08-11, voir main.js app:setBackground) ──
  background: {
    set:       (key) => ipcRenderer.invoke('app:setBackground', key),
    onUpdated: (cb)   => ipcRenderer.on('background:updated', (_e, key) => cb(key)),
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

  // ── Fenêtres ──────────────────────────────────────────────────────────────
  window: {
    openConfig: () => ipcRenderer.invoke('window:openConfig'),
    closeConfig: () => ipcRenderer.invoke('window:closeConfig'),
  },

  // ── Shell ─────────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // ── RSS (fetch sans restriction CORS, exécuté dans le process main) ────────
  rss: {
    fetchFeed: (url) => ipcRenderer.invoke('rss:fetchFeed', url),
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
