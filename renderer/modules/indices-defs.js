/**
 * Indices/matières premières suivis par le module Indices — partagé entre le
 * dashboard (indices.js, affichage) et la page Paramètres (config.js,
 * sélecteur d'indices à afficher), même convention que fdj-games.js/
 * reminders-categories.js : un seul fichier chargé via <script> dans
 * index.html ET config.html.
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

// Crypto (2026-09-13, sur demande explicite) — sous-section SÉPARÉE des
// indices boursiers ci-dessus (source différente, CoinGecko plutôt que
// Yahoo Finance ; sélection propre `config.selectedCrypto`, voir
// indices.js/config.js renderIndicesConfigSection) : liste distincte plutôt
// que fusionnée dans IndicesDefs, pour que la séparation visuelle demandée
// ("sous-section Crypto") ait un pendant clair côté données, pas seulement
// côté rendu. `id` = identifiant CoinGecko (utilisé tel quel dans l'URL de
// l'API ET comme valeur de `config.selectedCrypto`) ; NE PAS confondre avec
// le module "Crypto" existant (crypto.js, portefeuille personnel suivi
// manuellement) — ⚠️ explicitement non concerné par cet ajout.
window.IndicesCryptoDefs = [
  { id: 'bitcoin',     ticker: 'BTC',  name: 'Bitcoin',  icon: '₿' },
  { id: 'ethereum',    ticker: 'ETH',  name: 'Ethereum', icon: 'Ξ' },
  { id: 'tether',      ticker: 'USDT', name: 'Tether',   icon: '◎' },
  { id: 'binancecoin', ticker: 'BNB',  name: 'BNB',      icon: '◆' },
  { id: 'ripple',      ticker: 'XRP',  name: 'XRP',      icon: '✦' },
];
