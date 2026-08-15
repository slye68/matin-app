/**
 * Indices/matières premières suivis par le module Indices — partagé entre le
 * dashboard (indices.js, affichage) et la page Paramètres (config.js,
 * sélecteur d'indices à afficher), même convention que fdj-games.js/
 * parcels-carriers.js/reminders-categories.js : un seul fichier chargé via
 * <script> dans index.html ET config.html.
 *
 * Noms affichés fixés en dur plutôt que le `shortName`/`longName` renvoyé par
 * Yahoo Finance : vérifié en direct le 2026-08-07 que ces champs sont parfois
 * absents (BZ=F, pétrole Brent) ou truffés d'espaces de padding parasites
 * (DAX renvoyait "DAX                           P").
 */
window.IndicesDefs = [
  { symbol: '^FCHI',  label: '🇫🇷 CAC 40' },
  { symbol: '^GSPC',  label: '🇺🇸 S&P 500' },
  { symbol: '^IXIC',  label: '🇺🇸 Nasdaq' },
  { symbol: '^DJI',   label: '🇺🇸 Dow Jones' },
  { symbol: '^GDAXI', label: '🇩🇪 DAX' },
  { symbol: '^FTSE',  label: '🇬🇧 FTSE 100' },
  { symbol: '^N225',  label: '🇯🇵 Nikkei' },
  { symbol: 'URTH',   label: '🌍 MSCI World' },
  { symbol: 'GC=F',   label: '🥇 Or' },
  { symbol: 'BZ=F',   label: '🛢️ Pétrole Brent' },
  { symbol: 'SI=F',   label: '🥈 Argent' },
];
