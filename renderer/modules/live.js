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
const LIVE_EQUIPE_URL = 'https://www.lequipe.fr/Football/';

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

function liveNormalizeEspnEvent(event, leagueLabel) {
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
  return {
    id: `espn-${competition.id || event.id}`,
    league: leagueLabel,
    date: new Date(event.date),
    state: statusType.state || 'pre',
    detail: statusType.shortDetail || statusType.detail || '',
    homeName: home.team?.shortDisplayName || home.team?.displayName || '?',
    homeScore: home.score ?? null,
    homeLogo: home.team?.logo || null,
    awayName: away.team?.shortDisplayName || away.team?.displayName || '?',
    awayScore: away.score ?? null,
    awayLogo: away.team?.logo || null,
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
    .map(ev => liveNormalizeEspnEvent(ev, champ.label))
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
    .map(ev => liveNormalizeEspnEvent(ev, champ.label))
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
  return `
    <div class="live-match-row ${isLive ? 'live-match-row-live' : ''}">
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
      container.addEventListener('click', (e) => {
        if (e.target.closest('.live-match-row')) window.matin.shell.openExternal(LIVE_EQUIPE_URL);
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
