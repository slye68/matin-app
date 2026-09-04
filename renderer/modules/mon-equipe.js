/**
 * Module Mon Équipe (2026-08-15, sur demande explicite) — suivi 100% MANUEL
 * d'une équipe : calendrier à venir et résultats passés saisis à la main en
 * Paramètres (voir config.js, renderMonEquipeConfigSection), AUCUNE source
 * externe interrogée (contrairement à Sports/ol.js qui appelle TheSportsDB/
 * des flux RSS). Pensé pour un club sans couverture par ces sources (ex. club
 * amateur/régional).
 *
 * Le titre de CARTE affiche déjà le nom de l'équipe configuré (voir
 * dashboard.js, resolveModuleTitle — même mécanisme que Sports/Prêts), donc
 * ce module ne répète pas le nom dans son contenu.
 */
window.MatinModules = window.MatinModules || {};

// 20 (2026-09-01, sur demande explicite — remplacé 3, section désormais
// repliable comme ETF/FDJ, voir monEquipeSectionHtml/render plus bas) :
// jusqu'à 20 matchs/résultats affichés une fois la section dépliée.
const MON_EQUIPE_SECTION_LIMIT = 20;

function monEquipeFormatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

// "06/09 à 14h00" (reformaté le 2026-08-31, sur demande explicite — remplace
// date et heure séparées par " · ") — `item.time` vient d'un <input
// type="time"> ("HH:MM"), converti au format FR "HHhMM".
function monEquipeFormatDateTime(item) {
  const datePart = monEquipeFormatDate(item.date);
  if (!datePart) return '';
  const timePart = item.time ? item.time.replace(':', 'h') : '';
  return timePart ? `${datePart} à ${timePart}` : datePart;
}

// Combine date + heure en un instant comparable — sert au tri chronologique
// ET au filtrage "pas encore joué" (voir render ci-dessous). Une heure
// absente (facultative en config) vaut minuit, cohérent avec un tri par
// journée quand seule la date est connue.
function monEquipeDateTimeValue(item) {
  const t = new Date(`${item.date}T${item.time || '00:00'}`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Couleurs dédiées par type d'info (2026-08-16, sur demande explicite ;
// format réécrit en UNE seule ligne le 2026-08-31, 2e demande explicite —
// "Match amical · 05/09 · 15h00 · Domicile · vs Francheville", remplace les
// 2 lignes séparées meta/adversaire d'origine, jugées moins lisibles ;
// 3e demande explicite le même jour — date+heure fusionnées "à" au lieu de
// séparées par " · ", type recoloré en bleu) — compétition/date-heure ont
// chacun leur propre classe `.monequipe-info-*` (voir style.css), en
// couleurs fixes (pas de variable de thème) puisque demandées comme valeurs
// hex précises.
// Ordre des équipes + couleurs revus le 2026-09-03, sur demande explicite —
// l'ancien badge Domicile/Extérieur séparé (monEquipeVenueClass/
// MON_EQUIPE_VENUE_LABEL, SUPPRIMÉES, plus aucun appelant) + "vs Adversaire"
// neutre sont remplacés par un ORDRE qui indique implicitement le lieu, sans
// aucune mention textuelle "Domicile"/"Extérieur" — même logique que
// monEquipeNextMatchHtml ci-dessous (voir son commentaire pour le détail),
// mêmes classes de couleur partagées .monequipe-team-us/-opponent (voir
// style.css). `teamName` requis (passé par monEquipeUpcomingRowHtml,
// lui-même reçu de render() où il est déjà garanti non vide).
function monEquipeMatchLineHtml(item, teamName) {
  const isHome = item.venue !== 'away';
  const usSpan = `<span class="monequipe-team-us">${teamName}</span>`;
  const opponentSpan = `<span class="monequipe-team-opponent">${item.opponent || ''}</span>`;
  return [
    item.competition ? `<span class="monequipe-info-type">${item.competition}</span>` : '',
    item.date ? `<span class="monequipe-info-datetime">${monEquipeFormatDateTime(item)}</span>` : '',
    `${isHome ? usSpan : opponentSpan} vs ${isHome ? opponentSpan : usSpan}`,
  ].filter(Boolean).join(' · ');
}

// "Prochain match" (2026-09-01, redesign sur demande explicite ; ordre des
// équipes + couleurs revus le 2026-09-03, sur demande explicite — l'ancien
// "Équipe vs Adversaire" fixe + badge Domicile/Extérieur séparé sont
// remplacés par un ORDRE qui indique implicitement le lieu, sans aucune
// mention textuelle "Domicile"/"Extérieur" : Domicile → "Notre équipe vs
// Adversaire" (ordre d'origine, inchangé), Extérieur → "Adversaire vs Notre
// équipe" (adversaire en premier). Notre équipe toujours en orange
// (.monequipe-team-us), l'adversaire toujours en rose très clair
// (.monequipe-team-opponent, rouge #ef4444 d'origine adouci le même jour, 2e
// demande explicite), quel que soit l'ordre — voir style.css ; mêmes classes
// de couleur réutilisées par monEquipeMatchLineHtml ci-dessus pour
// "Prochains matchs". `teamName` déjà garanti non vide par render() (sinon
// retour anticipé "Configurez votre équipe").
function monEquipeNextMatchHtml(item, teamName) {
  if (!item) return '<span class="sports-no-data">Aucun match prévu</span>';
  const isHome = item.venue !== 'away';
  const usSpan = `<span class="monequipe-next-team monequipe-team-us">${teamName}</span>`;
  const opponentSpan = `<span class="monequipe-next-team monequipe-team-opponent">${item.opponent || ''}</span>`;
  return `
    <div class="monequipe-next-content">
      ${item.competition ? `<span class="monequipe-next-badge">${item.competition}</span>` : ''}
      ${item.date ? `<div class="monequipe-next-datetime">${monEquipeFormatDateTime(item)}</div>` : ''}
      <div class="monequipe-next-teams">
        ${isHome ? usSpan : opponentSpan}
        <span class="monequipe-next-vs">vs</span>
        ${isHome ? opponentSpan : usSpan}
      </div>
    </div>`;
}

// Score "<notre équipe>-<adversaire>" saisi tel quel en Paramètres (voir
// config.js renderMonEquipeConfigSection, champ Score, placeholder "Ex :
// 78-65") — TOUJOURS dans cet ordre quel que soit Domicile/Extérieur,
// contrairement à monEquipeNextMatchHtml ci-dessus : aucun swap nécessaire
// ici, seule la couleur dépend du résultat. `null` si le texte ne matche pas
// le format attendu (espaces tolérées autour du tiret) — affiché tel quel
// sans couleur dans ce cas plutôt que de planter sur une saisie inattendue.
function monEquipeParseScore(scoreStr) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec((scoreStr || '').trim());
  if (!m) return null;
  return { us: parseInt(m[1], 10), opponent: parseInt(m[2], 10) };
}

// Vert = victoire, rouge = défaite, couleur par défaut héritée (neutre) =
// égalité — que le match ait été joué à domicile ou à l'extérieur (2026-09-03,
// sur demande explicite).
function monEquipeScoreClass(parsed) {
  if (!parsed) return '';
  if (parsed.us > parsed.opponent) return 'monequipe-score-win';
  if (parsed.us < parsed.opponent) return 'monequipe-score-loss';
  return '';
}

// "Dernier résultat" (2026-09-03, sur demande explicite — remplace "<score>
// · Domicile/Extérieur <adversaire> · <date>" par "<notre équipe> <score>
// <adversaire> · <date>", plus aucune mention Domicile/Extérieur ; score
// coloré selon victoire/défaite, voir monEquipeScoreClass ci-dessus).
// `teamName` déjà garanti non vide par render().
function monEquipeLastResultHtml(item, teamName) {
  if (!item) return '<span class="sports-no-data">Aucun résultat</span>';
  const parsed = monEquipeParseScore(item.score);
  const scoreText = parsed ? `${parsed.us} - ${parsed.opponent}` : (item.score || '—');
  return `
    <div class="sports-next-detail monequipe-result-line">
      <span class="monequipe-result-team">${teamName}</span>
      <span class="monequipe-result-score ${monEquipeScoreClass(parsed)}">${scoreText}</span>
      <span class="monequipe-result-team">${item.opponent || ''}</span>
    </div>
    ${item.date ? `<div class="sports-next-opp"><span class="monequipe-info-date">${monEquipeFormatDate(item.date)}</span></div>` : ''}
  `;
}

function monEquipeUpcomingRowHtml(item, teamName) {
  return `<div class="monequipe-list-row monequipe-list-row-line">${monEquipeMatchLineHtml(item, teamName)}</div>`;
}

// Ligne "Matchs passés" (renommée depuis "Derniers résultats" le 2026-09-03,
// sur demande explicite ; format uniformisé le même jour, 2e demande
// explicite, "même présentation que Dernier résultat" — voir
// monEquipeLastResultHtml/monEquipeParseScore/monEquipeScoreClass ci-dessus,
// réutilisés tels quels pour l'équipe/le score/leurs couleurs) : contrairement
// à monEquipeLastResultHtml (toujours "notre équipe" en premier), l'ORDRE ici
// suit Domicile/Extérieur — MÊME logique que monEquipeMatchLineHtml
// ci-dessus, demandée explicitement pour cette liste — donc le SCORE est
// affiché dans l'ordre correspondant (`opponent - us` si Extérieur) pour
// rester à côté du bon nom, tout en gardant la couleur basée sur le résultat
// RÉEL (parsed.us vs parsed.opponent, indépendant de l'ordre d'affichage).
// Plus aucune mention Domicile/Extérieur (badge supprimé, comme point 4).
function monEquipeResultRowHtml(item, teamName) {
  const isHome = item.venue !== 'away';
  const parsed = monEquipeParseScore(item.score);
  const scoreText = parsed
    ? (isHome ? `${parsed.us} - ${parsed.opponent}` : `${parsed.opponent} - ${parsed.us}`)
    : (item.score || '—');
  const usSpan = `<span class="monequipe-result-team">${teamName}</span>`;
  const opponentSpan = `<span class="monequipe-result-team">${item.opponent || ''}</span>`;
  const scoreSpan = `<span class="monequipe-result-score ${monEquipeScoreClass(parsed)}">${scoreText}</span>`;
  const line = [
    `${isHome ? usSpan : opponentSpan} ${scoreSpan} ${isHome ? opponentSpan : usSpan}`,
    item.date ? `<span class="monequipe-info-date">${monEquipeFormatDate(item.date)}</span>` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="monequipe-list-row monequipe-list-row-line">${line}</div>`;
}

// Section repliable "Prochains matchs"/"Matchs passés" (2026-09-01, sur
// demande explicite, "comme ETF/FDJ" ; 2e section renommée depuis "Derniers
// résultats" le 2026-09-03) — même mécanique que .fdj-grids-section
// (voir fdj-common.js/style.css) : repliée par défaut, dépliage/repliage via
// un simple classList.toggle sur le nœud EXISTANT (jamais un re-render du
// bloc lui-même, voir render() plus bas) pour que la transition CSS
// grid-template-rows 300ms puisse s'animer — un re-render recréerait la
// section déjà dans son état final, sans transition possible.
function monEquipeSectionHtml(sectionKey, label, items, expanded, rowHtmlFn, emptyText) {
  return `
    <div class="monequipe-section ${expanded ? 'expanded' : ''}" data-section="${sectionKey}">
      <div class="monequipe-section-toggle" data-section-toggle="${sectionKey}">
        <span class="monequipe-section-label">${label}</span>
        <span class="monequipe-section-chevron">▶</span>
      </div>
      <div class="monequipe-section-collapse">
        <div class="monequipe-section-list">${
          items.length ? items.map(rowHtmlFn).join('') : `<span class="sports-no-data">${emptyText}</span>`
        }</div>
      </div>
    </div>`;
}

window.MatinModules.monEquipe = {
  async render(container, config, _google, setBadge) {
    const teamName = config?.teamName?.trim();
    if (!teamName) {
      container.innerHTML = `<div class="module-empty">Configurez votre équipe dans Paramètres.</div>`;
      setBadge('—');
      return;
    }
    setBadge('');

    const now = Date.now();
    // Marge de 3h (pas 0) : un match qui vient de commencer ne doit pas
    // disparaître instantanément de "prochain match" au coup de sifflet —
    // reste affiché jusqu'à ce que l'utilisateur saisisse le résultat.
    const GRACE_MS = 3 * 60 * 60 * 1000;

    const upcoming = (Array.isArray(config.upcoming) ? config.upcoming : [])
      .filter(i => i.date && monEquipeDateTimeValue(i) >= now - GRACE_MS)
      .sort((a, b) => monEquipeDateTimeValue(a) - monEquipeDateTimeValue(b));

    const results = (Array.isArray(config.results) ? config.results : [])
      .filter(i => i.date)
      .sort((a, b) => monEquipeDateTimeValue(b) - monEquipeDateTimeValue(a));

    const nextMatch = upcoming[0] || null;
    const lastResult = results[0] || null;

    // Repliées par défaut (2026-09-01, sur demande explicite) — état LOCAL à
    // ce rendu (fermeture, comme fdj-common.js gridsExpanded), donc remis à
    // zéro à chaque rechargement complet du dashboard, jamais persisté.
    const sectionExpanded = { upcoming: false, results: false };

    container.innerHTML = `
      <div class="sports-module monequipe-module">
        <div class="sports-next monequipe-next-card">
          <span class="sports-next-label">Prochain match</span>
          ${monEquipeNextMatchHtml(nextMatch, teamName)}
        </div>
        <div class="sports-next">
          <span class="sports-next-label">Dernier résultat</span>
          ${monEquipeLastResultHtml(lastResult, teamName)}
        </div>
        ${monEquipeSectionHtml(
          'upcoming', 'Prochains matchs',
          // slice(1, …) : exclut le match déjà affiché juste au-dessus dans
          // "Prochain match" (upcoming[0]) — sans ce décalage il apparaît
          // deux fois (bug corrigé le 2026-08-16, signalé explicitement).
          upcoming.slice(1, 1 + MON_EQUIPE_SECTION_LIMIT), sectionExpanded.upcoming,
          // `teamName` transmis via closure (2026-09-03, sur demande
          // explicite — voir monEquipeMatchLineHtml) : monEquipeSectionHtml
          // appelle `rowHtmlFn` avec le seul `item` (items.map), teamName
          // n'était donc pas accessible depuis monEquipeUpcomingRowHtml sans
          // ça.
          (item) => monEquipeUpcomingRowHtml(item, teamName), 'Aucun autre match à venir'
        )}
        ${monEquipeSectionHtml(
          // Renommée "Matchs passés" (2026-09-03, sur demande explicite,
          // depuis "Derniers résultats").
          'results', 'Matchs passés',
          results.slice(1, 1 + MON_EQUIPE_SECTION_LIMIT), sectionExpanded.results,
          (item) => monEquipeResultRowHtml(item, teamName), 'Aucun autre résultat'
        )}
      </div>
    `;

    container.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-section-toggle]');
      if (!toggle) return;
      const key = toggle.dataset.sectionToggle;
      sectionExpanded[key] = !sectionExpanded[key];
      // classList.toggle sur le nœud EXISTANT (voir monEquipeSectionHtml) —
      // jamais innerHTML ici, qui recréerait la section déjà dans son état
      // final et empêcherait la transition CSS de s'animer.
      container.querySelector(`.monequipe-section[data-section="${key}"]`)?.classList.toggle('expanded', sectionExpanded[key]);
    });
  },
};
