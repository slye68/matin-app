/**
 * Sources RSS disponibles pour Actualités France (2026-09-01, sur demande
 * explicite) — catalogue STATIQUE partagé entre le dashboard (rss-feed.js,
 * fetch + affichage du ticker) et la page de config (config.js, cases à
 * cocher), même convention que fdj-games.js/indices-defs.js/
 * live-championships.js/reminders-categories.js : un seul fichier chargé via
 * <script> dans index.html ET config.html plutôt qu'une liste dupliquée dans
 * les deux fenêtres.
 */
// "20 Minutes" RETIRÉE le 2026-09-01, sur demande explicite.
window.FRANCE_NEWS_SOURCES = [
  { url: 'https://www.lemonde.fr/rss/une.xml', label: 'Le Monde' },
  { url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml', label: 'Le Figaro' },
  { url: 'https://www.bfmtv.com/rss/news-24-7/', label: 'BFM TV' },
  { url: 'https://www.francetvinfo.fr/titres.rss', label: 'France Info' },
  { url: 'https://www.liberation.fr/arc/outboundfeeds/rss/', label: 'Libération' },
];

// Coché par défaut tant que l'utilisateur n'a jamais touché à la config
// (`modules.france.config.sources` absent) — Le Monde était la seule source
// avant l'ajout de cette fonctionnalité, comportement conservé à l'identique
// pour une installation existante.
window.FRANCE_DEFAULT_SOURCES = [window.FRANCE_NEWS_SOURCES[0].url];
