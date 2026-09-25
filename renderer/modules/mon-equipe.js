/**
 * Module Mon Équipe (2026-08-15, sur demande explicite) — suivi 100% MANUEL
 * d'une équipe : calendrier à venir et résultats passés saisis à la main en
 * Paramètres (voir config.js, renderMonEquipeConfigSection), AUCUNE source
 * externe interrogée (contrairement à Sports/ol.js qui appelle TheSportsDB/
 * des flux RSS). Pensé pour un club sans couverture par ces sources (ex. club
 * amateur/régional).
 *
 * Refonte visuelle complète (2026-09-21, sur demande explicite, maquette
 * fournie) : 3 cartes (Prochain match / Dernier résultat / Prochains matchs),
 * en-tête à titre bicolore + slogan, légende en pied. Les anciennes classes
 * `.monequipe-*` d'affichage (et leurs variantes mode clair) sont remplacées
 * par `.me-*` (voir style.css) ; les classes `.monequipe-*` de Paramètres
 * (config.html) sont un autre jeu, non concerné.
 *
 * Le titre de CARTE affiche déjà le nom de l'équipe configuré (voir
 * dashboard.js, resolveModuleTitle — même mécanisme que Sports/Prêts) ; ce
 * module ne fait que le re-découper en 2 tons (voir monEquipeUpdateHeader).
 */
window.MatinModules = window.MatinModules || {};

// 20 (2026-09-01) : jusqu'à 20 matchs/résultats affichés une fois la liste
// dépliée ("Voir le calendrier"/"Voir tous les résultats").
const MON_EQUIPE_SECTION_LIMIT = 20;

// Slogans par défaut de la maquette — remplaçables/effaçables en Paramètres
// (config.tagline / config.footerSlogan, voir config.js) : `undefined` =
// jamais configuré = texte par défaut ; chaîne vide = masqué. Dupliquées côté
// config.js (fenêtre séparée, aucun module partagé entre les 2).
const MON_EQUIPE_DEFAULT_TAGLINE = "Plus qu'une équipe";
const MON_EQUIPE_DEFAULT_FOOTER = 'Ensemble vers de nouveaux défis';

// Icône sport (valeurs exactes de config.js MON_EQUIPE_SPORTS) — sert à la
// fois d'icône d'en-tête ET de "logo" d'équipe dans les cartes (aucune image
// : les logos de clubs ont été retirés le 2026-09-12 sur demande explicite,
// "aucun placeholder" — ce sont ici de simples pictogrammes de sport dans un
// anneau vert (notre équipe) / rouge (adversaire), comme sur la maquette).
const MON_EQUIPE_SPORT_ICONS = {
  football: '⚽',
  basketball: '🏀',
  rugby: '🏉',
  tennis: '🎾',
  autre: '🎽',
};

function monEquipeEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function monEquipeSportIcon(config) {
  return MON_EQUIPE_SPORT_ICONS[config?.sport] || MON_EQUIPE_SPORT_ICONS.autre;
}

// Slogan effectif : `undefined` → défaut, sinon la valeur saisie (trimée),
// vide = masqué.
function monEquipeSlogan(value, fallback) {
  return value === undefined ? fallback : String(value).trim();
}

// En-tête posé sur le card générique (PAS sur `container`, qui n'est que
// `.module-content` — l'en-tête vit un cran au-dessus, voir dashboard.js
// createModuleCard). Idempotent : render() est rappelé à chaque refresh, le
// DOM d'en-tête n'est jamais recréé par le dashboard entre-temps.
//  - icône sport sortie de `.module-title` pour couvrir titre ET sous-titre
//    (anneau orange, voir style.css) ;
//  - nom d'équipe en 2 tons : 1er mot en couleur de texte, le reste en
//    orange (un nom d'un seul mot reste en couleur de texte) ;
//  - slogan à droite (config.tagline), retiré s'il est vide.
// No-op silencieux si la structure est introuvable plutôt que de planter.
function monEquipeUpdateHeader(container, config, teamName) {
  const card = container.closest('.module-card');
  const header = card?.querySelector('.module-header');
  if (!header) return;
  const sportIcon = monEquipeSportIcon(config);

  const iconEl = header.querySelector('.module-icon');
  const titleEl = header.querySelector('.module-title');
  const anchor = header.querySelector('.module-title-group') || titleEl;
  if (iconEl) {
    iconEl.textContent = sportIcon;
    if (anchor && iconEl.parentElement === titleEl) header.insertBefore(iconEl, anchor);
  }

  if (titleEl) {
    const [first, ...rest] = teamName.split(/\s+/);
    titleEl.innerHTML = rest.length
      ? `<span class="me-title-first">${monEquipeEsc(first)}</span> <span class="me-title-rest">${monEquipeEsc(rest.join(' '))}</span>`
      : `<span class="me-title-first">${monEquipeEsc(first)}</span>`;
  }

  header.querySelector('.me-tagline')?.remove();
  const tagline = monEquipeSlogan(config?.tagline, MON_EQUIPE_DEFAULT_TAGLINE);
  if (tagline) {
    const el = document.createElement('div');
    el.className = 'me-tagline';
    el.innerHTML = `<span class="me-tagline-text">${monEquipeEsc(tagline)}</span><span class="me-tagline-icon">${sportIcon}</span>`;
    header.appendChild(el);
  }
}

function monEquipeFormatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

// "à 16h00" — `item.time` vient d'un <input type="time"> ("HH:MM"), converti
// au format FR "HHhMM". Vide si l'heure (facultative en config) est absente.
function monEquipeFormatTime(item) {
  return item.time ? `à ${item.time.replace(':', 'h')}` : '';
}

// Combine date + heure en un instant comparable — sert au tri chronologique
// ET au filtrage "pas encore joué" (voir render ci-dessous). Une heure
// absente vaut minuit, cohérent avec un tri par journée quand seule la date
// est connue.
function monEquipeDateTimeValue(item) {
  const t = new Date(`${item.date}T${item.time || '00:00'}`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Score "<notre équipe>-<adversaire>" saisi tel quel en Paramètres (champ
// Score, "Ex : 78-65") — TOUJOURS dans cet ordre quel que soit Domicile/
// Extérieur. `null` si le texte ne matche pas (affiché brut, sans couleur).
function monEquipeParseScore(scoreStr) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec((scoreStr || '').trim());
  if (!m) return null;
  return { us: parseInt(m[1], 10), opponent: parseInt(m[2], 10) };
}

// Couleur du score de NOTRE équipe : vert victoire, rouge défaite, neutre en
// cas d'égalité. Celui de l'adversaire reste toujours atténué (maquette).
function monEquipeUsScoreClass(parsed) {
  if (!parsed) return '';
  if (parsed.us > parsed.opponent) return 'me-score-win';
  if (parsed.us < parsed.opponent) return 'me-score-loss';
  return '';
}

function monEquipeLogoHtml(sportIcon, isUs, size) {
  return `<span class="me-logo me-logo-${size} ${isUs ? 'me-logo-us' : 'me-logo-opp'}">${sportIcon}</span>`;
}

function monEquipeBadgeHtml(item) {
  return item.competition ? `<span class="me-badge">${monEquipeEsc(item.competition)}</span>` : '';
}

// En-tête d'une carte : pictogramme + libellé à gauche, lien optionnel à
// droite (`linkHtml` déjà construit par l'appelant).
function monEquipeCardHeadHtml(icon, label, rightHtml, attrs) {
  return `
    <div class="me-card-head"${attrs ? ' ' + attrs : ''}>
      <span class="me-card-title"><span class="me-card-title-icon">${icon}</span>${label}</span>
      ${rightHtml || ''}
    </div>`;
}

// Libellé + flèche ▾ (pivote à l'ouverture, voir style.css) — le libellé
// d'origine est gardé en data-label pour le rétablir à la fermeture.
function monEquipeToggleInnerHtml(label) {
  return `<span class="me-link-label" data-label="${label}">${label}</span><span class="me-link-arrow">▾</span>`;
}
function monEquipeLinkHtml(target, label) {
  return `<button type="button" class="me-link" data-me-toggle="${target}">${monEquipeToggleInnerHtml(label)}</button>`;
}

// Ordre des équipes = lieu (décision du 2026-09-03, conservée) : Domicile →
// "Notre équipe VS Adversaire", Extérieur → "Adversaire VS Notre équipe".
// Plus aucune mention textuelle Domicile/Extérieur — la couleur de l'anneau
// et l'étiquette (MON ÉQUIPE / ADVERSAIRE) indiquent qui est qui.
function monEquipeSides(item, teamName) {
  const us = { name: teamName, isUs: true };
  const opp = { name: item.opponent || '', isUs: false };
  return item.venue !== 'away' ? [us, opp] : [opp, us];
}

function monEquipeTeamBlockHtml(side, sportIcon) {
  return `
    <div class="me-team">
      ${monEquipeLogoHtml(sportIcon, side.isUs, 'lg')}
      <span class="me-team-name">${monEquipeEsc(side.name)}</span>
      <span class="me-tag ${side.isUs ? 'me-tag-us' : 'me-tag-opp'}">${side.isUs ? 'Mon équipe' : 'Adversaire'}</span>
    </div>`;
}

function monEquipeNextCardHtml(item, teamName, sportIcon) {
  if (!item) {
    return `
      <div class="me-card me-card-next">
        ${monEquipeCardHeadHtml('📅', 'Prochain match')}
        <div class="me-card-body"><span class="sports-no-data">Aucun match prévu</span></div>
      </div>`;
  }
  const [left, right] = monEquipeSides(item, teamName);
  const time = monEquipeFormatTime(item);
  return `
    <div class="me-card me-card-next">
      ${monEquipeCardHeadHtml('📅', 'Prochain match', monEquipeBadgeHtml(item))}
      <div class="me-card-body me-next-body">
        <div class="me-next-date">
          <span class="me-date-big">${monEquipeFormatDate(item.date)}</span>
          ${time ? `<span class="me-date-time">${time}</span>` : ''}
        </div>
        <div class="me-next-teams">
          ${monEquipeTeamBlockHtml(left, sportIcon)}
          <span class="me-vs">VS</span>
          ${monEquipeTeamBlockHtml(right, sportIcon)}
        </div>
      </div>
    </div>`;
}

// Ligne de liste (Prochains matchs / Matchs passés) — barre gauche verte
// quand le match est à domicile, rouge à l'extérieur (l'ordre des équipes
// suit la même règle). `middleHtml` = "VS" pour un match à venir, le score
// pour un match passé.
function monEquipeRowHtml(item, teamName, sportIcon, middleHtml, timeHtml) {
  const [left, right] = monEquipeSides(item, teamName);
  const teamHtml = (side) => `
    <span class="me-row-team">
      ${monEquipeLogoHtml(sportIcon, side.isUs, 'sm')}
      <span class="me-row-name" title="${monEquipeEsc(side.name)}">${monEquipeEsc(side.name)}</span>
    </span>`;
  return `
    <div class="me-row ${item.venue === 'away' ? 'me-row-away' : 'me-row-home'}">
      <div class="me-row-date">
        <span class="me-row-day">${monEquipeFormatDate(item.date)}</span>
        ${timeHtml ? `<span class="me-row-time">${timeHtml}</span>` : ''}
      </div>
      ${monEquipeBadgeHtml(item)}
      <div class="me-row-teams">
        ${teamHtml(left)}
        ${middleHtml}
        ${teamHtml(right)}
      </div>
      <span class="me-row-chev">›</span>
    </div>`;
}

function monEquipeUpcomingRowHtml(item, teamName, sportIcon) {
  return monEquipeRowHtml(item, teamName, sportIcon, '<span class="me-vs-pill">VS</span>', monEquipeFormatTime(item));
}

// Résultat plus ancien, déplié sous "Dernier résultat" (2026-09-21, retouche
// demandée : "lignes compactes — date + équipes + score sur une ligne") :
// ni logo, ni badge, ni chevron, pour laisser la place aux noms. Ordre des
// équipes = lieu (voir monEquipeSides) ; le score suit le même ordre, sa
// couleur reste celle du résultat RÉEL de notre équipe.
function monEquipePastRowHtml(item, teamName) {
  const parsed = monEquipeParseScore(item.score);
  let scoreText = item.score || '—';
  if (parsed) {
    scoreText = item.venue === 'away'
      ? `${parsed.opponent} - ${parsed.us}`
      : `${parsed.us} - ${parsed.opponent}`;
  }
  const [left, right] = monEquipeSides(item, teamName);
  const nameHtml = (side, cls) =>
    `<span class="me-row-name ${cls}" title="${monEquipeEsc(side.name)}">${monEquipeEsc(side.name)}</span>`;
  return `
    <div class="me-row me-row-compact ${item.venue === 'away' ? 'me-row-away' : 'me-row-home'}">
      <span class="me-row-day">${monEquipeFormatDate(item.date)}</span>
      ${nameHtml(left, 'me-row-name-left')}
      <span class="me-row-score ${monEquipeUsScoreClass(parsed)}">${monEquipeEsc(scoreText)}</span>
      ${nameHtml(right, 'me-row-name-right')}
    </div>`;
}

// Bloc repliable (fermé par défaut), déplié par l'élément `data-me-toggle`
// de même clé — classList.toggle sur le nœud EXISTANT (jamais un re-render)
// pour que la transition CSS grid-template-rows puisse s'animer.
function monEquipeCollapseHtml(innerHtml, collapseKey) {
  return `<div class="me-collapse" data-me-collapse="${collapseKey}"><div class="me-collapse-inner">${innerHtml}</div></div>`;
}

// "Dernier résultat" — notre équipe TOUJOURS en premier (décision du
// 2026-09-03, conservée : contrairement aux listes, ordre non lié au lieu).
// Le reste des résultats passés (`moreItems`, hors le dernier) est dans un
// bloc replié, déplié par "Voir tous les résultats".
function monEquipeLastResultCardHtml(item, moreItems, teamName, sportIcon) {
  const link = moreItems.length ? monEquipeLinkHtml('results', 'Voir tous les résultats ›') : '';
  if (!item) {
    return `
      <div class="me-card">
        ${monEquipeCardHeadHtml('🏆', 'Dernier résultat')}
        <div class="me-card-body"><span class="sports-no-data">Aucun résultat</span></div>
      </div>`;
  }
  const parsed = monEquipeParseScore(item.score);
  const usScoreClass = monEquipeUsScoreClass(parsed);
  const teamCol = (name, isUs, scoreHtml) => `
    <div class="me-result-team">
      <div class="me-result-id">
        ${monEquipeLogoHtml(sportIcon, isUs, 'md')}
        <span class="me-team-name">${monEquipeEsc(name)}</span>
      </div>
      ${scoreHtml}
    </div>`;
  const middle = parsed
    ? `${teamCol(teamName, true, `<span class="me-score ${usScoreClass}">${parsed.us}</span>`)}
       <span class="me-result-v">v</span>
       ${teamCol(item.opponent || '', false, `<span class="me-score me-score-dim">${parsed.opponent}</span>`)}`
    : `${teamCol(teamName, true, '')}
       <span class="me-score-raw">${monEquipeEsc(item.score || '—')}</span>
       ${teamCol(item.opponent || '', false, '')}`;
  const more = moreItems.length
    ? monEquipeCollapseHtml(`<div class="me-rows">${moreItems.map((i) => monEquipePastRowHtml(i, teamName)).join('')}</div>`, 'results')
    : '';
  return `
    <div class="me-card">
      ${monEquipeCardHeadHtml('🏆', 'Dernier résultat', link)}
      <div class="me-card-body me-result-body">
        <div class="me-result-date">
          ${monEquipeBadgeHtml(item)}
          <span class="me-date-mid">${monEquipeFormatDate(item.date)}</span>
        </div>
        <div class="me-result-teams">${middle}</div>
      </div>
      ${more}
    </div>`;
}

// "Prochains matchs" — MASQUÉ par défaut (retouche du 2026-09-21) : seule la
// ligne d'en-tête est visible, en entier cliquable (flèche + "Voir le
// calendrier"), et déplie la liste. Toujours cliquable même sans autre match
// à venir : le dépliage affiche alors le message d'état vide.
function monEquipeUpcomingCardHtml(items, teamName, sportIcon) {
  const inner = items.length
    ? `<div class="me-rows">${items.map((i) => monEquipeUpcomingRowHtml(i, teamName, sportIcon)).join('')}</div>`
    : '<div class="me-card-body"><span class="sports-no-data">Aucun autre match à venir</span></div>';
  return `
    <div class="me-card">
      ${monEquipeCardHeadHtml(
        '📅', 'Prochains matchs',
        `<span class="me-link">${monEquipeToggleInnerHtml('Voir le calendrier')}</span>`,
        'data-me-toggle="calendar" role="button" tabindex="0" aria-expanded="false"'
      )}
      ${monEquipeCollapseHtml(inner, 'calendar')}
    </div>`;
}

function monEquipeFooterHtml(config) {
  const slogan = monEquipeSlogan(config?.footerSlogan, MON_EQUIPE_DEFAULT_FOOTER);
  return `
    <div class="me-footer">
      <span class="me-legend"><span class="me-dot me-dot-us"></span>Mon équipe</span>
      <span class="me-legend"><span class="me-dot me-dot-opp"></span>Adversaire</span>
      ${slogan ? `<span class="me-slogan">${monEquipeEsc(slogan)}</span>` : ''}
    </div>`;
}

// Un SEUL écouteur par conteneur, posé au premier rendu (`_meBound`) : render()
// est rappelé à chaque refresh sur le même `container` — empiler un écouteur
// par rendu ferait basculer le même repli N fois d'un seul clic (2 clics = 0).
// L'état d'ouverture vit dans le DOM (classe `.expanded`), pas dans une
// variable de fermeture propre à un rendu précis.
function monEquipeBindToggles(container) {
  if (container._meBound) return;
  container._meBound = true;
  const toggle = (trigger) => {
    const target = container.querySelector(`[data-me-collapse="${trigger.dataset.meToggle}"]`);
    if (!target) return;
    const expanded = target.classList.toggle('expanded');
    trigger.classList.toggle('expanded', expanded);
    trigger.setAttribute('aria-expanded', String(expanded));
    const label = trigger.querySelector('.me-link-label');
    if (label) label.textContent = expanded ? 'Réduire' : label.dataset.label;
  };
  container.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-me-toggle]');
    if (trigger) toggle(trigger);
  });
  // En-tête cliquable "Prochains matchs" (role=button) : Entrée/Espace comme un bouton natif.
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const trigger = e.target.closest('[data-me-toggle][role="button"]');
    if (!trigger) return;
    e.preventDefault();
    toggle(trigger);
  });
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
    monEquipeUpdateHeader(container, config, teamName);
    const sportIcon = monEquipeSportIcon(config);

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

    // slice(1, …) : exclut le match/résultat déjà affiché dans sa propre
    // carte au-dessus (upcoming[0]/results[0]) — sans ce décalage il
    // apparaîtrait deux fois (bug déjà corrigé le 2026-08-16).
    container.innerHTML = `
      <div class="me-module">
        ${monEquipeNextCardHtml(upcoming[0] || null, teamName, sportIcon)}
        ${monEquipeLastResultCardHtml(results[0] || null, results.slice(1, 1 + MON_EQUIPE_SECTION_LIMIT), teamName, sportIcon)}
        ${monEquipeUpcomingCardHtml(upcoming.slice(1, 1 + MON_EQUIPE_SECTION_LIMIT), teamName, sportIcon)}
        ${monEquipeFooterHtml(config)}
      </div>
    `;

    monEquipeBindToggles(container);
  },
};
