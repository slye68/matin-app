/**
 * Module Raccourcis Google (2026-09-13, sur demande explicite) — colonne
 * étroite d'icônes cliquables, aucune donnée réseau à charger (les icônes
 * sont des favicons Google chargées directement en <img>, pas via
 * window.matin.rss.fetchFeed : une simple image cross-origin ne pose pas les
 * problèmes CORS d'un fetch JSON, et `img-src https:` est déjà autorisé par
 * la CSP d'index.html/config.html).
 *
 * Card SANS en-tête visible (voir style.css #module-shortcuts .module-header,
 * réduit à un fin bandeau de préhension plutôt que supprimé — nécessaire pour
 * que le glisser-déposer générique, ancré sur .module-header pour tous les
 * autres modules, reste possible ici aussi ; voir dashboard.js
 * makeInteractive/allowFrom, élargi pour ce module précis).
 *
 * ⚙️ + tooltip (pas de texte visible) quand tout est désactivé — la carte
 * fait 56px de large, une phrase complète n'y tiendrait jamais : le message
 * demandé ("Activez des raccourcis dans les Paramètres") vit dans l'attribut
 * `title` du bouton, comme le nom de chaque raccourci normal
 * (`.shortcut-btn` a déjà ce mécanisme de tooltip, voir style.css).
 */
window.MatinModules = window.MatinModules || {};

function shortcutsFaviconUrl(url) {
  const domain = new URL(url).hostname;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// `s.iconUrl` (shortcuts-defs.js) prend le pas sur le favicon Google quand
// présent — actuellement le cas de Drive uniquement, voir shortcuts-defs.js.
function shortcutsIconUrl(s) {
  return s.iconUrl || shortcutsFaviconUrl(s.url);
}

function shortcutsBtnHtml(s) {
  return `
    <button type="button" class="shortcut-btn" data-url="${s.url}" data-label="${s.label}" title="${s.label}">
      <img src="${shortcutsIconUrl(s)}" alt="${s.label}" loading="lazy">
    </button>`;
}

// Icônes proportionnelles à la largeur de la colonne (2026-09-13, sur demande
// explicite) — SEULEMENT en orientation verticale : c'est le seul cas où
// cette largeur reflète un choix de l'utilisateur (redimensionnement à la
// souris, voir dashboard.js isAutoWidthKey/edges.right). En horizontal, la
// largeur du conteneur est la SOMME des icônes (largeur auto, pilotée par
// leur nombre) — l'utiliser comme entrée du calcul de leur propre taille
// bouclerait sur elle-même (chaque icône ajoutée agrandirait TOUTES les
// icônes) ; le CSS (voir style.css) garde donc sa taille statique par
// défaut (48px) dans ce mode, faute de valeurs `--icon-*` posées ici.
function setupShortcutsResize(moduleEl) {
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      // Bornes 24–96px (voir demande explicite, "éviter les extrêmes") —
      // un module très étroit resterait lisible, un très large ne ferait pas
      // exploser les icônes.
      const iconSize = Math.min(96, Math.max(24, Math.round(w * 0.75)));
      // Fixe à 3px (2026-09-13, sur demande explicite, "le module est trop
      // imposant en hauteur à cause des gaps") — PAS proportionnel à la
      // largeur comme iconSize/borderRadius ci-dessus/dessous : un espace
      // minimal mais visible entre les icônes, quelle que soit la largeur de
      // la colonne (un pourcentage aurait fait grandir le vide entre icônes
      // en même temps qu'elles, à l'opposé du but recherché).
      const gap = 3;
      const borderRadius = Math.round(w * 0.18);
      moduleEl.style.setProperty('--icon-size', `${iconSize}px`);
      moduleEl.style.setProperty('--icon-gap', `${gap}px`);
      moduleEl.style.setProperty('--icon-radius', `${borderRadius}px`);
    }
  });
  ro.observe(moduleEl);
  // Pas de cycle de destruction par module dans cette appli (tout changement
  // de config déclenche un `location.reload()` complet, voir config.js/
  // dashboard.js 'modules:updated') — déconnecté au déchargement de la page
  // par précaution plutôt que par nécessité stricte ici.
  window.addEventListener('beforeunload', () => ro.disconnect());
}

window.MatinModules.shortcuts = {
  async render(container, config, _google, setBadge) {
    // `visible[id] !== false` (pas `=== true`) — un service ABSENT de
    // `config.visible` (config d'avant l'ajout d'un futur 7e raccourci, par
    // exemple) reste affiché par défaut plutôt que masqué silencieusement,
    // même logique que `config.selected` absent = tout affiché pour Indices.
    const visible = config?.visible || {};
    const active = window.ShortcutsDefs.filter(s => visible[s.id] !== false);
    // 'horizontal' | 'vertical' (défaut) — voir config.js renderShortcutsConfigSection.
    const orientationClass = config?.orientation === 'horizontal' ? ' horizontal' : '';

    if (!active.length) {
      container.innerHTML = `
        <div class="shortcuts-module shortcuts-empty${orientationClass}">
          <button type="button" class="shortcuts-empty-btn" title="Activez des raccourcis dans les Paramètres">⚙️</button>
        </div>`;
      setBadge('—');
      return;
    }

    container.innerHTML = `<div class="shortcuts-module${orientationClass}">${active.map(shortcutsBtnHtml).join('')}</div>`;
    container.querySelectorAll('.shortcut-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.matin.shell.openExternal(btn.dataset.url);
      });
    });
    if (config?.orientation !== 'horizontal') {
      setupShortcutsResize(container.querySelector('.shortcuts-module'));
    }
    setBadge('');
  },
};
