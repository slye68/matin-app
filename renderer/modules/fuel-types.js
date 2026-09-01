/**
 * Types de carburant du module Carburants — SOURCE UNIQUE partagée entre
 * fuel-prices.js (rendu dashboard) et config.js (cases à cocher dans
 * Paramètres), même principe que sports-sources.js/*-sources.js : éviter que
 * les deux dérivent l'un de l'autre (un carburant coché ici doit correspondre
 * exactement à ce qui est effectivement affiché côté carte).
 *
 * `candidates` : noms de champ APLATIS possibles pour ce carburant dans une
 * réponse API data.economie.gouv.fr (voir fuel-prices.js fuelResolveFieldMap)
 * — plusieurs variantes plausibles, la 1re présente dans la réponse gagne.
 *
 * `prixNoms` : valeurs possibles du sous-champ `@nom`/`nom` quand l'API
 * renvoie ses prix sous la forme IMBRIQUÉE `prix: [{"@nom":"Gazole",
 * "@valeur":"1.859"}, ...]` plutôt qu'aplatie (2026-09-01, sur demande
 * explicite, "Debug the current empty display issue... log raw API prix
 * field content and fix parsing if needed" — voir fuel-prices.js
 * fuelExtractStationPrices, repli utilisé quand AUCUN des `candidates`
 * ci-dessus n'est présent dans la réponse).
 *
 * `default` : présélectionné ou non dans Paramètres (2026-09-01, sur demande
 * explicite, point 2) — SP95-E5/SP95-E10/SP98/Diesel cochés par défaut
 * (carburants courants), E85/GPL décochés par défaut (moins courants).
 */
window.FuelTypes = (function () {
  const OPTIONS = [
    {
      id: 'sp95', label: 'SP95-E5', default: true,
      candidates: ['sp95_prix', 'sp95e5_prix', 'prix_sp95', 'SP95', 'SP95-E5', 'sp95'],
      prixNoms: ['sp95', 'sp95-e5', 'sp95e5'],
    },
    {
      id: 'e10', label: 'SP95-E10', default: true,
      candidates: ['e10_prix', 'prix_e10', 'SP95-E10', 'E10', 'e10'],
      prixNoms: ['e10', 'sp95-e10', 'sp95e10'],
    },
    {
      id: 'sp98', label: 'SP98', default: true,
      candidates: ['sp98_prix', 'prix_sp98', 'SP98', 'sp98'],
      prixNoms: ['sp98'],
    },
    {
      id: 'gazole', label: 'Diesel', default: true,
      candidates: ['gazole_prix', 'prix_gazole', 'Gazole', 'gazole'],
      prixNoms: ['gazole'],
    },
    {
      id: 'e85', label: 'E85', default: false,
      candidates: ['e85_prix', 'prix_e85', 'E85', 'SP95-E85'],
      prixNoms: ['e85', 'sp95-e85', 'superethanol-e85', 'superéthanol-e85'],
    },
    {
      id: 'gpl', label: 'GPL', default: false,
      candidates: ['gplc_prix', 'prix_gplc', 'GPLc', 'GPL'],
      prixNoms: ['gplc', 'gpl'],
    },
  ];

  const DEFAULT_ENABLED = OPTIONS.filter(o => o.default).map(o => o.id);

  function findById(id) {
    return OPTIONS.find(o => o.id === id) || null;
  }

  return { OPTIONS, DEFAULT_ENABLED, findById };
})();
