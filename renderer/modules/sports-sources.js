/**
 * Détection automatique du sport (via TheSportsDB) et liste blanche de
 * sources RSS associées — partagé entre le module Sports (ol.js, qui l'utilise
 * pour savoir quoi récupérer) et la page de configuration (config.js, qui
 * l'utilise pour construire les cases à cocher). Un seul fichier pour éviter
 * que les deux dérivent l'un de l'autre : une source cochée côté Paramètres
 * doit correspondre exactement à ce qui est effectivement récupéré côté
 * dashboard.
 */
window.SportsSources = (function () {
  const MAX_SOURCES = 5;

  // URLs L'Équipe : l'ancien format (lequipe.fr/rss/actu_rss_{Sport}.xml) est
  // mort (404, vérifié le 2026-08-03) — remplacé par le flux dwh.lequipe.fr
  // actuellement en service, dont le paramètre `path` attend le slug interne
  // du site (pas forcément identique à l'ancien nom de fichier — ex.
  // "Basket", pas "Basket-ball" : ce dernier renvoie un flux valide mais VIDE).
  // Chaque slug ci-dessous a été vérifié individuellement (contenu réel,
  // ~50 items, pas juste un flux générique qui répondrait pareil à n'importe
  // quel chemin).
  //
  // Eurosport a été retiré entièrement (tous sports) : le site bloque tout
  // accès non-navigateur au niveau du site entier (403 sur la page d'accueil
  // elle-même, pas seulement sur le flux RSS), et même via un proxy capable de
  // passer ce blocage (jina.ai Reader, vérifié), aucun flux RSS n'a pu être
  // trouvé sur le site — il semble avoir été purement et simplement retiré
  // côté Eurosport, pas juste déplacé. Un proxy n'aide pas à fetcher un flux
  // qui n'existe plus.
  const CATALOG = {
    football: [
      { label: "L'Équipe", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Football' },
      { label: 'RMC Sport', url: 'https://rmcsport.bfmtv.com/rss/football/' },
      { label: 'Foot Mercato', url: 'https://www.footmercato.net/flux-rss/' },
    ],
    basketball: [
      { label: 'BeBasket', url: 'https://www.bebasket.fr/feed/' },
      { label: "L'Équipe Basket", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Basket' },
    ],
    rugby: [
      { label: 'Rugbyrama', url: 'https://www.rugbyrama.fr/rss.xml' },
      { label: 'Midi Olympique', url: 'https://www.midi-olympique.fr/feed/' },
      { label: "L'Équipe Rugby", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Rugby' },
    ],
    f1: [
      { label: 'Nextgen-auto', url: 'https://www.nextgen-auto.com/feed/' },
      { label: "L'Équipe F1", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Formule-1' },
    ],
    cyclisme: [
      { label: "L'Équipe Vélo", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Cyclisme' },
    ],
    // Tennis/Athlétisme (2026-09-01, sur demande explicite — ajoutés au
    // sélecteur manuel de sport dans Paramètres, voir MANUAL_SPORT_OPTIONS
    // plus bas) : AUCUNE source RSS dédiée encore identifiée/vérifiée pour
    // ces 2 sports (contrairement à football/basket/rugby/f1/cyclisme
    // ci-dessus, chacun vérifié individuellement — voir commentaire de
    // CATALOG en tête de fichier) — listes vides plutôt qu'inventées.
    // L'utilisateur qui sélectionne l'un de ces 2 sports se retrouve donc
    // avec une liste de sources vide (voir statusEl dans config.js, qui
    // l'affiche explicitement) — ce qui reste mieux qu'un mauvais classement
    // (ex. Rugby) hérité d'une détection automatique erronée.
    tennis: [],
    athletisme: [],
  };

  const CATEGORY_LABELS = {
    football: 'Football', basketball: 'Basketball', rugby: 'Rugby', f1: 'Formule 1', cyclisme: 'Cyclisme',
    tennis: 'Tennis', athletisme: 'Athlétisme',
  };

  // Sélecteur manuel de sport (2026-09-01, sur demande explicite, "Fix the
  // Sports module team detection") — affiché dans Paramètres à côté du champ
  // Équipe (voir config.js), permet à l'utilisateur de COURT-CIRCUITER la
  // détection automatique TheSportsDB quand elle se trompe ou échoue. Valeur
  // vide ('') = laisser la détection automatique décider (comportement
  // historique, valeur par défaut pour toute config existante qui n'a jamais
  // touché ce sélecteur).
  //
  // RÉDUIT le même jour (2e demande explicite, "remove sport types from
  // detection options: remove Cyclisme, Athlétisme, Tennis, F1, Autre — keep
  // only Football/Basket/Rugby") — Tennis/F1/Cyclisme/Athlétisme/Autre
  // retirés de CETTE LISTE UNIQUEMENT (les options manuelles exposées dans
  // Paramètres) ; `detectSportSources` garde son support de ces catégories
  // (via CATALOG/CATEGORY_LABELS ci-dessus, y compris le cas 'autre') pour
  // rester rétro-compatible avec toute config ayant déjà enregistré l'une de
  // ces valeurs pendant la brève période où elles étaient proposées — un tel
  // réglage continue de fonctionner exactement comme avant, simplement plus
  // proposé à la sélection pour un NOUVEAU choix.
  const MANUAL_SPORT_OPTIONS = [
    { value: '', label: '🔍 Détection automatique' },
    { value: 'football', label: '⚽ Football' },
    { value: 'basketball', label: '🏀 Basket' },
    { value: 'rugby', label: '🏉 Rugby' },
  ];

  // TheSportsDB n'a pas de catégorie "Formula 1" dédiée : tout sport moteur
  // (F1, MotoGP, Dakar...) est classé "Motorsport" — rattaché à F1 faute de
  // plus précis (limitation de la source de données, pas de notre mapping).
  function mapSportToCategory(strSport) {
    const s = (strSport || '').toLowerCase();
    if (s.includes('soccer')) return 'football';
    if (s.includes('basketball')) return 'basketball';
    if (s.includes('rugby')) return 'rugby';
    if (s.includes('motorsport') || s.includes('formula')) return 'f1';
    if (s.includes('cycling')) return 'cyclisme';
    return null;
  }

  // Cas connus de faux positifs (2026-09-01, sur demande explicite, "Fix
  // specific known cases") — la détection auto ci-dessus se fie uniquement à
  // `strSport` DE L'ÉQUIPE RENVOYÉE par la recherche TheSportsDB, jamais au
  // nom tapé par l'utilisateur : si la recherche approximative de TheSportsDB
  // renvoie une équipe homonyme d'un AUTRE sport (base de données pas
  // exhaustive sur le rugby français notamment), la catégorie auto-détectée
  // peut être plausible en apparence mais fausse en pratique. Ces 2 motifs
  // rejettent la détection dans ces cas précis PLUTÔT QUE de l'appliquer
  // silencieusement — la source de vérité redevient alors le sélecteur
  // manuel (voir MANUAL_SPORT_OPTIONS/config.js).
  function isKnownUnreliableDetection(team, category) {
    const t = (team || '').toLowerCase();
    // "Racing" — quasi toujours un club de rugby/football français (Racing
    // 92, Racing Club de Strasbourg, Racing Club de Lens...) alors que le mot
    // anglais générique attire aussi des homonymes moteur (ex. "Racing Point")
    // sur une recherche approximative TheSportsDB — jamais fiable si le sport
    // auto-détecté est justement F1.
    if (category === 'f1' && /\bracing\b/.test(t)) return true;
    // "Stade" — de nombreux clubs de RUGBY français portent ce nom (Stade
    // Toulousain, Stade Rochelais, Stade Français...), pas seulement des
    // clubs de football (Stade de Reims, Stade Rennais...) : un auto-détecté
    // "football" pour un nom contenant "Stade" n'est pas fiable par défaut.
    if (category === 'football' && /\bstade\b/.test(t)) return true;
    return false;
  }

  // Sigles courts (2026-09-01, sur demande explicite — ex. LOU/ASM/FCG, tous
  // des clubs de RUGBY français) — une recherche TheSportsDB sur un sigle de
  // 2 à 4 lettres est trop ambiguë pour être fiable (collisions possibles
  // avec n'importe quelle autre organisation portant les mêmes initiales),
  // quel que soit le résultat renvoyé : repli direct sur la sélection
  // manuelle, sans même faire confiance au sport éventuellement détecté.
  function isAmbiguousShortName(team) {
    return /^[A-ZÀ-Þ]{2,4}$/.test((team || '').trim());
  }

  // Interroge TheSportsDB pour l'équipe donnée et construit la liste blanche
  // de sources RSS du sport détecté, plafonnée à MAX_SOURCES.
  //
  // Le "Site officiel du club" n'apparaît PLUS ici comme source cochable
  // (2026-09-01, sur demande explicite, "REMOVE 'Site officiel' checkbox
  // from sources ... instead make the team name in the module header
  // clickable") — retiré : `discoverClubSource`/`normalizeWebsiteUrl`, qui ne
  // servaient qu'à construire cette entrée de case à cocher, ont été
  // supprimés (plus aucun appelant). Le titre de carte cliquable existe déjà
  // et pointe vers ce même site officiel (voir ol.js fetchTeamId/render,
  // `card.dataset.website`, résolu directement depuis `found.strWebsite` —
  // aucun rapport avec cette fonction) : la case à cocher était devenue
  // redondante avec ce mécanisme, pas un complément.
  //
  // `manualSport` (2026-09-01, sur demande explicite — voir
  // MANUAL_SPORT_OPTIONS) : quand renseigné (valeur non vide venant du
  // sélecteur de Paramètres), il prend TOUJOURS le dessus sur la catégorie
  // auto-détectée, PAS SEULEMENT en cas d'échec — l'utilisateur qui a
  // explicitement choisi un sport sait mieux que la détection heuristique.
  // La recherche TheSportsDB elle-même tourne quand même dans tous les cas
  // (utile pour son propre débogage, voir logs ci-dessous) ; seule la
  // CATÉGORIE qui en découle est ignorée si `manualSport` est fourni. Si la
  // recherche ne trouve aucune équipe DU TOUT, ce n'est une erreur bloquante
  // que si aucun sport manuel n'a été choisi.
  async function detectSportSources(team, manualSport) {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(team)}`);
    if (!res.ok) throw new Error(`Recherche équipe KO (${res.status})`);
    const data = await res.json();
    const found = data.teams?.[0];
    if (!found && !manualSport) throw new Error('Équipe introuvable sur TheSportsDB');

    let category = found ? mapSportToCategory(found.strSport) : null;
    let autoRejected = false;
    if (found && !manualSport) {
      if (isAmbiguousShortName(team)) {
        console.warn(`[Sports] "${team}" — sigle court ambigu (cas connu, ex. LOU/ASM/FCG), détection auto ignorée.`);
        category = null;
        autoRejected = true;
      } else if (category && isKnownUnreliableDetection(team, category)) {
        console.warn(`[Sports] "${team}" — détection auto "${category}" jugée non fiable (cas connu), ignorée.`);
        category = null;
        autoRejected = true;
      }
    }

    // Le sport manuel gagne inconditionnellement une fois choisi (voir
    // commentaire au-dessus de la fonction) — 'autre' vaut "hors catalogue",
    // jamais une catégorie CATALOG réelle.
    if (manualSport) category = manualSport === 'autre' ? null : manualSport;

    const list = category ? [...(CATALOG[category] || [])] : [];

    const sportLabel = manualSport
      ? (manualSport === 'autre' ? 'Autre (choisi manuellement)' : `${CATEGORY_LABELS[manualSport] || manualSport} (choisi manuellement)`)
      : (category ? CATEGORY_LABELS[category] : (found?.strSport || null));

    return {
      category,
      sportLabel,
      list: list.slice(0, MAX_SOURCES),
      // Signale à l'appelant (config.js) que la détection auto a été
      // écartée pour un cas connu — permet d'afficher un message explicite
      // invitant à choisir manuellement plutôt qu'un simple "non reconnu".
      autoRejected: autoRejected && !manualSport,
    };
  }

  return {
    MAX_SOURCES, CATALOG, CATEGORY_LABELS, MANUAL_SPORT_OPTIONS,
    mapSportToCategory, detectSportSources,
  };
})();
