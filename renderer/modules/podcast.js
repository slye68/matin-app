/**
 * Module Podcasts — dernier épisode de chaque flux RSS podcast enregistré
 * (2026-08-08, sur demande explicite). Jusqu'à 10 flux, chacun avec un
 * libellé personnalisé (ex. "France Inter - Le 7/9") saisi en Paramètres.
 *
 * Un flux RSS podcast est un flux RSS classique (le premier <item> est
 * toujours le plus récent, convention universelle du format) — même
 * `window.matin.rss.fetchFeed` + DOMParser que les autres modules RSS de
 * l'app (voir rss-feed.js), pas de traitement spécifique "podcast" côté
 * process main nécessaire.
 *
 * Durée : lue depuis <itunes:duration>, format variable selon l'éditeur
 * (HH:MM:SS, MM:SS, ou secondes brutes en entier) — normalisée à l'affichage
 * (voir podcastFormatDuration). Absente chez certains éditeurs : affichage
 * omis plutôt qu'un "—" pour ne pas alourdir chaque ligne.
 *
 * Lien ouvert au clic : <link> de l'épisode (page de l'épisode chez
 * l'éditeur/la plateforme) en priorité — pas l'URL <enclosure> (fichier audio
 * brut), qui déclencherait un téléchargement/une lecture directe plutôt que
 * "l'épisode" tel que demandé ; repli sur <enclosure> si <link> est absent
 * (arrive chez certains flux minimalistes).
 */
window.MatinModules = window.MatinModules || {};

const PODCAST_REFRESH_MS = 6 * 60 * 60 * 1000;
const PODCAST_MAX_FEEDS = 10;

// "01:32:47" / "32:47" / "2847" (secondes brutes) → "1 h 32" / "32 min" /
// "47 min" — toujours arrondi à la minute la plus proche, une précision à la
// seconde n'apporte rien pour une ligne de résumé.
function podcastFormatDuration(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let totalSeconds;
  if (/^\d+$/.test(trimmed)) {
    totalSeconds = parseInt(trimmed, 10);
  } else {
    const parts = trimmed.split(':').map(n => parseInt(n, 10));
    if (parts.some(Number.isNaN)) return '';
    totalSeconds = parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  if (!totalSeconds || Number.isNaN(totalSeconds)) return '';

  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

function podcastFormatDate(pubDate) {
  if (!pubDate) return '';
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// itunes:duration porte un préfixe d'espace de noms littéral dans le XML —
// getElementsByTagName (pas querySelector, qui n'est pas fiable sur un nom
// préfixé dans un document XML générique) matche le nom qualifié tel quel.
function podcastReadItunesDuration(item) {
  const el = item.getElementsByTagName('itunes:duration')[0];
  return el?.textContent || '';
}

async function podcastFetchLatestEpisode(url) {
  const xmlText = await window.matin.rss.fetchFeed(url);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML invalide');

  const item = doc.querySelector('item');
  if (!item) throw new Error('Aucun épisode trouvé');

  const link = item.querySelector('link')?.textContent
    || item.querySelector('enclosure')?.getAttribute('url')
    || '';

  return {
    title: item.querySelector('title')?.textContent || 'Sans titre',
    pubDate: item.querySelector('pubDate')?.textContent || '',
    duration: podcastReadItunesDuration(item),
    link,
  };
}

function podcastRowHtml(feed, episode, error) {
  if (error) {
    return `
      <div class="podcast-row">
        <div class="podcast-row-main">
          <span class="podcast-row-label">${feed.label || feed.url}</span>
          <span class="module-error">Flux indisponible</span>
        </div>
      </div>`;
  }

  const dateStr = podcastFormatDate(episode.pubDate);
  const durationStr = podcastFormatDuration(episode.duration);
  return `
    <div class="podcast-row" data-link="${episode.link}">
      <div class="podcast-row-main">
        <span class="podcast-row-label">${feed.label || feed.url}</span>
        <span class="podcast-row-episode">${episode.title}</span>
        <span class="podcast-row-meta">${[dateStr, durationStr].filter(Boolean).join(' · ')}</span>
      </div>
    </div>`;
}

window.MatinModules.podcast = {
  async render(container, config, _google, setBadge) {
    const feeds = (config?.feeds || []).filter(f => f.url).slice(0, PODCAST_MAX_FEEDS);

    if (!feeds.length) {
      container.innerHTML = `<div class="module-empty">Ajoutez un flux podcast dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    async function loadAndRender() {
      setBadge('…');
      const results = await Promise.allSettled(feeds.map(feed => podcastFetchLatestEpisode(feed.url)));

      const rowsHtml = results.map((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[Podcast] ${feeds[i].url} indisponible`, r.reason?.message);
          return podcastRowHtml(feeds[i], null, true);
        }
        return podcastRowHtml(feeds[i], r.value, false);
      }).join('');

      container.innerHTML = `<div class="podcast-module"><div class="podcast-list">${rowsHtml}</div></div>`;

      container.querySelectorAll('.podcast-row[data-link]').forEach(el => {
        el.addEventListener('click', () => {
          const link = el.dataset.link;
          if (link) window.matin.shell.openExternal(link);
        });
      });

      const failed = results.filter(r => r.status === 'rejected').length;
      setBadge(failed ? `⚠ ${failed}` : `${feeds.length}`);
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    await loadAndRender();

    setInterval(() => {
      loadAndRender().catch(err => console.error('[Podcast] Erreur auto-refresh', err));
    }, PODCAST_REFRESH_MS);
  },
};
