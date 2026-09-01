/**
 * Sources RSS disponibles pour Actualités Tech (2026-09-01, sur demande
 * explicite) — catalogue STATIQUE partagé entre le dashboard (rss-feed.js,
 * fetch + affichage du ticker) et la page de config (config.js, cases à
 * cocher), même convention que france-sources.js/fdj-games.js/
 * indices-defs.js/live-championships.js/reminders-categories.js : un seul
 * fichier chargé via <script> dans index.html ET config.html plutôt qu'une
 * liste dupliquée dans les deux fenêtres.
 *
 * URL 01net CORRIGÉE : l'URL demandée ("https://www.01net.com/rss/news/")
 * est un 404 confirmé — déjà diagnostiqué et corrigé une 1re fois pour ce
 * module (voir rss-feed.js, ancien commentaire d'en-tête "URL 01net
 * corrigée") avant même l'ajout de ces sources multiples ; la bonne URL est
 * /feed/, reprise telle quelle ici plutôt que de réintroduire un lien mort.
 */
// "Clubic" RETIRÉE le 2026-09-01, sur demande explicite.
window.TECH_NEWS_SOURCES = [
  { url: 'https://www.01net.com/feed/', label: '01net' },
  { url: 'https://www.numerama.com/feed/', label: 'Numerama' },
];

// Coché par défaut tant que l'utilisateur n'a jamais touché à la config
// (`modules.tech.config.sources` absent) — 01net était la seule source avant
// l'ajout de ces cases à cocher, comportement conservé à l'identique pour une
// installation existante.
window.TECH_DEFAULT_SOURCES = [window.TECH_NEWS_SOURCES[0].url];
