/**
 * Module Crypto — portefeuille multi-lignes groupé par symbole (CoinGecko)
 *
 * Même architecture que le module ETF (voir etf.js) : lignes d'achat groupées
 * par identifiant (ici un symbole crypto plutôt qu'un ISIN), sparkline avec
 * marqueurs d'achat, PRU, portefeuille total. Le rendu réutilise volontairement
 * les classes CSS ".etf-*" (portée générique malgré le nom historique) pour
 * garantir un style strictement identique entre les deux modules sans dupliquer
 * la feuille de style.
 *
 * Source : CoinGecko, endpoints publics avec en-têtes CORS ouverts — fetch
 * direct depuis le renderer, pas besoin du proxy main process utilisé pour
 * Yahoo Finance/Boursorama (qui eux n'envoient pas de CORS).
 *
 * Résolution symbole → id CoinGecko : liste du top 100 par capitalisation
 * (mise en cache), avec repli sur /search pour les cryptos hors top 100.
 *
 * Limite de débit : l'API publique CoinGecko est strictement plafonnée (un
 * simple burst de 4-5 requêtes rapprochées suffit à déclencher un 429, avec un
 * cooldown qui dépasse largement 15s d'après nos tests). D'où : un seul appel
 * /coins/markets groupé pour TOUS les cours actuels (peu importe le nombre de
 * lignes), et un cache d'historique d'1h par crypto (le graphique n'a pas
 * besoin d'être aussi frais que le cours) pour ne pas re-solliciter
 * market_chart à chaque rafraîchissement de 5 minutes.
 */
window.MatinModules = window.MatinModules || {};

const CRYPTO_REFRESH_MS = 5 * 60 * 1000;
const CRYPTO_HISTORY_TTL_MS = 60 * 60 * 1000;
const cryptoIdCache = new Map(); // SYMBOL -> { id, name } | null
const cryptoHistoryCache = new Map(); // id -> { points, fetchedAt, days }
let cryptoTop100 = null; // [{ id, symbol, name }] — mis en cache pour toute la session

function cryptoFmtEUR(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function cryptoFmtSigned(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + cryptoFmtEUR(n);
}
function cryptoFmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + ' %';
}
function cryptoGainClass(n) {
  return n == null ? '' : (n >= 0 ? 'up' : 'down');
}

async function cryptoFetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

async function cryptoLoadTop100() {
  if (cryptoTop100) return cryptoTop100;
  const data = await cryptoFetchJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&order=market_cap_desc&per_page=100&page=1&sparkline=false');
  cryptoTop100 = data.map(c => ({ id: c.id, symbol: c.symbol.toUpperCase(), name: c.name }));
  return cryptoTop100;
}

async function cryptoResolveSymbol(symbol) {
  const key = symbol.toUpperCase();
  if (cryptoIdCache.has(key)) return cryptoIdCache.get(key);

  try {
    const top100 = await cryptoLoadTop100();
    const found = top100.find(c => c.symbol === key);
    if (found) {
      const resolved = { id: found.id, name: found.name };
      cryptoIdCache.set(key, resolved);
      return resolved;
    }
  } catch (err) {
    console.warn(`[Crypto] Résolution top 100 échouée pour ${symbol}`, err);
  }

  // Repli : recherche CoinGecko pour les cryptos hors du top 100
  try {
    const data = await cryptoFetchJSON(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`);
    const found = (data.coins || []).find(c => c.symbol?.toUpperCase() === key) || data.coins?.[0];
    if (found) {
      const resolved = { id: found.id, name: found.name };
      cryptoIdCache.set(key, resolved);
      return resolved;
    }
  } catch (err) {
    console.warn(`[Crypto] Recherche CoinGecko échouée pour ${symbol}`, err);
  }

  cryptoIdCache.set(key, null);
  return null;
}

// Fenêtre d'historique en fonction de l'achat le plus ancien du groupe (même
// logique que etfPickRange) — plafonnée à 365 jours : au-delà, l'API publique
// CoinGecko exige une clé payante.
function cryptoPickDays(groupLines) {
  const dates = groupLines.filter(l => l.date).map(l => new Date(l.date).getTime());
  if (!dates.length) return 30;
  const daysSince = Math.ceil((Date.now() - Math.min(...dates)) / 86400000);
  return Math.min(Math.max(daysSince + 2, 7), 365);
}

async function cryptoFetchHistory(id, days) {
  const cached = cryptoHistoryCache.get(id);
  if (cached && cached.days >= days && Date.now() - cached.fetchedAt < CRYPTO_HISTORY_TTL_MS) {
    return cached.points;
  }
  const data = await cryptoFetchJSON(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=eur&days=${days}`);
  const points = (data.prices || []).map(([t, price]) => ({ date: new Date(t), close: price }));
  cryptoHistoryCache.set(id, { points, fetchedAt: Date.now(), days });
  return points;
}

function cryptoBuildSparkline(points, buyDates) {
  const width = 600, height = 80, pad = 6;
  const closes = points.map(p => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1 || 1);

  const coords = points.map((p, i) => ({
    x: pad + i * stepX,
    y: pad + (height - pad * 2) * (1 - (p.close - min) / range),
    date: p.date,
  }));

  const linePoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const trendUp = closes[closes.length - 1] >= closes[0];
  const stroke = trendUp ? 'var(--accent-green)' : 'var(--accent-red)';

  const markerSvg = buyDates.map(buyDate => {
    let closest = coords[0], bestDiff = Infinity;
    for (const c of coords) {
      const diff = Math.abs(c.date - buyDate);
      if (diff < bestDiff) { bestDiff = diff; closest = c; }
    }
    return `<line x1="${closest.x.toFixed(1)}" y1="${pad}" x2="${closest.x.toFixed(1)}" y2="${height - pad}" class="etf-chart-marker-line"/>
            <circle cx="${closest.x.toFixed(1)}" cy="${closest.y.toFixed(1)}" r="3" class="etf-chart-marker-dot"/>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="etf-chart-svg">
    ${markerSvg}
    <polyline points="${linePoints}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

async function cryptoComputeGroups(lines) {
  const bySymbol = new Map();
  for (const line of lines) {
    const key = line.symbol.toUpperCase();
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key).push(line);
  }

  const symbols = Array.from(bySymbol.keys());
  const resolvedBySymbol = new Map();
  await Promise.all(symbols.map(async sym => {
    resolvedBySymbol.set(sym, await cryptoResolveSymbol(sym).catch(() => null));
  }));

  // Un seul appel /coins/markets groupé pour tous les cours actuels (économise
  // le quota de requêtes plutôt qu'un appel par crypto détenue).
  const ids = Array.from(new Set(Array.from(resolvedBySymbol.values()).filter(Boolean).map(r => r.id)));
  const marketBydId = new Map();
  if (ids.length) {
    try {
      const data = await cryptoFetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids=${ids.join(',')}&sparkline=false&price_change_percentage=24h`);
      for (const c of data) {
        marketBydId.set(c.id, { price: c.current_price, changePct: c.price_change_percentage_24h ?? null });
      }
    } catch (err) {
      console.warn('[Crypto] Cours indisponibles (limite de requêtes CoinGecko probable)', err);
    }
  }

  const groups = await Promise.all(Array.from(bySymbol.entries()).map(async ([symbol, groupLines]) => {
    const resolved = resolvedBySymbol.get(symbol);
    let name = symbol, currentPrice = null, changePct = null, points = [];

    if (resolved) {
      name = resolved.name || symbol;
      const market = marketBydId.get(resolved.id);
      currentPrice = market?.price ?? null;
      changePct = market?.changePct ?? null;
      try {
        const days = cryptoPickDays(groupLines);
        points = await cryptoFetchHistory(resolved.id, days);
      } catch (err) {
        console.warn(`[Crypto] Historique indisponible pour ${symbol}`, err);
      }
    }

    let totalQty = 0, invested = 0;
    for (const l of groupLines) {
      totalQty += l.qty;
      invested += l.qty * l.price + (l.fees || 0);
    }
    const pru = totalQty ? invested / totalQty : 0;
    const value = currentPrice != null ? totalQty * currentPrice : null;
    const gain = value != null ? value - invested : null;
    const gainPct = (gain != null && invested) ? (gain / invested) * 100 : null;

    return { symbol, name, currentPrice, changePct, points, lines: groupLines, totalQty, invested, pru, value, gain, gainPct };
  }));

  groups.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return groups;
}

function cryptoSumTotals(groups) {
  let invested = 0, value = 0, fees = 0, hasValue = false;
  for (const g of groups) {
    invested += g.invested;
    for (const l of g.lines) fees += (l.fees || 0);
    if (g.value != null) { value += g.value; hasValue = true; }
  }
  const gain = hasValue ? value - invested : null;
  const gainPct = (gain != null && invested) ? (gain / invested) * 100 : null;
  return { invested, value: hasValue ? value : null, gain, gainPct, fees };
}

function cryptoLineRowHtml(line, currentPrice) {
  const invested = line.qty * line.price + (line.fees || 0);
  const value = currentPrice != null ? line.qty * currentPrice : null;
  const gain = value != null ? value - invested : null;
  const gainPct = (gain != null && invested) ? (gain / invested) * 100 : null;
  return `
    <tr>
      <td>${line.date || '—'}</td>
      <td>${line.qty}</td>
      <td class="etf-money">${cryptoFmtEUR(line.price)}</td>
      <td class="etf-money">${cryptoFmtEUR(invested)}</td>
      <td class="etf-money">${value != null ? cryptoFmtEUR(value) : '—'}</td>
      <td class="etf-money ${cryptoGainClass(gain)}">${cryptoFmtSigned(gain)}${gainPct != null ? ` <span class="etf-line-gain-pct">(${cryptoFmtPct(gainPct)})</span>` : ''}</td>
    </tr>`;
}

function cryptoGroupHtml(g, expanded) {
  const sortedLines = [...g.lines].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const oldestFirst = [...g.lines].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const firstBuyPrice = oldestFirst[0]?.price ?? null;
  const buyDates = g.lines.filter(l => l.date).map(l => new Date(l.date));
  const chart = g.points.length > 1
    ? cryptoBuildSparkline(g.points, buyDates)
    : '<div class="etf-chart-empty">Historique indisponible</div>';

  return `
    <div class="etf-group">
      <div class="etf-group-header" data-symbol="${g.symbol}">
        <span class="etf-group-chevron ${expanded ? 'expanded' : ''}">▸</span>
        <span class="etf-group-name" title="${g.symbol}">${g.name}</span>
        <span class="etf-group-price">${g.currentPrice != null ? cryptoFmtEUR(g.currentPrice) : '—'}</span>
        <span class="etf-money etf-group-gain ${cryptoGainClass(g.gain)}">${cryptoFmtSigned(g.gain)}${g.gainPct != null ? ` (${cryptoFmtPct(g.gainPct)})` : ''}</span>
      </div>
      ${expanded ? `
      <div class="etf-group-body">
        <div class="etf-chart-wrap">
          ${chart}
          <div class="etf-chart-legend">
            <span>Prix achat : ${cryptoFmtEUR(firstBuyPrice)}</span>
            <span>Cours : ${g.currentPrice != null ? cryptoFmtEUR(g.currentPrice) : '—'}</span>
            <span>PRU : ${cryptoFmtEUR(g.pru)}</span>
          </div>
        </div>
        <div class="etf-table-wrap">
          <table class="etf-table">
            <thead><tr><th>Date</th><th>Qté</th><th>Px achat</th><th>Investi</th><th>Valeur</th><th>+/-</th></tr></thead>
            <tbody>
              ${sortedLines.map(l => cryptoLineRowHtml(l, g.currentPrice)).join('')}
              <tr class="etf-table-summary">
                <td colspan="2">Total</td>
                <td></td>
                <td class="etf-money">${cryptoFmtEUR(g.invested)}</td>
                <td class="etf-money">${g.value != null ? cryptoFmtEUR(g.value) : '—'}</td>
                <td class="etf-money ${cryptoGainClass(g.gain)}">${cryptoFmtSigned(g.gain)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

function cryptoRenderModule(container, groups, privacy) {
  const totals = cryptoSumTotals(groups);
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const primary = groups[0];
  const coursValue = primary?.currentPrice != null ? cryptoFmtEUR(primary.currentPrice) : '—';
  const coursSub = primary
    ? `${primary.changePct != null ? cryptoFmtPct(primary.changePct) : '—'}${groups.length > 1 ? ` · ${primary.name}` : ''}`
    : '';
  const coursClass = primary ? cryptoGainClass(primary.changePct) : '';

  container.innerHTML = `
    <div class="etf-module ${privacy ? 'etf-privacy-on' : ''}">
      <div class="etf-header">
        <div class="etf-header-block">
          <span class="etf-header-label">Cours</span>
          <span class="etf-header-value">${coursValue}</span>
          <span class="etf-header-sub ${coursClass}">${coursSub}</span>
        </div>
        <div class="etf-header-block">
          <span class="etf-header-label">Portefeuille</span>
          <span class="etf-money etf-header-value">${totals.value != null ? cryptoFmtEUR(totals.value) : '—'}</span>
          <span class="etf-header-sub">${groups.length} position${groups.length > 1 ? 's' : ''}</span>
        </div>
        <div class="etf-header-block">
          <span class="etf-header-label">Investi (frais inclus)</span>
          <span class="etf-money etf-header-value">${cryptoFmtEUR(totals.invested)}</span>
          <span class="etf-header-sub">dont ${cryptoFmtEUR(totals.fees)} de frais</span>
        </div>
        <div class="etf-header-block">
          <span class="etf-header-label">+/- Value</span>
          <span class="etf-money etf-header-value etf-gain ${cryptoGainClass(totals.gain)}">${cryptoFmtSigned(totals.gain)}</span>
          <span class="etf-header-sub ${cryptoGainClass(totals.gain)}">${totals.gainPct != null ? cryptoFmtPct(totals.gainPct) : '—'}</span>
        </div>
        <button class="etf-privacy-btn" title="${privacy ? 'Afficher les montants' : 'Masquer les montants'}">${privacy ? '🔒' : '🔓'}</button>
      </div>
      <div class="etf-groups">
        ${groups.map(g => cryptoGroupHtml(g, cryptoExpandedState.has(g.symbol))).join('')}
      </div>
      <div class="etf-footer">
        <span class="etf-updated">Mis à jour à ${now}</span>
        <button class="etf-refresh-btn">⟳ Rafraîchir</button>
      </div>
    </div>`;
}

// État d'affichage (groupes dépliés) — vit le temps du cycle de vie de la carte,
// remis à zéro à chaque rechargement du dashboard (rechargement de page).
let cryptoExpandedState = new Set();

window.MatinModules.crypto = {
  async render(container, config, _google, setBadge) {
    cryptoExpandedState = new Set();
    const lines = (config?.lines || []).filter(l => l.symbol);

    if (!lines.length) {
      container.innerHTML = `<div class="etf-empty">Aucune ligne configurée — ajoutez vos positions dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    let privacy = localStorage.getItem('matin-crypto-privacy') === '1';

    async function loadAndRender() {
      setBadge('…');
      console.log('[Crypto] Récupération des cours CoinGecko…');
      try {
        const groups = await cryptoComputeGroups(lines);
        cryptoRenderModule(container, groups, privacy);
        const totals = cryptoSumTotals(groups);
        setBadge(totals.gainPct != null ? cryptoFmtPct(totals.gainPct) : `${groups.length} ligne${groups.length > 1 ? 's' : ''}`);
      } catch (err) {
        console.error('[Crypto] Erreur de rendu', err);
        container.innerHTML = `<span class="module-error">⚠ Erreur de chargement</span>`;
        setBadge('⚠');
      }
    }

    container.addEventListener('click', (e) => {
      const groupHeader = e.target.closest('.etf-group-header');
      if (groupHeader) {
        const symbol = groupHeader.dataset.symbol;
        if (cryptoExpandedState.has(symbol)) cryptoExpandedState.delete(symbol);
        else cryptoExpandedState.add(symbol);
        loadAndRender();
        return;
      }
      if (e.target.closest('.etf-privacy-btn')) {
        privacy = !privacy;
        localStorage.setItem('matin-crypto-privacy', privacy ? '1' : '0');
        loadAndRender();
        return;
      }
      if (e.target.closest('.etf-refresh-btn')) {
        loadAndRender();
      }
    });

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    await loadAndRender();

    setInterval(() => {
      loadAndRender().catch(err => console.error('[Crypto] Erreur auto-refresh', err));
    }, CRYPTO_REFRESH_MS);
  },
};
