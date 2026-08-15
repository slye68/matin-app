/**
 * Module Qualité de l'air — Open-Meteo Air Quality (gratuit, sans clé)
 *
 * Pas de config propre : réutilise la ville du module Météo
 * (modules.weather.config.city) via window.matin.modules.getAll() plutôt que
 * de redemander la même ville une deuxième fois à l'utilisateur. Repli sur
 * "Lyon" si le module Météo est absent/désactivé — même valeur par défaut que
 * weather.js, pour rester cohérent si aucun des deux n'a jamais été configuré.
 *
 * Géocodage (Nominatim, même source que weather.js) mis en cache dans
 * localStorage par ville — évite de re-géocoder à chaque rafraîchissement
 * (30 min) alors que la ville ne change quasiment jamais.
 *
 * Indice européen de qualité de l'air (european_aqi, échelle 0-100+, standard
 * EEA/Copernicus) traduit en 5 libellés français usuels (Bon/Moyen/Dégradé/
 * Mauvais/Très mauvais) sur les mêmes bornes officielles (0-20/20-40/40-60/
 * 60-80/80+). Réduit à 3 couleurs 🟢🟡🔴 comme demandé (pas de mapping 1:1
 * officiel entre 5 libellés et 3 couleurs — répartition maison : Bon/Moyen
 * verts, Dégradé jaune, Mauvais/Très mauvais rouges).
 */
window.MatinModules = window.MatinModules || {};

const AQ_GEOCODE_CACHE_PREFIX = 'matin-aq-geocode-';

async function aqGeocodeCity(city) {
  const key = `${AQ_GEOCODE_CACHE_PREFIX}${city.trim().toLowerCase()}`;
  const cached = localStorage.getItem(key);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* cache corrompu, on regéocode */ }
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
    { headers: { 'Accept-Language': 'fr' } }
  );
  const data = await res.json();
  if (!data.length) throw new Error('Ville introuvable');
  const coords = { lat: data[0].lat, lon: data[0].lon };
  localStorage.setItem(key, JSON.stringify(coords));
  return coords;
}

// Bornes officielles de l'indice européen de qualité de l'air (EEA/Copernicus).
const AQ_BANDS = [
  { max: 20,  label: 'Bon',          color: 'green' },
  { max: 40,  label: 'Moyen',        color: 'green' },
  { max: 60,  label: 'Dégradé',      color: 'yellow' },
  { max: 80,  label: 'Mauvais',      color: 'red' },
  { max: Infinity, label: 'Très mauvais', color: 'red' },
];

function aqClassify(aqi) {
  if (aqi == null) return { label: '—', color: 'unknown' };
  return AQ_BANDS.find(b => aqi <= b.max) || AQ_BANDS[AQ_BANDS.length - 1];
}

const AQ_COLOR_EMOJI = { green: '🟢', yellow: '🟡', red: '🔴', unknown: '⚪' };

async function aqGetCity() {
  try {
    const modules = await window.matin.modules.getAll();
    const city = modules?.weather?.config?.city;
    return (city && city.trim()) || 'Lyon';
  } catch {
    return 'Lyon';
  }
}

window.MatinModules.airQuality = {
  async render(container, _config, _google, setBadge) {
    try {
      const city = await aqGetCity();
      const { lat, lon } = await aqGeocodeCity(city);

      const res = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
        `&current=european_aqi,pm10,pm2_5,ozone&timezone=auto`
      );
      if (!res.ok) throw new Error(`Open-Meteo Air Quality ${res.status}`);
      const data = await res.json();
      const current = data.current;
      if (!current) throw new Error('Réponse sans données courantes');

      const aqi = current.european_aqi ?? null;
      const status = aqClassify(aqi);
      const emoji = AQ_COLOR_EMOJI[status.color];

      setBadge(aqi != null ? `${emoji} ${Math.round(aqi)}` : '—');

      container.innerHTML = `
        <div class="aq-module">
          <div class="aq-index">
            <span class="aq-index-value aq-${status.color}">${aqi != null ? Math.round(aqi) : '—'}</span>
            <div class="aq-index-meta">
              <span class="aq-index-label aq-${status.color}">${emoji} ${status.label}</span>
              <span class="aq-index-city">${city}</span>
            </div>
          </div>
          <div class="aq-pollutants">
            <div class="aq-pollutant">
              <span class="aq-pollutant-label">PM2.5</span>
              <span class="aq-pollutant-value">${current.pm2_5 != null ? Math.round(current.pm2_5) : '—'} µg/m³</span>
            </div>
            <div class="aq-pollutant">
              <span class="aq-pollutant-label">PM10</span>
              <span class="aq-pollutant-value">${current.pm10 != null ? Math.round(current.pm10) : '—'} µg/m³</span>
            </div>
            <div class="aq-pollutant">
              <span class="aq-pollutant-label">O₃</span>
              <span class="aq-pollutant-value">${current.ozone != null ? Math.round(current.ozone) : '—'} µg/m³</span>
            </div>
          </div>
        </div>`;
    } catch (err) {
      container.innerHTML = `<span class="module-error">Qualité de l'air indisponible</span>`;
      console.error('[Qualité air]', err);
      setBadge('⚠');
    }
  },
};
