/**
 * Module TP-Link Kasa — API locale, aucun compte cloud (2026-08-10, sur
 * demande explicite).
 *
 * Voir main.js (IPC kasa:*) pour l'intégration réelle — la découverte UDP et
 * le contrôle des appareils utilisent le paquet npm `tplink-smarthome-api`,
 * qui a besoin de vraies sockets Node (dgram/net) : impossible depuis ce
 * fichier (renderer, contextIsolation) d'où le passage systématique par
 * `window.matin.kasa.*`. Ce module ne fait que consommer la liste
 * d'appareils déjà décrits par le process main et envoyer des commandes.
 *
 * La découverte elle-même (bouton "Rechercher les appareils") vit entièrement
 * dans Paramètres → Maison (voir config.js, renderKasaConfigSection) — ce
 * module se contente d'afficher les appareils déjà trouvés
 * (`window.matin.kasa.getDevices`, qui reconnecte directement chaque
 * appareil par son host connu plutôt que de rebalayer le réseau).
 *
 * Regroupement par TYPE d'appareil (pas par pièce, contrairement à TaHoma) :
 * 🔌 Prises connectées (plug simple), 💡 Ampoules (bulb), 🔌 Multiprises
 * (chaque prise d'un HS300/KP303 est déjà un appareil séparé grâce à
 * `breakoutChildren`, voir main.js — pas de logique d'enfants ici, juste un
 * regroupement visuel via `isOutlet`).
 *
 * Pas d'état optimiste pour la puissance (Watts) — seul l'on/off bascule
 * immédiatement à l'écran ; la vraie valeur de consommation revient au
 * prochain rafraîchissement (30s, voir dashboard.js MODULE_REGISTRY.kasa).
 */
window.MatinModules = window.MatinModules || {};

function kasaFmtWatts(power) {
  if (power == null) return null;
  return `${power < 10 ? power.toFixed(1) : Math.round(power)} W`;
}

// HSV → hex, pour l'aperçu initial du sélecteur de couleur (Kasa utilise
// hue 0-360/saturation 0-100/brightness 0-100, pas le hue/sat 0-65535/0-254
// de Philips Hue — conversion différente de hueRgbToHueSat dans hue.js).
function kasaHsvToHex(h, s, v) {
  const sN = s / 100, vN = v / 100;
  const c = vN * sN;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = vN - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function kasaHexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { hue: Math.round(h), saturation: Math.round(s * 100) };
}

function kasaPlugRowHtml(d) {
  const wattsLabel = kasaFmtWatts(d.power);
  return `
    <div class="kasa-device ${d.unreachable ? 'kasa-device-unreachable' : ''}" data-host="${d.host}" data-child-id="${d.childId || ''}">
      <label class="kasa-switch">
        <input type="checkbox" class="kasa-power-toggle" ${d.on ? 'checked' : ''} ${d.unreachable ? 'disabled' : ''}>
        <span class="kasa-switch-slider"></span>
      </label>
      <span class="kasa-device-name" title="${d.alias}">${d.alias}</span>
      ${d.unreachable ? '<span class="kasa-device-offline">Hors ligne</span>' : (wattsLabel ? `<span class="kasa-device-watts">${wattsLabel}</span>` : '')}
    </div>`;
}

function kasaBulbRowHtml(d) {
  const swatch = d.supportsColor ? kasaHsvToHex(d.hue ?? 0, d.saturation ?? 0, d.brightness ?? 100) : null;
  return `
    <div class="kasa-device kasa-device-bulb ${d.unreachable ? 'kasa-device-unreachable' : ''}" data-host="${d.host}">
      <label class="kasa-switch">
        <input type="checkbox" class="kasa-power-toggle" ${d.on ? 'checked' : ''} ${d.unreachable ? 'disabled' : ''}>
        <span class="kasa-switch-slider"></span>
      </label>
      <div class="kasa-bulb-main">
        <span class="kasa-device-name" title="${d.alias}">${d.alias}</span>
        ${d.supportsBrightness ? `<input type="range" class="kasa-bri-slider" min="1" max="100" value="${d.brightness ?? 100}" ${d.on && !d.unreachable ? '' : 'disabled'}>` : ''}
      </div>
      ${swatch ? `<input type="color" class="kasa-color-picker" value="${swatch}" title="Couleur" ${d.unreachable ? 'disabled' : ''}>` : ''}
      ${d.unreachable ? '<span class="kasa-device-offline">Hors ligne</span>' : ''}
    </div>`;
}

function kasaBindDeviceRow(row) {
  const host = row.dataset.host;
  const childId = row.dataset.childId || null;
  const isBulb = row.classList.contains('kasa-device-bulb');
  const toggle = row.querySelector('.kasa-power-toggle');
  const briSlider = row.querySelector('.kasa-bri-slider');
  const colorPicker = row.querySelector('.kasa-color-picker');

  toggle?.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      if (isBulb) await window.matin.kasa.setBulbState({ host, state: { on_off: toggle.checked ? 1 : 0 } });
      else await window.matin.kasa.setPower({ host, childId, on: toggle.checked });
      if (briSlider) briSlider.disabled = !toggle.checked;
    } catch (err) {
      console.error('[Kasa] Échec on/off', host, err);
      toggle.checked = !toggle.checked; // repli visuel si la commande échoue
    } finally {
      toggle.disabled = false;
    }
  });

  let briDebounce;
  briSlider?.addEventListener('input', () => {
    clearTimeout(briDebounce);
    briDebounce = setTimeout(async () => {
      try {
        await window.matin.kasa.setBulbState({ host, state: { brightness: parseInt(briSlider.value, 10) } });
      } catch (err) {
        console.error('[Kasa] Échec luminosité', host, err);
      }
    }, 250);
  });

  let colorDebounce;
  colorPicker?.addEventListener('input', () => {
    clearTimeout(colorDebounce);
    colorDebounce = setTimeout(async () => {
      const { hue, saturation } = kasaHexToHsv(colorPicker.value);
      try {
        await window.matin.kasa.setBulbState({ host, state: { hue, saturation, on_off: 1 } });
        if (toggle) toggle.checked = true;
        if (briSlider) briSlider.disabled = false;
      } catch (err) {
        console.error('[Kasa] Échec couleur', host, err);
      }
    }, 250);
  });
}

function kasaEmptyStateHtml() {
  return `
    <div class="hue-setup-prompt">
      <span class="hue-setup-icon">🔌</span>
      <p>Aucun appareil Kasa configuré.</p>
      <p class="hue-setup-hint">Cliquez sur "Rechercher les appareils" dans Paramètres → Maison pour détecter vos prises/ampoules TP-Link Kasa sur le réseau local.</p>
    </div>`;
}

function kasaSectionHtml(title, items, rowFn) {
  if (!items.length) return '';
  return `
    <div class="kasa-section">
      <div class="kasa-section-title">${title}</div>
      <div class="kasa-devices">${items.map(rowFn).join('')}</div>
    </div>`;
}

async function kasaRunTurnAll(btn, on, container, config, setBadge) {
  btn.disabled = true;
  try {
    await window.matin.kasa.turnAll(on);
  } catch (err) {
    console.error('[Kasa] Échec "tout allumer/éteindre"', err);
  } finally {
    // Re-rendu immédiat plutôt que d'attendre le prochain cycle externe
    // (jusqu'à 30s, voir dashboard.js MODULE_REGISTRY.kasa) — l'utilisateur
    // vient de cliquer un bouton d'action, il doit voir le résultat tout de
    // suite.
    window.MatinModules.kasa.render(container, config, null, setBadge);
  }
}

window.MatinModules.kasa = {
  async render(container, config, _google, setBadge) {
    setBadge('…');
    try {
      const devices = await window.matin.kasa.getDevices();

      if (!devices.length) {
        container.innerHTML = kasaEmptyStateHtml();
        setBadge('—');
        return;
      }

      const bulbs = devices.filter(d => d.deviceType === 'bulb');
      const outlets = devices.filter(d => d.deviceType === 'plug' && d.isOutlet);
      const plugs = devices.filter(d => d.deviceType === 'plug' && !d.isOutlet);

      container.innerHTML = `
        <div class="kasa-module">
          <div class="kasa-quick-actions">
            <button type="button" class="kasa-all-on-btn">Tout allumer</button>
            <button type="button" class="kasa-all-off-btn">Tout éteindre</button>
          </div>
          <div class="kasa-sections">
            ${kasaSectionHtml('🔌 Prises connectées', plugs, kasaPlugRowHtml)}
            ${kasaSectionHtml('💡 Ampoules', bulbs, kasaBulbRowHtml)}
            ${kasaSectionHtml('🔌 Multiprises', outlets, kasaPlugRowHtml)}
          </div>
        </div>`;

      container.querySelectorAll('.kasa-device').forEach(kasaBindDeviceRow);
      container.querySelector('.kasa-all-on-btn').addEventListener('click', (e) => kasaRunTurnAll(e.currentTarget, true, container, config, setBadge));
      container.querySelector('.kasa-all-off-btn').addEventListener('click', (e) => kasaRunTurnAll(e.currentTarget, false, container, config, setBadge));

      const onCount = devices.filter(d => d.on).length;
      setBadge(`${onCount}/${devices.length}`);
    } catch (err) {
      container.innerHTML = `<span class="module-error">Appareils Kasa injoignables</span>`;
      console.error('[Kasa]', err);
      setBadge('⚠');
    }
  },
};
