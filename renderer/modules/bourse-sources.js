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
 *     éventuelle URL de remplacement. RE-VÉRIFIÉE le 2026-09-11 (nouvelle
 *     demande explicite de remplacer Yahoo Finance PAR Boursorama) : toujours
 *     404 sur l'URL demandée (boursorama.com/rss/actualites) ET sur 7 autres
 *     variantes essayées ce jour-là, toujours aucune balise d'autodiscovery
 *     sur la page d'accueil — confirmation indépendante, 10 jours plus tard,
 *     que ce n'était pas un problème réseau ponctuel du 1er diagnostic.
 *
 * Yahoo Finance — RETIRÉ ENTIÈREMENT le 2026-09-11, sur demande explicite
 * ("remplace la source Yahoo Finance par Boursorama... supprime tout le code
 * lié à Yahoo Finance qui ne serait plus utile"). Avait été diagnostiqué et
 * réparé plus tôt le même jour (URL périmée avec `&region=FR&lang=fr-FR`,
 * causant un 404 intermittent — corrigée en retirant ces 2 paramètres), mais
 * cette réparation est devenue sans objet : Boursorama, la source demandée en
 * remplacement, s'est révélée MORTE à la vérification (voir bullet ci-dessus)
 * — Challenges Économie l'a donc remplacée à la place (voir plus bas),
 * trouvée et vérifiée en direct le même jour via la balise d'autodiscovery de
 * challenges.fr (200, XML valide, 50 articles, titre/lien/date présents pour
 * chacun).
 */
window.BOURSE_NEWS_SOURCES = [
  { url: 'https://www.challenges.fr/category/rss/economie', label: 'Challenges Économie' },
  { url: 'https://www.bfmtv.com/rss/economie/', label: 'BFM Business' },
  { url: 'https://feed.prismamediadigital.com/v1/cap/rss?limit=20', label: 'Capital' },
];

// Coché par défaut tant que l'utilisateur n'a jamais touché à la config
// (`modules.bourse.config.sources` absent) — Yahoo Finance était la seule
// source par défaut avant l'ajout de ces cases à cocher (comportement gardé
// à l'identique pour une installation existante à l'époque, "keep as
// default") ; Challenges Économie a pris sa place le 2026-09-11 (Yahoo
// retiré du catalogue, voir en-tête de fichier) — même position [0], même
// principe.
window.BOURSE_DEFAULT_SOURCES = [window.BOURSE_NEWS_SOURCES[0].url];
