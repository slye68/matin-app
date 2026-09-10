// ─── Mode démo — présentation automatisée des modules phares (2026-09-09,
// sur demande explicite) ────────────────────────────────────────────────
// ÉCART MAJEUR signalé avant d'écrire ce fichier, confirmé par l'utilisateur
// (voir CONTEXT.md) : ni ce fichier, ni aucune fonction `runDemo()`, ni
// aucune "section modules phares" n'existaient nulle part dans le projet
// avant cette demande (recherche exhaustive faite dans tout `renderer/`).
// Construit ENTIÈREMENT from scratch avec une structure raisonnable — à
// ajuster si elle ne correspond pas à ce qui était imaginé.
//
// Pensé pour un enregistrement d'écran/démo promotionnelle de l'app (paiement
// unique, Windows Store) : lancer manuellement `runDemo()` depuis la console
// DevTools du dashboard pendant l'enregistrement. Aucun bouton ni raccourci
// clavier n'a été ajouté pour le déclencher — la demande n'en mentionnait
// aucun ; à ajouter si besoin (ex. un raccourci clavier discret, non exposé
// dans l'UI, pour ne pas polluer la barre d'outils d'un mode réservé aux
// captures).

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Étape 1 de runDemo() — "apparition initiale des cartes" : les cartes sont
// déjà présentes dans le DOM à ce stade (créées par dashboard.js
// initDashboard(), chargé avant ce fichier, voir index.html) — cette étape
// ne les CRÉE pas, elle les fait réapparaître en séquence (fondu + léger
// scale-in, décalées carte par carte dans leur ordre actuel) pour un effet
// de présentation, puis referme proprement les styles inline posés.
async function revealCards() {
  const cards = Array.from(document.querySelectorAll('.module-card'));

  cards.forEach((card) => {
    card.style.transition = 'none';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.92)';
  });
  // Force un reflow avant de réactiver la transition ci-dessous : sans ça,
  // le navigateur fusionnerait l'état initial et l'état final en une seule
  // frame (aucun fondu visible).
  void document.body.offsetHeight;

  for (const card of cards) {
    card.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    card.style.opacity = '1';
    card.style.transform = 'scale(1)';
    await sleep(80);
  }
  await sleep(400);

  cards.forEach((card) => {
    card.style.transition = '';
    card.style.opacity = '';
    card.style.transform = '';
  });
}

// Étape 2 (et 4) de runDemo() — zoom successif sur chaque module phare.
// Prend désormais un tableau de clés en paramètre (2026-09-10, sur demande
// explicite — remplace la liste unique codée en dur, `runDemo()` appelle
// maintenant cette fonction 2 fois avec 2 listes différentes). ÉCART signalé
// : la demande ne donne plus de durée par clé (juste un tableau de clés) —
// une durée FIXE `SHOWCASE_DURATION_MS` (1800ms, la valeur la plus courante
// de l'ancienne liste codée en dur) s'applique désormais à CHAQUE module,
// plus de variation par module comme avant (LIVE FOOT! avait 2200ms, Météo/
// EuroMillions/Tech/Santé 1600ms) — à ajuster si une durée par clé était en
// fait toujours voulue.
// Sélecteurs déjà corrigés lors de l'écriture initiale de ce fichier :
// `#module-<clé>` (jamais `[data-module]`, absent de createModuleCard).
const SHOWCASE_DURATION_MS = 1800;
async function showcaseModules(keys) {
  for (const key of keys) {
    const card = document.getElementById(`module-${key}`);
    if (!card) continue;

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);

    card.style.transition = 'transform 0.35s ease, box-shadow 0.35s ease, z-index 0s';
    card.style.transform = 'scale(1.08)';
    card.style.boxShadow = '0 8px 32px rgba(79,142,247,0.35)';
    card.style.zIndex = '999';

    await sleep(SHOWCASE_DURATION_MS);

    card.style.transform = '';
    card.style.boxShadow = '';
    card.style.zIndex = '';
    await sleep(250);
  }
}

// Étapes 3 et 5 de runDemo() — "switch de profil" (2026-09-09, complétée
// 2026-09-10 sur demande explicite pour un comportement ASYMÉTRIQUE : 1er
// appel = bascule vers le profil 2 + attend 12s avant de rendre la main
// (pour que le showcaseModules suivant "tourne sur le profil 2"), 2e appel =
// retour au profil 1 SANS délai supplémentaire. Le nouvel appelant
// (`runDemo`, plus bas) appelle cette fonction 2 FOIS SANS ARGUMENT — la
// direction est donc déduite d'un état interne (`demoProfileIsOnTwo`,
// toggle simple), pas d'un paramètre explicite.
// ÉCART MAJEUR conservé de la version précédente, toujours valable : la
// demande cherchait 2 onglets `.profile-tab` cliquables + une fonction
// switchProfile/activateProfile/loadProfile dans dashboard.js/config.js.
// `.profile-tab` vit UNIQUEMENT dans config.js/config.html (initProfileTabs),
// une fenêtre Electron SÉPARÉE de celle où tourne ce fichier — AUCUN
// `.profile-tab` n'existe dans LE DOM de cette fenêtre. Le seul mécanisme de
// bascule ICI est `#btnProfileSwitch` (dashboard.js initProfileSwitcher),
// mais un VRAI clic appelle `window.matin.profiles.switch()` → `modules:
// updated` → `window.location.reload()` de TOUTE la fenêtre (dashboard.js,
// onUpdated) : un reload détruirait `runDemo()` en cours d'exécution, sans
// jamais atteindre les étapes suivantes. Simulation PUREMENT VISUELLE
// conservée : anime juste `#btnProfileSwitch` (pulse + halo), n'appelle
// JAMAIS `window.matin.profiles.switch()`, ne touche jamais au profil
// réellement actif. Les 12s d'attente du 1er appel ne "débloquent" donc rien
// de réel côté données (aucun vrai changement de profil ne se produit) —
// respectées telles quelles car explicitement demandées dans le timing de la
// séquence, pas parce qu'elles seraient fonctionnellement nécessaires ici.
let demoProfileIsOnTwo = false;
async function demoSwitchProfile() {
  const btn = document.getElementById('btnProfileSwitch');
  if (!btn) return;

  const goingToProfileTwo = !demoProfileIsOnTwo;
  demoProfileIsOnTwo = goingToProfileTwo;

  const originalTransition = btn.style.transition;
  const originalTransform = btn.style.transform;
  const originalBoxShadow = btn.style.boxShadow;
  btn.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';

  btn.style.transform = 'scale(0.94)';
  btn.style.boxShadow = '0 0 0 2px var(--accent)';
  await sleep(180);
  btn.style.transform = 'scale(1)';
  await sleep(200);

  btn.style.transform = originalTransform;
  btn.style.boxShadow = originalBoxShadow;
  btn.style.transition = originalTransition;

  if (goingToProfileTwo) await sleep(12000);
}

// Étape 6 de runDemo() — "réorganisation déjà sauvegardée" (2026-09-09, sur
// demande explicite) : permutation purement visuelle des positions RÉELLES
// (`card.dataset.x/y`, source de vérité posée par `placeCard`, voir
// dashboard.js) de quelques cartes, via `transform` CSS — ne touche jamais
// `card.style.left/top`/`card.dataset.x/y` eux-mêmes, donc rien à re-persister
// ni à faire recalculer par dashboard.js : un simple retour à
// `transform: none` suffit à tout annuler.
async function demoShowSavedLayout() {
  const cards = Array.from(document.querySelectorAll('.module-card'));
  const shuffled = cards.slice(0, Math.min(4, cards.length));
  if (shuffled.length < 2) return;

  const positions = shuffled.map((card) => ({
    x: parseFloat(card.dataset.x) || 0,
    y: parseFloat(card.dataset.y) || 0,
  }));

  shuffled.forEach((card, i) => {
    const target = positions[(i + 1) % shuffled.length];
    const dx = target.x - positions[i].x;
    const dy = target.y - positions[i].y;
    card.style.transition = 'transform 0.6s ease';
    card.style.zIndex = '999';
    card.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  // 3000 → 5000ms (2026-09-10, sur demande explicite — inféré de la nouvelle
  // séquence de runDemo(), "attend 5 secondes, restaure", pas listé dans les
  // "Détails des changements" mais explicite dans le schéma de séquence).
  await sleep(5000);

  shuffled.forEach((card) => { card.style.transform = ''; });
  await sleep(650); // laisse l'animation retour (transition déjà posée ci-dessus) se terminer avant de nettoyer

  shuffled.forEach((card) => {
    card.style.transition = '';
    card.style.zIndex = '';
  });
}

// Étape 7 de runDemo() — "réorganisation" : réutilise le bouton "⊞
// Réorganiser" DÉJÀ existant (dashboard.js, #btnAutoArrange/
// performAutoArrange) plutôt que de dupliquer sa logique de packing — simule
// exactement le parcours qu'un utilisateur suit à la main (clic qui ouvre la
// confirmation, puis clic sur "OK" de cette confirmation). Délai 200 → 3000ms
// (2026-09-10, sur demande explicite, "attend 3 secondes que la fenêtre soit
// bien visible à l'écran, PUIS clique sur Confirmer" — l'ancien délai de
// 200ms était pensé pour la fluidité de l'ENREGISTREMENT/JS, pas pour
// laisser le temps à un spectateur de VOIR la popup avant qu'elle ne se
// referme).
async function reorganizeShowcase() {
  document.getElementById('btnAutoArrange')?.click();
  await sleep(3000);
  document.getElementById('autoArrangeConfirmOk')?.click();
}

// Nouvelle séquence (2026-09-10, sur demande explicite, remplace
// entièrement l'ancienne) — clés de modules vérifiées contre MODULE_REGISTRY
// (dashboard.js) : `ol`/`monEquipe`/`hue`/`fdjEuromillions` étaient déjà
// correctes telles que données. SEUL écart trouvé : `carburants` n'existe
// PAS comme clé — le module Carburants (label affiché "Carburants") a pour
// clé réelle `fuelPrices` (`fuelPrices: { label: 'Carburants', ... }`,
// dashboard.js) — corrigé en conséquence, sinon `showcaseModules`
// l'aurait silencieusement ignoré (`if (!card) continue;`).
async function runDemo() {
  await revealCards();
  await showcaseModules(['live', 'youtube', 'tech', 'cinema', 'ol', 'monEquipe', 'spotify']);
  await demoSwitchProfile(); // → profil 2 (visuel), attend 12s avant de rendre la main
  await showcaseModules(['etf', 'hue', 'fdjEuromillions', 'fuelPrices']); // "carburants" → fuelPrices
  await demoSwitchProfile(); // → retour profil 1 (visuel), sans délai supplémentaire
  await demoShowSavedLayout();
  await reorganizeShowcase();
}

window.runDemo = runDemo;

// Variante "forcée en mode clair" de runDemo() (2026-09-10, sur demande
// explicite) — `window.matin.theme.set` vérifié dans preload.js avant usage
// (`theme: { set: (theme) => ipcRenderer.invoke('app:setTheme', theme), ... }`,
// forme exacte confirmée, aucune adaptation nécessaire cette fois). `runDemo`
// était déjà `async` avec un `sleep(ms)` réutilisable en tête de fichier —
// aucune conversion nécessaire, réutilisés tels quels.
async function runDemoLight() {
  const prevTheme = document.documentElement.dataset.colorScheme || 'dark';
  document.documentElement.dataset.colorScheme = 'light';
  await window.matin.theme.set('light');
  await sleep(800);

  await runDemo();

  document.documentElement.dataset.colorScheme = prevTheme;
  await window.matin.theme.set(prevTheme);
}
// Exposée sur `window`, comme `runDemo` juste au-dessus (ajout au-delà de la
// demande littérale) — permet de la lancer aussi depuis la console DevTools,
// pas seulement via le raccourci clavier.
window.runDemoLight = runDemoLight;

// Variante "showcase + Paramètres" (2026-09-10, sur demande explicite) —
// DISTINCTE de runDemoLight() ci-dessus (conservée telle quelle, sur décision
// explicite de ne pas fusionner les 2) : bascule en clair, montre 5 modules,
// ouvre la fenêtre Paramètres et navigue entre 4 onglets/sections, la
// referme, restaure le thème d'origine. Pilote la fenêtre Paramètres — un
// PROCESSUS RENDERER SÉPARÉ, aucun accès direct à son DOM depuis ici — via
// window.matin.demo.configTab/configClickBtn (voir preload.js/main.js/
// config.js, canal IPC dédié). ÉCART signalé : "carburants" n'existe pas
// comme clé de module (même correctif déjà appliqué dans runDemo() plus haut)
// — la clé réelle du module "Carburants" est `fuelPrices`.
async function runDemoSettings() {
  const prevTheme = document.documentElement.dataset.colorScheme || 'dark';

  document.documentElement.dataset.colorScheme = 'light';
  await window.matin.theme.set('light');
  await sleep(800);

  await revealCards();
  await showcaseModules(['etf', 'gmail', 'hue', 'fdjEuromillions', 'fuelPrices']); // "carburants" → fuelPrices

  await sleep(1000);

  await window.matin.window.openConfig();
  await sleep(1500); // laisser la fenêtre s'ouvrir

  await window.matin.demo.configTab('actualites');
  await sleep(2500);

  await window.matin.demo.configTab('loisirs');
  await sleep(2500);

  await window.matin.demo.configTab('services');
  await sleep(2500);

  await window.matin.demo.configClickBtn('btnPersonnaliser'); // 🎨 Personnaliser (Fond du dashboard + Mode d'affichage)
  await sleep(3000);

  await window.matin.window.closeConfig();
  await sleep(800);

  document.documentElement.dataset.colorScheme = prevTheme;
  await window.matin.theme.set(prevTheme);
}
window.runDemoSettings = runDemoSettings;

// Ctrl+Shift+D — déclenche runDemo() sans passer par la console
// (usage enregistrement vidéo uniquement — non exposé dans l'UI)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    runDemo();
  }
});

// Ctrl+Shift+L — même usage que Ctrl+Shift+D ci-dessus, pour runDemoLight()
// (démo forcée en mode clair, thème d'origine restauré à la fin).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'L') {
    e.preventDefault();
    runDemoLight();
  }
});

// Ctrl+Shift+P — même usage que Ctrl+Shift+D/L ci-dessus, pour
// runDemoSettings() (Ctrl+Shift+L déjà pris par runDemoLight() existant,
// P pour "Paramètres" — le raccourci littéralement demandé pour cette
// nouvelle séquence entrait en conflit, voir commentaire de runDemoSettings).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'P') {
    e.preventDefault();
    runDemoSettings();
  }
});
