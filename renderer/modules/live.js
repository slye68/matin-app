/**
 * Module LIVE FOOT! — scores en direct Football (2026-09-04, réécriture
 * complète — remplace l'ancienne implémentation TheSportsDB + ESPN mixte,
 * URLs L'Équipe/Flashscore devinées ; mode "Équipe" retiré ENTIÈREMENT le
 * 2026-09-05, sur demande explicite — simplification, un seul mode reste).
 * Source UNIQUE : l'API publique ESPN "site API" scoreboard (déjà utilisée
 * pour le classement dans Sports/ol.js), toujours via le proxy process main
 * (`window.matin.rss.fetchFeed`, ESPN bloque le fetch direct depuis le
 * renderer — pas d'en-têtes CORS).
 *
 * Un seul mode : suit TOUTE une journée d'un seul championnat/coupe
 * (config.competitionSlug/competitionLabel) — liste de tous les matchs,
 * triés en direct → à venir → terminés. Plusieurs cartes LIVE FOOT!
 * peuvent être ajoutées côte à côte (voir dashboard.js isLiveKey/
 * config.js addLiveInstance), chacune sur sa propre compétition,
 * indépendamment l'une de l'autre (son propre fetch/rendu/minuteur —
 * aucun état partagé entre 2 instances de ce module).
 *
 * Clic sur un match : toujours une recherche Google (voir
 * liveGoogleSearchUrl) — plus aucune URL L'Équipe/Flashscore devinée (source
 * de clics qui n'ouvraient pas le bon match dans l'ancienne version).
 */
window.MatinModules = window.MatinModules || {};

const LIVE_REFRESH_LIVE_MS = 60 * 1000;
const LIVE_REFRESH_IDLE_MS = 10 * 60 * 1000;

// ─── Fetch ESPN scoreboard ───────────────────────────────────────────────
async function liveFetchScoreboard(slug) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
  console.log(`[Live Foot] Fetch scoreboard : ${url}`);
  const raw = await window.matin.rss.fetchFeed(url);
  const data = JSON.parse(raw);
  console.log(`[Live Foot] Réponse scoreboard ${slug} — ${data.events?.length ?? 0} événement(s)`);
  return data;
}

// ─── Traduction des libellés de statut ESPN (PART 8) ───────────────────────
// Correspondance EXACTE demandée — tout le reste (minutage "67'"/"90'+2'",
// etc.) passe inchangé, ESPN le fournit déjà en forme courte directement
// exploitable.
const LIVE_STATUS_FR = {
  'Half Time': 'Mi-temps',
  'Final': 'Terminé',
  'Full Time': 'Terminé',
  'Postponed': 'Reporté',
  'Canceled': 'Annulé',
};
function liveTranslateStatusDetail(detail) {
  return LIVE_STATUS_FR[detail] || detail;
}

function liveCompetitionLabel(slug) {
  return liveCompetitionBySlug(slug)?.label || slug;
}

// Normalise UN événement ESPN en objet "match" plat.
function liveNormalizeEvent(event, slug) {
  const competition = event.competitions?.[0];
  if (!competition) return null;
  const competitors = competition.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
  if (!home || !away) return null;
  const statusType = competition.status?.type || event.status?.type || {};
  return {
    id: `${slug}-${competition.id || event.id}`,
    slug,
    competitionLabel: liveCompetitionLabel(slug),
    date: new Date(event.date), // ESPN renvoie un ISO 8601 complet avec `Z` — interprété correctement comme UTC par `new Date(...)`, sans normalisation nécessaire.
    state: statusType.state || 'pre', // 'pre' | 'in' | 'post'
    detail: liveTranslateStatusDetail(statusType.detail || statusType.shortDetail || ''),
    homeName: home.team?.displayName || home.team?.shortDisplayName || home.team?.abbreviation || '?',
    homeScore: home.score != null && home.score !== '' ? Number(home.score) : null,
    awayName: away.team?.displayName || away.team?.shortDisplayName || away.team?.abbreviation || '?',
    awayScore: away.score != null && away.score !== '' ? Number(away.score) : null,
  };
}

// ─── Compétition (mode unique) ──────────────────────────────────────────
async function liveFetchCompetitionMode(config) {
  console.log(`[Live Foot] Mode compétition — slug="${config.competitionSlug}"`);
  const data = await liveFetchScoreboard(config.competitionSlug);
  const matches = (data.events || []).map(ev => liveNormalizeEvent(ev, config.competitionSlug)).filter(Boolean);

  const live = matches.filter(m => m.state === 'in');
  const pre = matches.filter(m => m.state === 'pre').sort((a, b) => a.date - b.date);
  const post = matches.filter(m => m.state === 'post').sort((a, b) => b.date - a.date);
  const sorted = [...live, ...pre, ...post].slice(0, 20);
  console.log(`[Live Foot] Mode compétition — ${matches.length} match(es), ${sorted.length} affiché(s) (${live.length} en direct)`);

  return { matches: sorted };
}

// ─── Formatage date/heure (fr-FR) ──────────────────────────────────────────
function liveFmtTime(date) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
// En-tête de séparateur de date — "Mercredi 17 septembre".
function liveFmtDateSeparator(date) {
  const s = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Clé de regroupement par JOUR (pas d'heure) — sert à détecter un changement
// de jour entre 2 matchs consécutifs déjà triés chronologiquement (mode
// Compétition, voir liveCompetitionModeHtml).
function liveDayKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

// ─── Clic sur un match — PART 4 ─────────────────────────────────────────
function liveGoogleSearchUrl(homeTeam, awayTeam) {
  const q = `${homeTeam} ${awayTeam} score live`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// ─── Rendu : une ligne de la journée ────────────────────────────────────
// Pas de nom de compétition par ligne (déjà annoncé une fois dans l'en-tête,
// voir liveCompetitionModeHtml) — seulement statut/heure à gauche + équipes/
// score, comme demandé.
function liveMatchCompetitionRowHtml(match) {
  const isLive = match.state === 'in';
  const isPre = match.state === 'pre';
  const isPost = match.state === 'post';
  const clickUrl = liveGoogleSearchUrl(match.homeName, match.awayName);

  const leftHtml = isLive
    ? `<span class="live-dot"></span><span class="live-match-status">${match.detail || 'En direct'}</span>`
    : isPre
      ? `<span class="live-match-status">${liveFmtTime(match.date)}</span>`
      : `<span class="live-match-status">✓ ${match.detail || 'Terminé'}</span>`;

  const scoreHtml = isPre ? 'vs' : `${match.homeScore ?? '—'} - ${match.awayScore ?? '—'}`;

  const rowClasses = ['live-match-row'];
  if (isLive) rowClasses.push('live-match-row-live');
  if (isPost) rowClasses.push('live-match-row-post');

  return `
    <div class="${rowClasses.join(' ')}" data-match-url="${clickUrl}">
      <div class="live-match-header-row">${leftHtml}</div>
      <div class="live-match-teams">
        <span class="live-match-team" title="${match.homeName}">${match.homeName}</span>
        <span class="live-match-score ${isLive ? 'live-match-score-live' : ''}">${scoreHtml}</span>
        <span class="live-match-team live-match-team-away" title="${match.awayName}">${match.awayName}</span>
      </div>
    </div>`;
}

// ─── Rendu : journée complète (mode "competition") ─────────────────────
// Pas d'en-tête compétition ICI (2026-09-06, sur demande explicite — le nom
// apparaissait en double : une fois dans l'en-tête de la carte, posé par le
// framework dashboard via `resolveModuleSubtitle`/`config.competitionLabel`,
// voir dashboard.js, et une 2e fois ici) — seulement la liste des matchs,
// avec un séparateur de date inséré chaque fois que le jour change entre 2
// matchs consécutifs (déjà triés live → à venir (chrono asc) → terminés
// (chrono desc), voir liveFetchCompetitionMode — un même jour peut donc
// apparaître 2 fois, séparément, si des matchs à venir ET des matchs déjà
// terminés tombent le même jour : accepté, cohérent avec le tri par état
// demandé en priorité).
function liveCompetitionModeHtml(matches) {
  if (!matches.length) return '<div class="etf-empty">Aucun match pour le moment.</div>';

  let lastDayKey = null;
  const rowsHtml = matches.map((m) => {
    const dayKey = liveDayKey(m.date);
    const separatorHtml = dayKey !== lastDayKey ? `<div class="live-date-separator">${liveFmtDateSeparator(m.date)}</div>` : '';
    lastDayKey = dayKey;
    return separatorHtml + liveMatchCompetitionRowHtml(m);
  }).join('');

  return `<div class="live-match-list">${rowsHtml}</div>`;
}

// ─── Badge (module réduit, coin de carte) ──────────────────────────────
// `setBadge()` (voir dashboard.js renderModuleOnce) n'écrit que le TEXTE du
// badge, aucune classe/couleur CSS possible depuis un module — un préfixe
// emoji fait donc office de couleur.
function liveCompetitionBadge(matches) {
  const liveCount = matches.filter(m => m.state === 'in').length;
  if (liveCount) return `🔴 ${liveCount}`;
  return matches.length ? String(matches.length) : '—';
}

// ─── Point d'entrée ─────────────────────────────────────────────────────
window.MatinModules.live = {
  async render(container, config, _google, setBadge) {
    if (!container.dataset.liveClickBound) {
      // URL de recherche Google Search (voir liveGoogleSearchUrl plus haut)
      // — ne dépend d'aucun identifiant de page de match deviné, donc
      // ouverture directe au clic, sans vérification préalable.
      container.addEventListener('click', (e) => {
        const row = e.target.closest('.live-match-row');
        const url = row?.dataset.matchUrl;
        if (!url) return;
        console.log(`[Live Foot] Ouverture recherche Google : ${url}`);
        window.matin.shell.openExternal(url);
      });
      container.dataset.liveClickBound = '1';
    }

    // Un `setInterval` précédent (re-render() déclenché par le bouton
    // "Actualiser" du titrebar, voir dashboard.js) est arrêté avant d'en
    // reposer un — sinon chaque clic empilerait un minuteur de plus (fuite
    // qui s'aggrave à chaque clic, jamais nettoyée).
    if (container.dataset.liveIntervalId) {
      clearInterval(Number(container.dataset.liveIntervalId));
      delete container.dataset.liveIntervalId;
    }

    async function loadAndRender() {
      console.log('[Live Foot] Chargement', config);
      setBadge('…');
      try {
        if (!config?.competitionSlug) {
          container.innerHTML = '<div class="etf-empty">Configurez une compétition dans Paramètres.</div>';
          setBadge('—');
          return false;
        }
        const { matches } = await liveFetchCompetitionMode(config);
        container.innerHTML = liveCompetitionModeHtml(matches);
        setBadge(liveCompetitionBadge(matches));
        return matches.some(m => m.state === 'in');
      } catch (err) {
        console.error('[Live Foot] Erreur de chargement', err);
        container.innerHTML = '<span class="module-error">⚠ Erreur de chargement</span>';
        setBadge('⚠');
        return false;
      }
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    const hasLive = await loadAndRender();

    // Cadence FIXÉE à la fin du rendu initial (60s si un match suivi est en
    // direct maintenant, sinon 10 min) — PAS recalculée à chaque tick : un
    // match qui bascule "à venir"→"en direct" entre 2 cycles attendra le
    // cycle en cours avant de passer au rythme rapide, compromis accepté
    // pour un timer `setInterval` unique plutôt qu'une chaîne de
    // `setTimeout` auto-ajustable (demandé explicitement, PART 5).
    const intervalId = setInterval(async () => {
      if (!document.body.contains(container)) {
        console.log('[Live Foot] Conteneur retiré du DOM — arrêt du rafraîchissement automatique');
        clearInterval(intervalId);
        return;
      }
      await loadAndRender();
    }, hasLive ? LIVE_REFRESH_LIVE_MS : LIVE_REFRESH_IDLE_MS);
    container.dataset.liveIntervalId = String(intervalId);
  },
};
