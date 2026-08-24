// Icône flottante — voir main.js showSunWindow/expandFromSun/
// forceShowMainWindow/showSunContextMenu et renderer/sun.html.
console.log('[Matin/sun] sun.js chargé, window.matin dispo =', !!window.matin, !!window.matin?.displayMode);

const circle = document.getElementById('sunCircle');

// Glisser-déposer ENTIÈREMENT géré à la main (2026-08-23, 2e correctif — voir
// sun.html pour pourquoi -webkit-app-region: drag a été abandonné : il peut
// absorber le mousedown lui-même, empêchant TOUT listener JS de recevoir quoi
// que ce soit sur cette région, y compris mousedown/mouseup). À la place :
// mousedown démarre le suivi, mousemove (sur `window`, pas sur le cercle —
// le curseur peut sortir du disque de 60px pendant un glisser rapide)
// déplace la fenêtre via IPC sun:move, mouseup termine et décide clic vs
// glisser selon la distance parcourue.
let dragging = false;
let moved = false;
let downTime = 0;
let dragStartScreenX = 0;
let dragStartScreenY = 0;
let winStartX = 0;
let winStartY = 0;

circle.addEventListener('mousedown', async (e) => {
  console.log('[Matin/sun] mousedown');
  dragging = true;
  moved = false;
  downTime = Date.now();
  dragStartScreenX = e.screenX;
  dragStartScreenY = e.screenY;
  try {
    const pos = await window.matin.displayMode.getSunPosition();
    winStartX = pos.x;
    winStartY = pos.y;
  } catch (err) {
    console.error('[Matin/sun] Échec lecture position', err);
  }
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - dragStartScreenX;
  const dy = e.screenY - dragStartScreenY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
  if (moved) {
    window.matin.displayMode.moveSunWindow(winStartX + dx, winStartY + dy);
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  const elapsed = Date.now() - downTime;
  console.log('[Matin/sun] mouseup — moved =', moved, 'elapsed =', elapsed);
  if (!moved && elapsed < 500) {
    console.log('[Matin/sun] clic détecté → expandFromSun()');
    window.matin.displayMode.expandFromSun()
      .then((r) => console.log('[Matin/sun] expandFromSun() OK', r))
      .catch(err => console.error('[Matin/sun] Échec expansion depuis le soleil', err));
  }
});

// Filet de secours (sur demande explicite, point 5) — double-clic force
// l'affichage du dashboard SANS AUCUNE condition côté main.js (voir
// forceShowMainWindow), y compris si le clic simple ci-dessus restait sans
// effet pour une raison quelconque.
circle.addEventListener('dblclick', () => {
  console.log('[Matin/sun] dblclick → forceShowFromSun()');
  window.matin.displayMode.forceShowFromSun()
    .then((r) => console.log('[Matin/sun] forceShowFromSun() OK', r))
    .catch(err => console.error('[Matin/sun] Échec forceShow', err));
});

// Clic droit — menu contextuel construit côté main.js (voir
// showSunContextMenu), ce script ne fait que relayer l'événement.
circle.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  console.log('[Matin/sun] contextmenu → showSunContextMenu()');
  window.matin.displayMode.showSunContextMenu().catch(err => console.error('[Matin/sun] Échec ouverture du menu contextuel', err));
});
