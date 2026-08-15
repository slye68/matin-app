/**
 * Module Météo — Open-Meteo (gratuit, sans clé)
 * Géocode la ville via Nominatim, puis récupère les données météo
 */
window.MatinModules = window.MatinModules || {};

window.MatinModules.weather = {
  async render(container, config, _googleData, setBadge) {
    const city = config?.city || 'Lyon';
    const unit = config?.unit || 'celsius';

    try {
      // 1. Géocodage
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'fr' } }
      );
      const geoData = await geoRes.json();
      if (!geoData.length) throw new Error('Ville introuvable');

      const { lat, lon } = geoData[0];

      // 2. Météo actuelle + prévisions 3 jours
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
        `&temperature_unit=${unit}&wind_speed_unit=kmh&timezone=auto&forecast_days=4`
      );
      const w = await weatherRes.json();

      const temp    = Math.round(w.current.temperature_2m);
      const desc    = this._weatherDesc(w.current.weather_code);
      const emoji   = this._weatherEmoji(w.current.weather_code);
      const wind    = Math.round(w.current.wind_speed_10m);
      const unitSym = unit === 'celsius' ? '°C' : '°F';

      setBadge(`${temp}${unitSym}`);

      // Prévisions J+1 à J+3
      const forecastHtml = w.daily.time.slice(1, 4).map((date, i) => {
        const dayName = new Date(date).toLocaleDateString('fr-FR', { weekday: 'short' });
        const max = Math.round(w.daily.temperature_2m_max[i + 1]);
        const min = Math.round(w.daily.temperature_2m_min[i + 1]);
        const ico = this._weatherEmoji(w.daily.weather_code[i + 1]);
        return `
          <div class="weather-day">
            <div class="weather-day-name">${dayName}</div>
            <div>${ico}</div>
            <div class="weather-day-temp">${max}° <span style="color:var(--text-muted)">${min}°</span></div>
          </div>`;
      }).join('');

      container.innerHTML = `
        <div class="weather-main">
          <div style="font-size:36px;line-height:1">${emoji}</div>
          <div>
            <div style="display:flex;align-items:baseline;gap:4px">
              <span class="weather-temp">${temp}</span>
              <span class="weather-unit">${unitSym}</span>
            </div>
            <div class="weather-desc">${desc} · Vent ${wind} km/h · ${city}</div>
          </div>
        </div>
        <div class="weather-forecast">${forecastHtml}</div>
      `;
    } catch (err) {
      container.innerHTML = `<span class="module-error">Météo indisponible</span>`;
      console.error('[Météo]', err);
    }
  },

  _weatherDesc(code) {
    const map = {
      0: 'Ciel dégagé', 1: 'Principalement dégagé', 2: 'Partiellement nuageux',
      3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant',
      51: 'Bruine légère', 53: 'Bruine modérée', 55: 'Bruine dense',
      61: 'Pluie légère', 63: 'Pluie modérée', 65: 'Pluie forte',
      71: 'Neige légère', 73: 'Neige modérée', 75: 'Neige forte',
      80: 'Averses légères', 81: 'Averses modérées', 82: 'Averses violentes',
      95: 'Orage', 99: 'Orage avec grêle',
    };
    return map[code] || 'Conditions variables';
  },

  _weatherEmoji(code) {
    if (code === 0) return '☀️';
    if (code <= 2)  return '⛅';
    if (code <= 3)  return '☁️';
    if (code <= 48) return '🌫️';
    if (code <= 55) return '🌦️';
    if (code <= 65) return '🌧️';
    if (code <= 75) return '❄️';
    if (code <= 82) return '🌦️';
    return '⛈️';
  }
};
