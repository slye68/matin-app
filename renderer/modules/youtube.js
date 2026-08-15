/**
 * Module YouTube Notifications (2026-08-15, sur demande explicite) — grille
 * compacte d'avatars de chaînes, badge rouge si nouvelle vidéo publiée dans
 * les dernières 24h depuis la dernière vérification.
 *
 * Détection SANS coût de quota API : flux Atom public de chaque chaîne
 * (`https://www.youtube.com/feeds/videos.xml?channel_id=...`) via le même
 * `window.matin.rss.fetchFeed` générique que les modules RSS classiques
 * (voir main.js, handler `rss:fetchFeed` — agnostique du format, texte brut).
 * Aucune auth Google nécessaire ICI : seule la RÉSOLUTION d'une chaîne
 * (nom/URL → ID), faite dans Paramètres (voir config.js,
 * renderYoutubeConfigSection), appelle l'API YouTube Data v3 avec un token.
 *
 * Auto-refresh à heures FIXES uniquement (8h/12h/16h/18h/20h/22h, sur demande
 * explicite) — PAS de `refreshMs` dans MODULE_REGISTRY (voir dashboard.js) :
 * un planificateur interne (setInterval 60s, même principe que
 * initAutoBrightness) vérifie l'heure courante et ne déclenche qu'aux
 * créneaux exacts, avec un garde-fou `lastCheckSlot` persisté (électron-store,
 * chemin étroit `modules.youtube.config.lastCheckSlot`) pour ne jamais
 * redéclencher deux fois le même créneau le même jour.
 *
 * `lastSeenVideoId` (un par chaîne, dans `config.channels`) : mémorise la
 * dernière vidéo déjà vue/ouverte par l'utilisateur — comparé à la 1re entrée
 * du flux (toujours la plus récente, convention Atom/RSS universelle) pour
 * décider s'il y a du nouveau contenu. Persisté via le même chemin étroit
 * `window.matin.store.set('modules.youtube.config.channels', ...)` — SANS
 * passer par `window.matin.modules.update()`, qui déclencherait un
 * `location.reload()` du dashboard entier à chaque clic sur une chaîne (voir
 * dashboard.js, commentaire sur `modules:updated`).
 */
window.MatinModules = window.MatinModules || {};

const YT_FIXED_TIMES = ['08:00', '12:00', '16:00', '18:00', '20:00', '22:00'];
const YT_SCHEDULE_CHECK_MS = 60 * 1000;
const YT_NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const YT_RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const YT_LAST_SLOT_KEY = 'modules.youtube.config.lastCheckSlot';
const YT_CHANNELS_KEY = 'modules.youtube.config.channels';

async function ytFetchLatestVideos(channelId) {
  const xmlText = await window.matin.rss.fetchFeed(YT_RSS_BASE + channelId);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Flux YouTube invalide');

  // <yt:videoId> porte un préfixe d'espace de noms littéral dans le XML —
  // getElementsByTagName (pas querySelector) matche le nom qualifié tel quel,
  // même technique que itunes:duration dans podcast.js.
  return Array.from(doc.getElementsByTagName('entry')).map((entry) => {
    const videoId = entry.getElementsByTagName('yt:videoId')[0]?.textContent || '';
    return {
      videoId,
      title: entry.querySelector('title')?.textContent || '',
      published: entry.querySelector('published')?.textContent || '',
      link: entry.querySelector('link')?.getAttribute('href') || `https://www.youtube.com/watch?v=${videoId}`,
    };
  });
}

// Nombre d'entrées publiées dans les dernières 24h ET plus récentes que la
// dernière vidéo déjà vue (`lastSeenVideoId`) — le flux est trié du plus
// récent au plus ancien (convention Atom), donc tout ce qui précède
// `lastSeenVideoId` dans la liste est "nouveau". Si cette vidéo de référence
// n'apparaît plus dans le flux (sortie des ~15 entrées retournées), tout ce
// qui reste dans la fenêtre de 24h est considéré nouveau plutôt que 0 (mieux
// vaut un badge que du contenu manqué en silence).
function ytCountNewSince(entries, lastSeenVideoId, now) {
  const nowMs = now.getTime();
  const recent = entries.filter((e) => {
    const pubMs = new Date(e.published).getTime();
    return !Number.isNaN(pubMs) && (nowMs - pubMs) <= YT_NEW_WINDOW_MS;
  });
  const idx = recent.findIndex((e) => e.videoId === lastSeenVideoId);
  return idx === -1 ? recent.length : idx;
}

// "08:00" uniquement si l'heure/minute courante correspond EXACTEMENT à un
// des 6 créneaux fixes — le suffixe date (toDateString) rend le créneau
// unique par jour, pour ne jamais redéclencher le même le lendemain avec le
// même lastCheckSlot stocké.
function ytCurrentSlot(now) {
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return YT_FIXED_TIMES.includes(time) ? `${now.toDateString()} ${time}` : null;
}

function ytCellHtml(channel, idx, newCount, latest) {
  const avatarHtml = channel.avatar
    ? `<img class="youtube-cell-avatar" src="${channel.avatar}" alt="">`
    : `<div class="youtube-cell-avatar youtube-cell-avatar-fallback">🔔</div>`;
  const badgeHtml = newCount > 0 ? `<span class="youtube-cell-badge">${newCount}</span>` : '';
  const clickable = !!latest;

  return `
    <div class="youtube-cell${newCount > 0 ? ' youtube-cell-new' : ''}${clickable ? ' youtube-cell-clickable' : ''}"
         data-channel-idx="${idx}"
         ${clickable ? `data-video-url="${latest.link}" data-latest-id="${latest.videoId}"` : ''}>
      <div class="youtube-cell-avatar-wrap">
        ${avatarHtml}
        ${badgeHtml}
      </div>
      <span class="youtube-cell-name">${channel.title || channel.query}</span>
    </div>`;
}

function ytStartScheduler(refreshFn) {
  setInterval(async () => {
    const now = new Date();
    const slot = ytCurrentSlot(now);
    if (!slot) return;

    const lastSlot = await window.matin.store.get(YT_LAST_SLOT_KEY).catch(() => null);
    if (lastSlot === slot) return;

    await window.matin.store.set(YT_LAST_SLOT_KEY, slot);
    refreshFn().catch((err) => console.error('[YouTube] Erreur auto-refresh planifié', err));
  }, YT_SCHEDULE_CHECK_MS);
}

window.MatinModules.youtube = {
  async render(container, config, _google, setBadge) {
    const channels = (config?.channels || []).filter((c) => c.channelId);

    if (!channels.length) {
      container.innerHTML = `<div class="module-empty">Ajoutez une chaîne YouTube dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    async function loadAndRender() {
      setBadge('…');
      const now = new Date();
      const results = await Promise.allSettled(channels.map((ch) => ytFetchLatestVideos(ch.channelId)));
      let totalNew = 0;
      let baselineChanged = false;

      const cellsHtml = results.map((r, i) => {
        const ch = channels[i];
        if (r.status === 'rejected') {
          console.warn(`[YouTube] ${ch.title || ch.query} indisponible`, r.reason?.message);
          return ytCellHtml(ch, i, 0, null);
        }

        const entries = r.value;
        const latest = entries[0] || null;

        // Pas encore de référence pour cette chaîne (venant d'être ajoutée) :
        // on pose une base silencieuse plutôt que d'afficher tout l'historique
        // récent comme "nouveau" d'un coup.
        if (!ch.lastSeenVideoId && latest) {
          ch.lastSeenVideoId = latest.videoId;
          baselineChanged = true;
          return ytCellHtml(ch, i, 0, latest);
        }

        const newCount = ytCountNewSince(entries, ch.lastSeenVideoId, now);
        totalNew += newCount;
        return ytCellHtml(ch, i, newCount, latest);
      }).join('');

      container.innerHTML = `<div class="youtube-module-grid">${cellsHtml}</div>`;

      container.querySelectorAll('.youtube-cell-clickable').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = Number(el.dataset.channelIdx);
          const ch = channels[idx];
          const url = el.dataset.videoUrl;
          const latestId = el.dataset.latestId;
          if (url) window.matin.shell.openExternal(url);

          if (ch && latestId && ch.lastSeenVideoId !== latestId) {
            ch.lastSeenVideoId = latestId;
            window.matin.store.set(YT_CHANNELS_KEY, channels);
          }
          el.classList.remove('youtube-cell-new');
          el.querySelector('.youtube-cell-badge')?.remove();
        });
      });

      if (baselineChanged) {
        window.matin.store.set(YT_CHANNELS_KEY, channels);
      }

      setBadge(totalNew > 0 ? String(totalNew) : '—');
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    await loadAndRender();

    ytStartScheduler(loadAndRender);
  },
};
