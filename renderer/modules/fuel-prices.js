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

const FUEL_TYPES = [
  { key: 'sp95_prix', label: 'SP95' },
  { key: 'sp98_prix', label: 'SP98' },
  { key: 'gazole_prix', label: 'Diesel' },
  { key: 'e10_prix', label: 'E10' },
];

function fuelFmtPrice(v) {
  return v != null ? `${v.toFixed(3)} €` : '—';
}

function fuelStationRowHtml(station, isCheapest) {
  return `
    <div class="fuel-station-row${isCheapest ? ' cheapest' : ''}">
      <div class="fuel-station-main">
        <span class="fuel-station-address">${station.adresse || '—'}</span>
        <span class="fuel-station-city">${station.ville || ''}${station.cp ? ` (${station.cp})` : ''} · ${station.distanceKm.toFixed(1)} km${isCheapest ? ' · 💶 moins cher' : ''}</span>
      </div>
      <div class="fuel-station-prices">
        ${FUEL_TYPES.map(t => `
          <div class="fuel-price">
            <span class="fuel-price-label">${t.label}</span>
            <span class="fuel-price-value">${fuelFmtPrice(station[t.key])}</span>
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

      const nearest = stations
        .filter(s => s.geom?.lat != null && s.geom?.lon != null)
        .map(s => ({ ...s, distanceKm: fuelHaversineKm(lat, lon, s.geom.lat, s.geom.lon) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, FUEL_NEAREST_COUNT);

      if (!nearest.length) {
        container.innerHTML = `<div class="module-empty">Aucune station trouvée à proximité.</div>`;
        setBadge('—');
        return;
      }

      // Tri d'affichage par SP95 le moins cher (stations sans SP95 en dernier).
      const displayed = [...nearest].sort((a, b) => {
        if (a.sp95_prix == null && b.sp95_prix == null) return 0;
        if (a.sp95_prix == null) return 1;
        if (b.sp95_prix == null) return -1;
        return a.sp95_prix - b.sp95_prix;
      });

      const cheapest = displayed.find(s => s.sp95_prix != null);
      container.innerHTML = `<div class="fuel-module"><div class="fuel-stations">${displayed.map(s => fuelStationRowHtml(s, s === cheapest)).join('')}</div></div>`;

      setBadge(cheapest ? fuelFmtPrice(cheapest.sp95_prix) : '');
    } catch (err) {
      container.innerHTML = `<span class="module-error">Prix carburants indisponibles</span>`;
      console.error('[Carburants]', err);
      setBadge('⚠');
    }
  },
};
