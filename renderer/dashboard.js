/**
 * MATIN!* — Dashboard Engine
 * Charge les modules selon la config, gère le cycle de vie, le refresh, et la
 * disposition libre (glisser-déposer + redimensionnement via interact.js).
 *
 * Chaque module a une position/taille propre (x, y, width, height, z)
 * persistée dans le store électron sous modules.<clé>.layout, via un canal
 * IPC dédié et SILENCIEUX (modules:updateLayout) qui ne déclenche pas le
 * rechargement automatique du dashboard (contrairement à modules:update,
 * utilisé par la page de config) — sinon chaque glisser-déposer se
 * rechargerait lui-même en boucle.
 */

// ─── Registre des modules ─────────────────────────────────────────────────────
// defaultSize sert uniquement à la disposition initiale (avant toute
// disposition enregistrée) — l'utilisateur peut ensuite tout redimensionner.
// `theme` pilote la bordure gauche colorée + la couleur de l'icône de chaque
// carte (2026-08-08, sur demande explicite) — voir THEME_COLORS ci-dessous
// pour la palette, et style.css pour les règles `.module-card[data-theme=…]`.
// Cas particulier "ol" (Sports) : sa vraie catégorie (football/basket/autre)
// dépend de l'ÉQUIPE configurée, connue seulement après un appel réseau
// (TheSportsDB) — le thème ci-dessous n'est donc qu'une valeur de départ
// affichée avant résolution ; ol.js écrase ensuite `data-theme` sur la carte
// une fois le sport réellement identifié (voir ol.js, fetchTeamId/
// olThemeForSport). Les instances ol_2..ol_5 (équipes supplémentaires)
// réutilisent cette même entrée de registre (voir isSportsKey) donc profitent
// du même mécanisme sans configuration séparée.
const MODULE_REGISTRY = {
  weather:  { label: 'Météo',      icon: '🌤️',  requiresGoogle: false, defaultSize: { w: 320, h: 220 }, refreshMs: 30 * 60 * 1000, theme: 'maison' },
  france:   { label: 'France',     icon: '🇫🇷', requiresGoogle: false, defaultSize: { w: 340, h: 460 }, refreshMs: 15 * 60 * 1000, theme: 'actualites' },
  tech:     { label: 'Tech',       icon: '💻',  requiresGoogle: false, defaultSize: { w: 340, h: 460 }, refreshMs: 15 * 60 * 1000, theme: 'actualites' },
  bourse:   { label: 'Bourse',     icon: '📊',  requiresGoogle: false, defaultSize: { w: 340, h: 460 }, refreshMs: 15 * 60 * 1000, theme: 'actualites' },
  calendar: { label: 'Agenda',     icon: '📅',  requiresGoogle: true,  defaultSize: { w: 320, h: 260 }, refreshMs: 5 * 60 * 1000, theme: 'perso' },
  etf:      { label: 'ETF',        icon: '📈',  requiresGoogle: false, defaultSize: { w: 700, h: 420 }, theme: 'finance' }, // auto-refresh géré en interne (voir etf.js)
  gmail:    { label: 'Gmail',      icon: '📬',  requiresGoogle: true,  defaultSize: { w: 320, h: 320 }, refreshMs: 3 * 60 * 1000, theme: 'perso' },
  ol:       { label: 'Sports',     icon: '🏆',  requiresGoogle: false, defaultSize: { w: 320, h: 380 }, refreshMs: 10 * 60 * 1000, theme: 'other-sports' },
  // FDJ scindé en 3 modules indépendants (2026-08-04, sur demande explicite)
  // — chacun activable/déplaçable/redimensionnable séparément ; voir
  // fdj-common.js pour le moteur de rendu partagé. Pas de refreshMs ici :
  // auto-refresh géré en interne (setInterval propre à chaque instance, même
  // principe que ETF/Crypto/Spotify — voir fdj-common.js).
  fdjLoto:         { label: 'Loto',         icon: '🎰', requiresGoogle: false, defaultSize: { w: 300, h: 320 }, theme: 'fdj' },
  fdjEuromillions: { label: 'EuroMillions', icon: '⭐', requiresGoogle: false, defaultSize: { w: 300, h: 320 }, theme: 'fdj' },
  fdjEurodreams:   { label: 'EuroDreams',   icon: '🌟', requiresGoogle: false, defaultSize: { w: 300, h: 260 }, theme: 'fdj' },
  crypto:   { label: 'Crypto',     icon: '₿',   requiresGoogle: false, defaultSize: { w: 700, h: 420 }, theme: 'finance' }, // auto-refresh géré en interne (voir crypto.js)
  spotify:  { label: 'Spotify',    icon: '🎵',  requiresGoogle: false, defaultSize: { w: 440, h: 320 }, theme: 'musique' }, // auto-refresh géré en interne (voir spotify.js), auth Spotify indépendante de requiresGoogle
  maps:     { label: 'Maps',       icon: '🗺️',  requiresGoogle: false, defaultSize: { w: 300, h: 130 }, theme: 'services' }, // pas d'auto-refresh : pas de données à rafraîchir, juste un champ de recherche
  // 6 modules ajoutés en autonomie (2026-08-05, voir OVERNIGHT_LOG.md)
  airQuality: { label: 'Qualité air',   icon: '🌡️', requiresGoogle: false, defaultSize: { w: 300, h: 200 }, refreshMs: 30 * 60 * 1000, theme: 'maison' },
  fuelPrices: { label: 'Carburants',    icon: '⛽', requiresGoogle: false, defaultSize: { w: 360, h: 320 }, refreshMs: 2 * 60 * 60 * 1000, theme: 'services' },
  parcels:    { label: 'Colis',         icon: '📦', requiresGoogle: false, defaultSize: { w: 340, h: 300 }, refreshMs: 60 * 60 * 1000, theme: 'services' },
  // Hauteur portée à 520px (depuis 320px) le 2026-08-15, sur demande
  // explicite — carte passée de 2 à 3 sections (actus statiques / à
  // l'affiche défilant compact / sorties à venir en diaporama), 320px ne
  // laissait plus assez de place pour la 3e section. Juste un défaut,
  // redimensionnable librement ensuite (snap-to-grid retiré le 2026-08-11).
  cinema:     { label: 'Cinéma',        icon: '🎬', requiresGoogle: false, defaultSize: { w: 420, h: 520 }, refreshMs: 24 * 60 * 60 * 1000, theme: 'services' },
  steamPromos:{ label: 'Promos Steam', icon: '🏷️', requiresGoogle: false, defaultSize: { w: 380, h: 300 }, refreshMs: 6 * 60 * 60 * 1000, theme: 'services' },
  epicPromos: { label: 'Promos Epic Games', icon: '🎁', requiresGoogle: false, defaultSize: { w: 380, h: 300 }, refreshMs: 6 * 60 * 60 * 1000, theme: 'services' },
  hue:        { label: 'Philips Hue',   icon: '💡', requiresGoogle: false, defaultSize: { w: 320, h: 260 }, refreshMs: 30 * 1000, theme: 'maison' },
  kasa:       { label: 'TP-Link Kasa',  icon: '🔌', requiresGoogle: false, defaultSize: { w: 360, h: 400 }, refreshMs: 30 * 1000, theme: 'maison' },
  tradfri:    { label: 'IKEA Trådfri',  icon: '💡', requiresGoogle: false, defaultSize: { w: 380, h: 440 }, refreshMs: 30 * 1000, theme: 'maison' },
  // Rappels : la planification/notification tourne côté process main (voir
  // main.js, checkReminders) — ce refreshMs ne sert qu'à réaffichage local
  // (aucun réseau), pour garder à jour le classement aujourd'hui/à venir/en
  // retard au fil du temps (ex. bascule à minuit ou passage à l'heure).
  reminders:  { label: 'Rappels',       icon: '⏰', requiresGoogle: false, defaultSize: { w: 300, h: 280 }, refreshMs: 60 * 1000, theme: 'perso' },
  // 4 modules ajoutés le 2026-08-06 (sur demande explicite)
  currency:    { label: 'Change',        icon: '💱', requiresGoogle: false, defaultSize: { w: 280, h: 240 }, theme: 'finance' }, // auto-refresh géré en interne (voir currency.js) — un re-render externe effacerait la saisie en cours
  googleTasks: { label: 'Tâches Google', icon: '✅', requiresGoogle: true,  defaultSize: { w: 300, h: 320 }, refreshMs: 5 * 60 * 1000, theme: 'perso' },
  science:     { label: 'Sciences',      icon: '🔬', requiresGoogle: false, defaultSize: { w: 340, h: 460 }, refreshMs: 15 * 60 * 1000, theme: 'actualites' },
  gaming:      { label: 'Gaming',        icon: '🎮', requiresGoogle: false, defaultSize: { w: 340, h: 460 }, refreshMs: 15 * 60 * 1000, theme: 'actualites' },
  // 3 modules ajoutés le 2026-08-07 (sur demande explicite)
  sante:     { label: 'Santé',         icon: '⚕️', requiresGoogle: false, defaultSize: { w: 340, h: 460 }, refreshMs: 15 * 60 * 1000, theme: 'actualites' },
  birthdays: { label: 'Anniversaires', icon: '🎂', requiresGoogle: true,  defaultSize: { w: 300, h: 280 }, refreshMs: 24 * 60 * 60 * 1000, theme: 'perso' },
  indices:   { label: 'Indices',       icon: '📉', requiresGoogle: false, defaultSize: { w: 420, h: 300 }, refreshMs: 5 * 60 * 1000, theme: 'finance' },
  // 2 modules ajoutés le 2026-08-08 (sur demande explicite). Pas de refreshMs
  // pour "podcast" : auto-refresh géré en interne (voir podcast.js, même
  // raison que ETF/Crypto/Spotify/FDJ/Change — un re-render externe
  // empilerait un 2e setInterval interne à chaque cycle, voir le commentaire
  // de scheduleModuleRefresh plus bas). "nasa" n'a lui aucun état interne à
  // perdre (pas d'UI dépliable) : refreshMs classique, re-rendu externe sans
  // risque.
  podcast: { label: 'Podcasts', icon: '🎙️', requiresGoogle: false, defaultSize: { w: 380, h: 380 }, theme: 'musique' },
  // YouTube Notifications (2026-08-15, sur demande explicite) — pas de
  // refreshMs : planificateur à heures fixes géré en interne (voir
  // youtube.js, ytStartScheduler), même raison que Podcast/ETF/Crypto/NASA-
  // cache/Currency (un re-render externe empilerait un 2e setInterval à
  // chaque cycle). Thème 'services' + bordure slate #94a3b8 (voir style.css).
  youtube: { label: 'YouTube', icon: '🔔', requiresGoogle: false, defaultSize: { w: 320, h: 260 }, theme: 'services' },
  nasa:    { label: 'NASA',     icon: '🌍', requiresGoogle: false, defaultSize: { w: 440, h: 460 }, refreshMs: 24 * 60 * 60 * 1000, theme: 'perso' },
  // Prêts immobiliers (2026-08-08, sur demande explicite) — instances
  // multiples comme Sports (voir isPretsKey/resolveModuleMeta plus haut) : un
  // groupe de prêts = une instance = une carte. Calcul 100% local (aucun
  // réseau) mais refreshMs quand même posé — le CRD/temps restant dépendent
  // de la date du jour, doivent donc se recalculer de temps en temps même
  // sans interaction (24h : la variation jour à jour est de toute façon
  // imperceptible pour un prêt qui se mesure en mois).
  prets: { label: 'Prêts', icon: '🏠', requiresGoogle: false, defaultSize: { w: 360, h: 420 }, refreshMs: 24 * 60 * 60 * 1000, theme: 'finance' },
  // LIVE! (2026-08-11, sur demande explicite) — pas de refreshMs : cadence
  // 60s/5min auto-ajustée en interne selon qu'un match est en direct ou non
  // (impossible avec le setInterval fixe de scheduleModuleRefresh), même
  // principe que ETF/Crypto/Spotify/Podcast/Currency (voir live.js). Thème
  // 'other-sports' pour rejoindre le regroupement visuel "Sports" du
  // Réorganiser automatique (même bordure de catégorie que Sports/ol) —
  // l'accent rouge "en direct" demandé est posé séparément (voir
  // #module-live dans style.css, qui l'emporte sur la couleur de thème).
  live: { label: 'LIVE!', icon: '🔴', requiresGoogle: false, defaultSize: { w: 340, h: 360 }, theme: 'other-sports' },
  // Mon Équipe (2026-08-15, sur demande explicite) — suivi manuel (calendrier
  // + résultats saisis à la main, voir main.js/config.js), pas de fetch
  // réseau du tout. refreshMs 24h quand même posé, même raison que Prêts
  // juste au-dessus : le tri "prochain match"/"dernier résultat" dépend de
  // la date du jour, doit donc se recalculer de temps en temps même sans
  // interaction, bien qu'aucune donnée externe ne change. Thème
  // 'other-sports' réutilisé tel quel (même bordure verte #10b981 que
  // Sports/LIVE!, demandée explicitement pour ce module).
  monEquipe: { label: 'Mon Équipe', icon: '🎽', requiresGoogle: false, defaultSize: { w: 340, h: 440 }, refreshMs: 24 * 60 * 60 * 1000, theme: 'other-sports' },
};

// Abaissés de 260×160 à 80×40 (2026-08-15, sur demande explicite — "laisser
// l'utilisateur redimensionner beaucoup plus petit"). 80×40 ≈ une seule
// ligne de titre : voir .module-card.size-icon-only / .size-compact-content
// dans style.css pour l'adaptation du CONTENU à ces tailles extrêmes (une
// carte à 80×40 avec son contenu normal serait juste tronquée sans intérêt,
// d'où ces 2 paliers CSS posés/retirés par updateSizeTier ci-dessous).
const MIN_WIDTH = 80;
const MIN_HEIGHT = 40;

// Sous ces seuils, le CONTENU s'adapte plutôt que de simplement déborder/se
// faire couper au hasard (demandé explicitement) :
// - SIZE_COMPACT_CONTENT_* : cache le contenu secondaire (horodatages,
//   sources, descriptions — voir .sports-ticker-source/.module-badge/etc.
//   dans style.css, ciblées génériquement plutôt que module par module).
// - SIZE_ICON_ONLY_* : encore plus petit, n'affiche plus que l'icône + le
//   titre (`.module-content` masqué entièrement).
// Deux seuils DISTINCTS (pas un seul) : une carte large mais très basse (ex.
// 300×45) doit pouvoir garder son titre lisible sans passer en "icône
// seule", d'où un test sur largeur ET hauteur séparément plutôt qu'une
// simple aire totale.
const SIZE_COMPACT_CONTENT_MAX_W = 200;
const SIZE_COMPACT_CONTENT_MAX_H = 100;
const SIZE_ICON_ONLY_MAX_W = 120;
const SIZE_ICON_ONLY_MAX_H = 60;

// Applique/retire les 2 classes de palier ci-dessus selon la taille RÉELLE
// de la carte — appelée à chaque placement (placeCard) ET à chaque frame de
// redimensionnement manuel (pas seulement au relâchement de la souris,
// sinon le contenu resterait affiché en trop jusqu'au prochain clic ailleurs
// pendant qu'on rétrécit activement une carte). Les 2 classes ne s'excluent
// pas au niveau CSS (icon-only peut se combiner à compact-content) mais en
// pratique un module en dessous du seuil icon-only est TOUJOURS aussi sous
// le seuil compact-content (ICON_ONLY < COMPACT_CONTENT sur les 2 axes) :
// les 2 classes sont donc pratiquement toujours posées ensemble à ce stade,
// gardées séparées simplement pour que .size-icon-only puisse un jour
// évoluer indépendamment sans dépendre de l'autre seuil.
function updateSizeTier(card, width, height) {
  const compact = width <= SIZE_COMPACT_CONTENT_MAX_W || height <= SIZE_COMPACT_CONTENT_MAX_H;
  const iconOnly = width <= SIZE_ICON_ONLY_MAX_W || height <= SIZE_ICON_ONLY_MAX_H;
  card.classList.toggle('size-compact-content', compact);
  card.classList.toggle('size-icon-only', iconOnly);
}

// ─── Instances multiples (Sports, Prêts) ────────────────────────────────────
// Même principe pour les deux : une clé "de base" + jusqu'à 4 suffixes _2.._5,
// un seul renderer partagé (window.MatinModules.ol / .prets) sert toutes les
// instances. `resolveModuleMeta`/`resolveRendererKey`/`resolveModuleTitle`
// centralisent la résolution plutôt que de dupliquer le même ternaire à
// chaque site d'appel (3 pour Sports avant l'ajout de Prêts).
function isSportsKey(key) {
  return key === 'ol' || /^ol_[2-5]$/.test(key);
}
function isPretsKey(key) {
  return key === 'prets' || /^prets_[2-5]$/.test(key);
}
function resolveModuleMeta(key) {
  if (MODULE_REGISTRY[key]) return MODULE_REGISTRY[key];
  if (isSportsKey(key)) return MODULE_REGISTRY.ol;
  if (isPretsKey(key)) return MODULE_REGISTRY.prets;
  return undefined;
}
function resolveRendererKey(key) {
  if (isSportsKey(key)) return 'ol';
  if (isPretsKey(key)) return 'prets';
  return key;
}
// Cartes à hauteur AUTOMATIQUE (2026-08-09, étendu le 2026-08-10 sur demande
// explicite à FDJ et Prêts — même mécanisme) : ces modules n'ont pas de
// hauteur fixe/redimensionnable à la souris comme les autres — la carte
// grandit/rétrécit avec son contenu (grilles FDJ dépliées/repliées, groupe de
// prêts déplié/replié — voir fdj-common.js/prets.js `expanded`/`collapsed`),
// voir placeCard/makeInteractive plus bas où cette fonction désactive la
// hauteur imposée par JS (ni au placement initial, ni pendant un
// redimensionnement à la souris, qui ne joue plus que sur la largeur pour
// ces modules).
function isAutoHeightKey(key) {
  if (key === 'etf' || key === 'crypto') return true;
  if (key === 'fdjLoto' || key === 'fdjEuromillions' || key === 'fdjEurodreams') return true;
  return isPretsKey(key);
}
function resolveModuleTitle(key, meta, config) {
  if (isSportsKey(key)) return config?.team?.trim() || meta.label;
  if (isPretsKey(key)) return config?.name?.trim() || meta.label;
  // Mon Équipe (2026-08-15, sur demande explicite) — "le nom de l'équipe en
  // en-tête" : même mécanisme que Sports/Prêts ci-dessus, le titre de CARTE
  // affiche le nom réellement saisi plutôt que le libellé générique "Mon
  // Équipe" dès qu'il est configuré.
  if (key === 'monEquipe') return config?.teamName?.trim() || meta.label;
  return meta.label;
}

// Titres de carte cliquables (2026-08-10, sur demande explicite) — ouvre le
// site correspondant dans le navigateur par défaut. URLs fixes pour la
// plupart des modules ; Sports (ol) est un cas particulier : l'URL dépend du
// CLUB configuré, résolue dynamiquement par ol.js (voir fetchTeamId/render,
// `card.dataset.website`) plutôt que fixée ici, et persistée dans
// electron-store (`modules.<clé>.config.website`) pour ne pas la re-résoudre
// à chaque ouverture de Paramètres/refresh.
const MODULE_CLICK_URLS = {
  calendar: 'https://calendar.google.com',
  gmail: 'https://mail.google.com',
  googleTasks: 'https://tasks.google.com',
  spotify: 'https://open.spotify.com',
  cinema: 'https://www.allocine.fr',
  fdjLoto: 'https://www.fdj.fr/jeux-de-tirage/loto',
  fdjEuromillions: 'https://www.fdj.fr/jeux-de-tirage/euromillions-my-million',
  fdjEurodreams: 'https://www.fdj.fr/jeux-de-tirage/eurodreams',
  steamPromos: 'https://store.steampowered.com/specials',
  epicPromos: 'https://store.epicgames.com/fr/free-games',
  kasa: 'https://www.kasasmart.com',
  tradfri: 'https://www.ikea.com/fr/fr/cat/smarta-hem-hs001/',
  weather: 'https://meteofrance.com',
  maps: 'https://maps.google.com',
  live: 'https://www.lequipe.fr/Football/',
  youtube: 'https://www.youtube.com/feed/subscriptions',
};

// `card` requis pour Sports : lu dynamiquement au moment du clic (pas figé à
// la création de la carte) car ol.js résout le site officiel du club de façon
// ASYNCHRONE, après la création de la carte — un utilisateur cliquant avant
// cette résolution (quelques centaines de ms) obtiendrait sinon toujours
// `null` même une fois l'URL connue juste après.
function resolveModuleClickUrl(key, card) {
  if (isSportsKey(key)) return card?.dataset.website || null;
  return MODULE_CLICK_URLS[key] || null;
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────
function updateHeaderDate() {
  const el = document.getElementById('headerDate');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

// Prénom affiché dans la barre de titre (Paramètres → Profil), stocké dans
// app.firstName. Rien n'est affiché si le champ est vide — pas de "Bonjour"
// sans prénom.
async function updateHeaderGreeting() {
  const el = document.getElementById('headerGreeting');
  if (!el) return;
  const firstName = await window.matin.store.get('app.firstName');
  el.textContent = firstName ? `👋 Bonjour ${firstName}` : '';
}

// Barre de recherche Google centrée dans le titlebar — ouvre les résultats
// dans le navigateur par défaut (pas dans l'app, qui n'a pas de moteur de
// rendu web générique/navigation), donc shell:openExternal comme partout
// ailleurs dans l'app pour un lien externe.
function initTitlebarSearch() {
  const form = document.getElementById('titlebarSearch');
  const input = document.getElementById('titlebarSearchInput');
  if (!form || !input) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    window.matin.shell.openExternal(url);
  });
}

// ─── Mode auto luminosité (2026-08-08, sur demande explicite) ─────────────
// Assombrit progressivement #brightnessOverlay (voir index.html/style.css)
// selon l'heure locale, uniquement si app.autoBrightness est activé
// (Paramètres → Profil). Matin (06h-09h) et journée (09h-18h) : aucune
// classe posée, le calque reste transparent — "thème normal" tel que
// demandé, pas de distinction matin/journée à faire côté CSS puisque les 2
// tranches ont exactement le même traitement (aucun assombrissement).
const BRIGHTNESS_CHECK_MS = 15 * 60 * 1000;

function brightnessBandForHour(h) {
  if (h >= 21 || h < 6) return 'nuit';
  if (h >= 18) return 'soiree';
  return null; // matin (6-9h) et journée (9-18h) : pas d'assombrissement
}

async function applyBrightnessOverlay() {
  const overlay = document.getElementById('brightnessOverlay');
  if (!overlay) return;

  const enabled = (await window.matin.store.get('app.autoBrightness')) === true;
  overlay.classList.remove('brightness-soiree', 'brightness-nuit');
  if (!enabled) return; // mode auto désactivé : thème fixe choisi par l'utilisateur, calque toujours transparent

  const band = brightnessBandForHour(new Date().getHours());
  if (band) overlay.classList.add(`brightness-${band}`);
}

function initAutoBrightness() {
  applyBrightnessOverlay().catch(err => console.error('[Matin] Erreur mode auto luminosité', err));
  setInterval(() => {
    applyBrightnessOverlay().catch(err => console.error('[Matin] Erreur mode auto luminosité', err));
  }, BRIGHTNESS_CHECK_MS);
}

// ─── Thème clair/sombre (2026-08-08, sur demande explicite) ────────────────
// L'état initial est déjà posé de façon synchrone AVANT ce script par le
// <script> de bootstrap en tête d'index.html (voir preload.js/main.js,
// window.matin.initialTheme) — cette fonction gère uniquement le cas
// "appliquer instantanément sans redémarrage" : le bouton bascule vit dans
// la fenêtre Paramètres (voir config.js), donc le dashboard doit écouter
// theme:updated pour suivre en direct un changement fait depuis l'AUTRE
// fenêtre plutôt que de devoir être rechargé.
function initThemeSync() {
  window.matin.theme.onUpdated((theme) => {
    document.documentElement.dataset.colorScheme = theme;
    // Un fond sombre choisi (ex. étoilé) n'a pas de sens en clair et
    // inversement (voir applyAppBackground, gating par thème) — le thème
    // vient de changer, il faut donc réévaluer si le fond stocké reste
    // affichable, sans attendre un nouveau clic dans Personnaliser.
    applyAppBackground(lastAppBackgroundKey);
  });
}

// ─── Fond personnalisé du dashboard (2026-08-11, sur demande explicite) ────
// Voir "🎨 Personnaliser" dans Paramètres (config.js) — la sélection y est
// sauvegardée puis diffusée ici via window.matin.background.onUpdated
// (même mécanisme que le thème clair/sombre, voir initThemeSync ci-dessus).
// Chaque effet sombre/clair est gated par le thème ACTUEL (voir
// APP_BACKGROUND_DARK_KEYS/LIGHT_KEYS) : une clé qui ne correspond pas au
// thème affiché en ce moment ne rend rien plutôt que de s'afficher hors
// contexte (ex. après un changement de thème sans repasser par Personnaliser).
const APP_BACKGROUND_DARK_KEYS = ['stars', 'aurora', 'particles', 'rain', 'snow', 'matrix', 'nebula', 'beach', 'mountain'];
const APP_BACKGROUND_LIGHT_KEYS = ['paper', 'geometric', 'gradient'];
const APP_BACKGROUND_STAR_COUNT = 140;
const APP_BACKGROUND_PARTICLE_COUNT = 26;
const APP_BACKGROUND_RAIN_COUNT = 60;
const APP_BACKGROUND_SNOW_COUNT = 60; // demandé explicitement (2026-08-11, voir startSnowBackground)
const APP_BACKGROUND_SNOW_SIZES = [4, 6, 8]; // px — mix demandé explicitement pour un effet de profondeur
const APP_BACKGROUND_MATRIX_CHARS = 'アイウエオカキクケコサシスセソ0123456789';
const APP_BACKGROUND_MATRIX_COL_WIDTH = 16;
const APP_BACKGROUND_BEACH_CLOUD_COUNT = 5;
const APP_BACKGROUND_BEACH_GRAIN_COUNT = 1400; // demandé "densément" (2026-08-15), depuis 900
const APP_BACKGROUND_MOUNTAIN_STAR_COUNT = 3;
const APP_BACKGROUND_MOUNTAIN_BIRD_COUNT = 2;

let appBackgroundAnimId = null;
let appBackgroundResizeHandler = null;
let lastAppBackgroundKey = 'none';

function clearAppBackground() {
  const layer = document.getElementById('appBackgroundLayer');
  if (!layer) return;
  if (appBackgroundAnimId) { cancelAnimationFrame(appBackgroundAnimId); appBackgroundAnimId = null; }
  if (appBackgroundResizeHandler) { window.removeEventListener('resize', appBackgroundResizeHandler); appBackgroundResizeHandler = null; }
  layer.className = 'app-background-layer';
  layer.innerHTML = '';
}

function startStarsBackground(layer) {
  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let stars = [];
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: APP_BACKGROUND_STAR_COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.3 + 0.4,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.0012 + 0.0006,
    }));
  }
  resize();
  appBackgroundResizeHandler = resize;
  window.addEventListener('resize', appBackgroundResizeHandler);

  function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      const opacity = 0.25 + 0.6 * Math.abs(Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.fillStyle = `rgba(232, 234, 240, ${opacity.toFixed(3)})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    appBackgroundAnimId = requestAnimationFrame(frame);
  }
  appBackgroundAnimId = requestAnimationFrame(frame);
}

function startParticlesBackground(layer) {
  for (let i = 0; i < APP_BACKGROUND_PARTICLE_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'app-bg-particle';
    const size = Math.random() * 3 + 2;
    el.style.left = `${Math.random() * 100}%`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.animationDuration = `${Math.random() * 14 + 14}s`;
    el.style.animationDelay = `-${Math.random() * 20}s`;
    layer.appendChild(el);
  }
}

function startRainBackground(layer) {
  for (let i = 0; i < APP_BACKGROUND_RAIN_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'app-bg-raindrop';
    el.style.left = `${Math.random() * 100}%`;
    el.style.height = `${Math.random() * 14 + 10}px`;
    el.style.animationDuration = `${Math.random() * 3 + 4}s`;
    el.style.animationDelay = `-${Math.random() * 7}s`;
    layer.appendChild(el);
  }
}

// Dessine UN flocon à (x, y) : astérisque à 6 branches (60° d'écart), chacune
// avec 2 petites branches diagonales à mi-longueur (2026-08-11, sur demande
// explicite — remplace les simples cercles CSS précédents, qui ne
// ressemblaient pas à de vrais flocons). `size` = diamètre total demandé
// (4/6/8px) ; les longueurs de branche/sous-branche en dérivent toutes
// proportionnellement pour que les 3 tailles gardent la même silhouette.
function drawSnowflake(ctx, x, y, size, opacity) {
  const branchLen = size / 2;
  const subLen = branchLen * 0.4;
  ctx.strokeStyle = `rgba(255, 255, 255, ${opacity.toFixed(2)})`;
  ctx.lineWidth = Math.max(0.6, size / 8);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const tipX = x + dx * branchLen, tipY = y + dy * branchLen;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // 2 sous-branches diagonales, à mi-chemin de la branche principale.
    const midX = x + dx * branchLen * 0.6, midY = y + dy * branchLen * 0.6;
    for (const sign of [1, -1]) {
      const subAngle = angle + sign * (Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX + Math.cos(subAngle) * subLen, midY + Math.sin(subAngle) * subLen);
      ctx.stroke();
    }
  }
}

// Chute lente avec balancement latéral en sinusoïde (2026-08-11, sur demande
// explicite) — même famille technique que startStarsBackground (canvas +
// rAF) plutôt que des divs CSS : nécessaire pour dessiner une vraie forme de
// flocon (impossible en CSS pur sans SVG/masque coûteux). `x` reste
// l'ancrage fixe de la colonne du flocon ; le balancement est un décalage
// sinusoïdal calculé à chaque frame autour de cet ancrage (jamais cumulé),
// donc toujours borné à ±swayAmplitude — pas de dérive latérale infinie.
function startSnowBackground(layer) {
  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function makeFlake(canvasWidth, canvasHeight, randomY) {
    return {
      x: Math.random() * canvasWidth,
      y: randomY ? Math.random() * canvasHeight : -10,
      size: APP_BACKGROUND_SNOW_SIZES[Math.floor(Math.random() * APP_BACKGROUND_SNOW_SIZES.length)],
      opacity: Math.random() * 0.5 + 0.4, // 0.4 à 0.9, demandé explicitement
      speed: Math.random() * 0.25 + 0.15, // dérive verticale lente, demandé explicitement
      swayAmplitude: Math.random() * 10 + 6,
      swayFreq: Math.random() * 0.0008 + 0.0004,
      swayPhase: Math.random() * Math.PI * 2,
    };
  }

  let flakes = [];
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    flakes = Array.from({ length: APP_BACKGROUND_SNOW_COUNT }, () => makeFlake(canvas.width, canvas.height, true));
  }
  resize();
  appBackgroundResizeHandler = resize;
  window.addEventListener('resize', appBackgroundResizeHandler);

  function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const f of flakes) {
      const swayX = f.x + Math.sin(t * f.swayFreq + f.swayPhase) * f.swayAmplitude;
      drawSnowflake(ctx, swayX, f.y, f.size, f.opacity);
      f.y += f.speed;
      // Réapparaît en haut à un x aléatoire une fois le bas de l'écran
      // atteint (demandé explicitement) — jamais de saut vertical brusque
      // pour les autres flocons, chacun boucle indépendamment.
      if (f.y > canvas.height + 10) {
        f.y = -10;
        f.x = Math.random() * canvas.width;
      }
    }
    appBackgroundAnimId = requestAnimationFrame(frame);
  }
  appBackgroundAnimId = requestAnimationFrame(frame);
}

// Pluie de caractères façon Matrix — même famille technique que
// startStarsBackground (canvas + rAF), volontairement TRÈS lente (0.15
// rangée/frame plutôt que la cadence rapide habituelle de cet effet) et à
// faible opacité (fondu par un rectangle semi-transparent plutôt qu'un
// clearRect, pour la traînée caractéristique, teinté sur --bg-base pour
// rester cohérent avec le thème sombre plutôt qu'un noir pur).
function startMatrixBackground(layer) {
  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let columns = [];
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const count = Math.ceil(canvas.width / APP_BACKGROUND_MATRIX_COL_WIDTH);
    columns = Array.from({ length: count }, () => ({
      y: Math.random() * -100,
      speed: Math.random() * 0.08 + 0.06,
    }));
  }
  resize();
  appBackgroundResizeHandler = resize;
  window.addEventListener('resize', appBackgroundResizeHandler);

  ctx.font = '14px monospace';
  function frame() {
    ctx.fillStyle = 'rgba(15, 17, 23, 0.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(52, 211, 153, 0.4)';
    columns.forEach((col, i) => {
      const char = APP_BACKGROUND_MATRIX_CHARS[Math.floor(Math.random() * APP_BACKGROUND_MATRIX_CHARS.length)];
      ctx.fillText(char, i * APP_BACKGROUND_MATRIX_COL_WIDTH, col.y * 14);
      col.y += col.speed;
      if (col.y * 14 > canvas.height + 20) col.y = Math.random() * -20;
    });
    appBackgroundAnimId = requestAnimationFrame(frame);
  }
  appBackgroundAnimId = requestAnimationFrame(frame);
}

// Plage au lever du soleil (2026-08-15, sur demande explicite) — canvas +
// rAF comme les autres fonds animés, mais avec une scène très majoritairement
// STATIQUE (ciel/soleil/lueur d'horizon/mer/sable) : plutôt que de la
// redessiner à chaque frame (coûteux pour rien, ces éléments ne bougent
// jamais), elle est peinte UNE SEULE FOIS sur un canvas hors écran
// (`staticCanvas`, recréé seulement au resize) et simplement recopiée
// (`drawImage`, une opération bon marché) au début de chaque frame — seuls
// les nuages, les vagues et le scintillement sur l'eau sont redessinés
// dessus à chaque frame. Répartition verticale demandée explicitement :
// ciel 0-50%, horizon/soleil à 50%, mer 50-65%, sable (bas) 65-100%.
function beachDrawStaticScene(staticCanvas, w, h) {
  const sctx = staticCanvas.getContext('2d');
  staticCanvas.width = w;
  staticCanvas.height = h;

  const horizonY = h * 0.5;
  const seaBottomY = h * 0.65;
  const sunRadius = Math.min(w, h) * 0.055;

  // Ciel — dégradé profond en haut, se réchauffe en approchant l'horizon.
  const skyGrad = sctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, '#0f1117');
  skyGrad.addColorStop(0.6, '#1e3a5f');
  skyGrad.addColorStop(1, '#f97316');
  sctx.fillStyle = skyGrad;
  sctx.fillRect(0, 0, w, horizonY);

  // Mer — dégradé profond, de l'horizon jusqu'au sable.
  const seaGrad = sctx.createLinearGradient(0, horizonY, 0, seaBottomY);
  seaGrad.addColorStop(0, '#0a2a3a');
  seaGrad.addColorStop(1, '#0d4f5c');
  sctx.fillStyle = seaGrad;
  sctx.fillRect(0, horizonY, w, seaBottomY - horizonY);

  // Lueur d'horizon — orange → rose → transparent, centrée sur le soleil,
  // se répand largement de part et d'autre ET verticalement (ciel + mer).
  const glow = sctx.createRadialGradient(w / 2, horizonY, 0, w / 2, horizonY, w * 0.42);
  glow.addColorStop(0, 'rgba(249, 115, 22, 0.55)');
  glow.addColorStop(0.5, 'rgba(236, 72, 153, 0.22)');
  glow.addColorStop(1, 'rgba(236, 72, 153, 0)');
  sctx.fillStyle = glow;
  sctx.fillRect(0, horizonY - h * 0.3, w, h * 0.6);

  // Rayons du soleil — traits fins en éventail vers le haut uniquement,
  // opacité dégressive avec la longueur.
  sctx.save();
  sctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
  sctx.lineWidth = 2;
  const rayCount = 12;
  for (let i = 0; i < rayCount; i++) {
    const angle = Math.PI + (Math.PI / (rayCount - 1)) * i; // demi-cercle SUPÉRIEUR (π à 2π)
    const len = sunRadius * (2.4 + (i % 3) * 0.6);
    sctx.beginPath();
    sctx.moveTo(w / 2 + Math.cos(angle) * sunRadius, horizonY + Math.sin(angle) * sunRadius);
    sctx.lineTo(w / 2 + Math.cos(angle) * len, horizonY + Math.sin(angle) * len);
    sctx.stroke();
  }
  sctx.restore();

  // Soleil — cercle doré centré exactement sur la ligne d'horizon (moitié
  // visible au-dessus de l'eau) ; la moitié "immergée" est redessinée
  // par-dessus la mer avec une opacité réduite (légèrement voilée par l'eau).
  sctx.beginPath();
  sctx.fillStyle = '#f59e0b';
  sctx.arc(w / 2, horizonY, sunRadius, Math.PI, Math.PI * 2);
  sctx.fill();
  sctx.save();
  sctx.globalAlpha = 0.45;
  sctx.beginPath();
  sctx.fillStyle = '#f59e0b';
  sctx.arc(w / 2, horizonY, sunRadius, 0, Math.PI);
  sctx.fill();
  sctx.restore();

  // Sable — noir/gris très sombre + grain VISIBLE (2026-08-15, sur demande
  // explicite — remplace le grain translucide précédent, jugé pas assez
  // marqué) : points pleins tirés d'une palette FIXE de 4 gris plutôt qu'une
  // teinte calculée en continu, pour un effet grain net plutôt qu'un simple
  // bruit doux. Densité relevée (900 → 1400) pour un rendu "dense" demandé
  // explicitement. Générés UNE SEULE FOIS ici (scène statique), jamais
  // recalculés à chaque frame.
  sctx.fillStyle = '#1a1a1a';
  sctx.fillRect(0, seaBottomY, w, h - seaBottomY);
  const grainShades = ['#1a1a1a', '#222222', '#2a2a2a', '#333333'];
  for (let i = 0; i < APP_BACKGROUND_BEACH_GRAIN_COUNT; i++) {
    const gx = Math.random() * w;
    const gy = seaBottomY + Math.random() * (h - seaBottomY);
    sctx.fillStyle = grainShades[Math.floor(Math.random() * grainShades.length)];
    sctx.fillRect(gx, gy, Math.random() < 0.5 ? 1 : 2, Math.random() < 0.5 ? 1 : 2);
  }

  // Marques d'ondulation dans le sable (2026-08-15, sur demande explicite) —
  // lignes courbes très discrètes (façon ridules laissées par la marée),
  // quelques arcs légèrement sinueux empilés sur la largeur du sable.
  sctx.save();
  sctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  sctx.lineWidth = 1;
  const rippleRows = 5;
  for (let i = 0; i < rippleRows; i++) {
    const y = seaBottomY + (h - seaBottomY) * (0.15 + i * 0.16) + (Math.random() * 6 - 3);
    sctx.beginPath();
    sctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 40) {
      sctx.quadraticCurveTo(x + 20, y + Math.sin(x * 0.01 + i * 1.7) * 5, x + 40, y);
    }
    sctx.stroke();
  }
  sctx.restore();

  // Parasols + serviettes (2026-08-15, sur demande explicite) — éléments
  // STATIQUES (ne bougent jamais), donc dessinés ici avec le reste de la
  // scène plutôt que dans la boucle d'animation. Parasol 1 à ~25% de la
  // largeur (rayures rouge/blanc), parasol 2 à ~70% (rayures jaune/blanc +
  // détail livre à côté de sa serviette).
  const sandTop = seaBottomY, sandHeight = h - seaBottomY;
  const groundY1 = sandTop + sandHeight * 0.55;
  const groundY2 = sandTop + sandHeight * 0.62;
  const canopyR = Math.min(w, h) * 0.045;

  beachDrawParasol(sctx, w * 0.25, groundY1, canopyR, '#e74c3c', '#ffffff');
  beachDrawTowel(sctx, w * 0.25 + canopyR * 0.9, groundY1 + 6, canopyR * 2.6, canopyR * 1.1, -0.12, '#2f6fa8', '#ffffff');

  beachDrawParasol(sctx, w * 0.7, groundY2, canopyR, '#f1c40f', '#ffffff');
  beachDrawTowel(sctx, w * 0.7 - canopyR * 1.1, groundY2 + 6, canopyR * 2.6, canopyR * 1.1, 0.18, '#e67e22', '#ffffff');
  beachDrawBook(sctx, w * 0.7 - canopyR * 2.7, groundY2 + 8, 0.3);
}

// Parasol — mât (fine ligne brune) + dôme rayé (bandes radiales alternées,
// dessinées via un demi-disque découpé en tranches — même principe qu'un
// diagramme "camembert" mais limité à 180°, plus simple/fiable qu'un tracé
// de bord festonné pour un si petit élément).
function beachDrawParasol(sctx, poleX, groundY, canopyR, colorA, colorB) {
  const canopyY = groundY - canopyR * 2.6;
  const poleTopY = canopyY + canopyR * 0.1;

  sctx.strokeStyle = '#7a4a2b';
  sctx.lineWidth = Math.max(1.5, canopyR * 0.08);
  sctx.lineCap = 'round';
  sctx.beginPath();
  sctx.moveTo(poleX, poleTopY);
  sctx.lineTo(poleX, groundY);
  sctx.stroke();

  const wedgeCount = 8;
  for (let i = 0; i < wedgeCount; i++) {
    const a0 = Math.PI + (Math.PI / wedgeCount) * i;
    const a1 = Math.PI + (Math.PI / wedgeCount) * (i + 1);
    sctx.beginPath();
    sctx.moveTo(poleX, canopyY);
    sctx.arc(poleX, canopyY, canopyR, a0, a1);
    sctx.closePath();
    sctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    sctx.fill();
  }
}

// Serviette de plage — rectangle rayé légèrement penché (angle en radians)
// posé sur le sable.
function beachDrawTowel(sctx, x, y, w, h, angle, colorA, colorB) {
  sctx.save();
  sctx.translate(x, y);
  sctx.rotate(angle);
  const stripeCount = 6;
  const stripeH = h / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    sctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    sctx.fillRect(-w / 2, -h / 2 + i * stripeH, w, stripeH);
  }
  sctx.restore();
}

// Petit détail décoratif à côté de la 2e serviette (demandé explicitement,
// "sandales ou un livre") — un livre entrouvert, 2 rectangles superposés.
function beachDrawBook(sctx, x, y, angle) {
  sctx.save();
  sctx.translate(x, y);
  sctx.rotate(angle);
  sctx.fillStyle = '#c0392b';
  sctx.fillRect(-7, -5, 14, 10);
  sctx.fillStyle = '#f5f0e6';
  sctx.fillRect(-6, -3.5, 12, 7);
  sctx.strokeStyle = 'rgba(0,0,0,0.25)';
  sctx.lineWidth = 0.6;
  sctx.beginPath();
  sctx.moveTo(0, -3.5);
  sctx.lineTo(0, 3.5);
  sctx.stroke();
  sctx.restore();
}

function beachMakeCloud(w, h) {
  return {
    x: Math.random() * w,
    y: h * 0.05 + Math.random() * h * 0.3, // dans le tiers supérieur du ciel, hauteurs variées (profondeur demandée)
    scale: Math.random() * 0.5 + 0.6,
    speed: Math.random() * 0.1 + 0.03, // vitesses variées (profondeur demandée)
  };
}

function beachDrawCloud(ctx, c) {
  const r = 16 * c.scale;
  ctx.save();
  ctx.globalAlpha = 0.7; // demandé explicitement
  ctx.fillStyle = '#e8eaf0';
  ctx.beginPath();
  // Forme nuageuse — plusieurs cercles superposés, silhouette arrondie classique.
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.arc(c.x + r * 0.9, c.y - r * 0.25, r * 0.75, 0, Math.PI * 2);
  ctx.arc(c.x + r * 1.7, c.y + r * 0.05, r * 0.65, 0, Math.PI * 2);
  ctx.arc(c.x + r * 0.9, c.y + r * 0.35, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function startBeachBackground(layer) {
  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');

  let clouds = [];
  let horizonY = 0, seaBottomY = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    horizonY = canvas.height * 0.5;
    seaBottomY = canvas.height * 0.65;
    beachDrawStaticScene(staticCanvas, canvas.width, canvas.height);
    clouds = Array.from({ length: APP_BACKGROUND_BEACH_CLOUD_COUNT }, () => beachMakeCloud(canvas.width, canvas.height));
  }
  resize();
  appBackgroundResizeHandler = resize;
  window.addEventListener('resize', appBackgroundResizeHandler);

  // Vagues qui roulent doucement vers le sable — 3 lignes de crête empilées
  // (légèrement décalées en phase/opacité pour un effet de profondeur),
  // dessinées en sinusoïde qui dérive lentement dans le temps ("rolling in"),
  // avec de petites touches d'écume blanche sur les sommets de vague.
  function beachDrawWaves(t, w) {
    for (let i = 0; i < 3; i++) {
      const yBase = seaBottomY - 10 + i * 5;
      const phase = t * 0.0007 + i * 1.4;
      ctx.beginPath();
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= w; x += 16) {
        ctx.lineTo(x, yBase + Math.sin(x * 0.02 + phase) * 3);
      }
      ctx.strokeStyle = `rgba(13, 79, 92, ${(0.55 - i * 0.15).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Écume — petites touches blanches sur certaines crêtes seulement.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      for (let x = 0; x <= w; x += 16) {
        const y = yBase + Math.sin(x * 0.02 + phase) * 3;
        if (Math.sin(x * 0.05 + phase * 2.2) > 0.75) ctx.fillRect(x, y - 1, 4, 1.5);
      }
    }
  }

  // Reflets scintillants du soleil sur l'eau — quelques points lumineux
  // alignés verticalement sous le soleil, opacité qui pulse indépendamment
  // pour chacun (scintillement), pas un simple reflet statique.
  function beachDrawShimmer(t, w) {
    const cx = w / 2;
    for (let i = 0; i < 8; i++) {
      const y = horizonY + 4 + i * ((seaBottomY - horizonY - 8) / 8);
      const spread = 6 + i * 3;
      const x = cx + Math.sin(t * 0.0015 + i * 2.1) * spread;
      const opacity = 0.25 + 0.35 * Math.abs(Math.sin(t * 0.002 + i * 1.7));
      ctx.fillStyle = `rgba(245, 200, 120, ${opacity.toFixed(2)})`;
      ctx.fillRect(x, y, 10, 1.5);
    }
  }

  function frame(t) {
    ctx.drawImage(staticCanvas, 0, 0);
    beachDrawShimmer(t, canvas.width);
    beachDrawWaves(t, canvas.width);
    for (const c of clouds) {
      c.x += c.speed;
      if (c.x - 60 * c.scale > canvas.width) c.x = -60 * c.scale; // ressort à gauche, dérive gauche→droite en boucle
      beachDrawCloud(ctx, c);
    }
    appBackgroundAnimId = requestAnimationFrame(frame);
  }
  appBackgroundAnimId = requestAnimationFrame(frame);
}

// Lever de soleil en montagne (2026-08-16, sur demande explicite) — même
// principe statique+rAF que la plage (voir startBeachBackground juste
// au-dessus) : le ciel/étoiles/2 couches de montagnes lointaines/proches ne
// bougent JAMAIS, peints une seule fois sur `staticCanvas` au resize.
// Contrairement à la plage, le soleil/sa lueur/ses rayons/la montagne du
// PREMIER PLAN sont eux redessinés à CHAQUE frame (pas dans le statique) :
// la lueur doit "pulser" (opacité qui varie dans le temps, demandé
// explicitement), et la montagne du premier plan doit rester peinte
// PAR-DESSUS le soleil (occultation) — un ordre qu'un simple drawImage
// statique ne permettrait pas de faire varier frame par frame.
function mountainProfileY(t, baseY, amp, freq, jagAmp, jagFreq, centerBoost, centerWidth) {
  const wave = Math.sin(t * Math.PI * freq) * amp;
  const jag = jagAmp ? Math.sin(t * Math.PI * jagFreq + 0.6) * jagAmp : 0;
  const center = centerBoost ? centerBoost * Math.exp(-(((t - 0.5) * centerWidth) ** 2)) : 0;
  return baseY - wave - jag - center;
}

function mountainDrawLayer(ctx, w, h, color, opts) {
  ctx.beginPath();
  ctx.moveTo(0, h);
  const step = 6;
  for (let x = 0; x <= w; x += step) {
    ctx.lineTo(x, mountainProfileY(x / w, opts.baseY, opts.amp, opts.freq, opts.jagAmp, opts.jagFreq, opts.centerBoost, opts.centerWidth));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Ciel + étoiles + les 2 couches de montagnes les plus ÉLOIGNÉES (jamais
// occultées par le soleil, donc safe à peindre une fois pour toutes ici) —
// la 3e couche (premier plan, celle qui cache le soleil) est peinte à
// chaque frame par mountainDrawForeground, PAS ici.
function mountainDrawStaticScene(staticCanvas, w, h) {
  const sctx = staticCanvas.getContext('2d');
  staticCanvas.width = w;
  staticCanvas.height = h;

  // Ciel — bleu profond en haut (0-60%), se réchauffe en orange/rose en
  // approchant l'horizon derrière la montagne (demandé explicitement).
  const skyGrad = sctx.createLinearGradient(0, 0, 0, h * 0.6);
  skyGrad.addColorStop(0, '#0a0a1a');
  skyGrad.addColorStop(0.55, '#1a2a4a');
  skyGrad.addColorStop(0.85, '#e8703a');
  skyGrad.addColorStop(1, '#f9a978');
  sctx.fillStyle = skyGrad;
  sctx.fillRect(0, 0, w, h);

  // Étoiles — 2-3 points ténus tout en haut seulement, opacité dégressive
  // (celle du haut la plus visible) pour suggérer qu'elles s'effacent à
  // mesure que le soleil se lève, sans animation de disparition réelle.
  sctx.save();
  const starSpots = [[0.18, 0.05], [0.62, 0.03], [0.85, 0.08]];
  starSpots.slice(0, APP_BACKGROUND_MOUNTAIN_STAR_COUNT).forEach(([sx, sy], i) => {
    sctx.globalAlpha = 0.5 - i * 0.12;
    sctx.fillStyle = '#e8eaf0';
    sctx.beginPath();
    sctx.arc(w * sx, h * sy, 1.3, 0, Math.PI * 2);
    sctx.fill();
  });
  sctx.restore();

  // Montagnes lointaines — silhouette lisse (une seule sinusoïde, pas de
  // bruit secondaire), pleine largeur, la plus petite/claire des 3. Pics
  // volontairement plus hauts (y plus petit) que le premier plan HORS de son
  // pic central : en peinture par couches façon parallaxe, la couche la
  // plus proche (premier plan) est la plus LARGE/imposante à l'écran mais
  // ses propres pics restent plus bas que les couches lointaines, dont les
  // sommets dépassent dans les creux du premier plan — c'est ce qui rend
  // les 2 couches lointaines réellement visibles (silhouette "en dents de
  // scie" qui dépasse) plutôt que totalement cachées dessous.
  mountainDrawLayer(sctx, w, h, '#1a2a3a', { baseY: h * 0.72, amp: h * 0.06, freq: 2.2, jagAmp: 0, jagFreq: 0, centerBoost: 0, centerWidth: 0 });

  // Montagnes intermédiaires — plus déchiquetées (bruit secondaire
  // superposé à la sinusoïde de base), légèrement plus hautes/foncées.
  mountainDrawLayer(sctx, w, h, '#0f1a2a', { baseY: h * 0.77, amp: h * 0.1, freq: 3.4, jagAmp: h * 0.025, jagFreq: 9, centerBoost: 0, centerWidth: 0 });
}

// Montagne du premier plan — silhouette la plus sombre/déchiquetée, avec un
// pic CENTRAL surélevé (`centerBoost`, gaussienne) qui vient juste recouvrir
// le bas du soleil (voir calcul de `centerBoost` dans startMountainBackground,
// basé sur `apexY` = juste sous le sommet du disque solaire) — c'est cette
// occultation qui produit "seul l'arc supérieur du soleil visible".
function mountainDrawForeground(ctx, w, h, centerBoost) {
  mountainDrawLayer(ctx, w, h, '#0a0f1a', {
    baseY: h * 0.85, amp: h * 0.045, freq: 2.6, jagAmp: h * 0.025, jagFreq: 11,
    centerBoost, centerWidth: 5.5,
  });
}

// Lueur radiale derrière le pic — pulse lentement (opacité modulée par
// `pulse`, un sinus lent calculé dans la boucle d'animation) plutôt que
// rester fixe, demandé explicitement ("glow brightens/dims slowly").
function mountainDrawGlow(ctx, w, sunCenterY, sunRadius, pulse) {
  const glow = ctx.createRadialGradient(w / 2, sunCenterY, 0, w / 2, sunCenterY, sunRadius * 5);
  glow.addColorStop(0, `rgba(245, 158, 11, ${(0.5 + pulse * 0.25).toFixed(2)})`);
  glow.addColorStop(0.4, `rgba(249, 115, 22, ${(0.22 + pulse * 0.1).toFixed(2)})`);
  glow.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, sunCenterY - sunRadius * 5, w, sunRadius * 6);
}

function mountainDrawSun(ctx, w, sunCenterY, sunRadius) {
  ctx.beginPath();
  ctx.fillStyle = '#f59e0b';
  ctx.arc(w / 2, sunCenterY, sunRadius, 0, Math.PI * 2);
  ctx.fill();
}

// Rayons — même technique que la plage (startBeachBackground) : éventail de
// traits sur le DEMI-CERCLE SUPÉRIEUR uniquement (π à 2π), ce qui donne
// naturellement des rayons qui "partent vers la gauche et la droite" en
// balayant par le haut, exactement la formulation demandée. Opacité liée au
// même `pulse` que la lueur pour une pulsation cohérente.
function mountainDrawRays(ctx, w, sunCenterY, sunRadius, pulse) {
  ctx.save();
  ctx.strokeStyle = `rgba(245, 158, 11, ${(0.22 + pulse * 0.12).toFixed(2)})`;
  ctx.lineWidth = 2;
  const rayCount = 14;
  for (let i = 0; i < rayCount; i++) {
    const angle = Math.PI + (Math.PI / (rayCount - 1)) * i;
    const len = sunRadius * (2 + (i % 3) * 0.5);
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(angle) * sunRadius * 0.9, sunCenterY + Math.sin(angle) * sunRadius * 0.9);
    ctx.lineTo(w / 2 + Math.cos(angle) * len, sunCenterY + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function mountainMakeBird(w, h) {
  return {
    x: Math.random() * w,
    y: h * 0.12 + Math.random() * h * 0.25,
    speed: Math.random() * 0.18 + 0.08, // lent — "flying slowly" demandé explicitement
    span: Math.random() * 4 + 8,
  };
}

// Oiseau — simple "V" (2 segments), forme minimale demandée explicitement.
function mountainDrawBird(ctx, b) {
  ctx.save();
  ctx.strokeStyle = 'rgba(232, 234, 240, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(b.x - b.span, b.y + b.span * 0.4);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b.x + b.span, b.y + b.span * 0.4);
  ctx.stroke();
  ctx.restore();
}

function startMountainBackground(layer) {
  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');

  let birds = [];
  let sunCenterY = 0, sunRadius = 0, foregroundCenterBoost = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    sunCenterY = canvas.height * 0.56;
    sunRadius = Math.min(canvas.width, canvas.height) * 0.09;
    // Le pic central doit atteindre juste sous le sommet du soleil (25% du
    // rayon visible au-dessus, voir commentaire de mountainDrawForeground) —
    // recalculé ici (dépend de sunCenterY/sunRadius, eux-mêmes dépendants de
    // la taille de fenêtre) plutôt que codé en dur dans mountainDrawForeground.
    const apexY = sunCenterY - sunRadius * 0.75;
    foregroundCenterBoost = canvas.height * 0.85 - apexY;
    mountainDrawStaticScene(staticCanvas, canvas.width, canvas.height);
    birds = Array.from({ length: APP_BACKGROUND_MOUNTAIN_BIRD_COUNT }, () => mountainMakeBird(canvas.width, canvas.height));
  }
  resize();
  appBackgroundResizeHandler = resize;
  window.addEventListener('resize', appBackgroundResizeHandler);

  function frame(t) {
    ctx.drawImage(staticCanvas, 0, 0);
    const pulse = Math.sin(t * 0.0005) * 0.5 + 0.5; // 0..1, lent — "slowly" demandé explicitement
    mountainDrawGlow(ctx, canvas.width, sunCenterY, sunRadius, pulse);
    mountainDrawSun(ctx, canvas.width, sunCenterY, sunRadius);
    mountainDrawRays(ctx, canvas.width, sunCenterY, sunRadius, pulse);
    mountainDrawForeground(ctx, canvas.width, canvas.height, foregroundCenterBoost);
    for (const b of birds) {
      b.x += b.speed;
      if (b.x - b.span > canvas.width) b.x = -b.span; // ressort à gauche, dérive gauche→droite en boucle
      mountainDrawBird(ctx, b);
    }
    appBackgroundAnimId = requestAnimationFrame(frame);
  }
  appBackgroundAnimId = requestAnimationFrame(frame);
}

function applyAppBackground(key) {
  const layer = document.getElementById('appBackgroundLayer');
  if (!layer) return;
  lastAppBackgroundKey = key || 'none';
  clearAppBackground();
  if (!key || key === 'none') return;

  const theme = document.documentElement.dataset.colorScheme === 'light' ? 'light' : 'dark';
  if (theme === 'dark' && !APP_BACKGROUND_DARK_KEYS.includes(key)) return;
  if (theme === 'light' && !APP_BACKGROUND_LIGHT_KEYS.includes(key)) return;

  layer.classList.add(`bg-${key}`);
  if (key === 'stars') startStarsBackground(layer);
  else if (key === 'particles') startParticlesBackground(layer);
  else if (key === 'rain') startRainBackground(layer);
  else if (key === 'snow') startSnowBackground(layer);
  else if (key === 'matrix') startMatrixBackground(layer);
  else if (key === 'beach') startBeachBackground(layer);
  else if (key === 'mountain') startMountainBackground(layer);
  // aurora/nebula/paper/geometric/gradient : pur CSS via la classe bg-<clé> posée ci-dessus, rien d'autre à faire.
}

function initAppBackground() {
  window.matin.store.get('app.background').then((key) => applyAppBackground(key || 'none'));
  window.matin.background.onUpdated((key) => applyAppBackground(key));
}

// ─── Alertes — bandeau plein écran (2026-08-08, sur demande explicite) ─────
// PAS un module carte : contourne délibérément MODULE_REGISTRY/
// createModuleCard, voir index.html (#alertsBanner, fixe, au-dessus de
// TOUTES les cartes) — le check lui-même (scraping, notifications) tourne
// côté process main (voir main.js, checkAlerts) ; ce fichier ne fait
// qu'afficher l'instantané reçu (getCurrent au chargement, onUpdate ensuite,
// aucun polling côté renderer). `#dashboard` voit son `top` repoussé
// dynamiquement (mesuré via getBoundingClientRect, même principe que
// playSplashAnimation plus bas pour le déclenchement du fondu) pour qu'aucune
// carte ne se retrouve sous le bandeau, quelle que soit sa hauteur réelle
// (variable selon le nombre d'alertes actives et le retour à la ligne du texte).
const ALERTS_SEVERITY_ICON = { red: '🔴', orange: '🟠' };

function renderAlertsBanner(alerts) {
  const banner = document.getElementById('alertsBanner');
  const dashboard = document.getElementById('dashboard');
  if (!banner || !dashboard) return;

  if (!Array.isArray(alerts) || !alerts.length) {
    banner.classList.remove('visible', 'severity-red', 'severity-orange');
    banner.innerHTML = '';
    dashboard.style.top = '';
    return;
  }

  const worstSeverity = alerts.some(a => a.severity === 'red') ? 'red' : 'orange';
  banner.classList.add('visible');
  banner.classList.toggle('severity-red', worstSeverity === 'red');
  banner.classList.toggle('severity-orange', worstSeverity === 'orange');

  banner.innerHTML = alerts.map(a => `
    <div class="alerts-banner-item" data-link="${a.link}">
      <span class="alerts-banner-icon">${a.icon}</span>
      <span class="alerts-banner-text">${a.text}</span>
      <span class="alerts-banner-link">${ALERTS_SEVERITY_ICON[a.severity] || ''} En savoir plus →</span>
    </div>
  `).join('');

  banner.querySelectorAll('.alerts-banner-item').forEach((el) => {
    el.addEventListener('click', () => window.matin.shell.openExternal(el.dataset.link));
  });

  // Mesuré APRÈS peuplement (la hauteur dépend du nombre d'alertes/du retour
  // à la ligne du texte, jamais fixe) — repousse #dashboard d'exactement ce
  // qu'il faut, ni plus (espace perdu) ni moins (carte cachée sous le bandeau).
  const bannerHeight = banner.getBoundingClientRect().height;
  dashboard.style.top = `calc(var(--titlebar-h) + ${bannerHeight}px)`;
}

function initAlertsBanner() {
  window.matin.alerts.getCurrent().then(renderAlertsBanner).catch(err => console.error('[Alertes] Échec chargement initial', err));
  window.matin.alerts.onUpdate(renderAlertsBanner);
}

function createModuleCard(key, meta, title) {
  const card = document.createElement('div');
  card.className = 'module-card';
  card.id = `module-${key}`;
  // Bordure gauche + couleur d'icône par catégorie (2026-08-08, voir
  // MODULE_REGISTRY.theme et style.css .module-card[data-theme]) — le module
  // Sports (ol) écrase cette valeur de départ une fois le sport de l'équipe
  // réellement résolu (voir ol.js).
  if (meta.theme) card.dataset.theme = meta.theme;
  const clickable = isSportsKey(key) || Object.prototype.hasOwnProperty.call(MODULE_CLICK_URLS, key);
  card.innerHTML = `
    <div class="module-header">
      <div class="module-title${clickable ? ' module-title-clickable' : ''}" title="${clickable ? 'Ouvrir le site' : ''}">
        <span class="module-icon">${meta.icon}</span>
        ${title}${key === 'tradfri' ? ' <span class="beta-badge">Bêta</span>' : ''}
      </div>
      <span class="module-badge" id="badge-${key}">…</span>
    </div>
    <div class="module-content" id="content-${key}">
      <div class="loading-spinner" style="margin:12px auto;width:18px;height:18px"></div>
    </div>
    <div class="resize-handle" title="Redimensionner"></div>
  `;
  if (clickable) {
    card.querySelector('.module-title').addEventListener('click', () => {
      const url = resolveModuleClickUrl(key, card);
      if (url) window.matin.shell.openExternal(url);
    });
  }
  return card;
}

// ─── Disposition libre ─────────────────────────────────────────────────────────
let modulesConf = null;
let topZ = 10;

// Disposition initiale façon "étagères" — uniquement pour les modules sans
// position enregistrée (premier lancement, ou module nouvellement activé).
function computeDefaultLayout(keys, containerWidth) {
  const gap = 16;
  let x = 0, y = 0, rowHeight = 0;
  const layouts = {};
  for (const key of keys) {
    const meta = resolveModuleMeta(key);
    if (!meta) continue;
    const { w, h } = meta.defaultSize;
    if (x > 0 && x + w > containerWidth) {
      x = 0;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    layouts[key] = { x, y, width: w, height: h, z: 10 };
    x += w + gap;
    rowHeight = Math.max(rowHeight, h);
  }
  return layouts;
}

// ─── "⊞ Réorganiser" — bin-packing par catégorie (2026-08-10, sur demande
// explicite) ─────────────────────────────────────────────────────────────
// Contrairement à computeDefaultLayout ci-dessus (simple empilement en
// étagères, AUCUNE compaction — une carte plus courte que sa voisine de
// rangée laisse un vrai trou en dessous), ceci implémente un algorithme de
// bin-packing "skyline" classique : traite les modules du plus haut au plus
// bas, et pour chacun cherche la position la plus BASSE possible en balayant
// l'horizon déjà occupé ("skyline", une liste de segments {x, largeur,
// hauteur}) plutôt que de simplement continuer la rangée courante — comble
// activement les creux au lieu de les ignorer.
//
// Groupé par CATÉGORIE d'abord (thème réel de chaque carte, lu sur
// `card.dataset.theme` — pas `MODULE_REGISTRY[key].theme`, qui pour Sports
// (ol) n'est qu'une valeur de départ avant résolution du sport réel, voir
// olThemeForSport) : chaque catégorie occupe sa propre "bande" horizontale
// empilée verticalement, le bin-packing skyline ne s'exécutant QU'À
// L'INTÉRIEUR d'une bande — garantit que les catégories restent groupées
// visuellement (demandé explicitement : "Finance together, Actualités
// together, Sports together") plutôt que mélangées par un bin-packing global
// qui optimiserait la compaction au détriment du regroupement. Les 3 thèmes
// de sport (football/basket/other-sports) sont volontairement adjacents dans
// CATEGORY_ORDER pour former UNE seule bande "Sports" visuelle malgré leurs
// 3 valeurs de thème distinctes.
const AUTOARRANGE_CATEGORY_ORDER = [
  'finance', 'football', 'basket', 'other-sports', 'actualites',
  'fdj', 'musique', 'maison', 'services', 'perso',
];
const AUTOARRANGE_GAP = 16;

// Cherche la position la plus basse (puis la plus à gauche en cas d'égalité)
// où un rectangle de largeur `width` peut se poser sur le skyline actuel.
// Les positions candidates sont TOUJOURS le début d'un segment existant —
// suffisant pour un skyline correctement fusionné (voir skylineInsert), pas
// besoin de tester des positions arbitraires.
function skylineFindPosition(skyline, width, containerWidth) {
  let bestY = Infinity, bestX = 0, found = false;
  for (const segment of skyline) {
    const startX = segment.x;
    if (startX + width > containerWidth + 0.5) continue;
    let y = 0, covered = 0;
    for (const s of skyline) {
      if (s.x + s.width <= startX || s.x >= startX + width) continue;
      y = Math.max(y, s.y);
      covered += Math.min(s.x + s.width, startX + width) - Math.max(s.x, startX);
    }
    if (covered + 0.5 < width) continue; // le skyline s'arrête avant la fin du rectangle
    if (y < bestY - 0.01 || (Math.abs(y - bestY) < 0.01 && startX < bestX)) {
      bestY = y; bestX = startX; found = true;
    }
  }
  if (!found) return { x: 0, y: Math.max(...skyline.map(s => s.y)) };
  return { x: bestX, y: bestY };
}

// Remplace la portion du skyline couverte par [x, x+width] par un unique
// nouveau segment à `y` — les segments partiellement recouverts sont
// tronqués (pas supprimés), jamais étendus au-delà de ce qu'ils couvraient
// déjà. Fusionne ensuite les segments adjacents de même hauteur : sans ça,
// le skyline se fragmenterait indéfiniment au fil des insertions, ce qui
// n'affecterait pas la correction de l'algorithme mais ferait grandir son
// coût sans raison sur un dashboard à beaucoup de modules.
function skylineInsert(skyline, x, width, y) {
  const x2 = x + width;
  const next = [];
  for (const seg of skyline) {
    const segX2 = seg.x + seg.width;
    if (segX2 <= x || seg.x >= x2) { next.push(seg); continue; }
    if (seg.x < x) next.push({ x: seg.x, width: x - seg.x, y: seg.y });
    if (segX2 > x2) next.push({ x: x2, width: segX2 - x2, y: seg.y });
  }
  next.push({ x, width, y });
  next.sort((a, b) => a.x - b.x);
  const merged = [];
  for (const seg of next) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.y - seg.y) < 0.01 && Math.abs(last.x + last.width - seg.x) < 0.5) {
      last.width += seg.width;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// `cardsInfo` : [{ key, width, height, theme }] — tailles ACTUELLES lues sur
// les cartes réelles (respecte la taille de chaque module, jamais touchée par
// aucun des styles ci-dessous). Regroupe par catégorie réelle (thème de la
// carte), 'perso' en repli pour tout thème non listé dans
// AUTOARRANGE_CATEGORY_ORDER — brique partagée par les 5 styles de
// disposition (2026-08-10, sur demande explicite, remplace l'unique
// autoArrangeLayout d'origine).
function buildCategoryMap(cardsInfo) {
  const byCategory = new Map(AUTOARRANGE_CATEGORY_ORDER.map(c => [c, []]));
  for (const info of cardsInfo) {
    const cat = byCategory.has(info.theme) ? info.theme : 'perso';
    byCategory.get(cat).push(info);
  }
  return byCategory;
}

// Empile les catégories données (dans l'ordre reçu) en bandes verticales par
// bin-packing skyline, confiné à une région horizontale [regionX,
// regionX+regionWidth] plutôt que toute la largeur du conteneur — permet de
// composer plusieurs colonnes/zones (voir les 5 fonctions autoArrangeLayoutX
// ci-dessous). Empaqueté en coordonnées LOCALES (0..regionWidth) puis
// translaté de regionX à la fin, pour réutiliser skylineFindPosition/
// skylineInsert tels quels (ils supposent un skyline démarrant à x:0).
// Une carte plus large que sa région (ex. ETF/Crypto, 700px, dans une
// colonne compacte) n'est JAMAIS rétrécie (la taille des modules doit rester
// intacte) : skylineFindPosition ne trouvera aucune position valide et
// retombera sur son repli (x:0 local, sous tout le reste de la région) —
// dégradation gracieuse acceptée plutôt qu'un système multi-colonnes
// pleinement "overflow-safe", hors de proportion pour un simple confort de
// réorganisation.
function packCategoriesInRegion(byCategory, categories, regionX, regionWidth, startY, gap = AUTOARRANGE_GAP) {
  const layouts = {};
  let bandY = startY;
  for (const cat of categories) {
    const items = byCategory.get(cat);
    if (!items || !items.length) continue;
    const sorted = [...items].sort((a, b) => b.height - a.height);
    let skyline = [{ x: 0, width: regionWidth, y: bandY }];
    let bandBottom = bandY;
    for (const item of sorted) {
      const { x, y } = skylineFindPosition(skyline, item.width, regionWidth);
      layouts[item.key] = { x: regionX + x, y, width: item.width, height: item.height, z: 10 };
      skyline = skylineInsert(skyline, x, item.width, y + item.height + gap);
      bandBottom = Math.max(bandBottom, y + item.height);
    }
    bandY = bandBottom + gap;
  }
  return { layouts, bottom: bandY };
}

// Regroupement nommé utilisé par Éditorial ci-dessous (seul style à isoler
// une catégorie unique dans sa propre région) — les autres styles retenus
// dans la réduction à 6 dispositions (2026-08-11) travaillent tous
// directement sur AUTOARRANGE_CATEGORY_ORDER.
const AUTOARRANGE_GROUP = {
  actualites: ['actualites'],
};

// 6 dispositions nommées (2026-08-11, sur demande explicite — réduit de 5
// dispositions non nommées A-E à 6 dispositions nommées : 3 "aléatoires"
// reprises/renommées depuis B/D/E ci-dessous, qui couvraient déjà bien ces 3
// intentions, + 3 nouvelles "compactes" plus denses, gap réduit — A et C
// retirées, redondantes avec les autres) — tirées au sort à chaque clic sur
// "⊞ Réorganiser" (jamais 2 fois de suite la même, voir
// pickRandomAutoArrangeStyle), chacune respecte le regroupement par catégorie
// (aucun module ne se retrouve isolé de sa catégorie).

// Prioritaire — Modules prioritaires (ETF, Gmail, Agenda) côte à côte en haut
// à leur taille réelle, reste du dashboard en bandes classiques pleine
// largeur en dessous. `remainingByCategory` retire les 3 clés prioritaires de
// leur groupe pour ne jamais les dupliquer dans la passe du bas.
const AUTOARRANGE_PRIORITY_KEYS = ['etf', 'gmail', 'calendar'];

function autoArrangeLayoutPrioritaire(cardsInfo, byCategory, containerWidth) {
  const priorityInfo = AUTOARRANGE_PRIORITY_KEYS
    .map(key => cardsInfo.find(c => c.key === key))
    .filter(Boolean);

  const layouts = {};
  let x = 0, rowBottom = 0;
  for (const info of priorityInfo) {
    layouts[info.key] = { x, y: 0, width: info.width, height: info.height, z: 10 };
    x += info.width + AUTOARRANGE_GAP;
    rowBottom = Math.max(rowBottom, info.height);
  }
  const startY = priorityInfo.length ? rowBottom + AUTOARRANGE_GAP : 0;

  const remainingByCategory = new Map();
  for (const [cat, items] of byCategory) {
    remainingByCategory.set(cat, items.filter(i => !AUTOARRANGE_PRIORITY_KEYS.includes(i.key)));
  }
  const rRest = packCategoriesInRegion(remainingByCategory, AUTOARRANGE_CATEGORY_ORDER, 0, containerWidth, startY);

  return { ...layouts, ...rRest.layouts };
}

// Éditorial — Grande zone Actualités à gauche (60% de la largeur), tout le
// reste empilé en colonne compacte à droite (40%).
function autoArrangeLayoutEditorial(byCategory, containerWidth) {
  const leftWidth = Math.round(containerWidth * 0.6) - AUTOARRANGE_GAP / 2;
  const rightX = leftWidth + AUTOARRANGE_GAP;
  const rightWidth = containerWidth - rightX;
  const rightCats = ['finance', 'football', 'basket', 'other-sports', 'fdj', 'musique', 'maison', 'services', 'perso'];

  const rLeft = packCategoriesInRegion(byCategory, AUTOARRANGE_GROUP.actualites, 0, leftWidth, 0);
  const rRight = packCategoriesInRegion(byCategory, rightCats, rightX, rightWidth, 0);
  return { ...rLeft.layouts, ...rRight.layouts };
}

// Équilibré — Disposition symétrique : 3 colonnes égales, catégories
// réparties en tour de table (round-robin) entre les 3, dans l'ordre
// AUTOARRANGE_CATEGORY_ORDER.
function autoArrangeLayoutEquilibre(byCategory, containerWidth) {
  const colWidth = (containerWidth - AUTOARRANGE_GAP * 2) / 3;
  const colsX = [0, colWidth + AUTOARRANGE_GAP, (colWidth + AUTOARRANGE_GAP) * 2];
  const colCats = [[], [], []];
  AUTOARRANGE_CATEGORY_ORDER.forEach((cat, i) => colCats[i % 3].push(cat));

  let layouts = {};
  for (let i = 0; i < 3; i++) {
    const r = packCategoriesInRegion(byCategory, colCats[i], colsX[i], colWidth, 0);
    layouts = { ...layouts, ...r.layouts };
  }
  return layouts;
}

// Gap réduit pour les 3 dispositions "compactes" ci-dessous — c'est ce qui
// les distingue avant tout des 3 "aléatoires" : moins d'espace perdu entre
// les cartes, dashboard plus dense verticalement.
const AUTOARRANGE_GAP_COMPACT = 8;

// Compact Thèmes — une seule colonne pleine largeur, catégories empilées en
// bandes successives dans AUTOARRANGE_CATEGORY_ORDER, gap resserré : la
// disposition la plus dense en largeur (chaque bande profite de toute la
// largeur disponible pour son bin-packing).
function autoArrangeLayoutCompactThemes(byCategory, containerWidth) {
  const r = packCategoriesInRegion(byCategory, AUTOARRANGE_CATEGORY_ORDER, 0, containerWidth, 0, AUTOARRANGE_GAP_COMPACT);
  return r.layouts;
}

// Compact Colonnes — 4 colonnes étroites (contre 3 pour Équilibré), mêmes
// catégories réparties en tour de table, gap resserré : plus de colonnes +
// gap réduit = hauteur totale généralement plus courte qu'Équilibré.
function autoArrangeLayoutCompactColonnes(byCategory, containerWidth) {
  const colCount = 4;
  const colWidth = (containerWidth - AUTOARRANGE_GAP_COMPACT * (colCount - 1)) / colCount;
  const colsX = Array.from({ length: colCount }, (_, i) => i * (colWidth + AUTOARRANGE_GAP_COMPACT));
  const colCats = Array.from({ length: colCount }, () => []);
  AUTOARRANGE_CATEGORY_ORDER.forEach((cat, i) => colCats[i % colCount].push(cat));

  let layouts = {};
  for (let i = 0; i < colCount; i++) {
    const r = packCategoriesInRegion(byCategory, colCats[i], colsX[i], colWidth, 0, AUTOARRANGE_GAP_COMPACT);
    layouts = { ...layouts, ...r.layouts };
  }
  return layouts;
}

// Compact Mosaïque — 2 colonnes larges, catégories assignées PAR ORDRE DE
// HAUTEUR DÉCROISSANTE (pas round-robin) à la colonne actuellement la plus
// courte (bin-packing glouton classique pour équilibrer une mise en page
// masonry) : les 2 colonnes finissent à une hauteur proche l'une de l'autre,
// contrairement à Compact Colonnes où l'assignation est fixe.
function autoArrangeLayoutCompactMosaique(byCategory, containerWidth) {
  const colCount = 2;
  const colWidth = (containerWidth - AUTOARRANGE_GAP_COMPACT * (colCount - 1)) / colCount;
  const colsX = Array.from({ length: colCount }, (_, i) => i * (colWidth + AUTOARRANGE_GAP_COMPACT));
  const colCats = Array.from({ length: colCount }, () => []);
  const colHeight = Array.from({ length: colCount }, () => 0);

  const catTotalHeight = new Map();
  for (const cat of AUTOARRANGE_CATEGORY_ORDER) {
    const items = byCategory.get(cat) || [];
    catTotalHeight.set(cat, items.reduce((sum, it) => sum + it.height, 0));
  }
  const sortedCats = [...AUTOARRANGE_CATEGORY_ORDER]
    .filter(cat => (byCategory.get(cat) || []).length)
    .sort((a, b) => catTotalHeight.get(b) - catTotalHeight.get(a));

  for (const cat of sortedCats) {
    const shortest = colHeight.indexOf(Math.min(...colHeight));
    colCats[shortest].push(cat);
    colHeight[shortest] += catTotalHeight.get(cat) + AUTOARRANGE_GAP_COMPACT;
  }

  let layouts = {};
  for (let i = 0; i < colCount; i++) {
    const r = packCategoriesInRegion(byCategory, colCats[i], colsX[i], colWidth, 0, AUTOARRANGE_GAP_COMPACT);
    layouts = { ...layouts, ...r.layouts };
  }
  return layouts;
}

const AUTOARRANGE_STYLES = ['prioritaire', 'editorial', 'equilibre', 'compact-themes', 'compact-colonnes', 'compact-mosaique'];
const AUTOARRANGE_STYLE_LABELS = {
  prioritaire: 'Prioritaire',
  editorial: 'Éditorial',
  equilibre: 'Équilibré',
  'compact-themes': 'Compact Thèmes',
  'compact-colonnes': 'Compact Colonnes',
  'compact-mosaique': 'Compact Mosaïque',
};
let lastAutoArrangeStyle = null;

// Ne tire jamais 2 fois de suite le même style (demandé explicitement) — se
// réinitialise à chaque rechargement du dashboard (state en mémoire, pas
// persisté), sans conséquence pratique.
function pickRandomAutoArrangeStyle() {
  const choices = AUTOARRANGE_STYLES.filter(s => s !== lastAutoArrangeStyle);
  const pick = choices[Math.floor(Math.random() * choices.length)];
  lastAutoArrangeStyle = pick;
  return pick;
}

function computeAutoArrangeLayout(style, cardsInfo, byCategory, containerWidth) {
  switch (style) {
    case 'prioritaire':        return autoArrangeLayoutPrioritaire(cardsInfo, byCategory, containerWidth);
    case 'editorial':          return autoArrangeLayoutEditorial(byCategory, containerWidth);
    case 'equilibre':          return autoArrangeLayoutEquilibre(byCategory, containerWidth);
    case 'compact-themes':     return autoArrangeLayoutCompactThemes(byCategory, containerWidth);
    case 'compact-colonnes':   return autoArrangeLayoutCompactColonnes(byCategory, containerWidth);
    case 'compact-mosaique':   return autoArrangeLayoutCompactMosaique(byCategory, containerWidth);
    default:                   return autoArrangeLayoutEquilibre(byCategory, containerWidth);
  }
}

// ─── Tenir sur un seul écran (2026-08-11, sur demande explicite) ───────────
// Les 6 dispositions ci-dessus n'ont jamais tenu compte de la hauteur
// disponible : chaque catégorie empile ses bandes vers le bas sans limite,
// ce qui produit une page de plus en plus longue (et un scroll systématique)
// dès que le nombre de modules dépasse ce qui tenait par hasard dans la
// fenêtre. Plutôt que de réécrire les 6 fonctions ci-dessus (qui gèrent
// chacune leur propre logique de regroupement/colonnes), une passe de
// RÉTRÉCISSEMENT GLOBAL itère par-dessus : recalcule la même disposition
// avec des cartes proportionnellement plus petites jusqu'à ce que tout tienne
// dans `containerHeight`, ou jusqu'à un plancher de sécurité (0.35) — au-delà
// duquel on abandonne et on l'assume clairement (voir le texte de la notice
// dans performAutoArrange) plutôt que de continuer à rétrécir jusqu'à
// l'illisible.
//
// Rétrécir change aussi la RÉPARTITION horizontale : des cartes plus
// étroites laissent le bin-packing skyline en poser davantage côte à côte
// dans la même largeur de conteneur — le remplissage horizontal ET vertical
// demandé est donc satisfait par ce seul mécanisme, sans logique séparée.
const AUTOARRANGE_PRIORITY_SIZE_KEYS = ['etf', 'weather', 'gmail', 'calendar'];
const AUTOARRANGE_LOW_PRIORITY_SIZE_KEYS = ['fdjLoto', 'fdjEuromillions', 'fdjEurodreams', 'fuelPrices', 'maps'];

// Plancher par module, en proportion de sa taille ACTUELLE (pas de son
// defaultSize — un module déjà agrandi manuellement doit rétrécir depuis SA
// taille, pas revenir arbitrairement à une valeur d'usine). Modules
// prioritaires : ne descendent quasiment pas (0.8, "reste lisible"). Modules
// secondaires cités explicitement : peuvent moitié-fondre (0.5). Tout le
// reste : compromis raisonnable (0.65).
function autoArrangeSizeRatioFor(key) {
  if (AUTOARRANGE_PRIORITY_SIZE_KEYS.includes(key)) return 0.8;
  if (AUTOARRANGE_LOW_PRIORITY_SIZE_KEYS.includes(key)) return 0.5;
  return 0.65;
}

// Construit un jeu de cardsInfo à l'échelle `scale`, chaque carte plafonnée à
// son propre plancher (voir autoArrangeSizeRatioFor) et au plancher ABSOLU de
// l'appli (MIN_WIDTH/MIN_HEIGHT, celui déjà utilisé par le redimensionnement
// manuel à la souris — jamais une carte plus petite que ça où que ce soit).
// Hauteur JAMAIS réduite pour les modules à hauteur auto (ETF/Crypto/FDJ/
// Prêts, voir isAutoHeightKey) : leur vraie hauteur suit leur contenu
// (placeCard n'applique jamais de height inline pour ces clés) — un chiffre
// plus petit ici ne rétrécirait pas la carte réelle, seulement le calcul de
// place réservée par le bin-packing, ce qui provoquerait un chevauchement
// visuel avec la carte suivante.
function scaledCardsInfo(cardsInfo, scale) {
  return cardsInfo.map(info => {
    const ratio = autoArrangeSizeRatioFor(info.key);
    const minWidth = Math.max(MIN_WIDTH, Math.round(info.width * ratio));
    const width = Math.max(minWidth, Math.round(info.width * scale));
    let height = info.height;
    if (!isAutoHeightKey(info.key)) {
      const minHeight = Math.max(MIN_HEIGHT, Math.round(info.height * ratio));
      height = Math.max(minHeight, Math.round(info.height * scale));
    }
    return { ...info, width, height };
  });
}

// Boucle de convergence : recalcule la disposition à une échelle de plus en
// plus petite tant que ça déborde de `containerHeight`, jusqu'à 6 passes
// (largement suffisant en pratique — la topologie du bin-packing ne change
// pas radicalement d'une passe à l'autre) ou jusqu'au plancher de sécurité.
// Le facteur `* 0.96` évite d'osciller pile autour de la limite (viser
// légèrement EN DESSOUS de containerHeight à chaque passe converge plus vite
// qu'un ajustement pile exact, qui peut re-déborder d'un pixel après
// arrondi et boucler inutilement jusqu'à la limite d'itérations).
function computeFittedAutoArrangeLayout(style, cardsInfo, containerWidth, containerHeight) {
  const MAX_ITER = 6;
  const MIN_SCALE = 0.35;
  let scale = 1;
  let layouts = {};
  let maxBottom = 0;
  for (let i = 0; i < MAX_ITER; i++) {
    const info = scaledCardsInfo(cardsInfo, scale);
    const byCategory = buildCategoryMap(info);
    layouts = computeAutoArrangeLayout(style, info, byCategory, containerWidth);
    maxBottom = Object.values(layouts).reduce((max, l) => Math.max(max, l.y + l.height), 0);
    if (maxBottom <= containerHeight || scale <= MIN_SCALE) break;
    scale = Math.max(MIN_SCALE, scale * (containerHeight / maxBottom) * 0.96);
  }
  return { layouts, fits: maxBottom <= containerHeight, moduleCount: cardsInfo.length };
}

function bringToFront(card) {
  topZ += 1;
  card.style.zIndex = topZ;
}

function placeCard(card, layout, key) {
  card.style.left = `${layout.x}px`;
  card.style.top = `${layout.y}px`;
  card.style.width = `${layout.width}px`;
  // Hauteur auto (voir isAutoHeightKey) : ne JAMAIS imposer de hauteur figée
  // en px, sinon la carte resterait bloquée à la dernière valeur enregistrée
  // (ou à defaultSize.h) au lieu de suivre son contenu dès le premier rendu.
  if (!isAutoHeightKey(key)) card.style.height = `${layout.height}px`;
  card.style.zIndex = layout.z || 10;
  card.dataset.x = layout.x;
  card.dataset.y = layout.y;
  topZ = Math.max(topZ, layout.z || 10);

  // Contenu compact (2026-08-11, sur demande explicite) : sous 85% de la
  // largeur par défaut du module, `.module-compact` (voir style.css) réduit
  // la taille du contenu — s'applique à TOUT placement (chargement initial,
  // auto-arrange, ou position enregistrée), pas seulement juste après un
  // Réorganiser, pour rester cohérent quelle que soit la façon dont la carte
  // a atteint cette largeur.
  const meta = resolveModuleMeta(key);
  if (meta) card.classList.toggle('module-compact', layout.width < meta.defaultSize.w * 0.85);
  updateSizeTier(card, layout.width, layout.height);
}

function persistLayout(key, card) {
  if (!modulesConf[key]) return;
  modulesConf[key].layout = {
    x: parseFloat(card.dataset.x) || 0,
    y: parseFloat(card.dataset.y) || 0,
    width: card.offsetWidth,
    height: card.offsetHeight,
    z: parseInt(card.style.zIndex, 10) || 10,
  };
  window.matin.modules.updateLayout(modulesConf)
    .catch(err => console.error('[Matin] Échec sauvegarde disposition', err));
}

// Étend la zone scrollable (le calque interne #dashboardCanvas, pas #dashboard
// lui-même — voir index.html/style.css) pour toujours dépasser un peu le
// module le plus bas, puisque les cartes peuvent être déplacées bien au-delà
// de la fenêtre visible.
function updateCanvasHeight(canvas) {
  let maxBottom = 0;
  canvas.querySelectorAll('.module-card').forEach(card => {
    const top = parseFloat(card.style.top) || 0;
    maxBottom = Math.max(maxBottom, top + card.offsetHeight);
  });
  canvas.style.minHeight = `${maxBottom + 120}px`;
}

// ─── Support écran ultrawide (2026-08-16, sur demande explicite) ───────────
// Détection : largeur > 2400px OU ratio largeur/hauteur > 2:1 (un 21:9
// classique tombe vers 2.33, donc couvert par les 2 conditions à la fois sur
// la plupart des résolutions réelles — la 2e condition seule suffit déjà en
// pratique, la 1re est un garde-fou pour un 21:9 à résolution plus modeste).
const ULTRAWIDE_MIN_WIDTH_PX = 2400;
const ULTRAWIDE_MIN_ASPECT = 2;
// "4 colonnes" demandées explicitement, cartes plafonnées à 500px chacune
// (voir aussi .module-card en ultrawide dans style.css) + 3 espacements de
// 20px entre elles — largeur de contenu MAX au-delà de laquelle l'espace
// supplémentaire reste vide de part et d'autre (centré) plutôt que d'étirer
// la zone de dépôt des cartes à l'infini.
const ULTRAWIDE_MAX_CONTENT_WIDTH = 2060;

function isUltrawideScreen() {
  return window.innerWidth > ULTRAWIDE_MIN_WIDTH_PX || (window.innerWidth / window.innerHeight) > ULTRAWIDE_MIN_ASPECT;
}

// Classe posée sur <body> (demandé explicitement, PAS sur <html>) — lue à la
// fois par le CSS (largeur de carte plafonnée, barre de recherche élargie,
// voir style.css) et par dashboardContentBounds ci-dessous (bornes de
// placement des cartes, pour que les 2 restent cohérents).
function applyScreenModeClass() {
  const ultrawide = isUltrawideScreen();
  document.body.classList.toggle('ultrawide', ultrawide);
  document.body.classList.toggle('standard', !ultrawide);
}

// Zone de contenu effective pour le PLACEMENT des cartes (disposition par
// défaut, Réorganiser, bornes de glisser-déposer/redimensionnement — voir
// dashboardBounds juste en dessous) : pleine largeur normalement, mais
// bornée à ULTRAWIDE_MAX_CONTENT_WIDTH et centrée (marges égales des 2
// côtés) quand `.ultrawide` est actif sur un écran plus large que cette
// borne — sans ça, "centrer" ne serait qu'un effet visuel CSS pendant que
// les cartes resteraient placables/dépliables sur toute la largeur réelle,
// bien au-delà de la zone visuellement centrée.
function dashboardContentBounds(dashboard) {
  const full = dashboard.clientWidth || 1200;
  if (document.body.classList.contains('ultrawide') && full > ULTRAWIDE_MAX_CONTENT_WIDTH) {
    return { left: (full - ULTRAWIDE_MAX_CONTENT_WIDTH) / 2, width: ULTRAWIDE_MAX_CONTENT_WIDTH };
  }
  return { left: 0, width: full };
}

// Décale tous les `x` d'un jeu de dispositions déjà calculé (voir
// computeDefaultLayout/computeFittedAutoArrangeLayout, tous deux calculés en
// coordonnées LOCALES 0..containerWidth) du décalage gauche de la zone de
// contenu — post-traitement plutôt que de faire transiter l'offset à travers
// chaque algorithme de disposition (Prioritaire/Éditorial/Équilibré/Compact
// *), plus simple et sans risque de régression sur leur logique interne.
function shiftLayoutsX(layouts, offsetX) {
  if (!offsetX) return layouts;
  const shifted = {};
  for (const [key, l] of Object.entries(layouts)) shifted[key] = { ...l, x: l.x + offsetX };
  return shifted;
}

// Bornes de la zone libre : horizontalement, bornée à la zone de contenu
// effective (voir dashboardContentBounds — pleine largeur, ou centrée en
// ultrawide) ; verticalement, seul le haut est borné (y >= 0) — le bas
// grandit à l'infini par conception (le calque #dashboardCanvas s'étend et
// #dashboard défile pour suivre), donc pas de limite basse artificielle.
function dashboardBounds(dashboard) {
  const { left, width } = dashboardContentBounds(dashboard);
  return { left, top: 0, right: left + width, bottom: Number.MAX_SAFE_INTEGER };
}

function makeInteractive(card, key, dashboard, canvas) {
  card.addEventListener('pointerdown', () => bringToFront(card));

  interact(card)
    .draggable({
      allowFrom: '.module-header',
      // Accrochage à la grille retiré (2026-08-11, sur demande explicite) —
      // placement libre au pixel près, seule la restriction aux bords du
      // dashboard reste active.
      modifiers: [
        interact.modifiers.restrictRect({ restriction: () => dashboardBounds(dashboard), endOnly: false }),
      ],
      listeners: {
        start() {
          card.classList.add('dragging');
          bringToFront(card);
        },
        move(event) {
          const x = (parseFloat(card.dataset.x) || 0) + event.dx;
          const y = (parseFloat(card.dataset.y) || 0) + event.dy;
          card.style.left = `${x}px`;
          card.style.top = `${y}px`;
          card.dataset.x = x;
          card.dataset.y = y;
          updateCanvasHeight(canvas);
        },
        end() {
          card.classList.remove('dragging');
          persistLayout(key, card);
        },
      },
    })
    .resizable({
      // Hauteur auto (voir isAutoHeightKey) : bord bas désactivé, seule la
      // largeur reste redimensionnable à la souris — la hauteur n'a plus de
      // sens à imposer manuellement puisqu'elle suit le contenu.
      edges: { left: false, top: false, right: '.resize-handle', bottom: isAutoHeightKey(key) ? false : '.resize-handle' },
      modifiers: [
        interact.modifiers.restrictSize({
          min: { width: MIN_WIDTH, height: MIN_HEIGHT },
          // Plafond de largeur en ultrawide (2026-08-16, sur demande
          // explicite, voir aussi le filet visuel CSS .module-card
          // max-width) — fonction plutôt qu'une valeur figée : réévaluée à
          // chaque mouvement de redimensionnement, donc reste correcte même
          // si la fenêtre change de mode entre 2 sessions de redimensionnement.
          max: () => ({ width: document.body.classList.contains('ultrawide') ? 500 : Infinity, height: Infinity }),
        }),
        interact.modifiers.restrictEdges({ outer: () => dashboardBounds(dashboard) }),
      ],
      listeners: {
        start() {
          card.classList.add('resizing');
          bringToFront(card);
        },
        move(event) {
          let x = parseFloat(card.dataset.x) || 0;
          let y = parseFloat(card.dataset.y) || 0;

          card.style.width = `${event.rect.width}px`;
          if (!isAutoHeightKey(key)) card.style.height = `${event.rect.height}px`;
          const meta = resolveModuleMeta(key);
          if (meta) card.classList.toggle('module-compact', event.rect.width < meta.defaultSize.w * 0.85);
          updateSizeTier(card, event.rect.width, event.rect.height);

          x += event.deltaRect.left;
          y += event.deltaRect.top;

          card.style.left = `${x}px`;
          card.style.top = `${y}px`;
          card.dataset.x = x;
          card.dataset.y = y;
          updateCanvasHeight(canvas);
        },
        end() {
          card.classList.remove('resizing');
          persistLayout(key, card);
        },
      },
    });
}

// ─── Rendu d'un module (un seul passage) ───────────────────────────────────
// Factorisé (2026-08-07) pour être appelable depuis 3 endroits SANS dupliquer
// la logique : le chargement initial (initDashboard), l'auto-refresh
// périodique (scheduleModuleRefresh) ET le bouton "Actualiser" manuel — les
// 3 doivent se comporter EXACTEMENT pareil (revalider le token Google,
// afficher l'erreur au même endroit, etc.), pas de re-création de carte,
// juste une mise à jour de `#content-<clé>` en place.
async function renderModuleOnce(key, meta, config) {
  const contentEl = document.getElementById(`content-${key}`);
  if (!contentEl) return; // carte disparue (module désactivé depuis, etc.)

  const rendererKey = resolveRendererKey(key);
  const mod = window.MatinModules?.[rendererKey];
  if (!mod?.render) return;

  try {
    // Les modules Google peuvent tourner des heures en arrière-plan : on
    // revalide le token à chaque appel plutôt que de réutiliser celui,
    // potentiellement expiré, capturé au chargement initial de la page.
    const google = meta.requiresGoogle ? await window.matin.google.getValidToken() : null;
    await mod.render(
      contentEl,
      config,
      google,
      (badge) => {
        const el = document.getElementById(`badge-${key}`);
        if (el) el.textContent = badge;
      }
    );
  } catch (err) {
    console.error(`[Matin] Erreur module ${key}:`, err);
    contentEl.innerHTML = `<span class="module-error">⚠ Erreur de chargement</span>`;
  }
}

// ─── Auto-refresh par module ────────────────────────────────────────────────────
// Chaque module avec un `refreshMs` dans MODULE_REGISTRY se rafraîchit tout
// seul, sur son propre timer, en ré-appelant juste renderModuleOnce() sur son
// #content-<clé> — jamais un rechargement de la page entière. ETF et Crypto
// gèrent déjà leur propre auto-refresh en interne (état d'UI à préserver —
// groupes dépliés — donc pas re-render()-ables depuis l'extérieur sans le
// perdre), ils n'ont donc pas de refreshMs ici — voir aussi le bouton
// "Actualiser" plus bas, qui exclut ces mêmes modules pour la même raison.
function scheduleModuleRefresh(key, meta, config) {
  if (!meta.refreshMs) return;
  setInterval(() => renderModuleOnce(key, meta, config), meta.refreshMs);
}

// ─── Overlay de démarrage (soleil qui se lève) ─────────────────────────────
// Le fondu de l'overlay est déclenché dès que le HAUT du soleil atteint 50%
// de la hauteur de l'écran — mesuré en direct via getBoundingClientRect() à
// chaque frame plutôt que calculé à l'avance à partir de la durée/courbe
// d'accélération CSS (voir .splash-sun-wrap dans style.css) : reste correct
// même si cette courbe change plus tard, ou si la fenêtre est redimensionnée
// en cours de route (largeur du soleil en `vw`, donc sa taille — et la
// distance qu'il lui reste à parcourir — dépend de la taille de la fenêtre à
// cet instant). Retourne une Promise résolue une fois l'overlay entièrement
// disparu — sert à déclencher la révélation échelonnée des cartes SUR SA
// PROPRE HORLOGE, indépendamment de l'avancement réel du chargement des
// modules (voir revealModuleCards) : l'overlay ne doit jamais attendre les
// fetches réseau, sans quoi un module lent ferait traîner l'écran de
// démarrage indéfiniment.
//
// Ne se joue plus qu'au VRAI lancement de l'app (2026-08-07, sur demande
// explicite) — le bouton "Actualiser" ne fait PLUS DU TOUT de
// `location.reload()` (voir plus bas, `btnRefresh` appelle désormais
// `renderModuleOnce` en place), donc `initDashboard`/cet overlay ne
// s'exécutent plus qu'une seule fois par lancement réel de la fenêtre.
// **Piège réel rencontré et abandonné** : une 1re tentative avait gardé
// `location.reload()` sur le bouton et ajouté un garde-fou `sessionStorage`
// pour sauter l'overlay au rechargement plutôt qu'au vrai lancement — cassait
// le dashboard : `playSplashAnimation()` retournait alors une Promise DÉJÀ
// résolue dans le cas "sauté", et `.then(revealModuleCards)` se déclenchait
// donc comme micro-tâche au tout premier `await` de `initDashboard` (avant
// même que la boucle de création des cartes plus bas n'ait eu la main) —
// `revealModuleCards()` ne trouvait alors AUCUNE carte à révéler et n'était
// jamais rappelée, laissant toutes les cartes bloquées à `opacity:0` pour de
// bon après chaque clic sur Actualiser. Résolu en supprimant complètement le
// rechargement de page pour ce bouton plutôt qu'en corrigeant l'ordre des
// micro-tâches — l'overlay ne peut alors plus jamais se re-déclencher.
function playSplashAnimation() {
  const overlay = document.getElementById('splashOverlay');
  const sunWrap = overlay?.querySelector('.splash-sun-wrap');
  if (!overlay || !sunWrap) return Promise.resolve();

  return new Promise((resolve) => {
    let fadeStarted = false;
    function startFade() {
      if (fadeStarted) return;
      fadeStarted = true;
      overlay.classList.add('splash-fade-out'); // fondu 1s, voir style.css
      setTimeout(() => {
        overlay.classList.add('splash-done');
        resolve();
      }, 1000);
    }

    // Un changement de classe au même tick que le premier paint ne déclenche
    // pas sa transition CSS (l'état de départ n'a pas encore été peint) —
    // double requestAnimationFrame pour laisser le navigateur peindre l'état
    // initial (soleil sous l'horizon, ciel sombre) avant de démarrer la
    // transition vers l'état "levé".
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.classList.add('splash-sky-rise');
    }));

    function checkSunPosition() {
      if (fadeStarted) return;
      if (sunWrap.getBoundingClientRect().top <= window.innerHeight * 0.5) {
        startFade();
        return;
      }
      requestAnimationFrame(checkSunPosition);
    }
    requestAnimationFrame(checkSunPosition);

    // Filet de sécurité : si le haut du soleil n'atteint jamais 50% de la
    // hauteur d'écran (ex. fenêtre redimensionnée très large et peu haute,
    // où même la position de repos du soleil resterait au-dessus de cette
    // ligne), force le fondu après un délai maximal plutôt que de laisser
    // l'overlay bloqué indéfiniment.
    setTimeout(startFade, 5000);
  });
}

// Révèle les cartes une par une (opacité 0 → 1, 400ms, voir .module-card
// dans style.css) avec un décalage de 100ms, triées haut-gauche → bas-droite
// (rangée par rangée) — sur demande explicite. Les cartes existent déjà
// toutes dans le DOM à cet instant (créées de façon synchrone tout en haut
// de initDashboard, bien avant les 2.5s de l'overlay) même si le CONTENU de
// certaines affiche encore leur spinner interne (leur fetch réseau peut
// prendre plus longtemps que l'overlay) — cette animation ne porte que sur
// l'apparition de la carte elle-même, pas sur la disponibilité de ses données.
function revealModuleCards() {
  const cards = Array.from(document.querySelectorAll('.module-card'));
  cards.sort((a, b) => {
    const top = (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0);
    if (top !== 0) return top;
    return (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0);
  });
  cards.forEach((card, i) => {
    setTimeout(() => card.classList.add('revealed'), i * 100);
  });
}

// Charge un module (création de carte déjà faite) et programme son
// auto-refresh — factorisé pour pouvoir être lancé EN PARALLÈLE pour tous
// les modules (voir plus bas) plutôt qu'un par un : l'ancien code attendait
// chaque `mod.render()` avant de passer au module suivant, ce qui pouvait
// prendre 30-60s pour ~20 modules avec des fetches réseau de plusieurs
// secondes chacun (Boursorama/jina.ai, scraping AlloCiné...) — bug réel de
// lenteur perçue, corrigé le 2026-08-06 en même temps que l'overlay de
// démarrage (qui suppose justement que les modules chargent EN ARRIÈRE-PLAN
// pendant les 2.5s de l'animation, pas les uns après les autres).
async function loadModule(key, meta, config) {
  await renderModuleOnce(key, meta, config);
  scheduleModuleRefresh(key, meta, config);
}

// ─── Défilement plus précis dans les cartes (2026-08-16, sur demande
// explicite) ─────────────────────────────────────────────────────────────
// La molette native déplace le contenu par grands pas fixes (le "pas" natif
// du navigateur, généralement ~100px/cran) — ressenti comme trop brusque
// dans des listes compactes (12-14px de hauteur de ligne, ex. Mon Équipe/
// Podcasts/Colis). Un seul listener wheel délégué à `document` : trouve
// l'ancêtre scrollable RÉEL le plus proche de la cible (overflow-y auto/
// scroll ET contenu qui dépasse), applique un pas RÉDUIT via `scrollTop`
// (SCROLL_STEP_FACTOR) puis appelle `preventDefault()` pour empêcher le
// navigateur d'appliquer EN PLUS son propre pas natif (qui produirait un
// double défilement, plus rapide que l'original plutôt que plus précis).
// Générique par construction (cherche n'importe quel ancêtre scrollable,
// pas une liste de classes à maintenir) : couvre aussi bien le conteneur
// générique `.module-content` de chaque carte que des listes imbriquées
// avec leur propre défilement (ex. `.monequipe-list`, `max-height: 90px`).
const SCROLL_STEP_FACTOR = 0.4;

function findScrollableAncestor(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

function initPreciseScrolling() {
  document.addEventListener('wheel', (e) => {
    const scrollable = findScrollableAncestor(e.target);
    if (!scrollable) return;
    e.preventDefault();
    scrollable.scrollTop += e.deltaY * SCROLL_STEP_FACTOR;
  }, { passive: false });
}

// ─── Init dashboard ───────────────────────────────────────────────────────────
async function initDashboard() {
  // Démarré EN PREMIER, avant tout await : son horloge de 2.5s tourne pendant
  // que le reste de cette fonction charge la config/les modules en arrière-plan.
  const splashDone = playSplashAnimation();
  splashDone.then(revealModuleCards);

  updateHeaderDate();
  updateHeaderGreeting();
  initTitlebarSearch();
  initAutoBrightness();
  initThemeSync();
  initAppBackground();
  initAlertsBanner();
  initPreciseScrolling();

  // Restauration automatique au lancement (voir main.js
  // autoRestoreUserdataIfEmpty, 2026-08-10) — une notification native a déjà
  // été envoyée côté process main ; ce simple `alert()` (même mécanisme que
  // config.js pour les confirmations destructives) garantit que l'info reste
  // visible même si la notification native a été manquée/désactivée par l'OS.
  window.matin.getAutoRestoreNotice().then((notice) => {
    if (!notice) return;
    const dateLabel = new Date(notice.mtimeMs).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    alert(`Vos données (ETF, Crypto, Prêts...) semblaient vides au lancement.\n\nElles ont été restaurées automatiquement depuis la sauvegarde du ${dateLabel}.`);
  }).catch(err => console.error('[Matin] Échec lecture notice de restauration automatique', err));

  const dashboard   = document.getElementById('dashboard');
  const canvas      = document.getElementById('dashboardCanvas');
  modulesConf       = await window.matin.modules.getAll();
  const googleData  = await window.matin.google.getValidToken();
  const hasGoogle   = !!googleData?.accessToken;

  // Trier par position (sert uniquement à ordonner la disposition PAR DÉFAUT —
  // une fois une disposition enregistrée, position n'a plus d'effet visuel)
  const sorted = Object.entries(modulesConf)
    .filter(([, m]) => m.enabled)
    .sort(([, a], [, b]) => a.position - b.position);

  applyScreenModeClass();
  window.addEventListener('resize', applyScreenModeClass);

  const { left: contentLeft, width: containerWidth } = dashboardContentBounds(dashboard);
  const keysNeedingDefault = sorted.filter(([, m]) => !m.layout).map(([key]) => key);
  const defaults = shiftLayoutsX(computeDefaultLayout(keysNeedingDefault, containerWidth), contentLeft);

  // Créer TOUTES les cartes d'abord, de façon synchrone (aucun await dans
  // cette boucle) — nécessaire pour que revealModuleCards() les trouve
  // toutes dans le DOM dès la fin de l'overlay, et pour que le chargement
  // réseau de chaque module puisse démarrer en parallèle juste après.
  const toLoad = [];
  for (const [key, moduleConf] of sorted) {
    const meta = resolveModuleMeta(key);
    if (!meta) continue;

    // Module Google sans auth → skip
    if (meta.requiresGoogle && !hasGoogle) {
      console.log(`[Matin] Module ${key} ignoré — non connecté Google`);
      continue;
    }

    const title = resolveModuleTitle(key, meta, moduleConf.config);
    const card = createModuleCard(key, meta, title);
    if (isAutoHeightKey(key)) card.classList.add('auto-height'); // voir style.css .resize-handle (curseur ↔ seul, plus de bord bas)
    canvas.appendChild(card);

    const layout = moduleConf.layout || defaults[key] || { x: 0, y: 0, width: meta.defaultSize.w, height: meta.defaultSize.h, z: 10 };
    if (!moduleConf.layout) moduleConf.layout = layout; // fige la disposition par défaut dès le premier calcul
    placeCard(card, layout, key);
    makeInteractive(card, key, dashboard, canvas);
    // Hauteur auto (ETF/Crypto, voir isAutoHeightKey) : leur contenu change
    // de taille en dehors de tout drag/resize (ex. un ticker déplié/replié
    // par clic, voir etf.js/crypto.js), donc `updateCanvasHeight` — appelé
    // seulement pendant un drag/resize sinon — ne serait jamais rappelé pour
    // ce cas précis. Un ResizeObserver couvre ce trou sans que etf.js/
    // crypto.js n'aient besoin de connaître #dashboardCanvas.
    if (isAutoHeightKey(key)) {
      new ResizeObserver(() => updateCanvasHeight(canvas)).observe(card);
    }

    toLoad.push([key, meta, moduleConf]);
  }

  updateCanvasHeight(canvas);

  // Fige immédiatement toute disposition par défaut nouvellement calculée —
  // sinon un rechargement ultérieur la recalculerait à partir de zéro sans
  // tenir compte des modules déjà déplacés manuellement entre-temps,
  // provoquant des chevauchements.
  if (keysNeedingDefault.length) {
    window.matin.modules.updateLayout(modulesConf)
      .catch(err => console.error('[Matin] Échec sauvegarde disposition initiale', err));
  }

  // Bouton refresh (2026-08-07, sur demande explicite — remplace un ancien
  // `location.reload()`) — actualise chaque module EN PLACE (juste son
  // contenu, `#content-<clé>`), aucun rechargement de page, aucune animation
  // de démarrage : les cartes ne disparaissent jamais, seul leur intérieur
  // se met à jour (chaque module gère déjà son propre état "en chargement",
  // ex. `setBadge('…')`, pendant l'appel). Modules à auto-refresh interne
  // (ETF/Crypto/Spotify/FDJ/Change — sans `refreshMs`, voir
  // scheduleModuleRefresh) volontairement exclus : les rappeler ici
  // empilerait un 2e `setInterval` interne à CHAQUE clic (fuite qui
  // s'aggrave à chaque clic, pas juste un désagrément ponctuel) et
  // réinitialiserait leur état d'UI (ex. groupes ETF/Crypto dépliés) — ils
  // s'actualisent déjà tout seuls sur leur propre cadence.
  document.getElementById('btnRefresh')?.addEventListener('click', () => {
    toLoad.forEach(([key, meta, moduleConf]) => {
      if (!meta.refreshMs) return;
      renderModuleOnce(key, meta, moduleConf.config);
    });
  });

  // Bouton "⊞ Réorganiser" (2026-08-10, 2e révision sur demande explicite) —
  // demande maintenant confirmation (popup, voir #autoArrangeConfirmOverlay
  // dans index.html — un confirm() natif ne permet pas de libeller les 2
  // boutons "Oui, réorganiser"/"Annuler" comme demandé, d'où une popup HTML
  // maison plutôt que l'API navigateur standard), tire un des 5 styles de
  // disposition au hasard (jamais 2 fois de suite le même, voir
  // pickRandomAutoArrangeStyle) et permet d'annuler depuis la notice de
  // confirmation qui suit (2s, voir applyAutoArrangeLayouts/snapshot
  // ci-dessous). Ne touche JAMAIS width/height (seule la POSITION change,
  // comme avant cette révision).
  let lastAutoArrangeSnapshot = null; // état juste avant la dernière réorganisation, pour "Annuler" dans la notice

  // Applique un jeu de layouts déjà calculé (nouvelle disposition OU
  // restauration d'un snapshot — même mécanique dans les 2 cas) : transition
  // CSS temporaire (`.autoarrange-move`, voir style.css) pour un glissement
  // visible vers la nouvelle position plutôt qu'un saut instantané, retirée
  // ~350ms après pour ne jamais interférer avec un glisser-déposer manuel
  // ultérieur (qui positionne les cartes de façon impérative, sans
  // transition voulue pendant un vrai drag).
  function applyAutoArrangeLayouts(cards, newLayouts) {
    cards.forEach(card => card.classList.add('autoarrange-move'));
    for (const card of cards) {
      const key = card.id.replace('module-', '');
      const layout = newLayouts[key];
      if (!layout) continue;
      placeCard(card, layout, key);
      if (modulesConf[key]) modulesConf[key].layout = layout;
    }
    updateCanvasHeight(canvas);
    setTimeout(() => cards.forEach(card => card.classList.remove('autoarrange-move')), 350);
    window.matin.modules.updateLayout(modulesConf)
      .catch(err => console.error('[Matin] Échec sauvegarde de la réorganisation', err));
  }

  function performAutoArrange() {
    const cards = Array.from(canvas.querySelectorAll('.module-card'));
    if (!cards.length) return;

    const cardsInfo = cards.map(card => ({
      key: card.id.replace('module-', ''),
      width: card.offsetWidth,
      height: card.offsetHeight,
      theme: card.dataset.theme,
    }));

    // Snapshot de l'état ACTUEL avant de l'écraser — c'est à ÇA que "Annuler"
    // reviendra, pas à un style de disposition précédent.
    const snapshot = {};
    for (const info of cardsInfo) {
      const card = document.getElementById(`module-${info.key}`);
      snapshot[info.key] = {
        x: parseFloat(card.dataset.x) || 0,
        y: parseFloat(card.dataset.y) || 0,
        width: info.width,
        height: info.height,
        z: parseInt(card.style.zIndex, 10) || 10,
      };
    }
    lastAutoArrangeSnapshot = snapshot;

    // `dashboard.clientHeight` = hauteur RÉELLEMENT visible sans scroll (pas
    // `canvas`/#dashboardCanvas, qui lui grandit à l'infini par conception,
    // voir updateCanvasHeight) — c'est la vraie contrainte "tenir sur un
    // écran" demandée, pas une valeur arbitraire.
    const { left: contentLeft, width: containerWidth } = dashboardContentBounds(dashboard);
    const containerHeight = dashboard.clientHeight || 800;
    const style = pickRandomAutoArrangeStyle();
    const { layouts: rawLayouts, fits, moduleCount } = computeFittedAutoArrangeLayout(style, cardsInfo, containerWidth, containerHeight);
    const newLayouts = shiftLayoutsX(rawLayouts, contentLeft);
    applyAutoArrangeLayouts(cards, newLayouts);

    const notice = document.getElementById('autoArrangeNotice');
    if (notice) {
      const text = document.getElementById('autoArrangeNoticeText');
      const fitLabel = fits
        ? `${moduleCount} modules affichés sur 1 page`
        : 'Scroll nécessaire — trop de modules actifs';
      if (text) text.textContent = `✓ Disposition « ${AUTOARRANGE_STYLE_LABELS[style]} » — ${fitLabel}`;
      notice.classList.add('show');
      clearTimeout(notice._hideTimer);
      notice._hideTimer = setTimeout(() => notice.classList.remove('show'), 2000);
    }
  }

  const autoArrangeConfirmOverlay = document.getElementById('autoArrangeConfirmOverlay');
  document.getElementById('btnAutoArrange')?.addEventListener('click', () => {
    autoArrangeConfirmOverlay?.classList.add('open');
  });
  document.getElementById('autoArrangeConfirmCancel')?.addEventListener('click', () => {
    autoArrangeConfirmOverlay?.classList.remove('open');
  });
  autoArrangeConfirmOverlay?.addEventListener('click', (e) => {
    if (e.target === autoArrangeConfirmOverlay) autoArrangeConfirmOverlay.classList.remove('open');
  });
  document.getElementById('autoArrangeConfirmOk')?.addEventListener('click', () => {
    autoArrangeConfirmOverlay?.classList.remove('open');
    performAutoArrange();
  });
  document.getElementById('autoArrangeUndo')?.addEventListener('click', () => {
    if (!lastAutoArrangeSnapshot) return;
    const cards = Array.from(canvas.querySelectorAll('.module-card'));
    applyAutoArrangeLayouts(cards, lastAutoArrangeSnapshot);
    lastAutoArrangeSnapshot = null;
    const notice = document.getElementById('autoArrangeNotice');
    if (notice) { notice.classList.remove('show'); clearTimeout(notice._hideTimer); }
  });

  // Bouton config
  document.getElementById('btnConfig')?.addEventListener('click', () => {
    window.matin.window.openConfig().catch(err => console.error('[Matin] Échec ouverture Paramètres', err));
  });

  // Écouter les mises à jour de modules depuis config (ajout/suppression de
  // module, changement de config) — pas déclenché par nos propres sauvegardes
  // de disposition, qui passent par le canal silencieux modules:updateLayout.
  window.matin.modules.onUpdated(() => window.location.reload());

  // Chargement des modules EN PARALLÈLE (voir loadModule) — pas d'await
  // bloquant pour le reste de la fonction, mais on le garde ici pour que les
  // erreurs éventuelles restent rattachées à initDashboard plutôt que de
  // devenir des rejets de promesse orphelins.
  await Promise.all(toLoad.map(([key, meta, moduleConf]) => loadModule(key, meta, moduleConf.config)));
}

// ─── Lancement ────────────────────────────────────────────────────────────────
window.MatinModules = window.MatinModules || {};
document.addEventListener('DOMContentLoaded', initDashboard);
