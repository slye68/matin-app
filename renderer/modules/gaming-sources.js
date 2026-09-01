/**
 * Sources RSS disponibles pour Actualités Gaming (2026-09-01, sur demande
 * explicite) — catalogue STATIQUE partagé entre le dashboard (rss-feed.js,
 * fetch + affichage du ticker) et la page de config (config.js, cases à
 * cocher), même convention que france-sources.js/tech-sources.js/
 * bourse-sources.js. Gaming passe ici d'une liste FIXE (toujours les 2
 * mêmes sources, aucun choix utilisateur) à des sources cochables, comme les
 * 3 autres modules Actualités déjà convertis.
 *
 * URL JeuxOnline CORRIGÉE : l'URL demandée
 * ("jeuxonline.info/rss/actualites.xml") est un 404 RÉEL (page d'erreur
 * HTML). La vraie URL, trouvée via la balise d'autodiscovery RSS sur la page
 * d'accueil (jeuxonline.info propose plusieurs flux — actualités les plus
 * récentes, les plus lues, dossiers, vidéos — celui demandé correspond au
 * 1er, "Les dernières actualités de JeuxOnLine"), est /rss/actualites/
 * rss.xml — vérifiée en direct, 25 articles.
 */
window.GAMING_NEWS_SOURCES = [
  { url: 'https://www.jeuxvideo.com/rss/rss.xml', label: 'Jeuxvideo.com' },
  { url: 'https://fr.ign.com/feed.xml', label: 'IGN France' },
  { url: 'https://www.jeuxonline.info/rss/actualites/rss.xml', label: 'JeuxOnline (MMO)' },
];

// Cochées par défaut tant que l'utilisateur n'a jamais touché à la config
// (`modules.gaming.config.sources` absent) — Jeuxvideo.com ET IGN France
// étaient TOUTES LES DEUX déjà actives avant l'ajout de ces cases à cocher
// (liste fixe, pas de choix), comportement conservé à l'identique pour une
// installation existante ("keep existing sources unchanged", demandé
// explicitement) ; seule JeuxOnline (nouvelle) démarre décochée.
window.GAMING_DEFAULT_SOURCES = [
  window.GAMING_NEWS_SOURCES[0].url,
  window.GAMING_NEWS_SOURCES[1].url,
];
