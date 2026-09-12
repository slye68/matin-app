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
  // Renommé "ETF" → "Actions / ETF" (2026-09-01, sur demande explicite) —
  // libellé affiché uniquement (titre de carte, voir resolveModuleTitle plus
  // bas qui retombe sur meta.label pour cette clé) : la clé interne `etf`
  // elle-même reste inchangée partout ailleurs (store, USERDATA_MODULE_KEYS,
  // etf.js...), aucune migration de données nécessaire.
  etf:      { label: 'Actions / ETF', icon: '📈',  requiresGoogle: false, defaultSize: { w: 700, h: 420 }, theme: 'finance' }, // auto-refresh géré en interne (voir etf.js)
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
  // 6 modules ajoutés en autonomie (2026-08-05, voir CONTEXT.md)
  airQuality: { label: 'Qualité air',   icon: '🌡️', requiresGoogle: false, defaultSize: { w: 300, h: 200 }, refreshMs: 30 * 60 * 1000, theme: 'maison' },
  fuelPrices: { label: 'Carburants',    icon: '⛽', requiresGoogle: false, defaultSize: { w: 360, h: 320 }, refreshMs: 2 * 60 * 60 * 1000, theme: 'services' },
  // Liste de souhaits (2026-08-30, sur demande explicite ; refonte complète
  // le 2026-09-08 — "Suivi de prix Marchand" devient une liste STATIQUE
  // saisie à la main, plus aucun fetch réseau) — pas de refreshMs : rien à
  // rafraîchir, price-tracking.js n'a plus de setInterval du tout (contraste
  // avec Podcasts/ETF/Crypto/Spotify, qui gèrent eux un vrai auto-refresh
  // interne, voir commentaire d'en-tête plus haut sur ce point).
  priceTracking: { label: 'Liste de souhaits', icon: '🛒', requiresGoogle: false, defaultSize: { w: 340, h: 320 }, theme: 'services' },
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
  // Climatisation FGLair (2026-09-13, sur demande explicite) — refreshMs
  // 10 min, demandé explicitement ("lecture de l'état de tous les appareils
  // toutes les 10 minutes").
  fglair:     { label: 'Climatisation', icon: '🌡️', requiresGoogle: false, defaultSize: { w: 340, h: 420 }, refreshMs: 10 * 60 * 1000, theme: 'maison' },
  // Somfy TaHoma Switch (2026-09-12, sur demande explicite, point 6 : "toutes
  // les 30 secondes") — refreshMs générique de scheduleModuleRefresh suffit,
  // pas besoin d'un minuteur dédié comme live.js (pas de cadence variable
  // ici).
  somfyTahoma: { label: 'Somfy TaHoma', icon: '🪟', requiresGoogle: false, defaultSize: { w: 320, h: 380 }, refreshMs: 30 * 1000, theme: 'maison' },
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
  // Actus sportives (2026-09-11, sur demande explicite) — flux L'Équipe fixe,
  // même pattern que Sciences/Santé (pas de sources cochables, voir
  // RSS_FEED_DEFS/makeRssModule dans rss-feed.js).
  sportNews:   { label: 'Actus sportives', icon: '📰', requiresGoogle: false, defaultSize: { w: 340, h: 460 }, refreshMs: 15 * 60 * 1000, theme: 'actualites' },
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
  // Taille par défaut ajustée le 2026-09-01 (2e révision, sur demande
  // explicite, "Keep larger avatar thumbnails (~70-80px)... exactly 2
  // avatars per row... width adjusts to fit 2 avatars comfortably") — 200px
  // = 2 avatars de 76px (voir style.css .youtube-avatar-img) + espacement de
  // grille (16px) + le padding horizontal normal de la carte (16px de
  // chaque côté, comme tout autre module — plus besoin de la dérogation
  // ultra-étroite d'une révision précédente, cette largeur repasse
  // au-dessus du plancher générique .module-card{min-width:220px} de toute
  // façon désormais très proche). Hauteur portée à 320 pour laisser ~3
  // rangées visibles sans avoir à faire défiler dès l'ouverture — au-delà,
  // .youtube-module-avatars défile verticalement comme avant.
  youtube: { label: 'YouTube', icon: '🔔', requiresGoogle: false, defaultSize: { w: 200, h: 320 }, theme: 'services' },
  nasa:    { label: 'NASA',     icon: '🌍', requiresGoogle: false, defaultSize: { w: 440, h: 460 }, refreshMs: 24 * 60 * 60 * 1000, theme: 'perso' },
  // Prêts immobiliers (2026-08-08, sur demande explicite) — instances
  // multiples comme Sports (voir isPretsKey/resolveModuleMeta plus haut) : un
  // groupe de prêts = une instance = une carte. Calcul 100% local (aucun
  // réseau) mais refreshMs quand même posé — le CRD/temps restant dépendent
  // de la date du jour, doivent donc se recalculer de temps en temps même
  // sans interaction (24h : la variation jour à jour est de toute façon
  // imperceptible pour un prêt qui se mesure en mois).
  prets: { label: 'Mon Prêt', icon: '🏠', requiresGoogle: false, defaultSize: { w: 360, h: 420 }, refreshMs: 24 * 60 * 60 * 1000, theme: 'finance' },
  // LIVE FOOT! (2026-08-11, sur demande explicite ; renommé "LIVE!" →
  // "LIVE FOOT!" le 2026-09-01, 2e demande explicite, libellé affiché
  // uniquement — la clé interne `live` reste inchangée) — pas de refreshMs :
  // cadence 60s/5min auto-ajustée en interne selon qu'un match est en direct
  // ou non (impossible avec le setInterval fixe de scheduleModuleRefresh),
  // même principe que ETF/Crypto/Spotify/Podcast/Currency (voir live.js).
  // Thème 'other-sports' pour rejoindre le regroupement visuel "Sports" du
  // Réorganiser automatique (même bordure de catégorie que Sports/ol) —
  // l'accent rouge "en direct" demandé est posé séparément (voir
  // #module-live dans style.css, qui l'emporte sur la couleur de thème).
  live: { label: 'LIVE FOOT!', icon: '⚽', requiresGoogle: false, defaultSize: { w: 340, h: 360 }, theme: 'other-sports' },
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

// ─── Instances multiples (Sports, Prêts, LIVE FOOT!) ────────────────────────
// Même principe pour les trois : une clé "de base" + jusqu'à N suffixes
// _2.._N, un seul renderer partagé (window.MatinModules.ol / .prets / .live)
// sert toutes les instances. `resolveModuleMeta`/`resolveRendererKey`/
// `resolveModuleTitle` centralisent la résolution plutôt que de dupliquer le
// même ternaire à chaque site d'appel. LIVE FOOT! (2026-09-05, sur demande
// explicite) plafonné à 2 instances seulement (`live`/`live_2`, voir
// MAX_LIVE_INSTANCES dans config.js) — pas 5 comme Sports/Prêts, chaque carte
// n'a qu'un seul réglage (la compétition suivie), 2 suffit largement à
// comparer 2 championnats côte à côte.
function isSportsKey(key) {
  return key === 'ol' || /^ol_[2-5]$/.test(key);
}
function isPretsKey(key) {
  return key === 'prets' || /^prets_[2-5]$/.test(key);
}
function isLiveKey(key) {
  return key === 'live' || key === 'live_2';
}
// Mon Équipe (2026-09-12, sur demande explicite) — même principe, plafonné à
// 3 instances (monEquipe/monEquipe_2/monEquipe_3, voir MAX_MON_EQUIPE_INSTANCES
// dans config.js) : CHAQUE équipe reste sa PROPRE carte dashboard,
// indépendamment déplaçable/redimensionnable (choix confirmé explicitement,
// PAS un empilement de sections dans une seule carte).
function isMonEquipeKey(key) {
  return key === 'monEquipe' || key === 'monEquipe_2' || key === 'monEquipe_3';
}
function resolveModuleMeta(key) {
  if (MODULE_REGISTRY[key]) return MODULE_REGISTRY[key];
  if (isSportsKey(key)) return MODULE_REGISTRY.ol;
  if (isLiveKey(key)) return MODULE_REGISTRY.live;
  if (isPretsKey(key)) return MODULE_REGISTRY.prets;
  if (isMonEquipeKey(key)) return MODULE_REGISTRY.monEquipe;
  return undefined;
}
function resolveRendererKey(key) {
  if (isSportsKey(key)) return 'ol';
  if (isPretsKey(key)) return 'prets';
  if (isLiveKey(key)) return 'live';
  if (isMonEquipeKey(key)) return 'monEquipe';
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
  // Hue (2026-08-31, sur demande explicite, "même comportement qu'ETF et
  // FDJ") — la carte doit grandir/rétrécir avec le repli/dépli de "Toutes
  // mes pièces" (voir hue.js), au lieu de rester à taille fixe avec un
  // défilement interne.
  if (key === 'hue') return true;
  // Mon Équipe (2026-09-01, sur demande explicite, "même comportement
  // qu'ETF/FDJ") — les sections "Prochains matchs"/"Derniers résultats"
  // repliables (voir mon-equipe.js) doivent pouvoir faire grandir la carte
  // une fois dépliées, au lieu de rester à taille fixe avec un défilement
  // interne.
  if (isMonEquipeKey(key)) return true;
  // YouTube RETIRÉ de l'auto-height le 2026-09-08 (sur demande explicite) —
  // l'ajout du 2026-09-01 ci-dessous avait un effet de bord réel non prévu :
  // une disposition SAUVEGARDÉE (taille choisie à la main par l'utilisateur
  // via la poignée de redimensionnement) était réappliquée au chargement,
  // puis IMMÉDIATEMENT ré-agrandie pour "coller au contenu" — l'auto-height
  // l'emportait toujours sur une taille manuelle, sans aucun moyen de la
  // conserver. Corrigé en repassant YouTube en hauteur FIXE/redimensionnable
  // normale (comme la grande majorité des modules) plutôt qu'en essayant de
  // faire cohabiter les deux (aurait exigé de faire transiter un flag
  // "taille manuelle" à travers ~6 points d'appel de isAutoHeightKey —
  // beaucoup plus intrusif pour un seul module). Le défilement interne
  // générique de `.module-content` (voir style.css, déjà utilisé par tous
  // les modules à hauteur fixe) prend le relais quand la carte est
  // redimensionnée plus petite que sa grille d'avatars — voir aussi
  // `#module-youtube .module-content`, dont le `overflow-y: hidden` (posé le
  // 2026-09-01 pour l'ancien comportement auto-height) est retiré pour cette
  // même raison.
  // Anniversaires (2026-09-01, sur demande explicite, "remove the vertical
  // scrollbar — it appears even with only 1 entry") — même cause/même
  // correctif que YouTube ci-dessus : à hauteur FIGÉE (defaultSize.h),
  // `.birthdays-list` déclenchait un défilement interne dès que son contenu
  // réel (même 1 seule ligne) ne remplissait pas exactement cette hauteur ni
  // ne la dépassait franchement ; carte pilotée par son contenu désormais,
  // `overflow-y: hidden` posé côté CSS (voir .birthdays-list, style.css) —
  // plus rien à faire défiler, la carte grandit/rétrécit avec le nombre
  // d'anniversaires à afficher.
  if (key === 'birthdays') return true;
  return isPretsKey(key);
}
function resolveModuleTitle(key, meta, config) {
  if (isSportsKey(key)) return config?.team?.trim() || meta.label;
  // LIVE FOOT! — titre de carte "FOOTBALL" (2026-09-12, sur demande
  // explicite, redesign du header) : même mécanisme que Prêts/Mon Équipe
  // ci-dessous — SEUL le titre affiché sur la carte change, `meta.label`
  // ("LIVE FOOT!") reste inchangé pour Paramètres et tout autre contexte qui
  // le lit encore. Le nom de la compétition reste en sous-titre, inchangé
  // (voir resolveModuleSubtitle).
  if (isLiveKey(key)) return 'FOOTBALL';
  // Prêts (2026-09-01, sur demande explicite — remplace l'ancien comportement
  // où le nom du groupe (ex. "Maison Francheleins") remplaçait ENTIÈREMENT le
  // titre de carte) : le titre est désormais TOUJOURS "Mon prêt" (renommé
  // depuis "Prêts immobiliers" le 2026-09-09, sur demande explicite),
  // identique sur toutes les instances (prets/prets_2../prets_5) — le nom du
  // groupe passe en sous-titre, voir resolveModuleSubtitle/createModuleCard
  // ci-dessous. `.module-title` met déjà tout en majuscules via CSS
  // (text-transform:uppercase), d'où "Mon prêt" ici plutôt que déjà en
  // capitales.
  if (isPretsKey(key)) return 'Mon prêt';
  // Mon Équipe (2026-08-15, sur demande explicite ; étendu aux instances
  // multiples le 2026-09-12, isMonEquipeKey) — "le nom de l'équipe en
  // en-tête" : même mécanisme que Sports ci-dessus, le titre de CARTE
  // affiche le nom réellement saisi plutôt que le libellé générique "Mon
  // Équipe" dès qu'il est configuré.
  if (isMonEquipeKey(key)) return config?.teamName?.trim() || meta.label;
  return meta.label;
}

// Sous-titre de carte (2026-09-01, sur demande explicite) — pour l'instant
// UNIQUEMENT Prêts (nom du groupe, ex. "Maison Francheleins", saisi dans
// Paramètres) : `null` si le groupe n'a pas encore de nom, auquel cas
// createModuleCard n'affiche qu'une seule ligne de titre (pas de 2e ligne
// vide). Fonction séparée de resolveModuleTitle ci-dessus (plutôt qu'un
// tuple renvoyé par une seule fonction) pour rester un ajout NON intrusif :
// tous les appels existants à resolveModuleTitle ailleurs restent valides
// sans modification.
// LIVE FOOT! (2026-09-05, sur demande explicite, ajouté avec le support de
// 2 instances) — même besoin que Prêts : sans ce sous-titre, 2 cartes LIVE
// FOOT! affichent le même titre générique et sont indiscernables tant
// qu'aucun match n'est chargé. `config.competitionLabel` (peuplé par le
// <select> Compétition, voir config.js) sert de sous-titre.
function resolveModuleSubtitle(key, config) {
  if (isPretsKey(key)) return config?.name?.trim() || null;
  if (isLiveKey(key)) return config?.competitionLabel?.trim() || null;
  // Mon Équipe (2026-09-12, sur demande explicite — redesign de l'en-tête,
  // "catégorie en sous-titre") — voir renderMonEquipeConfigSection
  // (config.js) pour le champ de saisie, optionnel (pas de sous-titre si
  // vide, même comportement que Prêts ci-dessus tant que le champ n'est pas
  // renseigné).
  if (isMonEquipeKey(key)) return config?.category?.trim() || null;
  return null;
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
  // URI protocole `spotify:` (2026-09-12, sur demande explicite) — remplace
  // le lien web `https://open.spotify.com` : ouvre directement l'app Windows
  // Spotify (si installée) plutôt que le lecteur web dans le navigateur.
  // Géré comme une simple URL de plus par shell.openExternal (Windows sait
  // résoudre un protocole personnalisé enregistré) — voir le `.catch` sur
  // l'appel ci-dessous (resolveModuleClickUrl) qui avale silencieusement
  // l'échec si Spotify n'est pas installé (aucun handler enregistré pour ce
  // protocole), conformément à la demande ("ne rien faire, pas d'erreur
  // visible").
  spotify: 'spotify:',
  cinema: 'https://www.allocine.fr',
  fdjLoto: 'https://www.fdj.fr/jeux-de-tirage/loto',
  fdjEuromillions: 'https://www.fdj.fr/jeux-de-tirage/euromillions-my-million',
  fdjEurodreams: 'https://www.fdj.fr/jeux-de-tirage/eurodreams',
  steamPromos: 'https://store.steampowered.com/specials',
  epicPromos: 'https://store.epicgames.com/fr/free-games',
  weather: 'https://meteofrance.com',
  maps: 'https://maps.google.com',
  live: 'https://www.lequipe.fr/Football/',
  youtube: 'https://www.youtube.com/feed/subscriptions',
  // priceTracking retiré (2026-08-31, sur demande explicite) — le titre de
  // carte n'ouvre plus rien au clic. Chaque LIGNE de produit garde son propre
  // clic vers SA page (voir renderer/modules/price-tracking.js), inchangé.
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
// app.firstName. Rien n'est affiché si le champ est vide — pas de "👋"
// sans prénom.
async function updateHeaderGreeting() {
  const el = document.getElementById('headerGreeting');
  if (!el) return;
  const firstName = await window.matin.store.get('app.firstName');
  el.textContent = firstName ? `👋 ${firstName}` : '';
}

// Barre de recherche (moteur configurable, 2026-09-03, sur demande explicite
// — voir config.js createSearchEngineRow, Paramètres → Services) centrée dans
// le titlebar — ouvre les résultats dans le navigateur par défaut (pas dans
// l'app, qui n'a pas de moteur de rendu web générique/navigation), donc
// shell:openExternal comme partout ailleurs dans l'app pour un lien externe.
// Lu depuis le store À CHAQUE submit (pas mis en cache au chargement) : la
// fenêtre Paramètres qui modifie ce réglage est une fenêtre séparée, et
// contrairement à app.background/app.displayMode ce champ n'a pas besoin
// d'un effet visuel immédiat dans le dashboard — inutile de le pousser par
// IPC (voir background:updated/displayMode:updated) juste pour ça.
function initTitlebarSearch() {
  const form = document.getElementById('titlebarSearch');
  const input = document.getElementById('titlebarSearchInput');
  if (!form || !input) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const engineId = (await window.matin.store.get('app.searchEngine')) || window.SearchEngines.DEFAULT;
    const url = window.SearchEngines.buildSearchUrl(engineId, query);
    window.matin.shell.openExternal(url);
  });
}

// Mode auto luminosité — SUPPRIMÉ ENTIÈREMENT le 2026-08-31, sur demande
// explicite (voir CONTEXT.md) : posait un calque de dimming + pilotait le
// thème clair/sombre selon l'heure (initAutoBrightness/applyAutoBrightness/
// autoThemeForHour/brightnessBandForHour, ~50 lignes retirées ici). Le
// toggle Sombre/Clair correspondant a migré dans la popup "🎨 Affichage"
// (voir config.html/config.js) — reste TOUJOURS un choix manuel désormais,
// plus aucun mécanisme automatique ne le pilote.

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
const APP_BACKGROUND_DARK_KEYS = ['stars', 'aurora', 'particles', 'rain', 'snow', 'matrix', 'nebula', 'beach', 'mountain', 'lac'];
const APP_BACKGROUND_LIGHT_KEYS = ['paper', 'geometric', 'gradient', 'winter-frost', 'winter-pines', 'winter-peaks', 'winter-mist', 'winter-illus', 'winter-sea'];
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
const APP_BACKGROUND_LAC_MIST_COUNT = 3;

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

  // Parasols + serviettes (2026-08-15, sur demande explicite ; ÉTENDU à 5 et
  // les dômes REDESSINÉS le 2026-09-01, 2e demande explicite — voir
  // beachDrawParasol pour le détail du nouveau dôme en demi-ellipse) —
  // éléments STATIQUES (ne bougent jamais), donc dessinés ici avec le reste
  // de la scène plutôt que dans la boucle d'animation. 5 parasols répartis
  // gauche→droite avec les couleurs EXACTES demandées ; le 5e (tout à
  // droite) est plus petit et posé plus haut dans le sable (`scale`/
  // `groundFrac` réduits) pour suggérer qu'il est plus loin (effet de
  // profondeur/perspective). `towelSide` place toujours la serviette du côté
  // qui regarde vers le centre de la scène, pour qu'elle ne sorte jamais du
  // cadre côté bord d'écran.
  const sandTop = seaBottomY, sandHeight = h - seaBottomY;
  const canopyR = Math.min(w, h) * 0.045;

  const parasolDefs = [
    { xFrac: 0.10, groundFrac: 0.55, scale: 1,    colorA: '#e74c3c', colorB: '#ffffff', towelA: '#2f6fa8', towelB: '#ffffff', towelAngle: -0.12 }, // 1 gauche — rouge/blanc
    { xFrac: 0.30, groundFrac: 0.62, scale: 1,    colorA: '#2f6fa8', colorB: '#ffffff', towelA: '#e74c3c', towelB: '#ffffff', towelAngle:  0.15 }, // 2 centre-gauche — bleu/blanc
    { xFrac: 0.55, groundFrac: 0.58, scale: 1,    colorA: '#f1c40f', colorB: '#27ae60', towelA: '#e67e22', towelB: '#ffffff', towelAngle: -0.10 }, // 3 centre-droit — jaune/vert
    { xFrac: 0.78, groundFrac: 0.65, scale: 1,    colorA: '#e67e22', colorB: '#ffffff', towelA: '#27ae60', towelB: '#ffffff', towelAngle:  0.12 }, // 4 droite — orange/blanc
    { xFrac: 0.93, groundFrac: 0.42, scale: 0.65, colorA: '#8e44ad', colorB: '#ffffff', towelA: '#f1c40f', towelB: '#ffffff', towelAngle: -0.15 }, // 5 tout à droite, plus petit/plus loin — violet/blanc
  ];

  const placed = parasolDefs.map((p) => {
    const x = w * p.xFrac;
    const groundY = sandTop + sandHeight * p.groundFrac;
    const r = canopyR * p.scale;
    beachDrawParasol(sctx, x, groundY, r, p.colorA, p.colorB);
    const towelSide = p.xFrac < 0.5 ? 1 : -1;
    beachDrawTowel(sctx, x + towelSide * r * 1.1, groundY + 6 * p.scale, r * 2.6, r * 1.1, p.towelAngle, p.towelA, p.towelB);
    return { x, groundY, r };
  });

  // Détail livre — conservé de la version à 2 parasols (2026-08-15), déplacé
  // à côté du 3e parasol (jaune/vert) dans la nouvelle disposition.
  const bookAnchor = placed[2];
  beachDrawBook(sctx, bookAnchor.x - bookAnchor.r * 2.7, bookAnchor.groundY + 8, 0.3);
}

// Parasol — REDESSINÉ le 2026-09-01 (sur demande explicite, "proper
// dome/canopy shape (half-ellipse, not circle)") : l'ancienne version
// utilisait `arc()` (donc un demi-DISQUE, largeur = hauteur), peu
// reconnaissable comme parasol de plage — remplacé par `ellipse()`
// (radiusX ≠ radiusY, dôme aplati/plus large que haut, comme un vrai
// parasol) découpé en tranches alternées, même principe "camembert" qu'avant
// pour les rayures. Mât en bois inchangé (ligne brune) + petit embout
// arrondi au sommet (détail ajouté, discret mais lisible) + liseré sombre
// autour du bord du dôme pour détacher nettement la silhouette du ciel/fond.
function beachDrawParasol(sctx, poleX, groundY, canopyR, colorA, colorB) {
  const domeHeight = canopyR * 0.6; // aplati : plus large que haut (demi-ellipse, pas un demi-cercle)
  const canopyY = groundY - canopyR * 2.2;
  const poleTopY = canopyY + domeHeight * 0.2;

  // Mât en bois
  sctx.strokeStyle = '#7a4a2b';
  sctx.lineWidth = Math.max(1.5, canopyR * 0.09);
  sctx.lineCap = 'round';
  sctx.beginPath();
  sctx.moveTo(poleX, poleTopY);
  sctx.lineTo(poleX, groundY);
  sctx.stroke();

  // Dôme rayé — demi-ellipse découpée en tranches alternées.
  const wedgeCount = 8;
  for (let i = 0; i < wedgeCount; i++) {
    const a0 = Math.PI + (Math.PI / wedgeCount) * i;
    const a1 = Math.PI + (Math.PI / wedgeCount) * (i + 1);
    sctx.beginPath();
    sctx.moveTo(poleX, canopyY);
    sctx.ellipse(poleX, canopyY, canopyR, domeHeight, 0, a0, a1);
    sctx.closePath();
    sctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    sctx.fill();
  }

  // Liseré du bord — détache la silhouette du dôme du fond derrière lui.
  sctx.beginPath();
  sctx.ellipse(poleX, canopyY, canopyR, domeHeight, 0, Math.PI, Math.PI * 2);
  sctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  sctx.lineWidth = 1;
  sctx.stroke();

  // Petit embout arrondi au sommet du mât — détail classique de parasol.
  sctx.beginPath();
  sctx.fillStyle = '#7a4a2b';
  sctx.arc(poleX, poleTopY, Math.max(1.5, canopyR * 0.08), 0, Math.PI * 2);
  sctx.fill();
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

// Trajectoire erratique + battement d'ailes (2026-09-01, sur demande
// explicite, "birds fly in straight horizontal line — make movement more
// erratic/natural") — chaque oiseau reçoit sa PROPRE combinaison de 2
// sinusoïdes verticales (fréquence/amplitude/phase tirées aléatoirement à la
// création) superposées à `baseY` : une lente (dérive douce) + une rapide
// (petits à-coups), qui ensemble donnent un vol qui monte/descend sans
// jamais se répéter de façon prévisible, plutôt qu'une ligne droite. `speed`
// déjà propre à chaque oiseau (conservé) ; `driftBias` ajoute un léger cap
// horizontal aléatoire, retiré au sort toutes les quelques secondes
// (`nextDriftAt`) — "occasional direction slight changes" demandé
// explicitement. `wingPhase`/`wingSpeed` pilotent le battement d'ailes (voir
// mountainDrawBird), propre à chaque oiseau lui aussi.
function mountainMakeBird(w, h) {
  const baseY = h * 0.12 + Math.random() * h * 0.25;
  return {
    x: Math.random() * w,
    baseY,
    y: baseY,
    speed: Math.random() * 0.18 + 0.08, // lent — "flying slowly" demandé explicitement, vitesse propre à cet oiseau
    span: Math.random() * 4 + 8,
    wavePhase1: Math.random() * Math.PI * 2,
    waveFreq1: 0.0015 + Math.random() * 0.0025,
    waveAmp1: h * (0.015 + Math.random() * 0.02),
    wavePhase2: Math.random() * Math.PI * 2,
    waveFreq2: 0.006 + Math.random() * 0.006,
    waveAmp2: h * (0.005 + Math.random() * 0.008),
    driftBias: 0,
    nextDriftAt: 0,
    wingPhase: Math.random() * Math.PI * 2,
    wingSpeed: 0.006 + Math.random() * 0.005,
  };
}

// Oiseau — simple "V" (2 segments), forme minimale demandée explicitement.
// `t` (horodatage rAF, voir frame() plus bas) pilote le battement d'ailes :
// le "creux" du V (`droop`) oscille légèrement autour de sa valeur d'origine
// (0.4 × span) au lieu de rester figé — silhouette qui s'ouvre/se referme
// doucement (2026-09-01, sur demande explicite, "wing flap animation").
function mountainDrawBird(ctx, b, t) {
  const flap = Math.sin(t * b.wingSpeed + b.wingPhase);
  const droop = b.span * (0.4 + flap * 0.18);
  ctx.save();
  ctx.strokeStyle = 'rgba(232, 234, 240, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(b.x - b.span, b.y + droop);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b.x + b.span, b.y + droop);
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
      // Cap horizontal — léger biais aléatoire en plus de la vitesse de base,
      // retiré au sort toutes les 2-6s ("occasional direction slight changes").
      if (t > b.nextDriftAt) {
        b.driftBias = (Math.random() - 0.5) * 0.15;
        b.nextDriftAt = t + 2000 + Math.random() * 4000;
      }
      b.x += b.speed + b.driftBias;
      if (b.x - b.span > canvas.width) b.x = -b.span; // ressort à gauche, dérive gauche→droite en boucle
      // Dérive verticale — 2 sinusoïdes propres à cet oiseau superposées à
      // baseY (voir mountainMakeBird) : monte/descend sans jamais suivre une
      // ligne droite ni un cycle strictement répétitif.
      b.y = b.baseY
        + Math.sin(t * b.waveFreq1 + b.wavePhase1) * b.waveAmp1
        + Math.sin(t * b.waveFreq2 + b.wavePhase2) * b.waveAmp2;
      mountainDrawBird(ctx, b, t);
    }
    appBackgroundAnimId = requestAnimationFrame(frame);
  }
  appBackgroundAnimId = requestAnimationFrame(frame);
}

// ─── Lac et forêt (2026-09-01, sur demande explicite) ──────────────────────
// Même principe statique+rAF que Plage/Montagne ci-dessus : ciel, montagnes,
// forêt et le reflet MIROIR de ces 3 éléments dans le lac ne bougent jamais
// (peints une fois sur `staticCanvas`, recopiés au début de chaque frame) —
// seules les ondulations de surface et les nappes de brume, qui doivent
// bouger, sont redessinées par-dessus à chaque frame. Les ondulations
// servent AUSSI à "casser" le reflet miroir parfait (voir lacDrawRipples) :
// c'est la "légère distorsion" demandée sur les reflets, sans avoir besoin
// d'un algorithme de déformation pixel par pixel séparé.
function lacDrawPineTree(ctx, x, baseY, height, width, color) {
  ctx.fillStyle = color;
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const tierH = (height / tiers) * 1.15;
    // i=0 = tier du BAS (large, base au niveau de `baseY`) ; i croissant =
    // tiers de plus en plus HAUTS et ÉTROITS, légèrement chevauchés — vrai
    // profil conique de sapin (large à la base, pointe étroite en haut),
    // pas l'inverse.
    const tierBottomY = baseY - i * tierH * 0.72;
    const tierTopY = tierBottomY - tierH;
    const tierW = width * (1 - i * 0.24);
    ctx.beginPath();
    ctx.moveTo(x, tierTopY);
    ctx.lineTo(x - tierW / 2, tierBottomY);
    ctx.lineTo(x + tierW / 2, tierBottomY);
    ctx.closePath();
    ctx.fill();
  }
}

// Rangée de sapins silhouettes, base commune alignée sur `treelineY` (la rive
// du lac) — hauteur/largeur/espacement variés pour un aspect naturel, jamais
// une rangée strictement régulière.
function lacDrawForestBand(ctx, w, treelineY, color, heightRange) {
  let x = -10;
  while (x < w + 10) {
    const height = heightRange[0] + Math.random() * (heightRange[1] - heightRange[0]);
    const width = height * 0.55;
    lacDrawPineTree(ctx, x, treelineY, height, width, color);
    x += width * (0.45 + Math.random() * 0.3); // chevauchement variable — "dense" demandé explicitement
  }
}

function lacDrawStaticScene(staticCanvas, w, h) {
  const sctx = staticCanvas.getContext('2d');
  staticCanvas.width = w;
  staticCanvas.height = h;

  const horizonY = h * 0.40;
  const treelineY = h * 0.58;
  const lakeTopY = treelineY;

  // Ciel — bleu profond en haut, s'éclaircit vers l'horizon (demandé explicitement).
  const skyGrad = sctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, '#040a1a');
  skyGrad.addColorStop(0.6, '#0f2a4a');
  skyGrad.addColorStop(1, '#3a6a8a');
  sctx.fillStyle = skyGrad;
  sctx.fillRect(0, 0, w, horizonY);

  // Dessine montagnes (3 couches, profondeur) + forêt — factorisé pour être
  // rejoué à l'identique en reflet miroir juste après (voir plus bas). Les 3
  // couches sont bornées entre l'horizon et la ligne de forêt (`treelineY`,
  // aussi leur bord de fermeture en bas) : la couche la plus ÉLOIGNÉE (la
  // plus claire) a les pics les plus hauts, la plus PROCHE (la plus sombre)
  // les pics les plus bas mais la silhouette la plus déchiquetée — même
  // logique de profondeur que le fond Montagne. La forêt (dessinée après)
  // recouvre ensuite le bas de chaque couche, ne laissant dépasser que les
  // pics au-dessus de la cime des arbres.
  const drawSceneLayers = () => {
    mountainDrawLayer(sctx, w, treelineY, '#152840', { baseY: h * 0.46, amp: h * 0.02, freq: 1.6, jagAmp: 0, jagFreq: 0, centerBoost: 0, centerWidth: 0 });
    mountainDrawLayer(sctx, w, treelineY, '#0e1d30', { baseY: h * 0.50, amp: h * 0.03, freq: 2.4, jagAmp: h * 0.01, jagFreq: 7, centerBoost: 0, centerWidth: 0 });
    mountainDrawLayer(sctx, w, treelineY, '#081420', { baseY: h * 0.54, amp: h * 0.025, freq: 3.1, jagAmp: h * 0.02, jagFreq: 10, centerBoost: 0, centerWidth: 0 });
    // Forêt — 2 passes (arbres plus grands derrière, plus petits/denses
    // devant) pour une silhouette dense plutôt qu'une rangée unique clairsemée.
    lacDrawForestBand(sctx, w, treelineY, '#0d2818', [h * 0.10, h * 0.18]);
    lacDrawForestBand(sctx, w, treelineY, '#0a2012', [h * 0.07, h * 0.13]);
  };
  drawSceneLayers();

  // Lac — surface plate réfléchissante, couleur EXACTE demandée.
  sctx.fillStyle = '#0a2a3a';
  sctx.fillRect(0, lakeTopY, w, h - lakeTopY);

  // Reflet — ciel + montagnes + forêt REJOUÉS en miroir (scale(1,-1) autour
  // de la ligne d'eau), semi-transparents et assombris par la couleur du lac
  // par-dessus (un vrai reflet sur l'eau est toujours plus sombre/désaturé
  // que l'original, jamais un miroir identique).
  sctx.save();
  sctx.beginPath();
  sctx.rect(0, lakeTopY, w, h - lakeTopY);
  sctx.clip();
  sctx.translate(0, lakeTopY * 2);
  sctx.scale(1, -1);
  sctx.globalAlpha = 0.5;
  sctx.fillStyle = skyGrad;
  sctx.fillRect(0, 0, w, horizonY);
  drawSceneLayers();
  sctx.restore();
  sctx.fillStyle = 'rgba(10, 42, 58, 0.35)';
  sctx.fillRect(0, lakeTopY, w, h - lakeTopY);
}

// Ondulations de surface — quelques lignes horizontales sinueuses qui
// dérivent lentement (même technique que beachDrawWaves), semi-transparentes :
// en plus de suggérer une eau qui bouge ("subtle ripple animation" demandé
// explicitement), elles cassent le reflet miroir parfait peint dans la scène
// statique — c'est la "légère distorsion" des reflets demandée, obtenue sans
// déformation pixel par pixel séparée.
function lacDrawRipples(ctx, w, lakeTopY, lakeHeight, t) {
  const rowCount = 6;
  for (let i = 0; i < rowCount; i++) {
    const y = lakeTopY + lakeHeight * (0.08 + i * 0.14);
    const phase = t * 0.0005 + i * 1.3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 18) {
      ctx.lineTo(x, y + Math.sin(x * 0.015 + phase) * 2.5);
    }
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.04 + (i % 2) * 0.03).toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Nappes de brume — quelques ellipses aplaties superposées (même principe
// que beachDrawCloud, formes rondes assemblées) formant une traînée
// horizontale floue, dérive TRÈS lente ("floating slowly" demandé explicitement).
function lacMakeMist(w, lakeTopY, lakeHeight) {
  return {
    x: Math.random() * w,
    y: lakeTopY + lakeHeight * (0.25 + Math.random() * 0.6),
    scale: Math.random() * 0.6 + 0.7,
    speed: Math.random() * 0.05 + 0.015,
  };
}

function lacDrawMist(ctx, m) {
  const r = 20 * m.scale;
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#e8eaf0';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(m.x + i * r * 0.9, m.y, r * 1.2, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function startLacBackground(layer) {
  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');

  let mists = [];
  let lakeTopY = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    lakeTopY = canvas.height * 0.58;
    lacDrawStaticScene(staticCanvas, canvas.width, canvas.height);
    mists = Array.from({ length: APP_BACKGROUND_LAC_MIST_COUNT }, () => lacMakeMist(canvas.width, lakeTopY, canvas.height - lakeTopY));
  }
  resize();
  appBackgroundResizeHandler = resize;
  window.addEventListener('resize', appBackgroundResizeHandler);

  function frame(t) {
    ctx.drawImage(staticCanvas, 0, 0);
    lacDrawRipples(ctx, canvas.width, lakeTopY, canvas.height - lakeTopY, t);
    for (const m of mists) {
      m.x += m.speed;
      if (m.x - 120 * m.scale > canvas.width) m.x = -120 * m.scale; // ressort à gauche, dérive gauche→droite en boucle
      lacDrawMist(ctx, m);
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
  else if (key === 'lac') startLacBackground(layer);
  // aurora/nebula/paper/geometric/gradient : pur CSS via la classe bg-<clé> posée ci-dessus, rien d'autre à faire.
}

function initAppBackground() {
  window.matin.store.get('app.background').then((key) => applyAppBackground(key || 'none'));
  window.matin.background.onUpdated((key) => applyAppBackground(key));
}

// ─── Mode d'affichage — Icône flottante (2026-08-23, sur demande explicite,
// voir Paramètres → Personnaliser → "Mode d'affichage" ; volet latéral
// SUPPRIMÉ ENTIÈREMENT le 2026-09-01, sur demande explicite, voir
// CONTEXT.md) ────────────────────────────────────────────────────────────
// Tout le déplacement/masquage RÉEL des fenêtres vit côté process main (voir
// main.js applyDisplayMode et alentours). Ce module ne fait plus QUE :
// afficher/masquer le bouton "Réduire" et gérer Échap.
// Visibilité de #btnCollapseToSun (2026-09-09, reconstruite sur demande
// explicite — l'ancien toggle display vivait directement dans applyModeUI
// ci-dessous, retiré avec le reste des références à ce bouton) : visible
// UNIQUEMENT si le mode d'affichage "flottant" est actif ET que le mode
// portrait ne l'est pas. `display-mode-floating` (classe déjà posée sur
// <body> par applyModeUI) sert de condition existante pour détecter le mode
// flottant actif — pas besoin d'un nouvel état séparé. Fonction top-level
// (pas nichée dans initDisplayMode) : appelée aussi depuis le toggle portrait
// de initDashboard, dans un autre scope.
function updateCollapseBtnVisibility() {
  const btn = document.getElementById('btnCollapseToSun');
  if (!btn) return;
  const isFloating = document.body.classList.contains('display-mode-floating');
  const isPortrait = document.body.classList.contains('portrait-mode');
  btn.style.display = (isFloating && !isPortrait) ? '' : 'none';
}

function initDisplayMode() {
  function applyModeUI(mode) {
    document.body.classList.toggle('display-mode-floating', mode === 'floating');
    updateCollapseBtnVisibility();
  }

  window.matin.store.get('app.displayMode').then((mode) => applyModeUI(mode || 'fullscreen'));
  window.matin.displayMode.onUpdated((mode) => applyModeUI(mode));

  // Clic sur #btnCollapseToSun (2026-09-11, sur demande explicite — bug réel
  // signalé : "le bouton existe visuellement mais son clic ne déclenche
  // rien"). Confirmé en lisant l'historique : retiré du refactor du
  // 2026-09-01 (voir commentaire d'en-tête ci-dessus, "l'ancien toggle
  // display... retiré avec le reste des références à ce bouton"), jamais
  // rajouté lors de la reconstruction du 2026-09-09, qui n'a reconstruit que
  // la VISIBILITÉ (updateCollapseBtnVisibility) — seule la touche Échap
  // ci-dessous appelait encore collapseToSun(), le bouton lui-même n'avait
  // plus aucun écouteur de clic.
  document.getElementById('btnCollapseToSun')?.addEventListener('click', () => {
    window.matin.displayMode.collapseToSun().catch(() => {});
  });

  // Échap réduit en icône flottante (mode "floating") — no-op côté main.js
  // hors de ce mode (voir main.js collapseToSun), donc pas besoin de
  // vérifier le mode courant ici.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    window.matin.displayMode.collapseToSun().catch(() => {});
  });
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

// Fermeture du bandeau (2026-09-01, sur demande explicite) — IDs des alertes
// fermées par l'utilisateur, EN MÉMOIRE SEULEMENT (Set JS, jamais persisté
// dans electron-store) : remis à zéro à chaque relance de l'app (nouveau
// contexte JS du renderer), comme demandé ("current session ... until next
// app launch"). Un id déjà dans cet ensemble reste filtré hors du bandeau
// tant que la MÊME alerte (même id, voir alertsCheckXxx dans main.js) reste
// active ; une alerte réellement nouvelle (id différent) n'y est jamais,
// donc passe le filtre et rouvre le bandeau — voir renderAlertsBanner.
const alertsDismissedIds = new Set();

// Empile les bandeaux plein écran actifs (Alertes, puis Données manquantes,
// voir plus bas — 2026-08-30) et repousse #dashboard d'exactement leur
// hauteur combinée. Les 2 bandeaux sont indépendants (une alerte active et
// des données manquantes ne s'excluent pas mutuellement) donc chacun peut
// apparaître/disparaître sans toucher l'autre — cette fonction est le seul
// endroit qui recalcule leur empilement, appelée par les 2 renderers.
function repositionBannersAndDashboard() {
  const dashboard = document.getElementById('dashboard');
  const alertsBanner = document.getElementById('alertsBanner');
  const missingBanner = document.getElementById('missingDataBanner');
  if (!dashboard) return;

  const alertsHeight = alertsBanner?.classList.contains('visible') ? alertsBanner.getBoundingClientRect().height : 0;
  if (missingBanner) {
    missingBanner.style.top = alertsHeight ? `calc(var(--titlebar-h) + ${alertsHeight}px)` : '';
  }
  const missingHeight = missingBanner?.classList.contains('visible') ? missingBanner.getBoundingClientRect().height : 0;

  const total = alertsHeight + missingHeight;
  dashboard.style.top = total ? `calc(var(--titlebar-h) + ${total}px)` : '';
}

function renderAlertsBanner(alerts) {
  const banner = document.getElementById('alertsBanner');
  if (!banner) return;

  // Alertes déjà fermées par l'utilisateur filtrées AVANT tout le reste
  // (gravité du bandeau, hauteur...) — voir alertsDismissedIds ci-dessus :
  // une alerte fermée reste invisible tant qu'elle reste la même, mais une
  // alerte réellement nouvelle (id absent de cet ensemble) la fait
  // réapparaître normalement.
  const visibleAlerts = Array.isArray(alerts) ? alerts.filter(a => !alertsDismissedIds.has(a.id)) : [];

  if (!visibleAlerts.length) {
    banner.classList.remove('visible', 'severity-red', 'severity-orange');
    banner.innerHTML = '';
    repositionBannersAndDashboard();
    return;
  }

  const worstSeverity = visibleAlerts.some(a => a.severity === 'red') ? 'red' : 'orange';
  banner.classList.add('visible');
  banner.classList.toggle('severity-red', worstSeverity === 'red');
  banner.classList.toggle('severity-orange', worstSeverity === 'orange');

  // `.alerts-banner-items` (colonne, une ligne par alerte) + bouton ✕ à
  // côté (voir .alerts-banner en row, style.css) — pas superposé en absolu
  // par-dessus, pour ne jamais chevaucher "En savoir plus →" à droite de
  // chaque ligne.
  banner.innerHTML = `
    <div class="alerts-banner-items">
      ${visibleAlerts.map(a => `
        <div class="alerts-banner-item" data-link="${a.link}">
          <span class="alerts-banner-icon">${a.icon}</span>
          <span class="alerts-banner-text">${a.text}</span>
          <span class="alerts-banner-link">${ALERTS_SEVERITY_ICON[a.severity] || ''} En savoir plus →</span>
        </div>
      `).join('')}
    </div>
    <button type="button" class="alerts-banner-close" title="Fermer">✕</button>
  `;

  banner.querySelectorAll('.alerts-banner-item').forEach((el) => {
    el.addEventListener('click', () => window.matin.shell.openExternal(el.dataset.link));
  });

  // Ferme le bandeau (2026-09-01, sur demande explicite) — mémorise les IDs
  // des alertes ACTUELLEMENT affichées (pas juste celle sous le curseur),
  // puis redemande un rendu : `visibleAlerts` sera vide au prochain appel
  // (ou ne contiendra plus qu'une alerte réellement nouvelle), voir le
  // filtre en tête de fonction.
  banner.querySelector('.alerts-banner-close').addEventListener('click', () => {
    visibleAlerts.forEach(a => alertsDismissedIds.add(a.id));
    renderAlertsBanner(alerts);
  });

  // Mesuré APRÈS peuplement (la hauteur dépend du nombre d'alertes/du retour
  // à la ligne du texte, jamais fixe) — repousse #dashboard d'exactement ce
  // qu'il faut, ni plus (espace perdu) ni moins (carte cachée sous le bandeau).
  repositionBannersAndDashboard();
}

function initAlertsBanner() {
  window.matin.alerts.getCurrent().then(renderAlertsBanner).catch(err => console.error('[Alertes] Échec chargement initial', err));
  window.matin.alerts.onUpdate(renderAlertsBanner);
}

// ─── Bandeau "Données manquantes" (2026-08-30, sur demande explicite, point 5
// — suite à l'incident de perte de données ETF/Crypto/Prêts) ───────────────
// Vérifié en LIVE (IPC userdata:isEmpty interrogé à chaud), jamais un flag
// figé lu une seule fois au lancement — l'état peut changer EN COURS de
// session (restauration auto au lancement déjà résolue avant ce premier
// appel, mais aussi restauration Drive et import manuel, tous deux
// susceptibles de survenir APRÈS le premier rendu). Re-vérifié à chaque
// événement Drive pertinent plutôt que sur un minuteur : ce sont les seuls
// moments où l'état peut réellement changer sans rechargement complet de la
// page (un import manuel ou une restauration de sauvegarde recharge de
// toute façon toute la fenêtre, donc ce code se ré-exécute déjà tout seul).
function renderMissingDataWarning(isEmpty) {
  const banner = document.getElementById('missingDataBanner');
  if (!banner) return;
  banner.classList.toggle('visible', !!isEmpty);
  repositionBannersAndDashboard();
}

function initMissingDataWarning() {
  const recheck = () => window.matin.userdata.isEmpty().then(renderMissingDataWarning).catch(() => {});
  recheck();
  window.matin.driveSync.onStatus(recheck);
  window.matin.driveSync.onUserdataRestored(recheck);

  document.getElementById('missingDataBannerBtn')?.addEventListener('click', () => {
    window.matin.window.openConfig({ openBackups: true });
  });
}

function createModuleCard(key, meta, title, subtitle) {
  const card = document.createElement('div');
  card.className = 'module-card';
  card.id = `module-${key}`;
  // Bordure gauche + couleur d'icône par catégorie (2026-08-08, voir
  // MODULE_REGISTRY.theme et style.css .module-card[data-theme]) — le module
  // Sports (ol) écrase cette valeur de départ une fois le sport de l'équipe
  // réellement résolu (voir ol.js).
  if (meta.theme) card.dataset.theme = meta.theme;
  const clickable = isSportsKey(key) || Object.prototype.hasOwnProperty.call(MODULE_CLICK_URLS, key);
  const titleHtml = `
      <div class="module-title${clickable ? ' module-title-clickable' : ''}" title="${clickable ? 'Ouvrir le site' : ''}">
        <span class="module-icon">${meta.icon}</span>
        ${title}${key === 'tradfri' ? ' <span class="beta-badge">Bêta</span>' : ''}
      </div>`;
  // Sous-titre (2026-09-01, sur demande explicite — actuellement Prêts
  // seulement, voir resolveModuleSubtitle) : enveloppe `.module-title` dans
  // un `.module-title-group` (colonne) UNIQUEMENT quand il y a un sous-titre
  // à afficher — les modules sans sous-titre gardent EXACTEMENT la même
  // structure qu'avant (`.module-title` enfant direct de `.module-header`),
  // aucun changement visuel/CSS pour eux.
  const titleBlockHtml = subtitle
    ? `<div class="module-title-group">${titleHtml}<div class="module-subtitle">${subtitle}</div></div>`
    : titleHtml;
  card.innerHTML = `
    <div class="module-header">
      ${titleBlockHtml}
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
      // `.catch` silencieux (2026-09-12, sur demande explicite pour le cas
      // Spotify — voir MODULE_CLICK_URLS) : `spotify:` rejette la promesse
      // si aucune app n'est enregistrée pour ce protocole (Spotify non
      // installé) — pas de dialogue/erreur visible pour l'utilisateur.
      // Inoffensif pour les autres modules (URLs http(s) classiques,
      // n'échouent normalement jamais de cette façon).
      if (url) window.matin.shell.openExternal(url).catch(() => {});
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

// ─── "⊞ Réorganiser" — remplissage en rangées pleine largeur (2026-08-24,
// réécriture complète sur demande explicite, remplace l'ancien bin-packing
// "skyline" par catégorie/colonnes) ─────────────────────────────────────────
// PRINCIPE UNIQUE, partagé par les 6 styles ci-dessous : chaque module GARDE
// sa taille ACTUELLE (jamais redimensionné, ni en largeur ni — sauf exception
// ponctuelle documentée plus bas — en hauteur) et vient simplement se ranger
// à la SUITE du précédent sur la rangée courante, de gauche à droite ; une
// nouvelle rangée ne démarre que quand le module suivant ne tient plus dans
// la largeur restante de la rangée en cours. Aucune grille de colonnes fixe,
// aucune notion de région/colonne comme l'ancien système : la largeur
// d'écran est occupée au fil de l'eau par les modules tels qu'ils sont.
// Les 6 styles nommés (voir AUTOARRANGE_STYLES plus bas) ne diffèrent donc
// plus QUE par l'ORDRE dans lequel les modules sont fournis à ce remplisseur
// (+ l'espacement, normal pour 3 d'entre eux / resserré pour les 3
// "Compact", seul paramètre à varier en dehors du tri) — jamais par une
// logique de remplissage différente.
const AUTOARRANGE_CATEGORY_ORDER = [
  'finance', 'football', 'basket', 'other-sports', 'actualites',
  'fdj', 'musique', 'maison', 'services', 'perso',
];
const AUTOARRANGE_GAP = 16;
const AUTOARRANGE_GAP_COMPACT = 8;

// Remplisseur en rangées — LE seul algorithme de placement, utilisé par les 6
// styles. `cardsInfo` doit déjà être dans l'ordre voulu (voir les fonctions
// autoArrangeOrderX plus bas) ; ce remplisseur ne trie rien lui-même, il se
// contente d'empiler dans l'ordre reçu.
//
// Alignement des bas de rangée (dernier point demandé) : une fois une rangée
// posée, les modules à hauteur FIXE (jamais ceux à hauteur auto — voir
// isAutoHeightKey, leur hauteur réelle suit toujours leur contenu, l'imposer
// ici casserait leur affichage) dont la hauteur est déjà PROCHE de la plus
// haute de leur rangée (tolérance ci-dessous) sont étirés pour matcher
// exactement — un alignement visuel propre pour des voisins presque égaux,
// jamais un redimensionnement arbitraire de modules de tailles franchement
// différentes (ex. jamais une carte de 120px étirée à 400px).
const AUTOARRANGE_ROW_ALIGN_TOLERANCE_RATIO = 0.1;
const AUTOARRANGE_ROW_ALIGN_TOLERANCE_MIN = 20;

function packModulesIntoRows(orderedCardsInfo, containerWidth, gap) {
  const rows = [];
  let currentRow = [];
  let rowWidth = 0;
  for (const info of orderedCardsInfo) {
    const nextWidth = currentRow.length ? rowWidth + gap + info.width : info.width;
    if (currentRow.length && nextWidth > containerWidth) {
      rows.push(currentRow);
      currentRow = [];
      rowWidth = 0;
    }
    currentRow.push(info);
    rowWidth = currentRow.length === 1 ? info.width : rowWidth + gap + info.width;
  }
  if (currentRow.length) rows.push(currentRow);

  const layouts = {};
  let y = 0;
  for (const row of rows) {
    const rowMaxHeight = Math.max(...row.map(i => i.height));
    const tolerance = Math.max(AUTOARRANGE_ROW_ALIGN_TOLERANCE_MIN, rowMaxHeight * AUTOARRANGE_ROW_ALIGN_TOLERANCE_RATIO);
    let x = 0;
    for (const info of row) {
      const closeEnough = (rowMaxHeight - info.height) <= tolerance;
      const height = (!isAutoHeightKey(info.key) && closeEnough) ? rowMaxHeight : info.height;
      layouts[info.key] = { x, y, width: info.width, height, z: 10 };
      x += info.width + gap;
    }
    y += rowMaxHeight + gap;
  }
  return layouts;
}

// Tri stable par catégorie (thème réel de chaque carte, lu sur
// `card.dataset.theme` — pas `MODULE_REGISTRY[key].theme`, qui pour Sports
// (ol) n'est qu'une valeur de départ avant résolution du sport réel, voir
// olThemeForSport) : les modules d'une même catégorie restent groupés et
// gardent leur ordre relatif d'origine (tri stable — garanti par le moteur
// JS des versions de Chromium/Node utilisées par Electron ici). Tout thème
// absent de `order` retombe en fin de liste (même rang que 'perso', déjà en
// dernière position dans AUTOARRANGE_CATEGORY_ORDER).
function sortByCategoryOrder(cardsInfo, order) {
  const rank = new Map(order.map((cat, i) => [cat, i]));
  return [...cardsInfo].sort((a, b) => {
    const ra = rank.has(a.theme) ? rank.get(a.theme) : order.length;
    const rb = rank.has(b.theme) ? rank.get(b.theme) : order.length;
    return ra - rb;
  });
}

// 6 styles nommés — chacun fournit un ORDRE différent (voir principe unique
// en tête de section), jamais une logique de placement différente.

// Prioritaire — ETF/Gmail/Agenda passent en tête de liste (se retrouvent
// donc naturellement sur la 1re rangée, à leur taille réelle), le reste suit
// dans l'ordre de catégorie standard.
const AUTOARRANGE_PRIORITY_KEYS = ['etf', 'gmail', 'calendar'];
function autoArrangeOrderPrioritaire(cardsInfo) {
  const priority = AUTOARRANGE_PRIORITY_KEYS
    .map(key => cardsInfo.find(c => c.key === key))
    .filter(Boolean);
  const rest = cardsInfo.filter(c => !AUTOARRANGE_PRIORITY_KEYS.includes(c.key));
  return [...priority, ...sortByCategoryOrder(rest, AUTOARRANGE_CATEGORY_ORDER)];
}

// Éditorial — Actualités en tête (se retrouve donc en haut du dashboard),
// reste des catégories dans l'ordre standard ensuite.
const AUTOARRANGE_ORDER_EDITORIAL = ['actualites', ...AUTOARRANGE_CATEGORY_ORDER.filter(c => c !== 'actualites')];
function autoArrangeOrderEditorial(cardsInfo) {
  return sortByCategoryOrder(cardsInfo, AUTOARRANGE_ORDER_EDITORIAL);
}

// Équilibré — ordre de catégorie standard tel quel, référence "neutre" des 6.
function autoArrangeOrderEquilibre(cardsInfo) {
  return sortByCategoryOrder(cardsInfo, AUTOARRANGE_CATEGORY_ORDER);
}

// Compact Thèmes — ordre de catégorie INVERSÉ (perso/services/maison en tête
// au lieu de Finance) + espacement resserré (voir AUTOARRANGE_GAP_COMPACT
// dans AUTOARRANGE_GAP_FOR_STYLE) : variante dense, ordre de lecture opposé
// à Équilibré.
const AUTOARRANGE_ORDER_COMPACT_THEMES = [...AUTOARRANGE_CATEGORY_ORDER].reverse();
function autoArrangeOrderCompactThemes(cardsInfo) {
  return sortByCategoryOrder(cardsInfo, AUTOARRANGE_ORDER_COMPACT_THEMES);
}

// Compact Colonnes — encore un autre ordre de catégorie (Finance/Actualités
// en tête, Sports au milieu, vie perso en fin) + espacement resserré :
// 3e permutation distincte, pour une vraie variété entre les 3 styles
// "Compact" au-delà du seul espacement.
const AUTOARRANGE_ORDER_COMPACT_COLONNES = ['finance', 'actualites', 'football', 'basket', 'other-sports', 'services', 'maison', 'fdj', 'musique', 'perso'];
function autoArrangeOrderCompactColonnes(cardsInfo) {
  return sortByCategoryOrder(cardsInfo, AUTOARRANGE_ORDER_COMPACT_COLONNES);
}

// Compact Mosaïque — catégories triées par hauteur TOTALE décroissante
// (reprend l'esprit de l'ancienne colonne "Mosaïque" — équilibrer par
// taille — mais comme un simple critère de TRI alimentant le même
// remplisseur en rangées, plus une répartition en colonnes séparée) : les
// catégories les plus volumineuses passent en premier.
function autoArrangeOrderCompactMosaique(cardsInfo) {
  const totalByCat = new Map();
  for (const info of cardsInfo) {
    const cat = AUTOARRANGE_CATEGORY_ORDER.includes(info.theme) ? info.theme : 'perso';
    totalByCat.set(cat, (totalByCat.get(cat) || 0) + info.height);
  }
  const order = [...AUTOARRANGE_CATEGORY_ORDER].sort((a, b) => (totalByCat.get(b) || 0) - (totalByCat.get(a) || 0));
  return sortByCategoryOrder(cardsInfo, order);
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
const AUTOARRANGE_ORDER_FN = {
  prioritaire: autoArrangeOrderPrioritaire,
  editorial: autoArrangeOrderEditorial,
  equilibre: autoArrangeOrderEquilibre,
  'compact-themes': autoArrangeOrderCompactThemes,
  'compact-colonnes': autoArrangeOrderCompactColonnes,
  'compact-mosaique': autoArrangeOrderCompactMosaique,
};
// Seul paramètre (avec le tri) à varier entre styles — voir le principe
// unique en tête de section : les 3 "Compact" gardent leur espacement
// resserré historique, les 3 autres l'espacement normal.
const AUTOARRANGE_GAP_FOR_STYLE = {
  prioritaire: AUTOARRANGE_GAP,
  editorial: AUTOARRANGE_GAP,
  equilibre: AUTOARRANGE_GAP,
  'compact-themes': AUTOARRANGE_GAP_COMPACT,
  'compact-colonnes': AUTOARRANGE_GAP_COMPACT,
  'compact-mosaique': AUTOARRANGE_GAP_COMPACT,
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

// Point d'entrée unique : trie `cardsInfo` selon le style demandé, puis le
// passe TEL QUEL (tailles inchangées) au remplisseur en rangées commun.
function computeAutoArrangeLayout(style, cardsInfo, containerWidth) {
  const orderFn = AUTOARRANGE_ORDER_FN[style] || autoArrangeOrderEquilibre;
  const gap = AUTOARRANGE_GAP_FOR_STYLE[style] ?? AUTOARRANGE_GAP;
  return packModulesIntoRows(orderFn(cardsInfo), containerWidth, gap);
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
// bien au-delà de la zone visuellement centrée. `.portrait-mode` (2026-09-07)
// suit exactement le même principe, borne resserrée plutôt qu'élargie —
// vérifié EN PREMIER : les 2 classes ne devraient jamais être actives
// ensemble en pratique (un écran réellement portrait n'est jamais aussi
// ultrawide), mais si jamais c'était le cas, portrait doit l'emporter,
// cohérent avec le bouton que l'utilisateur vient de cliquer en dernier.
function dashboardContentBounds(dashboard) {
  const full = dashboard.clientWidth || 1200;
  // Portrait : pleine largeur pour le placement libre des modules (2026-09-08,
  // sur demande explicite — corrige un blocage réel du glisser-déposer : la
  // zone bornée/centrée ci-dessous empêchait interact.js de déposer un module
  // au-delà de x=580 sur un écran 1920px, alors que rien ne devrait limiter
  // le DRAG lui-même). Le resserrement "2 colonnes" reste géré par
  // reflowForPortrait() au moment du clic bouton, pas ici — pas besoin de
  // brider le drag pour ça.
  if (document.body.classList.contains('portrait-mode')) {
    return { left: 0, width: full };
  }
  if (document.body.classList.contains('ultrawide') && full > ULTRAWIDE_MAX_CONTENT_WIDTH) {
    return { left: (full - ULTRAWIDE_MAX_CONTENT_WIDTH) / 2, width: ULTRAWIDE_MAX_CONTENT_WIDTH };
  }
  return { left: 0, width: full };
}

// Décale tous les `x` d'un jeu de dispositions déjà calculé (voir
// computeDefaultLayout/computeAutoArrangeLayout, tous deux calculés en
// coordonnées LOCALES 0..containerWidth) du décalage gauche de la zone de
// contenu — post-traitement plutôt que de faire transiter l'offset à travers
// le remplisseur en rangées, plus simple et sans risque de régression sur sa
// logique interne.
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
// avec leur propre défilement (ex. `.monequipe-section-list`, `.fdj-grids-list`).
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

// Défilement automatique — SUPPRIMÉ ENTIÈREMENT le 2026-09-01, sur demande
// explicite (voir CONTEXT.md) : `initAutoScroll` et tout son mécanisme
// (setInterval, pause au survol, retour en haut) retirés.

// ─── Sélecteur de profil — titrebar (2026-08-31, sur demande explicite,
// "à côté de Paramètres") ────────────────────────────────────────────────
// Bouton unique qui bascule INSTANTANÉMENT entre les 2 profils au clic
// (main.js profiles:switch applique modules/thème puis diffuse
// 'modules:updated', déjà écouté ailleurs dans ce fichier pour un
// `location.reload()` — la bascule se traduit donc par un simple
// rechargement, comme tout autre changement structurel de modules). Le
// libellé du bouton ("Vers → <nom de l'AUTRE profil>", 🚪 retiré, 2026-09-01,
// sur demande explicite — annonce désormais la DESTINATION du clic, pas le
// profil déjà actif) n'a besoin d'être peuplé qu'une fois à l'ouverture : un
// `location.reload()` survient de toute façon à chaque bascule, qui
// réexécute cette même fonction et relit le nom à jour (donc la destination
// suivante, l'ex-profil actif, une fois basculé).
function initProfileSwitcher() {
  const btn = document.getElementById('btnProfileSwitch');
  if (!btn) return;

  window.matin.profiles.getAll().then((profiles) => {
    const nextKey = profiles.active === 'profile2' ? 'profile1' : 'profile2';
    const other = profiles?.[nextKey];
    btn.textContent = `Vers → ${other?.name || 'Profil'}`;

    btn.addEventListener('click', () => {
      btn.disabled = true;
      window.matin.profiles.switch(nextKey)
        .catch(err => {
          console.error('[Matin] Échec changement de profil', err);
          btn.disabled = false;
        });
      // Pas de réactivation du bouton en cas de succès : le
      // `location.reload()` déclenché par 'modules:updated' (voir onUpdated
      // plus bas) recharge toute la fenêtre de toute façon.
    });
  }).catch(err => console.error('[Matin] Échec lecture des profils', err));
}

// ─── Sync Google Drive — indicateur titlebar (2026-08-21, voir main.js
// performDriveLaunchSync/scheduleDriveUploadAfterChange) ───────────────────
// Purement cosmétique : la synchronisation elle-même tourne entièrement côté
// process main, ce code ne fait qu'afficher "✓ Saved" 3s
// quand elle réussit. `getLastStatus()` rattrape une sync déjà terminée avant
// que cet écouteur soit posé (voir preload.js) ; `onStatus` couvre le reste
// de la session (rare en pratique, la sync de lancement ne se déclenche
// qu'une fois par démarrage — voir main.js).
//
// `splashDone` (2026-08-30, bug signalé "l'indicateur n'apparaît jamais") :
// la sync de lancement se termine et notifie en général en 1-2s, largement
// AVANT la fin du splash (~3,3-3,5s, voir playSplashAnimation) — sans ce
// garde-fou, les 3s d'affichage de l'indicateur se déroulaient entièrement
// SOUS l'overlay de démarrage (opaque, z-index 10000 > titlebar), invisible
// à l'utilisateur puisque déjà retombé à `opacity:0` une fois le splash
// dissipé. On attend donc la fin du splash avant de poser `.visible`, sans
// jamais perdre l'événement lui-même (l'écouteur reste posé immédiatement).
//
// Durée 3s → 8s (2026-08-30, sur demande explicite "plus facile à repérer") —
// même symptôme signalé après le fix ci-dessus, donc on instrumente aussi le
// timing exact des deux côtés (voir logs `[Drive Sync]`/`[Drive Sync Debug]`)
// pour confirmer où précisément ça coince.
const DRIVE_SYNC_INDICATOR_MS = 8000;
function initDriveSyncIndicator(splashDone) {
  const el = document.getElementById('driveSyncIndicator');
  if (!el || !window.matin.driveSync) return;

  Promise.resolve(splashDone).then(() => {
    console.log('[Drive Sync Debug] splash terminé à', new Date().toISOString(), '(', Date.now(), 'ms epoch)');
  });

  let hideTimer = null;
  const showFor3s = (status) => {
    console.log('[Drive Sync Debug] statut reçu côté renderer à', new Date().toISOString(), ':', JSON.stringify(status));
    if (!status || status.type !== 'synced') return;
    Promise.resolve(splashDone).then(() => {
      console.log('[Drive Sync Debug] affichage de l’indicateur à', new Date().toISOString(), '— élément trouvé :', !!el);
      el.textContent = '✓';
      el.classList.add('visible');
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        console.log('[Drive Sync Debug] masquage de l’indicateur à', new Date().toISOString());
        el.classList.remove('visible');
      }, DRIVE_SYNC_INDICATOR_MS);
    });
  };

  window.matin.driveSync.getLastStatus().then(showFor3s).catch(() => {});
  window.matin.driveSync.onStatus(showFor3s);
}

// Restauration Drive silencieuse (2026-08-30, bug trouvé lors du diagnostic
// de l'indicateur) : `drive:userdataRestored` remplace `modules:updated`
// (voir preload.js/main.js driveApplyDownloadedUserdata) pour ce cas précis
// — Drive ne touche jamais position/taille/disposition (voir
// USERDATA_MODULE_KEYS côté main.js), donc pas besoin de reconstruire les
// cartes, seulement de rafraîchir le CONTENU de celles déjà à l'écran, via
// `renderModuleOnce` (même fonction que le bouton Actualiser/le refresh
// périodique, voir plus haut) — jamais `window.location.reload()`.
function initDriveUserdataRestoreListener() {
  if (!window.matin.driveSync?.onUserdataRestored) return;
  window.matin.driveSync.onUserdataRestored((modules) => {
    if (!modules || typeof modules !== 'object') return;
    for (const [key, moduleConf] of Object.entries(modules)) {
      if (!document.getElementById(`content-${key}`)) continue; // carte pas affichée — rien à rafraîchir
      const meta = resolveModuleMeta(key);
      if (!meta) continue;
      renderModuleOnce(key, meta, moduleConf.config);
    }
  });
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
  initDriveSyncIndicator(splashDone);
  initDriveUserdataRestoreListener();
  initThemeSync();
  initAppBackground();
  initDisplayMode();
  initAlertsBanner();
  initMissingDataWarning();
  initPreciseScrolling();
  initProfileSwitcher();

  // Restauration automatique au lancement (voir main.js
  // autoRestoreUserdataIfEmpty, 2026-08-10) — une notification native a déjà
  // été envoyée côté process main ; ce simple `alert()` (même mécanisme que
  // config.js pour les confirmations destructives) garantit que l'info reste
  // visible même si la notification native a été manquée/désactivée par l'OS.
  window.matin.getAutoRestoreNotice().then((notice) => {
    if (!notice) return;
    const dateLabel = new Date(notice.mtimeMs).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    alert(`Vos données (ETF, Crypto, Mon Prêt...) semblaient vides au lancement.\n\nElles ont été restaurées automatiquement depuis la sauvegarde du ${dateLabel}.`);
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

  // Mode portrait (2026-09-07, sur demande explicite) — classe posée sur
  // <body> AVANT tout calcul de placement ci-dessous (dashboardContentBounds
  // en tient compte, voir plus haut, même principe que .ultrawide) : la
  // disposition déjà enregistrée (portrait OU paysage, selon le mode actif
  // au dernier enregistrement) s'affiche donc correctement dès ce premier
  // rendu, sans re-calcul — seul un VRAI basculement (voir btnPortraitMode
  // plus bas) redispose les cartes.
  const isPortraitMode = await window.matin.store.get('ui.portraitMode').catch(() => false);
  document.body.classList.toggle('portrait-mode', !!isPortraitMode);
  // Ajout au-delà de la demande littérale (qui ne visait que le clic du
  // bouton portrait et le changement de mode d'affichage) : initDisplayMode()
  // est appelée plus tôt (ligne ~2428, avant ce bloc), donc son premier appel
  // à updateCollapseBtnVisibility() peut s'exécuter AVANT que la classe
  // portrait-mode ne soit posée ci-dessus (2 promesses IPC concurrentes, sans
  // ordre garanti) — sans cet appel, l'état initial du bouton pourrait être
  // faux dans ce cas de course.
  updateCollapseBtnVisibility();

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
    const subtitle = resolveModuleSubtitle(key, moduleConf.config);
    const card = createModuleCard(key, meta, title, subtitle);
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

  // Rechargement automatique du dernier slot Réorganiser actif (2026-09-09,
  // sur demande explicite, remplace la tentative précédente par snapshot
  // pré-reload) — voir `loadLayoutSlot` (plus bas dans cette fonction,
  // disponible ici par hoisting) qui pose `matin-last-active-slot` une fois
  // le layout appliqué. Délai 100ms : laisse le temps aux cartes ci-dessus
  // d'être posées dans le DOM avant que `loadLayoutSlot` ne les cherche via
  // `canvas.querySelectorAll('.module-card')`.
  const lastSlot = localStorage.getItem('matin-last-active-slot');
  if (lastSlot) {
    setTimeout(() => loadLayoutSlot(lastSlot), 100);
  }

  updateCanvasHeight(canvas);

  // Filet de sécurité anti-débordement en mode portrait (2026-09-09, sur
  // demande explicite — bug réel : "les modules débordent hors des limites
  // de la fenêtre, l'utilisateur doit redimensionner manuellement pour les
  // voir"). `clampCardsToPortraitWidth` (voir plus bas, définie près de
  // `reflowForPortrait`) ne fait rien si `.portrait-mode` n'est pas actif à
  // cet instant — appel systématique ici, sans condition, pour rester
  // correct dans les 2 cas.
  clampCardsToPortraitWidth();

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
    // voir updateCanvasHeight) — sert UNIQUEMENT au texte informatif de la
    // notice ci-dessous (scroll nécessaire ou non), plus à rétrécir quoi que
    // ce soit (2026-08-24, réécriture complète — les modules gardent
    // TOUJOURS leur taille actuelle, voir computeAutoArrangeLayout/
    // packModulesIntoRows) : si le résultat dépasse la hauteur visible, la
    // page défile, un point c'est tout.
    const { left: contentLeft, width: containerWidth } = dashboardContentBounds(dashboard);
    const containerHeight = dashboard.clientHeight || 800;
    const style = pickRandomAutoArrangeStyle();
    const rawLayouts = computeAutoArrangeLayout(style, cardsInfo, containerWidth);
    const newLayouts = shiftLayoutsX(rawLayouts, contentLeft);
    applyAutoArrangeLayouts(cards, newLayouts);
    // Filet de sécurité portrait (2026-09-09, sur demande explicite — bug
    // réel : un grand module comme YouTube/ETF garde sa largeur ACTUELLE
    // (voir cardsInfo ci-dessus, `card.offsetWidth`) au lieu de s'adapter à
    // une fenêtre portrait plus étroite — `packModulesIntoRows`/
    // `computeAutoArrangeLayout` REPOSITIONNENT les cartes mais ne
    // redimensionnent JAMAIS leur largeur, par conception (voir commentaire
    // plus haut, "les modules gardent TOUJOURS leur taille actuelle") ; en
    // portrait, `dashboardContentBounds` renvoie en plus la PLEINE largeur
    // de la fenêtre (2026-09-08, pour ne pas brider le drag), pas la largeur
    // resserrée de `reflowForPortrait` — un module resté large peut donc
    // déborder après un "⊞ Réorganiser" déclenché depuis le mode portrait.
    // Même filet que celui posé au chargement/redimensionnement (voir
    // clampCardsToPortraitWidth plus bas) : no-op hors mode portrait.
    clampCardsToPortraitWidth();

    const maxBottom = Object.values(rawLayouts).reduce((max, l) => Math.max(max, l.y + l.height), 0);
    const fits = maxBottom <= containerHeight;

    const notice = document.getElementById('autoArrangeNotice');
    if (notice) {
      const text = document.getElementById('autoArrangeNoticeText');
      const fitLabel = fits
        ? `${cardsInfo.length} modules affichés sur 1 page`
        : 'Scroll nécessaire — trop de modules actifs';
      if (text) text.textContent = `✓ Disposition « ${AUTOARRANGE_STYLE_LABELS[style]} » — ${fitLabel}`;
      notice.classList.add('show');
      clearTimeout(notice._hideTimer);
      notice._hideTimer = setTimeout(() => notice.classList.remove('show'), 2000);
    }
  }

  // ─── Mode portrait (2026-09-07, sur demande explicite) ───────────────────
  // Bouton bascule (⇅ paysage / ↕ portrait) dans la barre d'outils — PAS un
  // bouton flottant séparé, réutilise `.titlebar-btn`/`.titlebar-icon-btn`
  // déjà en place pour Actualiser/Réorganiser/Paramètres (voir index.html),
  // plus cohérent visuellement (couleurs de thème correctes en clair/sombre)
  // qu'un bouton neuf aux couleurs codées en dur. Réutilise le remplisseur en
  // rangées de "⊞ Réorganiser" (packModulesIntoRows) MAIS avec l'ordre de
  // lecture ACTUEL des cartes (rangée puis colonne), pas un tri par
  // catégorie : il s'agit de RESTACKER les mêmes modules dans une colonne
  // plus étroite, pas de les mélanger comme le ferait un vrai Réorganiser.
  // La largeur resserrée vient de `dashboardContentBounds`, déjà au courant
  // de `.portrait-mode` (voir plus haut) — un seul point de vérité pour
  // "quelle largeur de dépôt utiliser en ce moment", partagé avec le
  // placement par défaut/les bornes de glisser-déposer.
  function sortByCurrentPosition(cardsInfo, cardsByKey) {
    return [...cardsInfo].sort((a, b) => {
      const ca = cardsByKey.get(a.key), cb = cardsByKey.get(b.key);
      const ya = parseFloat(ca.dataset.y) || 0, yb = parseFloat(cb.dataset.y) || 0;
      if (Math.abs(ya - yb) > 40) return ya - yb; // rangées visuellement différentes
      return (parseFloat(ca.dataset.x) || 0) - (parseFloat(cb.dataset.x) || 0);
    });
  }

  function snapshotCurrentLayout(cards) {
    const snapshot = {};
    for (const card of cards) {
      const key = card.id.replace('module-', '');
      snapshot[key] = {
        x: parseFloat(card.dataset.x) || 0,
        y: parseFloat(card.dataset.y) || 0,
        width: card.offsetWidth,
        height: card.offsetHeight,
        z: parseInt(card.style.zIndex, 10) || 10,
      };
    }
    return snapshot;
  }

  function reflowForPortrait() {
    // Sauté une seule fois après un reload déclenché par une sauvegarde de
    // paramètres (voir le flag posé juste avant `window.location.reload()`
    // plus bas, sur 'modules:updated') — sans ce garde-fou, ce reflow
    // écrasait la disposition qui vient d'être restaurée correctement par
    // `placeCard` au chargement (bug signalé, 2026-09-09). Le flag est retiré
    // immédiatement après lecture, donc un VRAI clic ultérieur sur le bouton
    // bascule portrait (ou un lancement normal de l'app, qui ne pose jamais
    // ce flag) continue de déclencher le reflow normalement. Posé en TOUTE
    // PREMIÈRE ligne (avant même les déclarations ci-dessous) pour sauter le
    // reflow avant le moindre calcul.
    if (localStorage.getItem('matin-skip-portrait-reflow')) {
      localStorage.removeItem('matin-skip-portrait-reflow');
      console.log('[Portrait] Skip reflow');
      return;
    }
    const cards = Array.from(canvas.querySelectorAll('.module-card'));
    if (!cards.length) return;
    const cardsByKey = new Map(cards.map(c => [c.id.replace('module-', ''), c]));
    const cardsInfo = cards.map(card => ({
      key: card.id.replace('module-', ''),
      width: card.offsetWidth,
      height: card.offsetHeight,
    }));
    const ordered = sortByCurrentPosition(cardsInfo, cardsByKey);
    // Plafond `PORTRAIT_MAX_CONTENT_WIDTH` (760px) RETIRÉ ici (2026-09-09, sur
    // demande explicite — constat réel : la disposition "Portrait rangé 4"
    // sauvegardée place des modules jusqu'à x:1062px (842+220), largement
    // au-delà de ce plafond, qui compressait donc tout au reflow suivant).
    // `containerWidth` utilise désormais la vraie largeur du conteneur
    // (`dashboard.clientWidth`), avec `window.innerWidth` en 2e repli si la
    // 1re mesure est nulle (ex. élément pas encore dans le DOM) — `contentLeft`
    // reste à 0 (pas de centrage) pour que les modules commencent au bord
    // gauche réel de l'écran, pas au milieu.
    const containerWidth = dashboard.clientWidth || window.innerWidth || 1200;
    const contentLeft = 0;
    const rawLayouts = packModulesIntoRows(ordered, containerWidth, AUTOARRANGE_GAP);
    const newLayouts = shiftLayoutsX(rawLayouts, contentLeft);
    applyAutoArrangeLayouts(cards, newLayouts);
  }

  // Filet de sécurité anti-débordement en mode portrait (2026-09-09, sur
  // demande explicite — bug réel signalé : des modules apparaissent hors des
  // limites de la fenêtre en portrait, obligeant à redimensionner
  // manuellement). CAUSE RÉELLE trouvée dans ce fichier : `moduleConf.layout`
  // (x/y/width enregistrés, voir plus haut `placeCard(card, layout, key)`)
  // est réutilisé TEL QUEL au chargement, qu'il ait été enregistré en
  // paysage ou en portrait — `reflowForPortrait()` ci-dessus ne s'exécute
  // QUE sur un VRAI clic du bouton bascule (voir plus bas), jamais au
  // chargement d'une page déjà en portrait (ex. après redémarrage de l'app,
  // ou changement de profil dont la disposition sauvegardée est restée
  // paysage alors que `ui.portraitMode` est global) ni après un
  // redimensionnement de fenêtre pendant que ce mode est déjà actif. Une
  // carte positionnée pour une fenêtre paysage large peut donc se retrouver
  // hors des limites d'une fenêtre portrait plus étroite, sans qu'aucun code
  // existant ne la ramène dans les clous.
  // Ne REMPILE PAS tout comme reflowForPortrait (qui écraserait un
  // arrangement manuel de l'utilisateur même s'il tient déjà dans la
  // fenêtre) : ne touche qu'aux cartes RÉELLEMENT hors limites (largeur ou
  // position x), via `placeCard` pour rester cohérente avec tout le reste
  // (module-compact, updateSizeTier, topZ).
  function clampCardsToPortraitWidth() {
    if (!document.body.classList.contains('portrait-mode')) return;
    const cards = Array.from(canvas.querySelectorAll('.module-card'));
    if (!cards.length) return;
    // Plafond `PORTRAIT_MAX_CONTENT_WIDTH` (760px) RETIRÉ ici (2026-09-09, sur
    // demande explicite — même correctif que reflowForPortrait plus haut,
    // oublié ici lors de ce 1er passage : cette fonction reclampait x:842 →
    // x:540 à CHAQUE init/resize/reload, quelle que soit la largeur réelle de
    // la fenêtre, et persistait en plus cette valeur clampée sur disque via
    // `modulesConf`/`updateLayout` ci-dessous). `containerWidth` utilise
    // désormais la vraie largeur du conteneur, comme `reflowForPortrait`.
    const containerWidth = dashboard.clientWidth || window.innerWidth || 1200;
    let changed = false;

    for (const card of cards) {
      const key = card.id.replace('module-', '');
      const current = {
        x: parseFloat(card.dataset.x) || 0,
        y: parseFloat(card.dataset.y) || 0,
        width: card.offsetWidth,
        height: card.offsetHeight,
        z: parseInt(card.style.zIndex, 10) || 10,
      };
      const width = Math.min(current.width, containerWidth);
      const x = Math.min(current.x, Math.max(0, containerWidth - width));
      if (width === current.width && x === current.x) continue; // déjà dans les clous

      const clamped = { ...current, x, width };
      placeCard(card, clamped, key);
      if (modulesConf[key]) modulesConf[key].layout = clamped;
      changed = true;
    }

    if (changed) {
      updateCanvasHeight(canvas);
      window.matin.modules.updateLayout(modulesConf)
        .catch(err => console.error('[Matin] Échec sauvegarde du recadrage portrait', err));
    }
  }

  // Redimensionnement de fenêtre pendant que le mode portrait est déjà actif
  // (ex. rotation physique d'un écran externe après le chargement de l'app)
  // — même filet de sécurité que ci-dessus, débattu (200ms) pour ne pas
  // recalculer à chaque pixel pendant un redimensionnement en cours.
  let portraitClampResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(portraitClampResizeTimer);
    portraitClampResizeTimer = setTimeout(clampCardsToPortraitWidth, 200);
  });

  const btnPortraitMode = document.getElementById('btnPortraitMode');
  btnPortraitMode?.addEventListener('click', async () => {
    const turningOn = !document.body.classList.contains('portrait-mode');
    const cards = Array.from(canvas.querySelectorAll('.module-card'));

    if (turningOn) {
      // Snapshot AVANT de basculer — c'est à CET état (paysage) que le
      // bouton reviendra au prochain clic, persisté (pas juste en mémoire)
      // pour survivre à un rechargement pendant que le mode portrait reste actif.
      await window.matin.store.set('ui.portraitLandscapeSnapshot', snapshotCurrentLayout(cards))
        .catch(err => console.error('[Matin] Échec sauvegarde de la disposition paysage', err));
      document.body.classList.add('portrait-mode');
      // Largeur mini 1100px (2026-09-09, sur demande explicite — la
      // disposition "Portrait rangé 4" va jusqu'à x:1062) : n'agrandit la
      // fenêtre que si elle est plus étroite, ne la rétrécit jamais (voir
      // main.js, handler 'window:ensure-width'). Seulement à l'ACTIVATION du
      // portrait, jamais à la désactivation (retour en paysage n'a pas cette
      // contrainte).
      window.matin.window.ensureWidth(1100);
    } else {
      document.body.classList.remove('portrait-mode');
      const snapshot = await window.matin.store.get('ui.portraitLandscapeSnapshot').catch(() => null);
      if (snapshot) applyAutoArrangeLayouts(cards, snapshot);
    }
    updateCollapseBtnVisibility();

    btnPortraitMode.textContent = turningOn ? '↕' : '⇔';
    await window.matin.store.set('ui.portraitMode', turningOn)
      .catch(err => console.error('[Matin] Échec sauvegarde du mode portrait', err));
  });
  if (btnPortraitMode) btnPortraitMode.textContent = document.body.classList.contains('portrait-mode') ? '↕' : '⇔';

  const autoArrangeConfirmOverlay = document.getElementById('autoArrangeConfirmOverlay');
  document.getElementById('btnAutoArrange')?.addEventListener('click', () => {
    autoArrangeConfirmOverlay?.classList.add('open');
    loadLayoutSlotsCache(); // rafraîchit dates/état des boutons Charger à chaque ouverture
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

  // ─── Emplacements de disposition sauvegardés ("💾 Sauvegarder disposition
  // 1/2" / "📂 Charger disposition 1/2", 2026-08-31 sur demande explicite ;
  // noms personnalisés ajoutés le même jour, 2e révision, toujours sur
  // demande explicite) — 2 emplacements fixes, stockés dans matin-userdata
  // (voir main.js layoutSlots:get/save, synchronisé automatiquement via
  // Drive comme le reste de userdata). `layoutSlotsCache` reflète le dernier
  // layoutSlots:get connu, rafraîchi à chaque ouverture de la popup
  // "⊞ Réorganiser" (voir btnAutoArrange ci-dessus) pour peupler noms/dates/
  // état des boutons Charger.
  let layoutSlotsCache = {};

  function formatLayoutSlotDate(iso) {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  }

  // Le bouton "Charger" porte lui-même le nom + la date une fois
  // l'emplacement sauvegardé (ex. "📂 Charger : Sport — sauvegardée le 30
  // août") — plus de libellé générique "Disposition 1" séparé au-dessus dès
  // qu'un nom existe, voir index.html (2e révision, plus de <span> dédié).
  function refreshLayoutSlotsUI() {
    for (const slot of [1, 2]) {
      const entry = layoutSlotsCache[slot];
      const loadBtn = document.getElementById(`layoutSlotLoad${slot}`);
      if (loadBtn) {
        loadBtn.textContent = entry
          ? `📂 Charger : ${entry.name || `Disposition ${slot}`} — sauvegardée le ${formatLayoutSlotDate(entry.savedAt)}`
          : `📂 Charger disposition ${slot}`;
        loadBtn.disabled = !entry;
      }
    }
  }

  async function loadLayoutSlotsCache() {
    try {
      layoutSlotsCache = await window.matin.layoutSlots.get();
    } catch (err) {
      console.error('[Matin] Échec lecture des emplacements de disposition', err);
      layoutSlotsCache = {};
    }
    refreshLayoutSlotsUI();
  }

  // Même format que la disposition persistée normalement (voir persistLayout/
  // performAutoArrange plus haut) — {x,y,width,height,z} par clé de module,
  // lu directement depuis les cartes affichées (jamais depuis modulesConf,
  // qui peut encore porter le layout d'un module désactivé depuis retiré du
  // DOM).
  function snapshotCurrentLayout(cards) {
    const layout = {};
    for (const card of cards) {
      const key = card.id.replace('module-', '');
      layout[key] = {
        x: parseFloat(card.dataset.x) || 0,
        y: parseFloat(card.dataset.y) || 0,
        width: card.offsetWidth,
        height: card.offsetHeight,
        z: parseInt(card.style.zIndex, 10) || 10,
      };
    }
    return layout;
  }

  async function saveLayoutSlot(slot, name) {
    const cards = Array.from(canvas.querySelectorAll('.module-card'));
    if (!cards.length) return;
    try {
      layoutSlotsCache[slot] = await window.matin.layoutSlots.save(slot, snapshotCurrentLayout(cards), name);
      refreshLayoutSlotsUI();
    } catch (err) {
      console.error('[Matin] Échec sauvegarde de la disposition', err);
    }
  }

  // Réutilise applyAutoArrangeLayouts (transition + persistance) — même
  // mécanique qu'un tirage aléatoire, seule la source des layouts change.
  // Alimente lastAutoArrangeSnapshot AVANT d'appliquer pour que "Annuler"
  // dans la notice qui suit restaure l'état juste précédent, comme après un
  // tirage aléatoire.
  function loadLayoutSlot(slot) {
    const entry = layoutSlotsCache[slot];
    if (!entry) return;
    const cards = Array.from(canvas.querySelectorAll('.module-card'));
    if (!cards.length) return;
    lastAutoArrangeSnapshot = snapshotCurrentLayout(cards);
    applyAutoArrangeLayouts(cards, entry.layout);

    const notice = document.getElementById('autoArrangeNotice');
    if (notice) {
      const text = document.getElementById('autoArrangeNoticeText');
      if (text) text.textContent = `✓ Disposition « ${entry.name || `Disposition ${slot}`} » restaurée`;
      notice.classList.add('show');
      clearTimeout(notice._hideTimer);
      notice._hideTimer = setTimeout(() => notice.classList.remove('show'), 2000);
    }

    // Mémorise le dernier slot chargé (2026-09-09, sur demande explicite) —
    // relu par initDashboard() au démarrage pour le réappliquer après un
    // reload déclenché par la sauvegarde des paramètres (voir onUpdated plus
    // bas). Après les 2 `return` anticipés ci-dessus : ne mémorise que si le
    // layout a RÉELLEMENT été appliqué.
    localStorage.setItem('matin-last-active-slot', slot);
  }

  // Dialogue de nommage (2026-08-31, 2e révision, sur demande explicite) —
  // remplace l'ancienne confirmation d'écrasement "brute" : s'ouvre à
  // CHAQUE clic sur "💾 Sauvegarder disposition N" (pas seulement en cas
  // d'écrasement), pré-remplie avec le nom déjà sauvegardé sur cet
  // emplacement s'il y en a un, vide sinon. Ne sauvegarde QUE sur
  // "💾 Enregistrer" (ni Annuler, ni clic hors modale, ni Échap) — voir
  // layoutSlotNameConfirm plus bas. Un nom vide retombe sur "Disposition N"
  // côté layoutSlotNameConfirm, jamais ici (main.js stocke `name` tel quel).
  const layoutSlotNameOverlay = document.getElementById('layoutSlotNameOverlay');
  const layoutSlotNameInput = document.getElementById('layoutSlotNameInput');
  let pendingLayoutSlotSave = null; // emplacement en attente de nommage

  function requestSaveLayoutSlot(slot) {
    pendingLayoutSlotSave = slot;
    if (layoutSlotNameInput) layoutSlotNameInput.value = layoutSlotsCache[slot]?.name || '';
    layoutSlotNameOverlay?.classList.add('open');
    layoutSlotNameInput?.focus();
  }

  function closeLayoutSlotNameDialog() {
    pendingLayoutSlotSave = null;
    layoutSlotNameOverlay?.classList.remove('open');
  }

  function confirmLayoutSlotName() {
    if (pendingLayoutSlotSave == null) return;
    const name = (layoutSlotNameInput?.value || '').trim() || `Disposition ${pendingLayoutSlotSave}`;
    saveLayoutSlot(pendingLayoutSlotSave, name);
    closeLayoutSlotNameDialog();
  }

  document.getElementById('layoutSlotSave1')?.addEventListener('click', () => requestSaveLayoutSlot(1));
  document.getElementById('layoutSlotSave2')?.addEventListener('click', () => requestSaveLayoutSlot(2));
  // "Charger" ferme la popup (comme "Oui, réorganiser") pour laisser voir
  // tout de suite le résultat sur le dashboard, plutôt que de le masquer
  // derrière l'overlay.
  // Confirmation native avant chargement (2026-09-09, sur demande explicite)
  // — ajoutée en tête de chaque handler : si l'utilisateur annule, RIEN ne
  // se passe (l'overlay "⊞ Réorganiser" reste ouvert, aucun appel à
  // loadLayoutSlot), plutôt que d'annuler seulement le chargement après
  // avoir déjà fermé la popup.
  document.getElementById('layoutSlotLoad1')?.addEventListener('click', () => {
    const confirmed = confirm('Charger la disposition — êtes-vous sûr ?');
    if (!confirmed) return;
    autoArrangeConfirmOverlay?.classList.remove('open');
    loadLayoutSlot(1);
  });
  document.getElementById('layoutSlotLoad2')?.addEventListener('click', () => {
    const confirmed = confirm('Charger la disposition — êtes-vous sûr ?');
    if (!confirmed) return;
    autoArrangeConfirmOverlay?.classList.remove('open');
    loadLayoutSlot(2);
  });

  document.getElementById('layoutSlotNameCancel')?.addEventListener('click', closeLayoutSlotNameDialog);
  layoutSlotNameOverlay?.addEventListener('click', (e) => {
    if (e.target === layoutSlotNameOverlay) closeLayoutSlotNameDialog();
  });
  document.getElementById('layoutSlotNameConfirm')?.addEventListener('click', confirmLayoutSlotName);
  // Entrée valide (équivalent clic "Enregistrer"), Échap annule — confort
  // clavier standard d'un champ de saisie unique dans une modale.
  layoutSlotNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmLayoutSlotName(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLayoutSlotNameDialog(); }
  });

  // Bouton config
  document.getElementById('btnConfig')?.addEventListener('click', () => {
    window.matin.window.openConfig().catch(err => console.error('[Matin] Échec ouverture Paramètres', err));
  });

  // Écouter les mises à jour de modules depuis config (ajout/suppression de
  // module, changement de config) — pas déclenché par nos propres sauvegardes
  // de disposition, qui passent par le canal silencieux modules:updateLayout.
  // Flag posé juste avant le reload (2026-09-09, bug signalé "youtube passe
  // de x:842 à x:314 après sauvegarde des paramètres en mode portrait") : lu
  // au tout début de reflowForPortrait() (voir plus haut) pour sauter le
  // reflow qui suit ce reload précis, sans jamais affecter le tout premier
  // lancement de l'app (qui ne pose jamais ce flag).
  window.matin.modules.onUpdated(() => {
    localStorage.setItem('matin-skip-portrait-reflow', '1');
    window.location.reload();
  });

  // Chargement des modules EN PARALLÈLE (voir loadModule) — pas d'await
  // bloquant pour le reste de la fonction, mais on le garde ici pour que les
  // erreurs éventuelles restent rattachées à initDashboard plutôt que de
  // devenir des rejets de promesse orphelins.
  await Promise.all(toLoad.map(([key, meta, moduleConf]) => loadModule(key, meta, moduleConf.config)));
}

// ─── Lancement ────────────────────────────────────────────────────────────────
window.MatinModules = window.MatinModules || {};
document.addEventListener('DOMContentLoaded', initDashboard);
