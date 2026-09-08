/**
 * Module Sports — équipe configurable
 *
 * "Dernier résultat" RETIRÉ ENTIÈREMENT (2026-09-05, sur demande explicite)
 * — toute la fusion multi-sources qui l'alimentait (TheSportsDB
 * eventslast.php, repli barrage 2 manches par recherche de titre, recoupement
 * ESPN roster/schedule ET scoreboard par fenêtre de dates, dernier repli RSS
 * Google News avec extraction de score dans un titre) a été supprimée avec
 * lui : la carte n'affiche plus que l'en-tête équipe, le classement, le
 * prochain match et le ticker d'actualités. `fetchEspnSchedule` reste (le
 * prochain match en dépend aussi), réduite à ne plus interroger que le
 * calendrier À VENIR.
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

// Heure de publication à côté du libellé de source (2026-09-01, sur demande
// explicite — "L'ÉQUIPE · 14h32") — "14h32" (pas "14:32") pour rester
// cohérent avec le format déjà utilisé ailleurs dans l'app pour une heure
// affichée en toutes lettres (voir mon-equipe.js monEquipeFormatDateTime).
// Chaîne vide (jamais "Invalid Date") si `pubDate` est absent/imparsable —
// l'appelant (voir fetchNewsItems ci-dessous) omet alors le séparateur " · ".
function formatArticleTime(pubDate) {
  if (!pubDate) return '';
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
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
// PSG (2026-09-01, sur demande explicite, "PSG NEWS: No news showing... add
// 'psg', 'paris saint-germain', 'paris sg', 'parisiens' to the filter
// alongside 'paris saint germain'") — "paris saint germain" (sans tiret) est
// la forme la plus probable saisie dans Paramètres/renvoyée par TheSportsDB ;
// ce groupe s'active dès que le nom d'équipe configuré correspond À L'UN
// des 5 mots-clés listés (voir buildTeamContext), et les 5 servent ALORS de
// filtre pour matcher les articles (voir matchTeamDetail) — un article
// mentionnant "PSG" ou "Parisiens" doit compter, pas seulement l'orthographe
// exacte tapée dans Paramètres.
//
// ASVEL (2026-09-01, sur demande explicite, "ASVEL keywords for news filter:
// 'asvel', 'ldlc asvel', 'villeurbanne'") — même principe.
const TEAM_ALIAS_GROUPS = [
  { keywords: ['olympique lyonnais', 'lyon', 'ol', "l'ol", 'les gones'] },
  { keywords: ['paris saint germain', 'paris saint-germain', 'psg', 'paris sg', 'parisiens'] },
  { keywords: ['asvel', 'ldlc asvel', 'villeurbanne'] },
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

function classifyCompetition(leagueName) {
  if (!leagueName) return '';
  const l = leagueName.toLowerCase();
  if (/champions|europa|conference|uefa/.test(l)) return 'Coupe d\'Europe';
  if (/cup|coupe|copa|pokal/.test(l)) return 'Coupe';
  return 'Championnat';
}

// ─── Classement (2026-08-31, sur demande explicite) ────────────────────────
// Compétition auto-détectée depuis `nextMatch.strLeague` (TheSportsDB, texte
// libre du type "French Ligue 1"/"UEFA Champions League") vers l'un des 9
// endpoints ESPN demandés. `.includes()` sur la chaîne en minuscules plutôt
// qu'un `.find()` avec un seul motif ambigu par ligue : testé que "uefa
// europa conference league" (Conference) ne contient PAS la sous-chaîne
// contiguë "europa league" (il y a "conference" entre les deux), donc aucun
// conflit d'ordre entre Europa et Conference malgré le nom imbriqué de cette
// dernière. Bundesliga exclut explicitement "2. Bundesliga" (2e division
// allemande, hors périmètre demandé) pour ne jamais l'étiqueter à tort comme
// la 1re division.
const STANDINGS_LEAGUES = [
  { slug: 'fra.1', label: 'Ligue 1', icon: '🏆', match: (l) => l.includes('ligue 1') },
  { slug: 'fra.2', label: 'Ligue 2', icon: '🏆', match: (l) => l.includes('ligue 2') },
  { slug: 'esp.1', label: 'Liga', icon: '🏆', match: (l) => l.includes('la liga') || l.includes('laliga') || l.includes('primera division') },
  { slug: 'eng.1', label: 'Premier League', icon: '🏆', match: (l) => l.includes('premier league') },
  { slug: 'ger.1', label: 'Bundesliga', icon: '🏆', match: (l) => l.includes('bundesliga') && !l.includes('2. bundesliga') },
  { slug: 'ita.1', label: 'Serie A', icon: '🏆', match: (l) => l.includes('serie a') },
  { slug: 'uefa.champions', label: 'Ligue des Champions', icon: '⭐', match: (l) => l.includes('champions league') },
  { slug: 'uefa.europa.conference', label: 'Conference League', icon: '🌍', match: (l) => l.includes('conference league') },
  { slug: 'uefa.europa', label: 'Europa League', icon: '🌍', match: (l) => l.includes('europa league') },
];

function detectStandingsLeague(leagueName) {
  if (!leagueName) return null;
  const l = leagueName.toLowerCase();
  return STANDINGS_LEAGUES.find(entry => entry.match(l)) || null;
}

// Classement mis en cache 6h (demande explicite) — PAR LIGUE (pas par
// équipe/instance) dans localStorage : plusieurs instances Sports suivant des
// équipes du même championnat partagent le même classement déjà téléchargé,
// et le cycle de refresh du module (10 min, voir dashboard.js
// MODULE_REGISTRY.ol) ne redéclenche donc PAS un appel réseau à chaque
// rafraîchissement de carte, seulement au plus une fois toutes les 6h.
const STANDINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchStandingsRaw(slug) {
  const cacheKey = `matin-standings-${slug}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && (Date.now() - cached.fetchedAt) < STANDINGS_CACHE_TTL_MS) {
      console.log(`[Sports] Classement ${slug} servi depuis le cache (${Math.round((Date.now() - cached.fetchedAt) / 60000)} min)`);
      return cached.data;
    }
  } catch (err) {
    console.warn(`[Sports] Cache classement ${slug} illisible, re-téléchargement`, err);
  }

  const raw = await window.matin.rss.fetchFeed(`http://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`);
  const data = JSON.parse(raw);
  console.log(`[Sports] Classement ${slug} téléchargé`, data);
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch (err) {
    console.warn(`[Sports] Échec mise en cache du classement ${slug}`, err);
  }
  return data;
}

// La réponse ESPN standings a 2 formes possibles selon la compétition : table
// unique (`data.standings.entries`, championnats nationaux) ou plusieurs
// groupes (`data.children[].standings.entries`, ex. phase de groupes) — les 2
// sont collectées ici, `groupName` restant `null` pour une table unique
// (voir fetchTeamStandingLine, qui décide du format d'affichage selon sa
// présence).
function collectStandingsGroups(data) {
  const groups = [];
  if (data?.standings?.entries?.length) {
    groups.push({ name: null, entries: data.standings.entries });
  }
  if (Array.isArray(data?.children)) {
    for (const child of data.children) {
      if (child?.standings?.entries?.length) {
        groups.push({ name: child.name || child.abbreviation || null, entries: child.standings.entries });
      }
    }
  }
  return groups;
}

// Même principe de correspondance approximative par mot-clé que
// espnFindTeam (plus haut) — mais directement sur les noms d'équipe DÉJÀ
// présents dans la réponse standings, sans appel réseau supplémentaire pour
// résoudre un id ESPN (les 9 championnats/coupes demandés n'ont pas tous un
// endpoint "liste des équipes" déjà utilisé dans ce fichier).
function findTeamStandingsEntry(groups, ctx) {
  for (const group of groups) {
    const entry = group.entries.find((e) => {
      const names = [e.team?.displayName, e.team?.shortDisplayName, e.team?.name, e.team?.abbreviation]
        .filter(Boolean)
        .map((n) => n.toLowerCase());
      return ctx.keywords.some((kw) => names.some((n) => n.includes(kw) || kw.includes(n)));
    });
    if (entry) return { entry, groupName: group.name };
  }
  return null;
}

function findStandingsStat(stats, ...names) {
  const lowerNames = names.map((n) => n.toLowerCase());
  const stat = (stats || []).find((s) =>
    lowerNames.includes((s.name || '').toLowerCase()) || lowerNames.includes((s.abbreviation || '').toLowerCase())
  );
  if (!stat) return null;
  return stat.displayValue ?? stat.value ?? null;
}

// "1er"/"2ème"/"3ème"... (convention FR informelle, cohérente avec les
// exemples EXACTS demandés).
function frOrdinal(rank) {
  const n = Number(rank);
  if (!Number.isFinite(n)) return '';
  return n === 1 ? '1er' : `${n}ème`;
}

// Ligne compacte "🏆 Ligue 1 — 3ème · 45 pts" (table unique) ou "⭐ Ligue des
// Champions — Groupe B · 2ème" (groupes — pas de points affichés dans ce cas,
// format EXACT demandé) — `null` si la compétition n'est pas dans la liste
// demandée, si l'équipe n'apparaît dans aucun groupe du classement récupéré,
// ou si le rang n'est pas exploitable : le seul contrat de cette fonction est
// "une ligne à afficher, ou rien" (voir render(), qui laisse alors le
// placeholder vide plutôt que d'afficher une erreur).
async function fetchTeamStandingLine(league, ctx) {
  const data = await fetchStandingsRaw(league.slug);
  const groups = collectStandingsGroups(data);
  const found = findTeamStandingsEntry(groups, ctx);
  if (!found) return null;

  const rank = findStandingsStat(found.entry.stats, 'rank');
  if (rank == null) return null;
  const points = findStandingsStat(found.entry.stats, 'points');
  const ordinal = frOrdinal(rank);

  if (found.groupName) {
    return `${league.icon} ${league.label} — ${found.groupName} · ${ordinal}`;
  }
  return `${league.icon} ${league.label} — ${ordinal}${points != null ? ` · ${points} pts` : ''}`;
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

// Sites officiels corrigés à la main (2026-09-01, sur demande explicite,
// "OFFICIAL WEBSITE LINKS — fix and update") — TheSportsDB renvoie parfois
// un domaine erroné ou une déclinaison non voulue :
//  - Manchester City : `fr.mancity.com` (version localisée FR) plutôt que le
//    site principal `www.mancity.com`.
//  - ASVEL (masculin, l'équipe suivie par ce module) : l'URL renvoyée par
//    TheSportsDB pointe vers le club féminin plutôt que masculin.
// Vérifiées à la main, ces 2 entrées prennent le dessus sur `found.strWebsite`
// UNIQUEMENT pour ces clubs précis — tout autre club garde sa valeur
// TheSportsDB telle quelle ("Keep existing correct links for other clubs").
// Correspondance sur un mot-clé CONTENU dans le nom tapé par l'utilisateur
// (pas une égalité exacte) : couvre "ASVEL", "LDLC ASVEL", "ASVEL
// Villeurbanne"... en une seule entrée, plutôt que de lister toutes les
// variantes de nom possibles.
const CLUB_WEBSITE_OVERRIDES = [
  { keyword: 'manchester city', url: 'https://www.mancity.com/' },
  { keyword: 'man city', url: 'https://www.mancity.com/' },
  // ASVEL : www.asvel.com corrigé → https://ldlcasvel.com/ (2026-09-01,
  // 2e demande explicite le même jour, l'URL précédente n'était pas la
  // bonne non plus).
  { keyword: 'asvel', url: 'https://ldlcasvel.com/' },
];

function resolveWebsiteOverride(team) {
  const t = (team || '').toLowerCase();
  const hit = CLUB_WEBSITE_OVERRIDES.find(o => t.includes(o.keyword));
  return hit ? hit.url : null;
}

// `expectedCategory` (2026-09-01, sur demande explicite — bug "Monaco
// Basket" : contamination croisée basket/football) : sport manuel choisi
// dans Paramètres, ou déduit du nom d'équipe (ex. "Basket" dans "Monaco
// Basket", voir SportsSources.detectCategoryFromTeamName) — connu AVANT
// même d'interroger TheSportsDB, donc utilisable ici pour choisir le bon
// candidat. Une recherche par nom peut renvoyer PLUSIEURS clubs
// homonymes/proches de sports différents (typiquement un club de football
// et une section basket du même nom de ville) — TheSportsDB/searchteams.php
// ne classe pas ses résultats par pertinence de sport. Sans ce paramètre,
// l'ancien code prenait AVEUGLÉMENT `data.teams[0]`, risquant de résoudre
// l'idTeam du MAUVAIS sport et de contaminer eventslast.php/eventsnext.php
// (résultats/calendrier) avec les matchs d'un club homonyme d'un autre sport
// — un simple re-thème/filtre ESPN après coup n'aurait rien changé, l'idTeam
// lui-même aurait déjà été celui du mauvais club.
async function fetchTeamId(team, expectedCategory) {
  // Override d'idTeam (voir CLUB_ID_OVERRIDES plus haut, BUG 3) — vérifié
  // AVANT tout appel réseau : recherche TheSportsDB entièrement
  // court-circuitée dès qu'un mot-clé connu correspond, pas seulement une
  // correction du résultat après coup (contrairement à
  // resolveWebsiteOverride, appliqué lui APRÈS la recherche puisqu'il ne
  // corrige qu'un champ annexe de la même réponse, pas l'idTeam lui-même).
  const idOverride = resolveClubIdOverride(team);
  if (idOverride) {
    console.log(`[Sports] idTeam forcé (override connu) pour "${team}" : ${idOverride.idTeam} (${idOverride.strLeague}) — recherche TheSportsDB par nom ignorée`);
    const overrideUrl = resolveWebsiteOverride(team);
    return { idTeam: idOverride.idTeam, strSport: idOverride.strSport, website: overrideUrl || null };
  }

  const res = await fetch(`${SPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(team)}`);
  if (!res.ok) throw new Error(`Recherche équipe KO (${res.status})`);
  const data = await res.json();
  console.log(`[Sports] searchteams.php?t=${encodeURIComponent(team)} →`, data);

  const candidates = data.teams || [];
  if (!candidates.length) throw new Error('Équipe introuvable sur TheSportsDB');

  let found = candidates[0];
  if (expectedCategory) {
    const match = candidates.find(c => window.SportsSources.mapSportToCategory(c.strSport) === expectedCategory);
    if (match) {
      found = match;
    } else {
      console.warn(`[Sports] "${team}" — aucun des ${candidates.length} résultat(s) TheSportsDB ne correspond au sport attendu ("${expectedCategory}"), repli sur le 1er résultat (${candidates[0].strTeam}, ${candidates[0].strSport})`);
    }
  }
  console.log(`[Sports] Équipe "${team}" résolue vers idTeam=${found.idTeam} (${found.strTeam}, ${found.strSport}, ${found.strLeague})`);
  // Log EXACT demandé explicitement (2026-09-06, BUG 3, PART A) — permet de
  // confirmer en un coup d'œil quel idTeam TheSportsDB a réellement été
  // résolu pour un nom donné, sans avoir à relire la ligne ci-dessus.
  console.log('[Sports] idTeam résolu:', found.idTeam, found.strTeam, found.strLeague);

  const overrideUrl = resolveWebsiteOverride(team);
  if (overrideUrl) {
    console.log(`[Sports] Site officiel forcé (override connu) pour "${team}" : ${overrideUrl} (TheSportsDB renvoyait : ${found.strWebsite || '—'})`);
  }
  // strSport remonté avec l'idTeam (pas un 2e appel réseau) — sert à résoudre
  // la catégorie du sport (voir resolveSportCategory/olThemeForCategory/
  // render ci-dessous, sur demande explicite 2026-08-08, étendu le
  // 2026-09-01), réutilise le mapping déjà utilisé pour les
  // sources RSS (sports-sources.js) plutôt que d'en dupliquer un ici. `website`
  // (strWebsite, même réponse, aucun appel réseau de plus, sauf override
  // ci-dessus) sert au titre de carte cliquable (2026-08-10, sur demande
  // explicite — voir render ci-dessous).
  return { idTeam: found.idTeam, strSport: found.strSport, website: overrideUrl || normalizeWebsiteUrl(found.strWebsite) };
}

// football/basketball → couleur dédiée ; tout le reste (rugby, F1, cyclisme,
// sport non reconnu) → "other-sports", couleur générique demandée pour "les
// autres sports". Prend directement une CATÉGORIE déjà résolue (2026-09-01 —
// voir resolveSportCategory/render ci-dessous), plus `strSport` brut comme
// avant : sport manuel/nom d'équipe (ex. "Monaco Basket") doivent pouvoir
// changer le thème de la carte au même titre que la détection TheSportsDB.
function olThemeForCategory(category) {
  if (category === 'football') return 'football';
  if (category === 'basketball') return 'basket';
  return 'other-sports';
}

// Tri par date/heure croissante (2026-09-07, sur demande explicite, BUG
// "prochain match" ASVEL) — eventsnext.php renvoie jusqu'à 5 événements À
// VENIR TOUTES compétitions confondues pour l'équipe (championnat + coupe
// nationale + coupe d'Europe...), PAS garantis triés par proximité :
// `events[0]` pris aveuglément pouvait donc afficher un match plus lointain
// qu'un autre déjà présent dans le même tableau (cas réel : ASVEL, la LNB
// Super Coupe du 19/09 apparaissait derrière un match plus tardif). Fenêtre
// de grâce de 2h (`Date.now() - 2h`) plutôt qu'un simple ">= maintenant" :
// un match qui vient tout juste de démarrer doit rester affichable comme
// "prochain" le temps qu'il soit reclassé "en cours"/"terminé" ailleurs dans
// l'API, plutôt que de disparaître brutalement de cette liste pile au coup
// d'envoi. AUCUN filtre par compétition ici (délibéré) : les 5 événements
// renvoyés, quelle que soit leur ligue, restent tous des candidats valides —
// le plus proche dans le temps l'emporte, jamais une restriction à la ligue
// principale de l'équipe (un club joue plusieurs compétitions en parallèle).
async function fetchNextMatch(idTeam) {
  const url = `${SPORTSDB_BASE}/eventsnext.php?id=${idTeam}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[Sports] ${url} → HTTP ${res.status} (échec), aucun prochain match récupérable via cette source`);
    return null;
  }
  const data = await res.json();
  console.log(`[Sports] ${url} →`, data);

  const upcoming = (data.events || [])
    .map(e => {
      const dt = new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}Z`);
      return { ...e, _ts: Number.isNaN(dt.getTime()) ? Infinity : dt.getTime() };
    })
    .filter(e => e._ts > Date.now() - 2 * 3600 * 1000) // fenêtre de grâce de 2h (match en cours)
    .sort((a, b) => a._ts - b._ts);

  console.log('[Sports] Prochains matchs (toutes compétitions):', upcoming.map(e =>
    ({ date: e.dateEvent, time: e.strTime, league: e.strLeague, home: e.strHomeTeam, away: e.strAwayTeam })));

  const next = upcoming[0] || null;
  if (!next) console.log(`[Sports] ${url} → réponse OK mais aucun événement à venir exploitable (data.events vide/absent, ou tous hors fenêtre)`);
  return next;
}

// Recoupement via ESPN (site.api.espn.com, sans clé, pas d'en-tête CORS —
// vérifié en direct 2026-08-10, d'où le passage par le proxy process main
// rss:fetchFeed comme les autres sources bloquées CORS de ce module) — source
// de repli pour le PROCHAIN match (`fetchEspnSchedule` plus bas), quand
// TheSportsDB `eventsnext.php` n'a rien renvoyé.
//
// GÉNÉRALISÉ le 2026-09-01 (sur demande explicite, "ASVEL NEXT MATCH: No
// upcoming match shown — debug ESPN API for ASVEL basketball team") — 2
// changements par rapport à la version précédente :
//  1. `ESPN_SOCCER_LEAGUES` → `ESPN_SPORT_LEAGUES` (par sport, pas juste
//     football) : Ligue 1 SEULE ne couvrait déjà pas le cas réel d'un club
//     français en coupe d'Europe autre que Ligue des Champions (Europa/
//     Conference) — élargi aux 2 en plus de fra.1/uefa.champions, ces 4
//     slugs étant déjà utilisés ET vérifiés valides ailleurs dans ce fichier
//     (voir STANDINGS_LEAGUES).
//  2. `espnFindTeam`/`fetchEspnSchedule` prennent maintenant un `sportPath`
//     ESPN ('soccer' ou 'basketball') en paramètre au lieu de "soccer" en dur
//     — render() les appelle avec le bon chemin selon `strSport`
//     (TheSportsDB), au lieu de sauter purement et simplement ESPN pour tout
//     ce qui n'est pas du football (cas d'ASVEL jusqu'ici : SEUL
//     `eventsnext.php` de TheSportsDB alimentait son prochain match, sans
//     AUCUN filet de rattrapage si cette donnée s'avère périmée — exactement
//     le même défaut déjà documenté et corrigé pour le football ci-dessus,
//     jamais étendu au basket). Slugs basketball ('fiba.euroleague',
//     'fra.lnb') NON VÉRIFIÉS en direct (pas d'accès réseau pendant ce
//     débogage) — best-effort : si un slug est incorrect, l'appel échoue
//     proprement (log clair ci-dessous, `catch` déjà en place), sans casser
//     le reste du module. Log explicite de teamId/réponse brute demandé
//     explicitement — voir espnFindTeam/fetchEspnSchedule.
// ÉLARGI le 2026-09-01 (sur demande explicite, "Fix the Sports module —
// Basketball vs Football cross-contamination", liste demandée : "NBA,
// Euroleague, Pro A (LNB), FIBA") — 'nba' et 'fiba' ajoutés à la liste
// basketball existante. NI L'UN NI L'AUTRE VÉRIFIÉ en direct (accès réseau à
// site.api.espn.com bloqué — 403 — au moment de ce changement, y compris sur
// fra.1/soccer déjà utilisé en production par ce même fichier : pas un
// signal exploitable sur la validité des slugs eux-mêmes). Aucun risque à
// les tenter : un slug invalide échoue proprement, même filet de sécurité
// que 'fiba.euroleague'/'fra.lnb' ci-dessus (jamais vérifiés non plus).
const ESPN_SPORT_LEAGUES = {
  soccer: ['fra.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conference'],
  basketball: ['fra.lnb', 'fiba.euroleague', 'nba', 'fiba'],
};

// Catégorie SportsSources ('football'/'basketball'/...) → chemin ESPN
// ('soccer'/'basketball') — seuls ces 2 sports ont un mapping ESPN connu
// dans ce fichier (voir ESPN_SPORT_LEAGUES ci-dessus) ; tout le reste
// (rugby, F1, cyclisme, tennis, athlétisme, catégorie non reconnue) reste
// `undefined` ici → `null` côté appelant (render()), comme avant.
const ESPN_SPORT_PATH_BY_CATEGORY = { football: 'soccer', basketball: 'basketball' };

// Label texte injecté dans `strLeague` (voir espnEventToNextMatch) — sert de
// donnée d'entrée à `classifyCompetition`/`detectStandingsLeague` (même
// fichier), qui attendent un texte de championnat façon TheSportsDB plutôt
// que le slug technique ESPN.
const ESPN_SLUG_LEAGUE_LABEL = {
  'fra.1': 'French Ligue 1',
  // 'fra.2' ajouté (2026-09-06, sur demande explicite — BUG 3 PART B,
  // fetchLeagueScoreboardNextMatch/KNOWN_LEAGUES) : manquait jusqu'ici,
  // laissait `strLeague` vide pour tout match Ligue 2 retrouvé par ce repli,
  // ce qui aurait aussi cassé classifyCompetition/detectStandingsLeague en
  // aval (tous les deux lisent `strLeague`).
  'fra.2': 'French Ligue 2',
  'uefa.champions': 'UEFA Champions League',
  'uefa.europa': 'UEFA Europa League',
  'uefa.europa.conference': 'UEFA Europa Conference League',
  'fiba.euroleague': 'EuroLeague',
  'fra.lnb': 'French LNB',
  'nba': 'NBA',
  'fiba': 'FIBA',
};

// Cherche l'équipe dans CHAQUE championnat de ESPN_SPORT_LEAGUES[sportPath],
// dans l'ordre, jusqu'à la trouver — retourne aussi le slug où elle a été
// trouvée (nécessaire pour interroger le bon endpoint schedule juste après,
// ET pour injecter le bon libellé de championnat dans le prochain match).
async function espnFindTeam(ctx, sportPath) {
  for (const slug of ESPN_SPORT_LEAGUES[sportPath] || []) {
    try {
      const raw = await window.matin.rss.fetchFeed(`http://site.api.espn.com/apis/site/v2/sports/${sportPath}/${slug}/teams`);
      const data = JSON.parse(raw);
      console.log(`[Sports] ESPN liste équipes (${sportPath}/${slug}) →`, data);
      const teams = data.sports?.[0]?.leagues?.[0]?.teams || [];
      const found = teams.find(t => {
        const name = (t.team.displayName || '').toLowerCase();
        return ctx.keywords.some(kw => name.includes(kw) || kw.includes(name));
      });
      if (found) {
        console.log(`[Sports] Équipe trouvée sur ESPN (${sportPath}/${slug}) : teamId=${found.team.id} (${found.team.displayName})`);
        return { espnId: found.team.id, slug };
      }
      console.log(`[Sports] Équipe absente de la liste ESPN ${sportPath}/${slug} (${teams.length} équipe(s) reçue(s))`);
    } catch (err) {
      console.warn(`[Sports] ESPN liste équipes (${sportPath}/${slug}) indisponible`, err);
    }
  }
  return null;
}

// Reconstruit un objet façon TheSportsDB (dateEvent/strTime/strLeague/
// strEvent) à partir d'un événement ESPN à venir, pour rester compatible SANS
// MODIFICATION avec renderNextMatchHtml/formatMatchDateTime/
// classifyCompetition/detectStandingsLeague — tous écrits à l'origine pour la
// forme TheSportsDB uniquement. `event.date` ESPN est déjà un ISO 8601 UTC
// complet (ex. "2026-09-06T19:00Z"), simplement redécoupé en date+heure UTC
// séparées pour correspondre à ce que `formatMatchDateTime` recompose.
function espnEventToNextMatch(event, slug) {
  if (!event) return null;
  const d = new Date(event.date);
  if (Number.isNaN(d.getTime())) return null;

  const competitors = event.competitions?.[0]?.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  const strEvent = home && away
    ? `${home.team?.displayName || '?'} vs ${away.team?.displayName || '?'}`
    : (event.name || event.shortName || '');

  return {
    dateEvent: d.toISOString().slice(0, 10),
    strTime: d.toISOString().slice(11, 19),
    strLeague: ESPN_SLUG_LEAGUE_LABEL[slug] || '',
    strEvent,
  };
}

// Point d'entrée unique ESPN pour ce module — trouve l'équipe (tous
// championnats de ESPN_SPORT_LEAGUES[sportPath]), récupère SON calendrier À
// VENIR, en tire le prochain match.
//
// `?fixture=true` (découvert par essai direct le 2026-08-31, non documenté
// publiquement) : `.../teams/{id}/schedule` SANS ce paramètre ne renvoie PAS
// le calendrier à venir mais une petite fenêtre de matchs RÉCEMMENT joués —
// vérifié en direct (32 événements à venir pour Lyon avec `?fixture=true`,
// contre 2 matchs déjà terminés sans lui). Réduite le 2026-09-05 (sur demande
// explicite, retrait du "dernier résultat") à ne plus interroger QUE cette
// moitié "à venir" — l'autre appel (`baseUrl` sans le paramètre, résultats
// récents) n'avait plus aucun consommateur une fois `espnEventToLastMatch`
// supprimée avec le reste du "dernier résultat".
async function fetchEspnSchedule(ctx, sportPath) {
  const found = await espnFindTeam(ctx, sportPath);
  if (!found) {
    console.log(`[Sports] ESPN (${sportPath}) — Team ID trouvé: aucun, prochains matchs: 0`);
    return null;
  }
  const { espnId, slug } = found;
  const url = `http://site.api.espn.com/apis/site/v2/sports/${sportPath}/${slug}/teams/${espnId}/schedule?fixture=true`;

  try {
    const raw = await window.matin.rss.fetchFeed(url);
    const futureData = JSON.parse(raw);
    console.log(`[Sports] ESPN schedule brut — prochains matchs (${sportPath}, teamId=${espnId}, ${slug}, ?fixture=true) →`, futureData);

    const upcoming = (futureData.events || [])
      .filter(e => !e.competitions?.[0]?.status?.type?.completed)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    console.log(`[Sports] ESPN (${sportPath}) — Team ID trouvé: ${espnId}, prochains matchs: ${upcoming.length}`);

    return espnEventToNextMatch(upcoming[0], slug);
  } catch (err) {
    console.warn(`[Sports] ESPN schedule (${sportPath}, teamId=${espnId}, ${slug}) indisponible`, err);
    console.log(`[Sports] ESPN (${sportPath}) — Team ID trouvé: ${espnId}, prochains matchs: 0`);
    return null;
  }
}

// ─── Repli scoreboard ESPN par ligue connue (2026-09-06, sur demande
// explicite, BUG 3 PART B — PSG : "Prochain match: Indisponible") — DERNIER
// filet de rattrapage pour le prochain match, après TheSportsDB eventsnext.php
// ET fetchEspnSchedule (roster ESPN par nom, déjà en place) : ne s'applique
// QUE si l'utilisateur a choisi une ligue connue dans le menu déroulant
// Paramètres (voir KNOWN_LEAGUES plus haut/config.js, config.manualLeague).
// Le scoreboard ESPN est le flux du CHAMPIONNAT ENTIER pour la journée/la
// manche à venir, filtré ici sur le nom de l'équipe suivie — contrairement à
// fetchEspnSchedule, qui dépend de espnFindTeam trouvant l'équipe dans le
// roster ESPN par correspondance de nom (une même résolution de nom
// défaillante casserait aussi ce chemin-là) : celui-ci ne dépend QUE du nom
// déjà connu avec certitude depuis la sélection dans le menu déroulant, pas
// d'une recherche supplémentaire.
async function fetchLeagueScoreboardNextMatch(league, ctx) {
  if (!league?.espnSlug || !league?.espnSportPath) return null;
  const url = `http://site.api.espn.com/apis/site/v2/sports/${league.espnSportPath}/${league.espnSlug}/scoreboard`;
  try {
    const raw = await window.matin.rss.fetchFeed(url);
    const data = JSON.parse(raw);
    console.log(`[Sports] Repli scoreboard ESPN (${league.espnSportPath}/${league.espnSlug}) →`, data);

    const match = (data.events || []).find(ev => {
      const competitors = ev.competitions?.[0]?.competitors || [];
      const isOurs = competitors.some(c => {
        const name = (c.team?.displayName || '').toLowerCase();
        return ctx.keywords.some(kw => name.includes(kw) || kw.includes(name));
      });
      const state = ev.status?.type?.state || ev.competitions?.[0]?.status?.type?.state;
      return isOurs && state === 'pre';
    });

    if (!match) {
      console.log(`[Sports] Repli scoreboard ESPN (${league.espnSportPath}/${league.espnSlug}) — aucun match à venir trouvé pour cette équipe`);
      return null;
    }
    console.log(`[Sports] Repli scoreboard ESPN — match à venir trouvé :`, match.name || match.shortName);
    return espnEventToNextMatch(match, league.espnSlug);
  } catch (err) {
    console.warn(`[Sports] Repli scoreboard ESPN (${league.espnSportPath}/${league.espnSlug}) indisponible`, err);
    return null;
  }
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

  // Sport choisi manuellement dans Paramètres (2026-09-01, sur demande
  // explicite) — voir sports-sources.js detectSportSources : prend toujours
  // le dessus sur la catégorie auto-détectée une fois renseigné. `undefined`
  // (jamais touché) laisse la détection automatique décider, comme avant.
  const manualSport = config?.sport || undefined;

  let sources;
  if (enabledUrls === undefined) {
    // Jamais configuré : comportement historique, tout le catalogue détecté.
    try {
      const detection = await window.SportsSources.detectSportSources(team, manualSport);
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
      const detection = await window.SportsSources.detectSportSources(team, manualSport);
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

  // Tri chronologique, plus récent en premier (2026-09-01, sur demande
  // explicite) — APRÈS balanceAcrossSources, jamais avant : celui-ci choisit
  // QUELS articles entrent dans le ticker (équilibrage entre sources, voir
  // son commentaire plus haut), ce tri ne change que leur ORDRE d'affichage
  // une fois la sélection figée. Un article sans date exploitable (pubDate
  // absent/imparsable — ex. l'item "site officiel du club", voir
  // fetchNewsItems plus haut) est relégué en FIN de liste (Number.
  // NEGATIVE_INFINITY) plutôt que traité comme "maintenant", qui l'aurait
  // fait apparaître à tort en tête de ticker.
  balanced.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime();
    const tb = new Date(b.pubDate).getTime();
    return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
  });

  console.log('[Sports] Articles affichés dans le ticker (triés du plus récent au plus ancien) :', balanced.map(i => `${i.title} (${i.pubDate || 'sans date'})`));
  return balanced;
}

// Nom RÉEL de la compétition (2026-09-07, sur demande explicite, BUG
// "prochain match" ASVEL) — affiche `match.strLeague` TEL QUEL (ex. "LNB
// Super Coupe", "Euroleague Basketball"), directement depuis l'événement
// retenu, plutôt que la catégorie générique `classifyCompetition` calculait
// jusqu'ici ("Championnat"/"Coupe"/"Coupe d'Europe") — cette dernière
// noyait la compétition RÉELLE d'un match précis derrière un mot générique,
// alors qu'un club joue plusieurs compétitions en parallèle et que
// l'utilisateur a besoin de savoir laquelle est concernée par CE match.
// `classifyCompetition` gardée en tout dernier repli, seulement si
// `strLeague` est vide (cas limite, source sans nom de championnat exploitable).
function renderNextMatchHtml(match) {
  if (!match) return '<span class="sports-no-data">Aucun match prévu</span>';
  const { date, time } = formatMatchDateTime(match.dateEvent, match.strTime);
  const competition = match.strLeague || classifyCompetition(match.strLeague);
  return `
    <div class="sports-next-detail">${competition ? competition + ' — ' : ''}${date} · ${time}</div>
    <div class="sports-next-opp">${match.strEvent || ''}</div>
    <div class="sports-standings-line" id="sports-standings-slot"></div>
  `;
}

// ─── Ligues connues pour le menu déroulant Équipe (2026-09-05, sur demande
// explicite, remplace la saisie en texte libre par un choix ligue → équipe,
// avec repli "Autre équipe" en texte libre conservé — voir config.js) —
// chaque entrée porte le SPORT (thème de carte + sources actualités, voir
// olThemeForCategory/sports-sources.js CATALOG) et le nom de championnat
// attendu par TheSportsDB `search_all_teams.php?l=` (voir config.js), qui
// n'accepte QUE son intitulé anglais exact, pas le slug `value` ni le
// libellé français affiché dans le menu. Exposée à config.js via
// `window.MatinModules.olKnownLeagues` (ol.js chargé AVANT config.js dans
// config.html, comme dans index.html) — pas de nouveau fichier séparé façon
// live-championships.js : cette liste n'a de sens que couplée aux fonctions
// de ce fichier (olThemeForCategory notamment), contrairement aux
// championnats LIVE! qui n'ont aucune dépendance vers live.js lui-même.
// `espnSportPath`/`espnSlug` (2026-09-06, sur demande explicite, BUG 1 —
// menu déroulant Équipe plafonné à 10 équipes) : identifient le même
// championnat côté ESPN (site.api.espn.com), utilisés par config.js pour
// lister les équipes SANS le plafond de 10 imposé par TheSportsDB
// `search_all_teams.php` (clé démo gratuite "3" — vérifié en direct,
// confirmé aussi documenté comme limite connue de cette clé) ainsi que par
// fetchLeagueScoreboardNextMatch ci-dessous (BUG 3 PART B). Repris tels
// quels des slugs déjà vérifiés ailleurs dans ce fichier (voir
// ESPN_SPORT_LEAGUES/STANDINGS_LEAGUES) plutôt que redevinés.
const KNOWN_LEAGUES = [
  {
    value: 'fra.ligue1',
    label: '🇫🇷 Ligue 1',
    sport: 'football',
    theSportsDbLeague: 'French Ligue 1',
    espnSportPath: 'soccer',
    espnSlug: 'fra.1',
  },
  {
    value: 'fra.ligue2',
    label: '🇫🇷 Ligue 2',
    sport: 'football',
    theSportsDbLeague: 'French Ligue 2',
    espnSportPath: 'soccer',
    espnSlug: 'fra.2',
  },
  {
    value: 'betclic.elite',
    label: '🇫🇷 Betclic Élite',
    sport: 'basketball',
    // "French Pro A Basketball" (1re tentative) ne renvoie AUCUNE équipe
    // sur search_all_teams.php — vérifié en direct le 2026-09-05. Le VRAI
    // nom TheSportsDB de cette ligue est "French LNB" (voir
    // search_all_leagues.php?c=France&s=Basketball, idLeague 4423 :
    // "The LNB Élite, currently known for sponsorship reasons as Betclic
    // Élite" — Betclic Élite n'est qu'un nom de sponsor, pas le nom de
    // ligue enregistré) ; confirmé en direct : 10 équipes renvoyées
    // (AS Monaco Basket, Boulazac, Cholet, Dijon...).
    theSportsDbLeague: 'French LNB',
    espnSportPath: 'basketball',
    espnSlug: 'fra.lnb',
  },
  {
    value: 'nba',
    label: '🇺🇸 NBA',
    sport: 'basketball',
    theSportsDbLeague: 'NBA',
    espnSportPath: 'basketball',
    espnSlug: 'nba',
  },
];
window.MatinModules.olKnownLeagues = KNOWN_LEAGUES;

// idTeam TheSportsDB connu à la main (2026-09-06, sur demande explicite,
// BUG 3 — PSG : "Prochain match: Indisponible", eventslast.php/eventsnext.php
// vides pour l'idTeam résolu) — même pattern que CLUB_WEBSITE_OVERRIDES
// ci-dessus, mais pour l'ID lui-même plutôt que le site officiel.
// Vérifié EN DIRECT contre l'API réelle (curl, 2026-09-06) : `searchteams.php`
// est franchement PEU FIABLE pour ce club précis — "PSG" seul renvoie une
// équipe d'ESPORTS (League of Legends) homonyme, "Paris" seul renvoie un
// club amateur sans rapport ("Paris 15"), ET "Paris Saint-Germain" (AVEC le
// tiret, forme la plus probable saisie/renvoyée par ESPN) ne renvoie
// STRICTEMENT RIEN (`{"teams":null}`) — seule la forme SANS tiret ("Paris
// Saint Germain") résout la bonne équipe. idTeam **133714** confirmé avec un
// historique ET un calendrier exploitables (eventslast.php → "Paris
// Saint-Germain vs Aston Villa, 2-1, FT" ; eventsnext.php → "Paris
// Saint-Germain vs Monaco"). L'idTeam "73" (donnée de départ de cette
// demande) a été vérifié INVALIDE : `lookupteam.php?id=73` renvoie
// `{"teams":null}`, ne correspond à aucune équipe existante — corrigé ici
// vers la valeur réellement vérifiée plutôt que reproduit tel quel.
// Appliqué AVANT tout appel réseau (voir fetchTeamId ci-dessous) : recherche
// par nom entièrement court-circuitée dès qu'un mot-clé correspond, pas
// seulement une correction après coup du résultat.
const CLUB_ID_OVERRIDES = [
  { keyword: 'psg', idTeam: '133714', strSport: 'Soccer', strLeague: 'French Ligue 1' },
  { keyword: 'paris saint-germain', idTeam: '133714', strSport: 'Soccer', strLeague: 'French Ligue 1' },
  { keyword: 'paris saint germain', idTeam: '133714', strSport: 'Soccer', strLeague: 'French Ligue 1' },
];

function resolveClubIdOverride(team) {
  const t = (team || '').toLowerCase();
  return CLUB_ID_OVERRIDES.find(o => t.includes(o.keyword)) || null;
}
// Exposée à config.js (2026-09-06, sur demande explicite) — le menu déroulant
// Équipe (voir sportsTeamOptionsHtml/teamSelect dans config.js) résout lui
// aussi un idTeam TheSportsDB par nom une fois l'équipe choisie dans la
// liste ESPN (voir BUG 1 ci-dessus) : sans cette même correction là-bas,
// choisir "Paris Saint-Germain" dans le menu déroulant retomberait sur le
// même mauvais idTeam que la saisie en texte libre, une seule source de
// vérité pour l'override plutôt que deux copies à maintenir en parallèle.
window.MatinModules.olResolveClubIdOverride = resolveClubIdOverride;

// Lookup direct par idTeam (2026-09-05, sur demande explicite — menu
// déroulant ligue/équipe ci-dessus) : l'idTeam est déjà connu dans ce cas
// (choisi dans un menu, pas deviné par une recherche approximative de nom
// comme fetchTeamId) — `lookupteam.php` (id exact) plutôt que
// `searchteams.php` (nom approximatif) pour récupérer strSport/le site
// officiel du club, seules données encore nécessaires ici (thème de la carte
// + lien cliquable, voir render() plus bas) et délibérément PAS stockées en
// config (voir la forme { idTeam, team, sport, manualLeague }, sans
// `website` — demande explicite).
async function fetchTeamMeta(idTeam, team) {
  const res = await fetch(`${SPORTSDB_BASE}/lookupteam.php?id=${encodeURIComponent(idTeam)}`);
  if (!res.ok) throw new Error(`Lookup équipe KO (${res.status})`);
  const data = await res.json();
  console.log(`[Sports] lookupteam.php?id=${idTeam} →`, data);
  const found = data.teams?.[0];
  if (!found) throw new Error(`idTeam ${idTeam} introuvable sur TheSportsDB (lookupteam.php)`);

  const overrideUrl = resolveWebsiteOverride(team);
  if (overrideUrl) {
    console.log(`[Sports] Site officiel forcé (override connu) pour "${team}" : ${overrideUrl} (TheSportsDB renvoyait : ${found.strWebsite || '—'})`);
  }
  return { strSport: found.strSport, website: overrideUrl || normalizeWebsiteUrl(found.strWebsite) };
}

window.MatinModules.ol = {
  async render(container, config, _google, setBadge) {
    const team = config?.team?.trim() || DEFAULT_TEAM;
    // Sport manuel choisi dans Paramètres (2026-09-01, sur demande explicite
    // — voir sports-sources.js MANUAL_SPORT_OPTIONS) : même lecture que
    // fetchNewsItems ci-dessous, mais nécessaire ICI en plus pour que
    // résultats/calendrier (pas seulement les actualités) en tiennent
    // compte — voir `expectedCategoryHint`/`sportCategory` plus bas.
    const manualSport = config?.sport || undefined;
    setBadge(''); // le titre de la carte affiche déjà l'équipe

    container.innerHTML = `
      <div class="sports-module">
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

    const nextSlot = container.querySelector('#sports-next-slot');
    const tickerSlot = container.querySelector('#sports-ticker-slot');

    // Calendrier (TheSportsDB + ESPN)
    try {
      // Connu AVANT même d'interroger TheSportsDB (sport manuel, ou déduit du
      // nom d'équipe — ex. "Basket" dans "Monaco Basket") : sert à choisir le
      // bon candidat parmi plusieurs homonymes possibles (voir fetchTeamId).
      const expectedCategoryHint = manualSport
        ? (manualSport === 'autre' ? null : manualSport)
        : window.SportsSources.detectCategoryFromTeamName(team);
      let idTeam, strSport, website;
      if (config?.idTeam) {
        // idTeam déjà connu (menu déroulant ligue/équipe, voir KNOWN_LEAGUES
        // plus haut) — searchteams.php (recherche approximative par nom, voir
        // fetchTeamId) entièrement court-circuité : plus aucune ambiguïté à
        // lever, l'utilisateur a choisi l'équipe exacte dans une liste, pas
        // tapé un nom.
        console.log(`[Sports] idTeam connu depuis Paramètres (${config.idTeam}) — recherche TheSportsDB par nom ignorée`);
        idTeam = config.idTeam;
        if (/^\d+$/.test(idTeam)) {
          // idTeam TheSportsDB CONFIRMÉ À LA MAIN (2026-09-08, sur demande
          // explicite — voir BETCLIC_ELITE_TEAMS/config.js STEP 1-2) :
          // lookupteam.php (fetchTeamMeta) court-circuité EN PLUS de
          // searchteams.php ci-dessus. Emplacement RETENU pour ce
          // court-circuit plutôt que dans fetchTeamId (suggéré comme piste
          // dans la demande, "ou là où la recherche TheSportsDB a lieu") :
          // fetchTeamId ne reçoit que `team`/`expectedCategory`, jamais
          // `config`, et n'est de toute façon PAS appelée dans cette branche
          // (voir le `else` plus bas) — un id purement numérique vient
          // forcément d'une source déjà vérifiée (id confirmé à la main dans
          // le menu déroulant, ou CLUB_ID_OVERRIDES), aucune raison de
          // revalider par un appel réseau supplémentaire. `website: null` —
          // ni lookupteam.php ni searchteams.php n'est appelé ici, donc
          // aucun site officiel disponible pour ces équipes tant qu'aucun
          // CLUB_WEBSITE_OVERRIDES dédié n'existe pour elles.
          console.log(`[Sports] idTeam TheSportsDB hardcodé utilisé : ${idTeam} (${team})`);
          strSport = config.sport === 'basketball' ? 'Basketball' : 'Soccer';
          website = null;
        } else {
          ({ strSport, website } = await fetchTeamMeta(idTeam, team));
        }
      } else {
        // Config historique, ou "Autre équipe" (texte libre) — comportement
        // d'origine inchangé : recherche approximative par nom.
        ({ idTeam, strSport, website } = await fetchTeamId(team, expectedCategoryHint));
      }
      // Catégorie FINALE (2026-09-01, sur demande explicite — bug
      // "Basketball vs Football cross-contamination") : même résolution que
      // pour les actualités (sport manuel > nom d'équipe > cas connus de
      // détection non fiable > `strSport` brut, voir resolveSportCategory) —
      // seule source de vérité désormais pour le THÈME de la carte ET le
      // chemin ESPN interrogé plus bas, à la place de `strSport` brut utilisé
      // séparément et sans ces garde-fous jusqu'ici.
      const sportCategory = window.SportsSources.resolveSportCategory(team, strSport, manualSport).category;
      const card = container.closest('.module-card');
      card?.setAttribute('data-theme', olThemeForCategory(sportCategory));
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
      const ctx = buildTeamContext(team);

      const nextMatchTsdb = await fetchNextMatch(idTeam).catch(() => null);

      // Chemin ESPN roster/schedule sport-dépendant (2026-09-01, sur demande
      // explicite — voir ESPN_SPORT_LEAGUES) — repli pour le prochain match
      // quand TheSportsDB `eventsnext.php` n'a rien renvoyé. `null` pour tout
      // sport sans mapping ESPN connu, comme avant.
      const espnSportKey = ESPN_SPORT_PATH_BY_CATEGORY[sportCategory] || null;
      const espnNextMatch = espnSportKey
        ? await fetchEspnSchedule(ctx, espnSportKey).catch(err => { console.warn('[Sports] fetchEspnSchedule a échoué', err); return null; })
        : null;

      // Prochain match : TheSportsDB en priorité (déjà dans le bon format,
      // et généralement à jour) ; repli sur ESPN SEULEMENT si TheSportsDB n'a
      // rien renvoyé — corrige le vrai trou signalé (voir en-tête de
      // fetchEspnSchedule) où rien d'autre que `eventsnext.php` n'alimentait
      // jamais l'affichage du prochain match.
      let nextMatch = nextMatchTsdb || espnNextMatch;
      let nextMatchSource = nextMatchTsdb ? 'thesportsdb' : (espnNextMatch ? 'espn (roster)' : null);

      // DERNIER repli — scoreboard ESPN par ligue connue (2026-09-06, sur
      // demande explicite, BUG 3 PART B — PSG : "Prochain match:
      // Indisponible" malgré une équipe bien réelle) : seulement si TheSportsDB
      // n'a RIEN renvoyé ET qu'une ligue connue a été choisie dans le menu
      // déroulant Paramètres (voir KNOWN_LEAGUES/config.js, config.manualLeague)
      // — voir fetchLeagueScoreboardNextMatch plus haut pour le détail.
      if (!nextMatch && config?.manualLeague) {
        const knownLeague = KNOWN_LEAGUES.find(l => l.value === config.manualLeague);
        if (knownLeague) {
          nextMatch = await fetchLeagueScoreboardNextMatch(knownLeague, buildTeamContext(team)).catch(err => { console.warn('[Sports] fetchLeagueScoreboardNextMatch a échoué', err); return null; });
          if (nextMatch) nextMatchSource = 'espn (scoreboard ligue, dernier repli)';
        }
      }
      console.log('[Sports] Prochain match retenu :', nextMatch, nextMatchSource ? `(source: ${nextMatchSource})` : '(aucune source)');

      nextSlot.innerHTML = `<span class="sports-next-label">Prochain match</span>${renderNextMatchHtml(nextMatch)}`;

      // Classement — jamais attendu avant d'afficher le prochain match
      // ci-dessus (réseau ESPN + éventuel cache expiré, pas de raison de
      // retarder le reste de la carte) : remplit le placeholder une fois prêt,
      // le laisse vide (donc invisible, voir style.css) si la compétition
      // n'est pas reconnue, si l'équipe n'apparaît dans aucun classement
      // récupéré, ou en cas d'erreur réseau.
      const league = nextMatch ? detectStandingsLeague(nextMatch.strLeague) : null;
      if (league) {
        fetchTeamStandingLine(league, buildTeamContext(team))
          .then((line) => {
            if (!line) return;
            const slot = container.querySelector('#sports-standings-slot');
            if (slot) slot.textContent = line;
          })
          .catch((err) => console.warn(`[Sports] Classement ${league.slug} indisponible`, err));
      }
    } catch (err) {
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

      // Heure de publication à côté de la source (2026-09-01, sur demande
      // explicite, "L'ÉQUIPE · 14h32") — `.sports-ticker-time` imbriqué
      // ANNULE explicitement le `text-transform:uppercase` hérité de
      // `.sports-ticker-source` (voir style.css) : sans lui, "14h32"
      // deviendrait "14H32" (le "h" minuscule capitalisé avec le reste du
      // libellé), ce qui n'est pas le format demandé.
      const itemsHtml = items.map((item) => {
        const timeLabel = formatArticleTime(item.pubDate);
        const sourceHtml = item.sourceLabel
          ? `<span class="sports-ticker-source">${item.sourceLabel}${timeLabel ? ` · <span class="sports-ticker-time">${timeLabel}</span>` : ''}</span>`
          : '';
        return `<div class="sports-ticker-vitem" data-link="${item.link}">${sourceHtml}${item.title}</div>`;
      }).join('');

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
