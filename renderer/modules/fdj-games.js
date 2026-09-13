/**
 * FDJ — définitions des jeux (Loto, EuroMillions, EuroDreams) partagées entre
 * le module dashboard (fdj.js) et la page de configuration (config.js) : les
 * deux ont besoin des mêmes bornes de saisie (nombre de numéros, plages) et
 * du même barème de gains pour le calcul de rang. Un seul fichier pour
 * éviter toute divergence entre les deux (même principe que
 * sports-sources.js).
 *
 * Barèmes officiels — sources : règlements FDJ (media.fdj.fr /
 * cdn-media.fdj.fr, articles "Répartition des gains"), vérifiés le
 * 2026-08-03. Les rangs marqués fixedAmount:null sont des rangs de
 * répartition (pari-mutuel) : leur montant dépend de la cagnotte et du
 * nombre de gagnants, il n'existe pas de chiffre fixe à afficher.
 *
 * EuroDreams (nom officiel au pluriel) tire 6 numéros (1-40) + 1 N°Dream
 * (1-5) — PAS 5 numéros + Dream 1-10 comme un premier brouillon le supposait
 * ; confirmé à la fois par le règlement officiel et par les en-têtes du CSV
 * de résultats (boule_1..boule_6, numero_dream).
 */
window.FdjGames = (function () {
  const MAX_GRIDS = 20;
  const MAX_CODES = 20;

  // Sélecteur de jour(s) de tirage joués (2026-09-13, sur demande explicite)
  // — libellés français indexés comme `Date.getDay()` (0=dimanche), même
  // convention que `game.drawDays` ci-dessous : `playDays` (config utilisateur,
  // voir config.js/fdj-common.js) est donc un tableau de NOMBRES, pas de
  // chaînes françaises comme dans la demande — reste directement comparable
  // à `game.drawDays` sans conversion, ces libellés ne servant qu'à
  // l'affichage (pills Paramètres).
  const DAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  // Loto — 5/49 + 1 N°Chance. Rang 9 est le seul rang de contrepartie (fixe) ;
  // les rangs 1 à 8 sont tous pari-mutuel (règlement Loto, art. 2.1 et 8).
  const LOTO_RANKS = [
    { rank: 1, numbers: 5, special: true,  fixedAmount: null, label: 'Jackpot (min. 2 000 000 €)' },
    { rank: 2, numbers: 5, special: false, fixedAmount: null },
    { rank: 3, numbers: 4, special: true,  fixedAmount: null },
    { rank: 4, numbers: 4, special: false, fixedAmount: null },
    { rank: 5, numbers: 3, special: true,  fixedAmount: null },
    { rank: 6, numbers: 3, special: false, fixedAmount: null },
    { rank: 7, numbers: 2, special: true,  fixedAmount: null },
    { rank: 8, numbers: 2, special: false, fixedAmount: null },
    { rank: 9, numbers: 1, special: true,  fixedAmount: 2.20 },
    { rank: 9, numbers: 0, special: true,  fixedAmount: 2.20 },
  ];

  // EuroMillions — 5/50 + 2 étoiles (1-12), 13 rangs, tous pari-mutuel
  // (règlement EuroMillions-My Million, art. 4.2.3.3).
  const EUROMILLIONS_RANKS = [
    { rank: 1,  numbers: 5, special: 2, fixedAmount: null, label: 'Jackpot' },
    { rank: 2,  numbers: 5, special: 1, fixedAmount: null },
    { rank: 3,  numbers: 5, special: 0, fixedAmount: null },
    { rank: 4,  numbers: 4, special: 2, fixedAmount: null },
    { rank: 5,  numbers: 4, special: 1, fixedAmount: null },
    { rank: 6,  numbers: 3, special: 2, fixedAmount: null },
    { rank: 7,  numbers: 4, special: 0, fixedAmount: null },
    { rank: 8,  numbers: 2, special: 2, fixedAmount: null },
    { rank: 9,  numbers: 3, special: 1, fixedAmount: null },
    { rank: 10, numbers: 3, special: 0, fixedAmount: null },
    { rank: 11, numbers: 1, special: 2, fixedAmount: null },
    { rank: 12, numbers: 2, special: 1, fixedAmount: null },
    { rank: 13, numbers: 2, special: 0, fixedAmount: null },
  ];

  // EuroDreams — 6/40 + 1 N°Dream (1-5), 6 rangs (règlement EuroDreams,
  // art. 8). Rangs 1-2 : rente fixe (pas un jackpot en capital, sauf cas rare
  // de plus de 3/12 gagnants où elle est convertie en capital partagé — non
  // modélisé ici, on affiche le montant nominal de la rente). Rangs 3-5 :
  // pari-mutuel, le Dream ne change pas le rang. Rang 6 : fixe.
  const EURODREAMS_RANKS = [
    { rank: 1, numbers: 6, special: true,  fixedAmount: null, label: '20 000 €/mois pendant 30 ans' },
    { rank: 2, numbers: 6, special: false, fixedAmount: null, label: '2 000 €/mois pendant 5 ans' },
    { rank: 3, numbers: 5, special: null,  fixedAmount: null },
    { rank: 4, numbers: 4, special: null,  fixedAmount: null },
    { rank: 5, numbers: 3, special: null,  fixedAmount: null },
    { rank: 6, numbers: 2, special: null,  fixedAmount: 2.50 },
  ];

  const GAMES = {
    loto: {
      key: 'loto', icon: '🎰', label: 'Loto', color: 'loto',
      numberCount: 5, numberMax: 49,
      specialCount: 1, specialMax: 10, specialLabel: 'N° Chance',
      drawDays: [1, 3, 6], drawTime: [20, 55], // lundi, mercredi, samedi
      hasCodes: true, codesLabel: 'Mes codes Loto Gagnant', codesPlaceholder: 'Ex : A1234567',
      ranks: LOTO_RANKS,
    },
    euromillions: {
      key: 'euromillions', icon: '⭐', label: 'EuroMillions', color: 'euromillions',
      numberCount: 5, numberMax: 50,
      specialCount: 2, specialMax: 12, specialLabel: 'Étoiles',
      drawDays: [2, 5], drawTime: [21, 5], // mardi, vendredi
      hasCodes: true, codesLabel: 'Mes codes MyMillion', codesPlaceholder: 'Ex : AB1234567',
      ranks: EUROMILLIONS_RANKS,
    },
    eurodreams: {
      key: 'eurodreams', icon: '🌟', label: 'EuroDreams', color: 'eurodreams',
      numberCount: 6, numberMax: 40,
      specialCount: 1, specialMax: 5, specialLabel: 'N° Dream',
      drawDays: [1, 4], drawTime: [20, 30], // lundi, jeudi
      hasCodes: false,
      ranks: EURODREAMS_RANKS,
    },
  };

  function emptyGrid(game) {
    return { numbers: Array(game.numberCount).fill(null), special: Array(game.specialCount).fill(null) };
  }

  // Convertit une ligne CSV brute (voir main.js, ipcMain 'fdj:fetchLatestDraw')
  // en tirage normalisé { date, numbers[], special[] }. Renvoie null si les
  // colonnes attendues manquent (format inattendu côté source) plutôt que de
  // produire un tirage à moitié rempli.
  function normalizeDrawRow(game, row) {
    if (!row) return null;

    const numbers = [];
    for (let i = 1; i <= game.numberCount; i++) {
      const v = parseInt(row[`boule_${i}`], 10);
      if (Number.isNaN(v)) return null;
      numbers.push(v);
    }

    let special = [];
    if (game.key === 'loto') {
      const v = parseInt(row.numero_chance, 10);
      if (Number.isNaN(v)) return null;
      special = [v];
    } else if (game.key === 'euromillions') {
      const e1 = parseInt(row.etoile_1, 10);
      const e2 = parseInt(row.etoile_2, 10);
      if (Number.isNaN(e1) || Number.isNaN(e2)) return null;
      special = [e1, e2];
    } else if (game.key === 'eurodreams') {
      const v = parseInt(row.numero_dream, 10);
      if (Number.isNaN(v)) return null;
      special = [v];
    }

    return { date: row.date || null, numbers, special };
  }

  function findLotoRank(numbersMatched, specialMatched) {
    return LOTO_RANKS.find(r => r.numbers === numbersMatched && r.special === specialMatched) || null;
  }

  function findEuromillionsRank(numbersMatched, specialsMatched) {
    return EUROMILLIONS_RANKS.find(r => r.numbers === numbersMatched && r.special === specialsMatched) || null;
  }

  function findEurodreamsRank(numbersMatched, specialMatched) {
    if (numbersMatched === 6) {
      return EURODREAMS_RANKS.find(r => r.numbers === 6 && r.special === specialMatched) || null;
    }
    // Rangs 3 à 5 : le Dream ne change pas le rang (peu importe 0 ou 1 match).
    return EURODREAMS_RANKS.find(r => r.numbers === numbersMatched && r.numbers < 6) || null;
  }

  // Compare une grille utilisateur (peut être partiellement remplie, les
  // cases vides valent null) au tirage normalisé et renvoie le détail des
  // correspondances + le rang de gain atteint, le cas échéant.
  function computeGridResult(game, grid, draw) {
    if (!draw) return { numbersMatched: 0, specialsMatched: 0, rank: null };

    const drawnNumbers = new Set(draw.numbers);
    const drawnSpecials = new Set(draw.special);
    const numbersMatched = (grid.numbers || []).filter(n => n != null && drawnNumbers.has(n)).length;
    const specialsMatched = (grid.special || []).filter(n => n != null && drawnSpecials.has(n)).length;

    let rank;
    if (game.key === 'loto') rank = findLotoRank(numbersMatched, specialsMatched > 0);
    else if (game.key === 'euromillions') rank = findEuromillionsRank(numbersMatched, specialsMatched);
    else rank = findEurodreamsRank(numbersMatched, specialsMatched > 0);

    return { numbersMatched, specialsMatched, rank };
  }

  return { MAX_GRIDS, MAX_CODES, DAY_LABELS, GAMES, emptyGrid, normalizeDrawRow, computeGridResult };
})();
