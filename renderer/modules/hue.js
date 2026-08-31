/**
 * Module Philips Hue — pont local OU compte cloud (2026-08-31, sur demande
 * explicite, support des ampoules Hue de nouvelle génération SANS pont)
 *
 * Voir main.js (IPC hue:*) pour l'appairage/la découverte/le contrôle cloud
 * et la raison du passage par le process main (pas de CORS côté pont, et
 * rafraîchissement de token géré là-bas pour le cloud). L'appairage pont
 * exige un appui physique sur son bouton — entièrement géré côté page de
 * config (config.js), ce module ne fait que lire/écrire l'état une fois la
 * configuration (pont OU cloud) déjà enregistrée.
 *
 * Point 4 de la demande ("auto-detect based on which fields are filled") :
 * `hueDetectMode` choisit le pont ou le cloud selon les champs RÉELLEMENT
 * remplis dans `config`, indépendamment de `config.mode` (qui ne pilote que
 * QUELLE section est visible en Paramètres, voir renderHueConfigSection dans
 * config.js) — un `accessToken` cloud présent l'emporte sur bridgeIp/username
 * s'ils sont TOUS les deux remplis (cas rare, l'utilisateur ayant configuré
 * les 2 à un moment ou un autre), car un token cloud valide est un signal
 * plus fort d'intention actuelle qu'un pont configuré autrefois.
 *
 * AVERTISSEMENT (mode cloud uniquement, voir main.js) : NON VÉRIFIÉ en
 * conditions réelles — aucun compte Hue "sans pont" disponible pendant ce
 * développement, le format exact de l'API cloud est un best-effort.
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

function hueDetectMode(config) {
  if (config?.accessToken) return 'cloud';
  if (config?.bridgeIp?.trim() && config?.username?.trim()) return 'bridge';
  return null;
}

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

// Couleur (RVB → Hue/Sat) : uniquement disponible en mode PONT — l'API
// cloud CLIP v2 attend des coordonnées CIE xy pour la couleur (format
// différent), non implémenté ici faute d'avoir pu vérifier ce chemin en
// conditions réelles (voir avertissement d'en-tête) ; le sélecteur de
// couleur est donc masqué en mode cloud plutôt que d'envoyer une commande
// qui échouerait ou n'aurait aucun effet silencieusement.
function hueGroupRowHtml(group, mode) {
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
      ${mode === 'bridge' ? '<input type="color" class="hue-color-picker" value="#ffffff" title="Couleur">' : ''}
    </div>`;
}

// `setState(groupId, state)` abstrait l'appel réel (pont ou cloud, voir
// render ci-dessous) — ce binding n'a plus besoin de savoir lequel des 2 est
// actif.
function hueBindGroupRow(row, setState) {
  const groupId = row.dataset.groupId;
  const onToggle = row.querySelector('.hue-on-toggle');
  const briSlider = row.querySelector('.hue-bri-slider');
  const colorPicker = row.querySelector('.hue-color-picker');

  onToggle.addEventListener('change', async () => {
    briSlider.disabled = !onToggle.checked;
    try {
      await setState(groupId, { on: onToggle.checked });
    } catch (err) {
      console.error('[Hue] Échec on/off', err);
    }
  });

  let briDebounce;
  briSlider.addEventListener('input', () => {
    clearTimeout(briDebounce);
    briDebounce = setTimeout(async () => {
      try {
        await setState(groupId, { bri: parseInt(briSlider.value, 10) });
      } catch (err) {
        console.error('[Hue] Échec luminosité', err);
      }
    }, 250);
  });

  if (colorPicker) {
    let colorDebounce;
    colorPicker.addEventListener('input', () => {
      clearTimeout(colorDebounce);
      colorDebounce = setTimeout(async () => {
        const { hue, sat } = hueRgbToHueSat(colorPicker.value);
        try {
          await setState(groupId, { hue, sat, on: true });
          onToggle.checked = true;
          briSlider.disabled = false;
        } catch (err) {
          console.error('[Hue] Échec couleur', err);
        }
      }, 250);
    });
  }
}

function hueSetupPromptHtml() {
  return `
    <div class="hue-setup-prompt">
      <span class="hue-setup-icon">💡</span>
      <p>Hue non configuré.</p>
      <p class="hue-setup-hint">Choisissez votre modèle (avec ou sans bridge) et connectez-vous depuis Paramètres → Maison → Philips Hue.</p>
    </div>`;
}

// ─── Section repliable UNIQUE "Toutes mes pièces" (2026-08-31, sur demande
// explicite — remplace le repli PAR PIÈCE de la révision précédente du même
// jour : "pas de repli individuel par pièce, un seul repli global") ────────
// Un seul état replié/déplié pour TOUTE la liste des pièces, pas un par
// pièce — même mécanique que le module Prêts (grid-template-rows 0fr→1fr +
// rotation du chevron, voir style.css), mais appliquée UNE fois ici plutôt
// que répétée par pièce.

// Repli/dépli — PUREMENT CSS/JS local (même principe que prets.js
// pretsScheduleCollapsedSave : un re-render/reload complet à chaque clic
// sur la flèche serait perceptible et inutile). Persisté dans
// `modules.hue.config.collapsed` (booléen simple, comme Prêts — plus un
// objet par pièce depuis qu'il n'y a plus qu'UN SEUL état à retenir) via le
// canal silencieux `modules:updateCollapsed` (voir main.js), débounce
// 500ms pour ne pas écrire sur le disque à chaque clic si l'utilisateur
// replie/déplie plusieurs fois de suite.
const HUE_COLLAPSE_SAVE_DEBOUNCE_MS = 500;
let huePendingCollapseSave = null; // { timer, value }
let hueFlushOnCloseRegistered = false;

function hueSaveCollapsedNow(instanceKey, collapsed) {
  window.matin.modules.updateCollapsed(instanceKey, collapsed)
    .catch(err => console.error('[Hue] Échec sauvegarde état replié/déplié', err));
}

function hueScheduleCollapsedSave(instanceKey, collapsed) {
  if (huePendingCollapseSave) clearTimeout(huePendingCollapseSave.timer);
  const timer = setTimeout(() => {
    huePendingCollapseSave = null;
    hueSaveCollapsedNow(instanceKey, collapsed);
  }, HUE_COLLAPSE_SAVE_DEBOUNCE_MS);
  huePendingCollapseSave = { timer, value: collapsed };
}

// Enregistré UNE SEULE FOIS (pas à chaque render()) : vide un debounce encore
// en attente si la fenêtre se ferme avant l'échéance des 500ms, même
// principe que prets.js pretsEnsureFlushOnClose.
function hueEnsureFlushOnClose(instanceKey) {
  if (hueFlushOnCloseRegistered) return;
  hueFlushOnCloseRegistered = true;
  window.addEventListener('beforeunload', () => {
    if (huePendingCollapseSave) {
      clearTimeout(huePendingCollapseSave.timer);
      hueSaveCollapsedNow(instanceKey, huePendingCollapseSave.value);
      huePendingCollapseSave = null;
    }
  });
}

window.MatinModules.hue = {
  async render(container, config, _google, setBadge) {
    setBadge('');
    const mode = hueDetectMode(config);

    if (!mode) {
      container.innerHTML = hueSetupPromptHtml();
      setBadge('⚠');
      return;
    }

    // Même dérivation que prets.js (container.id posé par dashboard.js/
    // createModuleCard comme "content-<clé>") — Hue n'a aujourd'hui qu'une
    // seule instance possible ("hue"), mais dérivé plutôt que codé en dur
    // pour rester cohérent si ce module devenait multi-instance un jour.
    const instanceKey = (container.id || '').replace('content-', '') || 'hue';
    hueEnsureFlushOnClose(instanceKey);
    // Repliée par défaut (aucune préférence enregistrée) — seul `false`
    // explicite déplie, même convention que Prêts.
    const collapsed = config?.collapsed !== false;

    const bridgeIp = config?.bridgeIp?.trim();
    const username = config?.username?.trim();
    const getGroups = mode === 'cloud'
      ? () => window.matin.hue.cloudGetGroups()
      : () => window.matin.hue.getGroups({ bridgeIp, username });
    const setState = mode === 'cloud'
      ? (groupId, state) => window.matin.hue.cloudSetGroupState({ groupId, state })
      : (groupId, state) => window.matin.hue.setGroupState({ bridgeIp, username, groupId, state });

    try {
      const groups = await getGroups();

      if (!groups.length) {
        container.innerHTML = `<div class="module-empty">Aucune pièce trouvée ${mode === 'cloud' ? 'sur le compte Hue' : 'sur le bridge'}.</div>`;
        setBadge('');
        return;
      }

      container.innerHTML = `
        <div class="hue-module">
          <div class="hue-bulk-actions">
            <button type="button" class="hue-bulk-btn hue-bulk-on">💡 Tout allumer</button>
            <button type="button" class="hue-bulk-btn hue-bulk-off">🌑 Tout éteindre</button>
          </div>
          <div class="hue-rooms${collapsed ? ' hue-rooms-collapsed' : ''}">
            <div class="hue-rooms-toggle">
              <span class="hue-rooms-toggle-label">Toutes mes pièces</span>
              <span class="hue-rooms-chevron">▶</span>
            </div>
            <div class="hue-rooms-body">
              <div class="hue-rooms-body-inner">
                <div class="hue-groups">${groups.map((g) => hueGroupRowHtml(g, mode)).join('')}</div>
              </div>
            </div>
          </div>
        </div>`;

      container.querySelectorAll('.hue-group-row').forEach((row) => hueBindGroupRow(row, setState));

      // Tout allumer/éteindre — ré-appelle setState pour CHAQUE pièce en
      // parallèle (Promise.allSettled : une pièce injoignable ne doit pas
      // empêcher les autres de recevoir la commande), puis re-render pour
      // refléter le nouvel état réel (pas juste basculer les toggles en
      // local, au cas où une commande aurait échoué pour une pièce donnée).
      container.querySelector('.hue-bulk-on')?.addEventListener('click', async () => {
        await Promise.allSettled(groups.map(g => setState(g.id, { on: true })));
        window.MatinModules.hue.render(container, config, _google, setBadge);
      });
      container.querySelector('.hue-bulk-off')?.addEventListener('click', async () => {
        await Promise.allSettled(groups.map(g => setState(g.id, { on: false })));
        window.MatinModules.hue.render(container, config, _google, setBadge);
      });

      // Repli/dépli — bascule locale PURE (classList, voir style.css pour
      // l'animation), aucun re-render, aucune écriture disque synchrone
      // (voir hueScheduleCollapsedSave).
      const roomsEl = container.querySelector('.hue-rooms');
      container.querySelector('.hue-rooms-toggle').addEventListener('click', () => {
        const nowCollapsed = roomsEl.classList.toggle('hue-rooms-collapsed');
        config.collapsed = nowCollapsed; // reflet mémoire pour un futur re-render (ex. Tout allumer)
        hueScheduleCollapsedSave(instanceKey, nowCollapsed);
      });

      const onCount = groups.filter(g => g.on).length;
      setBadge(`${onCount}/${groups.length}`);
    } catch (err) {
      container.innerHTML = `<span class="module-error">${mode === 'cloud' ? 'Compte Hue injoignable' : 'Bridge Hue injoignable'}</span>`;
      console.error('[Hue]', err);
      setBadge('⚠');
    }
  },
};
