/**
 * Module Indices boursiers — grille compacte de cours (indices actions +
 * matières premières), gratuit via l'API chart Yahoo Finance (même endpoint
 * que etf.js/crypto.js/currency.js), aucune clé.
 *
 * Logique de calcul du prix/variation journalière PORTÉE depuis
 * etfFetchYahooQuote (etf.js) plutôt que réécrite à neuf : cette fonction a
 * déjà été durcie en conditions réelles contre deux pièges concrets
 * rencontrés sur ce même endpoint (voir etf.js pour l'historique complet) —
 * (1) le dernier point du chart 5j n'inclut pas toujours la séance du jour
 * même marché ouvert, comparer aveuglément "dernier point = aujourd'hui"
 * décale alors le calcul d'un jour ; (2) un trou de données Yahoo (jour ouvré
 * sans clôture) peut faire remonter la référence "clôture veille" de
 * plusieurs jours sans avertissement. Contrairement à l'ETF, PAS de repli
 * Boursorama ici (pas de scraping pertinent pour un indice/une matière
 * première) : Yahoo est la seule source, un échec par symbole affiche juste
 * "—" pour cette tuile plutôt que de faire échouer toute la grille
 * (Promise.allSettled).
 *
 * Sélection affichée : config.selected (tableau de symboles) — `null`/absent
 * = tous les indices de IndicesDefs (indices-defs.js, partagé avec
 * config.js), narrowable dans Paramètres (voir indicesField, config.js).
 */
window.MatinModules = window.MatinModules || {};

const INDICES_REFRESH_MS = 5 * 60 * 1000;

async function indicesFetchChart(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const text = await window.matin.rss.fetchFeed(url);
  const data = JSON.parse(text);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Pas de données de marché');
  const closes = result.indicators?.quote?.[0]?.close || [];
  const timestamps = result.timestamp || [];
  const points = timestamps
    .map((t, i) => ({ date: new Date(t * 1000), close: closes[i] }))
    .filter(p => p.close != null);
  return { meta: result.meta || {}, points };
}

async function indicesFetchQuote(symbol) {
  const short = await indicesFetchChart(symbol, '5d', '1d');
  const currentPrice = short.meta.regularMarketPrice ?? short.points[short.points.length - 1]?.close ?? null;

  const now = new Date();
  const isSameDay = (d) => d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();

  const lastPoint = short.points[short.points.length - 1];
  const secondLastPoint = short.points[short.points.length - 2];
  const lastPointIsToday = isSameDay(lastPoint?.date);
  const previousClosePoint = lastPointIsToday ? secondLastPoint : lastPoint;
  const previousClose = previousClosePoint?.close ?? currentPrice;

  const changePct = previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0;

  return { currentPrice, changePct };
}

function indicesFmtValue(n) {
  if (n == null || Number.isNaN(n)) return '—';
  // 4 décimales pour les valeurs sous 10 (argent ~63€, mais un futur symbole
  // sous 10 resterait lisible) plutôt que 2 fixes partout — un indice à
  // 65606 (Nikkei) n'a pas besoin de décimales, un cours à 4,20 en perdrait
  // le sens arrondi à l'entier.
  const decimals = Math.abs(n) < 10 ? 4 : 2;
  return n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function indicesFmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + ' %';
}
function indicesGainClass(n) {
  return n == null ? '' : (n >= 0 ? 'up' : 'down');
}

function indicesTileHtml(def, quote) {
  const hasError = !quote || quote.currentPrice == null;
  return `
    <div class="indices-tile">
      <span class="indices-tile-label">${def.label}</span>
      <span class="indices-tile-value">${hasError ? '—' : indicesFmtValue(quote.currentPrice)}</span>
      <span class="indices-tile-pct ${hasError ? '' : indicesGainClass(quote.changePct)}">${hasError ? 'Indisponible' : indicesFmtPct(quote.changePct)}</span>
    </div>`;
}

window.MatinModules.indices = {
  async render(container, config, _google, setBadge) {
    const selectedSymbols = Array.isArray(config?.selected) ? config.selected : null;
    const defs = selectedSymbols
      ? window.IndicesDefs.filter(d => selectedSymbols.includes(d.symbol))
      : window.IndicesDefs;

    if (!defs.length) {
      container.innerHTML = `<div class="module-empty">Aucun indice sélectionné — choisissez-en dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    setBadge('…');
    try {
      const results = await Promise.allSettled(defs.map(d => indicesFetchQuote(d.symbol)));
      const quotes = results.map((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[Indices] ${defs[i].symbol} indisponible`, r.reason?.message);
          return null;
        }
        return r.value;
      });

      container.innerHTML = `<div class="indices-grid">${defs.map((d, i) => indicesTileHtml(d, quotes[i])).join('')}</div>`;

      const failed = quotes.filter(q => !q).length;
      setBadge(failed ? `⚠ ${failed}` : `${defs.length}`);
    } catch (err) {
      container.innerHTML = `<span class="module-error">Indices indisponibles</span>`;
      console.error('[Indices]', err);
      setBadge('⚠');
    }
  },
};
