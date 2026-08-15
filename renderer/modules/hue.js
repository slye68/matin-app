/**
 * Module Philips Hue — pont local, aucune clé API externe
 *
 * Voir main.js (IPC hue:*) pour l'appairage/la découverte et la raison du
 * passage par le process main (pas de CORS côté pont). L'appairage exige un
 * appui physique sur le bouton du pont — entièrement géré côté page de
 * config (config.js), ce module ne fait que lire/écrire l'état une fois
 * bridgeIp + username déjà enregistrés.
 *
 * Rafraîchissement toutes les 30s (voir dashboard.js MODULE_REGISTRY.hue) —
 * plus fréquent que tout autre module de l'app, ce qui peut interrompre un
 * glisser en cours sur le curseur de luminosité si un cycle tombe pile à ce
 * moment (le re-render complet remplace le DOM) ; rugosité connue, pas
 * corrigé pour l'instant (demanderait de préserver l'état d'interaction en
 * cours entre deux rendus, comme ETF/Crypto le font pour leurs groupes
 * dépliés — hors scope pour une première version).
 */
window.MatinModules = window.MatinModules || {};

// Conversion RVB (input[type=color], "#rrggbb") → Hue/Sat au format Philips
// Hue (hue: 0-65535, sat: 0-254) — formule HSV standard.
function hueRgbToHueSat(hex) {
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
  return { hue: Math.round((h / 360) * 65535), sat: Math.round(s * 254) };
}

function hueGroupRowHtml(group) {
  return `
    <div class="hue-group-row" data-group-id="${group.id}">
      <label class="toggle hue-toggle">
        <input type="checkbox" class="hue-on-toggle" ${group.on ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <div class="hue-group-main">
        <span class="hue-group-name">${group.name}</span>
        <input type="range" class="hue-bri-slider" min="1" max="254" value="${group.bri}" ${group.on ? '' : 'disabled'}>
      </div>
      <input type="color" class="hue-color-picker" value="#ffffff" title="Couleur">
    </div>`;
}

function hueBindGroupRow(row, bridgeIp, username) {
  const groupId = row.dataset.groupId;
  const onToggle = row.querySelector('.hue-on-toggle');
  const briSlider = row.querySelector('.hue-bri-slider');
  const colorPicker = row.querySelector('.hue-color-picker');

  onToggle.addEventListener('change', async () => {
    briSlider.disabled = !onToggle.checked;
    try {
      await window.matin.hue.setGroupState({ bridgeIp, username, groupId, state: { on: onToggle.checked } });
    } catch (err) {
      console.error('[Hue] Échec on/off', err);
    }
  });

  let briDebounce;
  briSlider.addEventListener('input', () => {
    clearTimeout(briDebounce);
    briDebounce = setTimeout(async () => {
      try {
        await window.matin.hue.setGroupState({ bridgeIp, username, groupId, state: { bri: parseInt(briSlider.value, 10) } });
      } catch (err) {
        console.error('[Hue] Échec luminosité', err);
      }
    }, 250);
  });

  let colorDebounce;
  colorPicker.addEventListener('input', () => {
    clearTimeout(colorDebounce);
    colorDebounce = setTimeout(async () => {
      const { hue, sat } = hueRgbToHueSat(colorPicker.value);
      try {
        await window.matin.hue.setGroupState({ bridgeIp, username, groupId, state: { hue, sat, on: true } });
        onToggle.checked = true;
        briSlider.disabled = false;
      } catch (err) {
        console.error('[Hue] Échec couleur', err);
      }
    }, 250);
  });
}

function hueSetupPromptHtml() {
  return `
    <div class="hue-setup-prompt">
      <span class="hue-setup-icon">💡</span>
      <p>Pont Hue non configuré.</p>
      <p class="hue-setup-hint">Renseignez l'IP du pont et appairez-le depuis Paramètres (appui sur le bouton physique du pont requis).</p>
    </div>`;
}

window.MatinModules.hue = {
  async render(container, config, _google, setBadge) {
    setBadge('');
    const bridgeIp = config?.bridgeIp?.trim();
    const username = config?.username?.trim();

    if (!bridgeIp || !username) {
      container.innerHTML = hueSetupPromptHtml();
      setBadge('⚠');
      return;
    }

    try {
      const groups = await window.matin.hue.getGroups({ bridgeIp, username });
      container.innerHTML = `
        <div class="hue-module">
          ${groups.length ? `<div class="hue-groups">${groups.map(hueGroupRowHtml).join('')}</div>` : '<div class="module-empty">Aucune pièce trouvée sur le pont.</div>'}
        </div>`;
      container.querySelectorAll('.hue-group-row').forEach(row => hueBindGroupRow(row, bridgeIp, username));

      const onCount = groups.filter(g => g.on).length;
      setBadge(groups.length ? `${onCount}/${groups.length}` : '');
    } catch (err) {
      container.innerHTML = `<span class="module-error">Pont Hue injoignable</span>`;
      console.error('[Hue]', err);
      setBadge('⚠');
    }
  },
};
