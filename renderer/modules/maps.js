/**
 * Module Maps — recherche compacte ouvrant Google Maps dans le navigateur
 *
 * Remplace le module Trafic (OpenRouteService, retiré) : plus de clé API,
 * plus de géocodage/itinéraires calculés dans l'app — juste un champ de
 * recherche qui ouvre Google Maps dans le navigateur par défaut avec la
 * requête telle quelle, comme si on la tapait directement dans Maps. Pas de
 * config persistée (aucune adresse enregistrée).
 */
window.MatinModules = window.MatinModules || {};

function mapsOpenSearch(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
  window.matin.shell.openExternal(url);
}

window.MatinModules.maps = {
  async render(container, _config, _google, setBadge) {
    setBadge('');
    container.innerHTML = `
      <form class="maps-module">
        <input type="text" class="maps-search-input" placeholder="Adresse ou lieu…" autocomplete="off">
        <button type="submit" class="maps-search-btn" title="Ouvrir dans Google Maps">🔍</button>
      </form>
    `;

    const form = container.querySelector('.maps-module');
    const input = container.querySelector('.maps-search-input');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      mapsOpenSearch(input.value);
      input.value = '';
    });
  },
};
