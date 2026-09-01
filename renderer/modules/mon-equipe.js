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

// Libellés complets à l'affichage (2026-08-16, sur demande explicite) — le
// <select> de configuration (config.js, monEquipeVenueOptionsHtml) garde lui
// "D"/"E" (compact, changé fréquemment en saisie), seul l'affichage carte
// passe au mot complet.
const MON_EQUIPE_VENUE_LABEL = { home: 'Domicile', away: 'Extérieur' };
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

// Domicile = jaune, Extérieur = rouge (2026-08-31, sur demande explicite —
// remplace une seule couleur partagée par les deux).
function monEquipeVenueClass(venue) {
  return venue === 'away' ? 'monequipe-info-venue-away' : 'monequipe-info-venue-home';
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
// séparées par " · ", type recoloré en bleu, Domicile/Extérieur désormais
// 2 couleurs distinctes au lieu d'une seule partagée) — compétition/
// date-heure/domicile-extérieur/adversaire ont chacun leur propre classe
// `.monequipe-info-*` (voir style.css), en couleurs fixes (pas de variable
// de thème) puisque demandées comme valeurs hex précises.
// Partagée entre "Prochain match" (mise en avant) et "Prochains matchs"
// (liste) — même format de ligne pour les 2, voir monEquipeNextMatchHtml/
// monEquipeUpcomingRowHtml plus bas.
function monEquipeMatchLineHtml(item) {
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  return [
    item.competition ? `<span class="monequipe-info-type">${item.competition}</span>` : '',
    item.date ? `<span class="monequipe-info-datetime">${monEquipeFormatDateTime(item)}</span>` : '',
    `<span class="${monEquipeVenueClass(item.venue)}">${venue}</span>`,
    `<span class="monequipe-info-opponent">vs ${item.opponent || ''}</span>`,
  ].filter(Boolean).join(' · ');
}

// "Prochain match" (2026-09-01, redesign sur demande explicite — remplace la
// simple ligne monEquipeMatchLineHtml partagée avec la liste "Prochains
// matchs", voir CSS .monequipe-next-* dédiées dans style.css) : compétition
// en badge (pilule bleue), date+heure en grand texte vert, "Équipe vs
// Adversaire" plutôt que juste "vs Adversaire" (nécessite `teamName`, connu
// seulement ici — pas dans monEquipeMatchLineHtml, resté inchangé pour la
// liste "Prochains matchs"), Domicile/Extérieur toujours coloré (classes
// existantes monEquipeVenueClass, jaune/rouge). `teamName` déjà garanti non
// vide par render() (sinon retour anticipé "Configurez votre équipe").
function monEquipeNextMatchHtml(item, teamName) {
  if (!item) return '<span class="sports-no-data">Aucun match prévu</span>';
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  return `
    <div class="monequipe-next-content">
      ${item.competition ? `<span class="monequipe-next-badge">${item.competition}</span>` : ''}
      ${item.date ? `<div class="monequipe-next-datetime">${monEquipeFormatDateTime(item)}</div>` : ''}
      <div class="monequipe-next-teams">
        <span class="monequipe-next-team">${teamName}</span>
        <span class="monequipe-next-vs">vs</span>
        <span class="monequipe-next-team">${item.opponent || ''}</span>
      </div>
      <span class="${monEquipeVenueClass(item.venue)} monequipe-next-venue">${venue}</span>
    </div>`;
}

function monEquipeLastResultHtml(item) {
  if (!item) return '<span class="sports-no-data">Aucun résultat</span>';
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  return `
    <div class="sports-next-detail">${item.score || '—'}</div>
    <div class="sports-next-opp"><span class="${monEquipeVenueClass(item.venue)}">${venue}</span> ${item.opponent || ''} · <span class="monequipe-info-date">${monEquipeFormatDate(item.date)}</span></div>
  `;
}

function monEquipeUpcomingRowHtml(item) {
  return `<div class="monequipe-list-row monequipe-list-row-line">${monEquipeMatchLineHtml(item)}</div>`;
}

// Ligne "Derniers résultats" (2026-09-01, sur demande explicite — nouvelle
// section, aucun équivalent liste n'existait avant, seul un "Dernier
// résultat" au singulier était affiché) : même gabarit de ligne que
// monEquipeUpcomingRowHtml (une seule chaîne fluide, couleurs dédiées),
// score en tête plutôt que le type de compétition (non saisi pour un
// résultat déjà joué, voir config.js renderMonEquipeConfigSection).
function monEquipeResultRowHtml(item) {
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  const line = [
    `<span class="monequipe-info-score">${item.score || '—'}</span>`,
    `<span class="${monEquipeVenueClass(item.venue)}">${venue}</span>`,
    `<span class="monequipe-info-opponent">vs ${item.opponent || ''}</span>`,
    item.date ? `<span class="monequipe-info-date">${monEquipeFormatDate(item.date)}</span>` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="monequipe-list-row monequipe-list-row-line">${line}</div>`;
}

// Section repliable "Prochains matchs"/"Derniers résultats" (2026-09-01, sur
// demande explicite, "comme ETF/FDJ") — même mécanique que .fdj-grids-section
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
          ${monEquipeLastResultHtml(lastResult)}
        </div>
        ${monEquipeSectionHtml(
          'upcoming', 'Prochains matchs',
          // slice(1, …) : exclut le match déjà affiché juste au-dessus dans
          // "Prochain match" (upcoming[0]) — sans ce décalage il apparaît
          // deux fois (bug corrigé le 2026-08-16, signalé explicitement).
          upcoming.slice(1, 1 + MON_EQUIPE_SECTION_LIMIT), sectionExpanded.upcoming,
          monEquipeUpcomingRowHtml, 'Aucun autre match à venir'
        )}
        ${monEquipeSectionHtml(
          'results', 'Derniers résultats',
          results.slice(1, 1 + MON_EQUIPE_SECTION_LIMIT), sectionExpanded.results,
          monEquipeResultRowHtml, 'Aucun autre résultat'
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
