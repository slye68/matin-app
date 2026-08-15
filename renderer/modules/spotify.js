/**
 * Module Spotify — lecture en cours + contrôles (Web API Spotify)
 *
 * Auth via window.matin.spotify.* (voir main/auth/spotify-oauth.js) — même
 * schéma que Google OAuth, store électron séparé. L'API Spotify envoie des
 * en-têtes CORS permissifs (vérifié : access-control-allow-origin: *), donc
 * fetch direct depuis le renderer, comme gmail.js/calendar.js pour Google —
 * pas besoin du proxy process main utilisé pour les flux RSS.
 *
 * Auto-refresh : géré en interne (setInterval sur 10s), PAS via le
 * planificateur générique de dashboard.js — un re-render() complet toutes les
 * 10s casserait l'interaction avec le curseur de volume et clignoterait les
 * boutons ; ce module ne redessine que sa propre zone d'état, comme
 * etf.js/crypto.js le font pour leurs propres auto-refresh.
 *
 * Les endpoints de contrôle de lecture (play/pause/next/previous/volume)
 * nécessitent un compte Spotify Premium ET un appareil Spotify Connect actif
 * (l'appli Spotify ouverte quelque part) — sans les deux, Spotify répond 403/404,
 * capturé et simplement journalisé (pas de crash de l'UI).
 */
window.MatinModules = window.MatinModules || {};

const SPOTIFY_REFRESH_MS = 10 * 1000;

async function spotifyApi(method, path, accessToken, query) {
  const url = `https://api.spotify.com/v1${path}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null; // pas de contenu (rien en lecture, commande acceptée)
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Spotify API ${res.status} ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function spotifyFmtTime(ms) {
  if (ms == null || Number.isNaN(ms)) return '0:00';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function spotifyBestImage(images) {
  if (!images?.length) return '';
  return images[images.length - 1].url || images[0].url || '';
}

// Icônes en SVG (traits fins, currentColor) — pas d'emoji, cf. demande de
// contrôles "clean icon buttons".
const SPOTIFY_ICONS = {
  previous: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6h2v12H6zM19 6v12L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 6h2v12h-2zM5 6l10 6-10 6z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5l13 7-13 7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 5h5v14H6zM13 5h5v14h-5z"/></svg>',
  volume: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16.5 12c0-1.6-.8-3-2-3.7v7.5c1.2-.8 2-2.2 2-3.8z"/><path d="M18.5 12c0-2.7-1.5-5-3.5-6.2v1.7c1.5 1 2.5 2.8 2.5 4.5s-1 3.5-2.5 4.5v1.7c2-1.2 3.5-3.5 3.5-6.2z"/></svg>',
};

async function spotifyFetchRecentlyPlayed(accessToken) {
  const data = await spotifyApi('GET', '/me/player/recently-played', accessToken, 'limit=3');
  return (data?.items || []).map(it => ({
    title: it.track?.name || '',
    artist: (it.track?.artists || []).map(a => a.name).join(', '),
    cover: spotifyBestImage(it.track?.album?.images),
    externalUrl: it.track?.external_urls?.spotify || '',
  }));
}

function spotifyConnectHtml() {
  return `
    <div class="spotify-connect">
      <span class="module-empty">Non connecté à Spotify</span>
      <button class="spotify-connect-btn">Connecter Spotify</button>
    </div>`;
}

function spotifyIdleHtml(recentTracks) {
  if (!recentTracks.length) {
    return `<div class="spotify-idle"><span class="module-empty">Rien en cours de lecture</span></div>`;
  }
  return `
    <div class="spotify-idle">
      <div class="spotify-idle-label">Rien en cours — écoutés récemment</div>
      <div class="spotify-recent-list">
        ${recentTracks.map(t => `
          <div class="spotify-recent-item" data-link="${t.externalUrl}">
            ${t.cover ? `<img class="spotify-recent-cover" src="${t.cover}" alt="">` : '<div class="spotify-recent-cover spotify-cover-empty"></div>'}
            <div class="spotify-recent-meta">
              <div class="spotify-recent-title" title="${t.title}">${t.title}</div>
              <div class="spotify-recent-artist" title="${t.artist}">${t.artist}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// Réagencée en 3 rangées (2026-08-10, 2e révision, sur demande explicite —
// remplace la rangée unique de la révision précédente) :
// 1) pochette 45px + titre/artiste (1 ligne chacun)
// 2) contrôles ⏮⏯⏭ à gauche, volume (icône + slider prenant le reste de la
//    largeur) à droite
// 3) barre de progression pleine largeur + temps
// Repère "en écoute" (.spotify-live-badge) retiré : demande explicite "no
// other elements", uniquement les 3 rangées ci-dessus.
function spotifyPlayerHtml(state) {
  const { title, artist, cover, progressMs, durationMs, isPlaying, volumePercent } = state;
  const pct = durationMs ? Math.min(100, (progressMs / durationMs) * 100) : 0;
  return `
    <div class="spotify-player">
      <div class="spotify-top-row">
        ${cover ? `<img class="spotify-cover" src="${cover}" alt="">` : '<div class="spotify-cover spotify-cover-empty"></div>'}
        <div class="spotify-meta">
          <div class="spotify-title" title="${title}">${title}</div>
          <div class="spotify-artist" title="${artist}">${artist}</div>
        </div>
      </div>
      <div class="spotify-controls-row">
        <div class="spotify-controls-main">
          <button class="spotify-btn" data-action="previous" title="Précédent">${SPOTIFY_ICONS.previous}</button>
          <button class="spotify-btn spotify-btn-play" data-action="toggle" data-playing="${isPlaying}" title="${isPlaying ? 'Pause' : 'Lecture'}">${isPlaying ? SPOTIFY_ICONS.pause : SPOTIFY_ICONS.play}</button>
          <button class="spotify-btn" data-action="next" title="Suivant">${SPOTIFY_ICONS.next}</button>
        </div>
        <div class="spotify-volume">
          <span class="spotify-volume-icon">${SPOTIFY_ICONS.volume}</span>
          <input type="range" min="0" max="100" value="${volumePercent ?? 50}" class="spotify-volume-slider">
        </div>
      </div>
      <div class="spotify-progress">
        <div class="spotify-progress-bar"><div class="spotify-progress-fill" style="width:${pct}%"></div></div>
        <div class="spotify-progress-times">
          <span>${spotifyFmtTime(progressMs)}</span>
          <span>${spotifyFmtTime(durationMs)}</span>
        </div>
      </div>
    </div>`;
}

window.MatinModules.spotify = {
  async render(container, _config, _google, setBadge) {
    const tokenData = await window.matin.spotify.getValidToken();

    if (!tokenData?.accessToken) {
      container.innerHTML = spotifyConnectHtml();
      setBadge('—');
      container.querySelector('.spotify-connect-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Connexion…';
        try {
          await window.matin.spotify.login();
          await this.render(container, _config, _google, setBadge);
        } catch (err) {
          console.error('[Spotify] Connexion échouée', err);
          container.innerHTML = `<span class="module-error">Échec de la connexion Spotify</span>`;
        }
      });
      return;
    }

    let volumeDragging = false;
    let stopped = false;

    const updateBadge = (state) => {
      if (!state) { setBadge('—'); return; }
      setBadge(state.isPlaying ? state.artist || 'lecture' : 'en pause');
    };

    async function tick() {
      let accessToken;
      try {
        const fresh = await window.matin.spotify.getValidToken();
        if (!fresh?.accessToken) {
          container.innerHTML = spotifyConnectHtml();
          updateBadge(null);
          container.querySelector('.spotify-connect-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Connexion…';
            try {
              await window.matin.spotify.login();
              await window.MatinModules.spotify.render(container, _config, _google, setBadge);
            } catch (err) {
              console.error('[Spotify] Connexion échouée', err);
              container.innerHTML = `<span class="module-error">Échec de la connexion Spotify</span>`;
            }
          });
          return false;
        }
        accessToken = fresh.accessToken;
      } catch (err) {
        console.error('[Spotify] Vérification du token échouée', err);
        return true; // on retente au prochain tick plutôt que d'abandonner
      }

      try {
        // additional_types=track,episode est indispensable : sans lui, Spotify
        // renvoie item:null pour un podcast en cours (confirmé empiriquement —
        // c'était la cause du "rien détecté" alors qu'un épisode jouait bel et
        // bien). Par défaut l'API ne considère que les pistes musicales.
        const playback = await spotifyApi('GET', '/me/player', accessToken, 'additional_types=track,episode');

        if (!playback || !playback.item) {
          const recent = await spotifyFetchRecentlyPlayed(accessToken).catch(() => []);
          container.innerHTML = spotifyIdleHtml(recent);
          container.querySelectorAll('.spotify-recent-item').forEach(el => {
            el.addEventListener('click', () => {
              const link = el.dataset.link;
              if (link) window.matin.shell.openExternal(link);
            });
          });
          updateBadge(null);
          return true;
        }

        // Un épisode (podcast) n'a ni `artists` ni `album` — le nom du show
        // fait office d'"artiste" et l'image est directement sur l'item.
        const isEpisode = playback.currently_playing_type === 'episode';
        const state = {
          title: playback.item.name || '',
          artist: isEpisode
            ? (playback.item.show?.name || '')
            : (playback.item.artists || []).map(a => a.name).join(', '),
          cover: spotifyBestImage(isEpisode ? playback.item.images : playback.item.album?.images),
          progressMs: playback.progress_ms || 0,
          durationMs: playback.item.duration_ms || 0,
          isPlaying: !!playback.is_playing,
          volumePercent: playback.device?.volume_percent,
        };

        // Ne pas écraser le curseur de volume pendant que l'utilisateur le fait glisser.
        if (volumeDragging) {
          const existingSlider = container.querySelector('.spotify-volume-slider');
          if (existingSlider) state.volumePercent = existingSlider.value;
        }

        container.innerHTML = spotifyPlayerHtml(state);
        updateBadge(state);
        wireControls(container, accessToken, () => (volumeDragging = true), () => (volumeDragging = false));
        return true;
      } catch (err) {
        console.error('[Spotify] Lecture de l\'état échouée', err);
        return true;
      }
    }

    function wireControls(root, accessToken, onDragStart, onDragEnd) {
      const refreshSoon = () => setTimeout(() => tick(), 400);

      root.querySelectorAll('.spotify-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          try {
            if (action === 'previous') {
              await spotifyApi('POST', '/me/player/previous', accessToken);
            } else if (action === 'next') {
              await spotifyApi('POST', '/me/player/next', accessToken);
            } else if (action === 'toggle') {
              const isPlaying = btn.dataset.playing === 'true';
              await spotifyApi('PUT', isPlaying ? '/me/player/pause' : '/me/player/play', accessToken);
            }
          } catch (err) {
            console.error(`[Spotify] Commande "${action}" échouée (Premium + appareil actif requis)`, err);
          }
          refreshSoon();
        });
      });

      const slider = root.querySelector('.spotify-volume-slider');
      if (slider) {
        slider.addEventListener('pointerdown', onDragStart);
        slider.addEventListener('change', async () => {
          try {
            await spotifyApi('PUT', '/me/player/volume', accessToken, `volume_percent=${slider.value}`);
          } catch (err) {
            console.error('[Spotify] Réglage du volume échoué', err);
          } finally {
            onDragEnd();
          }
        });
      }
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    const ok = await tick();
    if (!ok) return;

    const intervalId = setInterval(async () => {
      if (stopped || !document.body.contains(container)) {
        clearInterval(intervalId);
        return;
      }
      const stillOk = await tick();
      if (!stillOk) {
        stopped = true;
        clearInterval(intervalId);
      }
    }, SPOTIFY_REFRESH_MS);
  },
};
