/**
 * Module Sports — équipe configurable
 *
 * Dernier résultat : fusion de PLUSIEURS sources (2026-08-10, sur demande
 * explicite — bug réel constaté sur Lyon, voir ci-dessous), on ne dépend
 * plus d'une seule. TheSportsDB (clé démo "3", gratuite) reste la base pour
 * eventslast.php/eventsnext.php, mais eventslast.php plafonne à 1 résultat
 * ET peut être PÉRIMÉ : vérifié en direct le 2026-08-10 pour Lyon (idTeam
 * 133713) — eventslast.php renvoyait encore "Lyon vs Servette" du 15/07
 * (amical) alors que Lyon avait déjà joué et perdu 2-1 à Prague le 04/08
 * (barrage aller Ligue des champions, "Sparta Prague vs Lyon") ET avait le
 * match retour ("Lyon vs Sparta Prague") programmé le 11/08 selon
 * eventsnext.php — donc l'API SAIT que l'équipe est active, mais
 * eventslast.php n'a simplement pas encore indexé le résultat aller.
 * Repéré que searchevents.php (recherche par titre d'événement), lui, avait
 * la bonne donnée à jour instantanément. D'où fetchReverseFixtureMatch
 * ci-dessous : quand eventsnext.php connaît le PROCHAIN adversaire (cas
 * fréquent en barrage à 2 manches), on interroge searchevents.php sur ce
 * même adversaire pour retrouver la manche déjà jouée — corrige exactement
 * ce cas, sans clé payante. En complément, fetchLastMatchESPN (site.api.
 * espn.com, championnat national uniquement, pas de clé) sert de 2e
 * recoupement, et fetchLastMatchGoogleNews (RSS, extraction de score dans un
 * titre, confiance limitée) n'intervient qu'en tout dernier repli si aucune
 * source structurée n'a rien donné. Le candidat retenu au final est le plus
 * RÉCENT (date desc) parmi toutes les sources ayant répondu — voir
 * window.MatinModules.ol.render. Toutes les réponses brutes sont loguées en
 * console (voir chaque fonction fetchXxx) pour permettre de vérifier la
 * fraîcheur des données en cas de nouveau doute.
 *
 * Actualités : sources RSS choisies par l'utilisateur dans Paramètres, filtrées
 * par sport détecté automatiquement (voir modules/sports-sources.js, partagé
 * avec la page de config). AUCUN repli agrégateur (Google News a été retiré :
 * il pioche sur n'importe quel site mentionnant l'équipe, coché ou non — un
 * flux coché sans correspondance à l'instant du fetch faisait apparaître des
 * sources jamais cochées comme maxifoot.fr/foot01.com). Si une source cochée
 * ne donne rien, elle contribue simplement 0 article — jamais comblée par
 * autre chose. Tous ces flux n'envoient pas d'en-têtes CORS, donc le fetch
 * passe par le process main (voir main/main.js, canal IPC rss:fetchFeed)
 * plutôt que par un proxy tiers (l'ancien proxy CORS s'est révélé trop
 * instable — erreurs 520/522).
 */
window.MatinModules = window.MatinModules || {};

const DEFAULT_TEAM = 'Olympique Lyonnais';
const SPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';
const RESULT_LABEL = { win: 'V', draw: 'N', loss: 'D' };

// Nombre d'items bruts à récupérer par flux avant filtrage par équipe : les
// flux du catalogue (voir sports-sources.js) couvrent tout le sport, pas
// seulement l'équipe suivie, donc il faut piocher large pour ne pas se
// retrouver avec un ticker vide une fois le filtre appliqué.
const TEAM_NEWS_RAW_LIMIT = 50;

// Filtre à 1 passe (RÉTABLI le 2026-08-15, sur demande explicite — 3e
// révision du filtre ce mois-ci) : le filtre à 2 passes titre-strict/
// description-restreinte (même jour, plus tôt) s'est à nouveau révélé trop
// strict en conditions réelles — "Pas assez d'actualités — revenez plus
// tard" s'affichait alors qu'il existait bel et bien de l'actualité sur
// l'équipe, simplement pas assez citée dans un TITRE strict ni dans les 3
// sources restreintes de la passe 2. Retour à l'approche "qui marchait la
// semaine dernière" : un seul passage, sur TOUTES les sources cochées par
// l'utilisateur (pas de sous-liste restreinte), qui matche le nom d'équipe
// n'importe où dans le titre OU la description (texte complet, pas un
// extrait tronqué). Minimum abaissé à 1 article pour afficher le ticker —
// mieux vaut un ticker court que "pas assez d'actualités" alors qu'au moins
// un article pertinent existe.
const NEWS_TICKER_MIN_MATCHES = 1;

// Fenêtre "actualité récente" (2026-08-15, sur demande explicite) — un
// article matché par équipe mais plus vieux que ça est exclu du ticker.
// Un item SANS date exploitable (pubDate absent/imparsable) n'est PAS exclu
// par ce filtre (voir isWithinMaxAge) : c'est le cas de l'item "site
// officiel du club" (voir fetchNewsItems, source.isRss === false), qui n'a
// jamais de notion de date — l'exclure aurait fait disparaître cette entrée
// en permanence, un effet de bord non voulu par la demande ("articles plus
// vieux que 12h" suppose qu'on connaît leur âge).
const NEWS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isWithinMaxAge(pubDate) {
  if (!pubDate) return true;
  const t = new Date(pubDate).getTime();
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) <= NEWS_MAX_AGE_MS;
}

// Équilibrage entre sources : au plus NEWS_SOURCE_QUOTA articles par source
// dans le ticker final (round-robin), pour qu'une source prolifique (ex. RMC
// Sport, Foot Mercato — dont beaucoup plus d'articles bruts mentionnent
// l'équipe que L'Équipe/Eurosport/le site officiel) ne monopolise pas le
// ticker. NEWS_TICKER_TARGET = taille visée du ticker final (inchangée).
const NEWS_SOURCE_QUOTA = 4;
const NEWS_TICKER_TARGET = 15;

// Groupes équipe → mots-clés. Liste EXACTE demandée explicitement pour Lyon
// le 2026-08-15 : "lyon", "ol", "l'ol", "les gones", "olympique lyonnais" —
// appliquée au titre ET à la description (voir matchTeamDetail ci-dessous).
// "l'ol" est redondant avec "ol" (la limite de mot gère déjà l'apostrophe,
// voir containsWholeWord) mais gardé explicite pour la lisibilité de la liste.
// Le nom tel que tapé dans Paramètres (ou résolu via TheSportsDB) doit
// apparaître dans "keywords" pour que le groupe s'applique. Équipes hors
// liste : seul le nom exact sert de mot-clé.
// L'ancien champ "rivals" (garde-fou pensé pour exclure un article qui ne
// cite qu'un rival) a été retiré le 2026-08-15 en débuggant le bug ci-dessous
// : `matchesTeam` valait `hasTeam && !rivalOnly`, où `rivalOnly` ne pouvait
// être vrai QUE si `hasTeam` était déjà faux (`!hasTeam && rivals.some(...)`)
// — la condition résultante était donc mathématiquement toujours égale à
// `hasTeam` seul, "rivals" n'avait AUCUN effet réel malgré les apparences.
// Retiré plutôt que corrigé : le vrai bug rapporté (articles PSG/OM/Barça
// sans aucune mention de Lyon) ne venait pas de là, voir plus bas.
const TEAM_ALIAS_GROUPS = [
  { keywords: ['olympique lyonnais', 'lyon', 'ol', "l'ol", 'les gones'] },
];

function buildTeamContext(team) {
  const base = (team || '').trim().toLowerCase();
  const group = TEAM_ALIAS_GROUPS.find(g => g.keywords.includes(base));
  return group ? group : { keywords: base ? [base] : [] };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Correspondance "mot entier" au sens Unicode (\p{L} inclut les lettres
// accentuées, ex. "barça", "saint-étienne") — le \b natif de JS ne connaît
// que [A-Za-z0-9_], ce qui échoue en fin de mot accentué ET ne gère pas la
// ponctuation collée (ex. "OL," ou "OL."). Empêche "ol" de matcher à
// l'intérieur de "goal"/"anol"/"olympique" (lettre collée avant ou après =
// pas un mot entier → pas de match) tout en acceptant "OL," "OL." "OL " —
// plus robuste que le \bol\b littéral (qui échouerait sur "Barça", accents
// non couverts par \b) tout en couvrant exactement les mêmes cas.
function containsWholeWord(text, keyword) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}_])`, 'iu');
  return re.test(text);
}

// Le <description> d'un flux RSS contient souvent du HTML brut (balises
// <img>/<a> avec leurs attributs), pas du texte pur — `stripHtml` retire ces
// balises AVANT le filtrage par équipe. Cause racine RÉELLE du bug diagnostiqué
// le 2026-08-15 (articles hors sujet dans le ticker Sports), confirmée en
// conditions réelles via le log `[Sports] Match ... extrait=...` : un article
// générique "calendrier des matchs amicaux de TOUTE la Ligue 1" (donc PAS
// spécifique à Lyon) matchait quand même le mot-clé "ol" — pas dans son texte
// réel, mais dans le SLUG D'URL d'une balise <img> embarquée dans la
// description ("...medias.lequipe.fr/.../l-ol-et-corentin-tolisso-ont-ete-
// les-premiers-sur-le-pont-.../..."), où les tirets de l'URL sont interprétés
// comme des limites de mot par `containsWholeWord`. Sans cette fonction, un
// SIMPLE lien/image mentionnant Lyon dans un article sur un tout autre sujet
// (PSG, OM...) suffit à le faire apparaître à tort dans le ticker.
function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ');
}

// Passe unique — titre OU description (texte HTML nettoyé, voir stripHtml
// ci-dessus), sur TOUTES les sources cochées par l'utilisateur. Titre
// vérifié EN PREMIER (signal fort) ; description vérifiée seulement si le
// titre n'a rien donné. `via`/`keyword` remontés pour le log de debug
// ci-dessous (voir fetchNewsItems) — c'est ce log qui a permis d'identifier
// la cause racine ci-dessus.
function matchTeamDetail(item, { keywords }) {
  const title = (item.title || '').toLowerCase();
  const titleKeyword = keywords.find(kw => containsWholeWord(title, kw));
  if (titleKeyword) return { matched: true, via: 'title', keyword: titleKeyword };

  const description = stripHtml(item.description).toLowerCase();
  const descKeyword = keywords.find(kw => containsWholeWord(description, kw));
  if (descKeyword) return { matched: true, via: 'description', keyword: descKeyword };

  return { matched: false };
}

// Répartition équitable entre sources, en tour de table (round-robin) :
// prend au plus `quota` articles par source à chaque passage, dans l'ordre
// des sources, jusqu'à atteindre `target` ou épuiser toutes les sources.
// Le filtrage par équipe doit déjà avoir eu lieu PAR SOURCE avant d'appeler
// cette fonction (voir fetchNewsItems) — équilibrer des articles bruts non
// filtrés répartirait surtout du contenu hors sujet, puisqu'un flux généraliste
// ne parle de l'équipe suivie que dans une minorité de ses articles.
function balanceAcrossSources(bySource, quota, target) {
  const cursors = new Map(bySource.map(({ sourceLabel }) => [sourceLabel, 0]));
  const result = [];

  let progressed = true;
  while (progressed && result.length < target) {
    progressed = false;
    for (const { sourceLabel, items } of bySource) {
      const idx = cursors.get(sourceLabel);
      if (idx >= quota || idx >= items.length) continue;
      result.push(items[idx]);
      cursors.set(sourceLabel, idx + 1);
      progressed = true;
      if (result.length >= target) break;
    }
  }

  // Certaines sources n'ont pas atteint leur quota (moins de `quota` articles
  // pertinents trouvés) : on comble les places restantes avec le surplus des
  // autres sources (au-delà de leur quota), plutôt que de laisser le ticker
  // plus court que nécessaire alors que d'autres sources ont encore des
  // articles pertinents en réserve.
  if (result.length < target) {
    for (const { sourceLabel, items } of bySource) {
      let idx = cursors.get(sourceLabel);
      while (idx < items.length && result.length < target) {
        result.push(items[idx]);
        idx++;
      }
      cursors.set(sourceLabel, idx);
      if (result.length >= target) break;
    }
  }

  return result;
}

// Statuts TheSportsDB indiquant un match terminé (football + autres sports).
const FINISHED_STATUS_RE = /^(FT|AET|PEN|MATCH FINISHED|FINISHED|FINAL)$/i;

function isFinishedMatch(match) {
  const homeScore = Number(match.intHomeScore);
  const awayScore = Number(match.intAwayScore);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return false;

  const status = match.strStatus?.trim();
  if (!status) return true; // pas de statut fourni : se fier à la présence des scores
  return FINISHED_STATUS_RE.test(status);
}

function classifyCompetition(leagueName) {
  if (!leagueName) return '';
  const l = leagueName.toLowerCase();
  if (/champions|europa|conference|uefa/.test(l)) return 'Coupe d\'Europe';
  if (/cup|coupe|copa|pokal/.test(l)) return 'Coupe';
  return 'Championnat';
}

// TheSportsDB renvoie dateEvent + strTime en UTC (vérifié : un match à 16:00
// strTime correspond à 18:00 heure de Paris en été) — on combine les deux en
// un Date UTC unique puis on dérive date ET heure locales à partir de ce même
// instant (pas séparément) pour rester cohérent si la conversion fait
// basculer sur le jour suivant (ex: 23h30 UTC → 01h30 le lendemain en France).
function formatMatchDateTime(dateStr, timeStr) {
  if (!dateStr) return { date: '', time: '' };
  const d = new Date(`${dateStr}T${timeStr || '00:00:00'}Z`);
  return {
    date: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    time: timeStr ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
  };
}

// TheSportsDB renvoie un domaine nu ("www.olweb.fr", sans protocole) —
// vérifié en direct sur Lyon. `window.matin.shell.openExternal` a besoin
// d'une URL complète.
function normalizeWebsiteUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function fetchTeamId(team) {
  const res = await fetch(`${SPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(team)}`);
  if (!res.ok) throw new Error(`Recherche équipe KO (${res.status})`);
  const data = await res.json();
  console.log(`[Sports] searchteams.php?t=${encodeURIComponent(team)} →`, data);

  const found = data.teams?.[0];
  if (!found) throw new Error('Équipe introuvable sur TheSportsDB');
  console.log(`[Sports] Équipe "${team}" résolue vers idTeam=${found.idTeam} (${found.strTeam}, ${found.strSport}, ${found.strLeague})`);
  // strSport remonté avec l'idTeam (pas un 2e appel réseau) — sert uniquement
  // à teinter la carte par sport (voir olThemeForSport/render ci-dessous, sur
  // demande explicite 2026-08-08), réutilise le mapping déjà utilisé pour les
  // sources RSS (sports-sources.js) plutôt que d'en dupliquer un ici. `website`
  // (strWebsite, même réponse, aucun appel réseau de plus) sert au titre de
  // carte cliquable (2026-08-10, sur demande explicite — voir render ci-dessous).
  return { idTeam: found.idTeam, strSport: found.strSport, website: normalizeWebsiteUrl(found.strWebsite) };
}

// football/basketball → couleur dédiée ; tout le reste (rugby, F1, cyclisme,
// sport non reconnu) → "other-sports", couleur générique demandée pour "les
// autres sports".
function olThemeForSport(strSport) {
  const category = window.SportsSources.mapSportToCategory(strSport);
  if (category === 'football') return 'football';
  if (category === 'basketball') return 'basket';
  return 'other-sports';
}

async function fetchLastMatches(idTeam) {
  const url = `${SPORTSDB_BASE}/eventslast.php?id=${idTeam}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  console.log(`[Sports] ${url} →`, data);
  return data.results || [];
}

async function fetchNextMatch(idTeam) {
  const res = await fetch(`${SPORTSDB_BASE}/eventsnext.php?id=${idTeam}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.events?.[0] || null;
}

function analyzeMatch(match, idTeam) {
  const homeScore = Number(match.intHomeScore);
  const awayScore = Number(match.intAwayScore);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return null;

  const isHome = match.idHomeTeam === idTeam;
  const ourScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  const opponent = isHome ? match.strAwayTeam : match.strHomeTeam;

  let result = 'draw';
  if (ourScore > oppScore) result = 'win';
  else if (ourScore < oppScore) result = 'loss';

  return { ourScore, oppScore, opponent, result };
}

// Barrage à 2 manches (cas exact du bug Lyon/Sparta Prague, voir en-tête du
// fichier) : eventsnext.php connaît déjà le PROCHAIN adversaire même quand
// eventslast.php n'a pas encore indexé la manche déjà jouée contre ce même
// adversaire. searchevents.php (recherche par titre) est à jour en temps
// réel — on tente les 2 sens de titre ("A vs B" et "B vs A") et on écarte
// l'événement du prochain match lui-même (idEvent) pour ne garder que la
// manche déjà jouée.
async function fetchReverseFixtureMatch(idTeam, nextMatch) {
  if (!nextMatch) return null;
  const isHome = nextMatch.idHomeTeam === idTeam;
  const ourName = isHome ? nextMatch.strHomeTeam : nextMatch.strAwayTeam;
  const opponent = isHome ? nextMatch.strAwayTeam : nextMatch.strHomeTeam;
  if (!opponent || !ourName) return null;

  for (const q of [`${opponent} vs ${ourName}`, `${ourName} vs ${opponent}`]) {
    try {
      const res = await fetch(`${SPORTSDB_BASE}/searchevents.php?e=${encodeURIComponent(q)}`);
      if (!res.ok) continue;
      const data = await res.json();
      console.log(`[Sports] searchevents.php?e=${encodeURIComponent(q)} →`, data);

      const event = (data.event || []).find(e =>
        (e.idHomeTeam === idTeam || e.idAwayTeam === idTeam) &&
        e.idEvent !== nextMatch.idEvent &&
        isFinishedMatch(e)
      );
      if (event) {
        const analyzed = analyzeMatch(event, idTeam);
        if (analyzed) return { ...analyzed, date: new Date(event.dateEvent), source: 'thesportsdb-reverse' };
      }
    } catch (err) {
      console.warn(`[Sports] searchevents.php échoué pour "${q}"`, err);
    }
  }
  return null;
}

// Recoupement championnat national via ESPN (site.api.espn.com, sans clé,
// pas d'en-tête CORS — vérifié en direct 2026-08-10, d'où le passage par le
// proxy process main rss:fetchFeed comme les autres sources bloquées CORS de
// ce module). Portée limitée au championnat français (fra.1) : ne couvre PAS
// les coupes d'Europe ni les amicaux (vérifié : l'endpoint schedule scopé à
// fra.1 ne renvoie que les matchs de Ligue 1). Résolution du nom d'équipe
// TheSportsDB/utilisateur → équipe ESPN par correspondance approximative sur
// les mots-clés déjà utilisés pour le filtrage actus (ctx.keywords).
const ESPN_LIGUE1_TEAMS_URL = 'http://site.api.espn.com/apis/site/v2/sports/soccer/fra.1/teams';

async function espnFindTeamId(ctx) {
  try {
    const raw = await window.matin.rss.fetchFeed(ESPN_LIGUE1_TEAMS_URL);
    const data = JSON.parse(raw);
    const teams = data.sports?.[0]?.leagues?.[0]?.teams || [];
    const found = teams.find(t => {
      const name = (t.team.displayName || '').toLowerCase();
      return ctx.keywords.some(kw => name.includes(kw) || kw.includes(name));
    });
    return found ? found.team.id : null;
  } catch (err) {
    console.warn('[Sports] ESPN liste équipes Ligue 1 indisponible', err);
    return null;
  }
}

async function fetchLastMatchESPN(ctx) {
  const espnId = await espnFindTeamId(ctx);
  if (!espnId) return null;

  try {
    const raw = await window.matin.rss.fetchFeed(`http://site.api.espn.com/apis/site/v2/sports/soccer/fra.1/teams/${espnId}/schedule`);
    const data = JSON.parse(raw);
    console.log(`[Sports] ESPN schedule (teamId=${espnId}) →`, data);
    const completed = (data.events || [])
      .filter(e => e.competitions?.[0]?.status?.type?.completed)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const match = completed[0];
    if (!match) return null;
    const competitors = match.competitions[0].competitors || [];
    const us = competitors.find(c => c.team.id === espnId);
    const opp = competitors.find(c => c.team.id !== espnId);
    const ourScore = Number(us?.score);
    const oppScore = Number(opp?.score);
    if (!us || !opp || Number.isNaN(ourScore) || Number.isNaN(oppScore)) return null;

    let result = 'draw';
    if (ourScore > oppScore) result = 'win';
    else if (ourScore < oppScore) result = 'loss';
    return { ourScore, oppScore, opponent: opp.team.displayName, result, date: new Date(match.date), source: 'espn' };
  } catch (err) {
    console.warn('[Sports] ESPN schedule indisponible', err);
    return null;
  }
}

// Dernier repli (confiance limitée) : recherche RSS Google News, extraction
// d'un score dans un TITRE au format "Équipe X-Y Adversaire" (ou l'inverse)
// — n'intervient que si aucune source structurée (TheSportsDB, ESPN)
// n'a rien donné. Un titre sans motif score+équipe adjacent est simplement
// ignoré (pas de résultat fabriqué à partir d'un titre ambigu, ex. "l'OL
// craque sur la pelouse du Sparta Prague" ne contient aucun chiffre).
const SCORE_IN_TITLE_RE = /([A-Za-zÀ-ÿ'.\- ]{2,40}?)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-zÀ-ÿ'.\- ]{2,40})/;

function extractScoreFromTitle(title, ctx) {
  const m = title.match(SCORE_IN_TITLE_RE);
  if (!m) return null;
  const [, left, s1, s2, right] = m;
  const leftIsUs = ctx.keywords.some(kw => containsWholeWord(left, kw));
  const rightIsUs = ctx.keywords.some(kw => containsWholeWord(right, kw));
  if (leftIsUs === rightIsUs) return null; // ambigu (aucun ou les 2 côtés) : ignoré

  const ourScore = Number(leftIsUs ? s1 : s2);
  const oppScore = Number(leftIsUs ? s2 : s1);
  let result = 'draw';
  if (ourScore > oppScore) result = 'win';
  else if (ourScore < oppScore) result = 'loss';
  return { ourScore, oppScore, opponent: (leftIsUs ? right : left).trim(), result };
}

async function fetchLastMatchGoogleNews(team, ctx) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${team}" résultat`)}&hl=fr&gl=FR&ceid=FR:fr`;
    const xmlText = await window.matin.rss.fetchFeed(url);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const items = Array.from(doc.querySelectorAll('item')).slice(0, 20).map(item => ({
      title: item.querySelector('title')?.textContent || '',
      pubDate: item.querySelector('pubDate')?.textContent || '',
    }));
    console.log('[Sports] Google News RSS (repli dernier recours) — titres bruts :', items);

    for (const item of items) {
      const extracted = extractScoreFromTitle(item.title, ctx);
      if (extracted) {
        console.log('[Sports] Score extrait d\'un titre Google News (confiance limitée) :', item.title, '→', extracted);
        return { ...extracted, date: item.pubDate ? new Date(item.pubDate) : new Date(), source: 'googlenews' };
      }
    }
  } catch (err) {
    console.warn('[Sports] Google News RSS indisponible', err);
  }
  return null;
}

// jina.ai Reader (r.jina.ai) restitue une page en MARKDOWN, jamais le XML
// brut d'un flux RSS — vérifié empiriquement le 2026-08-16 sur le flux RSS
// de Foot Mercato : blocs répétés "### [](URL)" suivis du même lien en clair
// puis d'une date RFC822 en toutes lettres, SANS titre littéral (le "titre"
// n'existe que sous forme de slug dans l'URL, ex. ".../a123-coup-de-tonnerre-
// le-transfert-de-x-tombe-a-leau") ni description. Ce format ne peut donc
// JAMAIS être parsé par `DOMParser(...,'application/xml')` — appeler cette
// fonction sur une réponse jina.ai renvoyait auparavant TOUJOURS un
// `parsererror` silencieux (0 article), rendant le repli jina.ai
// intégralement inopérant malgré son apparence fonctionnelle. Parseur dédié,
// au mieux : reconstruit un "titre" lisible à partir du slug d'URL (moins
// fiable qu'un vrai titre RSS, mais exploitable par matchTeamDetail), aucune
// description disponible dans ce format (le filtre équipe se rabat donc sur
// le titre seul pour les articles récupérés par ce chemin).
function parseJinaMarkdownAsItems(text) {
  const re = /### \[\]\((https?:\/\/[^)]+)\)\s*\n\s*\[[^\]]*\]\([^)]*\)\s*\n\s*([A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}[^\n]*)/g;
  const items = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[1];
    const pubDate = m[2].trim();
    const slug = (url.split('/').pop() || '').replace(/^a\d+-/, '');
    const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || url;
    items.push({ title, link: url, description: '', pubDate });
  }
  return items;
}

// Debug ajouté le 2026-08-15, complété le 2026-08-16 (sur demande explicite,
// bug signalé plusieurs fois : seul L'Équipe apparaît dans le ticker) : log
// explicite de la RAISON d'un flux vide, pour distinguer "flux inaccessible"
// (404/CORS/timeout, message d'erreur exploité ci-dessous) de "flux OK mais
// XML vide/invalide" (0 <item> ou parsererror) — ces 2 cas donnaient
// auparavant le même silence (juste un console.warn générique), impossible à
// distinguer sans rouvrir le flux à la main.
async function fetchRssItems(url, limit = 8) {
  let xmlText;
  let viaFallback = false;
  try {
    xmlText = await window.matin.rss.fetchFeed(url);
    console.log(`[Sports] Flux OK (direct) : ${url}`);
  } catch (err) {
    console.warn(`[Sports] Flux INACCESSIBLE (direct) : ${url} — ${err.message}`);
    // Repli jina.ai Reader — PRÉCISION IMPORTANTE (redemandé le 2026-08-16,
    // "pour les sources bloquées par CORS, forcer jina.ai pour TOUTES les
    // sources") : ce fetch passe déjà par `rss:fetchFeed` (main.js, process
    // main) — la restriction CORS est propre au navigateur/renderer, Node ne
    // l'applique JAMAIS. Un vrai blocage CORS est donc structurellement
    // IMPOSSIBLE ici ; un échec direct est forcément un problème réseau/HTTP
    // réel (404, 403, timeout, DNS...) — vérifié en direct le 2026-08-16 :
    // aucune des 3 sources cochées par l'utilisateur n'échoue jamais en
    // direct (toutes HTTP 200). FORCER jina.ai pour TOUTES les sources (pas
    // seulement en repli sur échec) a donc été délibérément ÉCARTÉ : jina.ai
    // ne renvoie ni <description> ni titre littéral (voir
    // parseJinaMarkdownAsItems ci-dessus) — l'utiliser systématiquement
    // dégraderait la qualité des données d'un flux qui fonctionne déjà
    // parfaitement en direct, pour un problème (CORS) qui ne peut pas se
    // produire à cet endroit. Le repli reste donc réservé aux VRAIS échecs.
    try {
      xmlText = await window.matin.rss.fetchFeed(`https://r.jina.ai/${url}`);
      viaFallback = true;
      console.log(`[Sports] Flux récupéré via repli jina.ai : ${url}`);
    } catch (fallbackErr) {
      console.warn(`[Sports] Flux INACCESSIBLE (jina.ai aussi) : ${url} — ${fallbackErr.message}`);
      return [];
    }
  }

  if (viaFallback) {
    const items = parseJinaMarkdownAsItems(xmlText).slice(0, limit);
    if (!items.length) {
      console.warn(`[Sports] Flux VIDE (repli jina.ai, aucun article extrait du markdown) : ${url}`);
    }
    return items;
  }

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    console.warn(`[Sports] Flux INVALIDE (XML non parsable) : ${url} — début de la réponse : "${xmlText.slice(0, 150)}"`);
    return [];
  }

  const rawItems = Array.from(doc.querySelectorAll('item'));
  if (!rawItems.length) {
    console.warn(`[Sports] Flux VIDE (0 <item> dans le XML) : ${url}`);
  }

  return rawItems.slice(0, limit).map(item => ({
    title: item.querySelector('title')?.textContent || '',
    link: item.querySelector('link')?.textContent || '',
    // Examinée par matchTeamDetail au même titre que le titre (voir plus haut).
    description: item.querySelector('description')?.textContent || '',
    // Sert au filtre "12 dernières heures" (voir isWithinMaxAge/fetchNewsItems).
    pubDate: item.querySelector('pubDate')?.textContent || '',
  }));
}

// Actualités filtrées par sport détecté + sources cochées par l'utilisateur
// (config.sources = tableau d'URLs activées ; absent = tout coché par défaut,
// pour que les instances configurées avant cette fonctionnalité en profitent
// sans repasser par Paramètres). AUCUN repli agrégateur (ex. Google News) :
// un tel repli ignore la sélection de l'utilisateur par construction (il pioche
// sur n'importe quel site mentionnant l'équipe, coché ou non — c'est exactement
// le bug rapporté : maxifoot.fr/foot01.com/olympique-et-lyonnais.com
// apparaissaient alors que seul L'Équipe était coché, parce qu'un flux coché
// sans correspondance à cet instant déclenchait ce repli). Si les sources
// cochées ne donnent rien, le ticker est vide — jamais comblé par autre chose.
async function fetchNewsItems(team, config) {
  const ctx = buildTeamContext(team);
  const enabledUrls = config?.sources; // undefined = jamais configuré (legacy) ; [] = tout décoché explicitement

  let sources;
  if (enabledUrls === undefined) {
    // Jamais configuré : comportement historique, tout le catalogue détecté.
    try {
      const detection = await window.SportsSources.detectSportSources(team);
      sources = detection.list;
    } catch (err) {
      console.warn('[Sports] Détection du sport échouée, aucune actualité', err);
      return [];
    }
  } else if (!enabledUrls.length) {
    return []; // tout décoché : rien à afficher
  } else {
    // La détection ne sert qu'à retrouver le libellé affiché (source.label) —
    // les URLs cochées (enabledUrls) restent la seule source de vérité de ce
    // qu'il faut fetcher, même si la détection échoue cette fois-ci.
    let byUrl = new Map();
    try {
      const detection = await window.SportsSources.detectSportSources(team);
      byUrl = new Map(detection.list.map(s => [s.url, s]));
    } catch (err) {
      console.warn('[Sports] Détection du sport échouée — fetch des sources cochées avec libellé générique', err);
    }
    sources = enabledUrls.map((url) => {
      const known = byUrl.get(url);
      if (!known) {
        // URL cochée mais absente du catalogue ACTUEL (voir sports-sources.js
        // CATALOG) — soit une source retirée depuis (ex. Eurosport, retiré
        // entièrement le 2026-08-10, voir son commentaire dans ce fichier),
        // soit le site officiel du club a changé d'URL. Débuggé le
        // 2026-08-15 : sans ce log, une telle source cochée échouait en
        // silence avec juste son URL brute comme libellé, indiscernable
        // d'une source valide qui ne matcherait simplement aucun article.
        console.warn(`[Sports] Source cochée absente du catalogue actuel (probablement retirée) : ${url}`);
      }
      return known || { url, label: url, isRss: true };
    });
  }

  if (!sources.length) return [];

  console.log(`[Sports] Sources à récupérer (${sources.length}) :`, sources.map(s => ({ label: s.label, url: s.url, isRss: s.isRss !== false })));

  // Filtrage par équipe PAR SOURCE (pas sur le flux fusionné) : chaque source
  // garde sa propre liste d'articles pertinents, condition nécessaire pour
  // pouvoir ensuite équilibrer équitablement entre sources (voir
  // balanceAcrossSources) plutôt que de laisser une source prolifique
  // (RMC Sport, Foot Mercato...) noyer les autres.
  const perSource = await Promise.all(sources.map(async (source) => {
    let all;
    if (source.isRss === false) {
      // Pas de flux RSS détecté sur le site officiel : un seul item-lien direct.
      all = [{ title: source.label, link: source.url, sourceLabel: source.label }];
    } else {
      console.log(`[Sports] Fetching ${source.label}: ${source.url}`);
      const raw = await fetchRssItems(source.url, TEAM_NEWS_RAW_LIMIT);
      console.log(`[Sports] ${source.label} : ${raw.length} article(s) brut(s) récupéré(s)`);
      all = raw.map(item => ({ ...item, sourceLabel: source.label }));
    }
    // Debug ajouté le 2026-08-15 (sur demande explicite, bug signalé :
    // articles hors sujet — PSG/OM/Barça sans mention de Lyon — affichés
    // dans le ticker) : log de CHAQUE article passant le filtre, avec le
    // champ (titre/description) et le mot-clé exact ayant matché. A permis
    // d'identifier la cause racine (voir stripHtml plus haut) : un article
    // générique Ligue 1 matchait via le slug d'URL d'une <img> embarquée dans
    // sa description brute, pas via une vraie mention de Lyon. `extrait`
    // affiche le texte NETTOYÉ (post-stripHtml, comme réellement testé par
    // matchTeamDetail) pour rester utile si un futur faux positif apparaît.
    const matches = all.map(item => ({ item, detail: matchTeamDetail(item, ctx) }));
    const teamMatched = matches.filter(m => m.detail.matched);
    teamMatched.forEach(({ item, detail }) => {
      console.log(`[Sports] Match "${item.title}" — via=${detail.via} mot-clé="${detail.keyword}"${detail.via === 'description' ? ` extrait="${stripHtml(item.description).slice(0, 200).trim()}"` : ''}`);
    });

    // Filtre "12 dernières heures" (2026-08-15, sur demande explicite,
    // reconfirmé le 2026-08-16) — appliqué APRÈS le filtre équipe (pas
    // avant) : inutile de vérifier l'âge d'un article qui ne parle même pas
    // de l'équipe suivie.
    const recentMatched = teamMatched.filter(m => isWithinMaxAge(m.item.pubDate));
    const excludedByAge = teamMatched.length - recentMatched.length;
    if (excludedByAge > 0) {
      console.log(`[Sports] ${source.label} : ${excludedByAge} article(s) pertinent(s) mais > 12h, exclu(s)`);
    }

    console.log(`[Sports] ${source.label} : ${all.length} brut(s) → ${teamMatched.length} après filtre équipe → ${recentMatched.length} après filtre 12h`);

    // Raison explicite quand une source contribue 0 article au ticker
    // (2026-08-16, sur demande explicite) — les lignes ci-dessus donnent déjà
    // tout le détail, mais pas sous une forme "voici LA raison" en un coup
    // d'œil ; celle-ci les résume selon le point de blocage réel.
    if (!recentMatched.length) {
      let reason;
      if (!all.length) reason = 'flux vide ou inaccessible (voir "Flux INACCESSIBLE"/"Flux VIDE" ci-dessus)';
      else if (!teamMatched.length) reason = `aucun des ${all.length} article(s) récupéré(s) ne mentionne "${team}"`;
      else reason = `${teamMatched.length} article(s) pertinent(s) trouvé(s) mais tous > 12h`;
      console.log(`[Sports] ${source.label} : 0 article affiché — ${reason}`);
    }

    const items = recentMatched.map(m => m.item);
    return { sourceLabel: source.label, items };
  }));

  const totalMatched = perSource.reduce((sum, s) => sum + s.items.length, 0);
  console.log(`[Sports] Filtre équipe+12h : ${totalMatched} article(s) au total (${perSource.map(s => `${s.sourceLabel}=${s.items.length}`).join(', ')})`);
  // Format demandé explicitement (2026-08-16), en plus du détail ci-dessus
  // (conservé — c'est lui qui a permis de diagnostiquer les vrais bugs
  // trouvés aujourd'hui, voir stripHtml plus haut) : un résumé compact en
  // une ligne, "Source: N articles" séparés par " | ".
  console.log(`[Sports] ${perSource.map(s => `${s.sourceLabel}: ${s.items.length} articles`).join(' | ')}`);

  if (totalMatched < NEWS_TICKER_MIN_MATCHES) {
    console.log(`[Sports] Aucune actualité récente pertinente trouvée (${totalMatched} < ${NEWS_TICKER_MIN_MATCHES})`);
    return [];
  }

  const balanced = balanceAcrossSources(perSource, NEWS_SOURCE_QUOTA, NEWS_TICKER_TARGET);
  console.log(`[Sports] Équilibrage sources (quota ${NEWS_SOURCE_QUOTA}/source, cible ${NEWS_TICKER_TARGET}) : ${perSource.map(s => `${s.sourceLabel}=${s.items.length}`).join(', ')} → ${balanced.length} retenus`);
  console.log('[Sports] Articles affichés dans le ticker :', balanced.map(i => i.title));
  return balanced;
}

function renderLastResultsHtml(analyzedList) {
  if (!analyzedList.length) return '<span class="sports-no-data">Aucun résultat récent</span>';
  return analyzedList.map(a => `
    <div class="sports-result-item">
      <span class="sports-result-pill result-${a.result}">${RESULT_LABEL[a.result]} ${a.ourScore}-${a.oppScore}</span>
      <span class="sports-result-opp" title="${a.opponent}">${a.opponent}</span>
    </div>
  `).join('');
}

function renderNextMatchHtml(match) {
  if (!match) return '<span class="sports-no-data">Aucun match prévu</span>';
  const { date, time } = formatMatchDateTime(match.dateEvent, match.strTime);
  const competition = classifyCompetition(match.strLeague);
  return `
    <div class="sports-next-detail">${date} · ${time}${competition ? ' · ' + competition : ''}</div>
    <div class="sports-next-opp">${match.strEvent || ''}</div>
  `;
}

window.MatinModules.ol = {
  async render(container, config, _google, setBadge) {
    const team = config?.team?.trim() || DEFAULT_TEAM;
    setBadge(''); // le titre de la carte affiche déjà l'équipe

    container.innerHTML = `
      <div class="sports-module">
        <div class="sports-results-row" id="sports-results-slot">
          <div class="loading-spinner" style="width:14px;height:14px"></div>
        </div>
        <div class="sports-next" id="sports-next-slot">
          <span class="sports-next-label">Prochain match</span>
          <div class="loading-spinner" style="width:14px;height:14px;margin-top:4px"></div>
        </div>
        <div class="sports-ticker-vwrap" id="sports-ticker-slot">
          <div class="sports-ticker-vtrack">
            <div class="sports-ticker-vitem">Chargement des actualités…</div>
          </div>
        </div>
      </div>
    `;

    const resultsSlot = container.querySelector('#sports-results-slot');
    const nextSlot = container.querySelector('#sports-next-slot');
    const tickerSlot = container.querySelector('#sports-ticker-slot');

    // Résultats et calendrier (TheSportsDB)
    try {
      const { idTeam, strSport, website } = await fetchTeamId(team);
      const card = container.closest('.module-card');
      card?.setAttribute('data-theme', olThemeForSport(strSport));
      // Titre de carte cliquable → site officiel du club (2026-08-10, sur
      // demande explicite) : posé sur la carte immédiatement pour un clic dès
      // maintenant (voir dashboard.js, resolveModuleClickUrl — lu au moment du
      // clic, pas figé à la création de la carte, car cette résolution est
      // asynchrone). Persisté SEULEMENT si différent de la valeur déjà connue
      // — évite une écriture disque à chaque refresh (10 min) alors que le
      // site d'un club ne change jamais. `window.matin.store.set` (chemin à
      // clé simple, PAS `modules.update`) exprès : `modules.update` diffuse
      // `modules:updated`, écouté par dashboard.js pour un `location.reload()`
      // complet — correct pour un vrai changement de config utilisateur, mais
      // rechargerait toute la fenêtre à chaque résolution d'URL en tâche de
      // fond, ce qui n'a rien d'une action utilisateur.
      if (card && website) {
        card.dataset.website = website;
        if (config?.website !== website) {
          const instanceKey = (container.id || '').replace('content-', '') || 'ol';
          window.matin.store.set(`modules.${instanceKey}.config.website`, website)
            .catch(err => console.error('[Sports] Échec de la sauvegarde du site officiel du club', err));
        }
      }
      const [lastMatches, nextMatch] = await Promise.all([
        fetchLastMatches(idTeam).catch(() => []),
        fetchNextMatch(idTeam).catch(() => null),
      ]);

      const finishedMatches = lastMatches
        .filter(isFinishedMatch)
        .sort((a, b) => new Date(b.dateEvent) - new Date(a.dateEvent));
      console.log('[Sports] Matchs terminés triés (date desc, TheSportsDB eventslast.php) :', finishedMatches);

      const thesportsdbCandidate = finishedMatches
        .map(m => {
          const a = analyzeMatch(m, idTeam);
          return a ? { ...a, date: new Date(m.dateEvent), source: 'thesportsdb' } : null;
        })
        .find(Boolean) || null;

      // Recoupement multi-sources (voir en-tête du fichier) : on interroge
      // TOUJOURS les sources structurées (reverse-fixture + ESPN) en plus du
      // résultat brut TheSportsDB, puis on garde le candidat le plus RÉCENT
      // parmi tous ceux qui ont répondu — pas un simple ordre de priorité
      // fixe, pour ne jamais laisser un résultat périmé l'emporter sur un
      // résultat plus frais trouvé ailleurs.
      const [reverseCandidate, espnCandidate] = await Promise.all([
        fetchReverseFixtureMatch(idTeam, nextMatch).catch(err => { console.warn('[Sports] fetchReverseFixtureMatch a échoué', err); return null; }),
        strSport?.toLowerCase() === 'soccer'
          ? fetchLastMatchESPN(buildTeamContext(team)).catch(err => { console.warn('[Sports] fetchLastMatchESPN a échoué', err); return null; })
          : Promise.resolve(null),
      ]);

      let candidates = [thesportsdbCandidate, reverseCandidate, espnCandidate].filter(Boolean);
      console.log('[Sports] Candidats "dernier match" collectés :', candidates);

      if (!candidates.length) {
        const newsCandidate = await fetchLastMatchGoogleNews(team, buildTeamContext(team)).catch(err => { console.warn('[Sports] fetchLastMatchGoogleNews a échoué', err); return null; });
        if (newsCandidate) candidates = [newsCandidate];
      }

      candidates.sort((a, b) => b.date - a.date);
      const best = candidates[0] || null;
      console.log('[Sports] Dernier match retenu (le plus récent parmi les candidats) :', best);

      resultsSlot.innerHTML = renderLastResultsHtml(best ? [best] : []);
      nextSlot.innerHTML = `<span class="sports-next-label">Prochain match</span>${renderNextMatchHtml(nextMatch)}`;
    } catch (err) {
      resultsSlot.innerHTML = '<span class="sports-no-data">—</span>';
      nextSlot.innerHTML = `<span class="sports-next-label">Prochain match</span><span class="sports-no-data">Indisponible</span>`;
      console.error('[Sports] TheSportsDB', err);
    }

    // Actualités (ticker vertical défilant)
    try {
      const items = await fetchNewsItems(team, config);
      if (!items.length) {
        tickerSlot.innerHTML = `<span class="module-empty">Aucune actualité récente sur ${team}</span>`;
        return;
      }

      const itemsHtml = items.map(item =>
        `<div class="sports-ticker-vitem" data-link="${item.link}">${item.sourceLabel ? `<span class="sports-ticker-source">${item.sourceLabel}</span>` : ''}${item.title}</div>`
      ).join('');

      const track = document.createElement('div');
      track.className = 'sports-ticker-vtrack';
      track.innerHTML = itemsHtml + itemsHtml;
      // Facteur/plancher relevés de 5/20 à 6/24 (2026-08-05, sur demande
      // explicite) : items passés à 3 lignes pleines (voir .sports-ticker-vitem,
      // style.css) au lieu de 2 — ralenti légèrement pour laisser le temps de
      // lire les titres plus hauts sans changer le principe (toujours
      // proportionnel au nombre d'items, avec un plancher pour les tickers
      // courts).
      track.style.animationDuration = `${Math.max(items.length * 6, 24)}s`;

      tickerSlot.innerHTML = '';
      tickerSlot.appendChild(track);

      tickerSlot.querySelectorAll('.sports-ticker-vitem').forEach(el => {
        el.addEventListener('click', () => {
          const link = el.dataset.link;
          if (link) window.matin.shell.openExternal(link);
        });
      });
    } catch (err) {
      tickerSlot.innerHTML = '<span class="module-error">Actualités indisponibles</span>';
      console.error('[Sports] news', err);
    }
  }
};
