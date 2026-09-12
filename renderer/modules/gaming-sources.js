/**
 * Sources RSS disponibles pour Actualités Gaming (2026-09-01, sur demande
 * explicite) — catalogue STATIQUE partagé entre le dashboard (rss-feed.js,
 * fetch + affichage du ticker) et la page de config (config.js, cases à
 * cocher), même convention que france-sources.js/tech-sources.js/
 * bourse-sources.js. Gaming passe ici d'une liste FIXE (toujours les 2
 * mêmes sources, aucun choix utilisateur) à des sources cochables, comme les
 * 3 autres modules Actualités déjà convertis.
 *
 * JeuxOnline REMPLACÉE par Gamekult (2026-09-11, sur demande explicite) —
 * https://www.gamekult.com/feed.xml vérifiée en direct (navigateur) : vrai
 * flux RSS 2.0 bien formé, auto-référencé (<atom:link rel="self">), items
 * complets (title/link/pubDate/description/guid/dc:creator) — aucune
 * adaptation du parsing nécessaire (rssFetchItems, voir rss-feed.js, est
 * générique : querySelectorAll('item') + .textContent, qui dépile déjà les
 * CDATA utilisés ici pour title/description).
 */
window.GAMING_NEWS_SOURCES = [
  { url: 'https://www.jeuxvideo.com/rss/rss.xml', label: 'Jeuxvideo.com' },
  { url: 'https://fr.ign.com/feed.xml', label: 'IGN France' },
  { url: 'https://www.gamekult.com/feed.xml', label: 'Gamekult' },
];

// Cochées par défaut tant que l'utilisateur n'a jamais touché à la config
// (`modules.gaming.config.sources` absent) — Jeuxvideo.com ET IGN France
// étaient TOUTES LES DEUX déjà actives avant l'ajout de ces cases à cocher
// (liste fixe, pas de choix), comportement conservé à l'identique pour une
// installation existante ("keep existing sources unchanged", demandé
// explicitement) ; seule la 3e source (JeuxOnline à l'origine, désormais
// Gamekult à sa place — même index [2]) démarre décochée.
window.GAMING_DEFAULT_SOURCES = [
  window.GAMING_NEWS_SOURCES[0].url,
  window.GAMING_NEWS_SOURCES[1].url,
];
