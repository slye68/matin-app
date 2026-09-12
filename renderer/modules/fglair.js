/**
 * Module Climatisation — pilotage des climatiseurs Fujitsu via FGLair
 * (compte cloud Ayla Networks EU), 2026-09-13, sur demande explicite.
 *
 * Toute la logique réseau (login, devices, properties, datapoints) vit dans
 * main.js (voir ipcMain.handle('fglair:...')), appelée ici via
 * window.matin.fglair.* — jamais de fetch direct depuis ce fichier (CORS +
 * mot de passe qui ne doit jamais transiter par ce module, lu directement
 * depuis electron-store côté main.js).
 *
 * IMPORTANT — écarts vérifiés par rapport au pseudocode de la demande
 * d'origine (détail complet dans main.js, section FGLair) : l'implémentation
 * réelle a été confirmée contre pyfujitsu (référence communautaire), PAS
 * testée contre du matériel réel. Répercussions ICI :
 * - `operation_mode` : 0=off, 2=auto, 3=cool, 4=dry, 5=fan_only, 6=heat
 *   (PAS 0=auto/1=cool/2=dry/3=fan/4=heat comme dans la demande).
 * - `fan_speed` : 0=Quiet, 1=Low, 2=Medium, 3=High, 4=Auto (PAS
 *   0=auto/1=quiet/2=low/3=med/4=high comme dans la demande).
 * - Pas de propriété `operation_status` séparée — ON/OFF piloté via
 *   `operation_mode` (0 = off, un mode concret = on).
 * - `adjust_temperature` est en DIXIÈMES de degré (220 = 22°C).
 * - Chaque commande cible la propriété par son `key` NUMÉRIQUE propre à cet
 *   appareil (renvoyé par le GET properties), jamais par son nom générique
 *   — voir `sendCommand` ci-dessous, qui va chercher ce `key` dans le cache
 *   de propriétés déjà chargées pour ce DSN.
 * - `display_temperature` (température ambiante) reste NON VÉRIFIÉE — voir
 *   main.js pour le détail ; si elle n'apparaît jamais, vérifier les logs
 *   `[FGLair] Propriétés brutes` (console) pour trouver le bon nom.
 */
window.MatinModules = window.MatinModules || {};

const FGLAIR_REFRESH_MS = 10 * 60 * 1000; // "toutes les 10 minutes", demandé explicitement
const FGLAIR_MIN_TEMP = 16;
const FGLAIR_MAX_TEMP = 30;
// Mode utilisé par le bouton [ ▶ ON ] — pas de dernier mode mémorisé côté
// serveur exploitable simplement ici (voir remarque ON/OFF ci-dessus) :
// choix d'un mode concret et prévisible ("Froid") plutôt que de deviner.
const FGLAIR_DEFAULT_ON_MODE = 3;

// Valeurs vérifiées contre pyfujitsu (voir en-tête de fichier) — PAS celles
// données dans la demande d'origine.
const FGLAIR_MODES = [
  { value: 3, label: 'Froid', icon: '❄️' },
  { value: 6, label: 'Chaud', icon: '🔥' },
  { value: 5, label: 'Vent.', icon: '💨' },
  { value: 2, label: 'Auto', icon: '♻️' },
];
const FGLAIR_FAN_SPEEDS = [
  { value: 4, label: 'Auto' },
  { value: 0, label: 'Silencieux' },
  { value: 1, label: 'Bas' },
  { value: 2, label: 'Moyen' },
  { value: 3, label: 'Élevé' },
];

// Aplatit la réponse Ayla (`[{ property: { name, value, key, ... } }, ...]`)
// en `{ [name]: { value, key } }` — le `key` de CHAQUE
// propriété est indispensable pour pouvoir la modifier ensuite (voir
// sendCommand), le nom seul ne suffit pas côté API réelle.
function fglairPropMap(props) {
  const map = {};
  for (const p of props || []) {
    if (p?.property?.name) map[p.property.name] = { value: p.property.value, key: p.property.key };
  }
  return map;
}

function fglairDeviceCardHtml(device, propMap) {
  const modeValue = propMap.operation_mode?.value ?? 0;
  const isOn = modeValue !== 0;

  const targetRaw = propMap.adjust_temperature?.value;
  const targetTemp = targetRaw != null ? Math.round(targetRaw / 10) : null;
  // display_temperature — NON VÉRIFIÉE, voir en-tête de fichier. Repli "—"
  // silencieux si absente plutôt que casser l'affichage de la carte.
  const ambientRaw = propMap.display_temperature?.value;
  const ambientTemp = ambientRaw != null ? Math.round(ambientRaw / 10) : null;
  const fanValue = propMap.fan_speed?.value;

  const modesHtml = FGLAIR_MODES.map(m => `
    <button type="button" class="fglair-mode-btn ${isOn && modeValue === m.value ? 'active' : ''}" data-mode="${m.value}">${m.icon} ${m.label}</button>
  `).join('');

  const fanOptionsHtml = FGLAIR_FAN_SPEEDS.map(f => `
    <option value="${f.value}" ${fanValue === f.value ? 'selected' : ''}>${f.label}</option>
  `).join('');

  return `
    <div class="fglair-card ${isOn ? '' : 'fglair-card-off'}" data-dsn="${device.dsn}">
      <div class="fglair-card-header">
        <span class="fglair-card-title">🌡️ ${device.name}</span>
        <span class="fglair-card-ambient">${ambientTemp != null ? `Ambiant : ${ambientTemp}°C` : ''}</span>
      </div>
      <div class="fglair-mode-row">${modesHtml}</div>
      <div class="fglair-temp-row">
        <button type="button" class="fglair-temp-btn fglair-temp-minus" ${targetTemp == null ? 'disabled' : ''}>−</button>
        <span class="fglair-temp-value">${targetTemp != null ? `${targetTemp}°C` : '—'}</span>
        <button type="button" class="fglair-temp-btn fglair-temp-plus" ${targetTemp == null ? 'disabled' : ''}>+</button>
      </div>
      <div class="fglair-fan-row">
        <label>Ventilateur :</label>
        <select class="fglair-fan-select">${fanOptionsHtml}</select>
      </div>
      <div class="fglair-power-row">
        <button type="button" class="fglair-power-btn fglair-power-off">■ OFF</button>
        <button type="button" class="fglair-power-btn fglair-power-on">▶ ON</button>
      </div>
    </div>`;
}

window.MatinModules.fglair = {
  async render(container, _config, _google, setBadge) {
    // Cache PAR RENDU (pas persistant entre 2 cycles de refresh) — associe
    // chaque DSN à son nom et à ses propriétés déjà chargées (avec leur
    // `key`), pour que les clics puissent envoyer une commande SANS
    // redemander les propriétés à chaque fois.
    const deviceCache = new Map();

    function pulseError(el) {
      if (!el) return;
      el.classList.add('fglair-error-pulse');
      setTimeout(() => el.classList.remove('fglair-error-pulse'), 1000);
    }

    function rerenderCard(dsn) {
      const entry = deviceCache.get(dsn);
      const cardEl = container.querySelector(`.fglair-card[data-dsn="${dsn}"]`);
      if (!entry || !cardEl) return;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = fglairDeviceCardHtml({ dsn, name: entry.name }, entry.props);
      cardEl.replaceWith(wrapper.firstElementChild);
      bindCard(dsn);
    }

    // Envoie UNE commande — retrouve le `key` numérique de cette propriété
    // POUR CET APPAREIL dans le cache (voir en-tête de fichier, écart #3) ;
    // en cas d'échec (réseau, 401 après retry raté...) : pulse rouge sur le
    // bouton cliqué, demandé explicitement, pas de blocage de l'UI.
    async function sendCommand(dsn, propertyName, value, btn) {
      const entry = deviceCache.get(dsn);
      const propKey = entry?.props?.[propertyName]?.key;
      if (!propKey) { pulseError(btn); return; }
      try {
        await window.matin.fglair.setProperty(propKey, value);
        entry.props[propertyName] = { ...entry.props[propertyName], value };
        rerenderCard(dsn);
      } catch (err) {
        console.error(`[FGLair] Commande "${propertyName}"=${value} échouée pour ${dsn}`, err);
        pulseError(btn);
      }
    }

    function bindCard(dsn) {
      const cardEl = container.querySelector(`.fglair-card[data-dsn="${dsn}"]`);
      if (!cardEl) return;

      cardEl.querySelectorAll('.fglair-mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => sendCommand(dsn, 'operation_mode', Number(btn.dataset.mode), btn));
      });

      const applyTempDelta = (delta, btn) => {
        const entry = deviceCache.get(dsn);
        const currentRaw = entry?.props?.adjust_temperature?.value;
        if (currentRaw == null) return;
        const currentDeg = Math.round(currentRaw / 10);
        const nextDeg = Math.min(FGLAIR_MAX_TEMP, Math.max(FGLAIR_MIN_TEMP, currentDeg + delta));
        sendCommand(dsn, 'adjust_temperature', nextDeg * 10, btn);
      };
      cardEl.querySelector('.fglair-temp-minus')?.addEventListener('click', (e) => applyTempDelta(-1, e.currentTarget));
      cardEl.querySelector('.fglair-temp-plus')?.addEventListener('click', (e) => applyTempDelta(1, e.currentTarget));

      cardEl.querySelector('.fglair-fan-select')?.addEventListener('change', (e) => {
        sendCommand(dsn, 'fan_speed', Number(e.target.value), e.target);
      });

      cardEl.querySelector('.fglair-power-off')?.addEventListener('click', (e) => sendCommand(dsn, 'operation_mode', 0, e.currentTarget));
      cardEl.querySelector('.fglair-power-on')?.addEventListener('click', (e) => sendCommand(dsn, 'operation_mode', FGLAIR_DEFAULT_ON_MODE, e.currentTarget));
    }

    async function loadAndRender() {
      setBadge('…');
      try {
        const devices = await window.matin.fglair.getDevices();
        if (!devices.length) {
          container.innerHTML = '<div class="etf-empty">Aucun appareil détecté sur ce compte.</div>';
          setBadge('—');
          return;
        }

        const results = await Promise.allSettled(devices.map(async (d) => ({
          device: d,
          propMap: fglairPropMap(await window.matin.fglair.getProperties(d.dsn)),
        })));

        const cardsHtml = results.map((r, i) => {
          if (r.status === 'rejected') {
            console.warn(`[FGLair] Propriétés indisponibles pour ${devices[i].dsn}`, r.reason?.message);
            return '';
          }
          deviceCache.set(r.value.device.dsn, { name: r.value.device.name, props: r.value.propMap });
          return fglairDeviceCardHtml(r.value.device, r.value.propMap);
        }).join('');

        container.innerHTML = `<div class="fglair-list">${cardsHtml}</div>`;
        devices.forEach((d) => bindCard(d.dsn));
        setBadge(String(devices.length));
      } catch (err) {
        console.error('[FGLair] Erreur de chargement', err);
        container.innerHTML = '<span class="module-error">Connexion FGLair impossible — vérifiez vos identifiants dans les Paramètres.</span>';
        setBadge('⚠');
      }
    }

    // Un `setInterval` précédent (re-render() déclenché par le bouton
    // "Actualiser" du titrebar) est arrêté avant d'en reposer un — même
    // garde-fou que live.js, sinon chaque clic empilerait un minuteur de plus.
    if (container.dataset.fglairIntervalId) {
      clearInterval(Number(container.dataset.fglairIntervalId));
      delete container.dataset.fglairIntervalId;
    }

    await loadAndRender();

    const intervalId = setInterval(() => {
      if (!document.body.contains(container)) {
        clearInterval(intervalId);
        return;
      }
      loadAndRender();
    }, FGLAIR_REFRESH_MS);
    container.dataset.fglairIntervalId = String(intervalId);
  },
};
