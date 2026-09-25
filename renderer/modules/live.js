/**
 * Module LIVE FOOT! — scores en direct Football (2026-09-04, réécriture
 * complète — remplace l'ancienne implémentation TheSportsDB + ESPN mixte ;
 * mode "Équipe" retiré ENTIÈREMENT le 2026-09-05). Source UNIQUE : l'API
 * publique ESPN "site API" scoreboard, toujours via le proxy process main
 * (`window.matin.rss.fetchFeed`, ESPN bloque le fetch direct depuis le
 * renderer — pas d'en-têtes CORS).
 *
 * Refonte visuelle ET logique complète (2026-09-22, sur demande explicite,
 * maquette "broadcast sportif" fournie) :
 *  - look sombre dédié (voir style.css .lf-*), en-tête "FOOTBALL" en Barlow
 *    Condensed 900 avec fond dégradé + grille façon pelouse ;
 *  - quand ESPN ne renvoie aucun match "aujourd'hui" (ou seulement des
 *    matchs déjà terminés), recherche automatique du prochain jour avec au
 *    moins un match à venir, jusqu'à 30 jours — voir liveFindNextDay.
 *
 * Un seul mode : suit TOUTE une journée d'un seul championnat/coupe
 * (config.competitionSlug/competitionLabel). Plusieurs cartes LIVE FOOT!
 * peuvent être ajoutées côte à côte (voir dashboard.js isLiveKey/
 * config.js addLiveInstance), chacune sur sa propre compétition,
 * indépendamment l'une de l'autre.
 *
 * Clic sur un match : toujours une recherche Google (voir
 * liveGoogleSearchUrl).
 */
window.MatinModules = window.MatinModules || {};

const LIVE_REFRESH_LIVE_MS = 60 * 1000;
const LIVE_REFRESH_IDLE_MS = 10 * 60 * 1000;
// "Limiter l'affichage à 15 matchs maximum" (2026-09-22, sur demande
// explicite) — remplace l'ancienne limite de 20.
const LIVE_MAX_MATCHES = 15;

function liveEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── Fetch ESPN scoreboard ───────────────────────────────────────────────
// `dateKey` optionnel (YYYYMMDD, même format que liveDayKey plus bas) →
// `?dates=YYYYMMDD`. Sans lui, ESPN renvoie SA "journée courante" : quand
// aucun match n'a lieu aujourd'hui, c'est la DERNIÈRE journée jouée (vérifié
// en direct le 2026-09-21 sur fra.1 : 3 événements tous `post`) — d'où
// liveFindNextDay plus bas. Les PLAGES (`dates=YYYYMMDD-YYYYMMDD`) sont
// REFUSÉES par cet endpoint (HTTP 400, vérifié le même jour) : une requête
// par jour, obligatoirement.
async function liveFetchScoreboard(slug, dateKey) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard${dateKey ? `?dates=${dateKey}` : ''}`;
  console.log(`[Live Foot] Fetch scoreboard : ${url}`);
  const raw = await window.matin.rss.fetchFeed(url);
  const data = JSON.parse(raw);
  console.log(`[Live Foot] Réponse scoreboard ${slug}${dateKey ? ` (${dateKey})` : ''} — ${data.events?.length ?? 0} événement(s)`);
  return data;
}

// ─── Traduction des libellés de statut ESPN ────────────────────────────────
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
// `completed` (2026-09-22, sur demande explicite) — vérifié EN DIRECT sur
// l'endpoint réel (fra.1 ET uefa.nations, le 2026-09-22) : `competition.
// status.type.completed` existe tel quel, booléen, exactement comme décrit
// dans la demande — aucun écart à signaler ici, contrairement à `homeLogo`/
// `awayLogo` ci-dessous.
// `homeLogo`/`awayLogo` — `team.logo` (chaîne directe) est le champ RÉEL de
// cet endpoint (vérifié le 2026-09-22 sur les 2 compétitions ci-dessus, y
// compris pour des équipes NATIONALES — `team.logo` pointe alors vers un
// blason "pays" de type drapeau, ex. .../countries/500/and.png pour
// Andorre) : sert donc aussi de "drapeau" pour les compétitions
// internationales, sans mapping pays→emoji séparé à construire (peu fiable,
// et sans signification pour une compétition de clubs).
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
    date: new Date(event.date), // ESPN renvoie un ISO 8601 complet avec `Z`.
    state: statusType.state || 'pre', // 'pre' | 'in' | 'post'
    completed: statusType.completed === true,
    detail: liveTranslateStatusDetail(statusType.detail || statusType.shortDetail || ''),
    homeName: home.team?.displayName || home.team?.shortDisplayName || home.team?.abbreviation || '?',
    homeScore: home.score != null && home.score !== '' ? Number(home.score) : null,
    homeLogo: home.team?.logo || home.team?.logos?.[0]?.href || null,
    awayName: away.team?.displayName || away.team?.shortDisplayName || away.team?.abbreviation || '?',
    awayScore: away.score != null && away.score !== '' ? Number(away.score) : null,
    awayLogo: away.team?.logo || away.team?.logos?.[0]?.href || null,
  };
}

// ─── Prochain jour avec un match à venir (2026-09-22, sur demande explicite,
// remplace la version du 2026-09-21) ────────────────────────────────────────
// Recherche à partir de DEMAIN jusqu'à 30 jours, PAR LOTS de 7 jours (7
// requêtes en parallèle par lot, une par jour puisque ESPN refuse les plages
// — voir liveFetchScoreboard) : dans un lot, seul le jour chronologiquement
// le plus proche contenant au moins un match à venir (`state === 'pre'`) est
// retenu, et on ne passe au lot suivant QUE si aucun jour du lot courant
// n'en a — résultat identique à "arrêter dès qu'on trouve un jour", demandé
// littéralement, juste accéléré par lots plutôt que 30 allers-retours
// séquentiels. Retourne TOUS les matchs de ce jour-là (pas seulement ceux
// "à venir" — un jour trouvé dans le futur n'a normalement que ça, mais on
// n'en filtre pas d'autres au cas où). Mis en cache 30 min par compétition
// (le rafraîchissement inactif tourne toutes les 10 min : sans cache, une
// compétition à l'arrêt relancerait jusqu'à 30 requêtes à chaque cycle) —
// jamais mis en cache si au moins une requête a échoué. Si TOUTES échouent,
// l'erreur remonte plutôt que d'afficher à tort "Aucun match programmé".
const LIVE_LOOKAHEAD_CHUNK_DAYS = 7;
const LIVE_LOOKAHEAD_MAX_DAYS = 30;
const LIVE_LOOKAHEAD_CACHE_MS = 30 * 60 * 1000;
const liveLookaheadCache = new Map(); // slug -> { dayKey, at, matches }

function liveDayKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

async function liveFindNextDay(slug) {
  const now = new Date();
  const todayKey = liveDayKey(now);
  const cached = liveLookaheadCache.get(slug);
  if (cached && cached.dayKey === todayKey && Date.now() - cached.at < LIVE_LOOKAHEAD_CACHE_MS) {
    console.log(`[Live Foot] Prochain jour ${slug} — depuis le cache (${cached.matches.length} match(es))`);
    return cached.matches;
  }

  let attempted = 0;
  let failed = 0;
  let found = [];
  for (let start = 1; start <= LIVE_LOOKAHEAD_MAX_DAYS && !found.length; start += LIVE_LOOKAHEAD_CHUNK_DAYS) {
    const end = Math.min(start + LIVE_LOOKAHEAD_CHUNK_DAYS - 1, LIVE_LOOKAHEAD_MAX_DAYS);
    const keys = [];
    for (let d = start; d <= end; d++) keys.push(liveDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d)));
    console.log(`[Live Foot] Recherche du prochain jour ${slug} — J+${start} à J+${end}`);
    const results = await Promise.allSettled(keys.map(k => liveFetchScoreboard(slug, k)));
    const byDay = new Map(); // dayKey -> matches[]
    results.forEach((r) => {
      attempted++;
      if (r.status !== 'fulfilled') { failed++; console.warn('[Live Foot] Jour ignoré (échec)', r.reason); return; }
      const evs = (r.value.events || []).map(ev => liveNormalizeEvent(ev, slug)).filter(Boolean);
      if (evs.length) byDay.set(liveDayKey(evs[0].date), evs);
    });
    const qualifying = [...byDay.entries()]
      .filter(([, evs]) => evs.some(m => m.state === 'pre'))
      .sort(([a], [b]) => a.localeCompare(b));
    if (qualifying.length) found = qualifying[0][1];
  }

  if (!found.length && attempted > 0 && failed === attempted) {
    throw new Error(`ESPN injoignable pour la recherche du prochain match (${slug})`);
  }
  if (!failed) liveLookaheadCache.set(slug, { dayKey: todayKey, at: Date.now(), matches: found });
  console.log(`[Live Foot] Prochain jour ${slug} — ${found.length} match(es)${found.length ? ` le ${liveDayKey(found[0].date)}` : ' (aucun dans les 30 jours)'}`);
  return found;
}

// ─── Compétition (mode unique) ──────────────────────────────────────────
async function liveFetchCompetitionMode(config) {
  const slug = config.competitionSlug;
  console.log(`[Live Foot] Mode compétition — slug="${slug}"`);
  const data = await liveFetchScoreboard(slug);
  let matches = (data.events || []).map(ev => liveNormalizeEvent(ev, slug)).filter(Boolean);

  // Déclencheur de la recherche (2026-09-22, sur demande explicite,
  // littéralement "aucun match trouvé OU tous les matchs affichés sont déjà
  // terminés") : dans les 2 cas, la réponse SANS date d'ESPN n'a rien de
  // pertinent à montrer pour "maintenant" — voir liveFetchScoreboard.
  if (!matches.length || matches.every(m => m.completed)) {
    matches = await liveFindNextDay(slug);
  }

  matches.sort((a, b) => a.date - b.date);
  const limited = matches.slice(0, LIVE_MAX_MATCHES);

  // "Le plus proche dans le futur PARMI TOUS LES MATCHS RÉCUPÉRÉS" (demande
  // littérale) — calculé sur `limited` (ce qui est réellement affiché après
  // la limite de 15), pas sur `matches` avant coupe : appliquer la classe
  // "next" à un match qui ne serait même pas montré n'aurait aucun sens.
  const now = new Date();
  const next = limited
    .filter(m => m.state === 'pre' && m.date > now)
    .sort((a, b) => a.date - b.date)[0] || null;

  console.log(`[Live Foot] Mode compétition — ${matches.length} match(es) au total, ${limited.length} affiché(s)`);
  return { matches: limited, nextMatchId: next?.id || null };
}

// ─── Formatage date/heure (fr-FR) ──────────────────────────────────────────
function liveFmtTime(date) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
// Séparateur de date — "JEUDI 24 SEPTEMBRE" (2026-09-22, sur demande
// explicite, tout en majuscules — remplace "Jeudi 24 septembre", seule la
// 1re lettre en capitale, de la version précédente).
function liveFmtDateSeparator(date) {
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
}

// ─── Clic sur un match ──────────────────────────────────────────────────
function liveGoogleSearchUrl(homeTeam, awayTeam) {
  const q = `${homeTeam} ${awayTeam} score live`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// ─── Logo d'équipe + repli initiales ────────────────────────────────────
function liveTeamInitials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || '?';
}
function liveTeamLogoHtml(name, logoUrl) {
  const initials = liveTeamInitials(name);
  if (!logoUrl) return `<span class="lf-team-logo-fallback">${initials}</span>`;
  return `
    <span class="lf-team-logo-wrap">
      <img class="lf-team-logo" src="${logoUrl}" alt="" loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span class="lf-team-logo-fallback" style="display:none">${initials}</span>
    </span>`;
}

// ─── Rendu : une rangée de match (2026-09-22, refonte visuelle complète sur
// demande explicite, maquette "broadcast sportif" fournie) ─────────────────
// Colonnes : [pill horaire ou score] [équipe domicile] [VS] [équipe
// extérieure] [badge statut] — VS toujours affiché entre les noms, y compris
// pour un match en cours/terminé (schéma donné explicitement ainsi ; seule
// la pill de gauche change de contenu selon l'état — heure à venir, score
// sinon). `isNext` (le tout prochain match, calculé une seule fois pour
// toute la liste, voir liveFetchCompetitionMode) : SEULE cette rangée reçoit
// la pill/le badge en teal, comme demandé ("appliquer la classe next à sa
// rangée UNIQUEMENT").
// Statut "EN COURS" — ÉCART assumé : la demande ne précise pas le contenu de
// la pill de gauche pour un match EN DIRECT, seulement pour "Terminé"
// (score). Le score réel y est affiché ici aussi (cohérent avec la règle
// donnée pour "Terminé", et c'est justement l'utilité d'un module "LIVE
// FOOT!" que d'afficher un score qui bouge).
function liveMatchRowHtml(match, isNext) {
  const isLive = match.state === 'in';
  const isPre = match.state === 'pre';
  const clickUrl = liveGoogleSearchUrl(match.homeName, match.awayName);

  const pillHtml = isPre
    ? `<span class="lf-pill ${isNext ? 'lf-pill-next' : ''}">${liveFmtTime(match.date)}</span>`
    : `<span class="lf-pill lf-pill-score ${isLive ? 'lf-pill-live' : ''}">${match.homeScore ?? '—'} - ${match.awayScore ?? '—'}</span>`;

  const statusHtml = isLive
    ? `<span class="lf-status lf-status-live"><span class="lf-status-dot"></span>EN DIRECT</span>`
    : isPre
      ? `<span class="lf-status ${isNext ? 'lf-status-next' : 'lf-status-pre'}">À VENIR</span>`
      : `<span class="lf-status lf-status-post">${liveEsc(match.detail || 'Terminé')}</span>`;

  const rowClasses = ['lf-row'];
  rowClasses.push(isLive ? 'lf-row-live' : isPre ? 'lf-row-pre' : 'lf-row-post');
  if (isNext) rowClasses.push('lf-row-next');

  return `
    <div class="${rowClasses.join(' ')}" data-match-url="${clickUrl}">
      ${pillHtml}
      <span class="lf-team lf-team-home" title="${liveEsc(match.homeName)}">${liveTeamLogoHtml(match.homeName, match.homeLogo)}<span class="lf-team-name">${liveEsc(match.homeName)}</span></span>
      <span class="lf-vs">VS</span>
      <span class="lf-team lf-team-away" title="${liveEsc(match.awayName)}"><span class="lf-team-name">${liveEsc(match.awayName)}</span>${liveTeamLogoHtml(match.awayName, match.awayLogo)}</span>
      ${statusHtml}
    </div>`;
}

// ─── Rendu : liste groupée par date ─────────────────────────────────────
function liveCompetitionModeHtml(matches, nextMatchId) {
  if (!matches.length) return '<div class="etf-empty">Aucun match programmé</div>';

  let lastDayKey = null;
  const rowsHtml = matches.map((m) => {
    const dayKey = liveDayKey(m.date);
    const sep = dayKey !== lastDayKey
      ? `<div class="lf-date-sep"><span class="lf-date-sep-text">${liveFmtDateSeparator(m.date)}</span></div>`
      : '';
    lastDayKey = dayKey;
    return sep + liveMatchRowHtml(m, m.id === nextMatchId);
  }).join('');

  return `<div class="lf-match-list">${rowsHtml}</div>`;
}

// ─── Onglets de filtre par compétition (2026-09-22, "Tous" retiré sur
// nouvelle demande explicite — le bandeau démarre directement sur la
// compétition réellement suivie, active) ──────────────────────────────────
// Écart assumé, INCHANGÉ depuis la 1re version de cette refonte : ce module
// ne suit qu'UNE SEULE compétition à la fois (config.competitionSlug) —
// afficher les 2 AUTRES onglets de la maquette ("Ligue 1"/"Champions
// League") comme s'ils étaient aussi suivis par CETTE carte serait trompeur.
// Choisi à la place : 1 onglet "exemple" RÉEL par catégorie du catalogue
// (`window.LiveCompetitions`, voir live-championships.js — 'domestic'/
// 'european'/'national'), en sautant la catégorie de la compétition
// active pour ne jamais la répéter — jamais un nom inventé, toujours une
// compétition qui existe réellement dans le catalogue de l'app, même si pas
// suivie par cette carte précise. Purement décoratif (pas de logique de
// clic), comme demandé.
function liveOtherTabLabels(slug) {
  const current = liveCompetitionBySlug(slug);
  const labels = [];
  for (const kind of ['domestic', 'european', 'national']) {
    if (current && kind === current.kind) continue;
    const first = (window.LiveCompetitions || []).find(c => c.kind === kind);
    if (first) labels.push(first.label);
    if (labels.length >= 2) break;
  }
  return labels;
}
function liveTabsHtml(slug, competitionLabel) {
  const tabs = [`<span class="lf-tab lf-tab-active">${liveEsc(competitionLabel)}</span>`]
    .concat(liveOtherTabLabels(slug).map(l => `<span class="lf-tab">${liveEsc(l)}</span>`));
  return `<div class="lf-tabs">${tabs.join('')}</div>`;
}

// ─── Pied de carte (2026-09-22, sur demande explicite) ─────────────────────
// "Via ESPN · Actualisation auto toutes les 60 s" — ÉCART assumé : la
// maquette écrit "60 s" en dur, mais la cadence RÉELLE de ce module est déjà
// de 10 min hors match en direct (voir LIVE_REFRESH_IDLE_MS, comportement
// existant, non modifié par cette refonte) — un texte figé à "60 s" mentirait
// dans ce cas. Affiche donc la cadence RÉELLEMENT appliquée pour ce cycle.
function liveFooterHtml(hasLive) {
  const cadence = hasLive ? '60 s' : '10 min';
  return `<div class="lf-footer">Via ESPN · Actualisation auto toutes les ${cadence}</div>`;
}

// ─── En-tête de carte (2026-09-22, révisé le même jour sur nouvelle demande
// explicite, maquette mise à jour) ──────────────────────────────────────────
// Posé sur le card générique (PAS sur `container`) — "FOOTBALL"/le nom de
// compétition sont déjà le titre/sous-titre de carte (voir dashboard.js
// resolveModuleTitle/resolveModuleSubtitle, INCHANGÉS). Ce module ajoute :
//  - `.live-chip` ("LIVE" + point), inséré UNE FOIS entre le titre et le
//    sous-titre (position demandée explicitement : "juste sous FOOTBALL,
//    avant le sous-titre compétition") puis seulement basculé actif/inactif
//    ensuite (`.inactive` — nom de classe donné explicitement — point gris
//    fixe au lieu de rouge clignotant) plutôt que retiré/recréé : il doit
//    rester visible en PERMANENCE, contrairement à la version précédente de
//    cette refonte (tag "EN DIRECT" ajouté/retiré selon l'état) ;
//  - l'icône ballon décorative (toujours affichée).
// Idempotent — render() est rappelé à chaque refresh, rien de tout ça ne
// doit s'empiler ou se dupliquer.
// Badge orange "Journée X" de la maquette d'origine — VOLONTAIREMENT NON
// REPRODUIT (vérifié EN DIRECT le 2026-09-22 sur Ligue 1 ET UEFA Nations
// League qu'aucun champ ESPN ne porte un numéro de journée exploitable) ;
// remplacé sur la maquette mise à jour par le badge de comptage (voir
// `.module-badge` ci-dessous, déjà existant, simplement repositionné/coloré
// en teal par cette révision — AUCUN champ inventé, juste une réutilisation).
const LIVE_BALL_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.4"/>
  <path d="M12 7.2l3.6 2.6-1.4 4.2H9.8l-1.4-4.2L12 7.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M12 2.75v4.45M12 16.6v4.65M4.1 8.6l3.9 1.4M16 10l3.9-1.4M6 17.3l2.6-3.3M18 17.3l-2.6-3.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;

function liveUpdateHeader(container, hasLive) {
  const card = container.closest('.module-card');
  const header = card?.querySelector('.module-header');
  if (!header) return;
  header.classList.add('lf-header');

  const titleGroup = header.querySelector('.module-title-group');
  const titleEl = header.querySelector('.module-title');
  let chip = header.querySelector('.live-chip');
  if (!chip && titleEl) {
    chip = document.createElement('div');
    chip.className = 'live-chip';
    chip.innerHTML = `<span class="live-chip-dot"></span>LIVE`;
    // Sous le titre, avant le sous-titre — seulement possible si
    // `.module-title-group` existe (config.competitionLabel déjà renseigné
    // au moment de la création de la carte, voir dashboard.js
    // resolveModuleSubtitle/createModuleCard) ; repli juste après le titre
    // sinon (pas de sous-titre du tout dans ce cas).
    if (titleGroup) titleGroup.insertBefore(chip, titleGroup.querySelector('.module-subtitle') || null);
    else titleEl.insertAdjacentElement('afterend', chip);
  }
  chip?.classList.toggle('inactive', !hasLive);

  if (!header.querySelector('.lf-ball-icon')) {
    const ball = document.createElement('span');
    ball.className = 'lf-ball-icon';
    ball.innerHTML = LIVE_BALL_SVG;
    header.appendChild(ball);
  }
}

// ─── Badge (module réduit, coin de carte) ──────────────────────────────
function liveCompetitionBadge(matches) {
  const liveCount = matches.filter(m => m.state === 'in').length;
  if (liveCount) return `● LIVE (${liveCount})`;
  return matches.length ? String(matches.length) : '—';
}

// ─── Point d'entrée ─────────────────────────────────────────────────────
window.MatinModules.live = {
  async render(container, config, _google, setBadge) {
    if (!container.dataset.liveClickBound) {
      container.addEventListener('click', (e) => {
        const row = e.target.closest('.lf-row');
        const url = row?.dataset.matchUrl;
        if (!url) return;
        console.log(`[Live Foot] Ouverture recherche Google : ${url}`);
        window.matin.shell.openExternal(url);
      });
      container.dataset.liveClickBound = '1';
    }

    // Un `setInterval` précédent (re-render() déclenché par le bouton
    // "Actualiser" du titrebar) est arrêté avant d'en reposer un.
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
          liveUpdateHeader(container, false);
          return false;
        }
        const { matches, nextMatchId } = await liveFetchCompetitionMode(config);
        const hasLive = matches.some(m => m.state === 'in');
        container.innerHTML = liveTabsHtml(config.competitionSlug, config.competitionLabel || liveCompetitionLabel(config.competitionSlug))
          + liveCompetitionModeHtml(matches, nextMatchId)
          + liveFooterHtml(hasLive);
        setBadge(liveCompetitionBadge(matches));
        liveUpdateHeader(container, hasLive);
        return hasLive;
      } catch (err) {
        console.error('[Live Foot] Erreur de chargement', err);
        container.innerHTML = '<span class="module-error">⚠ Erreur de chargement</span>';
        setBadge('⚠');
        liveUpdateHeader(container, false);
        return false;
      }
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    const hasLive = await loadAndRender();

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
