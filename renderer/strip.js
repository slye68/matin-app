// Bande du volet latéral (2026-09-01, réécriture complète — voir main.js
// showStripWindow/sidebarStripClick, et renderer/dashboard.js pour Échap
// côté dashboard). Cette fenêtre ne fait QUE relayer un clic — aucune
// position/taille n'est calculée ici, main.js dimensionne/positionne
// entièrement cette fenêtre (voir computeStripBounds).
console.log('[Matin/strip] strip.js chargé, window.matin dispo =', !!window.matin, !!window.matin?.displayMode);

const handle = document.getElementById('stripHandle');
const arrow = document.getElementById('stripArrow');

// Sens de la flèche selon le bord choisi (Paramètres → Personnaliser) — lu
// une seule fois au chargement : cette fenêtre est entièrement recréée à
// chaque fois qu'elle redevient nécessaire (voir main.js showStripWindow),
// jamais gardée ouverte pendant qu'on change le réglage depuis Paramètres,
// donc pas besoin d'écouter un changement en direct ici.
window.matin.store.get('app.sidebarEdge').then((edge) => {
  arrow.textContent = edge === 'left' ? '▶' : '◀';
});

handle.addEventListener('click', () => {
  console.log('[Matin/strip] clic → sidebarStripClick()');
  window.matin.displayMode.sidebarStripClick()
    .catch(err => console.error('[Matin/strip] Échec clic sur la bande', err));
});
