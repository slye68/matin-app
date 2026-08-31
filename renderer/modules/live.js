/**
 * Module LIVE! — scores en direct Football (2026-08-11, sur demande explicite
 * — remplace la 1re version multi-sports du même jour, entièrement recentrée
 * sur le football club/championnat par l'utilisateur juste après).
 *
 * Deux modes (config.mode), sélectionnés dans Paramètres :
 *  - 'club'   ("Mon club uniquement") — cherche les matchs du club saisi,
 *    QUEL QUE SOIT le championnat (TheSportsDB `searchteams.php` puis
 *    `eventsnext.php`/`eventslast.php` sur l'ID trouvé — API centrée club,
 *    plus robuste ici qu'un scraping de championnat entier pour y retrouver
 *    un seul nom, et gère nativement les championnats sans couverture ESPN
 *    comme National). Le dropdown "Mon championnat" sert uniquement à
 *    départager plusieurs clubs homonymes dans les résultats de recherche.
 *  - 'league' ("Tout le championnat") — scoreboard ESPN complet du
 *    championnat sélectionné (8 des 10 entrées du dropdown ont un endpoint
 *    ESPN vérifié en direct ; National/Autre n'en ont pas — repli
 *    TheSportsDB par nom de championnat pour National, message explicite
 *    pour Autre qui n'a aucune source identifiable).
 *
 * Si aucun match aujourd'hui (les deux modes) : le prochain match à venir
 * est affiché à la place, avec sa date/heure plutôt qu'un score.
 */
window.MatinModules = window.MatinModules || {};

const LIVE_REFRESH_LIVE_MS = 60 * 1000;
const LIVE_REFRESH_IDLE_MS = 5 * 60 * 1000;

// Clic sur un match — URL SPÉCIFIQUE à CE match plutôt que la page d'accueil
// L'Équipe fixe (2026-08-30/31, sur demande explicite). TheSportsDB (mode
// club/National) n'expose aucune page de match dans son API gratuite : repli
// direct sur une recherche Google construite à partir des noms d'équipe.
function liveGoogleFallbackUrl(homeName, awayName) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${homeName} ${awayName} score direct`)}`;
}

// ─── Construction de l'URL L'Équipe pour un match ESPN (2026-08-31, sur
// demande explicite, remplace le repli sur `event.links` du 2026-08-30 —
// l'API ESPN n'a pas pu être vérifiée en direct depuis l'environnement de
// développement, bloquée en 403 par son pare-feu Akamai ; cette approche ne
// dépend, elle, que des champs déjà exploités par ce module) ─────────────
// Format demandé : lequipe.fr/Football/match-direct/{competition}/{saison}/
// {equipe1}-{equipe2}-live/{matchId} — best-effort assumé : l'ID de match
// L'Équipe ne correspond structurellement PAS à l'ID ESPN utilisé ici en
// repli, donc l'URL construite peut très bien 404. Vérifiée en direct (voir
// wireControls plus bas) AVANT ouverture — 404 → repli Google avec l'indice
// "lequipe.fr" (demandé explicitement), jamais un lien mort envoyé à
// l'utilisateur.
const LIVE_LEQUIPE_COMPETITION_SLUGS = {
  'soccer/fra.1':           'ligue-1',
  'soccer/fra.2':           'ligue-2',
  'soccer/uefa.champions':  'champions-league',
  'soccer/uefa.europa':     'europa-league',
  'soccer/esp.1':           'liga',
  'soccer/eng.1':           'premier-league',
  'soccer/ger.1':           'bundesliga',
  'soccer/ita.1':           'serie-a',
};

// Saison française "AAAA-AAAA+1" — démarre en août, donc juillet (mois
// index 6) bascule déjà sur la saison à venir plutôt que la précédente.
function liveCurrentSeason() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

// "Olympique Lyonnais" → "olympique-lyonnais" mécaniquement — pas de table
// de correspondance vers les surnoms courts type "lyon" (aucune règle
// générale fiable sans dictionnaire par club à maintenir à la main) : accepté
// comme limite connue de cette heuristique, compensée par la vérification
// 404 + repli Google juste après.
function liveSlugifyTeam(name) {
  return (name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function liveBuildLequipeUrl(espnKey, homeName, awayName, matchId) {
  const competition = LIVE_LEQUIPE_COMPETITION_SLUGS[espnKey];
  const team1 = liveSlugifyTeam(homeName);
  const team2 = liveSlugifyTeam(awayName);
  if (!competition || !team1 || !team2 || !matchId) return null;
  return `https://www.lequipe.fr/Football/match-direct/${competition}/${liveCurrentSeason()}/${team1}-${team2}-live/${matchId}`;
}

function liveGoogleLequipeFallbackUrl(homeName, awayName) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${homeName} ${awayName} lequipe.fr direct`)}`;
}

// Liste des championnats : voir live-championships.js (partagé avec
// config.js, chargé avant ce fichier dans index.html).
function liveChampionship(key) {
  const list = window.LiveChampionships || [];
  return list.find(c => c.key === key) || list[0];
}

function liveIsToday(date) {
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}
function liveDateStamp(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
// Pas de `timeZone` explicite ici (2026-08-24, sur demande explicite —
// retiré après un rapport persistant de décalage) : omis, toLocaleTimeString
// utilise DÉJÀ le fuseau système par défaut (strictement équivalent à passer
// Intl.DateTimeFormat().resolvedOptions().timeZone explicitement — ce n'était
// donc pas la cause du décalage observé, mais gardé simple comme demandé).
// La VRAIE cause était en amont, dans le parsing de `date` lui-même — voir
// liveNormalizeTsdbEvent plus bas.
function liveFmtNextDateTime(date) {
  const datePart = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const timePart = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  console.log('[Live] Heure UTC brute :', date.toISOString(), '→ heure locale convertie :', timePart);
  return `${datePart}, ${timePart}`;
}
function liveFmtTime(date) {
  const timePart = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  console.log('[Live] Heure UTC brute :', date.toISOString(), '→ heure locale convertie :', timePart);
  return timePart;
}

// ─── ESPN (mode championnat) ────────────────────────────────────────────────
async function liveFetchEspn(league, query) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard${query ? `?${query}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN ${league} ${res.status}`);
  return res.json();
}

function liveNormalizeEspnEvent(event, leagueLabel, espnKey) {
  const competition = event.competitions?.[0];
  if (!competition) return null;
  const competitors = competition.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
  if (!home || !away) return null;
  const statusType = competition.status?.type || event.status?.type || {};
  // ESPN renvoie déjà un ISO 8601 complet avec `Z` (ex. "2026-08-26T19:00Z")
  // — `new Date(...)` l'interprète donc correctement comme UTC sans
  // normalisation nécessaire, contrairement à TheSportsDB (voir
  // liveParseTsdbUtc plus haut) ; log gardé quand même pour vérification.
  console.log('[Live] Heure brute API (ESPN, UTC) :', event.date);
  const homeName = home.team?.shortDisplayName || home.team?.displayName || '?';
  const awayName = away.team?.shortDisplayName || away.team?.displayName || '?';
  const espnEventId = competition.id || event.id;
  // URL L'Équipe construite (2026-08-31, sur demande explicite) — best-effort,
  // vérifiée en direct au clic avant ouverture (voir wireControls) : null ici
  // si la ligue n'a pas de slug connu (voir LIVE_LEQUIPE_COMPETITION_SLUGS),
  // géré par le repli Google générique au rendu dans ce cas.
  const lequipeUrl = liveBuildLequipeUrl(espnKey, homeName, awayName, espnEventId);
  return {
    id: `espn-${espnEventId}`,
    league: leagueLabel,
    date: new Date(event.date),
    state: statusType.state || 'pre',
    detail: statusType.shortDetail || statusType.detail || '',
    homeName,
    homeScore: home.score ?? null,
    homeLogo: home.team?.logo || null,
    awayName,
    awayScore: away.score ?? null,
    awayLogo: away.team?.logo || null,
    matchUrl: lequipeUrl,
    needsUrlCheck: !!lequipeUrl,
  };
}

async function liveFetchLeagueEspn(champ) {
  // Le scoreboard SANS paramètre `dates` ne renvoie pas forcément les
  // matchs du jour — vérifié en direct : pour une ligue sans match
  // aujourd'hui, il renvoie quand même la PROCHAINE journée programmée
  // (ex. Ligue 1 un jour sans match a renvoyé un match 10 jours plus tard
  // comme seul événement). Filtrer explicitement par `liveIsToday` plutôt
  // que de supposer que la réponse par défaut est déjà bornée à aujourd'hui.
  const data = await liveFetchEspn(champ.espn);
  const todayMatches = (data.events || [])
    .map(ev => liveNormalizeEspnEvent(ev, champ.label, champ.espn))
    .filter(m => m && liveIsToday(m.date));
  if (todayMatches.length) return { matches: todayMatches, isNext: false };

  // Rien aujourd'hui : cherche le prochain match sur les 30 jours à venir
  // (vérifié en direct : le paramètre `dates=YYYYMMDD-YYYYMMDD` fonctionne
  // sur cet endpoint, contrairement à une simple supposition).
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + 30);
  const data2 = await liveFetchEspn(champ.espn, `dates=${liveDateStamp(today)}-${liveDateStamp(future)}`);
  const now = Date.now();
  const upcoming = (data2.events || [])
    .map(ev => liveNormalizeEspnEvent(ev, champ.label, champ.espn))
    .filter(m => m && m.date.getTime() >= now)
    .sort((a, b) => a.date - b.date);
  return { matches: upcoming.slice(0, 1), isNext: true };
}

// ─── TheSportsDB (mode club, + repli National/mode championnat) ────────────
const TSDB_STATUS_LIVE = /^\d+('|H|min)|HT|ET|LIVE|Q[1-4]|OT/i;
const TSDB_STATUS_DONE = /FT|AET|PEN|Final|AOT/i;

async function liveTsdbGet(path) {
  const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/${path}`);
  if (!res.ok) throw new Error(`TheSportsDB ${path} ${res.status}`);
  return res.json();
}

// TheSportsDB documente `strTimestamp`/`dateEvent`+`strTime` comme étant en
// UTC, mais AUCUN des deux ne porte de marqueur de fuseau dans la chaîne
// elle-même — sans ça, `new Date(...)` les interprète comme une heure LOCALE
// (règle du spec ECMAScript pour une chaîne datetime sans fuseau), pas comme
// de l'UTC, décalant l'heure affichée de tout le fuseau de l'utilisateur.
// `strTimestamp` en particulier est formaté "AAAA-MM-JJ HH:MM:SS" (espace,
// pas de 'T' ni de 'Z') — 2026-08-23, 1er correctif : seul le repli
// `dateEvent`+`strTime` avait été corrigé, `strTimestamp` (prioritaire via le
// `||` ci-dessous, donc utilisé en pratique dès qu'il est présent) gardait
// EXACTEMENT le même bug, d'où le rapport "OL-Fenerbahçe affiché 19h au lieu
// de 21h" malgré le 1er correctif — confirmé en direct (log ci-dessous).
function liveParseTsdbUtc(rawTimestamp, dateEvent, strTime) {
  const raw = rawTimestamp || `${dateEvent}T${strTime || '00:00:00'}`;
  const iso = raw.trim().replace(' ', 'T');
  const withZ = /Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  console.log('[Live] Heure brute API (TheSportsDB, supposée UTC) :', raw, '→ normalisée :', withZ);
  return new Date(withZ);
}

function liveNormalizeTsdbEvent(ev) {
  const home = ev.strHomeTeam, away = ev.strAwayTeam;
  if (!home || !away) return null;
  const status = ev.strStatus || '';
  let state = 'pre';
  if (TSDB_STATUS_DONE.test(status)) state = 'post';
  else if (status && TSDB_STATUS_LIVE.test(status)) state = 'in';
  return {
    id: `tsdb-${ev.idEvent}`,
    league: ev.strLeague || '',
    date: liveParseTsdbUtc(ev.strTimestamp, ev.dateEvent, ev.strTime),
    state,
    detail: status || (state === 'pre' ? 'À venir' : ''),
    homeName: home,
    homeScore: ev.intHomeScore,
    homeLogo: ev.strHomeTeamBadge || null,
    awayName: away,
    awayScore: ev.intAwayScore,
    awayLogo: ev.strAwayTeamBadge || null,
    // TheSportsDB (mode club/National) n'expose aucun lien de page de match
    // dans son API gratuite — toujours le repli Google (voir liveMatchRowHtml).
    matchUrl: null,
    needsUrlCheck: false,
  };
}

// Le dropdown "Mon championnat" sert seulement à départager des clubs
// homonymes (ex. plusieurs "Bordeaux" dans des pays différents) — repli sur
// le 1er résultat si aucun ne correspond au championnat choisi.
function liveTsdbPickTeam(teams, champLabel) {
  if (!teams?.length) return null;
  if (champLabel) {
    const norm = (s) => (s || '').toLowerCase();
    const match = teams.find(t => norm(t.strLeague).includes(norm(champLabel)));
    if (match) return match;
  }
  return teams[0];
}

async function liveFetchClubTsdb(clubName, champLabel) {
  const search = await liveTsdbGet(`searchteams.php?t=${encodeURIComponent(clubName)}`);
  const team = liveTsdbPickTeam(search.teams, champLabel);
  if (!team) return { matches: [], isNext: false, notFound: true };

  const [next, last] = await Promise.all([
    liveTsdbGet(`eventsnext.php?id=${team.idTeam}`).catch(() => ({ events: [] })),
    liveTsdbGet(`eventslast.php?id=${team.idTeam}`).catch(() => ({ events: [] })),
  ]);
  const candidates = [...(next.events || []), ...(last.events || [])]
    .map(liveNormalizeTsdbEvent)
    .filter(Boolean);

  const today = candidates.filter(m => liveIsToday(m.date));
  if (today.length) return { matches: today, isNext: false };

  const now = Date.now();
  const upcoming = candidates.filter(m => m.date.getTime() >= now).sort((a, b) => a.date - b.date);
  return { matches: upcoming.slice(0, 1), isNext: true };
}

// Repli National (mode championnat, pas de slug ESPN) — filtre le flux du
// jour toutes ligues confondues par nom de championnat approximatif ; se
// dégrade proprement en liste vide (→ "aucun match") si rien ne correspond,
// jamais une erreur.
async function liveFetchLeagueTsdbNational() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await liveTsdbGet(`eventsday.php?d=${today}&s=Soccer`);
  const matches = (data.events || [])
    .filter(ev => /national/i.test(ev.strLeague || '') && /fr/i.test(ev.strLeague || ''))
    .map(liveNormalizeTsdbEvent)
    .filter(Boolean);
  return { matches, isNext: false };
}

async function liveFetchLeague(championshipKey) {
  const champ = liveChampionship(championshipKey);
  if (champ.espn) return liveFetchLeagueEspn(champ);
  if (champ.key === 'national') return liveFetchLeagueTsdbNational();
  return { matches: [], isNext: false, unsupported: true }; // 'autre'
}

// ─── Rendu ───────────────────────────────────────────────────────────────
function liveTeamLogoHtml(logo, name) {
  if (logo) return `<img class="live-team-logo" src="${logo}" alt="" loading="lazy">`;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return `<div class="live-team-logo live-team-logo-empty">${initial}</div>`;
}

function liveMatchRowHtml(m, isNext) {
  const isLive = m.state === 'in';
  const timeLabel = isNext
    ? liveFmtNextDateTime(m.date)
    : (isLive ? (m.detail || 'En direct') : (m.state === 'post' ? (m.detail || 'Terminé') : liveFmtTime(m.date)));
  // URL par match (2026-08-30/31) : URL L'Équipe construite s'il y en a une
  // (voir liveNormalizeEspnEvent/liveBuildLequipeUrl, mode championnat
  // seulement), sinon recherche Google directement (mode club/National) —
  // jamais la même URL fixe pour tous les matchs comme avant le 2026-08-30.
  // `data-needs-check` : l'URL L'Équipe est un best-effort (ID de match
  // deviné, voir liveBuildLequipeUrl) — vérifiée au clic avant ouverture
  // (voir wireControls plus bas), repli sur `data-fallback-url` si 404.
  const clickUrl = m.matchUrl || liveGoogleFallbackUrl(m.homeName, m.awayName);
  const fallbackUrl = m.matchUrl ? liveGoogleLequipeFallbackUrl(m.homeName, m.awayName) : clickUrl;
  return `
    <div class="live-match-row ${isLive ? 'live-match-row-live' : ''}" data-match-url="${clickUrl}" data-fallback-url="${fallbackUrl}" data-needs-check="${m.needsUrlCheck ? '1' : '0'}">
      <div class="live-match-meta">
        ${isLive ? '<span class="live-dot"></span>' : ''}
        <span class="live-match-time">${isNext ? 'Prochain match — ' : ''}${timeLabel}</span>
        <span class="live-match-league">${m.league}</span>
      </div>
      <div class="live-match-teams">
        ${liveTeamLogoHtml(m.homeLogo, m.homeName)}
        <span class="live-match-team" title="${m.homeName}">${m.homeName}</span>
        <span class="live-match-score ${isLive ? 'live-match-score-live' : ''}">${isNext ? 'vs' : `${m.homeScore ?? '—'} - ${m.awayScore ?? '—'}`}</span>
        <span class="live-match-team live-match-team-away" title="${m.awayName}">${m.awayName}</span>
        ${liveTeamLogoHtml(m.awayLogo, m.awayName)}
      </div>
    </div>`;
}

function liveRenderModule(container, result, config) {
  if (result.notFound) {
    container.innerHTML = `<div class="etf-empty">Club "${config.club}" introuvable — vérifiez l'orthographe dans Paramètres.</div>`;
    return;
  }
  if (result.unsupported) {
    container.innerHTML = `<div class="etf-empty">Championnat "Autre" non pris en charge en mode "Tout le championnat" — choisissez un championnat de la liste, ou passez en mode "Mon club".</div>`;
    return;
  }
  if (!result.matches.length) {
    container.innerHTML = `<div class="etf-empty">Aucun match prévu pour le moment.</div>`;
    return;
  }
  container.innerHTML = `<div class="live-match-list">${result.matches.map(m => liveMatchRowHtml(m, result.isNext)).join('')}</div>`;
}

window.MatinModules.live = {
  async render(container, config, _google, setBadge) {
    const mode = config?.mode === 'league' ? 'league' : 'club';
    const club = (config?.club || '').trim();
    const championshipKey = config?.championship || 'ligue1';

    if (mode === 'club' && !club) {
      container.innerHTML = `<div class="etf-empty">Aucun club renseigné — configurez "Mon club" dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    if (!container.dataset.liveClickBound) {
      // URL L'Équipe construite = best-effort (voir liveBuildLequipeUrl) —
      // vérifiée AVANT ouverture via le même proxy main process que les flux
      // RSS (`rss:fetchFeed`, jette sur tout statut non-2xx) : réutilisé ici
      // tel quel plutôt que d'ajouter un canal IPC dédié pour un simple test
      // d'existence de page. 404 (ou toute autre erreur) → repli Google avec
      // l'indice "lequipe.fr" (demandé explicitement), jamais un lien mort.
      container.addEventListener('click', async (e) => {
        const row = e.target.closest('.live-match-row');
        const url = row?.dataset.matchUrl;
        if (!url) return;
        if (row.dataset.needsCheck !== '1') {
          window.matin.shell.openExternal(url);
          return;
        }
        try {
          await window.matin.rss.fetchFeed(url);
          window.matin.shell.openExternal(url);
        } catch (err) {
          console.warn('[Live] URL L\'Équipe invalide, repli Google :', url, err.message);
          window.matin.shell.openExternal(row.dataset.fallbackUrl);
        }
      });
      container.dataset.liveClickBound = '1';
    }

    // setTimeout auto-réajustable (PAS setInterval) : le délai change selon
    // qu'un match est en direct ou non (60s / 5min, demandé explicitement).
    let timerId = null;
    async function loadAndRender() {
      console.log('[Live] Récupération des scores en direct…');
      setBadge('…');
      try {
        const champLabel = liveChampionship(championshipKey).label;
        const result = mode === 'club'
          ? await liveFetchClubTsdb(club, champLabel)
          : await liveFetchLeague(championshipKey);

        liveRenderModule(container, result, { club, championshipKey });
        const liveCount = (result.matches || []).filter(m => m.state === 'in').length;
        setBadge(liveCount ? `🔴 ${liveCount}` : (result.matches?.length ? (result.isNext ? '📅' : `${result.matches.length}`) : '—'));

        clearTimeout(timerId);
        timerId = setTimeout(loadAndRender, liveCount ? LIVE_REFRESH_LIVE_MS : LIVE_REFRESH_IDLE_MS);
      } catch (err) {
        console.error('[Live] Erreur de rendu', err);
        container.innerHTML = `<span class="module-error">⚠ Erreur de chargement</span>`;
        setBadge('⚠');
        clearTimeout(timerId);
        timerId = setTimeout(loadAndRender, LIVE_REFRESH_IDLE_MS);
      }
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    await loadAndRender();
  },
};
