/**
 * MATIN!* — Page de configuration
 * Drag-and-drop, toggles, Google OAuth
 */

const MODULE_META = {
  // Champ "Ville" ajouté le 2026-08-15 (bug signalé : aucun moyen de changer
  // la ville depuis Paramètres jusqu'ici — `weather.js` lisait bien
  // `config.city` mais `MODULE_META.weather` n'avait aucun `configField`,
  // donc aucun champ n'était jamais rendu). Même mécanisme générique que
  // Carburants ci-dessous (`value="${currentValue}"` posé par le rendu
  // générique du `configField`, voir plus bas dans ce fichier) — la ville
  // ACTUELLEMENT configurée s'affiche donc directement dans le champ, pas
  // seulement en fond de placeholder.
  weather:  { label: 'Météo',        icon: '🌤️',  requiresGoogle: false,
              configField: { key: 'city', label: 'Ville', placeholder: 'Lyon' } },
  // newsSourcesField (2026-09-01, sur demande explicite) — cases à cocher
  // pour les sources RSS disponibles de ce module, voir son dispatch générique
  // plus bas (un seul bloc pour France/Tech/Bourse/Gaming, consolidé le même
  // jour après duplication France→Tech→Bourse→Gaming). `catalog`/`defaults`
  // nomment les variables globales exposées par le fichier *-sources.js
  // correspondant (partagé avec rss-feed.js).
  france:   { label: 'France',       icon: '🇫🇷',  requiresGoogle: false, newsSourcesField: { catalog: 'FRANCE_NEWS_SOURCES', defaults: 'FRANCE_DEFAULT_SOURCES' } },
  tech:     { label: 'Tech',         icon: '💻',   requiresGoogle: false, newsSourcesField: { catalog: 'TECH_NEWS_SOURCES', defaults: 'TECH_DEFAULT_SOURCES' } },
  bourse:   { label: 'Bourse',       icon: '📊',   requiresGoogle: false, newsSourcesField: { catalog: 'BOURSE_NEWS_SOURCES', defaults: 'BOURSE_DEFAULT_SOURCES' } },
  calendar: { label: 'Agenda',       icon: '📅',   requiresGoogle: true  },
  // Renommé "ETF / Bourse" → "Actions / ETF" (2026-09-01, sur demande
  // explicite) — libellé affiché uniquement (en-tête de la section de config
  // + libellé de ligne dans l'onglet Finance de Paramètres) ; la clé interne
  // `etf` reste inchangée.
  etf:      { label: 'Actions / ETF', icon: '📈',   requiresGoogle: false,
              linesField: { idKey: 'isin', idLabel: 'ISIN', idPlaceholder: 'FR0011882364', title: 'Lignes du portefeuille (ISIN)', hasType: true } },
  gmail:    { label: 'Gmail',        icon: '📬',   requiresGoogle: true  },
  ol:       { label: 'Sports',       icon: '🏆',   requiresGoogle: false,
              configField: { key: 'team', label: 'Équipe', placeholder: 'Olympique Lyonnais' } },
  // FDJ scindé en 3 modules dashboard indépendants (2026-08-04) — regroupés
  // ici sous une même section "FDJ" (voir FDJ_KEYS/createFdjGroup) plutôt que
  // dispersés dans la liste triable générique, sur demande explicite : ils
  // doivent tous se gérer au même endroit dans Paramètres.
  fdjLoto:         { label: 'Loto',         icon: '🎰', requiresGoogle: false, fdjGameKey: 'loto' },
  fdjEuromillions: { label: 'EuroMillions', icon: '⭐', requiresGoogle: false, fdjGameKey: 'euromillions' },
  fdjEurodreams:   { label: 'EuroDreams',   icon: '🌟', requiresGoogle: false, fdjGameKey: 'eurodreams' },
  maps:     { label: 'Maps',         icon: '🗺️',   requiresGoogle: false },
  crypto:   { label: 'Crypto',       icon: '₿',    requiresGoogle: false,
              linesField: { idKey: 'symbol', idLabel: 'Crypto', idPlaceholder: 'BTC', title: 'Lignes du portefeuille (crypto)', datalist: 'crypto-symbols-datalist' } },
  spotify:  { label: 'Spotify',      icon: '🎵',   requiresGoogle: false },
  // 6 modules ajoutés en autonomie (2026-08-05, voir CONTEXT.md)
  // Champ "Ville" ajouté le 2026-09-01 (sur demande explicite, même
  // `configField` générique que Météo ci-dessus) — vide = réutilise la ville
  // de Météo (voir air-quality.js, aqGetCity), comportement d'origine
  // conservé pour toute config existante qui ne touche jamais ce champ.
  airQuality: { label: 'Qualité air', icon: '🌡️', requiresGoogle: false,
                hintText: 'Laissez ce champ vide pour utiliser la même ville que le module Météo.',
                configField: { key: 'city', label: 'Ville', placeholder: '' } },
  // `fuelTypesField` (2026-09-01, sur demande explicite) — cases à cocher
  // "quels carburants afficher", voir renderFuelTypesConfigSection plus bas
  // et modules/fuel-types.js (catalogue partagé avec fuel-prices.js).
  fuelPrices: { label: 'Carburants',  icon: '⛽', requiresGoogle: false,
                configField: { key: 'city', label: 'Ville / CP', placeholder: 'Lyon ou 69001' },
                fuelTypesField: true },
  priceTracking: { label: 'Suivi de prix', icon: '🛒', requiresGoogle: false, priceTrackingField: true },
  cinema:     { label: 'Cinéma',      icon: '🎬', requiresGoogle: false }, // pas de config : scraping AlloCiné, aucune clé requise
  steamPromos:{ label: 'Promos Steam', icon: '🏷️', requiresGoogle: false }, // pas de config
  epicPromos: { label: 'Promos Epic Games', icon: '🎁', requiresGoogle: false }, // pas de config
  hue:        { label: 'Philips Hue', icon: '💡', requiresGoogle: false, hueField: true },
  kasa:       { label: 'TP-Link Kasa', icon: '🔌', requiresGoogle: false, kasaField: true },
  tradfri:    { label: 'IKEA Trådfri', icon: '💡', requiresGoogle: false, tradfriField: true },
  reminders:  { label: 'Rappels',     icon: '⏰', requiresGoogle: false, remindersField: true },
  // 4 modules ajoutés le 2026-08-06 (sur demande explicite)
  currency:    { label: 'Change',        icon: '💱', requiresGoogle: false }, // pas de config : devises/montant en état local du module (comme Maps)
  googleTasks: { label: 'Tâches Google', icon: '✅', requiresGoogle: true  }, // pas de config : nécessite juste le compte Google déjà connecté (scope tasks)
  science:     { label: 'Sciences',      icon: '🔬', requiresGoogle: false }, // pas de config : 3 sources fixes (voir rss-feed.js)
  // newsSourcesField (2026-09-01, sur demande explicite) — Gaming passe de
  // sources FIXES à cochables, voir renderer/modules/gaming-sources.js.
  gaming:      { label: 'Gaming',        icon: '🎮', requiresGoogle: false, newsSourcesField: { catalog: 'GAMING_NEWS_SOURCES', defaults: 'GAMING_DEFAULT_SOURCES' } },
  // 3 modules ajoutés le 2026-08-07 (sur demande explicite)
  sante:     { label: 'Santé',         icon: '⚕️', requiresGoogle: false }, // pas de config : 2 sources fixes (voir rss-feed.js — Pourquoi Docteur retiré, flux mort)
  // Pas de champ de config interactif : nécessite le compte Google déjà
  // connecté (scope People API contacts.readonly). `hintText` (2026-09-01,
  // sur demande explicite) affiche un simple rappel texte de la provenance
  // des données + comment ajouter un anniversaire, voir meta.hintText
  // plus bas (rendu commun, potentiellement réutilisable par d'autres
  // modules dans le même cas).
  birthdays: { label: 'Anniversaires', icon: '🎂', requiresGoogle: true, hintText: 'Les anniversaires affichés proviennent de vos contacts Google. Pour ajouter un anniversaire, rendez-vous sur contacts.google.com → modifier un contact → ajouter une date d\'anniversaire.' },
  indices:   { label: 'Indices',       icon: '📉', requiresGoogle: false, indicesField: true },
  // 2 modules ajoutés le 2026-08-08 (sur demande explicite)
  podcast: { label: 'Podcasts', icon: '🎙️', requiresGoogle: false, podcastField: true },
  // Plus de `configField` (2026-08-24, sur demande explicite) — utilisait la
  // clé publique DEMO_KEY de NASA en dur désormais (voir nasa.js), aucune clé
  // à saisir : fonctionne dès l'installation, rien à configurer ici.
  nasa:    { label: 'Photo du jour NASA', icon: '🌍', requiresGoogle: false },
  // Alertes (2026-08-08, sur demande explicite) — PAS un module carte comme
  // les autres (voir dashboard.js) : reste dans MODULE_META/TAB_MODULE_ORDER
  // pour son toggle global + sa config (département, types), mais son
  // affichage est un bandeau plein écran géré à part, jamais via
  // createModuleCard/MODULE_REGISTRY.
  alerts: { label: 'Alertes', icon: '🚨', requiresGoogle: false, alertsField: true },
  // Prêts immobiliers (2026-08-08, sur demande explicite) — instances
  // multiples comme Sports (voir isPretsKey plus haut) : `configField`
  // réutilisé tel quel pour le nom du groupe (même mécanisme que le nom
  // d'équipe Sport), `pretsLoansField` déclenche la section imbriquée listant
  // les prêts DE CE groupe (jusqu'à 5, voir renderPretsLoansSection).
  prets: { label: 'Prêts',   icon: '🏠', requiresGoogle: false,
           configField: { key: 'name', label: 'Nom du groupe', placeholder: 'Résidence principale' },
           pretsLoansField: true },
  // LIVE FOOT! (2026-08-11, sur demande explicite) — voir renderer/modules/
  // live.js. `liveField` déclenche renderLiveConfigSection (club +
  // championnat + mode), même mécanisme que `alertsField` pour
  // département/types. Renommé "LIVE!" → "LIVE FOOT!" le 2026-09-01 (2e
  // demande explicite, libellé affiché uniquement — la clé interne `live`
  // reste inchangée, voir dashboard.js MODULE_REGISTRY.live).
  live: { label: 'LIVE FOOT!', icon: '🔴', requiresGoogle: false, liveField: true },
  // Mon Équipe (2026-08-15, sur demande explicite) — suivi manuel (aucune
  // source externe interrogée, contrairement à Sports/LIVE!) : nom d'équipe +
  // sport, calendrier à venir et résultats passés saisis à la main.
  // `monEquipeField` déclenche renderMonEquipeConfigSection, même mécanisme
  // que `alertsField`/`liveField` pour une section de config imbriquée.
  monEquipe: { label: 'Mon Équipe', icon: '🎽', requiresGoogle: false, monEquipeField: true },
  // YouTube Notifications (2026-08-15, sur demande explicite) — voir
  // renderer/modules/youtube.js. `requiresGoogle: false` ICI car le module
  // lui-même (badge/miniature) ne lit que le flux RSS public de chaque
  // chaîne (aucune auth) ; SEULE la résolution d'une nouvelle chaîne dans
  // `renderYoutubeConfigSection` ci-dessous nécessite un token Google
  // (appel direct à l'API YouTube Data v3), vérifié au moment du clic plutôt
  // que via ce flag générique (qui gate le rendu du module sur le dashboard,
  // pas Paramètres).
  youtube: { label: 'YouTube', icon: '🔔', requiresGoogle: false, youtubeField: true },
};

let modulesState = {};

// Démarrage automatique Windows (2026-08-30, sur demande explicite) — pas un
// module (pas de `enabled`/`config` dans modulesState), juste un réglage
// système. Chargé une fois dans initConfig AVANT le 1er renderTabPanels
// (voir plus bas, createStartOnBootRow) pour que le switch reflète l'état
// réel dès l'ouverture de Paramètres, pas seulement après un 1er rendu à vide.
let startOnBootEnabled = false;

// ─── Onglets (2026-08-06, sur demande explicite) ───────────────────────────
// Réorganisation complète de Paramètres : Profil reste hors onglets (voir
// config.html), tous les autres modules sont répartis dans 6 onglets fixes
// par thème. "Prêts" (Finance) demandé mais laissé de côté sur décision de
// l'utilisateur : aucun module de suivi de prêts n'existe, à spécifier plus
// tard avant de lui donner une entrée ici. Agenda/Gmail/Spotify/Tâches
// Google n'étaient dans AUCUN des 6 onglets tels que listés par
// l'utilisateur (ils dépendent d'un compte Google/Spotify plutôt que d'un
// thème) — répartis par thème sur décision explicite de l'utilisateur
// (pas de 7e onglet "Comptes") : Agenda/Gmail/Tâches Google → Utile,
// Spotify → Loisirs.
const TAB_DEFS = [
  { id: 'finance',    icon: '📊', label: 'Finance' },
  { id: 'actualites', icon: '📰', label: 'Actualités' },
  { id: 'sports',     icon: '🏆', label: 'Sports' },
  { id: 'loisirs',    icon: '🎯', label: 'Loisirs' },
  { id: 'maison',     icon: '🏠', label: 'Maison' },
  { id: 'services',   icon: '📦', label: 'Services' },
  { id: 'utile',      icon: '⏰', label: 'Utile' },
];
const DEFAULT_TAB_ORDER = TAB_DEFS.map(t => t.id);

// Ordre EXACT voulu à l'intérieur de chaque onglet. 'ol' et 'fdj' sont des
// entrées spéciales (pas des clés MODULE_META directes) : 'ol' déploie
// TOUTES les instances Sports actuellement configurées (ol, ol_2..ol_5),
// 'fdj' déploie le groupe visuel des 3 sous-modules FDJ (voir createFdjGroup)
// — même logique que l'ancienne liste triable générique, juste répartie par
// onglet au lieu d'un seul flux.
// BUG CORRIGÉ LE 2026-08-08 — 'indices' (ajouté le 2026-08-07) n'avait jamais
// été ajouté ici : un module absent de TOUS les tableaux TAB_MODULE_ORDER
// n'est simplement jamais rendu par renderTabPanels (aucune erreur, juste
// invisible), même s'il a bien une entrée MODULE_META. En creusant, 'sante'
// et 'birthdays' (ajoutés le même jour) avaient la même lacune — corrigées
// aussi, même cause, même correctif.
const TAB_MODULE_ORDER = {
  finance:    ['etf', 'crypto', 'currency', 'indices', 'prets'],
  actualites: ['france', 'tech', 'bourse', 'science', 'gaming', 'sante'],
  // Sports (2026-09-01, sur demande explicite) : 'ol'/'live'/'monEquipe'
  // sortis de Loisirs, qui ne garde que les modules de détente pure.
  sports:     ['ol', 'live', 'monEquipe'],
  loisirs:    ['fdj', 'cinema', 'steamPromos', 'epicPromos', 'spotify', 'podcast', 'youtube'],
  maison:     ['hue', 'kasa', 'tradfri'],
  // Maps → Utile (2026-09-01, sur demande explicite) — retiré de Services.
  // Gmail/Agenda → Services (2026-09-01, 2e demande explicite le même jour)
  // — retirés d'Utile, qui garde Rappels/Météo/Qualité de l'air/Tâches
  // Google/Anniversaires/Alertes/Maps.
  services:   ['fuelPrices', 'priceTracking', 'nasa', 'calendar', 'gmail'],
  utile:      ['reminders', 'weather', 'airQuality', 'googleTasks', 'birthdays', 'alerts', 'maps'],
};

let tabOrder = DEFAULT_TAB_ORDER.slice();
let activeTabId = tabOrder[0];
let tabDragSrc = null;

// ─── Sections repliables réutilisables (2026-08-16, sur demande explicite) ──
// Appliqué à 4 sections de Paramètres pouvant contenir beaucoup de lignes
// (YouTube jusqu'à 18 chaînes, ETF/Crypto jusqu'à N lignes de portefeuille,
// Prêts jusqu'à 5 prêts par groupe) : REPLIÉES PAR DÉFAUT, un en-tête
// cliquable affiche un compte dynamique + une flèche ▶ qui pivote à 90°
// (▶ → visuellement ▼) en 300ms. Même mécanique CSS que
// .prets-group-body/.fdj-grids-section déjà utilisée ailleurs dans l'app
// (grid-template-rows 0fr→1fr + transition, voir style.css) — PAS un
// display:none, qui ne peut pas s'animer. `storeKey` doit être unique par
// section (voir chaque appelant) pour que l'état replié/déplié de chacune
// des 4 sections soit sauvegardé et restauré INDÉPENDAMMENT des 3 autres,
// via le chemin étroit `window.matin.store` (jamais `modules.update`, qui
// recharge toute la fenêtre à chaque clic sur une flèche).
function wrapCollapsibleSection(contentEl, { storeKey, labelFor, compact }) {
  const wrap = document.createElement('div');
  // `compact` (2026-09-01, sur demande explicite) — soude visuellement le
  // header "X ... configuré(e)s ▶" au bloc titre+toggle du module juste
  // au-dessus (voir .config-collapsible--compact dans style.css), au lieu de
  // flotter en dessous avec un espace vide. Utilisé par les 4 appelants
  // ci-dessous (ETF/Crypto/Prêts/YouTube — ce dernier ajouté le même jour,
  // 2e révision, "no separate border, no floating element").
  wrap.className = 'config-collapsible' + (compact ? ' config-collapsible--compact' : '');
  wrap.innerHTML = `
    <div class="config-collapsible-header">
      <span class="config-collapsible-label"></span>
      <span class="config-collapsible-arrow">▶</span>
    </div>
    <div class="config-collapsible-body">
      <div class="config-collapsible-body-inner"></div>
    </div>
  `;

  const header = wrap.querySelector('.config-collapsible-header');
  const labelEl = wrap.querySelector('.config-collapsible-label');
  const body = wrap.querySelector('.config-collapsible-body');
  wrap.querySelector('.config-collapsible-body-inner').appendChild(contentEl);

  function refreshLabel() {
    labelEl.textContent = labelFor();
  }

  function setExpanded(expanded) {
    header.classList.toggle('expanded', expanded);
    body.classList.toggle('expanded', expanded);
  }

  header.addEventListener('click', () => {
    const expanded = !header.classList.contains('expanded');
    setExpanded(expanded);
    window.matin.store.set(storeKey, expanded)
      .catch(err => console.error('[Config] Échec sauvegarde état repli', storeKey, err));
  });

  refreshLabel();
  // Repliée par défaut tant que l'état sauvegardé n'est pas encore connu
  // (évite un flash "dépliée" pendant l'aller-retour IPC ci-dessous).
  setExpanded(false);
  window.matin.store.get(storeKey).then((saved) => {
    if (saved === true) setExpanded(true);
  }).catch(() => {});

  return { wrap, refreshLabel };
}

// ─── Groupe FDJ (Loto/EuroMillions/EuroDreams) ─────────────────────────────
// 3 modules dashboard indépendants, mais toujours affichés ENSEMBLE ici (pas
// dispersés, ni draggables individuellement) — voir createFdjGroup.
const FDJ_KEYS = ['fdjLoto', 'fdjEuromillions', 'fdjEurodreams'];

// ─── Instances multiples (module Sports) ──────────────────────────────────────
// La 1re instance garde la clé historique "ol" ; jusqu'à 4 instances
// supplémentaires ("ol_2".."ol_5") peuvent être ajoutées via le bouton
// "+ Ajouter une équipe", chacune avec sa propre config.team.
const MAX_SPORTS_INSTANCES = 5;

function isSportsKey(key) {
  return key === 'ol' || /^ol_[2-5]$/.test(key);
}

function addSportsInstance() {
  const count = Object.keys(modulesState).filter(isSportsKey).length;
  if (count >= MAX_SPORTS_INSTANCES) return;

  let n = 2;
  while (modulesState[`ol_${n}`]) n++;

  const positions = Object.values(modulesState).map(m => m.position);
  const nextPosition = positions.length ? Math.max(...positions) + 1 : 0;

  modulesState[`ol_${n}`] = { enabled: true, position: nextPosition, config: { team: '' } };
  renderTabPanels();
}

function removeSportsInstance(key) {
  delete modulesState[key];
  renderTabPanels();
}

// ─── Instances multiples (module Prêts) ─────────────────────────────────────
// Même principe exact que Sports ci-dessus : "prets" garde la clé de base,
// jusqu'à 4 groupes supplémentaires ("prets_2".."prets_5") via "+ Ajouter un
// groupe" — un groupe = une instance = une carte dashboard (voir
// dashboard.js, isPretsKey/resolveModuleMeta).
const MAX_PRETS_INSTANCES = 5;
const MAX_LOANS_PER_GROUP = 5;
const MAX_PALIERS_PER_LOAN = 5;

function isPretsKey(key) {
  return key === 'prets' || /^prets_[2-5]$/.test(key);
}

function addPretsInstance() {
  const count = Object.keys(modulesState).filter(isPretsKey).length;
  if (count >= MAX_PRETS_INSTANCES) return;

  let n = 2;
  while (modulesState[`prets_${n}`]) n++;

  const positions = Object.values(modulesState).map(m => m.position);
  const nextPosition = positions.length ? Math.max(...positions) + 1 : 0;

  modulesState[`prets_${n}`] = { enabled: true, position: nextPosition, config: { name: '', loans: [] } };
  renderTabPanels();
}

function removePretsInstance(key) {
  delete modulesState[key];
  renderTabPanels();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function initConfig() {
  modulesState = await window.matin.modules.getAll();
  // Lu AVANT le 1er renderTabPanels (voir createStartOnBootRow) pour que le
  // switch reflète l'état réel dès l'ouverture de Paramètres.
  startOnBootEnabled = (await window.matin.store.get('app.startOnBoot')) === true;

  // Ordre des onglets persisté indépendamment de modulesState (pas un
  // module, pas soumis au bouton "Enregistrer" — sauvegarde immédiate au
  // glisser-déposer, voir reorderTabs). Validé avant usage : un store
  // corrompu/partiel (ex. ancienne version, onglet renommé) retombe sur
  // l'ordre par défaut plutôt que de planter le rendu de la barre.
  const savedOrder = await window.matin.store.get('app.configTabOrder');
  if (Array.isArray(savedOrder)
      && savedOrder.length === DEFAULT_TAB_ORDER.length
      && DEFAULT_TAB_ORDER.every(id => savedOrder.includes(id))) {
    tabOrder = savedOrder;
  }
  activeTabId = tabOrder[0];

  renderTabBar();
  renderTabPanels();
  setActiveTab(activeTabId);

  initThemeToggle();
  await initProfileSection();
  await initProfileTabs();
  await initGoogleSection();
  await initSpotifySection();
  await initBackupsSection();
  // 2026-08-30 — voir bouton "Ouvrir Sauvegardes" du bandeau "⚠️ Données
  // manquantes" (dashboard.js) : ouvre directement la popup Sauvegardes
  // plutôt que de laisser l'utilisateur la retrouver lui-même.
  if (new URLSearchParams(location.search).get('openBackups') === '1') {
    document.getElementById('btnBackups')?.click();
  }
  await initPersonnaliserSection();
  loadCryptoDatalist(); // en tâche de fond — les suggestions apparaissent dès que prêtes

  // Bouton fermer custom retiré le 2026-08-06 (sur demande explicite, faisait
  // doublon avec le bouton natif Windows en haut à droite, voir titleBarOverlay
  // dans main.js/createConfigWindow) — plus de listener à attacher ici.
  document.getElementById('btnSave').addEventListener('click', saveConfig);
}

// ─── Thème clair/sombre (2026-08-08, sur demande explicite) ────────────────
// État initial lu depuis `window.matin.initialTheme` (déjà résolu de façon
// synchrone par preload.js — voir le <script> de bootstrap en tête de
// config.html) plutôt qu'un nouvel aller-retour IPC async : évite un flash
// de l'état du switch au chargement de Paramètres.
function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;

  toggle.checked = window.matin.initialTheme === 'light';

  toggle.addEventListener('change', async (e) => {
    const theme = e.target.checked ? 'light' : 'dark';
    // Applique localement TOUT DE SUITE (pas d'attente de l'aller-retour
    // IPC) — cette fenêtre change donc instantanément ; le dashboard suit
    // via theme:updated (voir main.js, IPC app:setTheme) dès que la
    // sauvegarde a fini côté process main.
    document.documentElement.dataset.colorScheme = theme;
    await window.matin.theme.set(theme);
  });

  // Si le thème change depuis une AUTRE source pendant que cette fenêtre est
  // ouverte (aucune connue actuellement — seul ce switch en écrit — mais
  // garde le switch cohérent avec l'état réel plutôt que de supposer qu'il
  // est toujours seul à écrire app.theme).
  window.matin.theme.onUpdated((theme) => {
    document.documentElement.dataset.colorScheme = theme;
    toggle.checked = theme === 'light';
    // Les options de fond visibles dépendent du thème (voir
    // PERSONNALISER_OPTIONS/renderPersonnaliserOptions) — sans ça, la popup
    // Personnaliser resterait sur l'ancien jeu d'options sombres/claires si
    // elle est ouverte pendant que le thème bascule (depuis CETTE fenêtre ou
    // une autre, ce listener réagit aux deux).
    if (document.getElementById('personnaliserModalOverlay')?.classList.contains('open')) {
      renderPersonnaliserOptions();
    }
  });
}

// ─── Profil (prénom affiché dans la barre de titre) ────────────────────────────
async function initProfileSection() {
  const input = document.getElementById('firstNameInput');
  const current = await window.matin.store.get('app.firstName');
  input.value = current || '';
}

// ─── Profils — onglets compacts (2026-08-31, sur demande explicite) ────────
// Row 2 du redesign "Paramètres" : cliquer sur le CORPS d'un onglet bascule
// de profil (main.js profiles:switch — recharge le DASHBOARD, pas cette
// fenêtre Paramètres, qui se contente de re-lire/re-render ses onglets une
// fois la réponse reçue) ; ✏️ (renommer + activation automatique) et 💾
// (sauvegarder l'état actuel dans ce profil) utilisent `stopPropagation`
// pour ne jamais déclencher une bascule par erreur en cliquant dessus.
const PROFILE_KEYS = ['profile1', 'profile2'];
const AUTO_SWITCH_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
let profilesCache = null;
let editingProfileKey = null;

function profileDisplayName(profile, fallbackKey) {
  return profile?.name?.trim() || (fallbackKey === 'profile1' ? 'Profil 1' : 'Profil 2');
}

async function initProfileTabs() {
  const tabsEl = document.getElementById('profileTabs');
  if (!tabsEl) return;

  await refreshProfileTabs();

  tabsEl.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.profile-tab-edit');
    const saveBtn = e.target.closest('.profile-tab-save');
    const tab = e.target.closest('.profile-tab');
    if (!tab) return;
    const key = tab.dataset.profile;

    if (editBtn) { e.stopPropagation(); openProfileEditPanel(key); return; }
    if (saveBtn) { e.stopPropagation(); requestSaveProfile(key); return; }
    if (key === profilesCache?.active) return; // déjà actif, rien à faire

    tab.style.opacity = '0.6';
    try {
      await window.matin.profiles.switch(key);
      await refreshProfileTabs();
      // Le dashboard se recharge tout seul (voir main.js profiles:switch →
      // 'modules:updated'), mais CETTE fenêtre (Paramètres) ne se recharge
      // pas — sans ça, les interrupteurs de modules affichés dans les
      // onglets Finance/Actualités/etc. resteraient sur l'ancien profil
      // jusqu'à la prochaine ouverture (même raison que saveConfig plus bas
      // pour le thème/mode auto).
      modulesState = await window.matin.modules.getAll();
      renderTabPanels();
      setActiveTab(activeTabId);
    } catch (err) {
      console.error('[Config] Échec changement de profil', err);
      tab.style.opacity = '';
    }
  });

  initProfileEditPanel();
  initProfileSaveConfirm();
}

async function refreshProfileTabs() {
  const tabsEl = document.getElementById('profileTabs');
  if (!tabsEl) return;
  try {
    profilesCache = await window.matin.profiles.getAll();
  } catch (err) {
    console.error('[Config] Échec lecture des profils', err);
    return;
  }
  tabsEl.innerHTML = PROFILE_KEYS.map((key) => {
    const profile = profilesCache[key];
    const active = profilesCache.active === key;
    return `
      <button type="button" class="profile-tab ${active ? 'active' : ''}" data-profile="${key}">
        <span class="profile-tab-dot"></span>
        <span class="profile-tab-name">👤 ${profileDisplayName(profile, key)}</span>
        <span class="profile-tab-edit" title="Renommer / activation automatique">✏️</span>
        <span class="profile-tab-save" title="Sauvegarder l'état actuel dans ce profil">💾</span>
      </button>`;
  }).join('');
}

// Confirmation d'écrasement — capture enabled/layout de TOUS les modules +
// le thème actuel dans ce profil (voir main.js saveProfileSnapshot), SANS
// toucher aux dispositions Réorganiser ni à l'activation automatique déjà
// sauvegardées (chacune a sa propre action dédiée : Réorganiser →
// Sauvegarder disposition N ; activation automatique → panneau ✏️
// ci-dessous).
//
// Popup dédiée (2026-08-31, 2e révision, sur demande explicite, remplace le
// `confirm()` natif simple d'origine) — texte du rappel "cliquer
// Enregistrer d'abord" EXACT demandé, posé une fois pour toutes dans
// config.html (jamais recalculé ici, contrairement à la question
// d'écrasement elle-même qui, elle, dépend du profil cliqué).
let pendingProfileSaveKey = null;

function requestSaveProfile(key) {
  const profile = profilesCache?.[key];
  const name = profileDisplayName(profile, key);
  pendingProfileSaveKey = key;
  const text = document.getElementById('profileSaveConfirmText');
  if (text) text.textContent = `Voulez-vous écraser le profil « ${name} » avec la configuration actuelle ?`;
  document.getElementById('profileSaveConfirmOverlay')?.classList.add('open');
}

function closeProfileSaveConfirm() {
  pendingProfileSaveKey = null;
  document.getElementById('profileSaveConfirmOverlay')?.classList.remove('open');
}

function initProfileSaveConfirm() {
  const overlay = document.getElementById('profileSaveConfirmOverlay');
  document.getElementById('profileSaveConfirmCancel')?.addEventListener('click', closeProfileSaveConfirm);
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeProfileSaveConfirm(); });
  document.getElementById('profileSaveConfirmOk')?.addEventListener('click', async () => {
    const key = pendingProfileSaveKey;
    closeProfileSaveConfirm();
    if (!key) return;
    const profile = profilesCache?.[key];
    const name = profileDisplayName(profile, key);
    try {
      await window.matin.profiles.save(key, name);
      await refreshProfileTabs();
    } catch (err) {
      console.error('[Config] Échec sauvegarde du profil', err);
    }
  });
}

// Panneau d'édition (renommer + activation automatique par jour) — ouvert
// par le ✏️ d'un onglet, scopé au profil retenu dans `editingProfileKey`.
// Jours représentés par des boutons à bascule (.profile-day-btn.active),
// pas des cases à cocher — mêmes 2 préréglages que l'exemple donné dans la
// demande (Lun-Ven / Sam-Dim), plus la possibilité de cocher des jours
// individuels pour un cas non couvert par ces 2 préréglages.
function openProfileEditPanel(key) {
  editingProfileKey = key;
  const panel = document.getElementById('profileEditPanel');
  const nameInput = document.getElementById('profileEditNameInput');
  const autoToggle = document.getElementById('profileAutoSwitchToggle');
  const profile = profilesCache?.[key];

  nameInput.value = profileDisplayName(profile, key);
  autoToggle.checked = profile?.autoSwitch?.enabled === true;
  setActiveDays(Array.isArray(profile?.autoSwitch?.days) ? profile.autoSwitch.days : []);

  panel.classList.add('open');
  nameInput.focus();
}

function closeProfileEditPanel() {
  editingProfileKey = null;
  document.getElementById('profileEditPanel')?.classList.remove('open');
}

function setActiveDays(days) {
  document.querySelectorAll('#profileDaysRow .profile-day-btn').forEach((btn) => {
    btn.classList.toggle('active', days.includes(btn.dataset.day));
  });
}

function initProfileEditPanel() {
  document.querySelectorAll('#profileDaysRow .profile-day-btn').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });
  document.getElementById('profileDaysWeekdays')?.addEventListener('click', () => setActiveDays(['mon', 'tue', 'wed', 'thu', 'fri']));
  document.getElementById('profileDaysWeekend')?.addEventListener('click', () => setActiveDays(['sat', 'sun']));
  document.getElementById('profileEditCancel')?.addEventListener('click', closeProfileEditPanel);
  document.getElementById('profileEditSave')?.addEventListener('click', async () => {
    if (!editingProfileKey) return;
    const key = editingProfileKey;
    const name = document.getElementById('profileEditNameInput').value.trim();
    const enabled = document.getElementById('profileAutoSwitchToggle').checked;
    const days = Array.from(document.querySelectorAll('#profileDaysRow .profile-day-btn.active')).map(b => b.dataset.day)
      .filter(d => AUTO_SWITCH_DAY_KEYS.includes(d));

    try {
      await window.matin.profiles.rename(key, name);
      await window.matin.profiles.setAutoSwitch(key, enabled, days);
      await refreshProfileTabs();
      closeProfileEditPanel();
    } catch (err) {
      console.error('[Config] Échec sauvegarde du profil (nom/activation automatique)', err);
    }
  });
}

// Autocomplétion du champ "Crypto" à partir du top 100 CoinGecko par capitalisation.
// Endpoint public avec en-têtes CORS ouverts — fetch direct, pas besoin du proxy
// main process utilisé pour Yahoo Finance/Boursorama.
async function loadCryptoDatalist() {
  const datalist = document.getElementById('crypto-symbols-datalist');
  if (!datalist) return;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&order=market_cap_desc&per_page=100&page=1&sparkline=false');
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    datalist.innerHTML = data.map(c => `<option value="${c.symbol.toUpperCase()}" label="${c.name}"></option>`).join('');
  } catch (err) {
    console.warn('[Config] Liste des cryptos indisponible (autocomplétion désactivée)', err);
  }
}

// ─── Barre d'onglets (rendu + réordonnancement par glisser-déposer) ────────
function renderTabBar() {
  const bar = document.getElementById('configTabbar');
  bar.innerHTML = '';

  tabOrder.forEach((tabId) => {
    const tab = TAB_DEFS.find(t => t.id === tabId);
    if (!tab) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'config-tab' + (tabId === activeTabId ? ' active' : '');
    btn.draggable = true;
    btn.dataset.tabId = tabId;
    btn.innerHTML = `<span class="config-tab-icon">${tab.icon}</span><span>${tab.label}</span>`;

    btn.addEventListener('click', () => setActiveTab(tabId));

    // Glisser-déposer — même pattern que l'ancienne liste de modules
    // (dragSrcKey/swapPositions, retiré) mais appliqué aux onglets.
    btn.addEventListener('dragstart', (e) => {
      tabDragSrc = tabId;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { btn.style.opacity = '0.4'; }, 0);
    });
    btn.addEventListener('dragend', () => {
      btn.style.opacity = '';
      bar.querySelectorAll('.config-tab').forEach(b => b.classList.remove('drag-over'));
    });
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      bar.querySelectorAll('.config-tab').forEach(b => b.classList.remove('drag-over'));
      btn.classList.add('drag-over');
    });
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!tabDragSrc || tabDragSrc === tabId) return;
      reorderTabs(tabDragSrc, tabId);
    });

    bar.appendChild(btn);
  });
}

// Insère l'onglet déplacé juste à la position de l'onglet cible — sauvegarde
// immédiate dans electron-store (pas besoin de cliquer "Enregistrer", même
// convention que la disposition libre du dashboard, modules:updateLayout).
function reorderTabs(srcId, targetId) {
  const srcIdx = tabOrder.indexOf(srcId);
  const targetIdx = tabOrder.indexOf(targetId);
  if (srcIdx === -1 || targetIdx === -1) return;

  tabOrder.splice(srcIdx, 1);
  tabOrder.splice(targetIdx, 0, srcId);
  renderTabBar();

  window.matin.store.set('app.configTabOrder', tabOrder)
    .catch(err => console.error('[Config] Échec sauvegarde ordre des onglets', err));
}

function setActiveTab(tabId) {
  activeTabId = tabId;
  document.querySelectorAll('.config-tabpanel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tab === tabId);
  });
  document.querySelectorAll('.config-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tabId === tabId);
  });
}

// ─── Contenu des onglets ────────────────────────────────────────────────────
// 'ol' déploie toutes les instances Sports actuellement configurées (pas
// seulement la 1ère) — même équipes multiples que l'ancienne liste triable
// générique, juste toutes regroupées dans l'onglet Loisirs. 'fdj' déploie le
// groupe visuel des 3 sous-modules (voir createFdjGroup, inchangé).
function renderTabPanels() {
  TAB_DEFS.forEach((tab) => {
    const panel = document.querySelector(`.config-tabpanel[data-tab="${tab.id}"]`);
    if (!panel) return;
    panel.innerHTML = '';

    // Démarrage automatique Windows (2026-08-30) — pas une entrée
    // TAB_MODULE_ORDER (pas un module) : reconstruit en tête de l'onglet
    // Utile à chaque renderTabPanels, exactement comme le reste de cet
    // onglet (jamais wipé séparément puisque rien ne le préserve entre 2
    // appels).
    if (tab.id === 'utile') {
      panel.appendChild(createStartOnBootRow());
    }

    (TAB_MODULE_ORDER[tab.id] || []).forEach((entry) => {
      if (entry === 'fdj') {
        const fdjKeys = FDJ_KEYS.filter(k => modulesState[k]);
        if (fdjKeys.length) panel.appendChild(createFdjGroup(fdjKeys));
        return;
      }
      if (entry === 'ol') {
        Object.keys(modulesState)
          .filter(isSportsKey)
          .sort((a, b) => (modulesState[a].position ?? 0) - (modulesState[b].position ?? 0))
          .forEach((key) => {
            const meta = MODULE_META[key] ?? MODULE_META.ol;
            panel.appendChild(createModuleRow(key, modulesState[key], meta));
          });
        return;
      }
      if (entry === 'prets') {
        Object.keys(modulesState)
          .filter(isPretsKey)
          .sort((a, b) => (modulesState[a].position ?? 0) - (modulesState[b].position ?? 0))
          .forEach((key) => {
            const meta = MODULE_META[key] ?? MODULE_META.prets;
            panel.appendChild(createModuleRow(key, modulesState[key], meta));
          });
        return;
      }
      const mod = modulesState[entry];
      const meta = MODULE_META[entry];
      if (!mod || !meta) return;
      panel.appendChild(createModuleRow(entry, mod, meta));
    });
  });
}

// ─── Démarrage automatique Windows (2026-08-30, sur demande explicite) ─────
// Réutilise les classes `.module-row-wrap`/`.module-row`/`.toggle` déjà
// stylées pour les modules (aucune CSS nouvelle nécessaire) mais N'EST PAS
// un module : pas de clé `modulesState`, pas de `enabled`/`config`, pas de
// carte dashboard. Appliqué immédiatement au clic (voir main.js
// app:setStartOnBoot), même principe que le bascule thème (initThemeToggle)
// plutôt que différé au bouton Enregistrer — un réglage système doit
// refléter l'état réel de l'inscription registre tout de suite.
function createStartOnBootRow() {
  const wrapper = document.createElement('div');
  wrapper.className = 'module-row-wrap';

  const row = document.createElement('div');
  row.className = 'module-row';
  row.innerHTML = `
    <span class="module-row-icon">🚀</span>
    <span class="module-row-name">Lancer Matin au démarrage de Windows</span>
    <label class="toggle">
      <input type="checkbox" id="startOnBootToggle" ${startOnBootEnabled ? 'checked' : ''}>
      <span class="toggle-slider"></span>
    </label>
  `;
  row.querySelector('#startOnBootToggle').addEventListener('change', (e) => {
    startOnBootEnabled = e.target.checked;
    window.matin.app.setStartOnBoot(startOnBootEnabled);
  });

  wrapper.appendChild(row);
  return wrapper;
}

// ℹ (U+2139) + sélecteur de présentation TEXTE (U+FE0E, PAS U+FE0F/émoji) —
// 2026-08-31, 2e demande le même jour ("changer sa couleur en bleu") : la
// variante émoji (celle qu'un simple "ℹ️" tapé au clavier produit) est un
// glyphe couleur FIXE sur la plupart des systèmes, qui ignore `color` en
// CSS — seule la variante texte hérite réellement de `currentColor`/`color`
// (voir .price-tracking-info-btn dans config.html).
const PRICE_TRACKING_INFO_ICON = 'ℹ︎';

// ─── Popup "Sites compatibles" — module Suivi de prix (2026-08-31, sur
// demande explicite) ─────────────────────────────────────────────────────
// Petit popover ancré sous l'icône ℹ️ (pas une modale plein écran comme
// Sauvegardes/Personnaliser — texte trop court pour ça, demandé explicitement
// "small popup/tooltip") — `position: fixed` + coordonnées calculées depuis
// `getBoundingClientRect()` plutôt qu'un positionnement CSS relatif au
// parent : la ligne de module vit dans un panneau d'onglet qui défile
// (`overflow`), un popover positionné relativement à son parent pourrait s'y
// retrouver coupé selon le défilement en cours.
function showPriceTrackingInfoPopup(anchorEl) {
  document.getElementById('priceTrackingInfoPopup')?.remove(); // jamais 2 popups ouverts à la fois

  const popup = document.createElement('div');
  popup.id = 'priceTrackingInfoPopup';
  popup.className = 'price-tracking-info-popup';
  popup.innerHTML = `
    <div class="price-tracking-info-title">Sites compatibles testés :</div>
    <div class="price-tracking-info-sites">
      <span>✅ Darty</span><span>✅ Fnac</span><span>✅ LDLC</span>
      <span>✅ Vinted</span><span>✅ Boulanger</span><span>✅ Zalando</span>
      <span>✅ Jules</span><span>✅ Cultura</span>
      <span class="price-tracking-info-incompatible">❌ Amazon (non compatible)</span>
      <span class="price-tracking-info-incompatible">❌ Instant Gaming (non compatible)</span>
      <span class="price-tracking-info-incompatible">❌ G2A (non compatible)</span>
    </div>
    <div class="price-tracking-info-warning">⚠️ Peut fonctionner avec d'autres sites marchands.</div>
  `;
  document.body.appendChild(popup);

  const rect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popupRect.width - 8))}px`;

  // `setTimeout(0)` : sans lui, le clic qui vient d'ouvrir ce popup (déjà en
  // cours de propagation sur `document`) déclencherait immédiatement sa
  // propre fermeture — l'écouteur n'est posé qu'APRÈS que ce clic-ci soit
  // terminé. Capture (3e argument `true`) pour intercepter le clic avant
  // qu'un autre gestionnaire ne l'arrête via stopPropagation.
  const closeOnOutsideClick = (e) => {
    if (popup.contains(e.target)) return;
    popup.remove();
    document.removeEventListener('click', closeOnOutsideClick, true);
  };
  setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);
}

function createModuleRow(key, mod, meta) {
  const wrapper = document.createElement('div');
  wrapper.className = 'module-row-wrap' + (mod.enabled ? '' : ' module-disabled');

  const row = document.createElement('div');
  row.className = 'module-row';
  row.dataset.key = key;

  // Boutons +/× d'instance — généralisés à Sports ET Prêts (2026-08-08),
  // même principe pour les deux : le bouton "+" ne vit que sur la clé de
  // base ('ol'/'prets'), le "×" sur les instances ajoutées uniquement.
  const showAddInstance = key === 'ol' || key === 'prets';
  const showDelete = (isSportsKey(key) && key !== 'ol') || (isPretsKey(key) && key !== 'prets');
  const sportsMaxed = Object.keys(modulesState).filter(isSportsKey).length >= MAX_SPORTS_INSTANCES;
  const pretsMaxed = Object.keys(modulesState).filter(isPretsKey).length >= MAX_PRETS_INSTANCES;
  const maxedOut = key === 'prets' ? pretsMaxed : sportsMaxed;
  const addTitle = key === 'prets'
    ? (pretsMaxed ? 'Maximum de 5 groupes atteint' : 'Ajouter un groupe')
    : (sportsMaxed ? 'Maximum de 5 équipes atteint' : 'Ajouter une équipe');
  const deleteTitle = isPretsKey(key) ? 'Supprimer ce groupe' : 'Supprimer cette équipe';

  row.innerHTML = `
    <span class="module-row-icon">${meta.icon}</span>
    <span class="module-row-name">${meta.label}${key === 'tradfri' ? ' <span class="beta-badge">Bêta</span>' : ''}${key === 'priceTracking' ? ` <button type="button" class="price-tracking-info-btn" title="Sites compatibles">${PRICE_TRACKING_INFO_ICON}</button>` : ''}</span>
    ${showAddInstance ? `<button class="row-add-btn" ${maxedOut ? 'disabled' : ''} title="${addTitle}">+</button>` : ''}
    ${showDelete ? `<button class="row-delete-btn" title="${deleteTitle}">×</button>` : ''}
    ${meta.requiresGoogle ? '<span class="module-row-requires">Google requis</span>' : ''}
    <label class="toggle">
      <input type="checkbox" ${mod.enabled ? 'checked' : ''} data-key="${key}">
      <span class="toggle-slider"></span>
    </label>
  `;

  // Popup "Sites compatibles" (2026-08-31, sur demande explicite) — voir
  // showPriceTrackingInfoPopup plus bas, seul module à porter ce bouton.
  row.querySelector('.price-tracking-info-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showPriceTrackingInfoPopup(e.currentTarget);
  });

  // Toggle — bascule aussi .module-disabled sur le wrapper : la config
  // ci-dessous (etf-lines-field/parcels-config-field/fdj-config-field/...)
  // n'est visible que module activé (2026-08-06, sur demande explicite, voir
  // règle CSS .module-row-wrap.module-disabled dans config.html).
  row.querySelector('input').addEventListener('change', (e) => {
    modulesState[key].enabled = e.target.checked;
    wrapper.classList.toggle('module-disabled', !e.target.checked);
  });

  // Ajouter une instance (bouton inline sur la ligne principale — équipe
  // Sport ou groupe de prêts selon la clé)
  row.querySelector('.row-add-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (key === 'prets') addPretsInstance();
    else addSportsInstance();
  });

  // Supprimer cette instance (instances ajoutées uniquement, jamais l'originale)
  row.querySelector('.row-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPretsKey(key)) removePretsInstance(key);
    else removeSportsInstance(key);
  });

  wrapper.appendChild(row);

  // Simple rappel texte, sans champ interactif (2026-09-01, sur demande
  // explicite pour Anniversaires — voir MODULE_META.birthdays) — rendu
  // générique pour tout module qui en aurait besoin, pas de logique propre
  // à un module précis.
  if (meta.hintText) {
    const hintWrap = document.createElement('div');
    hintWrap.className = 'module-config-field module-config-hint-field';
    hintWrap.innerHTML = `<p class="module-config-hint-text">${meta.hintText}</p>`;
    wrapper.appendChild(hintWrap);
  }

  let teamFieldInput = null;
  let sportSelectInput = null;
  // Badge "Bêta" (à côté du sélecteur) + note Basketball (sous le champ) —
  // 2026-09-01, sur demande explicite : réassignée plus bas (voir
  // meta.configField), appelée aussi depuis le listener `change` du
  // sélecteur un peu plus loin dans cette même fonction (2 blocs `if`
  // séparés mais même portée de fonction).
  let updateSportExtras = () => {};

  if (meta.configField) {
    const field = meta.configField;
    const currentValue = mod.config?.[field.key] ?? field.placeholder ?? '';

    // Sélecteur manuel de sport (2026-09-01, sur demande explicite, "Fix the
    // Sports module team detection") — À CÔTÉ du champ Équipe, réservé à
    // Sports (isSportsKey) : Prêts/Carburants réutilisent aussi
    // meta.configField pour un champ texte simple (nom de groupe/ville), qui
    // n'a rien à voir avec une détection de sport. Voir sports-sources.js
    // MANUAL_SPORT_OPTIONS pour la liste des options et sa justification.
    const sportSelectHtml = isSportsKey(key) ? `
      <select class="sports-manual-select" title="Forcer le sport si la détection automatique se trompe">
        ${window.SportsSources.MANUAL_SPORT_OPTIONS.map(opt =>
          `<option value="${opt.value}" ${((mod.config?.sport || '') === opt.value) ? 'selected' : ''}>${opt.label}</option>`
        ).join('')}
      </select>
      <span class="sports-sport-beta-badge"></span>` : '';

    const fieldWrap = document.createElement('div');
    fieldWrap.className = 'module-config-field';
    fieldWrap.innerHTML = `
      <label>${field.label}</label>
      <input type="text" placeholder="${field.placeholder}" value="${currentValue}">
      ${sportSelectHtml}
    `;
    teamFieldInput = fieldWrap.querySelector('input');
    teamFieldInput.addEventListener('input', (e) => {
      if (!modulesState[key].config) modulesState[key].config = {};
      modulesState[key].config[field.key] = e.target.value;
    });
    sportSelectInput = fieldWrap.querySelector('.sports-manual-select');
    const sportBetaBadge = fieldWrap.querySelector('.sports-sport-beta-badge');

    wrapper.appendChild(fieldWrap);

    // Note Basketball + badge "Bêta" (2026-09-01, sur demande explicite) —
    // bloc SÉPARÉ (comme le rappel Anniversaires, voir meta.hintText plus
    // haut) plutôt que casé dans la même ligne flex que le champ Équipe/le
    // sélecteur : c'est le seul moyen d'obtenir une VRAIE 2e ligne sous le
    // champ (`.module-config-field` ci-dessus est une rangée flex qui ne
    // wrap pas), réutilise `.module-config-hint-text` telle quelle (muet,
    // 11px, italique, exactement le style déjà demandé pour Anniversaires).
    // Le badge Bêta, lui, reste DANS la rangée du sélecteur (juste à côté,
    // comme demandé) — un <option> de <select> ne peut afficher que du texte
    // brut (voir sports-sources.js/MANUAL_SPORT_OPTIONS), ce badge est donc
    // le seul endroit où "Bêta" peut être réellement stylé (italique/muet/
    // 10px, voir .sports-sport-beta-badge, config.html) plutôt que du texte
    // plat comme dans le menu déroulant lui-même.
    let basketHintWrap = null;
    if (isSportsKey(key)) {
      basketHintWrap = document.createElement('div');
      basketHintWrap.className = 'module-config-field module-config-hint-field sports-basket-hint';
      basketHintWrap.innerHTML = `<p class="module-config-hint-text">ℹ️ Si votre équipe est aussi connue comme club de football, ajoutez 'Basket' au nom pour éviter toute confusion. Ex: 'Monaco Basket' au lieu de 'Monaco'</p>`;
      wrapper.appendChild(basketHintWrap);
    }

    updateSportExtras = () => {
      if (!sportSelectInput) return;
      const val = sportSelectInput.value;
      if (sportBetaBadge) sportBetaBadge.textContent = (val === 'basketball' || val === 'rugby') ? 'β Bêta' : '';
      if (basketHintWrap) basketHintWrap.style.display = val === 'basketball' ? 'flex' : 'none';
    };
    updateSportExtras();
  }

  // Prêts DE CE groupe (jusqu'à 5) — indépendant du champ nom ci-dessus,
  // contrairement aux sources Sport qui dépendent de teamFieldInput.
  if (meta.pretsLoansField) {
    wrapper.appendChild(renderPretsLoansSection(key, mod));
  }

  // Sources d'actualités Sports : détection auto du sport (TheSportsDB) à
  // partir du nom d'équipe, puis liste blanche de sources RSS pré-cochées
  // (voir modules/sports-sources.js, partagé avec le module dashboard pour
  // garantir qu'une source cochée ici correspond exactement à ce qui est
  // effectivement récupéré côté carte).
  if (isSportsKey(key) && teamFieldInput) {
    const sourcesWrap = document.createElement('div');
    sourcesWrap.className = 'module-config-field sports-sources-field';
    sourcesWrap.innerHTML = `
      <label>Sources</label>
      <div class="sports-sources-status">—</div>
      <div class="sports-sources-list"></div>
    `;
    const statusEl = sourcesWrap.querySelector('.sports-sources-status');
    const listEl = sourcesWrap.querySelector('.sports-sources-list');
    wrapper.appendChild(sourcesWrap);

    let detectToken = 0;

    async function refreshSources(team) {
      const myToken = ++detectToken;
      const trimmed = (team || '').trim();
      // Sport choisi manuellement (2026-09-01, sur demande explicite) —
      // '' (option "🔍 Détection automatique") redevient `undefined`, comme
      // une config jamais touchée : laisse detectSportSources décider seul.
      const manualSport = sportSelectInput?.value || undefined;

      if (!trimmed) {
        statusEl.textContent = 'Saisissez un nom d\'équipe pour détecter les sources.';
        listEl.innerHTML = '';
        return;
      }

      statusEl.textContent = manualSport ? 'Application du sport choisi manuellement…' : 'Détection du sport…';
      listEl.innerHTML = '';

      try {
        const detection = await window.SportsSources.detectSportSources(trimmed, manualSport);
        if (myToken !== detectToken) return; // l'équipe a changé entre-temps : résultat périmé

        if (!detection.list.length) {
          if (manualSport) {
            statusEl.textContent = `Sport : ${detection.sportLabel} — aucune source dédiée pour ce sport, seul le site officiel du club sera utilisé s'il est trouvé.`;
          } else if (detection.autoRejected) {
            // Cas connus (2026-09-01, "Fix specific known cases" — Racing/
            // Stade/sigles courts) : la détection a été délibérément écartée
            // plutôt qu'appliquée à tort — le message doit orienter
            // explicitement vers le sélecteur manuel ci-dessus, pas laisser
            // croire à un simple manque de données.
            statusEl.textContent = '⚠ Détection automatique peu fiable pour ce nom (cas connu) — sélectionnez le sport manuellement ci-dessus.';
          } else {
            statusEl.textContent = detection.sportLabel
              ? `Sport détecté : ${detection.sportLabel} — aucune source disponible.`
              : 'Sport non reconnu — sélectionnez-le manuellement ci-dessus si besoin.';
          }
          modulesState[key].config.sources = [];
          return;
        }

        statusEl.textContent = manualSport ? `Sport : ${detection.sportLabel}` : `Sport détecté : ${detection.sportLabel}`;

        const previouslyEnabled = modulesState[key].config.sources;
        const enabled = new Set(previouslyEnabled ?? detection.list.map(s => s.url));

        listEl.innerHTML = detection.list.map(s => `
          <label class="sports-source-item">
            <input type="checkbox" class="sports-source-checkbox" value="${s.url}" ${enabled.has(s.url) ? 'checked' : ''}>
            <span>${s.label}${s.isRss === false ? ' <span class="sports-source-note">(lien direct)</span>' : ''}</span>
          </label>
        `).join('');

        const syncChecked = () => {
          modulesState[key].config.sources = Array.from(
            listEl.querySelectorAll('.sports-source-checkbox:checked')
          ).map(el => el.value);
        };
        listEl.querySelectorAll('.sports-source-checkbox').forEach(cb => {
          cb.addEventListener('change', syncChecked);
        });
        syncChecked(); // fige l'état pré-coché même si l'utilisateur ne touche à rien
      } catch (err) {
        if (myToken !== detectToken) return;
        statusEl.textContent = 'Détection indisponible — équipe introuvable ou hors ligne.';
        console.warn('[Config] Détection du sport échouée', err);
      }
    }

    let debounceTimer;
    teamFieldInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refreshSources(e.target.value), 600);
    });

    // Sélecteur manuel de sport (2026-09-01, sur demande explicite, points
    // 2/3 — "the manual dropdown takes priority" / "apply... immediately") —
    // pas de debounce ici (contrairement au champ texte ci-dessus) : un choix
    // dans une liste déroulante est un événement ponctuel et délibéré, pas
    // une frappe en cours. `sources` est réinitialisé à `undefined` (état
    // "jamais configuré") plutôt que laissé tel quel : les URLs cochées pour
    // l'ANCIEN sport n'ont aucune raison de correspondre au catalogue du
    // NOUVEAU, refreshSources retombe alors sur la présélection par défaut
    // de la nouvelle liste (voir `enabled = new Set(previouslyEnabled ??
    // detection.list.map(...))` plus haut).
    sportSelectInput?.addEventListener('change', (e) => {
      if (!modulesState[key].config) modulesState[key].config = {};
      modulesState[key].config.sport = e.target.value;
      delete modulesState[key].config.sources;
      clearTimeout(debounceTimer);
      updateSportExtras();
      refreshSources(teamFieldInput.value);
    });

    refreshSources(teamFieldInput.value);
  }

  // Sources d'actualités cochables — France/Tech/Bourse/Gaming (2026-09-01,
  // sur demande explicite ; CONSOLIDÉ le même jour après duplication
  // France→Tech en 2 blocs identiques, Bourse/Gaming auraient fait une 3e
  // et 4e copie) — catalogue STATIQUE par module (contrairement à Sports
  // ci-dessus, pas de détection automatique), voir renderer/modules/
  // *-sources.js (partagés avec rss-feed.js) référencés par
  // meta.newsSourcesField.{catalog,defaults} (noms de variables globales).
  // `.sports-sources-*`/`.sports-source-*` réutilisées telles quelles, même
  // besoin visuel qu'une liste de cases à cocher de sources.
  if (meta.newsSourcesField) {
    const { catalog, defaults } = meta.newsSourcesField;
    if (!modulesState[key].config) modulesState[key].config = {};
    const enabled = new Set(
      Array.isArray(modulesState[key].config.sources) && modulesState[key].config.sources.length
        ? modulesState[key].config.sources
        : (window[defaults] || [])
    );
    modulesState[key].config.sources = Array.from(enabled); // fige l'état par défaut dès l'ouverture, même sans y toucher

    const sourcesWrap = document.createElement('div');
    sourcesWrap.className = 'module-config-field sports-sources-field';
    sourcesWrap.innerHTML = `
      <label>Sources</label>
      <div class="sports-sources-status">Au moins une source doit rester cochée.</div>
      <div class="sports-sources-list">
        ${(window[catalog] || []).map(s => `
          <label class="sports-source-item">
            <input type="checkbox" class="sports-source-checkbox" value="${s.url}" ${enabled.has(s.url) ? 'checked' : ''}>
            <span>${s.label}</span>
          </label>
        `).join('')}
      </div>
    `;

    // Au moins 1 source cochée en permanence (point commun à toutes ces
    // demandes) — décocher la DERNIÈRE case restante la re-coche
    // immédiatement plutôt que d'afficher une erreur bloquante : la config
    // ne peut structurellement jamais finir vide.
    const checkboxes = sourcesWrap.querySelectorAll('.sports-source-checkbox');
    checkboxes.forEach((cb) => {
      cb.addEventListener('change', () => {
        const checked = Array.from(checkboxes).filter((c) => c.checked);
        if (!checked.length) {
          cb.checked = true;
          return;
        }
        modulesState[key].config.sources = checked.map((c) => c.value);
      });
    });

    wrapper.appendChild(sourcesWrap);
  }

  if (meta.linesField) {
    const lf = meta.linesField;
    if (!modulesState[key].config) modulesState[key].config = {};
    if (!modulesState[key].config.lines) modulesState[key].config.lines = [];
    const lines = modulesState[key].config.lines;

    const linesWrap = document.createElement('div');
    // Modificateur `etf-lines-field--${key}` (2026-09-01, sur demande
    // explicite) — ETF et Crypto partagent la même classe de base
    // etf-lines-field (voir en-tête du fichier) : seul ce modificateur permet
    // de leur donner chacun leur propre teinte (or/violet, voir style.css)
    // sans dupliquer toute la règle CSS commune.
    linesWrap.className = `module-config-field etf-lines-field etf-lines-field--${key}`;
    linesWrap.innerHTML = `
      <div class="etf-lines-header ${lf.hasType ? 'has-type' : ''}">
        ${lf.hasType ? '<span>Type</span>' : ''}<span>${lf.idLabel}</span><span>Date</span><span>Qté</span><span>Prix €</span><span>Frais €</span><span></span>
      </div>
      <div class="etf-lines-list"></div>
      <button type="button" class="etf-add-line-btn">+ Ajouter une ligne</button>
    `;

    const listEl = linesWrap.querySelector('.etf-lines-list');
    // Assignée après le 1er renderLines() (voir wrapCollapsibleSection plus
    // bas) — `renderLines` n'y accède que via `collapsible?.` (jamais avant
    // qu'un événement utilisateur, ex. suppression d'une ligne, ne le
    // déclenche, donc toujours défini à ce moment-là).
    let collapsible;

    function renderLines() {
      listEl.innerHTML = '';
      lines.forEach((line) => {
        const lineRow = document.createElement('div');
        lineRow.className = `etf-line-row${lf.hasType ? ' has-type' : ''}`;
        const isSell = line.type === 'sell';
        lineRow.innerHTML = `
          ${lf.hasType ? `
          <select class="etf-line-type">
            <option value="buy" ${!isSell ? 'selected' : ''}>Achat</option>
            <option value="sell" ${isSell ? 'selected' : ''}>Vente</option>
          </select>` : ''}
          <input type="text" class="etf-line-id" placeholder="${lf.idPlaceholder}" value="${line[lf.idKey] || ''}" ${lf.datalist ? `list="${lf.datalist}"` : ''}>
          <input type="date" class="etf-line-date" value="${line.date || ''}">
          <input type="number" min="0" step="0.0001" placeholder="Qté" class="etf-line-qty" value="${line.qty ?? ''}">
          <input type="number" min="0" step="0.01" placeholder="Prix" class="etf-line-price" value="${line.price ?? ''}">
          <input type="number" min="0" step="0.01" placeholder="Frais €" class="etf-line-fees" value="${line.fees ?? ''}">
          <button type="button" class="row-delete-btn etf-line-delete" title="Supprimer cette ligne">×</button>
        `;

        const sync = () => {
          line[lf.idKey] = lineRow.querySelector('.etf-line-id').value.trim().toUpperCase();
          line.date = lineRow.querySelector('.etf-line-date').value;
          line.qty = parseFloat(lineRow.querySelector('.etf-line-qty').value) || 0;
          line.price = parseFloat(lineRow.querySelector('.etf-line-price').value) || 0;
          line.fees = parseFloat(lineRow.querySelector('.etf-line-fees').value) || 0;
          if (lf.hasType) line.type = lineRow.querySelector('.etf-line-type').value;
        };
        lineRow.querySelectorAll('input').forEach(inp => inp.addEventListener('input', sync));
        const typeSelect = lineRow.querySelector('.etf-line-type');
        if (typeSelect) typeSelect.addEventListener('change', sync);

        lineRow.querySelector('.etf-line-delete').addEventListener('click', () => {
          const idx = lines.indexOf(line);
          if (idx !== -1) lines.splice(idx, 1);
          renderLines();
        });

        listEl.appendChild(lineRow);
      });
      collapsible?.refreshLabel();
    }

    linesWrap.querySelector('.etf-add-line-btn').addEventListener('click', () => {
      const newLine = { [lf.idKey]: '', date: '', qty: 0, price: 0, fees: 0 };
      if (lf.hasType) newLine.type = 'buy';
      lines.push(newLine);
      renderLines();
    });

    renderLines();

    // Repliable (2026-08-16, sur demande explicite) — voir
    // wrapCollapsibleSection. `storeKey` inclut `key` (etf/crypto) : les 2
    // sections gardent un état replié/déplié INDÉPENDANT l'une de l'autre.
    collapsible = wrapCollapsibleSection(linesWrap, {
      storeKey: `app.configCollapsed.${key}.lines`,
      labelFor: () => `${lines.length} ligne${lines.length !== 1 ? 's' : ''} configurée${lines.length !== 1 ? 's' : ''}`,
      compact: true,
    });
    wrapper.appendChild(collapsible.wrap);
  }

  if (meta.priceTrackingField) {
    wrapper.appendChild(renderPriceTrackingConfigSection(modulesState[key]));
  }

  if (meta.fuelTypesField) {
    wrapper.appendChild(renderFuelTypesConfigSection(modulesState[key]));
  }

  if (meta.hueField) {
    wrapper.appendChild(renderHueConfigSection(modulesState[key]));
  }

  if (meta.kasaField) {
    wrapper.appendChild(renderKasaConfigSection(modulesState[key]));
  }

  if (meta.tradfriField) {
    wrapper.appendChild(renderTradfriConfigSection(modulesState[key]));
  }

  if (meta.remindersField) {
    wrapper.appendChild(renderRemindersConfigSection(modulesState[key]));
  }

  if (meta.indicesField) {
    wrapper.appendChild(renderIndicesConfigSection(modulesState[key]));
  }

  if (meta.podcastField) {
    wrapper.appendChild(renderPodcastConfigSection(modulesState[key]));
  }

  if (meta.alertsField) {
    wrapper.appendChild(renderAlertsConfigSection(modulesState[key]));
  }

  if (meta.liveField) {
    wrapper.appendChild(renderLiveConfigSection(modulesState[key]));
  }

  if (meta.monEquipeField) {
    wrapper.appendChild(renderMonEquipeConfigSection(modulesState[key]));
  }

  if (meta.youtubeField) {
    wrapper.appendChild(renderYoutubeConfigSection(modulesState[key]));
  }

  return wrapper;
}

// ─── LIVE! (club + championnat + mode) ──────────────────────────────────────
// Réécrit le 2026-08-11 (sur demande explicite, remplace la version 1
// multi-sports du même jour, recentrée sur le football club/championnat) —
// `window.LiveChampionships` (live-championships.js, chargé avant ce
// fichier) fournit les options du <select>, partagé avec live.js pour
// résoudre le bon endpoint ESPN/repli.
function renderLiveConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (typeof mod.config.club !== 'string') mod.config.club = '';
  if (typeof mod.config.championship !== 'string') mod.config.championship = 'ligue1';
  if (mod.config.mode !== 'club' && mod.config.mode !== 'league') mod.config.mode = 'club';

  const champions = window.LiveChampionships || [];
  const wrap = document.createElement('div');
  wrap.className = 'module-config-field live-config-field';
  wrap.innerHTML = `
    <div class="live-config-row">
      <label>Mon club</label>
      <input type="text" class="live-club-input" placeholder="Ex : Olympique Lyonnais" value="${mod.config.club}">
    </div>
    <div class="live-config-row">
      <label>Mon championnat</label>
      <select class="live-championship-select">
        ${champions.map(c => `<option value="${c.key}" ${c.key === mod.config.championship ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
    </div>
    <div class="indices-toggle-row">
      <span class="indices-toggle-label">Tout le championnat (au lieu de mon club uniquement)</span>
      <label class="toggle">
        <input type="checkbox" class="live-mode-toggle" ${mod.config.mode === 'league' ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
  `;

  wrap.querySelector('.live-club-input').addEventListener('input', (e) => {
    mod.config.club = e.target.value;
  });
  wrap.querySelector('.live-championship-select').addEventListener('change', (e) => {
    mod.config.championship = e.target.value;
  });
  wrap.querySelector('.live-mode-toggle').addEventListener('change', (e) => {
    mod.config.mode = e.target.checked ? 'league' : 'club';
  });

  return wrap;
}

// ─── Mon Équipe (nom + sport + calendrier/résultats saisis à la main) ──────
// (2026-08-15, sur demande explicite) — contrairement à Sports/LIVE!, AUCUNE
// source externe n'est interrogée ici : pensé pour un club sans couverture
// TheSportsDB/RSS (ex. club amateur/régional). `venue` stocké comme
// 'home'/'away' (affiché "D"/"E", voir monEquipeVenueOptionsHtml) plutôt
// qu'un booléen brut — plus lisible dans le store en cas d'inspection manuelle.
const MON_EQUIPE_MAX_MATCHES = 20;
const MON_EQUIPE_SPORTS = [
  { value: 'football', label: 'Football' },
  { value: 'basketball', label: 'Basket' },
  { value: 'rugby', label: 'Rugby' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'autre', label: 'Autre' },
];

function monEquipeSportOptionsHtml(selected) {
  const current = selected || 'football';
  return MON_EQUIPE_SPORTS.map(s => `<option value="${s.value}" ${s.value === current ? 'selected' : ''}>${s.label}</option>`).join('');
}

function monEquipeVenueOptionsHtml(selected) {
  const isHome = selected !== 'away';
  return `
    <option value="home" ${isHome ? 'selected' : ''}>D</option>
    <option value="away" ${!isHome ? 'selected' : ''}>E</option>
  `;
}

// Compétition passée d'un champ texte libre à une liste fermée (2026-08-16,
// sur demande explicite). Une valeur déjà saisie AVANT ce changement (texte
// libre) qui ne correspond à aucune de ces 5 options est ajoutée en tête de
// liste plutôt que silencieusement perdue au premier rendu — le module vient
// tout juste d'être créé (aucune donnée réelle attendue), mais le principe
// (ne jamais faire disparaître une valeur déjà saisie) suit la même
// prudence que normalizeFdjGrid plus bas dans ce fichier.
const MON_EQUIPE_COMPETITIONS = ['Championnat', 'Coupe nationale', "Coupe d'Europe", 'Tournoi', 'Match amical'];

function monEquipeCompetitionOptionsHtml(selected) {
  const current = selected || MON_EQUIPE_COMPETITIONS[0];
  const options = (!current || MON_EQUIPE_COMPETITIONS.includes(current))
    ? MON_EQUIPE_COMPETITIONS
    : [current, ...MON_EQUIPE_COMPETITIONS];
  return options.map(c => `<option value="${c}" ${c === current ? 'selected' : ''}>${c}</option>`).join('');
}

function renderMonEquipeConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (typeof mod.config.teamName !== 'string') mod.config.teamName = '';
  if (typeof mod.config.sport !== 'string') mod.config.sport = 'football';
  if (!Array.isArray(mod.config.upcoming)) mod.config.upcoming = [];
  if (!Array.isArray(mod.config.results)) mod.config.results = [];
  const cfg = mod.config;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field monequipe-config-field';
  wrap.innerHTML = `
    <div class="monequipe-row-split">
      <div class="monequipe-field-name">
        <label>Nom de l'équipe</label>
        <input type="text" class="monequipe-name-input" placeholder="Ex : USAM Francheleins Basket" value="${cfg.teamName}">
      </div>
      <div class="monequipe-field-sport">
        <label>Sport</label>
        <select class="monequipe-sport-select">${monEquipeSportOptionsHtml(cfg.sport)}</select>
      </div>
    </div>
    <p class="monequipe-roadmap-note">Synchronisation automatique avec les fédérations — roadmap V2</p>

    <label class="monequipe-list-label">Matchs à venir (max ${MON_EQUIPE_MAX_MATCHES})</label>
    <div class="monequipe-upcoming-header">
      <span>Date</span><span>Heure</span><span>Adversaire</span><span>Domicile / Extérieur</span><span>Compétition</span><span></span>
    </div>
    <div class="monequipe-upcoming-list"></div>
    <button type="button" class="etf-add-line-btn monequipe-add-upcoming-btn">+ Ajouter un match</button>

    <label class="monequipe-list-label monequipe-list-label--results">Derniers résultats (max ${MON_EQUIPE_MAX_MATCHES})</label>
    <div class="monequipe-results-header">
      <span>Date</span><span>Adversaire</span><span>Score</span><span>Domicile / Extérieur</span><span>Type de match</span><span></span>
    </div>
    <div class="monequipe-results-list"></div>
    <button type="button" class="etf-add-line-btn monequipe-add-result-btn">+ Ajouter un résultat</button>
  `;

  wrap.querySelector('.monequipe-name-input').addEventListener('input', (e) => { cfg.teamName = e.target.value; });
  wrap.querySelector('.monequipe-sport-select').addEventListener('change', (e) => { cfg.sport = e.target.value; });

  const upcomingList = wrap.querySelector('.monequipe-upcoming-list');
  const addUpcomingBtn = wrap.querySelector('.monequipe-add-upcoming-btn');
  const resultsList = wrap.querySelector('.monequipe-results-list');
  const addResultBtn = wrap.querySelector('.monequipe-add-result-btn');

  function renderUpcoming() {
    upcomingList.innerHTML = '';
    cfg.upcoming.forEach((item) => {
      const group = document.createElement('div');
      group.className = 'monequipe-upcoming-group';

      const row = document.createElement('div');
      row.className = 'monequipe-upcoming-row';
      row.innerHTML = `
        <input type="date" class="monequipe-date-input" value="${item.date || ''}">
        <input type="time" class="monequipe-time-input" value="${item.time || ''}">
        <input type="text" class="monequipe-opponent-input" placeholder="Adversaire" value="${item.opponent || ''}">
        <select class="monequipe-venue-select">${monEquipeVenueOptionsHtml(item.venue)}</select>
        <select class="monequipe-competition-select">${monEquipeCompetitionOptionsHtml(item.competition)}</select>
        <button type="button" class="row-delete-btn monequipe-delete-btn" title="Supprimer ce match">×</button>
      `;
      row.querySelector('.monequipe-date-input').addEventListener('input', (e) => { item.date = e.target.value; });
      row.querySelector('.monequipe-time-input').addEventListener('input', (e) => { item.time = e.target.value; });
      row.querySelector('.monequipe-opponent-input').addEventListener('input', (e) => { item.opponent = e.target.value; });
      row.querySelector('.monequipe-venue-select').addEventListener('change', (e) => { item.venue = e.target.value; });
      row.querySelector('.monequipe-competition-select').addEventListener('change', (e) => { item.competition = e.target.value; });
      row.querySelector('.monequipe-delete-btn').addEventListener('click', () => {
        const idx = cfg.upcoming.indexOf(item);
        if (idx !== -1) cfg.upcoming.splice(idx, 1);
        renderUpcoming();
        syncAddButtons();
      });
      group.appendChild(row);

      // Score du match (2026-08-31, sur demande explicite) — renseigné une
      // fois le match joué : déplace AUTOMATIQUEMENT ce match vers "Derniers
      // résultats". Au `change` (donc au blur, pas à chaque frappe) : un
      // déplacement en cours de saisie serait déroutant, l'utilisateur doit
      // pouvoir taper "78-6" sans perdre la ligne avant d'avoir fini
      // "78-65". Ce champ n'écrit JAMAIS dans `item.score` (les matchs à
      // venir n'ont pas ce champ) : il sert uniquement de déclencheur du
      // transfert vers `cfg.results`, où `score` est le champ normal —
      // volontairement SANS respecter MON_EQUIPE_MAX_MATCHES ici (un vrai
      // résultat de match joué ne doit jamais être silencieusement perdu
      // parce que la liste des résultats est pleine ; le plafond ne gate que
      // le bouton "+ Ajouter un résultat" manuel).
      const scoreRow = document.createElement('div');
      scoreRow.className = 'monequipe-upcoming-score-row';
      scoreRow.innerHTML = `
        <label>Score</label>
        <input type="text" class="monequipe-upcoming-score-input" placeholder="Si déjà joué, ex : 78-65">
        <span class="monequipe-upcoming-score-hint">→ déplace vers "Derniers résultats"</span>
      `;
      scoreRow.querySelector('.monequipe-upcoming-score-input').addEventListener('change', (e) => {
        const score = e.target.value.trim();
        if (!score) return;
        const idx = cfg.upcoming.indexOf(item);
        if (idx !== -1) cfg.upcoming.splice(idx, 1);
        // `competition` reporté tel quel (2026-09-01, sur demande explicite —
        // "Type de match" ajouté aux Derniers résultats) : le match à venir
        // avait déjà son type saisi, pas de raison de le redemander/le
        // réinitialiser à la 1re option lors du transfert automatique.
        cfg.results.push({ date: item.date, opponent: item.opponent, score, venue: item.venue, competition: item.competition });
        renderUpcoming();
        renderResults();
        syncAddButtons();
      });
      group.appendChild(scoreRow);

      upcomingList.appendChild(group);
    });
  }

  function renderResults() {
    resultsList.innerHTML = '';
    cfg.results.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'monequipe-results-row';
      row.innerHTML = `
        <input type="date" class="monequipe-date-input" value="${item.date || ''}">
        <input type="text" class="monequipe-opponent-input" placeholder="Adversaire" value="${item.opponent || ''}">
        <input type="text" class="monequipe-score-input" placeholder="Ex : 78-65" value="${item.score || ''}">
        <select class="monequipe-venue-select">${monEquipeVenueOptionsHtml(item.venue)}</select>
        <select class="monequipe-competition-select">${monEquipeCompetitionOptionsHtml(item.competition)}</select>
        <button type="button" class="row-delete-btn monequipe-delete-btn" title="Supprimer ce résultat">×</button>
      `;
      row.querySelector('.monequipe-date-input').addEventListener('input', (e) => { item.date = e.target.value; });
      row.querySelector('.monequipe-opponent-input').addEventListener('input', (e) => { item.opponent = e.target.value; });
      row.querySelector('.monequipe-score-input').addEventListener('input', (e) => { item.score = e.target.value; });
      row.querySelector('.monequipe-venue-select').addEventListener('change', (e) => { item.venue = e.target.value; });
      row.querySelector('.monequipe-competition-select').addEventListener('change', (e) => { item.competition = e.target.value; });
      row.querySelector('.monequipe-delete-btn').addEventListener('click', () => {
        const idx = cfg.results.indexOf(item);
        if (idx !== -1) cfg.results.splice(idx, 1);
        renderResults();
        syncAddButtons();
      });
      resultsList.appendChild(row);
    });
  }

  function syncAddButtons() {
    const upcomingMaxed = cfg.upcoming.length >= MON_EQUIPE_MAX_MATCHES;
    addUpcomingBtn.disabled = upcomingMaxed;
    addUpcomingBtn.title = upcomingMaxed ? `Maximum de ${MON_EQUIPE_MAX_MATCHES} matchs atteint` : '';
    const resultsMaxed = cfg.results.length >= MON_EQUIPE_MAX_MATCHES;
    addResultBtn.disabled = resultsMaxed;
    addResultBtn.title = resultsMaxed ? `Maximum de ${MON_EQUIPE_MAX_MATCHES} résultats atteint` : '';
  }

  addUpcomingBtn.addEventListener('click', () => {
    if (cfg.upcoming.length >= MON_EQUIPE_MAX_MATCHES) return;
    // `competition` initialisé à la 1re option (pas '') : le <select> rendu
    // affichera de toute façon "Championnat" présélectionné (voir
    // monEquipeCompetitionOptionsHtml) — autant que la donnée en mémoire soit
    // cohérente avec ce qui est affiché dès la création de la ligne, sans
    // attendre un premier `change` de l'utilisateur pour se synchroniser.
    cfg.upcoming.push({ date: '', time: '', opponent: '', venue: 'home', competition: MON_EQUIPE_COMPETITIONS[0] });
    renderUpcoming();
    syncAddButtons();
  });
  addResultBtn.addEventListener('click', () => {
    if (cfg.results.length >= MON_EQUIPE_MAX_MATCHES) return;
    // `competition` initialisé à la 1re option (2026-09-01, sur demande
    // explicite — "Type de match" ajouté aux Derniers résultats), même
    // principe que addUpcomingBtn ci-dessus.
    cfg.results.push({ date: '', opponent: '', score: '', venue: 'home', competition: MON_EQUIPE_COMPETITIONS[0] });
    renderResults();
    syncAddButtons();
  });

  renderUpcoming();
  renderResults();
  syncAddButtons();

  return wrap;
}

// ─── FDJ (grilles + codes, 3 jeux) ─────────────────────────────────────────
// Structure spécifique (pas un simple linesField) : chaque jeu a un nombre de
// numéros/spéciaux et des bornes différentes (voir modules/fdj-games.js,
// partagé avec le module dashboard pour garantir un calcul de rang cohérent
// avec ce qui est réellement saisi ici).
// Remet en forme une grille éventuellement issue d'un état de store plus
// ancien (mauvais nombre de cases, tableaux absents) — sans ça, une seule
// grille malformée fait planter le rendu de TOUTE la section FDJ (grilles +
// codes) puisque tout est construit dans la même passe synchrone, donnant
// l'impression que les sections suivantes (dont "Mes codes") ont disparu
// alors qu'elles n'ont simplement jamais été atteintes.
function normalizeFdjGrid(game, grid) {
  const numbers = Array.isArray(grid?.numbers) ? grid.numbers.slice(0, game.numberCount) : [];
  while (numbers.length < game.numberCount) numbers.push(null);
  const special = Array.isArray(grid?.special) ? grid.special.slice(0, game.specialCount) : [];
  while (special.length < game.specialCount) special.push(null);
  return { numbers, special };
}

// Bloc unique "🎰 FDJ" regroupant les 3 sous-modules — chacun garde sa propre
// ligne activer/désactiver (pas de glisser-déposer entre eux : ordre fixe
// Loto → EuroMillions → EuroDreams, comme demandé) et sa propre section
// grilles/codes (réutilise directement renderFdjGameConfig, inchangée : son
// paramètre `gameConfig` ({grids, codes}) est désormais le config du module
// lui-même, plus imbriqué sous une clé de jeu comme avant la scission).
function createFdjGroup(fdjKeys) {
  const group = document.createElement('div');
  group.className = 'fdj-group';
  group.innerHTML = `<div class="fdj-group-title">🎰 FDJ</div>`;

  fdjKeys.forEach((key) => {
    group.appendChild(createFdjSubRow(key, modulesState[key], MODULE_META[key]));
  });

  return group;
}

function createFdjSubRow(key, mod, meta) {
  const wrapper = document.createElement('div');
  wrapper.className = 'module-row-wrap fdj-sub-row-wrap' + (mod.enabled ? '' : ' module-disabled');

  const row = document.createElement('div');
  row.className = 'module-row fdj-sub-row';
  row.innerHTML = `
    <span class="module-row-icon">${meta.icon}</span>
    <span class="module-row-name">${meta.label}</span>
    <label class="toggle">
      <input type="checkbox" ${mod.enabled ? 'checked' : ''} data-key="${key}">
      <span class="toggle-slider"></span>
    </label>
  `;
  row.querySelector('input').addEventListener('change', (e) => {
    modulesState[key].enabled = e.target.checked;
    wrapper.classList.toggle('module-disabled', !e.target.checked);
  });
  wrapper.appendChild(row);

  const game = window.FdjGames.GAMES[meta.fdjGameKey];
  if (!mod.config) mod.config = {};
  mod.config.grids = Array.isArray(mod.config.grids) ? mod.config.grids.map(g => normalizeFdjGrid(game, g)) : [];
  if (game.hasCodes) mod.config.codes = Array.isArray(mod.config.codes) ? mod.config.codes : [];

  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'module-config-field fdj-config-field';
  fieldWrap.appendChild(renderFdjGameConfig(game, mod.config));
  wrapper.appendChild(fieldWrap);

  return wrapper;
}

function renderFdjGameConfig(game, gameConfig) {
  const section = document.createElement('div');
  section.className = 'fdj-config-game';
  section.innerHTML = `
    <div class="fdj-config-game-title">${game.icon} ${game.label.toUpperCase()}</div>
    <div class="fdj-config-subsection">
      <div class="fdj-config-subtitle">Mes grilles (max ${window.FdjGames.MAX_GRIDS})</div>
      <div class="fdj-config-grids-list"></div>
      <button type="button" class="etf-add-line-btn fdj-add-grid-btn">+ Ajouter une grille</button>
    </div>
    ${game.hasCodes ? `
    <div class="fdj-config-subsection">
      <div class="fdj-config-subtitle">${game.codesLabel} (max ${window.FdjGames.MAX_CODES})</div>
      <div class="fdj-config-codes-list"></div>
      <button type="button" class="etf-add-line-btn fdj-add-code-btn">+ Ajouter un code</button>
    </div>` : ''}
  `;

  const gridsListEl = section.querySelector('.fdj-config-grids-list');
  const addGridBtn = section.querySelector('.fdj-add-grid-btn');

  function renderGrids() {
    gridsListEl.innerHTML = '';
    gameConfig.grids.forEach((grid) => {
      const row = document.createElement('div');
      row.className = 'fdj-config-grid-row';

      const numberInputs = Array.from({ length: game.numberCount }, (_, i) => `
        <input type="number" min="1" max="${game.numberMax}" class="fdj-num-input" data-idx="${i}" value="${grid.numbers[i] ?? ''}">
      `).join('');
      const specialInputs = Array.from({ length: game.specialCount }, (_, i) => `
        <input type="number" min="1" max="${game.specialMax}" class="fdj-special-input" data-idx="${i}" value="${grid.special[i] ?? ''}">
      `).join('');

      row.innerHTML = `
        <div class="fdj-grid-inputs">${numberInputs}</div>
        <div class="fdj-grid-special-inputs">${specialInputs}</div>
        <button type="button" class="row-delete-btn fdj-grid-delete" title="Supprimer cette grille">×</button>
      `;

      row.querySelectorAll('.fdj-num-input').forEach(inp => inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.idx, 10);
        const v = inp.value === '' ? null : parseInt(inp.value, 10);
        grid.numbers[idx] = Number.isNaN(v) ? null : v;
      }));
      row.querySelectorAll('.fdj-special-input').forEach(inp => inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.idx, 10);
        const v = inp.value === '' ? null : parseInt(inp.value, 10);
        grid.special[idx] = Number.isNaN(v) ? null : v;
      }));

      row.querySelector('.fdj-grid-delete').addEventListener('click', () => {
        const idx = gameConfig.grids.indexOf(grid);
        if (idx !== -1) gameConfig.grids.splice(idx, 1);
        renderGrids();
        syncAddGridBtn();
      });

      gridsListEl.appendChild(row);
    });
  }

  function syncAddGridBtn() {
    const maxed = gameConfig.grids.length >= window.FdjGames.MAX_GRIDS;
    addGridBtn.disabled = maxed;
    addGridBtn.title = maxed ? `Maximum de ${window.FdjGames.MAX_GRIDS} grilles atteint` : '';
  }

  addGridBtn.addEventListener('click', () => {
    if (gameConfig.grids.length >= window.FdjGames.MAX_GRIDS) return;
    gameConfig.grids.push(window.FdjGames.emptyGrid(game));
    renderGrids();
    syncAddGridBtn();
  });

  renderGrids();
  syncAddGridBtn();

  if (game.hasCodes) {
    const codesListEl = section.querySelector('.fdj-config-codes-list');
    const addCodeBtn = section.querySelector('.fdj-add-code-btn');

    function renderCodes() {
      codesListEl.innerHTML = '';
      gameConfig.codes.forEach((code, idx) => {
        const row = document.createElement('div');
        row.className = 'fdj-config-code-row';
        row.innerHTML = `
          <input type="text" class="fdj-code-input" maxlength="16" placeholder="${game.codesPlaceholder}" value="${code || ''}">
          <button type="button" class="row-delete-btn fdj-code-delete" title="Supprimer ce code">×</button>
        `;
        row.querySelector('.fdj-code-input').addEventListener('input', (e) => {
          gameConfig.codes[idx] = e.target.value.toUpperCase();
        });
        row.querySelector('.fdj-code-delete').addEventListener('click', () => {
          gameConfig.codes.splice(idx, 1);
          renderCodes();
          syncAddCodeBtn();
        });
        codesListEl.appendChild(row);
      });
    }

    function syncAddCodeBtn() {
      const maxed = gameConfig.codes.length >= window.FdjGames.MAX_CODES;
      addCodeBtn.disabled = maxed;
      addCodeBtn.title = maxed ? `Maximum de ${window.FdjGames.MAX_CODES} codes atteint` : '';
    }

    addCodeBtn.addEventListener('click', () => {
      if (gameConfig.codes.length >= window.FdjGames.MAX_CODES) return;
      gameConfig.codes.push('');
      renderCodes();
      syncAddCodeBtn();
    });

    renderCodes();
    syncAddCodeBtn();
  }

  return section;
}

// ─── Suivi de prix Marchand (libellé + URL produit + prix cible, max 10)
// (2026-08-30, sur demande explicite) — même structure que l'ancien module
// Colis (supprimé le 2026-08-31, sur demande explicite), sa grille 4 colonnes
// (1.2fr 1.2fr 0.8fr 22px) tombe pile pour ce module : label | URL | prix
// cible | ×, à la place de label | n° suivi | indice transporteur | ×.
const MAX_PRICE_TRACKING = 10;

function renderPriceTrackingConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (!Array.isArray(mod.config.items)) mod.config.items = [];
  const items = mod.config.items;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field parcels-config-field';
  wrap.innerHTML = `
    <label>Mes produits suivis (max ${MAX_PRICE_TRACKING})</label>
    <div class="parcels-list"></div>
    <button type="button" class="etf-add-line-btn price-tracking-add-btn">+ Ajouter un produit</button>
  `;

  const listEl = wrap.querySelector('.parcels-list');
  const addBtn = wrap.querySelector('.price-tracking-add-btn');

  function renderItems() {
    listEl.innerHTML = '';
    items.forEach((item) => {
      // Grille DÉDIÉE .price-tracking-config-row (2026-08-31, sur demande
      // explicite — voir style.css) : plus .parcels-row générique, 5
      // colonnes avec largeurs précises [Nom][Vendeur][URL][Prix cible][×].
      const row = document.createElement('div');
      row.className = 'price-tracking-config-row';
      row.innerHTML = `
        <input type="text" class="parcels-label-input" placeholder="Ex : Casque Bluetooth" value="${item.label || ''}">
        <input type="text" class="price-tracking-vendor-input" placeholder="Ex : Fnac" value="${item.vendor || ''}">
        <input type="text" class="parcels-tracking-input" placeholder="URL du produit Marchand" value="${item.url || ''}">
        <input type="number" min="0" step="0.01" class="price-tracking-target-input" placeholder="0.00" value="${item.targetPrice ?? ''}">
        <button type="button" class="row-delete-btn price-tracking-delete-btn" title="Supprimer ce produit">×</button>
      `;

      row.querySelector('.parcels-label-input').addEventListener('input', (e) => { item.label = e.target.value; });
      row.querySelector('.price-tracking-vendor-input').addEventListener('input', (e) => { item.vendor = e.target.value; });
      row.querySelector('.parcels-tracking-input').addEventListener('input', (e) => { item.url = e.target.value.trim(); });
      row.querySelector('.price-tracking-target-input').addEventListener('input', (e) => {
        item.targetPrice = e.target.value === '' ? null : parseFloat(e.target.value);
      });

      row.querySelector('.price-tracking-delete-btn').addEventListener('click', () => {
        const idx = items.indexOf(item);
        if (idx !== -1) items.splice(idx, 1);
        renderItems();
        syncAddBtn();
      });

      listEl.appendChild(row);
    });
  }

  function syncAddBtn() {
    const maxed = items.length >= MAX_PRICE_TRACKING;
    addBtn.disabled = maxed;
    addBtn.title = maxed ? `Maximum de ${MAX_PRICE_TRACKING} produits atteint` : '';
  }

  addBtn.addEventListener('click', () => {
    if (items.length >= MAX_PRICE_TRACKING) return;
    items.push({ label: '', vendor: '', url: '', targetPrice: null });
    renderItems();
    syncAddBtn();
  });

  renderItems();
  syncAddBtn();

  return wrap;
}

// ─── Carburants — carburants affichés (cases à cocher) ─────────────────────
// (2026-09-01, sur demande explicite) — quels types de carburant afficher en
// colonne dans le module dashboard (voir renderer/modules/fuel-types.js,
// catalogue partagé, ET fuel-prices.js qui applique exactement cette
// sélection). Réutilise `.sports-sources-field`/`.sports-source-item` (même
// besoin visuel qu'une liste de cases à cocher, voir meta.newsSourcesField
// plus haut) plutôt que d'introduire une 3e famille de classes CSS pour la
// même chose. Pas de contrainte "au moins 1 coché" ici (contrairement à
// newsSourcesField) : rien ne l'exige côté demande, et une sélection vide
// affiche simplement un module sans colonne de prix plutôt qu'un état invalide.
function renderFuelTypesConfigSection(mod) {
  if (!mod.config) mod.config = {};
  const enabled = new Set(
    Array.isArray(mod.config.fuelTypes) && mod.config.fuelTypes.length
      ? mod.config.fuelTypes
      : window.FuelTypes.DEFAULT_ENABLED
  );
  mod.config.fuelTypes = Array.from(enabled); // fige l'état par défaut dès l'ouverture, même sans y toucher

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field sports-sources-field';
  wrap.innerHTML = `
    <label>Carburants affichés</label>
    <div class="sports-sources-list">
      ${window.FuelTypes.OPTIONS.map(opt => `
        <label class="sports-source-item">
          <input type="checkbox" class="fuel-type-checkbox" value="${opt.id}" ${enabled.has(opt.id) ? 'checked' : ''}>
          <span>${opt.label}</span>
        </label>
      `).join('')}
    </div>
  `;

  wrap.querySelectorAll('.fuel-type-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      mod.config.fuelTypes = Array.from(
        wrap.querySelectorAll('.fuel-type-checkbox:checked')
      ).map((el) => el.value);
    });
  });

  return wrap;
}

// ─── Podcasts (libellé + URL de flux RSS, max 10) ───────────────────────────
// Même structure que Colis (label + valeur par ligne, ajout/suppression) mais
// pour label + URL de flux — pas de détection auto ici (contrairement au
// transporteur des colis), aucun indice à afficher à côté du champ.
const MAX_PODCASTS = 10;

function renderPodcastConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (!Array.isArray(mod.config.feeds)) mod.config.feeds = [];
  const feeds = mod.config.feeds;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field parcels-config-field';
  wrap.innerHTML = `
    <label>Mes podcasts (max ${MAX_PODCASTS})</label>
    <div class="parcels-list"></div>
    <button type="button" class="etf-add-line-btn podcast-add-btn">+ Ajouter un flux</button>
  `;

  const listEl = wrap.querySelector('.parcels-list');
  const addBtn = wrap.querySelector('.podcast-add-btn');

  function renderFeeds() {
    listEl.innerHTML = '';
    feeds.forEach((feed) => {
      const row = document.createElement('div');
      row.className = 'parcels-row';
      row.innerHTML = `
        <input type="text" class="parcels-label-input" placeholder="Ex : France Inter - Le 7/9" value="${feed.label || ''}">
        <input type="text" class="parcels-tracking-input" placeholder="URL du flux RSS" value="${feed.url || ''}">
        <button type="button" class="row-delete-btn podcast-delete-btn" title="Supprimer ce flux">×</button>
      `;

      row.querySelector('.parcels-label-input').addEventListener('input', (e) => { feed.label = e.target.value; });
      row.querySelector('.parcels-tracking-input').addEventListener('input', (e) => { feed.url = e.target.value.trim(); });

      row.querySelector('.podcast-delete-btn').addEventListener('click', () => {
        const idx = feeds.indexOf(feed);
        if (idx !== -1) feeds.splice(idx, 1);
        renderFeeds();
        syncAddBtn();
      });

      listEl.appendChild(row);
    });
  }

  function syncAddBtn() {
    const maxed = feeds.length >= MAX_PODCASTS;
    addBtn.disabled = maxed;
    addBtn.title = maxed ? `Maximum de ${MAX_PODCASTS} podcasts atteint` : '';
  }

  addBtn.addEventListener('click', () => {
    if (feeds.length >= MAX_PODCASTS) return;
    feeds.push({ label: '', url: '' });
    renderFeeds();
    syncAddBtn();
  });

  renderFeeds();
  syncAddBtn();

  return wrap;
}

// ─── YouTube Notifications (résolution de chaîne + liste) ──────────────────
// (2026-08-15, sur demande explicite) Jusqu'à 18 chaînes (10→18, 2026-09-01,
// sur demande explicite), chacune saisie par nom ou URL — résolue
// automatiquement en ID de chaîne via l'API YouTube Data v3 (Search, ou
// Channels si l'URL contient déjà `channel/UC...`, moins coûteux en quota).
// La résolution nécessite un compte Google connecté avec le scope
// `youtube.readonly` (voir main/auth/google-oauth.js) — contrairement au
// module dashboard lui-même (youtube.js), qui ne lit ensuite QUE le flux RSS
// public de chaque chaîne déjà résolue (aucune auth requise pour ça, donc
// `MODULE_META.youtube.requiresGoogle` reste `false`).
const MAX_YOUTUBE_CHANNELS = 18;

async function youtubeFetchChannelById(channelId, accessToken) {
  const params = new URLSearchParams({ part: 'snippet', id: channelId });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `YouTube API ${res.status}`);
  }
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error('Chaîne introuvable');
  return { channelId, title: item.snippet.title, avatar: item.snippet.thumbnails?.default?.url || '' };
}

async function youtubeSearchChannel(term, accessToken) {
  const params = new URLSearchParams({ part: 'snippet', type: 'channel', maxResults: '1', q: term });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `YouTube API ${res.status}`);
  }
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error('Aucune chaîne trouvée');
  const channelId = item.snippet.channelId || item.id?.channelId;
  return { channelId, title: item.snippet.title, avatar: item.snippet.thumbnails?.default?.url || '' };
}

async function youtubeResolveChannel(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) throw new Error('Nom de chaîne vide');

  const google = await window.matin.google.getValidToken();
  if (!google?.accessToken) {
    throw new Error('Connectez votre compte Google (en haut de Paramètres) pour résoudre une chaîne');
  }

  // Une URL "channel/UC..." porte déjà l'ID exact — évite un appel Search
  // (quota plus coûteux) au profit d'un simple Channels#id.
  const directMatch = trimmed.match(/channel\/(UC[0-9A-Za-z_-]{22})/);
  if (directMatch) return youtubeFetchChannelById(directMatch[1], google.accessToken);

  // Sinon on nettoie une éventuelle URL (@handle, /c/, /user/, /featured) en
  // simple terme de recherche — un nom saisi tel quel ("LeGrandJD") passe
  // déjà tel quel par ce nettoyage sans effet.
  const searchTerm = trimmed
    .replace(/^https?:\/\/(www\.)?youtube\.com\//, '')
    .replace(/^@/, '')
    .replace(/\/(featured|videos)?$/, '');

  return youtubeSearchChannel(searchTerm, google.accessToken);
}

function renderYoutubeConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (!Array.isArray(mod.config.channels)) mod.config.channels = [];
  const channels = mod.config.channels;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field parcels-config-field';
  wrap.innerHTML = `
    <div class="youtube-channels-list"></div>
    <button type="button" class="etf-add-line-btn youtube-add-btn">+ Ajouter une chaîne</button>
  `;

  const listEl = wrap.querySelector('.youtube-channels-list');
  const addBtn = wrap.querySelector('.youtube-add-btn');
  // Assignée après renderChannels (voir tout en bas) — les fonctions
  // ci-dessous n'y accèdent que dans des gestionnaires d'événements,
  // jamais avant que `collapsible` soit réellement défini.
  let collapsible;

  function statusText(channel) {
    if (channel.resolving) return 'Résolution…';
    if (channel.error) return `⚠ ${channel.error}`;
    if (channel.channelId) return `✓ ${channel.title}`;
    return '';
  }

  // Repli lettre (2026-09-01, sur demande explicite, "show a placeholder
  // with the first letter of the channel name") — remplace l'ancien repli
  // 🔔 FIXE : 1re lettre du nom RÉSOLU (`channel.title`) si disponible,
  // sinon celle du texte tel que tapé (`channel.query`, avant résolution),
  // sinon 🔔 pour une ligne fraîchement ajoutée et encore vide. Utilisée à
  // la fois pour le rendu initial (pas encore résolu/en échec) et pour le
  // repli en direct si l'`<img>` échoue à charger (voir listener 'error'
  // plus bas) — même fonction dans les 2 cas, jamais dupliquée.
  function avatarFallbackHtml(channel) {
    const letter = (channel.title || channel.query || '').trim().charAt(0).toUpperCase();
    return `<div class="youtube-channel-avatar youtube-channel-avatar-fallback">${letter || '🔔'}</div>`;
  }

  function renderChannels() {
    listEl.innerHTML = '';
    channels.forEach((channel) => {
      const row = document.createElement('div');
      row.className = 'parcels-row youtube-channel-row';
      // L'avatar est TOUJOURS rendu (image si résolue, sinon un cercle de
      // repli) — jamais omis : `youtube-channel-row` fixe 3 colonnes de grille
      // (avatar/contenu/suppression), donc n'en rendre que 2 (avant
      // résolution, quand `channel.avatar` est encore vide) plaçait le champ
      // de saisie dans la 1re colonne étroite (28px) au lieu de la colonne
      // centrale extensible — bug réel corrigé le 2026-08-15 (champ illisible
      // signalé par l'utilisateur, car écrasé sur 28px de large).
      const avatarHtml = channel.avatar
        ? `<img class="youtube-channel-avatar" src="${channel.avatar}" alt="">`
        : avatarFallbackHtml(channel);
      row.innerHTML = `
        ${avatarHtml}
        <div class="youtube-channel-main">
          <input type="text" class="parcels-label-input youtube-channel-input" placeholder="Nom de la chaîne ou URL" value="${channel.query || ''}">
          <span class="youtube-channel-status">${statusText(channel)}</span>
        </div>
        <button type="button" class="row-delete-btn youtube-delete-btn" title="Supprimer cette chaîne">×</button>
      `;

      // Repli EN DIRECT (2026-09-01, sur demande explicite, "if thumbnail
      // fails to load") — `channel.avatar` non vide ne garantit pas que
      // l'image charge RÉELLEMENT (URL périmée, réseau, blocage) : sans ce
      // listener, une image cassée resterait un cadre vide/icône brisée du
      // navigateur au lieu de basculer sur la lettre de repli. `{ once:
      // true }` : un seul remplacement, jamais besoin de 2e essai sur la
      // même balise (déjà retirée du DOM après le 1er échec).
      const avatarImg = row.querySelector('img.youtube-channel-avatar');
      avatarImg?.addEventListener('error', () => {
        avatarImg.outerHTML = avatarFallbackHtml(channel);
      }, { once: true });

      const input = row.querySelector('.youtube-channel-input');
      const statusEl = row.querySelector('.youtube-channel-status');

      async function resolve() {
        const value = input.value.trim();
        channel.query = value;
        if (!value) {
          channel.channelId = ''; channel.title = ''; channel.avatar = ''; channel.error = '';
          statusEl.textContent = '';
          return;
        }
        channel.resolving = true;
        channel.error = '';
        statusEl.textContent = statusText(channel);
        try {
          const resolved = await youtubeResolveChannel(value);
          Object.assign(channel, resolved, { resolving: false, error: '' });
        } catch (err) {
          channel.resolving = false;
          channel.error = err.message;
          channel.channelId = '';
        }
        renderChannels(); // avatar/statut peuvent avoir changé : ré-affiche toute la liste
      }

      input.addEventListener('input', (e) => { channel.query = e.target.value; });
      input.addEventListener('change', resolve);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

      row.querySelector('.youtube-delete-btn').addEventListener('click', () => {
        const idx = channels.indexOf(channel);
        if (idx !== -1) channels.splice(idx, 1);
        renderChannels();
        syncAddBtn();
      });

      listEl.appendChild(row);
    });
    collapsible?.refreshLabel();
  }

  // Bouton MASQUÉ (pas seulement désactivé) une fois le maximum atteint
  // (2026-09-01, sur demande explicite — "the '+ Ajouter une chaîne' button
  // should be hidden") : diffère du pattern "disabled" utilisé pour les
  // autres boutons "+ Ajouter" de ce fichier (ETF/Crypto/Prêts...), suivi
  // ici à la lettre pour YouTube spécifiquement.
  function syncAddBtn() {
    const maxed = channels.length >= MAX_YOUTUBE_CHANNELS;
    addBtn.style.display = maxed ? 'none' : '';
  }

  addBtn.addEventListener('click', () => {
    if (channels.length >= MAX_YOUTUBE_CHANNELS) return;
    channels.push({ query: '', channelId: '', title: '', avatar: '' });
    renderChannels();
    syncAddBtn();
  });

  renderChannels();
  syncAddBtn();

  // Repliable (2026-08-16, sur demande explicite) — voir wrapCollapsibleSection.
  // `compact: true` (2026-09-01, sur demande explicite — "no separate
  // border, no floating element... one unified card") : YouTube gardait
  // volontairement son espacement PAR DÉFAUT depuis l'introduction de ce
  // composant (voir le commentaire de wrapCollapsibleSection/
  // .config-collapsible--compact dans style.css, qui documentait ce choix
  // explicite), mais ça laissait le libellé flotter sous la ligne du module
  // avec un espace vide visible — même symptôme déjà corrigé pour
  // ETF/Crypto/Prêts via ce même modificateur, qui soude l'en-tête (et le
  // corps déplié) directement sous `.module-row` (fond/bordure assortis,
  // coin haut carré, chevauchement -1px).
  // Libellé changé de "— N configurée(s)" (compte dynamique) à "(max 18)"
  // (2026-09-01, 2e demande explicite le même jour, "Update the label:
  // 'Mes chaînes YouTube (max 18)'") — statique plutôt que recalculé à
  // chaque appel de refreshLabel(), MAX_YOUTUBE_CHANNELS injecté plutôt que
  // "18" en dur pour rester synchronisé si cette constante change à nouveau.
  collapsible = wrapCollapsibleSection(wrap, {
    storeKey: 'app.configCollapsed.youtube.channels',
    labelFor: () => `Mes chaînes YouTube (max ${MAX_YOUTUBE_CHANNELS})`,
    compact: true,
  });
  return collapsible.wrap;
}

// ─── Philips Hue — pont local OU compte cloud (2026-08-31, sur demande
// explicite, support des ampoules Hue de nouvelle génération SANS pont) ────
// `cfg.mode` ("bridge"/"cloud") détermine QUELLE section est visible/utilisée
// ici en Paramètres — au moment de l'utilisation réelle (dashboard, voir
// hue.js), la détection est plutôt basée sur les champs RÉELLEMENT remplis
// (point 4 de la demande, "auto-detect based on which fields are filled") :
// les 2 mécanismes ne sont pas censés diverger en usage normal (basculer le
// mode ici ne vide jamais les champs de l'autre mode), mais le second reste
// la source de vérité au moment de contrôler une vraie ampoule.
//
// Pont : l'appairage exige un appui physique sur le bouton du pont dans les
// ~30s précédant l'appel — impossible à automatiser depuis ce code, d'où le
// bouton "Connecter" qui se contente de relayer une tentative et d'afficher
// clairement l'échec ("bouton non pressé") plutôt que de retenter en boucle.
//
// Cloud : OAuth2 via un compte developers.meethue.com PERSONNEL (voir
// main/auth/hue-oauth.js) — `clientId`/`clientSecret` saisis par
// l'utilisateur lui-même, jamais dans le `.env` de cette app (Hue n'accorde
// pas d'accès "partenaire" au grand public pour ce genre d'app tierce).
function renderHueConfigSection(mod) {
  if (!mod.config) mod.config = {};
  const cfg = mod.config;
  if (typeof cfg.bridgeIp !== 'string') cfg.bridgeIp = '';
  if (typeof cfg.username !== 'string') cfg.username = '';
  if (cfg.mode !== 'cloud') cfg.mode = 'bridge'; // défaut historique, comportement inchangé pour une config existante
  if (typeof cfg.clientId !== 'string') cfg.clientId = '';
  if (typeof cfg.clientSecret !== 'string') cfg.clientSecret = '';

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field hue-config-field';
  wrap.innerHTML = `
    <div class="hue-mode-toggle-row">
      <label>Mon modèle Hue</label>
      <div class="hue-mode-toggle">
        <button type="button" class="hue-mode-btn" data-mode="bridge">Avec bridge (ancien modèle)</button>
        <button type="button" class="hue-mode-btn" data-mode="cloud">Sans bridge (nouveau modèle)</button>
      </div>
    </div>

    <div class="hue-mode-section" data-mode-section="bridge">
      <div class="hue-config-row">
        <label>Adresse IP du bridge</label>
        <input type="text" class="hue-ip-input" placeholder="192.168.1.XX" value="${cfg.bridgeIp}">
        <button type="button" class="hue-discover-btn etf-add-line-btn">Découvrir</button>
      </div>
      <div class="hue-config-row">
        <label>Nom d'utilisateur API</label>
        <input type="text" class="hue-username-input" placeholder="Généré par Connecter" value="${cfg.username}" readonly>
        <button type="button" class="hue-pair-btn etf-add-line-btn">Connecter</button>
      </div>
      <p class="hue-config-status" data-status="bridge"></p>
      <p class="hue-config-hint">Entrez l'IP de votre bridge Hue (boîtier blanc). Appuyez sur le bouton du bridge puis cliquez Connecter.</p>
    </div>

    <div class="hue-mode-section" data-mode-section="cloud">
      <div class="hue-cloud-instructions">
        Pour connecter vos ampoules Hue sans bridge :<br>
        1. Créez un compte gratuit sur developers.meethue.com<br>
        2. Créez une nouvelle application → récupérez votre Client ID et Client Secret<br>
        3. Entrez-les ci-dessous et cliquez Connecter<br>
        4. Autorisez l'accès à votre compte Hue
      </div>
      <div class="hue-config-row">
        <label>Client ID</label>
        <input type="text" class="hue-client-id-input" placeholder="Client ID Hue" value="${cfg.clientId}">
      </div>
      <div class="hue-config-row">
        <label>Client Secret</label>
        <input type="password" class="hue-client-secret-input" placeholder="Client Secret Hue" value="${cfg.clientSecret}">
      </div>
      <button type="button" class="hue-cloud-connect-btn etf-add-line-btn">Connecter mon compte Hue</button>
      <p class="hue-config-status" data-status="cloud">${cfg.accessToken ? '✓ Compte Hue connecté.' : 'Non connecté.'}</p>
    </div>
  `;

  // ── Bascule de mode ────────────────────────────────────────────────────
  const modeButtons = wrap.querySelectorAll('.hue-mode-btn');
  const modeSections = wrap.querySelectorAll('.hue-mode-section');
  function applyMode(mode) {
    cfg.mode = mode;
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    modeSections.forEach((s) => s.classList.toggle('active', s.dataset.modeSection === mode));
  }
  modeButtons.forEach((b) => b.addEventListener('click', () => applyMode(b.dataset.mode)));
  applyMode(cfg.mode);

  // ── Mode "Avec bridge" (comportement historique, libellés ajustés) ─────
  const ipInput = wrap.querySelector('.hue-ip-input');
  const usernameInput = wrap.querySelector('.hue-username-input');
  const bridgeStatusEl = wrap.querySelector('[data-status="bridge"]');

  ipInput.addEventListener('input', (e) => { cfg.bridgeIp = e.target.value.trim(); });

  wrap.querySelector('.hue-discover-btn').addEventListener('click', async () => {
    bridgeStatusEl.textContent = 'Recherche du bridge sur le réseau…';
    try {
      const ip = await window.matin.hue.discoverBridge();
      ipInput.value = ip;
      cfg.bridgeIp = ip;
      bridgeStatusEl.textContent = `Bridge trouvé : ${ip}`;
    } catch (err) {
      bridgeStatusEl.textContent = 'Aucun bridge trouvé automatiquement — saisissez l\'IP manuellement.';
      console.warn('[Config] Découverte Hue échouée', err);
    }
  });

  wrap.querySelector('.hue-pair-btn').addEventListener('click', async () => {
    if (!cfg.bridgeIp) { bridgeStatusEl.textContent = 'Renseignez d\'abord l\'IP du bridge.'; return; }
    bridgeStatusEl.textContent = 'Connexion… (bouton du bridge déjà pressé ?)';
    try {
      const username = await window.matin.hue.pair(cfg.bridgeIp);
      usernameInput.value = username;
      cfg.username = username;
      bridgeStatusEl.textContent = '✓ Connecté avec succès.';
    } catch (err) {
      bridgeStatusEl.textContent = `Échec : ${err.message}`;
      console.warn('[Config] Connexion Hue (bridge) échouée', err);
    }
  });

  // ── Mode "Sans bridge" (compte cloud) ───────────────────────────────────
  const clientIdInput = wrap.querySelector('.hue-client-id-input');
  const clientSecretInput = wrap.querySelector('.hue-client-secret-input');
  const cloudStatusEl = wrap.querySelector('[data-status="cloud"]');

  clientIdInput.addEventListener('input', (e) => { cfg.clientId = e.target.value.trim(); });
  clientSecretInput.addEventListener('input', (e) => { cfg.clientSecret = e.target.value.trim(); });

  wrap.querySelector('.hue-cloud-connect-btn').addEventListener('click', async () => {
    if (!cfg.clientId || !cfg.clientSecret) {
      cloudStatusEl.textContent = 'Renseignez le Client ID et le Client Secret avant de vous connecter.';
      return;
    }
    cloudStatusEl.textContent = 'Connexion à votre compte Hue… (une page va s\'ouvrir dans votre navigateur)';
    try {
      const tokens = await window.matin.hue.cloudLogin({ clientId: cfg.clientId, clientSecret: cfg.clientSecret });
      cfg.accessToken = tokens.accessToken;
      cfg.refreshToken = tokens.refreshToken;
      cfg.expiresAt = tokens.expiresAt;
      cloudStatusEl.textContent = '✓ Compte Hue connecté.';
    } catch (err) {
      cloudStatusEl.textContent = `Échec : ${err.message}`;
      console.warn('[Config] Connexion Hue (cloud) échouée', err);
    }
  });

  return wrap;
}

// ─── TP-Link Kasa (sous-réseau optionnel + bouton de découverte) ───────────
// AUCUN compte/identifiant à saisir (contrairement à Hue juste
// au-dessus) — la liste des appareils elle-même vit dans electron-store
// (`kasa.devices`, écrite par main.js après chaque découverte réussie), pas
// dans `mod.config` : cette section ne fait que déclencher le balayage réseau
// et afficher son résultat, elle ne stocke pas la liste elle-même. Réutilise
// les classes `.hue-config-*` telles quelles (même besoin visuel que Hue).
function renderKasaConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (typeof mod.config.subnet !== 'string') mod.config.subnet = '';
  const cfg = mod.config;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field hue-config-field';
  wrap.innerHTML = `
    <div class="hue-config-row">
      <label>Sous-réseau (optionnel)</label>
      <input type="text" class="kasa-subnet-input" placeholder="192.168.1" value="${cfg.subnet}">
      <button type="button" class="kasa-discover-btn etf-add-line-btn">Rechercher les appareils</button>
    </div>
    <p class="hue-config-status"></p>
    <p class="hue-config-hint">Aucun compte requis — fonctionne entièrement en local. Laissez le sous-réseau vide pour une découverte automatique, ou précisez-le (ex. 192.168.1, sans le dernier chiffre) si rien n'est trouvé.</p>
  `;

  const subnetInput = wrap.querySelector('.kasa-subnet-input');
  const statusEl = wrap.querySelector('.hue-config-status');
  const discoverBtn = wrap.querySelector('.kasa-discover-btn');

  subnetInput.addEventListener('input', (e) => { cfg.subnet = e.target.value.trim(); });

  discoverBtn.addEventListener('click', async () => {
    discoverBtn.disabled = true;
    const originalLabel = discoverBtn.textContent;
    discoverBtn.textContent = 'Recherche en cours…';
    statusEl.textContent = 'Balayage du réseau local (quelques secondes)…';
    try {
      const devices = await window.matin.kasa.discover(cfg.subnet || null);
      statusEl.textContent = devices.length
        ? `${devices.length} appareil(s) trouvé(s) : ${devices.map(d => d.alias).join(', ')}`
        : 'Aucun appareil Kasa trouvé sur le réseau.';
    } catch (err) {
      statusEl.textContent = `Erreur : ${err.message}`;
      console.warn('[Config] Découverte Kasa échouée', err);
    } finally {
      discoverBtn.disabled = false;
      discoverBtn.textContent = originalLabel;
    }
  });

  return wrap;
}

// ─── IKEA Trådfri (IP de la passerelle + code de sécurité) ─────────────────
// Contrairement à Kasa (aucun identifiant) mais comme Hue, un appairage est
// nécessaire — la différence est que ce n'est PAS un appui physique mais un
// code imprimé sous la passerelle : le bouton "Connecter" envoie directement
// IP + code à `tradfri:connect`, qui les échange contre une identité + clé
// pré-partagée (PSK) à conserver définitivement (voir main.js). Réutilise les
// classes `.hue-config-*` telles quelles (même besoin visuel que Hue/Kasa).
function renderTradfriConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (typeof mod.config.gatewayIp !== 'string') mod.config.gatewayIp = '';
  if (typeof mod.config.identity !== 'string') mod.config.identity = '';
  if (typeof mod.config.psk !== 'string') mod.config.psk = '';
  const cfg = mod.config;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field hue-config-field';
  wrap.innerHTML = `
    <div class="hue-config-row">
      <label>IP de la passerelle</label>
      <input type="text" class="tradfri-ip-input" placeholder="192.168.1.XX" value="${cfg.gatewayIp}">
    </div>
    <div class="hue-config-row">
      <label>Code de sécurité</label>
      <input type="text" class="tradfri-code-input" placeholder="Imprimé sous la passerelle">
      <button type="button" class="tradfri-connect-btn etf-add-line-btn">Connecter</button>
    </div>
    <p class="hue-config-status">${cfg.identity ? '✓ Identifiants déjà enregistrés.' : 'Non connecté.'}</p>
    <p class="hue-config-hint">Le code de sécurité (16 caractères sous la passerelle) n'est utilisé qu'une fois : une identité est générée et enregistrée ensuite, il ne sera plus jamais redemandé.</p>
  `;

  const ipInput = wrap.querySelector('.tradfri-ip-input');
  const codeInput = wrap.querySelector('.tradfri-code-input');
  const statusEl = wrap.querySelector('.hue-config-status');

  ipInput.addEventListener('input', (e) => { cfg.gatewayIp = e.target.value.trim(); });

  wrap.querySelector('.tradfri-connect-btn').addEventListener('click', async () => {
    const code = codeInput.value.trim();
    if (!cfg.gatewayIp) { statusEl.textContent = 'Renseignez d\'abord l\'IP de la passerelle.'; return; }
    if (!code) { statusEl.textContent = 'Renseignez le code de sécurité.'; return; }
    statusEl.textContent = 'Connexion en cours…';
    try {
      const { identity, psk } = await window.matin.tradfri.connect(cfg.gatewayIp, code);
      cfg.identity = identity;
      cfg.psk = psk;
      codeInput.value = ''; // le code est à usage unique, inutile de le laisser affiché
      statusEl.textContent = '✓ Connecté avec succès — n\'oubliez pas d\'Enregistrer.';
    } catch (err) {
      statusEl.textContent = `Échec : ${err.message}`;
      console.warn('[Config] Connexion Trådfri échouée', err);
    }
  });

  return wrap;
}

// ─── Rappels (titre + date/heure + récurrence + catégorie) ─────────────────
const MAX_REMINDERS = 15; // 30→15 (2026-09-01, sur demande explicite)
const REMINDERS_RECUR_PREVIEW_LABEL = { daily: 'quotidien', weekly: 'hebdo', monthly: 'mensuel' };

function remindersCategoryOptionsHtml(selected) {
  return window.ReminderCategories.list.map(c =>
    `<option value="${c.key}" ${c.key === selected ? 'selected' : ''}>${c.emoji} ${c.label}</option>`
  ).join('');
}

function renderRemindersConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (!Array.isArray(mod.config.items)) mod.config.items = [];
  const items = mod.config.items;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field reminders-config-field';
  wrap.innerHTML = `
    <label>Mes rappels (max ${MAX_REMINDERS})</label>
    <div class="reminders-config-header">
      <span></span><span>Titre</span><span>Date</span><span>Heure</span><span>Récurrence</span><span></span>
    </div>
    <div class="reminders-config-list"></div>
    <button type="button" class="etf-add-line-btn reminders-add-btn">+ Ajouter un rappel</button>
  `;

  const listEl = wrap.querySelector('.reminders-config-list');
  const addBtn = wrap.querySelector('.reminders-add-btn');

  // Résumé lisible affiché au-dessus de chaque ligne de champs (icône + titre
  // + heure, éventuellement récurrence) — la grille compacte à 6 colonnes
  // reste dense à lire d'un coup d'œil, ce résumé montre le rendu final sans
  // décoder chaque petit champ.
  function remindersPreviewHtml(item) {
    const cat = window.ReminderCategories?.byKey?.[item.icon] || { emoji: '⏰' };
    const title = item.title?.trim() || '(sans titre)';
    const time = item.time || '--:--';
    const recur = item.recurrence && item.recurrence !== 'once' ? ` · ${REMINDERS_RECUR_PREVIEW_LABEL[item.recurrence]}` : '';
    return `${cat.emoji} <strong>${title}</strong> — <span class="reminders-preview-time">${time}</span>${recur}`;
  }

  function renderItems() {
    listEl.innerHTML = '';
    items.forEach((item) => {
      const wrapItem = document.createElement('div');
      wrapItem.className = 'reminders-config-item';

      const preview = document.createElement('div');
      preview.className = 'reminders-config-preview';
      preview.innerHTML = remindersPreviewHtml(item);

      const row = document.createElement('div');
      row.className = 'reminders-config-row';
      row.innerHTML = `
        <select class="reminders-icon-select">${remindersCategoryOptionsHtml(item.icon)}</select>
        <input type="text" class="reminders-title-input" placeholder="Ex : Médicament matin" value="${item.title || ''}">
        <input type="date" class="reminders-date-input" value="${item.date || ''}">
        <input type="time" class="reminders-time-input" value="${item.time || ''}">
        <select class="reminders-recur-select">
          <option value="once" ${!item.recurrence || item.recurrence === 'once' ? 'selected' : ''}>Une fois</option>
          <option value="daily" ${item.recurrence === 'daily' ? 'selected' : ''}>Quotidien</option>
          <option value="weekly" ${item.recurrence === 'weekly' ? 'selected' : ''}>Hebdo.</option>
          <option value="monthly" ${item.recurrence === 'monthly' ? 'selected' : ''}>Mensuel</option>
        </select>
        <button type="button" class="row-delete-btn reminders-delete-btn" title="Supprimer ce rappel">×</button>
      `;

      const refreshPreview = () => { preview.innerHTML = remindersPreviewHtml(item); };

      row.querySelector('.reminders-icon-select').addEventListener('change', (e) => { item.icon = e.target.value; refreshPreview(); });
      row.querySelector('.reminders-title-input').addEventListener('input', (e) => { item.title = e.target.value; refreshPreview(); });
      row.querySelector('.reminders-date-input').addEventListener('input', (e) => { item.date = e.target.value; refreshPreview(); });
      row.querySelector('.reminders-time-input').addEventListener('input', (e) => { item.time = e.target.value; refreshPreview(); });
      row.querySelector('.reminders-recur-select').addEventListener('change', (e) => { item.recurrence = e.target.value; refreshPreview(); });

      row.querySelector('.reminders-delete-btn').addEventListener('click', () => {
        const idx = items.indexOf(item);
        if (idx !== -1) items.splice(idx, 1);
        renderItems();
        syncAddBtn();
      });

      wrapItem.appendChild(preview);
      wrapItem.appendChild(row);
      listEl.appendChild(wrapItem);
    });
  }

  function syncAddBtn() {
    const maxed = items.length >= MAX_REMINDERS;
    addBtn.disabled = maxed;
    addBtn.title = maxed ? `Maximum de ${MAX_REMINDERS} rappels atteint` : '';
  }

  addBtn.addEventListener('click', () => {
    if (items.length >= MAX_REMINDERS) return;
    // crypto.randomUUID() — disponible nativement dans le renderer Electron
    // (contexte Chromium sécurisé) ; sert uniquement à distinguer les rappels
    // entre eux côté main.js (marquage lastFired par item), pas d'exigence
    // cryptographique réelle ici.
    // `icon` par défaut = 1re catégorie du catalogue (2026-09-01 — l'ancienne
    // clé 'other' n'existe plus, voir reminders-categories.js) plutôt qu'une
    // clé en dur, pour ne pas se désynchroniser si la liste est réordonnée.
    items.push({ id: crypto.randomUUID(), title: '', date: '', time: '', recurrence: 'once', icon: window.ReminderCategories.list[0].key });
    renderItems();
    syncAddBtn();
  });

  renderItems();
  syncAddBtn();

  return wrap;
}

// ─── Indices boursiers (sélection à afficher) ───────────────────────────────
// Liste STATIQUE (indices-defs.js, partagé avec indices.js) — un vrai
// interrupteur à bascule par indice (.toggle/.toggle-slider, MÊME élément
// visuel que l'activation/désactivation de chaque module en haut de sa
// ligne, sur demande explicite — pas une simple case à cocher) plutôt que le
// mécanisme de détection asynchrone des sources Sport/RSS, inutile ici.
function renderIndicesConfigSection(mod) {
  if (!mod.config) mod.config = {};
  const wrap = document.createElement('div');
  wrap.className = 'module-config-field indices-config-field';
  wrap.innerHTML = `
    <label>Indices à afficher</label>
    <div class="indices-toggle-list"></div>
  `;

  const listEl = wrap.querySelector('.indices-toggle-list');
  // `selected` absent/null = tous affichés (repli défensif — le défaut réel
  // est désormais CAC 40 + S&P 500 seuls, voir main.js/DEFAULT_MODULES) —
  // matérialisé ici comme "tout activé" plutôt que des interrupteurs dans un
  // état indéterminé, pour que l'affichage corresponde toujours à l'état réel.
  const selected = new Set(Array.isArray(mod.config.selected) ? mod.config.selected : window.IndicesDefs.map(d => d.symbol));

  listEl.innerHTML = window.IndicesDefs.map(d => `
    <div class="indices-toggle-row">
      <span class="indices-toggle-label">${d.label}</span>
      <label class="toggle">
        <input type="checkbox" class="indices-source-checkbox" value="${d.symbol}" ${selected.has(d.symbol) ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
  `).join('');

  const syncSelected = () => {
    mod.config.selected = Array.from(listEl.querySelectorAll('.indices-source-checkbox:checked')).map(el => el.value);
  };
  listEl.querySelectorAll('.indices-source-checkbox').forEach(cb => cb.addEventListener('change', syncSelected));

  return wrap;
}

// ─── Alertes (département + type par type) ─────────────────────────────────
// Champ département texte libre (pas un <select> des 101 départements
// français — resterait correct pour la Corse "2A"/"2B" et les DOM sans
// logique spéciale) + un .toggle par type d'alerte (même composant que la
// sélection d'indices juste au-dessus).
// "Rappels produits" retiré entièrement (2026-09-01, sur demande explicite)
// — voir main.js, alertsCheckRappelConso supprimée (plus aucune trace, y
// compris dans le type par défaut de la config). "Trafic routier" ajouté le
// même jour (2e demande explicite) — voir main.js alertsCheckTrafic.
// Fonctionne en pratique à "—" en permanence pour l'instant : aucun endpoint
// DATEX II confirmé n'a pu être branché (voir le commentaire détaillé
// d'alertsCheckTrafic dans main.js) — le réglage reste affiché pour ne pas
// bloquer le reste de cette demande, mais ne remontera aucune alerte tant
// qu'une vraie source n'est pas connue. "Perturbations SNCF" (ajouté le
// même jour que Trafic routier) retiré ENTIÈREMENT à son tour le 2026-09-01
// (2e demande explicite le même jour) — voir main.js, alertsCheckSncf/
// ALERTS_SNCF_URL/alertsResolveSncfApiKey/ALERTS_SNCF_EFFECT_LABELS/
// ALERTS_DEPARTMENT_NAMES, toutes supprimées (plus aucune trace).
const ALERTS_TYPE_DEFS = [
  { key: 'enlevement', icon: '🚸', label: 'Alerte enlèvement' },
  { key: 'meteo',      icon: '🌪️', label: 'Vigilance météo' },
  { key: 'vigipirate', icon: '🔴', label: 'Vigipirate' },
  { key: 'trafic',     icon: '🚗', label: 'Trafic routier' },
];

function renderAlertsConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (typeof mod.config.department !== 'string') mod.config.department = '';
  if (!mod.config.types || typeof mod.config.types !== 'object') mod.config.types = {};

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field alerts-config-field';
  wrap.innerHTML = `
    <div class="alerts-config-dept-row">
      <label>Département (météo / trafic)</label>
      <input type="text" class="alerts-dept-input" placeholder="Ex : 69" maxlength="3" value="${mod.config.department}">
    </div>
    <div class="indices-toggle-list"></div>
  `;

  wrap.querySelector('.alerts-dept-input').addEventListener('input', (e) => {
    mod.config.department = e.target.value.trim();
  });

  const listEl = wrap.querySelector('.indices-toggle-list');
  listEl.innerHTML = ALERTS_TYPE_DEFS.map(t => `
    <div class="indices-toggle-row">
      <span class="indices-toggle-label">${t.icon} ${t.label}</span>
      <label class="toggle">
        <input type="checkbox" class="alerts-type-checkbox" data-type="${t.key}" ${mod.config.types[t.key] !== false ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
  `).join('');

  listEl.querySelectorAll('.alerts-type-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      mod.config.types[e.target.dataset.type] = e.target.checked;
    });
  });

  return wrap;
}

// ─── Prêts (jusqu'à 5 prêts par groupe, paliers de remboursement) ──────────
// RECONSTRUIT le 2026-08-08 (sur demande explicite) : chaque prêt a
// maintenant une date de FIN saisie explicitement (remplace l'ancienne
// "Durée (mois)") et un TYPE de remboursement — Fixe (une seule mensualité,
// comme avant) ou Paliers (jusqu'à 5 périodes à mensualité différente, ex.
// prêt relais/palier réel). Chaque prêt est rendu comme un petit bloc
// (`.prets-loan-config`) plutôt qu'une simple ligne de grille comme avant :
// la sous-section Paliers a besoin de sa propre liste imbriquée, impossible à
// caser dans une seule ligne. Le sélecteur de type re-rend LE PRÊT (pas toute
// la liste) pour basculer entre le champ Mensualité unique et la liste de
// paliers sans perdre le focus/la saisie des AUTRES prêts du groupe.
function renderPretsLoansSection(key, mod) {
  if (!mod.config) mod.config = {};
  if (!Array.isArray(mod.config.loans)) mod.config.loans = [];
  const loans = mod.config.loans;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field prets-loans-field';
  wrap.innerHTML = `
    <div class="prets-loans-list"></div>
    <button type="button" class="etf-add-line-btn prets-add-loan-btn">+ Ajouter un prêt</button>
  `;

  const listEl = wrap.querySelector('.prets-loans-list');
  const addBtn = wrap.querySelector('.prets-add-loan-btn');
  // Assignée après le 1er renderLoans() (voir wrapCollapsibleSection tout en
  // bas) — accédée uniquement via `collapsible?.` dans les gestionnaires
  // d'événements ci-dessous.
  let collapsible;

  function renderPaliers(loan, listEl2, addBtn2) {
    if (!Array.isArray(loan.paliers)) loan.paliers = [];
    const paliers = loan.paliers;

    listEl2.innerHTML = '';
    paliers.forEach((palier) => {
      const row = document.createElement('div');
      row.className = 'prets-palier-row';
      row.innerHTML = `
        <input type="date" class="prets-palier-start" value="${palier.startDate || ''}">
        <input type="date" class="prets-palier-end" value="${palier.endDate || ''}">
        <input type="number" min="0" step="0.01" class="prets-palier-payment" placeholder="Mensualité €" value="${palier.monthlyPayment ?? ''}">
        <button type="button" class="row-delete-btn prets-palier-delete" title="Supprimer ce palier">×</button>
      `;

      const sync = () => {
        palier.startDate = row.querySelector('.prets-palier-start').value;
        palier.endDate = row.querySelector('.prets-palier-end').value;
        palier.monthlyPayment = parseFloat(row.querySelector('.prets-palier-payment').value) || 0;
      };
      row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', sync));

      row.querySelector('.prets-palier-delete').addEventListener('click', () => {
        const idx = paliers.indexOf(palier);
        if (idx !== -1) paliers.splice(idx, 1);
        renderPaliers(loan, listEl2, addBtn2);
      });

      listEl2.appendChild(row);
    });

    const maxed = paliers.length >= MAX_PALIERS_PER_LOAN;
    addBtn2.disabled = maxed;
    addBtn2.title = maxed ? `Maximum de ${MAX_PALIERS_PER_LOAN} paliers atteint` : '';
  }

  function renderLoans() {
    listEl.innerHTML = '';
    loans.forEach((loan) => {
      if (loan.paymentType !== 'paliers') loan.paymentType = 'fixe'; // défaut explicite, y compris pour les prêts créés avant cette reconstruction

      const box = document.createElement('div');
      box.className = 'prets-loan-config';
      box.innerHTML = `
        <div class="prets-loan-config-labels">
          <span>Nom</span><span>Montant</span><span>Début</span><span>Fin</span><span>Type</span><span></span>
        </div>
        <div class="prets-loan-config-header">
          <input type="text" class="prets-loan-name" placeholder="Ex: Optiplan" value="${loan.name || ''}">
          <input type="number" min="0" step="0.01" class="prets-loan-amount" placeholder="Montant (€)" value="${loan.amount ?? ''}">
          <input type="date" class="prets-loan-start" title="Date de début" value="${loan.startDate || ''}">
          <input type="date" class="prets-loan-end" title="Date de fin" value="${loan.endDate || ''}">
          <select class="prets-loan-type" title="Type de remboursement">
            <option value="fixe" ${loan.paymentType === 'fixe' ? 'selected' : ''}>Fixe</option>
            <option value="paliers" ${loan.paymentType === 'paliers' ? 'selected' : ''}>Paliers</option>
          </select>
          <button type="button" class="row-delete-btn prets-loan-delete" title="Supprimer ce prêt">×</button>
        </div>
        <div class="prets-loan-line2"></div>
        <div class="prets-loan-body"></div>
      `;

      const line2El = box.querySelector('.prets-loan-line2');
      const bodyEl = box.querySelector('.prets-loan-body');

      // Ligne 2 (2026-08-09, sur demande explicite ; Taux déplacé ici depuis
      // l'en-tête le 2026-08-31, sur nouvelle demande explicite) — "Taux",
      // "Jour de prélèvement" puis "Mensualité", en retrait, texte réduit ;
      // la Mensualité fixe n'apparaît qu'en type Fixe (un prêt à paliers a
      // une mensualité PAR palier, affichée plus bas dans sa propre liste,
      // jamais ici) — Taux et Jour de prélèvement, eux, restent des
      // propriétés du prêt entier, affichées quel que soit le type.
      // Reconstruite entièrement à chaque appel plutôt que patchée : plus
      // simple que de fiddler avec l'affichage conditionnel d'un seul champ,
      // et la valeur affichée vient toujours de `loan` (jamais perdue au
      // changement de type).
      function renderLine2() {
        line2El.innerHTML = `
          <span class="prets-loan-line2-label">Taux</span>
          <input type="number" min="0" step="0.01" class="prets-loan-rate" placeholder="Taux (%)" value="${loan.rate ?? ''}">
          <span class="prets-loan-line2-label">Prél.</span>
          <input type="number" min="1" max="31" step="1" class="prets-loan-debit-day" placeholder="Jour" title="Jour de prélèvement (1-31)" value="${loan.debitDay ?? ''}">
          ${loan.paymentType === 'fixe' ? `
          <span class="prets-loan-line2-label">| Mensualité :</span>
          <input type="number" min="0" step="0.01" class="prets-loan-payment" placeholder="Mensualité €" value="${loan.monthlyPayment ?? ''}">
          ` : ''}
        `;

        // Taux (2026-08-31, déplacé ici depuis l'en-tête) — sa propre
        // écoute, indépendante de `syncHeader` ci-dessous qui ne scope plus
        // que `.prets-loan-config-header input` (l'en-tête n'a plus ce champ).
        line2El.querySelector('.prets-loan-rate').addEventListener('input', (e) => {
          loan.rate = parseFloat(e.target.value) || 0;
        });
        line2El.querySelector('.prets-loan-debit-day').addEventListener('input', (e) => {
          // 1-31 borné à la main : `max="31"` seul n'empêche pas de taper 45
          // au clavier (contrairement aux flèches natives), et une valeur
          // hors borne casserait silencieusement la comparaison
          // `now.getDate() < debitDay` dans prets.js (toujours vraie si > 31,
          // jamais si <= 0).
          const rawDebitDay = parseInt(e.target.value, 10);
          loan.debitDay = (rawDebitDay >= 1 && rawDebitDay <= 31) ? rawDebitDay : null;
        });
        line2El.querySelector('.prets-loan-payment')?.addEventListener('input', (e) => {
          loan.monthlyPayment = parseFloat(e.target.value) || 0;
        });
      }

      function renderBody() {
        if (loan.paymentType === 'paliers') {
          bodyEl.innerHTML = `
            <div class="prets-paliers-field">
              <div class="prets-paliers-header"><span>Début</span><span>Fin</span><span>Mensualité €</span><span></span></div>
              <div class="prets-paliers-list"></div>
              <button type="button" class="etf-add-line-btn prets-add-palier-btn">+ Ajouter un palier</button>
            </div>
          `;
          const paliersListEl = bodyEl.querySelector('.prets-paliers-list');
          const addPalierBtn = bodyEl.querySelector('.prets-add-palier-btn');
          renderPaliers(loan, paliersListEl, addPalierBtn);
          addPalierBtn.addEventListener('click', () => {
            if (loan.paliers.length >= MAX_PALIERS_PER_LOAN) return;
            loan.paliers.push({ startDate: '', endDate: '', monthlyPayment: 0 });
            renderPaliers(loan, paliersListEl, addPalierBtn);
          });
        } else {
          bodyEl.innerHTML = '';
        }
      }

      // Taux n'en fait plus partie (déplacé en ligne 2, voir renderLine2 —
      // sa propre écoute y est posée séparément) — cette fonction ne
      // synchronise plus que les 4 champs RÉELLEMENT dans l'en-tête.
      const syncHeader = () => {
        loan.name = box.querySelector('.prets-loan-name').value.trim();
        loan.amount = parseFloat(box.querySelector('.prets-loan-amount').value) || 0;
        loan.startDate = box.querySelector('.prets-loan-start').value;
        loan.endDate = box.querySelector('.prets-loan-end').value;
      };
      box.querySelectorAll('.prets-loan-config-header input').forEach(inp => inp.addEventListener('input', syncHeader));

      box.querySelector('.prets-loan-type').addEventListener('change', (e) => {
        loan.paymentType = e.target.value;
        renderLine2();
        renderBody();
      });

      box.querySelector('.prets-loan-delete').addEventListener('click', () => {
        const idx = loans.indexOf(loan);
        if (idx !== -1) loans.splice(idx, 1);
        renderLoans();
        syncAddBtn();
      });

      renderLine2();
      renderBody();
      listEl.appendChild(box);
    });
    collapsible?.refreshLabel();
  }

  function syncAddBtn() {
    const maxed = loans.length >= MAX_LOANS_PER_GROUP;
    addBtn.disabled = maxed;
    addBtn.title = maxed ? `Maximum de ${MAX_LOANS_PER_GROUP} prêts atteint` : '';
  }

  addBtn.addEventListener('click', () => {
    if (loans.length >= MAX_LOANS_PER_GROUP) return;
    loans.push({ name: '', amount: 0, rate: 0, startDate: '', endDate: '', debitDay: null, paymentType: 'fixe', monthlyPayment: 0, paliers: [] });
    renderLoans();
    syncAddBtn();
  });

  renderLoans();
  syncAddBtn();

  // Repliable (2026-08-16, sur demande explicite) — voir
  // wrapCollapsibleSection. `storeKey` inclut `key` (prets/prets_2..prets_5,
  // voir isPretsKey) : chaque GROUPE de prêts garde son propre état
  // replié/déplié indépendant des autres.
  collapsible = wrapCollapsibleSection(wrap, {
    storeKey: `app.configCollapsed.${key}.loans`,
    labelFor: () => `${loans.length} prêt${loans.length !== 1 ? 's' : ''} configuré${loans.length !== 1 ? 's' : ''}`,
    compact: true,
  });
  return collapsible.wrap;
}

// ─── Google Auth ──────────────────────────────────────────────────────────────
async function initGoogleSection() {
  let googleData = await window.matin.google.getToken();
  updateGoogleUI(googleData);

  const btnGoogle = document.getElementById('btnGoogle');

  btnGoogle.addEventListener('click', async () => {
    if (googleData?.accessToken) {
      await window.matin.google.logout();
      googleData = null;
      updateGoogleUI(null);
      return;
    }

    btnGoogle.disabled = true;
    updateGoogleUI(null, 'En attente d\'autorisation dans le navigateur…');

    try {
      googleData = await window.matin.google.login();
      updateGoogleUI(googleData);
    } catch (err) {
      console.error('[Google OAuth]', err);
      updateGoogleUI(null, 'Échec de la connexion Google. Réessayez.');
    } finally {
      btnGoogle.disabled = false;
    }
  });
}

// Action/détail SEUL (2026-09-01, 3e révision, sur demande explicite —
// "G Google — Déconnecter (email)") : `label` ne porte plus que "Connecter"/
// "Déconnecter (email)" (ou le message d'attente/d'erreur), le nom du
// service ("Google", statique) vit désormais dans le HTML juste avant, voir
// config.html `.profil-info-account-name`. `pill` (le conteneur
// `.profil-account-pill`, PAS le bouton lui-même) reçoit
// `.profil-info-connected`/`.profil-info-pending` (voir config.html) pour la
// couleur du bouton — vert connecté, jaune en attente d'autorisation/erreur
// (`statusOverride`), neutre sinon.
function updateGoogleUI(googleData, statusOverride) {
  const label = document.getElementById('googleLabel');
  const pill  = document.getElementById('accountPillGoogle');

  if (googleData?.accessToken) {
    label.textContent = `Déconnecter (${googleData.email || 'compte connecté'})`;
    if (pill) pill.title = 'Modules Agenda, Gmail et Tâches Google activés';
  } else {
    label.textContent = statusOverride || 'Connecter';
    if (pill) pill.title = 'Nécessaire pour les modules Agenda, Gmail et Tâches Google';
  }
  pill?.classList.toggle('profil-info-connected', !!googleData?.accessToken);
  pill?.classList.toggle('profil-info-pending', !googleData?.accessToken && !!statusOverride);
}

// ─── Spotify Auth ────────────────────────────────────────────────────────────
async function initSpotifySection() {
  let spotifyData = await window.matin.spotify.getToken();
  updateSpotifyUI(spotifyData);

  const btnSpotify = document.getElementById('btnSpotify');

  btnSpotify.addEventListener('click', async () => {
    if (spotifyData?.accessToken) {
      await window.matin.spotify.logout();
      spotifyData = null;
      updateSpotifyUI(null);
      return;
    }

    btnSpotify.disabled = true;
    updateSpotifyUI(null, 'En attente d\'autorisation dans le navigateur…');

    try {
      spotifyData = await window.matin.spotify.login();
      updateSpotifyUI(spotifyData);
    } catch (err) {
      console.error('[Spotify OAuth]', err);
      updateSpotifyUI(null, 'Échec de la connexion Spotify. Réessayez.');
    } finally {
      btnSpotify.disabled = false;
    }
  });
}

// ─── Sauvegardes (voir main.js writeLaunchBackup/backups:list/backups:restore,
// 2026-08-10, sur demande explicite) — un instantané daté par lancement, les
// 7 derniers conservés. La liste ne reste plus affichée en permanence sur la
// page (2e révision, même jour, sur demande explicite) : un bouton ouvre une
// popup, peuplée à la volée à CHAQUE ouverture (jamais au chargement de la
// page) pour toujours refléter les sauvegardes les plus récentes. Restaurer
// remplace TOUT le store (destructif), d'où la confirmation native avant
// d'appeler l'IPC, et un rechargement de CETTE fenêtre après coup (le
// dashboard se recharge de son côté via main.js, mainWindow.reload() — mais
// la fenêtre Paramètres, une BrowserWindow séparée, ne le reçoit pas
// automatiquement).
async function initBackupsSection() {
  const btnOpen = document.getElementById('btnBackups');
  const overlay = document.getElementById('backupsModalOverlay');
  const btnClose = document.getElementById('btnBackupsClose');
  if (!btnOpen || !overlay || !btnClose) return;

  const openModal = async () => {
    overlay.classList.add('open');
    await Promise.all([renderBackupsList(), renderDriveSection()]);
  };
  const closeModal = () => overlay.classList.remove('open');

  btnOpen.addEventListener('click', openModal);
  btnClose.addEventListener('click', closeModal);
  // Clic sur le fond (PAS sur la boîte elle-même) — même convention que les
  // autres overlays de l'app (ex. alertsBanner) : e.target === overlay
  // exclut tout clic remonté depuis .backups-modal ou ses enfants.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  initManualExportImport();
}

// ─── Export / Import manuel (2026-08-30, sur demande explicite, suite à
// l'incident de perte de données ETF/Crypto/Prêts) — même popup Sauvegardes,
// section séparée en bas (voir config.html .backups-manual-section). Portable
// PAR DESIGN (voir main.js backups:exportManual/importManual) : userdata
// seulement, jamais de token OAuth dans le fichier exporté.
function initManualExportImport() {
  const btnExport = document.getElementById('btnExportManual');
  const btnImport = document.getElementById('btnImportManual');
  if (!btnExport || !btnImport) return;

  const countsLabel = (counts) => Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${key} : ${n}`)
    .join(', ') || 'aucune';

  btnExport.addEventListener('click', async () => {
    btnExport.disabled = true;
    const original = btnExport.textContent;
    btnExport.textContent = 'Export…';
    try {
      const { filePath, counts } = await window.matin.backups.exportManual();
      const openIt = confirm(`Export réussi :\n${filePath}\n\nContenu : ${countsLabel(counts)}\n\nSauvegardez ce fichier sur une clé USB ou envoyez-le par email pour le garder en lieu sûr.\n\nOuvrir le dossier maintenant ?`);
      if (openIt) window.matin.shell.showItemInFolder(filePath);
    } catch (err) {
      alert(`Échec de l'export : ${err.message}`);
      console.error('[Config] Échec export manuel', err);
    } finally {
      btnExport.disabled = false;
      btnExport.textContent = original;
    }
  });

  btnImport.addEventListener('click', async () => {
    btnImport.disabled = true;
    const original = btnImport.textContent;
    btnImport.textContent = 'Import…';
    try {
      const result = await window.matin.backups.importManual();
      if (result.canceled) return;
      alert(`Import réussi : ${countsLabel(result.counts)}.\n\nLa fenêtre va se recharger.`);
      window.location.reload();
    } catch (err) {
      alert(`Échec de l'import : ${err.message}`);
      console.error('[Config] Échec import manuel', err);
    } finally {
      btnImport.disabled = false;
      btnImport.textContent = original;
    }
  });
}

async function renderBackupsList() {
  const listEl = document.getElementById('backupsList');
  if (!listEl) return;
  listEl.innerHTML = '<span class="backups-empty">Chargement…</span>';

  let backups;
  try {
    backups = await window.matin.backups.list();
  } catch (err) {
    listEl.innerHTML = '<span class="backups-empty">Sauvegardes indisponibles.</span>';
    console.error('[Config] Échec chargement des sauvegardes', err);
    return;
  }

  if (!backups.length) {
    listEl.innerHTML = '<span class="backups-empty">Aucune sauvegarde pour le moment.</span>';
    return;
  }

  // Affichage limité aux 3 plus récentes (2026-09-01, sur demande explicite)
  // — purement un plafond d'AFFICHAGE : `backups` vient déjà trié plus
  // récent d'abord (voir main.js listAllLocalUserdataBackups), et RIEN
  // n'est supprimé du disque ici, seules les 3 premières de cette liste
  // triée sont rendues. Les sauvegardes plus anciennes restent gérées comme
  // avant (rotation à 30 fichiers, restauration automatique au lancement,
  // etc.) — seule cette LISTE dans Paramètres en montre moins.
  const BACKUPS_LIST_DISPLAY_LIMIT = 3;
  const visibleBackups = backups.slice(0, BACKUPS_LIST_DISPLAY_LIMIT);

  // `data-date-label` (2026-08-31) porte le libellé de date SEUL, séparé du
  // HTML affiché dans .backups-date (qui peut désormais aussi contenir
  // l'étiquette "auto" — voir .backups-type-tag, config.html) : le message
  // de confirmation ci-dessous doit rester juste la date, pas "…auto" collé
  // au bout si on lisait .textContent directement.
  listEl.innerHTML = visibleBackups.map(b => {
    const dateLabel = new Date(b.mtimeMs).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    const typeTag = b.type === 'change' ? '<span class="backups-type-tag">auto</span>' : '';
    return `
    <div class="backups-row" data-file="${b.file}" data-date-label="${dateLabel}">
      <span class="backups-date">${dateLabel}${typeTag}</span>
      <button type="button" class="backups-restore-btn etf-add-line-btn">Restaurer</button>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.backups-restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.backups-row');
      const file = row.dataset.file;
      const dateLabel = row.dataset.dateLabel;
      if (!confirm(`Restaurer la sauvegarde du ${dateLabel} ?\n\nTOUTES les données actuelles (ETF, Crypto, Prêts, Podcasts, FDJ, réglages...) seront remplacées par celles de cette sauvegarde.`)) return;

      btn.disabled = true;
      btn.textContent = 'Restauration…';
      try {
        await window.matin.backups.restore(file);
        window.location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Restaurer';
        alert(`Échec de la restauration : ${err.message}`);
        console.error('[Config] Échec restauration', err);
      }
    });
  });
}

// ─── Section "☁️ Google Drive" (2026-08-31, sur demande explicite, même
// popup Sauvegardes) — interroge Drive EN DIRECT à chaque ouverture de la
// popup (main.js driveSync:getInfo), affiche la dernière modification du
// fichier distant, et propose une restauration FORCÉE (driveSync:
// forceRestore) qui écrase le local avec le contenu de Drive SANS comparer
// les horodatages — différent de la sync automatique de lancement, qui elle
// ne restaure que si Drive est réellement plus récent.
async function renderDriveSection() {
  const el = document.getElementById('backupsDriveSection');
  if (!el) return;
  el.innerHTML = '<span class="backups-empty">Chargement…</span>';

  let info;
  try {
    info = await window.matin.driveSync.getInfo();
  } catch (err) {
    el.innerHTML = '<span class="backups-empty">Statut Google Drive indisponible.</span>';
    console.error('[Config] Échec chargement statut Drive', err);
    return;
  }

  if (!info.connected) {
    el.innerHTML = '<span class="backups-empty">Aucun compte Google connecté (Paramètres → Compte Google).</span>';
    return;
  }
  if (info.error) {
    el.innerHTML = `<span class="backups-empty">Drive indisponible : ${info.error}</span>`;
    return;
  }

  const dateLabel = info.modifiedTime
    ? new Date(info.modifiedTime).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  el.innerHTML = `
    <div class="backups-row backups-drive-row">
      <span class="backups-date">${dateLabel ? `Dernière modification sur Drive : ${dateLabel}` : 'Aucune sauvegarde sur Drive pour le moment'}</span>
      <button type="button" class="backups-restore-btn etf-add-line-btn" id="btnDriveForceRestore" ${dateLabel ? '' : 'disabled'}>Restaurer depuis Drive</button>
    </div>`;

  document.getElementById('btnDriveForceRestore')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!confirm('Restaurer depuis Google Drive ?\n\nTOUTES les données actuelles (ETF, Crypto, Prêts, Podcasts, FDJ, réglages...) seront remplacées par celles de Drive — même si votre version locale est plus récente.')) return;

    btn.disabled = true;
    btn.textContent = 'Restauration…';
    try {
      await window.matin.driveSync.forceRestore();
      window.location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Restaurer depuis Drive';
      alert(`Échec de la restauration Drive : ${err.message}`);
      console.error('[Config] Échec restauration forcée Drive', err);
    }
  });
}

// ─── Personnaliser — fond du dashboard (2026-08-11, sur demande explicite) ──
// Même popup overlay que Sauvegardes ci-dessus. Les options sombres/claires
// sont mutuellement exclusives (gated par le thème ACTUEL, relu à CHAQUE
// ouverture de la popup — l'utilisateur a pu basculer le thème depuis la
// dernière ouverture), "Aucun fond" toujours proposée en 1er. La sélection
// s'applique tout de suite (window.matin.background.set), PAS via le bouton
// "Enregistrer" général de Paramètres : cohérent avec le thème clair/sombre
// (voir initThemeToggle), qui applique déjà instantanément lui aussi.
const PERSONNALISER_OPTIONS = [
  { key: 'none',      emoji: '🚫', label: 'Aucun fond', theme: null },
  { key: 'stars',     emoji: '⭐', label: 'Fond étoilé', theme: 'dark' },
  { key: 'aurora',    emoji: '🌌', label: 'Aurore boréale', theme: 'dark' },
  { key: 'particles', emoji: '✨', label: 'Particules flottantes', theme: 'dark' },
  { key: 'rain',      emoji: '🌧️', label: 'Pluie', theme: 'dark' },
  { key: 'snow',      emoji: '❄️', label: 'Neige', theme: 'dark' },
  { key: 'matrix',    emoji: '💊', label: 'Matrix', theme: 'dark' },
  { key: 'nebula',    emoji: '🌌', label: 'Nébuleuse', theme: 'dark' },
  { key: 'beach',     emoji: '🏖️', label: 'Plage au lever du soleil', theme: 'dark' },
  { key: 'mountain',  emoji: '🏔️', label: 'Lever de soleil en montagne', theme: 'dark' },
  { key: 'paper',     emoji: '📄', label: 'Grain de papier', theme: 'light' },
  { key: 'geometric', emoji: '📐', label: 'Lignes géométriques', theme: 'light' },
  { key: 'gradient',  emoji: '🌫️', label: 'Dégradé doux', theme: 'light' },
];

async function initPersonnaliserSection() {
  const btnOpen = document.getElementById('btnPersonnaliser');
  const overlay = document.getElementById('personnaliserModalOverlay');
  const btnClose = document.getElementById('btnPersonnaliserClose');
  if (!btnOpen || !overlay || !btnClose) return;

  const openModal = async () => {
    overlay.classList.add('open');
    await renderPersonnaliserOptions();
    await renderDisplayModeOptions();
  };
  const closeModal = () => overlay.classList.remove('open');

  btnOpen.addEventListener('click', openModal);
  btnClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
}

async function renderPersonnaliserOptions() {
  const container = document.getElementById('personnaliserOptions');
  if (!container) return;

  const currentTheme = document.documentElement.dataset.colorScheme === 'light' ? 'light' : 'dark';
  const current = (await window.matin.store.get('app.background')) || 'none';

  const visible = PERSONNALISER_OPTIONS.filter(opt => opt.theme === null || opt.theme === currentTheme);
  container.innerHTML = visible.map(opt => `
    <button type="button" class="personnaliser-option ${opt.key === current ? 'selected' : ''}" data-key="${opt.key}">
      <div class="personnaliser-thumb personnaliser-thumb-${opt.key}"></div>
      <span class="personnaliser-option-label">${opt.emoji} ${opt.label}</span>
    </button>`).join('');

  container.querySelectorAll('.personnaliser-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      await window.matin.background.set(key);
      container.querySelectorAll('.personnaliser-option').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });
}

// ─── Mode d'affichage — Icône flottante (2026-08-23, sur demande explicite ;
// "Volet latéral" SUPPRIMÉ ENTIÈREMENT le 2026-09-01, sur demande explicite,
// voir CONTEXT.md) — même popup Personnaliser, section distincte sous la
// grille de fonds. S'applique instantanément au clic (window.matin.
// displayMode.set), comme le fond ci-dessus — pas de bouton "Enregistrer"
// dédié. Voir main.js applyDisplayMode pour l'effet réel (2e fenêtre/
// repositionnement de mainWindow).
const DISPLAY_MODE_OPTIONS = [
  { key: 'fullscreen', emoji: '🖥️', label: 'Plein écran' },
  { key: 'floating',   emoji: '☀️', label: 'Icône flottante' },
];

async function renderDisplayModeOptions() {
  const container = document.getElementById('displayModeOptions');
  if (!container) return;

  const current = (await window.matin.store.get('app.displayMode')) || 'fullscreen';

  container.innerHTML = DISPLAY_MODE_OPTIONS.map(opt => `
    <button type="button" class="display-mode-option ${opt.key === current ? 'selected' : ''}" data-key="${opt.key}">
      <span class="display-mode-option-icon">${opt.emoji}</span>
      <span class="display-mode-option-label">${opt.label}</span>
    </button>`).join('');

  container.querySelectorAll('.display-mode-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      await window.matin.displayMode.set(key);
      container.querySelectorAll('.display-mode-option').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });
}

// Défilement automatique — SUPPRIMÉ ENTIÈREMENT le 2026-09-01, sur demande
// explicite (voir CONTEXT.md) : `renderAutoScrollOptions` et son toggle dans
// la popup Affichage retirés.

// Action/détail SEUL (2026-09-01, 3e révision, sur demande explicite) — même
// principe que updateGoogleUI ci-dessus.
function updateSpotifyUI(spotifyData, statusOverride) {
  const label = document.getElementById('spotifyLabel');
  const pill  = document.getElementById('accountPillSpotify');

  if (spotifyData?.accessToken) {
    label.textContent = `Déconnecter (${spotifyData.email || spotifyData.displayName || 'compte connecté'})`;
    if (pill) pill.title = 'Module Spotify activé';
  } else {
    label.textContent = statusOverride || 'Connecter';
    if (pill) pill.title = 'Nécessaire pour le module Spotify';
  }
  pill?.classList.toggle('profil-info-connected', !!spotifyData?.accessToken);
  pill?.classList.toggle('profil-info-pending', !spotifyData?.accessToken && !!statusOverride);
}

// ─── Sauvegarde ──────────────────────────────────────────────────────────────
async function saveConfig() {
  const firstName = document.getElementById('firstNameInput').value.trim();
  await window.matin.store.set('app.firstName', firstName);

  await window.matin.modules.update(modulesState);

  const notice = document.getElementById('saveNotice');
  notice.classList.add('show');
  setTimeout(() => notice.classList.remove('show'), 2500);
}

// ─── Lancement ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initConfig);
