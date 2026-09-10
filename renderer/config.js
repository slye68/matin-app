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
  priceTracking: { label: 'Liste de souhaits', icon: '🛒', requiresGoogle: false, priceTrackingField: true },
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
  prets: { label: 'Mon Prêt',   icon: '🏠', requiresGoogle: false,
           configField: { key: 'name', label: 'Nom du groupe', placeholder: 'Résidence principale' },
           pretsLoansField: true },
  // LIVE FOOT! (2026-08-11, sur demande explicite) — voir renderer/modules/
  // live.js. `liveField` déclenche renderLiveConfigSection (mode Équipe/
  // Compétition, réécrit le 2026-09-04 — voir live.js), même mécanisme que
  // `alertsField` pour département/types. Renommé "LIVE!" → "LIVE FOOT!" le
  // 2026-09-01 (2e demande explicite, libellé affiché uniquement — la clé
  // interne `live` reste inchangée, voir dashboard.js MODULE_REGISTRY.live).
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

// Moteur de recherche du titlebar (2026-09-03, sur demande explicite) — même
// principe que startOnBootEnabled ci-dessus : pas un module, réglage système
// unique (`app.searchEngine`, voir main.js MODULE_DEFAULTS.app et
// dashboard.js initTitlebarSearch), chargé une fois dans initConfig AVANT le
// 1er renderTabPanels pour que le <select> reflète la valeur réelle dès
// l'ouverture (voir createSearchEngineRow plus bas).
let searchEngineValue = window.SearchEngines.DEFAULT;

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
// (YouTube jusqu'à 20 chaînes, ETF/Crypto jusqu'à N lignes de portefeuille,
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

// ─── Menu déroulant Équipe : ligue → équipe (2026-09-05, sur demande
// explicite, remplace la saisie en texte libre) ────────────────────────────
// Liste des ligues connues (KNOWN_LEAGUES) définie dans ol.js — exposée via
// `window.MatinModules.olKnownLeagues` (ol.js chargé avant ce fichier, voir
// config.html) plutôt que dupliquée ici : ol.js a besoin de la même liste
// pour son thème de carte (olThemeForCategory), une seule source de vérité
// pour les 2 fichiers.
function sportsLeagueOptionsHtml(selectedValue) {
  const leagues = window.MatinModules?.olKnownLeagues || [];
  const bySport = new Map();
  for (const l of leagues) {
    if (!bySport.has(l.sport)) bySport.set(l.sport, []);
    bySport.get(l.sport).push(l);
  }
  const groupsHtml = Array.from(bySport.entries()).map(([sport, list]) => `
    <optgroup label="${window.SportsSources.CATEGORY_LABELS[sport] || sport}">
      ${list.map(l => `<option value="${l.value}" ${l.value === selectedValue ? 'selected' : ''}>${l.label}</option>`).join('')}
    </optgroup>
  `).join('');
  return `
    ${groupsHtml}
    <option disabled>──────────</option>
    <option value="__custom__" ${selectedValue === '__custom__' ? 'selected' : ''}>✏️ Autre équipe (texte libre)</option>
  `;
}

// Liste des équipes d'une ligue — ESPN `.../teams` (2026-09-06, sur demande
// explicite, BUG 1 — remplace TheSportsDB `search_all_teams.php`, dont la clé
// démo gratuite ("3") PLAFONNE SILENCIEUSEMENT à 10 équipes par championnat,
// quel que soit son effectif réel : vérifié en direct, Ligue 1 (18 clubs) et
// Ligue 2 (20 clubs) n'affichaient jamais que les 10 premières par ordre
// alphabétique. `site.api.espn.com/apis/site/v2/sports/{sportPath}/{slug}/teams`
// N'A PAS cette limite (confirmé en direct : liste complète pour fra.1/fra.2/
// fra.lnb/nba, voir `espnSportPath`/`espnSlug` dans KNOWN_LEAGUES/ol.js).
// Passe par `rss:fetchFeed` (comme tous les autres appels ESPN de ce module,
// voir ol.js espnFindTeam/fetchEspnSchedule) — site.api.espn.com n'envoie
// aucun en-tête CORS, un fetch direct échouerait silencieusement dans ce
// renderer. Mise en cache 7 jours dans localStorage — cette liste ne change
// quasiment jamais d'un jour à l'autre (mercato mis à part), pas de raison de
// la re-télécharger à chaque ouverture de Paramètres. Clé de cache RENOMMÉE
// (`matin-espn-teams-` au lieu de `matin-teams-`) délibérément : un ancien
// cache écrit par TheSportsDB (plafonné à 10, voir ci-dessus) resterait
// servi jusqu'à 7 jours sans ce changement de clé, reproduisant le bug que
// ce correctif est censé éliminer immédiatement.
//
// Résultat SANS idTeam TheSportsDB (contrairement à l'ancienne version) —
// ESPN a son propre espace d'identifiants, sans rapport avec celui de
// TheSportsDB (eventslast.php/eventsnext.php/lookupteam.php, voir ol.js,
// tous keyés par idTeam TheSportsDB) : stocker l'id ESPN directement dans
// `config.idTeam` casserait ces 3 appels pour CHAQUE équipe choisie dans ce
// menu. Voir resolveTheSportsDbIdTeam ci-dessous, qui résout le VRAI idTeam
// TheSportsDB par nom UNE SEULE FOIS, au moment où l'utilisateur choisit une
// équipe précise (pas ici, à la construction de la liste) — le nom ESPN
// (exact, jamais tronqué par un plafond) sert alors de requête fiable,
// contrairement à un nom tapé à la main.
const SPORTS_TEAMS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Betclic Élite (LNB) — liste statique en dur (2026-09-04, sur demande
// explicite) : AUCUNE API fiable ne couvre ce championnat en pratique —
// TheSportsDB "French LNB" (voir KNOWN_LEAGUES/ol.js) et le slug ESPN
// `fra.lnb` renseigné pour ce championnat retombent tous les deux sur une
// liste vide, laissant le menu "Équipe" vide malgré une ligue bien
// sélectionnée. Vérifié en LISANT le code plutôt qu'en relançant l'app
// (aucune instance Electron disponible dans cet environnement) : la valeur
// exacte de l'option <select> pour cette ligue est CONFIRMÉE `'betclic.
// elite'`, littéralement `value: 'betclic.elite'` dans KNOWN_LEAGUES
// (ol.js) — utilisée directement comme `option.value` par
// sportsLeagueOptionsHtml plus haut, donc fiable sans avoir besoin d'un
// log temporaire à l'exécution pour la confirmer une 2e fois.
// `theSportsDbId` (2026-09-08, sur demande explicite) — id TheSportsDB
// CONFIRMÉ À LA MAIN pour 4 clubs jusqu'ici ; `null` pour les autres (pas
// encore vérifiés) — voir teamSelect 'change' plus bas (STEP 2) et ol.js
// render() (STEP 3, court-circuite lookupteam.php ET searchteams.php quand
// cet id est déjà connu).
const BETCLIC_ELITE_TEAMS = [
  { id: 'asvel',      displayName: 'ASVEL Villeurbanne',    theSportsDbId: null },
  { id: 'cholet',     displayName: 'Cholet Basket',         theSportsDbId: null },
  { id: 'dijon',      displayName: 'JDA Dijon',             theSportsDbId: null },
  { id: 'fos',        displayName: 'Fos Provence Basket',   theSportsDbId: null },
  { id: 'gravelines', displayName: 'Gravelines-Dunkerque',  theSportsDbId: '135239' },
  { id: 'jlbourg',    displayName: 'Bourg-en-Bresse',       theSportsDbId: '135234' },
  { id: 'lemans',     displayName: 'Le Mans Sarthe Basket', theSportsDbId: null },
  { id: 'limoges',    displayName: 'Limoges',               theSportsDbId: '135242' },
  { id: 'metro92',    displayName: 'Metropolitans 92',      theSportsDbId: null },
  { id: 'monaco',     displayName: 'Monaco Basket',         theSportsDbId: null },
  { id: 'nancy',      displayName: 'SLUC Nancy',            theSportsDbId: null },
  { id: 'nanterre',   displayName: 'Nanterre 92',           theSportsDbId: null },
  { id: 'paris',      displayName: 'Paris Basketball',      theSportsDbId: null },
  { id: 'orthez',     displayName: 'Élan Béarnais',         theSportsDbId: '135248' },
  { id: 'roanne',     displayName: 'Chorale de Roanne',     theSportsDbId: null },
  { id: 'strasbourg', displayName: 'SIG Strasbourg',        theSportsDbId: null },
].sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

async function fetchLeagueTeams(league) {
  // Branche AU TOUT DÉBUT, avant le cache/tout appel réseau — même forme
  // `{ strTeam }` que le résultat ESPN normal plus bas (voir
  // sportsTeamOptionsHtml, seul appelant : aucun changement nécessaire côté
  // consommateur pour ce cas particulier). Pas de mise en cache
  // localStorage ici : c'est déjà une liste statique instantanée, la cacher
  // n'apporterait rien et risquerait de figer une future correction de
  // cette même liste derrière un TTL de 7 jours pour rien.
  if (league.value === 'betclic.elite') {
    console.log(`[Config] Équipes ${league.value} — liste statique en dur (${BETCLIC_ELITE_TEAMS.length}), aucune API fiable pour ce championnat`);
    // `theSportsDbId` transmis tel quel (STEP 1) — porté par `{ strTeam }`
    // comme un champ additionnel, voir sportsTeamOptionsHtml plus bas (STEP 2)
    // qui le pose en `data-thesportsdbid` sur chaque <option>.
    return BETCLIC_ELITE_TEAMS.map(t => ({ strTeam: t.displayName, theSportsDbId: t.theSportsDbId }));
  }

  const cacheKey = `matin-espn-teams-${league.value}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && (Date.now() - cached.fetchedAt) < SPORTS_TEAMS_CACHE_TTL_MS) {
      console.log(`[Config] Équipes ${league.value} servies depuis le cache (${Math.round((Date.now() - cached.fetchedAt) / 3600000)} h)`);
      return cached.teams;
    }
  } catch (err) {
    console.warn(`[Config] Cache équipes ${league.value} illisible, re-téléchargement`, err);
  }

  const url = `http://site.api.espn.com/apis/site/v2/sports/${league.espnSportPath}/${league.espnSlug}/teams`;
  const raw = await window.matin.rss.fetchFeed(url);
  const data = JSON.parse(raw);
  console.log(`[Config] ${url} →`, data);
  const teams = (data.sports?.[0]?.leagues?.[0]?.teams || [])
    .map(t => ({ strTeam: t.team?.displayName || '' }))
    .filter(t => t.strTeam)
    .sort((a, b) => a.strTeam.localeCompare(b.strTeam, 'fr'));

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), teams }));
  } catch (err) {
    console.warn(`[Config] Échec mise en cache des équipes ${league.value}`, err);
  }
  return teams;
}

// Résout l'idTeam TheSportsDB d'une équipe PAR SON NOM EXACT (2026-09-06, sur
// demande explicite, BUG 1) — appelée UNE SEULE FOIS, au moment où
// l'utilisateur choisit une équipe précise dans le menu déroulant (voir
// teamSelect plus bas), jamais à la construction de la liste elle-même (voir
// fetchLeagueTeams ci-dessus, désormais purement ESPN). `searchteams.php`
// (recherche PAR NOM, pas une liste complète) n'a pas le même plafond de 10
// que `search_all_teams.php` — safe à réutiliser ici. Override PSG (voir
// CLUB_ID_OVERRIDES/olResolveClubIdOverride, ol.js, BUG 3) appliqué EN
// PREMIER, avant tout appel réseau : le nom ESPN d'un club ne garantit pas à
// lui seul que TheSportsDB renvoie le bon idTeam pour ce même club (PSG en
// est la preuve directe) — une seule source de vérité pour cet override,
// partagée avec la saisie en texte libre (voir ol.js fetchTeamId).
async function resolveTheSportsDbIdTeam(name) {
  const override = window.MatinModules?.olResolveClubIdOverride?.(name);
  if (override) {
    console.log(`[Config] idTeam forcé (override connu) pour "${name}" : ${override.idTeam} — recherche TheSportsDB par nom ignorée`);
    return override.idTeam;
  }
  const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Recherche équipe KO (${res.status})`);
  const data = await res.json();
  console.log(`[Config] searchteams.php?t=${encodeURIComponent(name)} →`, data);
  const found = data.teams?.[0];
  if (!found) throw new Error(`Équipe "${name}" introuvable sur TheSportsDB`);
  return found.idTeam;
}

// `selectedName` (2026-09-06) remplace `selectedIdTeam` — la liste elle-même
// ne porte plus d'idTeam TheSportsDB (voir fetchLeagueTeams ci-dessus), donc
// plus rien à comparer par id ; le NOM (déjà persisté dans `cfg.team` depuis
// la dernière sélection) reste un identifiant stable d'une réouverture de
// Paramètres à l'autre pour ré-présélectionner la bonne option.
function sportsTeamOptionsHtml(teams, league, selectedName) {
  // `data-thesportsdbid` (2026-09-08, STEP 2) — vide pour toute équipe SANS
  // id confirmé à la main (résultat ESPN normal, ou entrée Betclic Élite pas
  // encore vérifiée, voir BETCLIC_ELITE_TEAMS) : le <select> 'change' plus
  // bas retombe alors sur resolveTheSportsDbIdTeam (recherche réseau par
  // nom), comportement inchangé pour ces équipes-là.
  const options = teams.map(t => `
    <option value="${t.strTeam}" data-name="${t.strTeam}" data-sport="${league.sport}" data-thesportsdbid="${t.theSportsDbId || ''}" ${t.strTeam === selectedName ? 'selected' : ''}>${t.strTeam}</option>
  `).join('');
  // Placeholder désactivé en tête (2026-09-05) — sélectionné par défaut tant
  // qu'aucune équipe de CETTE liste ne correspond à `selectedName` (ex.
  // ligue tout juste changée) : un <select> natif sans `selected` explicite
  // retombe sur sa 1re option, qui serait sinon une VRAIE équipe choisie à
  // tort en silence plutôt que de forcer un choix explicite de l'utilisateur.
  const hasSelection = teams.some(t => t.strTeam === selectedName);
  return `<option value="" ${hasSelection ? '' : 'selected'} disabled>— Choisir une équipe —</option>${options}`;
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

// ─── Instances multiples (module LIVE FOOT!) ────────────────────────────────
// Même principe que Sports/Prêts ci-dessus, plafonné à 2 (voir
// dashboard.js isLiveKey/MAX_LIVE_INSTANCES) : "live" garde la clé de base,
// "live_2" est la seule instance supplémentaire possible — chaque carte
// suit sa propre compétition (config.competitionSlug/competitionLabel, voir
// renderLiveConfigSection), aucun état partagé entre les 2.
const MAX_LIVE_INSTANCES = 2;

function isLiveKey(key) {
  return key === 'live' || key === 'live_2';
}

function addLiveInstance() {
  const count = Object.keys(modulesState).filter(isLiveKey).length;
  if (count >= MAX_LIVE_INSTANCES) return;

  const positions = Object.values(modulesState).map(m => m.position);
  const nextPosition = positions.length ? Math.max(...positions) + 1 : 0;

  modulesState.live_2 = { enabled: true, position: nextPosition, config: { competitionSlug: 'fra.1', competitionLabel: 'Ligue 1' } };
  renderTabPanels();
}

function removeLiveInstance(key) {
  delete modulesState[key];
  renderTabPanels();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function initConfig() {
  modulesState = await window.matin.modules.getAll();
  // Lu AVANT le 1er renderTabPanels (voir createStartOnBootRow) pour que le
  // switch reflète l'état réel dès l'ouverture de Paramètres.
  startOnBootEnabled = (await window.matin.store.get('app.startOnBoot')) === true;
  // Lu AVANT le 1er renderTabPanels (voir createSearchEngineRow) pour la même
  // raison que startOnBootEnabled ci-dessus.
  searchEngineValue = (await window.matin.store.get('app.searchEngine')) || window.SearchEngines.DEFAULT;

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

  // Mode démo (2026-09-10, voir renderer/demo-mode.js runDemoLight, piloté
  // depuis le dashboard via preload.js demo.configTab/configClickBtn →
  // main.js → ici) — même pattern que theme.onUpdated ci-dessus
  // (ipcRenderer.on, pas de namespace onIpc générique dans ce projet).
  window.matin.demo?.onSetTab((tabId) => setActiveTab(tabId));
  window.matin.demo?.onClickBtn((btnId) => document.getElementById(btnId)?.click());
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

  // ℹ️ "Utilisation sur plusieurs PC" (2026-09-03, sur demande explicite) —
  // bouton statique (pas régénéré par refreshProfileTabs), écouteur posé une
  // seule fois ici comme le reste de l'init de cette section.
  document.getElementById('profilesInfoBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showProfilesInfoPopup(e.currentTarget);
  });

  document.getElementById('fondInfoBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showFondInfoPopup(e.currentTarget);
  });
}

// Réutilise le même popover que showPriceTrackingInfoPopup ci-dessus (.price-
// tracking-info-popup/-title/-warning, seul autre point d'info de ce
// fichier) plutôt que d'en dupliquer un — voir .profiles-info-btn dans
// config.html.
function showProfilesInfoPopup(anchorEl) {
  document.getElementById('priceTrackingInfoPopup')?.remove();
  document.getElementById('profilesInfoPopup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'profilesInfoPopup';
  popup.className = 'price-tracking-info-popup';
  popup.innerHTML = `
    <div class="price-tracking-info-warning" style="margin-bottom:6px;">📌 Ici, je mémorise mes modules sur un profil !</div>
    <div class="price-tracking-info-title">💡 Utilisation sur plusieurs PC</div>
    <div class="price-tracking-info-warning">Si vous utilisez Matin sur plusieurs PC, nous vous recommandons d'utiliser 1 profil par appareil (ex. « Bureau » sur votre PC fixe, « Portable » sur votre laptop).</div>
  `;
  document.body.appendChild(popup);

  const rect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popupRect.width - 8))}px`;

  const closeOnOutsideClick = (e) => {
    if (popup.contains(e.target)) return;
    popup.remove();
    document.removeEventListener('click', closeOnOutsideClick, true);
  };
  setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);
}

function showFondInfoPopup(anchorEl) {
  document.getElementById('priceTrackingInfoPopup')?.remove();
  document.getElementById('profilesInfoPopup')?.remove();
  document.getElementById('fondInfoPopup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'fondInfoPopup';
  popup.className = 'price-tracking-info-popup';
  popup.innerHTML = `
    <div class="price-tracking-info-warning">💾 Pensez à enregistrer votre profil après chaque modification pour conserver le fond d'écran associé.</div>
  `;
  document.body.appendChild(popup);

  const rect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popupRect.width - 8))}px`;

  const closeOnOutsideClick = (e) => {
    if (popup.contains(e.target)) return;
    popup.remove();
    document.removeEventListener('click', closeOnOutsideClick, true);
  };
  setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);
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
    // Moteur de recherche (2026-09-03, sur demande explicite) — même
    // principe : pas une entrée TAB_MODULE_ORDER, reconstruit en tête de
    // l'onglet Services à chaque appel (voir createSearchEngineRow).
    if (tab.id === 'services') {
      panel.appendChild(createSearchEngineRow());
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
      if (entry === 'live') {
        Object.keys(modulesState)
          .filter(isLiveKey)
          .sort((a, b) => (modulesState[a].position ?? 0) - (modulesState[b].position ?? 0))
          .forEach((key) => {
            const meta = MODULE_META[key] ?? MODULE_META.live;
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

// ─── Moteur de recherche (2026-09-03, sur demande explicite) ───────────────
// Même principe que createStartOnBootRow ci-dessus (pas un module, appliqué
// immédiatement au changement — pas de bouton "Enregistrer" dédié) mais un
// <select> plutôt qu'un toggle. Catalogue partagé avec le titlebar via
// window.SearchEngines (voir modules/search-engines.js et dashboard.js
// initTitlebarSearch, qui lit `app.searchEngine` à chaque recherche).
function createSearchEngineRow() {
  const wrapper = document.createElement('div');
  wrapper.className = 'module-row-wrap';

  const optionsHtml = window.SearchEngines.OPTIONS
    .map(opt => `<option value="${opt.id}" ${opt.id === searchEngineValue ? 'selected' : ''}>${opt.emoji} ${opt.label}</option>`)
    .join('');

  const row = document.createElement('div');
  row.className = 'module-row';
  row.innerHTML = `
    <span class="module-row-icon">🔍</span>
    <span class="module-row-name">Moteur de recherche</span>
    <select class="search-engine-select">${optionsHtml}</select>
  `;
  row.querySelector('.search-engine-select').addEventListener('change', (e) => {
    searchEngineValue = e.target.value;
    window.matin.store.set('app.searchEngine', searchEngineValue);
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

  // Boutons +/× d'instance — généralisés à Sports, Prêts ET LIVE FOOT!
  // (2026-08-08, étendu 2026-09-05), même principe pour les trois : le
  // bouton "+" ne vit que sur la clé de base ('ol'/'prets'/'live'), le "×"
  // sur les instances ajoutées uniquement.
  const showAddInstance = key === 'ol' || key === 'prets' || key === 'live';
  const showDelete = (isSportsKey(key) && key !== 'ol') || (isPretsKey(key) && key !== 'prets') || (isLiveKey(key) && key !== 'live');
  const sportsMaxed = Object.keys(modulesState).filter(isSportsKey).length >= MAX_SPORTS_INSTANCES;
  const pretsMaxed = Object.keys(modulesState).filter(isPretsKey).length >= MAX_PRETS_INSTANCES;
  const liveMaxed = Object.keys(modulesState).filter(isLiveKey).length >= MAX_LIVE_INSTANCES;
  const maxedOut = key === 'prets' ? pretsMaxed : key === 'live' ? liveMaxed : sportsMaxed;
  const addTitle = key === 'prets'
    ? (pretsMaxed ? 'Maximum de 5 groupes atteint' : 'Ajouter un groupe')
    : key === 'live'
      ? (liveMaxed ? 'Maximum de 2 directs atteint' : 'Ajouter un direct')
      : (sportsMaxed ? 'Maximum de 5 équipes atteint' : 'Ajouter une équipe');
  const deleteTitle = isPretsKey(key) ? 'Supprimer ce groupe' : isLiveKey(key) ? 'Supprimer ce direct' : 'Supprimer cette équipe';

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
  // Sport, groupe de prêts ou direct LIVE FOOT! selon la clé)
  row.querySelector('.row-add-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (key === 'prets') addPretsInstance();
    else if (key === 'live') addLiveInstance();
    else addSportsInstance();
  });

  // Supprimer cette instance (instances ajoutées uniquement, jamais l'originale)
  row.querySelector('.row-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPretsKey(key)) removePretsInstance(key);
    else if (isLiveKey(key)) removeLiveInstance(key);
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
  // Sélecteur de ligue (Sports uniquement, voir isSportsKey ci-dessous) et
  // fonction de (re)chargement de sa liste d'équipes — déclarés ICI (portée
  // de toute la fonction) car lus depuis le bloc "Sources" plus bas (2 blocs
  // `if` séparés mais même portée), qui doit savoir si l'instance est en
  // mode "ligue connue" (charge les équipes) ou "Autre équipe" (texte libre,
  // comportement d'origine) pour déclencher le bon chargement initial.
  let leagueSelect = null;
  let activateLeagueMode = () => {};
  // `statusEl`/`listEl` (bloc "Sources" plus bas) déclarés ICI aussi
  // (`let`, pas `const`) — `activateLeagueMode` ci-dessus est DÉFINIE dans
  // le bloc configField (plus haut) mais seulement APPELÉE depuis le bloc
  // "Sources", qui crée `statusEl`/`listEl` : une closure ne voit que les
  // variables de sa propre chaîne de portées lexicales, pas celles d'un
  // bloc `{ }` frère déclarées APRÈS coup avec `const` — sans cette
  // remontée à la portée de toute la fonction, `activateLeagueMode` lèverait
  // `statusEl is not defined` dès son 1er appel malgré l'ordre d'exécution
  // correct (le bloc Sources tourne bien avant, mais ça ne suffit pas : seule
  // la PORTÉE compte pour une closure, pas l'ordre d'exécution).
  let statusEl = null;
  let listEl = null;
  // `refreshSources` (bloc "Sources" plus bas) — même remontée de portée que
  // `statusEl`/`listEl` ci-dessus, pour la même raison : appelée depuis les
  // écouteurs `leagueSelect`/`teamSelect` (bloc configField, plus haut) qui
  // ont besoin de la fonction RÉELLE, pas seulement de sa déclaration
  // `function` (contrairement à `statusEl`/`listEl`, une déclaration
  // `function` DANS un bloc remonte parfois automatiquement à la portée
  // englobante en mode non strict — vérifié empiriquement ICI que ce n'est
  // PAS le cas dans ce script, `refreshSources` reste bien invisible hors de
  // son bloc sans cette remontée explicite).
  let refreshSources = async () => {};
  // Badge "Bêta" (à côté du sélecteur) + note Basketball (sous le champ) —
  // 2026-09-01, sur demande explicite : réassignée plus bas (voir
  // meta.configField), appelée aussi depuis le listener `change` du
  // sélecteur un peu plus loin dans cette même fonction (2 blocs `if`
  // séparés mais même portée de fonction).
  let updateSportExtras = () => {};

  if (meta.configField) {
    const field = meta.configField;
    const currentValue = mod.config?.[field.key] ?? field.placeholder ?? '';

    if (isSportsKey(key)) {
      // ── Sports : menu déroulant ligue → équipe (2026-09-05, sur demande
      // explicite, remplace la saisie en texte libre par un choix guidé) —
      // voir KNOWN_LEAGUES (ol.js)/sportsLeagueOptionsHtml/fetchLeagueTeams
      // plus haut dans ce fichier. Repli "Autre équipe" (texte libre + le
      // même sélecteur de sport manuel qu'avant, comportement D'ORIGINE
      // inchangé dans ce mode) quand la ligue choisie n'est pas dans
      // KNOWN_LEAGUES — couvre à la fois le choix explicite "✏️ Autre
      // équipe" ET toute config déjà enregistrée AVANT ce menu déroulant
      // (`manualLeague` absent/inconnu), qui continue de fonctionner
      // exactement comme avant, sans migration forcée.
      if (!modulesState[key].config) modulesState[key].config = {};
      const cfg = modulesState[key].config;
      const knownLeagues = window.MatinModules?.olKnownLeagues || [];
      const initialLeague = knownLeagues.find(l => l.value === cfg.manualLeague) || null;
      const initialCustom = !initialLeague;

      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'module-config-field sports-team-field';
      fieldWrap.innerHTML = `
        <label>${field.label}</label>
        <select class="sports-league-select">${sportsLeagueOptionsHtml(initialLeague ? initialLeague.value : '__custom__')}</select>
        <select class="sports-team-select" disabled ${initialCustom ? 'style="display:none"' : ''}></select>
        <input type="text" class="sports-team-custom-input" placeholder="${field.placeholder}" value="${currentValue}" ${initialCustom ? '' : 'style="display:none"'}>
        <select class="sports-manual-select" title="Forcer le sport si la détection automatique se trompe" ${initialCustom ? '' : 'style="display:none"'}>
          ${window.SportsSources.MANUAL_SPORT_OPTIONS.map(opt =>
            `<option value="${opt.value}" ${((cfg.sport || '') === opt.value) ? 'selected' : ''}>${opt.label}</option>`
          ).join('')}
        </select>
        <span class="sports-sport-beta-badge" ${initialCustom ? '' : 'style="display:none"'}></span>
      `;
      wrapper.appendChild(fieldWrap);

      leagueSelect = fieldWrap.querySelector('.sports-league-select');
      const teamSelect = fieldWrap.querySelector('.sports-team-select');
      const customInput = fieldWrap.querySelector('.sports-team-custom-input');
      const manualSelect = fieldWrap.querySelector('.sports-manual-select');
      const sportBetaBadge = fieldWrap.querySelector('.sports-sport-beta-badge');

      teamFieldInput = customInput;
      sportSelectInput = manualSelect;

      // Note Basketball + badge "Bêta" (2026-09-01, sur demande explicite) —
      // bloc SÉPARÉ (comme le rappel Anniversaires, voir meta.hintText plus
      // haut) plutôt que casé dans la même ligne flex : réutilise
      // `.module-config-hint-text` telle quelle (muet, 11px, italique).
      // Visible seulement en mode "Autre équipe" (voir setMode ci-dessous) —
      // en mode ligue connue le sport vient de la ligue, jamais du nom tapé.
      const basketHintWrap = document.createElement('div');
      basketHintWrap.className = 'module-config-field module-config-hint-field sports-basket-hint';
      basketHintWrap.innerHTML = `<p class="module-config-hint-text">ℹ️ Si votre équipe est aussi connue comme club de football, ajoutez 'Basket' au nom pour éviter toute confusion. Ex: 'Monaco Basket' au lieu de 'Monaco'</p>`;
      wrapper.appendChild(basketHintWrap);

      // Bascule l'affichage entre les 2 modes — équipe (menu déroulant
      // ligue+équipe) et "Autre équipe" (texte libre + sport manuel, comme
      // avant ce correctif).
      function setMode(custom) {
        teamSelect.style.display = custom ? 'none' : '';
        customInput.style.display = custom ? '' : 'none';
        manualSelect.style.display = custom ? '' : 'none';
        sportBetaBadge.style.display = custom ? '' : 'none';
      }

      updateSportExtras = () => {
        const val = manualSelect.value;
        sportBetaBadge.textContent = (val === 'basketball' || val === 'rugby') ? 'β Bêta' : '';
        basketHintWrap.style.display = (leagueSelect.value === '__custom__' && val === 'basketball') ? 'flex' : 'none';
      };
      updateSportExtras();

      // Équipe choisie dans le menu déroulant — idTeam/team/sport persistés
      // TELS QUELS (forme demandée explicitement : { idTeam, team, sport,
      // manualLeague }), `customInput.value` gardé synchronisé même caché
      // (lu par le bloc "Sources" plus bas, voir teamFieldInput).
      function applyTeamSelection(idTeam, name, sport) {
        cfg.idTeam = idTeam;
        cfg.team = name;
        cfg.sport = sport;
        customInput.value = name;
      }

      // Charge la liste d'équipes de la ligue actuellement sélectionnée
      // (cache 7 jours, voir fetchLeagueTeams) et pré-sélectionne l'idTeam
      // déjà enregistré s'il fait partie de cette ligue (réouverture de
      // Paramètres sur une équipe déjà choisie) — sinon impose un choix
      // explicite (placeholder désactivé, voir sportsTeamOptionsHtml)
      // plutôt que de deviner. Assignée à la variable de portée fonction
      // `activateLeagueMode` (déclarée en haut de createModuleRow) : le
      // bloc "Sources" plus bas l'appelle pour le chargement INITIAL.
      activateLeagueMode = async function () {
        const league = knownLeagues.find(l => l.value === leagueSelect.value);
        if (!league) return;
        setMode(false);
        teamSelect.disabled = true;
        teamSelect.innerHTML = '<option>Chargement…</option>';
        try {
          const teams = await fetchLeagueTeams(league);
          // Présélection par NOM (2026-09-06 — voir sportsTeamOptionsHtml
          // ci-dessus, BUG 1) : `cfg.team` déjà persisté depuis la dernière
          // sélection, pas `cfg.idTeam` (ESPN/TheSportsDB, 2 espaces d'id
          // différents, voir fetchLeagueTeams).
          teamSelect.innerHTML = sportsTeamOptionsHtml(teams, league, cfg.team);
          teamSelect.disabled = false;
          const selectedOpt = teamSelect.selectedOptions[0];
          if (selectedOpt && selectedOpt.value) {
            // Équipe déjà choisie ET toujours présente dans cette ligue
            // (réouverture de Paramètres) — `cfg.idTeam` (TheSportsDB) est
            // déjà correct depuis la sélection précédente, PAS de nouvelle
            // résolution réseau ici (voir teamSelect 'change' plus bas pour
            // le SEUL endroit qui en déclenche une, sur un choix explicite).
            refreshSources(selectedOpt.dataset.name, { knownCategory: selectedOpt.dataset.sport });
          } else {
            // `config.sources` volontairement INTOUCHÉ ici (pas remis à `[]`)
            // — aucune équipe n'est encore choisie, donc rien à filtrer :
            // vider `sources` ferait passer TOUTES les sources de la
            // PROCHAINE sélection à "décochées" par défaut au lieu de suivre
            // la présélection normale (voir `enabled = new Set(previouslyEnabled
            // ?? detection.list.map(...))` plus bas — `[]` n'est pas `undefined`,
            // `??` ne serait alors plus jamais déclenché).
            statusEl.textContent = 'Choisissez une équipe dans la liste ci-dessus.';
            listEl.innerHTML = '';
          }
        } catch (err) {
          console.warn(`[Config] Chargement des équipes (${league.value}) échoué`, err);
          teamSelect.innerHTML = '<option>Impossible de charger les équipes</option>';
          teamSelect.disabled = true;
          statusEl.textContent = 'Impossible de charger les équipes.';
        }
      };

      leagueSelect.addEventListener('change', () => {
        if (leagueSelect.value === '__custom__') {
          setMode(true);
          cfg.manualLeague = '__custom__';
          delete cfg.idTeam;
          updateSportExtras();
          refreshSources(teamFieldInput.value);
        } else {
          delete cfg.idTeam; // ancienne équipe (autre ligue) plus valide ici
          // `sources` retiré (comme le sélecteur de sport manuel ci-dessus,
          // même raisonnement) — les URLs cochées pour l'ANCIENNE ligue
          // n'ont aucune raison de correspondre au catalogue de la NOUVELLE
          // (sport potentiellement différent) ; sans ce retrait, la 1re
          // équipe choisie dans cette nouvelle ligue verrait TOUTES ses
          // sources décochées par défaut (aucune URL de l'ancien sport ne
          // matche jamais celles du nouveau) plutôt que présélectionnées.
          delete cfg.sources;
          cfg.manualLeague = leagueSelect.value;
          activateLeagueMode();
        }
      });

      // Async (2026-09-06, BUG 1) — la liste ne porte plus d'idTeam
      // TheSportsDB (voir fetchLeagueTeams ci-dessus) : un choix explicite
      // déclenche ICI la résolution réseau par nom (voir
      // resolveTheSportsDbIdTeam), pas à la construction de la liste.
      // `data-thesportsdbid` (2026-09-08, STEP 2) — id confirmé à la main
      // (voir BETCLIC_ELITE_TEAMS) : utilisé directement, résolution réseau
      // entièrement court-circuitée pour ces équipes-là.
      teamSelect.addEventListener('change', async (e) => {
        const opt = e.target.selectedOptions[0];
        if (!opt || !opt.value) return;
        const name = opt.dataset.name;
        const sport = opt.dataset.sport;
        const knownIdTeam = opt.dataset.thesportsdbid;
        if (knownIdTeam) {
          console.log(`[Config] idTeam TheSportsDB confirmé à la main pour "${name}" : ${knownIdTeam} — recherche réseau ignorée`);
          applyTeamSelection(knownIdTeam, name, sport);
          refreshSources(name, { knownCategory: sport });
          return;
        }
        statusEl.textContent = 'Résolution de l\'équipe…';
        listEl.innerHTML = '';
        try {
          const idTeam = await resolveTheSportsDbIdTeam(name);
          applyTeamSelection(idTeam, name, sport);
          refreshSources(name, { knownCategory: sport });
        } catch (err) {
          console.warn(`[Config] Résolution TheSportsDB de "${name}" échouée`, err);
          statusEl.textContent = `Impossible de résoudre "${name}" sur TheSportsDB.`;
        }
      });

      customInput.addEventListener('input', (e) => {
        modulesState[key].config[field.key] = e.target.value;
      });
    } else {
      // Prêts/Carburants/Météo/Qualité de l'air... : champ texte simple,
      // comportement D'ORIGINE inchangé (ne concerne jamais isSportsKey).
      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'module-config-field';
      fieldWrap.innerHTML = `
        <label>${field.label}</label>
        <input type="text" placeholder="${field.placeholder}" value="${currentValue}">
      `;
      teamFieldInput = fieldWrap.querySelector('input');
      teamFieldInput.addEventListener('input', (e) => {
        if (!modulesState[key].config) modulesState[key].config = {};
        modulesState[key].config[field.key] = e.target.value;
      });
      wrapper.appendChild(fieldWrap);
    }
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
    statusEl = sourcesWrap.querySelector('.sports-sources-status');
    listEl = sourcesWrap.querySelector('.sports-sources-list');
    wrapper.appendChild(sourcesWrap);

    let detectToken = 0;

    refreshSources = async function (team, opts) {
      const myToken = ++detectToken;
      const trimmed = (team || '').trim();
      // Sport DÉJÀ connu avec certitude (2026-09-05, sur demande explicite —
      // équipe choisie via le menu déroulant ligue/équipe, voir
      // KNOWN_LEAGUES/activateLeagueMode plus haut) — prioritaire sur le
      // sélecteur de sport manuel, qui n'existe même plus dans ce mode
      // (`sportSelectInput` reste alors `null`, voir le bloc configField
      // ci-dessus). Sport choisi MANUELLEMENT (mode "Autre équipe",
      // comportement d'origine inchangé, 2026-09-01) sinon — '' (option
      // "🔍 Détection automatique") redevient `undefined`, comme une config
      // jamais touchée : laisse detectSportSources décider seul.
      const manualSport = opts?.knownCategory || sportSelectInput?.value || undefined;

      if (!trimmed) {
        statusEl.textContent = 'Saisissez un nom d\'équipe pour détecter les sources.';
        listEl.innerHTML = '';
        return;
      }

      statusEl.textContent = manualSport ? 'Application du sport choisi manuellement…' : 'Détection du sport…';
      listEl.innerHTML = '';

      try {
        // Aucun appel réseau nécessaire quand le sport est déjà connu (voir
        // sourcesForCategory, sports-sources.js) — contrairement à
        // detectSportSources (mode "Autre équipe" seulement), qui doit
        // encore deviner le sport depuis un nom d'équipe tapé au clavier.
        const detection = opts?.knownCategory
          ? window.SportsSources.sourcesForCategory(opts.knownCategory)
          : await window.SportsSources.detectSportSources(trimmed, manualSport);
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

    // Chargement initial : ligue connue → charge sa liste d'équipes
    // (activateLeagueMode déclenche lui-même refreshSources une fois
    // l'équipe résolue) ; "Autre équipe" (texte libre) → comportement
    // d'origine inchangé, détection directe sur le nom déjà saisi.
    if (leagueSelect.value !== '__custom__') {
      activateLeagueMode();
    } else {
      refreshSources(teamFieldInput.value);
    }
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

// ─── LIVE FOOT! (compétition) ───────────────────────────────────────────────
// Mode "Équipe" retiré ENTIÈREMENT le 2026-09-05, sur demande explicite
// (simplification) — un seul mode reste : suivre une compétition entière
// (voir live.js). `window.LiveCompetitions` (live-championships.js, chargé
// avant ce fichier) fournit le catalogue slug/libellé/emoji, partagé avec
// live.js.
function liveOptionHtml(c, selected) {
  return `<option value="${c.slug}" ${c.slug === selected ? 'selected' : ''}>${c.emoji} ${c.label}</option>`;
}

// Les 13 entrées, 3 groupes.
function liveCompetitionOptionsHtml(selected) {
  const list = window.LiveCompetitions || [];
  const domestic = list.filter(c => c.kind === 'domestic');
  const european = list.filter(c => c.kind === 'european');
  const national = list.filter(c => c.kind === 'national');
  return `
    <optgroup label="Clubs — Championnats nationaux">${domestic.map(c => liveOptionHtml(c, selected)).join('')}</optgroup>
    <optgroup label="Clubs — Coupes européennes">${european.map(c => liveOptionHtml(c, selected)).join('')}</optgroup>
    <optgroup label="Sélections nationales">${national.map(c => liveOptionHtml(c, selected)).join('')}</optgroup>
  `;
}

function renderLiveConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (typeof mod.config.competitionSlug !== 'string' || !mod.config.competitionSlug) mod.config.competitionSlug = 'fra.1';
  if (typeof mod.config.competitionLabel !== 'string' || !mod.config.competitionLabel) {
    mod.config.competitionLabel = liveCompetitionBySlug(mod.config.competitionSlug)?.label || '';
  }

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field live-config-field';
  wrap.innerHTML = `
    <div class="live-config-row">
      <label>Compétition</label>
      <select class="live-competition-select">${liveCompetitionOptionsHtml(mod.config.competitionSlug)}</select>
    </div>
  `;

  wrap.querySelector('.live-competition-select').addEventListener('change', (e) => {
    mod.config.competitionSlug = e.target.value;
    mod.config.competitionLabel = liveCompetitionBySlug(e.target.value)?.label || '';
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

    <label class="monequipe-list-label">Matchs à venir (max ${MON_EQUIPE_MAX_MATCHES})</label>
    <div class="monequipe-upcoming-header">
      <span>Date</span><span>Heure</span><span>Adversaire</span><span>Domicile / Extérieur</span><span>Compétition</span><span></span>
    </div>
    <div class="monequipe-upcoming-list"></div>
    <button type="button" class="etf-add-line-btn monequipe-add-upcoming-btn">+ Ajouter un match</button>

    <label class="monequipe-list-label monequipe-list-label--results">Matchs passés (max ${MON_EQUIPE_MAX_MATCHES})</label>
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
      // fois le match joué : déplace AUTOMATIQUEMENT ce match vers "Matchs
      // passés" (renommé depuis "Derniers résultats" le 2026-09-03). Au
      // `change` (donc au blur, pas à chaque frappe) : un
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
        <span class="monequipe-upcoming-score-hint">→ déplace vers "Matchs passés"</span>
      `;
      scoreRow.querySelector('.monequipe-upcoming-score-input').addEventListener('change', (e) => {
        const score = e.target.value.trim();
        if (!score) return;
        const idx = cfg.upcoming.indexOf(item);
        if (idx !== -1) cfg.upcoming.splice(idx, 1);
        // `competition` reporté tel quel (2026-09-01, sur demande explicite —
        // "Type de match" ajouté aux Matchs passés) : le match à venir
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
    // explicite — "Type de match" ajouté aux Matchs passés), même
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

// ─── Liste de souhaits (libellé + vendeur + URL + budget approximatif +
// prioritaire, max 10) (2026-09-08, sur demande explicite — refonte
// complète depuis "Suivi de prix Marchand" : plus de prix cible ni de fetch
// réseau, voir price-tracking.js) — même grille dédiée
// `.price-tracking-config-row` que l'ancienne version (voir style.css),
// élargie d'une colonne pour la case "Prioritaire".
const MAX_PRICE_TRACKING = 10;

function renderPriceTrackingConfigSection(mod) {
  if (!mod.config) mod.config = {};
  if (!Array.isArray(mod.config.items)) mod.config.items = [];
  const items = mod.config.items;

  const wrap = document.createElement('div');
  wrap.className = 'module-config-field parcels-config-field';
  wrap.innerHTML = `
    <label>Mes articles (max ${MAX_PRICE_TRACKING})</label>
    <div class="parcels-list"></div>
    <button type="button" class="etf-add-line-btn price-tracking-add-btn">+ Ajouter un article</button>
  `;

  const listEl = wrap.querySelector('.parcels-list');
  const addBtn = wrap.querySelector('.price-tracking-add-btn');

  function renderItems() {
    listEl.innerHTML = '';
    items.forEach((item) => {
      // Grille DÉDIÉE .price-tracking-config-row (voir style.css) : 6
      // colonnes [Nom][Vendeur][URL][Budget][Prioritaire][×] — remplace
      // l'ancienne colonne "Prix cible" (input number) par "Budget
      // approximatif" (texte libre, ex. "150 €") + une étoile cliquable
      // "Prioritaire" (2026-09-08, sur demande explicite, remplace la case à
      // cocher d'origine — même glyphe ⭐/couleur que le module dashboard,
      // voir price-tracking.js wishlistRowHtml, plutôt qu'un contrôle natif
      // qui n'a pas d'équivalent visuel là-bas).
      const row = document.createElement('div');
      row.className = 'price-tracking-config-row';
      row.innerHTML = `
        <input type="text" class="parcels-label-input" placeholder="Ex : Casque Bluetooth" value="${item.label || ''}">
        <input type="text" class="price-tracking-vendor-input" placeholder="Ex : Fnac" value="${item.vendor || ''}">
        <input type="text" class="parcels-tracking-input" placeholder="URL du produit" value="${item.url || ''}">
        <input type="text" class="price-tracking-budget-input" placeholder="ex : 150 €" value="${item.budget || ''}">
        <button type="button" class="price-tracking-priority-star" title="Marquer comme prioritaire" style="color:${item.priority === true ? '#f59e0b' : '#6b7280'}">${item.priority === true ? '⭐' : '☆'}</button>
        <button type="button" class="row-delete-btn price-tracking-delete-btn" title="Supprimer cet article">×</button>
      `;

      row.querySelector('.parcels-label-input').addEventListener('input', (e) => { item.label = e.target.value; });
      row.querySelector('.price-tracking-vendor-input').addEventListener('input', (e) => { item.vendor = e.target.value; });
      row.querySelector('.parcels-tracking-input').addEventListener('input', (e) => { item.url = e.target.value.trim(); });
      row.querySelector('.price-tracking-budget-input').addEventListener('input', (e) => { item.budget = e.target.value; });
      // Bascule true/false au clic — `item` est une référence directe dans
      // `mod.config.items` (même tableau que `renderPriceTrackingConfigSection`
      // reçoit), donc modifier `item.priority` ici suffit à persister le
      // changement au prochain "Enregistrer" comme n'importe quel autre champ
      // de cette section, sans écriture disque dédiée. Glyphe/couleur mis à
      // jour directement sur le bouton plutôt qu'un re-render complet de la
      // liste (renderItems()), qui perdrait le focus courant si l'utilisateur
      // enchaîne plusieurs clics sur des étoiles différentes.
      row.querySelector('.price-tracking-priority-star').addEventListener('click', (e) => {
        item.priority = item.priority !== true;
        e.currentTarget.textContent = item.priority ? '⭐' : '☆';
        e.currentTarget.style.color = item.priority ? '#f59e0b' : '#6b7280';
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
    addBtn.title = maxed ? `Maximum de ${MAX_PRICE_TRACKING} articles atteint` : '';
  }

  addBtn.addEventListener('click', () => {
    if (items.length >= MAX_PRICE_TRACKING) return;
    items.push({ label: '', vendor: '', url: '', budget: '', priority: false });
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
// (2026-08-15, sur demande explicite) Jusqu'à 20 chaînes (10→18 le
// 2026-09-01, puis 18→20 le 2026-09-08, sur demande explicite à chaque
// fois), chacune saisie par nom ou URL — résolue
// automatiquement en ID de chaîne via l'API YouTube Data v3 (Search, ou
// Channels si l'URL contient déjà `channel/UC...`, moins coûteux en quota).
// La résolution nécessite un compte Google connecté avec le scope
// `youtube.readonly` (voir main/auth/google-oauth.js) — contrairement au
// module dashboard lui-même (youtube.js), qui ne lit ensuite QUE le flux RSS
// public de chaque chaîne déjà résolue (aucune auth requise pour ça, donc
// `MODULE_META.youtube.requiresGoogle` reste `false`).
const MAX_YOUTUBE_CHANNELS = 20;

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
      if (!confirm(`Restaurer la sauvegarde du ${dateLabel} ?\n\nTOUTES les données actuelles (ETF, Crypto, Mon Prêt, Podcasts, FDJ, réglages...) seront remplacées par celles de cette sauvegarde.`)) return;

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
    if (!confirm('Restaurer depuis Google Drive ?\n\nTOUTES les données actuelles (ETF, Crypto, Mon Prêt, Podcasts, FDJ, réglages...) seront remplacées par celles de Drive — même si votre version locale est plus récente.')) return;

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
  { key: 'lac',       emoji: '🏞️', label: 'Lac et forêt', theme: 'dark' },
  { key: 'paper',     emoji: '📄', label: 'Grain de papier', theme: 'light' },
  { key: 'geometric', emoji: '📐', label: 'Lignes géométriques', theme: 'light' },
  { key: 'gradient',  emoji: '🌫️', label: 'Dégradé doux', theme: 'light' },
  { key: 'winter-frost', emoji: '🧊', label: 'Givre sur vitre',        theme: 'light' },
  { key: 'winter-pines', emoji: '🌲', label: 'Sapins dans la brume',    theme: 'light' },
  { key: 'winter-peaks', emoji: '🏔️', label: 'Cime enneigée',           theme: 'light' },
  { key: 'winter-mist',  emoji: '🌁', label: 'Arbres dans la neige',    theme: 'light' },
  { key: 'winter-illus', emoji: '❄️', label: 'Montagnes illustrées',     theme: 'light' },
  { key: 'winter-sea',   emoji: '🌊', label: "Horizon d'hiver",          theme: 'light' },
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
      <span class="display-mode-option-label">${opt.label}</span>${opt.key === 'floating' ? '<span class="badge-beta">Bêta</span>' : ''}
    </button>`).join('');

  // Note d'info sous l'option "Icône flottante" (2026-09-09, sur demande
  // explicite) — insérée comme sibling APRÈS `container` plutôt que DEDANS
  // (`.display-mode-options` est en `display:flex` ROW : un <p> ajouté via
  // `container.innerHTML` serait rendu comme un 3e item de la rangée, à côté
  // des boutons, pas en dessous du tout). Id fixe + garde contre les appels
  // répétés de cette fonction (à chaque ouverture de Personnaliser) — sinon
  // dupliquée à chaque fois, seul `container.innerHTML` étant réinitialisé
  // ci-dessus, pas ses siblings.
  if (!document.getElementById('displayModeFloatingHint')) {
    container.insertAdjacentHTML('afterend', '<p class="config-hint" id="displayModeFloatingHint">En mode icône flottante, un raccourci apparaît dans la barre du haut (mode paysage uniquement).</p>');
  }

  container.querySelectorAll('.display-mode-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      await window.matin.displayMode.set(key);
      container.querySelectorAll('.display-mode-option').forEach(b => b.classList.toggle('selected', b === btn));

      // Ferme Paramètres en plus de basculer le mode (2026-09-09, sur demande
      // explicite) — `window.matin.displayMode.set('floating')` masque déjà
      // mainWindow IMMÉDIATEMENT et sans reload (voir main.js applyDisplayMode,
      // appelé synchrone dans le handler IPC `app:setDisplayMode` : aucun
      // changement nécessaire de ce côté-là, déjà correct). Ce qui manquait :
      // la fenêtre Paramètres ELLE-MÊME (une 2e BrowserWindow séparée, PAS un
      // `#configOverlay` dans cette page) restait ouverte à l'écran à côté du
      // soleil, contredisant "seule l'icône soleil reste visible". Même
      // correctif déjà appliqué au bouton "Réduire" du dashboard (voir
      // dashboard.js initDisplayMode, `collapseBtn` → `window.matin.window.
      // closeConfig()`), ici dans l'autre sens : c'est CETTE fenêtre qui doit
      // se fermer elle-même, pas une fenêtre tierce qu'on referme depuis
      // l'extérieur — même appel IPC (`window:closeConfig`, main.js),
      // disponible ici aussi (même preload.js pour les 2 fenêtres).
      if (key === 'floating') {
        window.matin.window.closeConfig().catch(err => console.error('[Config] Échec fermeture Paramètres', err));
      }
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
