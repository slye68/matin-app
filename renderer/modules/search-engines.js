// Catalogue partagé des moteurs de recherche (2026-09-03, sur demande
// explicite) — même principe que sports-sources.js/fuel-types.js : un seul
// fichier chargé à la fois par index.html (dashboard.js, construction de
// l'URL au submit de la barre de recherche) et config.html (config.js,
// <select> "Moteur de recherche" dans Paramètres → Services), pour ne
// jamais avoir 2 listes qui divergent.
window.SearchEngines = (function () {
  const OPTIONS = [
    { id: 'google',     emoji: '🔍', label: 'Google',      urlBase: 'https://www.google.com/search?q=' },
    { id: 'yahoo',      emoji: '🟡', label: 'Yahoo!',       urlBase: 'https://search.yahoo.com/search?p=' },
    { id: 'bing',       emoji: '🔵', label: 'Bing',         urlBase: 'https://www.bing.com/search?q=' },
    { id: 'qwant',      emoji: '🌸', label: 'Qwant',        urlBase: 'https://www.qwant.com/?q=' },
    { id: 'duckduckgo', emoji: '🦆', label: 'DuckDuckGo',   urlBase: 'https://duckduckgo.com/?q=' },
  ];
  const DEFAULT = 'google';

  function findById(id) {
    return OPTIONS.find(o => o.id === id) || OPTIONS.find(o => o.id === DEFAULT);
  }

  function buildSearchUrl(id, query) {
    return findById(id).urlBase + encodeURIComponent(query);
  }

  return { OPTIONS, DEFAULT, findById, buildSearchUrl };
})();
