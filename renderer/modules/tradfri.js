/**
 * Module IKEA Trådfri — passerelle locale CoAP/DTLS, aucun compte cloud
 * (2026-08-11, sur demande explicite).
 *
 * Voir main.js (IPC tradfri:*) pour la connexion réelle — le protocole CoAP
 * chiffré (DTLS/PSK) a besoin de vraies sockets UDP Node, impossibles depuis
 * ce fichier (renderer, contextIsolation), d'où le passage systématique par
 * `window.matin.tradfri.*`. Ce module ne fait qu'afficher l'état déjà
 * reconstruit côté process main (`tradfri:getState`, regroupé par pièce) et
 * envoyer des commandes.
 *
 * `gatewayIp`/`identity`/`psk` viennent de `config` (déjà en mémoire côté
 * renderer, comme bridgeIp/username pour Hue) et sont transmis À CHAQUE appel
 * IPC — ce module ne les lit ni ne les modifie jamais lui-même, l'appairage
 * initial vit entièrement dans Paramètres → Maison (voir config.js,
 * renderTradfriConfigSection).
 *
 * Classes CSS réutilisées TELLES QUELLES depuis Kasa (`.kasa-switch`,
 * `.kasa-power-toggle`, `.kasa-bri-slider`, `.kasa-device*`, `.kasa-quick-
 * actions`, `.kasa-all-on/off-btn`) — même besoin visuel (bascule on/off +
 * curseur), seule la structure de regroupement (par PIÈCE ici, par TYPE côté
 * Kasa) et les scènes sont propres à ce module.
 */
window.MatinModules = window.MatinModules || {};

function tradfriBulbRowHtml(d) {
  return `
    <div class="kasa-device kasa-device-bulb tradfri-device ${d.unreachable ? 'kasa-device-unreachable' : ''}" data-instance-id="${d.instanceId}">
      <label class="kasa-switch">
        <input type="checkbox" class="kasa-power-toggle" ${d.on ? 'checked' : ''} ${d.unreachable ? 'disabled' : ''}>
        <span class="kasa-switch-slider"></span>
      </label>
      <div class="kasa-bulb-main">
        <span class="kasa-device-name" title="${d.name}">${d.name}</span>
        ${d.supportsBrightness ? `<input type="range" class="kasa-bri-slider tradfri-bri-slider" min="1" max="100" value="${d.brightness ?? 100}" ${d.on && !d.unreachable ? '' : 'disabled'}>` : ''}
        ${d.supportsColorTemp ? `<input type="range" class="kasa-bri-slider tradfri-temp-slider" min="0" max="100" value="${d.colorTemperature ?? 50}" title="Température de couleur (froid → chaud)" ${d.on && !d.unreachable ? '' : 'disabled'}>` : ''}
      </div>
      ${d.unreachable ? '<span class="kasa-device-offline">Hors ligne</span>' : ''}
    </div>`;
}

function tradfriPlugRowHtml(d) {
  return `
    <div class="kasa-device tradfri-device ${d.unreachable ? 'kasa-device-unreachable' : ''}" data-instance-id="${d.instanceId}">
      <label class="kasa-switch">
        <input type="checkbox" class="kasa-power-toggle" ${d.on ? 'checked' : ''} ${d.unreachable ? 'disabled' : ''}>
        <span class="kasa-switch-slider"></span>
      </label>
      <span class="kasa-device-name" title="${d.name}">${d.name}</span>
      ${d.unreachable ? '<span class="kasa-device-offline">Hors ligne</span>' : ''}
    </div>`;
}

function tradfriBindDeviceRow(row, endpoint) {
  const instanceId = parseInt(row.dataset.instanceId, 10);
  const isBulb = row.classList.contains('kasa-device-bulb');
  const toggle = row.querySelector('.kasa-power-toggle');
  const briSlider = row.querySelector('.tradfri-bri-slider');
  const tempSlider = row.querySelector('.tradfri-temp-slider');

  toggle?.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      if (isBulb) await window.matin.tradfri.setLightState({ ...endpoint, instanceId, on: toggle.checked });
      else await window.matin.tradfri.setPlugState({ ...endpoint, instanceId, on: toggle.checked });
      if (briSlider) briSlider.disabled = !toggle.checked;
      if (tempSlider) tempSlider.disabled = !toggle.checked;
    } catch (err) {
      console.error('[Trådfri] Échec on/off', instanceId, err);
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
        await window.matin.tradfri.setLightState({ ...endpoint, instanceId, brightness: parseInt(briSlider.value, 10) });
      } catch (err) {
        console.error('[Trådfri] Échec luminosité', instanceId, err);
      }
    }, 250);
  });

  let tempDebounce;
  tempSlider?.addEventListener('input', () => {
    clearTimeout(tempDebounce);
    tempDebounce = setTimeout(async () => {
      try {
        await window.matin.tradfri.setLightState({ ...endpoint, instanceId, colorTemperature: parseInt(tempSlider.value, 10) });
      } catch (err) {
        console.error('[Trådfri] Échec température de couleur', instanceId, err);
      }
    }, 250);
  });
}

function tradfriSectionHtml(title, items, rowFn) {
  if (!items.length) return '';
  return `
    <div class="kasa-section">
      <div class="kasa-section-title">${title}</div>
      <div class="kasa-devices">${items.map(rowFn).join('')}</div>
    </div>`;
}

function tradfriScenesHtml(scenes, groupId) {
  if (!scenes.length) return '';
  return `
    <div class="kasa-section">
      <div class="kasa-section-title">🎭 Scènes IKEA</div>
      <div class="tradfri-scenes">
        ${scenes.map(s => `<button type="button" class="tradfri-scene-btn" data-group-id="${groupId}" data-scene-id="${s.id}">${s.name}</button>`).join('')}
      </div>
    </div>`;
}

function tradfriRoomHtml(room) {
  const bulbs = room.devices.filter(d => d.kind === 'bulb');
  const plugs = room.devices.filter(d => d.kind === 'plug');
  return `
    <div class="tradfri-room">
      <div class="tradfri-room-name">${room.name}</div>
      ${tradfriSectionHtml('💡 Ampoules', bulbs, tradfriBulbRowHtml)}
      ${tradfriSectionHtml('🔌 Prises', plugs, tradfriPlugRowHtml)}
      ${tradfriScenesHtml(room.scenes, room.id)}
    </div>`;
}

function tradfriEmptyStateHtml() {
  return `
    <div class="hue-setup-prompt">
      <span class="hue-setup-icon">💡</span>
      <p>Passerelle Trådfri non configurée.</p>
      <p class="hue-setup-hint">Renseignez l'IP de la passerelle et son code de sécurité (imprimé dessous) depuis Paramètres → Maison, puis cliquez sur "Connecter".</p>
    </div>`;
}

async function tradfriRunTurnAll(btn, on, endpoint, container, config, setBadge) {
  btn.disabled = true;
  try {
    await window.matin.tradfri.turnAll({ ...endpoint, on });
  } catch (err) {
    console.error('[Trådfri] Échec "tout allumer/éteindre"', err);
  } finally {
    // Re-rendu immédiat plutôt que d'attendre le prochain cycle externe
    // (jusqu'à 30s, voir dashboard.js MODULE_REGISTRY.tradfri) — même choix
    // que Kasa : l'utilisateur vient de cliquer, il doit voir le résultat
    // tout de suite.
    window.MatinModules.tradfri.render(container, config, null, setBadge);
  }
}

window.MatinModules.tradfri = {
  async render(container, config, _google, setBadge) {
    setBadge('…');
    const gatewayIp = config?.gatewayIp?.trim();
    const identity = config?.identity;
    const psk = config?.psk;

    if (!gatewayIp || !identity || !psk) {
      container.innerHTML = tradfriEmptyStateHtml();
      setBadge('⚠');
      return;
    }

    const endpoint = { gatewayIp, identity, psk };

    try {
      const { rooms, unassigned } = await window.matin.tradfri.getState(endpoint);
      const allDevices = [...rooms.flatMap(r => r.devices), ...unassigned];

      if (!allDevices.length) {
        container.innerHTML = `<div class="module-empty">Aucun appareil Trådfri trouvé sur cette passerelle.</div>`;
        setBadge('—');
        return;
      }

      container.innerHTML = `
        <div class="tradfri-module">
          <div class="kasa-quick-actions">
            <button type="button" class="tradfri-all-off-btn">Tout éteindre</button>
            <button type="button" class="tradfri-all-on-btn">Tout allumer</button>
          </div>
          <div class="tradfri-rooms">
            ${rooms.map(tradfriRoomHtml).join('')}
            ${unassigned.length ? tradfriRoomHtml({ id: 'unassigned', name: 'Sans pièce', devices: unassigned, scenes: [] }) : ''}
          </div>
        </div>`;

      container.querySelectorAll('.tradfri-device').forEach(row => tradfriBindDeviceRow(row, endpoint));

      container.querySelectorAll('.tradfri-scene-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await window.matin.tradfri.activateScene({
              ...endpoint,
              groupId: parseInt(btn.dataset.groupId, 10),
              sceneId: parseInt(btn.dataset.sceneId, 10),
            });
          } catch (err) {
            console.error('[Trådfri] Échec activation de scène', err);
          } finally {
            btn.disabled = false;
          }
        });
      });

      container.querySelector('.tradfri-all-on-btn').addEventListener('click', (e) => tradfriRunTurnAll(e.currentTarget, true, endpoint, container, config, setBadge));
      container.querySelector('.tradfri-all-off-btn').addEventListener('click', (e) => tradfriRunTurnAll(e.currentTarget, false, endpoint, container, config, setBadge));

      const onCount = allDevices.filter(d => d.on).length;
      setBadge(`${onCount}/${allDevices.length}`);
    } catch (err) {
      container.innerHTML = `<span class="module-error">Passerelle Trådfri injoignable</span>`;
      console.error('[Trådfri]', err);
      setBadge('⚠');
    }
  },
};
