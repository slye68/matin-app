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
const MON_EQUIPE_LIST_SIZE = 3;

function monEquipeFormatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

// Combine date + heure en un instant comparable — sert au tri chronologique
// ET au filtrage "pas encore joué" (voir render ci-dessous). Une heure
// absente (facultative en config) vaut minuit, cohérent avec un tri par
// journée quand seule la date est connue.
function monEquipeDateTimeValue(item) {
  const t = new Date(`${item.date}T${item.time || '00:00'}`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Couleurs dédiées par type d'info (2026-08-16, sur demande explicite) —
// date/type/heure/domicile-extérieur/adversaire ont chacun leur propre
// classe `.monequipe-info-*` (voir style.css), en couleurs fixes (pas de
// variable de thème) puisque demandées comme valeurs hex précises.
function monEquipeNextMatchHtml(item) {
  if (!item) return '<span class="sports-no-data">Aucun match prévu</span>';
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  const meta = [
    item.date ? `<span class="monequipe-info-date">${monEquipeFormatDate(item.date)}</span>` : '',
    item.time ? `<span class="monequipe-info-time">${item.time}</span>` : '',
    `<span class="monequipe-info-venue">${venue}</span>`,
    item.competition ? `<span class="monequipe-info-type">${item.competition}</span>` : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="sports-next-detail">${meta}</div>
    <div class="sports-next-opp"><span class="monequipe-info-opponent">${item.opponent || ''}</span></div>
  `;
}

function monEquipeLastResultHtml(item) {
  if (!item) return '<span class="sports-no-data">Aucun résultat</span>';
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  return `
    <div class="sports-next-detail">${item.score || '—'}</div>
    <div class="sports-next-opp"><span class="monequipe-info-venue">${venue}</span> ${item.opponent || ''} · <span class="monequipe-info-date">${monEquipeFormatDate(item.date)}</span></div>
  `;
}

function monEquipeUpcomingRowHtml(item) {
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  return `
    <div class="monequipe-list-row">
      <span class="monequipe-list-date"><span class="monequipe-info-date">${monEquipeFormatDate(item.date)}</span>${item.time ? ` <span class="monequipe-info-time">${item.time}</span>` : ''}</span>
      <span class="monequipe-list-opp"><span class="monequipe-info-venue">${venue}</span> · <span class="monequipe-info-opponent">${item.opponent || ''}</span></span>
      ${item.competition ? `<span class="monequipe-list-meta monequipe-info-type">${item.competition}</span>` : ''}
    </div>`;
}

function monEquipeResultRowHtml(item) {
  const venue = MON_EQUIPE_VENUE_LABEL[item.venue] || 'Domicile';
  return `
    <div class="monequipe-list-row">
      <span class="monequipe-list-date monequipe-info-date">${monEquipeFormatDate(item.date)}</span>
      <span class="monequipe-list-opp"><span class="monequipe-info-venue">${venue}</span> · ${item.opponent || ''}</span>
      <span class="monequipe-list-meta">${item.score || ''}</span>
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

    container.innerHTML = `
      <div class="sports-module monequipe-module">
        <div class="sports-next">
          <span class="sports-next-label">Prochain match</span>
          ${monEquipeNextMatchHtml(nextMatch)}
        </div>
        <div class="sports-next">
          <span class="sports-next-label">Dernier résultat</span>
          ${monEquipeLastResultHtml(lastResult)}
        </div>
        <div class="monequipe-list-label">Prochains matchs</div>
        <div class="monequipe-list">${
          // slice(1, …) : exclut le match déjà affiché juste au-dessus dans
          // "Prochain match" (upcoming[0]) — sans ce décalage il apparaît
          // deux fois (bug corrigé le 2026-08-16, signalé explicitement).
          upcoming.slice(1, 1 + MON_EQUIPE_LIST_SIZE).map(monEquipeUpcomingRowHtml).join('')
          || '<span class="sports-no-data">Aucun autre match à venir</span>'
        }</div>
        <div class="monequipe-list-label">Derniers résultats</div>
        <div class="monequipe-list">${
          results.slice(0, MON_EQUIPE_LIST_SIZE).map(monEquipeResultRowHtml).join('')
          || '<span class="sports-no-data">Aucun résultat</span>'
        }</div>
      </div>
    `;
  },
};
