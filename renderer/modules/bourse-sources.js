/**
 * Sources RSS disponibles pour Actualités Bourse (2026-09-01, sur demande
 * explicite) — catalogue STATIQUE partagé entre le dashboard (rss-feed.js,
 * fetch + affichage du ticker) et la page de config (config.js, cases à
 * cocher), même convention que france-sources.js/tech-sources.js/
 * fdj-games.js/indices-defs.js : un seul fichier chargé via <script> dans
 * index.html ET config.html plutôt qu'une liste dupliquée dans les deux
 * fenêtres.
 *
 * Les 4 URLs demandées ont TOUTES été vérifiées en direct avant ajout (accès
 * réseau exceptionnellement disponible pour ce diagnostic) — 2 sur 4
 * fonctionnaient telles quelles, 2 étaient mortes/déplacées :
 *   - BFM Business : l'URL demandée ("bfmbusiness.bfmtv.com/rss/bfmbusiness/")
 *     redirige (301) vers une page HTML, plus un flux. La bonne URL, trouvée
 *     par analogie avec le flux France déjà en place (bfmtv.com/rss/
 *     news-24-7/, même domaine/même famille d'URL), est bfmtv.com/rss/
 *     economie/ — vérifiée en direct, 30 articles.
 *   - Capital : l'URL demandée ("capital.fr/feed") est un 404 RÉEL (page
 *     d'erreur HTML, pas du XML). La vraie URL, trouvée via la balise
 *     d'autodiscovery RSS sur la page d'accueil (pas un lien de nav visible),
 *     est feed.prismamediadigital.com/v1/cap/rss?limit=20 (plateforme
 *     partagée du groupe Prisma Media, propriétaire de Capital) — vérifiée
 *     en direct, 10 articles.
 *   - Les Échos : ABANDONNÉE, non ajoutée. 4 variantes d'URL essayées, la
 *     page d'accueil elle-même, ET un essai via le proxy jina.ai Reader :
 *     403 "Access Denied" (blocage Akamai) dans TOUS les cas, y compris pour
 *     jina.ai — pas une URL à corriger, un blocage réseau qui empêche tout
 *     accès au site, contrairement à BFM Business/Capital ci-dessus.
 *   - Boursorama : ABANDONNÉE, non ajoutée. L'URL demandée et 5 variantes
 *     supplémentaires renvoient toutes un 404 réel (page HTML), une renvoie
 *     même un 410 Gone ("actualites/flux-rss/") — signe d'un flux RSS
 *     délibérément retiré du site plutôt que simplement déplacé, aucune
 *     balise d'autodiscovery trouvée sur la page d'accueil pour confirmer une
 *     éventuelle URL de remplacement.
 */
window.BOURSE_NEWS_SOURCES = [
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EFCHI&region=FR&lang=fr-FR', label: 'Yahoo Finance' },
  { url: 'https://www.bfmtv.com/rss/economie/', label: 'BFM Business' },
  { url: 'https://feed.prismamediadigital.com/v1/cap/rss?limit=20', label: 'Capital' },
];

// Coché par défaut tant que l'utilisateur n'a jamais touché à la config
// (`modules.bourse.config.sources` absent) — Yahoo Finance était la seule
// source avant l'ajout de ces cases à cocher, comportement conservé à
// l'identique pour une installation existante (demandé explicitement : "keep
// as default").
window.BOURSE_DEFAULT_SOURCES = [window.BOURSE_NEWS_SOURCES[0].url];
