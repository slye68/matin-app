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

      // Note de délai (2026-09-01, sur demande explicite — rend visible ce
      // qui était jusqu'ici seulement dans les logs, voir en-tête de
      // fichier) : le PLUS GRAND délai parmi les tuiles affichées, pas une
      // moyenne — c'est la pire tuile qui doit fixer l'attente de
      // l'utilisateur sur la fraîcheur de TOUTE la grille.
      const delays = quotes.map(q => q?.delayMin).filter(d => d != null);
      const maxDelay = delays.length ? Math.max(...delays) : null;

      container.innerHTML = `
        <div class="indices-module">
          <div class="indices-grid">${defs.map((d, i) => indicesTileHtml(d, quotes[i])).join('')}</div>
          ${maxDelay != null ? `<div class="indices-delay-note">${indicesFmtDelayNote(maxDelay)}</div>` : ''}
        </div>
      `;

      const failed = quotes.filter(q => !q).length;
      setBadge(failed ? `⚠ ${failed}` : `${defs.length}`);
    } catch (err) {
      container.innerHTML = `<span class="module-error">Indices indisponibles</span>`;
      console.error('[Indices]', err);
      setBadge('⚠');
    }
  },
};
