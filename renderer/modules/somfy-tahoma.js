/**
 * Module Somfy TaHoma — API LOCALE (2026-09-12).
 *
 * Toute la logique réseau (HTTPS certificat auto-signé, jeton Bearer, setup,
 * exec/apply) vit dans main.js (voir ipcMain.handle('tahoma:...')) —
 * impossible proprement depuis ce fichier (renderer, contextIsolation). Ce
 * module se contente d'appeler `window.matin.somfyTahoma.discover`/
 * `sendCommand` et d'afficher le résultat — même répartition que Kasa/
 * Trådfri (voir kasa.js/tradfri.js).
 *
 * Authentification par JETON Bearer (2e révision, même jour — remplace
 * email/mot de passe) : confirmé EN DIRECT contre la vraie box de
 * l'utilisateur que le login email/mot de passe est bloqué par la box
 * elle-même au niveau TLS, avant même l'envoi des identifiants (voir main.js
 * pour l'historique complet du diagnostic).
 *
 * `config.ip`/`config.token` déjà en mémoire côté renderer (mod.config, voir
 * dashboard.js renderModuleOnce) — transmis à chaque appel, jamais relus
 * depuis electron-store ici (même convention que window.matin.hue/tradfri).
 *
 * `setup` (via `discover`) renvoie à la fois la liste des équipements ET
 * leur état courant — un seul appel sert donc pour la découverte manuelle
 * (bouton Paramètres) ET pour le rafraîchissement périodique (30s, voir
 * dashboard.js MODULE_REGISTRY.somfyTahoma), pas besoin d'un 2e endpoint
 * "getState" séparé.
 *
 * TOUJOURS NON VÉRIFIÉ EN DIRECT avec un vrai jeton (le port/le blocage TLS
 * de l'ancien login ont pu l'être grâce aux erreurs renvoyées par la box,
 * voir main.js) — à confirmer dès qu'un jeton aura été généré depuis
 * l'appli Somfy.
 */
window.MatinModules = window.MatinModules || {};

// Contrôle par pourcentage (2026-09-12, sur demande explicite — remplace les
// boutons Ouvrir/Stop/Fermer binaires) : `d.position` (0 = ouvert, 100 =
// fermé, voir main.js tahomaExtractState/core:ClosureState) initialise le
// slider ; `undefined`/`null` (équipement qui ne remonte pas cet état) replié
// sur 0 plutôt que de laisser un slider sans valeur. Le bouton Stop a été
// retiré de l'UI (absent de la maquette demandée) mais la commande reste
// acceptée côté main.js (TAHOMA_SHUTTER_COMMANDS) si un futur besoin la
// réintroduit.
function tahomaDeviceRowHtml(d) {
  const position = typeof d.position === 'number' ? d.position : 0;
  return `
    <div class="kasa-device tahoma-device" data-device-url="${d.deviceURL}">
      <span class="kasa-device-name" title="${d.label}">${d.label}</span>
      <div class="somfy-shutter-controls">
        <button type="button" class="somfy-btn-open" title="Ouvrir">▲</button>
        <input type="range" class="somfy-slider" min="0" max="100" step="1" value="${position}">
        <span class="somfy-percent">${position}%</span>
        <button type="button" class="somfy-btn-close" title="Fermer">▼</button>
      </div>
    </div>`;
}

function tahomaEmptyStateHtml(hasCredentials) {
  if (!hasCredentials) {
    return `
      <div class="hue-setup-prompt">
        <span class="hue-setup-icon">🪟</span>
        <p>Somfy TaHoma non configuré.</p>
        <p class="hue-setup-hint">Renseignez l'IP de votre TaHoma Switch et votre jeton dans Paramètres → Maison, puis cliquez "Découvrir les équipements".</p>
      </div>`;
  }
  return `
    <div class="hue-setup-prompt">
      <span class="hue-setup-icon">🪟</span>
      <p>Aucun équipement trouvé.</p>
      <p class="hue-setup-hint">Vérifiez l'IP et le jeton dans Paramètres → Maison, puis cliquez "Découvrir les équipements".</p>
    </div>`;
}

// `input` (glisser) met juste le % à jour visuellement ; `change` (relâcher)
// envoie la commande — évite une requête HTTP par pixel glissé, comme
// explicitement demandé. ▲/▼ déplacent le slider ET envoient directement
// (0/100 sont des valeurs de `setClosure` comme les autres, pas une commande
// à part). Renvoie `setPosition` (2026-09-13, sur demande explicite —
// boutons "Tout ouvrir"/"Tout fermer") pour que l'appelant puisse déclencher
// la MÊME logique (slider + % + envoi) depuis un contrôle global, sans dupliquer
// le comportement des flèches individuelles.
function tahomaBindDeviceRow(row, config) {
  const deviceURL = row.dataset.deviceUrl;
  const openBtn = row.querySelector('.somfy-btn-open');
  const closeBtn = row.querySelector('.somfy-btn-close');
  const slider = row.querySelector('.somfy-slider');
  const percentEl = row.querySelector('.somfy-percent');
  const controls = [openBtn, closeBtn, slider];

  const setBusy = (busy) => controls.forEach((el) => { el.disabled = busy; });

  const sendPosition = async (value) => {
    setBusy(true);
    try {
      await window.matin.somfyTahoma.sendCommand({
        ip: config.ip, token: config.token,
        deviceURL, command: 'setClosure', value,
      });
    } catch (err) {
      console.error('[Somfy TaHoma] Échec setClosure', value, deviceURL, err);
    } finally {
      setBusy(false);
    }
  };

  const setPosition = (value) => {
    slider.value = value;
    percentEl.textContent = `${value}%`;
    return sendPosition(value);
  };

  slider.addEventListener('input', () => { percentEl.textContent = `${slider.value}%`; });
  slider.addEventListener('change', () => { sendPosition(Number(slider.value)); });
  openBtn.addEventListener('click', () => setPosition(0));
  closeBtn.addEventListener('click', () => setPosition(100));

  return setPosition;
}

window.MatinModules.somfyTahoma = {
  async render(container, config, _google, setBadge) {
    setBadge('…');
    const hasCredentials = !!(config?.ip && config?.token);
    if (!hasCredentials) {
      container.innerHTML = tahomaEmptyStateHtml(false);
      setBadge('—');
      return;
    }
    try {
      const devices = await window.matin.somfyTahoma.discover({ ip: config.ip, token: config.token });
      if (!devices.length) {
        container.innerHTML = tahomaEmptyStateHtml(true);
        setBadge('—');
        return;
      }
      // "Tout ouvrir"/"Tout fermer" (2026-09-13, sur demande explicite) —
      // n'apparaît que s'il y a au moins 2 équipements (aucun intérêt à
      // dupliquer les flèches d'un seul volet).
      const bulkActionsHtml = devices.length > 1 ? `
        <div class="somfy-bulk-actions">
          <button type="button" class="somfy-bulk-btn somfy-bulk-open">▲ Tout ouvrir</button>
          <button type="button" class="somfy-bulk-btn somfy-bulk-close">▼ Tout fermer</button>
        </div>` : '';
      container.innerHTML = `
        <div class="kasa-module tahoma-module">
          ${bulkActionsHtml}
          <div class="kasa-devices">${devices.map(tahomaDeviceRowHtml).join('')}</div>
        </div>`;
      const rows = Array.from(container.querySelectorAll('.tahoma-device'));
      const setPositions = rows.map(row => tahomaBindDeviceRow(row, config));
      container.querySelector('.somfy-bulk-open')?.addEventListener('click', () => {
        setPositions.forEach(setPosition => setPosition(0));
      });
      container.querySelector('.somfy-bulk-close')?.addEventListener('click', () => {
        setPositions.forEach(setPosition => setPosition(100));
      });
      setBadge(String(devices.length));
    } catch (err) {
      container.innerHTML = `<span class="module-error">TaHoma Switch injoignable</span>`;
      console.error('[Somfy TaHoma]', err);
      setBadge('⚠');
    }
  },
};
