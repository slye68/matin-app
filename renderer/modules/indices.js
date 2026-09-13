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
 *
 * DÉLAI DE COURS — DIAGNOSTIQUÉ le 2026-09-01, sur demande explicite ("CAC 40
 * affiche 8366 mais la valeur actuelle du marché est ~8484") : vérifié en
 * accès réseau direct (curl, hors de l'app) sur ce même endpoint pour ^FCHI —
 * `regularMarketTime` renvoyé était systématiquement ~15-16 minutes derrière
 * l'heure réelle. Ce n'est PAS un bug de ce module (le calcul currentPrice/
 * changePct portait un prix et un timestamp parfaitement cohérents entre
 * eux) : c'est une caractéristique CONNUE et documentée de l'API Yahoo
 * Finance publique/non-authentifiée, qui n'offre jamais de cours réellement
 * temps réel gratuitement (~15-20 min de retard typique, même limite que
 * bien des widgets boursiers gratuits grand public). Un écart plus grand que
 * ce délai type au moment précis d'un signalement est plausible si le marché
 * bouge vite sur ces quelques minutes, mais reste la même cause : latence de
 * la source, pas un mauvais symbole/une mauvaise formule. Rendu visible à
 * l'utilisateur via `.indices-delay-note` sous la grille (voir render
 * plus bas) plutôt que caché — corrige la confusion "je pensais que c'était
 * en direct", pas le délai lui-même (indépassable sans API payante).
 *
 * Rythme de rafraîchissement RÉEL : PAS `INDICES_REFRESH_MS` (ancienne
 * constante ici, jamais réellement utilisée par ce fichier — retirée le
 * 2026-09-01 en diagnostiquant ce signalement, code mort trompeur) mais
 * `MODULE_REGISTRY.indices.refreshMs` dans dashboard.js (5 min, vérifié
 * inchangé) : `scheduleModuleRefresh` y pose un `setInterval` qui rappelle
 * `renderModuleOnce` — donc CE module (`render()` ci-dessous) toujours
 * réexécuté en entier, un fetch RÉSEAU FRAIS à chaque cycle, jamais de cache
 * interne à ce fichier qui pourrait à lui seul expliquer un chiffre plus
 * vieux que ~5 min + le délai Yahoo ci-dessus.
 *
 * RE-DIAGNOSTIQUÉ le 2026-09-10 (signalement "935 minutes de retard", refresh
 * soi-disant cassé) : mécanisme ci-dessus reconfirmé intact (aucun cache/TTL/
 * condition d'heures de marché ajoutés ni trouvés depuis). Un délai à 3
 * chiffres correspond à un marché FERMÉ (nuit, week-end, jour férié) — Yahoo
 * renvoie alors le `regularMarketTime` de la DERNIÈRE clôture, qui ne
 * rajeunit évidemment pas tant que le marché n'a pas rouvert, quelle que soit
 * la fréquence de rafraîchissement. `indicesFmtDelayNote` (plus bas)
 * distingue désormais ce cas ("Marché probablement fermé — dernière clôture
 * il y a Xh Ymin") du délai typique de quelques minutes en séance, pour ne
 * plus laisser croire à un rafraîchissement bloqué.
 */
window.MatinModules = window.MatinModules || {};

async function indicesFetchChart(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const text = await window.matin.rss.fetchFeed(url);
  const data = JSON.parse(text);
  // Réponse BRUTE complète loguée (2026-09-01, sur demande explicite,
  // "log the raw API response") — pas juste le `meta` déjà extrait plus bas,
  // pour pouvoir inspecter `indicators`/`timestamp` bruts en cas de nouveau
  // doute sur le calcul currentPrice/changePct.
  console.log(`[Indices] Réponse brute Yahoo pour ${symbol} (${url}) :`, data);
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

  // Diagnostic EXACT demandé (2026-09-01) — âge du cours en minutes calculé
  // depuis `regularMarketTime` (horodatage Yahoo du dernier prix connu, PAS
  // l'heure du fetch) : c'est ce nombre, pas un bug de calcul, qui explique
  // un cours "en retard" sur une valeur vue ailleurs au même instant.
  const quoteTime = short.meta.regularMarketTime ? new Date(short.meta.regularMarketTime * 1000) : null;
  const delayMin = quoteTime ? Math.round((now - quoteTime) / 60000) : null;
  console.log(`[Indices] ${symbol} — prix=${currentPrice}, veille=${previousClose}, variation=${changePct.toFixed(2)}%, horodatage Yahoo=${quoteTime?.toISOString() || '—'}, délai≈${delayMin ?? '?'} min`);

  return { currentPrice, changePct, delayMin };
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

// Libellé de la note de délai (2026-09-10, sur demande explicite — bug
// signalé : "935 minutes de retard", refresh soi-disant cassé). Investigation
// menée dans CE fichier : AUCUN cache/TTL/condition d'heures de marché
// n'existe ici, `render()` refait un fetch réseau complet à CHAQUE appel
// (Promise.allSettled ci-dessous, aucune variable de cache), et
// `MODULE_REGISTRY.indices.refreshMs` (dashboard.js, 5 min) déclenche bien ce
// `render()` toutes les 5 min sans interruption (voir scheduleModuleRefresh,
// dashboard.js — `setInterval` inconditionnel). `maxDelay` vient de
// `regularMarketTime`, un champ RENVOYÉ PAR YAHOO, jamais mis en cache
// localement — un delta de 935 min (~15h35) correspond exactement à une nuit
// complète marché fermé (ex. consulté le matin avant l'ouverture, dernière
// clôture = la veille au soir), pas à un rafraîchissement bloqué : re-fetcher
// plus souvent ne changerait RIEN, Yahoo renverrait le même `regularMarketTime`
// tant que le marché n'a pas rouvert. Modifier `refreshMs` aurait donc été un
// correctif sans effet sur ce symptôme précis — non appliqué. Seul changement
// réel : ce libellé, pour ne plus donner l'impression d'un bug quand le délai
// dépasse largement les ~15-20 min typiques de latence Yahoo déjà documentés
// plus haut (voir en-tête de fichier, diagnostic du 2026-09-01).
function indicesFmtDelayNote(minutes) {
  if (minutes <= 60) return `Cours différés (Yahoo Finance) — dernière donnée il y a ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const duration = m ? `${h} h ${m} min` : `${h} h`;
  return `Marché probablement fermé — dernière clôture connue il y a ${duration}`;
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

// ─── Crypto (2026-09-13, sur demande explicite) — sous-section séparée des
// indices boursiers ci-dessus (voir IndicesCryptoDefs, indices-defs.js). Un
// SEUL appel groupé pour les 5 actifs (endpoint CoinGecko `/simple/price`
// conçu pour ça, `ids=` accepte une liste séparée par virgules) — jamais un
// fetch par actif, et surtout jamais un setInterval séparé : cette fonction
// est appelée DEPUIS le render() ci-dessous, donc sur le même cycle que les
// indices boursiers (MODULE_REGISTRY.indices.refreshMs, dashboard.js — 5 min
// en pratique, pas les 30 min supposés dans la demande : voir l'en-tête de
// ce fichier pour la confirmation détaillée de cette valeur ; "même
// intervalle que les indices existants" reste respecté puisque RIEN n'est
// changé ici, la valeur réelle s'applique telle quelle aux 2 sections).
// Couleurs (#22c55e/#ef4444, demandées explicitement) et seuil neutre
// (|x| < 0.1%) DÉLIBÉRÉMENT distincts de indicesGainClass/--accent-green/
// --accent-red ci-dessus (utilisés par les indices boursiers, teintes et
// seuil différents) — classes CSS dédiées (.indices-crypto-*, voir
// style.css) pour ne rien changer à l'affichage boursier existant.
const INDICES_COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price'
  + '?ids=bitcoin,ethereum,tether,binancecoin,ripple'
  + '&vs_currencies=eur'
  + '&include_24hr_change=true'
  + '&include_market_cap=false';

async function indicesFetchCryptoPrices() {
  const text = await window.matin.rss.fetchFeed(INDICES_COINGECKO_URL);
  const data = JSON.parse(text);
  console.log('[Indices] Réponse brute CoinGecko :', data);
  return data;
}

function indicesCryptoGainClass(n) {
  if (n == null || Number.isNaN(n)) return '';
  if (Math.abs(n) < 0.1) return 'neutral';
  return n >= 0 ? 'up' : 'down';
}
function indicesCryptoArrow(n) {
  if (n == null || Number.isNaN(n)) return '→';
  if (Math.abs(n) < 0.1) return '→';
  return n >= 0 ? '▲' : '▼';
}

function indicesCryptoTileHtml(def, priceData) {
  const price = priceData?.eur;
  const changePct = priceData?.eur_24h_change;
  const hasError = price == null;
  return `
    <div class="indices-tile indices-crypto-tile">
      <span class="indices-tile-label">${def.icon} ${def.name}${def.name !== def.ticker ? ` (${def.ticker})` : ''}</span>
      <span class="indices-tile-value">${hasError ? '—' : `${indicesFmtValue(price)} €`}</span>
      <span class="indices-crypto-pct ${hasError ? '' : indicesCryptoGainClass(changePct)}">${hasError ? 'Indisponible' : `${indicesCryptoArrow(changePct)} ${indicesFmtPct(changePct)}`}</span>
    </div>`;
}

window.MatinModules.indices = {
  async render(container, config, _google, setBadge) {
    const selectedSymbols = Array.isArray(config?.selected) ? config.selected : null;
    const defs = selectedSymbols
      ? window.IndicesDefs.filter(d => selectedSymbols.includes(d.symbol))
      : window.IndicesDefs;

    // Crypto (2026-09-13) — sélection INDÉPENDANTE de `config.selected`
    // ci-dessus (voir config.js renderIndicesConfigSection) : absent/null =
    // toutes affichées, même convention que les indices boursiers.
    const selectedCrypto = Array.isArray(config?.selectedCrypto) ? config.selectedCrypto : null;
    const cryptoDefs = selectedCrypto
      ? window.IndicesCryptoDefs.filter(d => selectedCrypto.includes(d.id))
      : window.IndicesCryptoDefs;

    if (!defs.length && !cryptoDefs.length) {
      container.innerHTML = `<div class="module-empty">Aucun indice sélectionné — choisissez-en dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    setBadge('…');
    try {
      // Boursier (Yahoo) et crypto (CoinGecko) lancés EN PARALLÈLE — 2
      // sources indépendantes, mais UN SEUL cycle de rendu/rafraîchissement
      // (voir le commentaire d'indicesFetchCryptoPrices plus haut) : jamais
      // un 2e setInterval séparé pour la crypto.
      const [results, cryptoPrices] = await Promise.all([
        Promise.allSettled(defs.map(d => indicesFetchQuote(d.symbol))),
        cryptoDefs.length
          ? indicesFetchCryptoPrices().catch((err) => {
              console.error('[Indices] CoinGecko indisponible', err);
              return null;
            })
          : Promise.resolve(null),
      ]);
      const quotes = results.map((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[Indices] ${defs[i].symbol} indisponible`, r.reason?.message);
          return null;
        }
        return r.value;
      });

      // Note de délai (2026-09-01, sur demande explicite — rend visible ce
      // qui était jusqu'ici seulement dans les logs, voir en-tête de
      // fichier) : le PLUS GRAND délai parmi les tuiles affichées, pas une
      // moyenne — c'est la pire tuile qui doit fixer l'attente de
      // l'utilisateur sur la fraîcheur de TOUTE la grille. Ne porte QUE sur
      // les indices boursiers (Yahoo) — CoinGecko ne renvoie aucun
      // horodatage de cours dans cette réponse (`simple/price`), rien à
      // mesurer côté crypto.
      const delays = quotes.map(q => q?.delayMin).filter(d => d != null);
      const maxDelay = delays.length ? Math.max(...delays) : null;

      const cryptoFailed = !cryptoPrices;
      const cryptoSectionHtml = cryptoDefs.length ? `
        <div class="indices-crypto-section">
          <div class="indices-crypto-title">Crypto</div>
          <div class="indices-grid indices-crypto-grid">${cryptoDefs.map(d => indicesCryptoTileHtml(d, cryptoPrices?.[d.id])).join('')}</div>
        </div>` : '';

      container.innerHTML = `
        <div class="indices-module">
          ${defs.length ? `<div class="indices-grid">${defs.map((d, i) => indicesTileHtml(d, quotes[i])).join('')}</div>` : ''}
          ${cryptoSectionHtml}
          ${maxDelay != null ? `<div class="indices-delay-note">${indicesFmtDelayNote(maxDelay)}</div>` : ''}
        </div>
      `;

      const failed = quotes.filter(q => !q).length + (cryptoFailed ? cryptoDefs.length : 0);
      const total = defs.length + cryptoDefs.length;
      setBadge(failed ? `⚠ ${failed}` : `${total}`);
    } catch (err) {
      container.innerHTML = `<span class="module-error">Indices indisponibles</span>`;
      console.error('[Indices]', err);
      setBadge('⚠');
    }
  },
};
