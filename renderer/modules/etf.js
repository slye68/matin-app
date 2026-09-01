/**
 * Module ETF — portefeuille multi-lignes groupé par ISIN
 *
 * Source de PRIX : scraping Boursorama en PRIMAIRE depuis le 2026-08-05 (sur
 * demande explicite, bug réel constaté) — l'API chart Yahoo Finance, utilisée
 * en primaire jusque-là, s'est révélée renvoyer une variation journalière
 * fausse (signe et ampleur) pour des ISIN français à faible volume : un trou
 * d'un jour ouvré entier dans son historique de clôtures (voir la mécanique
 * déjà documentée dans etfFetchYahooQuote) décalait la référence "clôture
 * veille" de 2 jours, jusqu'à INVERSER le signe de la variation affichée par
 * rapport à la réalité (vérifié contre Boursorama : PAEEM à -0,45% réel,
 * Yahoo affichait +2,4x%). Yahoo reste résolu et utilisé, mais uniquement (1)
 * comme source du NOM/ticker affiché (sa résolution par recherche s'est
 * révélée fiable, seul son cours est en cause), et (2) comme repli complet
 * (prix + variation + historique) si Boursorama est indisponible pour un ISIN
 * donné, et (3) comme source de l'historique du graphique même quand
 * Boursorama fournit le prix (le scraping ne donne qu'un cours instantané,
 * pas un historique).
 *
 * Boursorama est atteint via une cascade jina.ai Reader → allorigins.win →
 * fetch direct (même ordre que le tableau de bord HTML de référence) : la
 * page Boursorama a déjà changé de structure sans préavis par le passé (voir
 * CONTEXT.md), la cascade de proxies est un filet contre un futur blocage
 * bot direct, pas contre un problème de CORS (le process main fetch sans
 * restriction CORS de toute façon). Chaque tentative logue la valeur brute
 * extraite pour permettre de vérifier la source en cas de doute.
 *
 * Toutes les requêtes passent par window.matin.rss.fetchFeed (proxy
 * générique côté process main, aucune restriction CORS là-bas).
 *
 * Config attendue : { lines: [{ isin, date, qty, price, fees }, ...] }
 * Les lignes partageant le même ISIN sont regroupées (achats successifs
 * du même ETF) avec un PRU (prix de revient unitaire) calculé sur le total.
 */
window.MatinModules = window.MatinModules || {};

// Icône du bouton confidentialité (2026-09-01, sur demande explicite,
// remplace 🔒/🔓 par une icône œil — ETF/Crypto/Prêts seulement, voir
// style.css .etf-privacy-btn) : 👁️ (emoji, demandé explicitement) quand les
// montants sont VISIBLES, sinon ce SVG "œil barré" (demandé explicitement,
// "clean SVG eye icon with a diagonal line through it") — `currentColor`
// pour suivre color/hover de .etf-privacy-btn comme le ferait un glyphe
// texte normal. Même constante dupliquée à l'identique dans crypto.js/
// prets.js (point 5 : cohérence entre les 3 modules) plutôt qu'un import
// partagé — ces 3 fichiers dupliquent déjà le reste du bouton lui-même de la
// même façon, pas de nouvelle dépendance inter-fichiers pour si peu.
const PRIVACY_EYE_OFF_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
function privacyIconHtml(privacy) {
  return privacy ? PRIVACY_EYE_OFF_SVG : '👁️';
}

const ETF_REFRESH_MS = 5 * 60 * 1000;
const etfYahooCache = new Map();       // isin -> { symbol, name } | null (nom/ticker + repli/historique)
const etfBoursoramaPathCache = new Map(); // isin -> path Boursorama (ex. "1rTESE") | null

function etfFmtEUR(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function etfFmtSigned(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + etfFmtEUR(n);
}
function etfFmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + ' %';
}
function etfGainClass(n) {
  return n == null ? '' : (n >= 0 ? 'up' : 'down');
}

// Flèche de variation journalière (2026-08-10, sur demande explicite) — même
// convention que etfGainClass (>=0 traité comme "up").
function etfDailyArrow(n) {
  if (n == null) return '';
  return n >= 0 ? '↑' : '↓';
}

async function etfFetchJSON(url) {
  const text = await window.matin.rss.fetchFeed(url);
  return JSON.parse(text);
}

// Résolution Yahoo — sert désormais uniquement au nom/ticker affiché et au
// repli/historique (voir en-tête du fichier), plus au cours principal.
async function etfResolveYahooSymbol(isin) {
  if (etfYahooCache.has(isin)) return etfYahooCache.get(isin);

  try {
    const data = await etfFetchJSON(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}`);
    const quotes = data.quotes || [];
    const quote = quotes.find(q => q.isYahooFinance && q.symbol) || quotes[0];
    if (quote) {
      const resolved = { symbol: quote.symbol, name: quote.shortname || quote.longname || quote.symbol };
      etfYahooCache.set(isin, resolved);
      return resolved;
    }
  } catch (err) {
    console.warn(`[ETF] Résolution Yahoo échouée pour ${isin}`, err);
  }

  etfYahooCache.set(isin, null);
  return null;
}

// Résolution Boursorama — recherche du "path" interne à partir de l'ISIN
// (ex. "1rTESE" pour FR0011550185). L'URL de résultat n'est pas "/cours/
// {path}/" mais préfixée par catégorie d'instrument (ex. "/bourse/trackers/
// cours/{path}/" pour un ETF) — vérifié le 2026-08-04, on matche donc
// n'importe quel préfixe. Un même ISIN peut avoir plusieurs cotations
// (Euronext, Xetra...) : on garde la première trouvée par la recherche
// Boursorama elle-même (déjà triée par pertinence côté serveur).
async function etfResolveBoursoramaPath(isin) {
  if (etfBoursoramaPathCache.has(isin)) return etfBoursoramaPathCache.get(isin);

  try {
    const html = await window.matin.rss.fetchFeed(`https://www.boursorama.com/recherche/ajax?query=${encodeURIComponent(isin)}`);
    const match = html.match(/href="[^"]*\/cours\/([^"/]+)\/"/);
    const path = match ? match[1] : null;
    etfBoursoramaPathCache.set(isin, path);
    return path;
  } catch (err) {
    console.warn(`[ETF] Résolution Boursorama échouée pour ${isin}`, err);
    etfBoursoramaPathCache.set(isin, null);
    return null;
  }
}

// Choisit la fenêtre d'historique à récupérer en fonction de la date d'achat
// la plus ancienne du groupe — sans ça, un achat de 2024 avec un graphique
// figé sur 1 mois collapse son marqueur sur le bord gauche du graphique.
function etfPickRange(groupLines) {
  const dates = groupLines.filter(l => l.date).map(l => new Date(l.date).getTime());
  if (!dates.length) return { range: '1mo', interval: '1d' };
  const daysSince = (Date.now() - Math.min(...dates)) / 86400000;
  if (daysSince <= 25)  return { range: '1mo', interval: '1d' };
  if (daysSince <= 80)  return { range: '3mo', interval: '1d' };
  if (daysSince <= 170) return { range: '6mo', interval: '1d' };
  if (daysSince <= 350) return { range: '1y',  interval: '1d' };
  if (daysSince <= 700) return { range: '2y',  interval: '1wk' };
  if (daysSince <= 1800) return { range: '5y', interval: '1mo' };
  return { range: 'max', interval: '1mo' };
}

async function etfFetchChart(symbol, range, interval) {
  const data = await etfFetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Pas de données de marché');
  const closes = result.indicators?.quote?.[0]?.close || [];
  const timestamps = result.timestamp || [];
  const points = timestamps
    .map((t, i) => ({ date: new Date(t * 1000), close: closes[i] }))
    .filter(p => p.close != null);
  return { meta: result.meta || {}, points };
}

async function etfFetchYahooQuote(resolved, range, interval) {
  // Cours + variation journalière : sur un fetch COURT dédié (5 jours, clôtures
  // quotidiennes), indépendant de la fenêtre utilisée pour le graphique.
  // meta.chartPreviousClose n'est PAS la clôture de la veille : sa valeur varie
  // avec le paramètre "range" lui-même (vérifié : ~33.16 en range=1mo vs ~28.08
  // en range=1y pour le même titre au même instant) — c'est ce qui causait des
  // variations journalières fantaisistes dès qu'un achat ancien forçait une
  // fenêtre d'historique longue.
  //
  // Piège découvert en débogant une variation incohérente : le tableau de
  // clôtures quotidiennes n'inclut PAS toujours un point pour la séance du
  // jour même quand le marché est ouvert (dépend du moment où Yahoo a traité
  // la journée en cours) — vérifié en comparant deux appels à quelques heures
  // d'écart sur le même titre : l'un se terminait sur la séance du jour,
  // l'autre s'arrêtait déjà sur la clôture de la veille. Supposer que "le
  // dernier point = aujourd'hui" sans le vérifier décalait alors le calcul
  // d'un jour (variation vs avant-hier au lieu de vs hier). On compare donc
  // explicitement la date du dernier point à la date du jour.
  const short = await etfFetchChart(resolved.symbol, '5d', '1d');
  const currentPrice = short.meta.regularMarketPrice ?? short.points[short.points.length - 1]?.close ?? null;

  const now = new Date();
  const isSameDay = (d) => d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();

  const lastPoint = short.points[short.points.length - 1];
  const secondLastPoint = short.points[short.points.length - 2];
  const lastPointIsToday = isSameDay(lastPoint?.date);
  const previousClosePoint = lastPointIsToday ? secondLastPoint : lastPoint;
  const previousClose = previousClosePoint?.close ?? currentPrice;

  const changePct = previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0;

  // Détecte un TROU dans les données Yahoo (jour ouvré sans clôture — pas un
  // week-end) : le point utilisé comme "clôture de la veille" est alors plus
  // vieux que la veille réelle, et le % affiché reflète un changement sur
  // PLUSIEURS jours plutôt qu'une vraie variation journalière — faute de
  // mieux, Yahoo n'a tout simplement pas la donnée du/des jour(s) manquant(s)
  // (vérifié : absent même en demandant une fenêtre d'1 mois, donc pas un
  // artefact de la fenêtre courte utilisée ici).
  //
  // Seuil corrigé le 2026-08-05 : `> 3` jours calendaires laissait passer un
  // trou d'UN SEUL jour ouvré sans avertissement — repéré en déboguant une
  // variation "+2.47%" jugée trop élevée sur PAEEM.PA, dont les logs ont
  // montré une référence prise un lundi pour un calcul un mercredi (le mardi
  // intermédiaire absent des données Yahoo, un jour ouvré normal, pas un
  // jour férié identifié) — soit 2 jours calendaires d'écart, sous le seuil
  // précédent. En pratique, entre deux clôtures sur jours ouvrés, seuls 2
  // écarts sont normaux : 1 jour (jours consécutifs) ou 3 jours (vendredi →
  // lundi) ; tout le reste indique un trou.
  if (previousClosePoint && lastPointIsToday) {
    const gapDays = Math.round((lastPoint.date - previousClosePoint.date) / 86400000);
    if (gapDays !== 1 && gapDays !== 3) {
      console.warn(`[ETF] ${resolved.symbol} — TROU de données Yahoo détecté : ${gapDays} jours entre la référence utilisée (${previousClosePoint.date.toISOString().slice(0, 10)}) et aujourd'hui (${lastPoint.date.toISOString().slice(0, 10)}). Le % affiché reflète le changement depuis cette date, pas depuis "hier" — Yahoo n'a pas de clôture pour le(s) jour(s) intermédiaire(s) (vérifié : absent même sur une fenêtre d'1 mois, se corrige généralement de lui-même une fois Yahoo comble le trou côté serveur).`);
    }
  }

  // Écart (en jours) entre la référence utilisée et aujourd'hui, toujours
  // logué (pas seulement au-delà du seuil de 3j ci-dessus) — permet de
  // vérifier d'un coup d'œil si "clôture veille" est vraiment hier (ou
  // vendredi un lundi) plutôt que de devoir recalculer à la main à partir
  // des dates ISO. Complété par les points bruts du chart 5j pour voir
  // exactement quelles données Yahoo a renvoyées derrière le calcul.
  const refGapDays = previousClosePoint ? Math.round((now - previousClosePoint.date) / 86400000) : null;
  console.log(`[ETF] ${resolved.symbol} — dernier point du graphique: ${lastPoint?.date?.toISOString?.() ?? 'aucun'} (${lastPointIsToday ? 'séance du jour, en cours' : 'déjà une clôture complète'})`);
  console.log(`[ETF] ${resolved.symbol} — cours actuel: ${currentPrice}, clôture veille utilisée: ${previousClose} (du ${previousClosePoint?.date?.toISOString?.() ?? 'n/a'}, il y a ${refGapDays ?? '?'} jour(s)), variation: ${changePct.toFixed(2)}%`);
  console.log(`[ETF] ${resolved.symbol} — points bruts (chart 5j) :`, short.points.map(p => ({ date: p.date.toISOString().slice(0, 10), close: p.close })));

  // Historique pour le graphique : la fenêtre longue calculée par etfPickRange
  // (peut couvrir des années si les achats sont anciens) — refetch séparé pour
  // ne pas polluer le calcul de variation journalière ci-dessus.
  const history = (range === '5d' && interval === '1d') ? short : await etfFetchChart(resolved.symbol, range, interval);

  return { currentPrice, changePct, points: history.points };
}

// Extrait prix + variation depuis le HTML brut (fetch direct ou via
// allorigins, qui renvoie le HTML tel quel) — structure vérifiée le
// 2026-08-04 : data-ist-last/data-ist-variation sont des attributs booléens
// SANS valeur, le prix/la variation sont le CONTENU TEXTE du <span> (ancien
// format : data-ist-last="32.49" ; nouveau : <span data-ist-last>32,49</span>).
// Plusieurs blocs de la page portent ces attributs (widget "à la une" du
// bandeau du haut inclus, avec d'autres instruments) — on cible le bloc
// "c-faceplate__values" (le cours principal affiché sous le titre "Cours" de
// la page) pour ne pas récupérer par erreur la valeur d'un autre instrument.
function etfParseBoursoramaHtml(html) {
  const faceplateMatch = html.match(/c-faceplate__values[\s\S]{0,600}/);
  const section = faceplateMatch ? faceplateMatch[0] : html;

  const priceMatch = section.match(/data-ist-last[^>]*>([^<]+)</);
  const varMatch = section.match(/data-ist-variation[^>]*>([^<]+)</);
  if (!priceMatch) throw new Error('Cours Boursorama introuvable (HTML)');

  const currentPrice = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
  const changePct = varMatch ? parseFloat(varMatch[1].replace('%', '').replace(',', '.')) : 0;
  if (Number.isNaN(currentPrice)) throw new Error('Prix Boursorama invalide (HTML)');
  return { currentPrice, changePct, rawPrice: priceMatch[1], rawPct: varMatch?.[1] ?? null };
}

// Extrait prix + variation depuis le rendu Markdown de jina.ai Reader — le
// titre de la page y embarque un lien de la forme "[Nom du fonds 35,20
// -0,45%](https://www.boursorama.com/...)" ; on ancre le motif sur ce lien
// Boursorama pour ne pas confondre avec un autre nombre du texte.
function etfParseBoursoramaJina(text) {
  const m = text.match(/(\d+[.,]\d+)\s+([+-]?\d+[.,]\d+)%\]\(https:\/\/www\.boursorama\.com/);
  if (!m) throw new Error('Cours Boursorama introuvable (jina.ai)');

  const currentPrice = parseFloat(m[1].replace(',', '.'));
  const changePct = parseFloat(m[2].replace(',', '.'));
  if (Number.isNaN(currentPrice)) throw new Error('Prix Boursorama invalide (jina.ai)');
  return { currentPrice, changePct: Number.isNaN(changePct) ? 0 : changePct, rawPrice: m[1], rawPct: m[2] };
}

// Cascade jina.ai Reader → allorigins.win → fetch direct (même ordre que le
// tableau de bord HTML de référence) — pas un contournement CORS (le process
// main fetch sans restriction de toute façon, voir window.matin.rss.fetchFeed),
// mais un filet contre un futur blocage bot direct de Boursorama (déjà vécu
// sur un autre site du catalogue, voir CONTEXT.md "Eurosport retiré"). Logue
// systématiquement la valeur brute extraite par la méthode qui a réussi, pour
// pouvoir vérifier la source des données en cas de doute.
async function etfFetchBoursoramaQuoteCascade(path) {
  const targetUrl = `https://www.boursorama.com/bourse/trackers/cours/${path}/`;
  const attempts = [
    { method: 'jina.ai', url: `https://r.jina.ai/${targetUrl}`, parse: etfParseBoursoramaJina },
    { method: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, parse: etfParseBoursoramaHtml },
    { method: 'direct', url: targetUrl, parse: etfParseBoursoramaHtml },
  ];

  let lastErr = new Error('Aucune méthode Boursorama disponible');
  for (const { method, url, parse } of attempts) {
    try {
      const raw = await window.matin.rss.fetchFeed(url);
      const { currentPrice, changePct, rawPrice, rawPct } = parse(raw);
      console.log(`[ETF] Boursorama ${path} via ${method} — brut extrait: prix="${rawPrice}" variation="${rawPct}" → prix=${currentPrice}, variation=${changePct}%`);
      return { currentPrice, changePct, points: [] };
    } catch (err) {
      console.warn(`[ETF] Boursorama ${path} via ${method} échoué`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

function etfBuildSparkline(points, buyDates) {
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

// Vente : méthode du coût moyen (PRU), pas du FIFO — le PRU est calculé une
// fois sur la totalité des achats (jamais réduit par une vente) puis réutilisé
// tel quel pour chiffrer le gain réalisé de CHAQUE vente. Plus simple qu'un
// FIFO par lot et suffisant ici (pas de suivi fiscal fin par lot demandé).
async function etfComputeGroups(lines) {
  const byIsin = new Map();
  for (const line of lines) {
    if (!byIsin.has(line.isin)) byIsin.set(line.isin, []);
    byIsin.get(line.isin).push(line);
  }

  const groups = await Promise.all(Array.from(byIsin.entries()).map(async ([isin, groupLines]) => {
    const buyLines = groupLines.filter(l => l.type !== 'sell');
    const sellLines = groupLines.filter(l => l.type === 'sell');

    let totalBought = 0, invested = 0;
    for (const l of buyLines) {
      totalBought += l.qty;
      invested += l.qty * l.price + (l.fees || 0);
    }
    const pru = totalBought ? invested / totalBought : 0;

    let totalSold = 0, realizedGain = 0;
    for (const l of sellLines) {
      totalSold += l.qty;
      realizedGain += (l.price - pru) * l.qty - (l.fees || 0);
    }
    const remainingQty = totalBought - totalSold;
    // Épsilon plutôt que `=== 0` : qty est saisie en step 0.0001, une somme
    // achats/ventes flottante tombe rarement pile sur 0 binaire exact.
    const closed = remainingQty <= 1e-9;

    let name = isin, symbol = null, currentPrice = null, changePct = null, points = [];

    // Nom/ticker affiché : toujours tenté via Yahoo (résolution par recherche
    // fiable — seul le COURS renvoyé par son API chart s'est révélé faux pour
    // ces ISIN français, voir en-tête du fichier). Best-effort : un échec ici
    // n'empêche pas d'avoir un prix via Boursorama juste en dessous, juste un
    // nom moins joli (l'ISIN brut).
    let yahooResolved = null;
    try {
      yahooResolved = await etfResolveYahooSymbol(isin);
      if (yahooResolved) { name = yahooResolved.name || isin; symbol = yahooResolved.symbol; }
    } catch (err) {
      console.warn(`[ETF] Résolution Yahoo (nom) échouée pour ${isin}`, err);
    }

    // Position clôturée (plus aucune part détenue) : on saute complètement la
    // résolution/le fetch du cours — un prix en direct n'a plus de sens sans
    // parts détenues, et c'est un appel réseau inutile à chaque auto-refresh
    // (5 min). Le nom/ticker reste résolu juste au-dessus pour un affichage
    // propre plutôt que l'ISIN brut.
    if (!closed) {
      // Cours : Boursorama en source PRIMAIRE (voir en-tête du fichier).
      let usedBoursorama = false;
      const boursoramaPath = await etfResolveBoursoramaPath(isin);
      if (boursoramaPath) {
        try {
          const quote = await etfFetchBoursoramaQuoteCascade(boursoramaPath);
          currentPrice = quote.currentPrice;
          changePct = quote.changePct;
          usedBoursorama = true;
        } catch (err) {
          console.warn(`[ETF] Boursorama indisponible pour ${isin} (${boursoramaPath})`, err);
        }
      }

      if (yahooResolved) {
        const { range, interval } = etfPickRange(groupLines);
        if (usedBoursorama) {
          // Cours déjà fiable (Boursorama) — Yahoo n'est sollicité ici que pour
          // l'historique du graphique, JAMAIS pour le prix/la variation qu'il
          // renvoie (c'est justement cette donnée qui s'est révélée fausse).
          try {
            const history = await etfFetchChart(yahooResolved.symbol, range, interval);
            points = history.points;
          } catch (err) {
            console.warn(`[ETF] Historique Yahoo indisponible pour ${isin} (graphique vide)`, err);
          }
        } else {
          // Boursorama indisponible : repli complet sur Yahoo (prix + variation
          // + historique), quitte à hériter du bug de trou de données documenté
          // dans etfFetchYahooQuote — mieux qu'aucune donnée du tout.
          try {
            const quote = await etfFetchYahooQuote(yahooResolved, range, interval);
            currentPrice = quote.currentPrice;
            changePct = quote.changePct;
            points = quote.points;
          } catch (err) {
            console.warn(`[ETF] Cours indisponible pour ${isin} (Yahoo aussi en échec)`, err);
          }
        }
      }
    }

    // Clôturé : valeur et gain latent connus et nuls par définition (0 part
    // détenue), jamais `null` — sinon un groupe clôturé disparaîtrait par
    // erreur des totaux du portefeuille (voir etfSumTotals) au lieu d'y
    // contribuer pour 0, alors qu'un groupe OUVERT dont le cours est
    // indisponible doit lui rester `null` (valeur réellement inconnue).
    const unrealizedGain = closed ? 0 : (currentPrice != null ? (currentPrice - pru) * remainingQty : null);
    const value = closed ? 0 : (currentPrice != null ? remainingQty * currentPrice : null);
    const totalGain = unrealizedGain != null ? realizedGain + unrealizedGain : null;
    const gainPct = (totalGain != null && invested) ? (totalGain / invested) * 100 : null;

    return {
      isin, name, symbol, currentPrice, changePct, points, lines: groupLines,
      totalBought, totalSold, remainingQty, closed,
      invested, pru, realizedGain, unrealizedGain, value, totalGain, gainPct,
    };
  }));

  groups.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return groups;
}

function etfSumTotals(groups) {
  let invested = 0, value = 0, fees = 0, realizedGain = 0, unrealizedGain = 0;
  // Reste vrai tant qu'aucun groupe OUVERT n'a de cours indisponible — un
  // groupe clôturé (unrealizedGain/value = 0, jamais null) ne le fait jamais
  // basculer à false, voir le commentaire dans etfComputeGroups.
  let hasFullValue = true;
  for (const g of groups) {
    invested += g.invested;
    for (const l of g.lines) fees += (l.fees || 0);
    realizedGain += g.realizedGain;
    if (g.unrealizedGain != null) {
      unrealizedGain += g.unrealizedGain;
      value += g.value;
    } else {
      hasFullValue = false;
    }
  }
  const totalGain = hasFullValue ? realizedGain + unrealizedGain : null;
  const gainPct = (totalGain != null && invested) ? (totalGain / invested) * 100 : null;
  return {
    invested,
    value: hasFullValue ? value : null,
    realizedGain,
    unrealizedGain: hasFullValue ? unrealizedGain : null,
    totalGain,
    gainPct,
    fees,
  };
}

function etfTypeBadgeHtml(isSell) {
  return `<span class="etf-type-badge ${isSell ? 'sell' : 'buy'}">${isSell ? 'Vente' : 'Achat'}</span>`;
}

// `pru` (coût moyen du groupe, achats uniquement) n'est utile que pour une
// ligne de vente — le gain réalisé de CETTE vente se chiffre contre le PRU du
// groupe, pas contre un prix d'achat individuel (voir etfComputeGroups).
function etfLineRowHtml(line, currentPrice, pru) {
  const isSell = line.type === 'sell';

  if (isSell) {
    const proceeds = line.qty * line.price - (line.fees || 0);
    const realized = (line.price - pru) * line.qty - (line.fees || 0);
    return `
      <tr class="etf-row-sell">
        <td>${line.date || '—'}</td>
        <td>${etfTypeBadgeHtml(true)}</td>
        <td>-${line.qty}</td>
        <td class="etf-money">${etfFmtEUR(line.price)}</td>
        <td class="etf-money">${etfFmtEUR(proceeds)}</td>
        <td>—</td>
        <td class="etf-money ${etfGainClass(realized)}">${etfFmtSigned(realized)}</td>
      </tr>`;
  }

  const invested = line.qty * line.price + (line.fees || 0);
  const value = currentPrice != null ? line.qty * currentPrice : null;
  const gain = value != null ? value - invested : null;
  const gainPct = (gain != null && invested) ? (gain / invested) * 100 : null;
  return `
    <tr>
      <td>${line.date || '—'}</td>
      <td>${etfTypeBadgeHtml(false)}</td>
      <td>${line.qty}</td>
      <td class="etf-money">${etfFmtEUR(line.price)}</td>
      <td class="etf-money">${etfFmtEUR(invested)}</td>
      <td class="etf-money">${value != null ? etfFmtEUR(value) : '—'}</td>
      <td class="etf-money ${etfGainClass(gain)}">${etfFmtSigned(gain)}${gainPct != null ? ` <span class="etf-line-gain-pct">(${etfFmtPct(gainPct)})</span>` : ''}</td>
    </tr>`;
}

function etfGroupHtml(g, expanded) {
  const sortedLines = [...g.lines].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const oldestFirst = [...g.lines].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const firstBuyPrice = oldestFirst.find(l => l.type !== 'sell')?.price ?? null;
  const buyDates = g.lines.filter(l => l.date && l.type !== 'sell').map(l => new Date(l.date));
  const chart = g.points.length > 1
    ? etfBuildSparkline(g.points, buyDates)
    : '<div class="etf-chart-empty">Historique indisponible</div>';

  const realizedLegendItem = `<span>Gains réalisés : <span class="etf-money ${etfGainClass(g.realizedGain)}">${etfFmtSigned(g.realizedGain)}</span></span>`;

  return `
    <div class="etf-group ${g.closed ? 'etf-group-closed' : ''}">
      <div class="etf-group-header" data-isin="${g.isin}">
        <span class="etf-group-chevron ${expanded ? 'expanded' : ''}">▸</span>
        <div class="etf-group-name-wrap">
          <span class="etf-group-name" title="${g.isin}">${g.name}</span>
          ${!g.closed && g.changePct != null
            ? `<span class="etf-group-daily ${etfGainClass(g.changePct)}">${etfDailyArrow(g.changePct)} ${etfFmtPct(g.changePct)}</span>`
            : ''}
        </div>
        ${g.closed
          ? '<span class="etf-closed-badge">Clôturé</span>'
          : `<span class="etf-group-price">${g.currentPrice != null ? etfFmtEUR(g.currentPrice) : '—'}</span>`}
        <span class="etf-money etf-group-gain ${etfGainClass(g.totalGain)}">${g.totalGain != null ? etfFmtSigned(g.totalGain) : '—'}${g.gainPct != null ? ` (${etfFmtPct(g.gainPct)})` : ''}</span>
      </div>
      ${expanded ? `
      <div class="etf-group-body">
        ${g.closed ? `
        <div class="etf-chart-legend">
          <span>PRU : ${etfFmtEUR(g.pru)}</span>
          ${realizedLegendItem}
        </div>` : `
        <div class="etf-chart-wrap">
          ${chart}
          <div class="etf-chart-legend">
            <span>Prix achat : ${etfFmtEUR(firstBuyPrice)}</span>
            <span>Cours : ${g.currentPrice != null ? etfFmtEUR(g.currentPrice) : '—'}</span>
            <span>PRU : ${etfFmtEUR(g.pru)}</span>
            ${g.totalSold > 0 ? realizedLegendItem : ''}
          </div>
        </div>`}
        <div class="etf-table-wrap">
          <table class="etf-table">
            <thead><tr><th>Date</th><th>Type</th><th>Qté</th><th>Prix</th><th>Montant</th><th>Valeur</th><th>+/-</th></tr></thead>
            <tbody>
              ${sortedLines.map(l => etfLineRowHtml(l, g.currentPrice, g.pru)).join('')}
              <tr class="etf-table-summary">
                <td colspan="3">Total</td>
                <td></td>
                <td class="etf-money">${etfFmtEUR(g.invested)}</td>
                <td class="etf-money">${g.value != null ? etfFmtEUR(g.value) : '—'}</td>
                <td class="etf-money ${etfGainClass(g.totalGain)}">${g.totalGain != null ? etfFmtSigned(g.totalGain) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

function etfRenderModule(container, groups, privacy) {
  const totals = etfSumTotals(groups);
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Clôturé = plus de cours en direct (voir etfComputeGroups) : ne compte pas
  // comme une position "suivie" au sens du bloc "Cours".
  const coursGroups = groups.filter(g => !g.closed);
  // Bloc "Cours" réduit à un simple décompte (2026-08-10, sur demande
  // explicite, remplace la liste ticker/prix/variation par ETF — celle-ci est
  // désormais affichée directement sur chaque ligne ETF, voir
  // etf-group-daily dans etfGroupHtml) : plus qu'un nombre, plus de liste à
  // faire défiler dans le header.
  const coursCountLabel = `${coursGroups.length} position${coursGroups.length > 1 ? 's' : ''}`;

  container.innerHTML = `
    <div class="etf-module ${privacy ? 'etf-privacy-on' : ''}">
      <div class="etf-header">
        <div class="etf-header-block">
          <span class="etf-header-label">Cours</span>
          <span class="etf-header-count">${coursCountLabel}</span>
        </div>
        <div class="etf-header-block">
          <span class="etf-header-label">Portefeuille</span>
          <span class="etf-money etf-header-value">${totals.value != null ? etfFmtEUR(totals.value) : '—'}</span>
          <span class="etf-header-sub">${groups.length} position${groups.length > 1 ? 's' : ''}</span>
        </div>
        <div class="etf-header-block">
          <span class="etf-header-label">Investi (frais inclus)</span>
          <span class="etf-money etf-header-value">${etfFmtEUR(totals.invested)}</span>
          <span class="etf-header-sub">dont ${etfFmtEUR(totals.fees)} de frais</span>
        </div>
        <div class="etf-header-block">
          <span class="etf-header-label">Gains réalisés</span>
          <span class="etf-money etf-header-value ${etfGainClass(totals.realizedGain)}">${etfFmtSigned(totals.realizedGain)}</span>
          <span class="etf-header-sub">encaissés</span>
        </div>
        <div class="etf-header-block">
          <span class="etf-header-label">+/- Value (total)</span>
          <span class="etf-money etf-header-value etf-gain ${etfGainClass(totals.totalGain)}">${totals.totalGain != null ? etfFmtSigned(totals.totalGain) : '—'}</span>
          <span class="etf-header-sub ${etfGainClass(totals.totalGain)}">${totals.gainPct != null ? etfFmtPct(totals.gainPct) : '—'}</span>
        </div>
        <button class="etf-privacy-btn" title="${privacy ? 'Afficher les montants' : 'Masquer les montants'}">${privacyIconHtml(privacy)}</button>
      </div>
      <div class="etf-groups">
        ${groups.map(g => etfGroupHtml(g, etfExpandedState.has(g.isin))).join('')}
      </div>
      <div class="etf-footer">
        <span class="etf-updated">Mis à jour à ${now}</span>
        <button class="etf-refresh-btn">⟳ Rafraîchir</button>
      </div>
    </div>`;
}

// État d'affichage (groupes dépliés) — vit le temps du cycle de vie de la carte,
// remis à zéro à chaque rechargement du dashboard (rechargement de page).
let etfExpandedState = new Set();

window.MatinModules.etf = {
  async render(container, config, _google, setBadge) {
    etfExpandedState = new Set();
    const lines = (config?.lines || []).filter(l => l.isin);

    if (!lines.length) {
      container.innerHTML = `<div class="etf-empty">Aucune ligne configurée — ajoutez vos positions dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    let privacy = localStorage.getItem('matin-etf-privacy') === '1';

    async function loadAndRender() {
      setBadge('…');
      try {
        const groups = await etfComputeGroups(lines);
        etfRenderModule(container, groups, privacy);
        const totals = etfSumTotals(groups);
        setBadge(totals.gainPct != null ? etfFmtPct(totals.gainPct) : `${groups.length} ligne${groups.length > 1 ? 's' : ''}`);
      } catch (err) {
        console.error('[ETF] Erreur de rendu', err);
        container.innerHTML = `<span class="module-error">⚠ Erreur de chargement</span>`;
        setBadge('⚠');
      }
    }

    container.addEventListener('click', (e) => {
      const groupHeader = e.target.closest('.etf-group-header');
      if (groupHeader) {
        const isin = groupHeader.dataset.isin;
        if (etfExpandedState.has(isin)) etfExpandedState.delete(isin);
        else etfExpandedState.add(isin);
        loadAndRender();
        return;
      }
      if (e.target.closest('.etf-privacy-btn')) {
        privacy = !privacy;
        localStorage.setItem('matin-etf-privacy', privacy ? '1' : '0');
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
      loadAndRender().catch(err => console.error('[ETF] Erreur auto-refresh', err));
    }, ETF_REFRESH_MS);
  },
};
