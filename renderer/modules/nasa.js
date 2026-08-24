/**
 * Module NASA — photo astronomique du jour (APOD, Astronomy Picture Of the
 * Day), 2026-08-08 sur demande explicite.
 *
 * Fetch DIRECT depuis le renderer (pas via window.matin.rss.fetchFeed) : les
 * API api.nasa.gov envoient des en-têtes CORS ouverts (mêmes conditions que
 * l'auto-complétion CoinGecko dans config.js ou l'API People Google dans
 * birthdays.js) — aucun besoin du proxy process main réservé aux sites qui
 * bloquent les requêtes CORS.
 *
 * media_type : l'APOD n'est pas toujours une image — certains jours mettent
 * en avant une vidéo. `url` pointe alors déjà vers une URL d'embed YouTube
 * prête à l'emploi (vérifié en direct, voir nasaMediaHtml) : affichée dans
 * une vraie <iframe> 16:9, pas juste un lien texte. Repli "média non
 * affichable" uniquement si `media_type` est ni "image" ni "video" avec une
 * URL exploitable (cas non rencontré en pratique, mais l'API ne garantit rien).
 *
 * Clé API : DEMO_KEY intégrée en dur (2026-08-24, sur demande explicite —
 * remplace l'ancien champ `config.apiKey` configurable dans Paramètres →
 * Services, pré-rempli depuis NASA_API_KEY du .env) : zéro configuration
 * requise, fonctionne dès l'installation. DEMO_KEY reste limitée (30 req/h,
 * 50/j) — largement suffisant pour un refresh journalier de ce module, d'où
 * le message d'erreur dédié sur 403/429 plutôt qu'une erreur générique en cas
 * de dépassement exceptionnel (quota NASA partagé entre tous les usages de
 * DEMO_KEY dans le monde, pas seulement cette app).
 */
window.MatinModules = window.MatinModules || {};

const NASA_REFRESH_MS = 24 * 60 * 60 * 1000;
const NASA_APOD_URL = 'https://api.nasa.gov/planetary/apod';
// Clé publique NASA officielle, sans inscription (2026-08-24, sur demande
// explicite — voir le commentaire d'en-tête) : plus de champ configurable,
// cette clé est toujours celle utilisée.
const NASA_DEMO_KEY = 'DEMO_KEY';

// "2026-08-08" → "https://apod.nasa.gov/apod/ap260808.html" (format officiel
// de la page NASA : ap + AAMMJJ, année sur 2 chiffres) — construit localement
// plutôt qu'un lien renvoyé par l'API (le endpoint JSON n'en fournit aucun).
function nasaApodPageUrl(dateStr) {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'https://apod.nasa.gov/apod/astropix.html';
  return `https://apod.nasa.gov/apod/ap${m[1].slice(2)}${m[2]}${m[3]}.html`;
}

function nasaFormatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function nasaFetchApodOnce(apiKey, extraParams = '') {
  const res = await fetch(`${NASA_APOD_URL}?api_key=${encodeURIComponent(apiKey)}${extraParams}`);
  if (res.status === 403) throw new Error('Clé API NASA invalide');
  if (res.status === 429) throw new Error('Limite de requêtes NASA atteinte (réessaie plus tard)');
  if (!res.ok) throw new Error(`NASA APOD indisponible (${res.status})`);
  return res.json();
}

// 2e essai avec `&thumbs=true` demandé explicitement en repli si le 1er
// échoue (2026-08-10). NB : un vrai 503 est une panne CÔTÉ SERVEUR NASA
// touchant tout l'endpoint — peu de chances qu'un paramètre de requête
// supplémentaire y change quoi que ce soit, mais ça ne coûte qu'une requête
// de plus avant d'abandonner, et `thumbs=true` fournit en prime une image de
// remplacement (`thumbnail_url`) les jours vidéo, jamais renvoyée sans ce
// paramètre. Jamais retenté sur 403/429 : ce sont des échecs DÉFINITIFS (clé
// invalide / quota), pas transitoires — perdre une 2e requête dessus ne
// changerait rien.
async function nasaFetchApod(apiKey) {
  try {
    return await nasaFetchApodOnce(apiKey);
  } catch (err) {
    if (err.message.includes('Clé API') || err.message.includes('Limite de requêtes')) throw err;
    console.error('[NASA] Échec de la requête principale, nouvel essai avec thumbs=true', err);
    return await nasaFetchApodOnce(apiKey, '&thumbs=true');
  }
}

// Retire les balises HTML et décode les entités courantes de la page APOD —
// suffisant pour un texte descriptif simple (liens, gras), pas un parseur
// HTML général.
function nasaStripHtml(html) {
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“',
    '&mdash;': '—', '&ndash;': '–',
  };
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, m => entities[m] || m)
    .replace(/\s+/g, ' ')
    .trim();
}

// BUG NASA CONFIRMÉ le 2026-08-10 (signalé par l'utilisateur : "EA" manquant
// au début de "EACH") — vérifié en direct via un fetch brut hors de l'app
// (octets HTTP bruts inspectés, pas juste le JSON parsé) : le champ
// `explanation` de l'API JSON APOD est LUI-MÊME déjà tronqué à la source
// ("ch of these pairs..." au lieu de "Each of these pairs...", reproductible
// à l'identique sur 2 requêtes successives) — ce n'est PAS un bug
// d'extraction/rendu côté app (`explanation` est utilisé tel quel, aucun
// `.slice`/`.substring` nulle part dans ce fichier). En revanche, la page
// HTML officielle (`apod.nasa.gov/apod/apAAMMJJ.html`, déjà construite par
// `nasaApodPageUrl` pour le clic d'ouverture externe) contient le texte
// COMPLET et correct — vérifié sur le même jour. Cette fonction scrape cette
// page comme source d'autorité pour la description, avec repli sur le champ
// JSON (potentiellement tronqué mais mieux que rien) si le scraping échoue
// pour n'importe quelle raison (page pas encore publiée, structure changée,
// panne réseau). Fetch via `rss.fetchFeed` (proxy process main) et non
// `fetch()` direct : contrairement à `api.nasa.gov`, `apod.nasa.gov` n'envoie
// aucun en-tête CORS permissif (vérifié via `curl -I`), un fetch direct
// depuis le renderer serait bloqué.
async function nasaFetchFullExplanation(dateStr) {
  const html = await window.matin.rss.fetchFeed(nasaApodPageUrl(dateStr));
  const startMatch = html.match(/Explanation:\s*<\/b>/i);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const endMatch = html.slice(startIdx).match(/<p>\s*<center>/i);
  if (!endMatch) return null;
  const text = nasaStripHtml(html.slice(startIdx, startIdx + endMatch.index));
  // Garde-fou : une extraction ratée (structure de page inattendue) donnerait
  // un texte vide ou anormalement court plutôt qu'une erreur — mieux vaut
  // alors retomber sur le JSON que d'afficher un fragment inutile.
  return text.length > 20 ? text : null;
}

// media_type "video" : `data.url` de l'API APOD est déjà une URL d'embed
// YouTube prête à l'emploi (ex. "https://www.youtube.com/embed/XXXX?si=...")
// — vérifié en direct sur une vraie journée vidéo (2026-07-29, "Psyche
// Receives Gravity Assist from Mars") plutôt que supposé. Affichée dans une
// vraie <iframe> en 16:9 (comme demandé), pas juste un lien texte.
function nasaMediaHtml(data) {
  const isImage = data.media_type === 'image';
  const isVideo = data.media_type === 'video';
  const imgSrc = data.url || data.hdurl;

  if (isImage && imgSrc) {
    return `<img class="nasa-image" src="${imgSrc}" alt="${data.title || 'NASA APOD'}">`;
  }
  if (isVideo && data.url) {
    return `<div class="nasa-video-wrap"><iframe class="nasa-video" src="${data.url}" title="${data.title || 'NASA APOD video'}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  return `<div class="nasa-video-placeholder">🎬 Média du jour — clic pour l'ouvrir</div>`;
}

// Au-delà de cette longueur, la description est tronquée avec un bouton
// "Lire plus" plutôt que le `-webkit-line-clamp` fixe d'avant (3 lignes quoi
// qu'il arrive, sans aucun moyen de lire la suite) — demandé explicitement.
const NASA_EXPLANATION_PREVIEW_LEN = 300;

// `opts.stale` : les données affichées viennent du cache electron-store
// (dernière réussite), PAS d'un fetch qui vient de réussir — voir
// window.MatinModules.nasa.render. Affiche une bannière + un bouton
// "Réessayer" dédié (`opts.onRetry`) plutôt que de laisser croire que tout va
// bien. `opts.onRetry` est optionnel (absent quand les données sont fraîches).
function nasaRenderModule(container, data, opts = {}) {
  const pageUrl = nasaApodPageUrl(data.date);
  const isVideo = data.media_type === 'video';
  const explanation = (data.explanation || '').trim();
  const isLong = explanation.length > NASA_EXPLANATION_PREVIEW_LEN;
  // Repliée par défaut à chaque nouveau rendu (nouvelle photo du jour) —
  // aucune raison de retenir cet état d'un jour sur l'autre.
  let expanded = false;

  function paint() {
    const shownText = (!isLong || expanded)
      ? explanation
      : explanation.slice(0, NASA_EXPLANATION_PREVIEW_LEN).trimEnd() + '…';

    container.innerHTML = `
      <div class="nasa-module">
        ${opts.stale ? `
        <div class="nasa-stale-banner">
          <span>⚠ NASA indisponible — dernière photo en cache</span>
          <button type="button" class="nasa-retry-btn-inline">🔄 Réessayer</button>
        </div>` : ''}
        <div class="nasa-media">${nasaMediaHtml(data)}</div>
        <div class="nasa-body">
          <div class="nasa-date">${nasaFormatDate(data.date)}</div>
          <div class="nasa-title">${data.title || ''}</div>
          <div class="nasa-explanation">${shownText}</div>
          ${isLong ? `<button type="button" class="nasa-read-more">${expanded ? 'Lire moins' : 'Lire plus'}</button>` : ''}
        </div>
      </div>`;

    container.querySelector('.nasa-module').addEventListener('click', (e) => {
      if (e.target.closest('.nasa-retry-btn-inline')) {
        e.stopPropagation();
        opts.onRetry?.();
        return;
      }
      if (e.target.closest('.nasa-read-more')) {
        e.stopPropagation();
        expanded = !expanded;
        paint();
        return;
      }
      // Vidéo : laisser l'iframe YouTube gérer ses propres clics (lecture,
      // pause, plein écran...) plutôt que les intercepter pour ouvrir la page
      // APOD — seul un clic hors du lecteur (titre, description) ouvre la page.
      if (isVideo && e.target.closest('.nasa-video-wrap')) return;
      window.matin.shell.openExternal(pageUrl);
    });
  }

  paint();
}

// Aucune photo à afficher DU TOUT (échec ET aucun cache disponible) —
// message dédié plutôt qu'une carte vide, avec un bouton pour réessayer sans
// attendre le prochain refresh planifié (24h).
function nasaRenderFallback(container, onRetry) {
  container.innerHTML = `
    <div class="nasa-fallback">
      <div class="nasa-fallback-msg">📷 Photo du jour temporairement indisponible — NASA en maintenance</div>
      <button type="button" class="nasa-retry-btn">🔄 Réessayer</button>
    </div>`;
  container.querySelector('.nasa-retry-btn').addEventListener('click', onRetry);
}

window.MatinModules.nasa = {
  async render(container, _config, _google, setBadge) {
    const apiKey = NASA_DEMO_KEY;

    // Nouvelle tentative après un délai COURT en cas d'échec (5 min), plutôt
    // que de rester bloqué en erreur jusqu'au refresh planifié suivant (24h,
    // voir MODULE_REGISTRY dans dashboard.js) — l'API NASA renvoie
    // occasionnellement un 503 transitoire (constaté en conditions réelles
    // le 2026-08-08 : clé et API vérifiées valides et fonctionnelles juste
    // après coup), pas la peine d'attendre un jour entier pour une panne
    // ponctuelle qui se résout généralement d'elle-même en quelques minutes.
    // Pas de re-tentative en boucle indéfinie : un échec définitif (clé
    // invalide, 403) ou déjà réessayé une fois retombe simplement en erreur
    // affichée jusqu'au prochain refresh planifié.
    const NASA_RETRY_MS = 5 * 60 * 1000;
    let retried = false;

    async function loadAndRender() {
      setBadge('…');
      try {
        const data = await nasaFetchApod(apiKey);
        // Répare le champ `explanation` (voir nasaFetchFullExplanation) —
        // best-effort, ne doit jamais faire échouer tout le module si la
        // page HTML est indisponible ou d'une structure inattendue.
        try {
          const full = await nasaFetchFullExplanation(data.date);
          if (full) data.explanation = full;
        } catch (err) {
          console.error('[NASA] Échec de la récupération du texte complet — repli sur le champ JSON', err);
        }
        nasaRenderModule(container, data);
        setBadge(new Date(`${data.date}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
        retried = false;
        // Cache la dernière réussite pour un repli en cas de panne NASA (voir
        // le bloc catch ci-dessous) — best-effort, une écriture disque ratée
        // ne doit jamais faire échouer un affichage qui a par ailleurs réussi.
        window.matin.store.set('nasa.cache', {
          date: data.date, title: data.title, explanation: data.explanation,
          media_type: data.media_type, url: data.url, hdurl: data.hdurl,
        }).catch(err => console.error('[NASA] Échec de la mise en cache', err));
      } catch (err) {
        console.error('[NASA] Erreur de chargement', err);
        // Repli sur la dernière image mise en cache (2026-08-10, sur demande
        // explicite) plutôt qu'un message d'erreur nu — une vraie panne NASA
        // (503) ne prive alors l'utilisateur de rien de visible, juste d'une
        // mise à jour du jour. Aucun cache disponible (1er lancement, ou
        // jamais réussi une seule fois) → message dédié avec bouton Réessayer
        // (voir nasaRenderFallback) plutôt qu'une carte vide.
        const cached = await window.matin.store.get('nasa.cache').catch(() => null);
        if (cached) {
          nasaRenderModule(container, cached, { stale: true, onRetry: () => loadAndRender().catch(e => console.error('[NASA] Échec du nouvel essai manuel', e)) });
        } else {
          nasaRenderFallback(container, () => loadAndRender().catch(e => console.error('[NASA] Échec du nouvel essai manuel', e)));
        }
        setBadge('⚠');
        if (!retried) {
          retried = true;
          setTimeout(() => loadAndRender().catch(e => console.error('[NASA] Erreur de la nouvelle tentative', e)), NASA_RETRY_MS);
        }
      }
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    await loadAndRender();
  },
};
