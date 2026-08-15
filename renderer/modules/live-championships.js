/**
 * Championnats proposés par le module LIVE! — partagé entre le dashboard
 * (live.js, résolution du endpoint ESPN + repli) et Paramètres (config.js,
 * peuplement du <select> "Mon championnat"), même convention que
 * indices-defs.js/fdj-games.js/parcels-carriers.js : un seul fichier chargé
 * via <script> dans index.html ET config.html.
 *
 * 8 des 10 entrées ont un endpoint ESPN "site API" vérifié en direct (curl,
 * voir CONTEXT.md) — National et Autre n'en ont pas : National, faute de
 * slug ESPN trouvable après plusieurs tentatives (`fra.3`/`fra.national`/
 * `fra.n1` renvoient tous un 400) ; Autre par définition (aucune source
 * identifiable pour un championnat non listé).
 */
window.LiveChampionships = [
  { key: 'ligue1',        label: 'Ligue 1',            espn: 'soccer/fra.1' },
  { key: 'ligue2',        label: 'Ligue 2',             espn: 'soccer/fra.2' },
  { key: 'national',      label: 'National',            espn: null },
  { key: 'liga',          label: 'Liga',                 espn: 'soccer/esp.1' },
  { key: 'premierLeague', label: 'Premier League',       espn: 'soccer/eng.1' },
  { key: 'bundesliga',    label: 'Bundesliga',           espn: 'soccer/ger.1' },
  { key: 'serieA',        label: 'Serie A',              espn: 'soccer/ita.1' },
  { key: 'ucl',           label: 'Ligue des Champions',  espn: 'soccer/uefa.champions' },
  { key: 'europaLeague',  label: 'Europa League',        espn: 'soccer/uefa.europa' },
  { key: 'autre',         label: 'Autre',                espn: null },
];
