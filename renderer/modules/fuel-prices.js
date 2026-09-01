/**
 * Module Carburants — data.economie.gouv.fr (gratuit, sans clé)
 *
 * Géocode la ville/CP saisie via la Base Adresse Nationale (api-adresse.data
 * .gouv.fr — API officielle française, gratuite, sans clé, mise en cache
 * localStorage par valeur saisie), interroge l'API officielle via IPC (voir
 * main.js, fuel:fetchNearby — filtre géo `within_distance` sur un rayon de
 * 20km), calcule la distance réelle par station (Haversine, l'API ne trie
 * pas par distance elle-même) pour ne garder que les 3 plus proches, puis
 * réordonne CET ensemble par SP95 le moins cher par défaut (comme demandé)
 * — deux critères différents : "proche" pour la sélection, "moins cher"
 * pour l'ordre d'affichage. La station la moins chère est mise en évidence.
 *
 * Note (2026-08-05, bug "aucune station près du 01090 Montceaux, Ain") :
 * le géocodeur utilisé auparavant était Nominatim, qui désambiguïse mal les
 * noms de commune français ambigus. Vérifié en direct : Nominatim sur
 * "Montceau" (sans x, tel que probablement saisi) renvoie en résultat n°1
 * un hameau de l'Isère à ~150km de la commune voulue (Montceaux, 01, Ain),
 * même en ajoutant le code postal en texte libre — son classement par
 * "importance" ignore la correspondance de code postal. La BAN, elle,
 * priorise correctement la commune dont le CP correspond ("Montceau 01090"
 * → Montceaux/01258, vérifié). D'où le rayon élargi et la requête vide de
 * résultats : le point de départ du calcul de distance était le mauvais.
 */
window.MatinModules = window.MatinModules || {};

const FUEL_GEOCODE_CACHE_PREFIX = 'matin-fuel-geocode-v2-';
const FUEL_NEAREST_COUNT = 3;

async function fuelGeocode(query) {
  const key = `${FUEL_GEOCODE_CACHE_PREFIX}${query.trim().toLowerCase()}`;
  const cached = localStorage.getItem(key);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* cache corrompu, on regéocode */ }
  }
  // type=municipality force une correspondance au niveau commune/CP plutôt
  // qu'une adresse précise : sans ça, une saisie ambiguë comme "Montceau"
  // (sans le "x" de Montceaux) peut matcher une rue portant ce nom dans une
  // tout autre commune, avec un score plus élevé qu'une vraie ville — vérifié
  // en direct (voir commentaire d'en-tête du module).
  const res = await fetch(
    `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&type=municipality&limit=1`
  );
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error('Ville ou code postal introuvable');
  const [lon, lat] = feature.geometry.coordinates;
  const coords = { lat, lon };
  localStorage.setItem(key, JSON.stringify(coords));
  return coords;
}

function fuelHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Types de carburant + noms de champs candidats : voir modules/fuel-types.js
// (partagé avec config.js, mêmes principes que sports-sources.js — un
// carburant coché dans Paramètres doit correspondre exactement à ce qui est
// effectivement affiché ici).

// Résout, pour CHAQUE carburant du catalogue, le premier nom de champ APLATI
// candidat réellement présent (`hasOwnProperty`, PAS juste `!= null`, voir
// point "show '—' if a fuel type is not available" : un champ présent mais
// dont la valeur est `null` pour cette station précise doit rester résolu —
// il affichera "—", pas disparaître) dans un échantillon de station réel.
// `null` si aucun des candidats connus n'est présent SOUS FORME APLATIE —
// fuelExtractStationPrices ci-dessous retombe alors sur le champ imbriqué
// `prix` (voir son commentaire).
function fuelResolveFieldMap(sampleStation) {
  const map = {};
  for (const opt of window.FuelTypes.OPTIONS) {
    map[opt.id] = opt.candidates.find(c => Object.prototype.hasOwnProperty.call(sampleStation || {}, c)) || null;
  }
  return map;
}

// Débogage "affichage vide" (2026-09-01, sur demande explicite, "Debug the
// current empty display issue first — log raw API prix field content and
// fix parsing if needed") — cause probable : SANS `select=` explicite (retiré
// la fois précédente pour ne plus dépendre d'un nom de champ figé, voir
// main.js fuel:fetchNearby), ce jeu de données gouvernemental peut renvoyer
// ses prix sous leur forme BRUTE/IMBRIQUÉE plutôt qu'aplatie : un champ
// unique `prix` contenant un TABLEAU d'objets `{"@nom":"Gazole",
// "@valeur":"1.859", ...}` (ou `nom`/`valeur` sans le `@`, les 2 formes
// existent selon la version d'export) — AUCUN des noms de champs aplatis
// connus (sp95_prix, etc.) n'existe alors du tout, fieldMap ressort
// intégralement à `null`, et l'affichage montre "—" PARTOUT, ce qui
// ressemble effectivement à un module "vide". Cette fonction gère les 2
// formes : aplatie (accès direct par nom de champ résolu) EN PRIORITÉ,
// repli sur le parsing du tableau `prix` imbriqué pour tout carburant pas
// déjà trouvé sous forme aplatie.
function fuelParsePrixField(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      console.warn('[Carburant] Champ "prix" présent mais illisible (JSON invalide)', raw, err);
      return null;
    }
  }
  if (typeof raw === 'object') return [raw]; // une seule entrée, pas dans un tableau
  return null;
}

function fuelExtractStationPrices(station, fieldMap) {
  const prices = {};
  for (const opt of window.FuelTypes.OPTIONS) {
    const flatKey = fieldMap[opt.id];
    if (flatKey && station[flatKey] != null) {
      const n = Number(station[flatKey]);
      if (!Number.isNaN(n)) prices[opt.id] = n;
    }
  }

  const prixEntries = fuelParsePrixField(station.prix);
  if (prixEntries) {
    for (const entry of prixEntries) {
      const nom = String(entry?.['@nom'] ?? entry?.nom ?? '').toLowerCase().trim();
      const valeurRaw = entry?.['@valeur'] ?? entry?.valeur;
      const valeur = valeurRaw != null ? Number(valeurRaw) : null;
      if (!nom || valeur == null || Number.isNaN(valeur)) continue;
      for (const opt of window.FuelTypes.OPTIONS) {
        if (prices[opt.id] != null) continue; // déjà trouvé sous forme aplatie, ne pas écraser
        if (opt.prixNoms.includes(nom)) prices[opt.id] = valeur;
      }
    }
  }
  return prices;
}

function fuelFmtPrice(v) {
  return v != null ? `${v.toFixed(3)} €` : '—';
}

// `enabledOptions` : sous-ensemble de window.FuelTypes.OPTIONS déjà filtré
// selon les cases cochées dans Paramètres (voir render() ci-dessous, point
// "Only show columns for checked fuel types") — cette fonction ne connaît
// donc plus du tout la notion de "tous les carburants", juste "affiche
// celui-ci".
function fuelStationRowHtml(station, isCheapest, enabledOptions) {
  return `
    <div class="fuel-station-row${isCheapest ? ' cheapest' : ''}">
      <div class="fuel-station-main">
        <span class="fuel-station-address">${station.adresse || '—'}</span>
        <span class="fuel-station-city">${station.ville || ''}${station.cp ? ` (${station.cp})` : ''} · ${station.distanceKm.toFixed(1)} km${isCheapest ? ' · 💶 moins cher' : ''}</span>
      </div>
      <div class="fuel-station-prices" style="grid-template-columns: repeat(${enabledOptions.length}, 1fr);">
        ${enabledOptions.map(opt => `
          <div class="fuel-price">
            <span class="fuel-price-label">${opt.label}</span>
            <span class="fuel-price-value">${fuelFmtPrice(station.prices[opt.id])}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

window.MatinModules.fuelPrices = {
  async render(container, config, _google, setBadge) {
    const query = (config?.city || '').trim();
    if (!query) {
      container.innerHTML = `<div class="module-empty">Renseignez votre ville ou code postal dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    setBadge('…');
    try {
      const { lat, lon } = await fuelGeocode(query);
      console.log(`[Carburants] "${query}" géocodé en lat=${lat} lon=${lon}`);
      const stations = await window.matin.fuel.fetchNearby({ lat, lon });
      console.log(`[Carburants] ${stations.length} station(s) brute(s) reçues dans le rayon`);
      // Débogage — réponse brute COMPLÈTE (plus seulement les champs qu'on
      // s'attendait à recevoir, voir main.js fuel:fetchNearby qui ne
      // restreint plus via `select=`) pour la/les station(s) les plus
      // proches de la ville/CP configurée (ex. 01090), la liste explicite
      // des noms de champs réellement présents, ET le contenu brut du champ
      // imbriqué `prix` s'il existe (voir fuelParsePrixField — la forme la
      // plus probable de l'"affichage vide" signalé).
      if (stations[0]) {
        console.log('[Carburant] Réponse API brute (1re station) :', stations[0]);
        console.log(`[Carburant] Champs disponibles: ${Object.keys(stations[0]).join(', ')}`);
        console.log('[Carburant] Champ "prix" brut (1re station) :', stations[0].prix ?? '(absent)');
      }

      // Résolution dynamique du nom de champ ACTUEL pour chaque carburant
      // (voir modules/fuel-types.js OPTIONS/fuelResolveFieldMap) : l'API
      // gouvernementale a pu renommer ou restructurer ses champs depuis la
      // dernière vérification en direct — plus de nom figé en dur, un seul
      // point de résolution partagé par le tri, le badge ET l'affichage
      // ci-dessous, pour qu'ils restent forcément cohérents entre eux quel
      // que soit le nom/la forme réels des champs.
      const fieldMap = fuelResolveFieldMap(stations[0]);
      console.log('[Carburant] Mapping carburant → champ résolu :', fieldMap);
      if (!fieldMap.sp95 && !stations[0]?.prix) {
        console.warn('[Carburant] Aucun champ SP95 reconnu (ni aplati, ni via "prix" imbriqué) dans la réponse — candidats aplatis testés :', window.FuelTypes.findById('sp95').candidates, '— colonne SP95-E5 affichée avec "—" partout.');
      }

      const nearest = stations
        .filter(s => s.geom?.lat != null && s.geom?.lon != null)
        .map(s => ({ ...s, distanceKm: fuelHaversineKm(lat, lon, s.geom.lat, s.geom.lon) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, FUEL_NEAREST_COUNT)
        // Prix résolus UNE FOIS par station (aplati en priorité, repli sur
        // le tableau `prix` imbriqué — voir fuelExtractStationPrices), puis
        // réutilisés tels quels par le tri, le badge et le rendu ci-dessous.
        .map(s => ({ ...s, prices: fuelExtractStationPrices(s, fieldMap) }));
      console.log('[Carburant] Prix résolus par station :', nearest.map(s => ({ adresse: s.adresse, prices: s.prices })));

      if (!nearest.length) {
        container.innerHTML = `<div class="module-empty">Aucune station trouvée à proximité.</div>`;
        setBadge('—');
        return;
      }

      // Colonnes affichées = carburants cochés dans Paramètres (2026-09-01,
      // sur demande explicite, "Only show columns for checked fuel types")
      // — `config.fuelTypes` absent (config jamais touchée, y compris toute
      // installation existante d'avant cette fonctionnalité) retombe sur
      // window.FuelTypes.DEFAULT_ENABLED (SP95-E5/SP95-E10/SP98/Diesel),
      // jamais une liste vide.
      const enabledIds = new Set(
        Array.isArray(config?.fuelTypes) && config.fuelTypes.length
          ? config.fuelTypes
          : window.FuelTypes.DEFAULT_ENABLED
      );
      const enabledOptions = window.FuelTypes.OPTIONS.filter(opt => enabledIds.has(opt.id));

      // Tri d'affichage par SP95-E5 le moins cher (stations sans SP95-E5 en
      // dernier) — lit désormais `s.prices.sp95` (résolu ci-dessus, aplati
      // OU via `prix` imbriqué) au lieu d'un accès direct à un nom de champ.
      const displayed = [...nearest].sort((a, b) => {
        const av = a.prices.sp95, bv = b.prices.sp95;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av - bv;
      });

      const cheapest = displayed.find(s => s.prices.sp95 != null);
      container.innerHTML = `<div class="fuel-module"><div class="fuel-stations">${displayed.map(s => fuelStationRowHtml(s, s === cheapest, enabledOptions)).join('')}</div></div>`;

      setBadge(cheapest ? fuelFmtPrice(cheapest.prices.sp95) : '');
    } catch (err) {
      container.innerHTML = `<span class="module-error">Prix carburants indisponibles</span>`;
      console.error('[Carburants]', err);
      setBadge('⚠');
    }
  },
};
