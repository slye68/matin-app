/**
 * Module Lecteur média — contrôle lecture Windows (SMTC)
 *
 * Affiche et contrôle le lecteur actif du système (Spotify, Deezer, Chrome…)
 * via le pont PowerShell SMTC (System Media Transport Controls Windows).
 * Aucun compte, aucune API tierce, aucun Premium requis.
 * Windows 10 1809+ uniquement — sur les autres plateformes la carte reste vide.
 *
 * Auto-refresh : événementiel (le script PS1 pousse un JSON par changement +
 * toutes les 5 s). Un interval de 2 s côté renderer relance le rendu quand
 * l'état SMTC change (comparaison de signature pour éviter les re-draws inutiles).
 */
window.MatinModules = window.MatinModules || {};

function spotifyFmtTime(ms) {
  if (ms == null || Number.isNaN(ms)) return '0:00';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Icônes SVG (traits fins, currentColor) — même jeu que l'ancien module Spotify
// pour ne pas casser les règles CSS existantes (.spotify-btn, .spotify-btn-play…).
const SPOTIFY_ICONS = {
  previous: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6h2v12H6zM19 6v12L9 12z"/></svg>',
  next:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 6h2v12h-2zM5 6l10 6-10 6z"/></svg>',
  play:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5l13 7-13 7z"/></svg>',
  pause:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 5h5v14H6zM13 5h5v14h-5z"/></svg>',
};

// ── État SMTC partagé (un seul processus PowerShell global) ───────────────────
let smtcState     = null;   // { type:'state', title, artist, app, status, positionMs, durationMs, thumbKey }
let smtcThumbs    = new Map(); // thumbKey → data-URL (base64)
let smtcListening = false;

function smtcEnsureListening() {
  if (smtcListening) return;
  smtcListening = true;
  window.matin.smtc.onState((msg) => { smtcState = (msg.type === 'state') ? msg : null; });
  window.matin.smtc.onThumb((msg) => {
    if (msg.data) smtcThumbs.set(msg.key, `data:${msg.mime};base64,${msg.data}`);
    else smtcThumbs.delete(msg.key);
  });
  window.matin.smtc.start();
}

function injectSmtcStyle() {
  if (document.querySelector('#smtc-style')) return;
  const st = document.createElement('style');
  st.id = 'smtc-style';
  st.textContent = `
    .spotify-smtc-app { font-size: 10px; color: var(--text-muted, #8b95a8);
                        text-transform: uppercase; letter-spacing: .04em; margin-left: auto; }
    .spotify-player--smtc .spotify-volume { display: none; }
  `;
  document.head.appendChild(st);
}

function spotifySmtcHtml(state, thumbDataUrl) {
  const pct = state.durationMs ? Math.min(100, (state.positionMs / state.durationMs) * 100) : 0;
  const isPlaying = state.status === 'playing';
  return `
    <div class="spotify-player spotify-player--smtc">
      <div class="spotify-top-row">
        ${thumbDataUrl
          ? `<img class="spotify-cover" src="${thumbDataUrl}" alt="">`
          : '<div class="spotify-cover spotify-cover-empty"></div>'}
        <div class="spotify-meta">
          <div class="spotify-title" title="${state.title || ''}">${state.title || '—'}</div>
          <div class="spotify-artist" title="${state.artist || ''}">${state.artist || state.app || ''}</div>
        </div>
      </div>
      <div class="spotify-controls-row">
        <div class="spotify-controls-main">
          <button class="spotify-btn smtc-btn" data-smtc="previous" title="Précédent">${SPOTIFY_ICONS.previous}</button>
          <button class="spotify-btn spotify-btn-play smtc-btn" data-smtc="toggle"
            title="${isPlaying ? 'Pause' : 'Lecture'}">${isPlaying ? SPOTIFY_ICONS.pause : SPOTIFY_ICONS.play}</button>
          <button class="spotify-btn smtc-btn" data-smtc="next" title="Suivant">${SPOTIFY_ICONS.next}</button>
        </div>
        <div class="spotify-smtc-app">${state.app || ''}</div>
      </div>
      ${state.durationMs > 0 ? `
      <div class="spotify-progress">
        <div class="spotify-progress-bar"><div class="spotify-progress-fill" style="width:${pct}%"></div></div>
        <div class="spotify-progress-times">
          <span>${spotifyFmtTime(state.positionMs)}</span>
          <span>${spotifyFmtTime(state.durationMs)}</span>
        </div>
      </div>` : ''}
    </div>`;
}

window.MatinModules.spotify = {
  async render(container, _config, _google, setBadge) {
    smtcEnsureListening();
    injectSmtcStyle();

    let lastSig = null;

    function renderCurrent() {
      // Signature track+status : ne redessine que si quelque chose a changé.
      const sig = smtcState ? `${smtcState.thumbKey}|${smtcState.status}` : 'none';
      if (sig === lastSig) return;
      lastSig = sig;

      if (smtcState && smtcState.title) {
        const thumb = smtcThumbs.get(smtcState.thumbKey) || null;
        container.innerHTML = spotifySmtcHtml(smtcState, thumb);
        setBadge(smtcState.status === 'playing' ? (smtcState.app || '') : 'en pause');
        container.querySelectorAll('.smtc-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            await window.matin.smtc.send(btn.dataset.smtc);
          });
        });
      } else {
        container.innerHTML = `<div class="spotify-idle"><span class="module-empty">Rien en cours de lecture</span></div>`;
        setBadge('—');
      }
    }

    renderCurrent();

    // Polling léger (2 s) — redessine seulement si l'état a changé.
    setInterval(() => {
      if (!document.body.contains(container)) return;
      renderCurrent();
    }, 2000);
  },
};
