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

// Étape 2 de runDemo() — zoom successif sur chaque module phare.
async function showcaseModules() {
  // Liste ordonnée : [clé de module MODULE_REGISTRY (dashboard.js), durée
  // d'affichage ms].
  // ÉCART signalé : la demande donnait des sélecteurs `[data-module="..."]`,
  // mais dashboard.js (`createModuleCard`) ne pose JAMAIS d'attribut
  // `data-module` sur `.module-card` — seulement un id `module-<clé>`
  // (`card.id = \`module-${key}\``). Adapté en `#module-<clé>` avec les
  // VRAIES clés de MODULE_REGISTRY : `epic-promos` → `epicPromos`,
  // `fdj-euromillions` → `fdjEuromillions`, `tech-sources` → `tech` (le nom
  // du FICHIER `modules/tech-sources.js` n'est pas la clé du module),
  // `france-sources` (annoté "News Santé, adapter si module distinct" dans
  // la demande) → `sante`, un module RÉELLEMENT distinct de `france`
  // (actualité France générale, pas Santé).
  const highlights = [
    ['live',            2200],  // LIVE FOOT!
    ['etf',             1800],  // Actions/ETF
    ['weather',         1600],  // Météo
    ['cinema',          1800],  // Cinéma
    ['epicPromos',      1800],  // Epic Games
    ['fdjEuromillions', 1600],  // EuroMillions
    ['youtube',         1800],  // YouTube
    ['tech',            1600],  // News Tech
    ['sante',           1600],  // News Santé
    ['hue',             1800],  // Philips Hue
  ];

  for (const [key, duration] of highlights) {
    const card = document.getElementById(`module-${key}`);
    if (!card) continue;

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);

    card.style.transition = 'transform 0.35s ease, box-shadow 0.35s ease, z-index 0s';
    card.style.transform = 'scale(1.08)';
    card.style.boxShadow = '0 8px 32px rgba(79,142,247,0.35)';
    card.style.zIndex = '999';

    await sleep(duration);

    card.style.transform = '';
    card.style.boxShadow = '';
    card.style.zIndex = '';
    await sleep(250);
  }
}

// Étape 3 de runDemo() — "réorganisation" : réutilise le bouton "⊞
// Réorganiser" DÉJÀ existant (dashboard.js, #btnAutoArrange/
// performAutoArrange) plutôt que de dupliquer sa logique de packing — simule
// exactement le parcours qu'un utilisateur suit à la main (clic qui ouvre la
// confirmation, puis clic sur "OK" de cette confirmation).
async function reorganizeShowcase() {
  document.getElementById('btnAutoArrange')?.click();
  await sleep(200);
  document.getElementById('autoArrangeConfirmOk')?.click();
}

async function runDemo() {
  await revealCards();
  await showcaseModules();
  await reorganizeShowcase();
}

window.runDemo = runDemo;
