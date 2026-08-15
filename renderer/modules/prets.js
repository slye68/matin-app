/**
 * Module Prêts immobiliers — 100% calcul local, aucune API/réseau.
 *
 * Instances multiples comme Sports (voir dashboard.js, isPretsKey) : "prets"
 * garde la clé de base, jusqu'à 4 groupes supplémentaires ("prets_2".."prets_5")
 * ajoutés depuis Paramètres — un groupe = une instance = une carte dashboard,
 * chacune affichant jusqu'à 5 prêts (config.loans).
 *
 * RECONSTRUIT le 2026-08-08 (sur demande explicite) pour supporter les
 * PALIERS de remboursement (mensualité qui change à des dates données — cas
 * réel des prêts à paliers/relais, pas juste des prêts classiques à
 * mensualité fixe). La formule fermée d'amortissement (CRD(n) = montant×
 * (1+r)^n − mensualité×[((1+r)^n−1)/r]) suppose une mensualité CONSTANTE sur
 * toute la durée — invalide dès qu'un palier change la mensualité en cours de
 * route. Remplacée par une SIMULATION mois par mois (voir pretsSimulateLoan) :
 * plus lent qu'une formule fermée mais trivial en pratique (un prêt de 25 ans
 * = 300 itérations max) et gère nativement fixe ET paliers avec le même code
 * — pas de branche séparée par type, `pretsPaymentForMonth` est le seul point
 * qui varie entre les deux.
 *
 * Chaque prêt a désormais une date de FIN explicite (`endDate`, saisie par
 * l'utilisateur) plutôt qu'une durée en mois calculée — remplace l'ancien
 * champ `durationMonths`. Un prêt encore configuré à l'ancien format (créé
 * avant cette reconstruction, sans `endDate`) retombe sur son `durationMonths`
 * existant pour ne pas perdre les données déjà saisies (voir pretsLoanEndDate).
 *
 * Mode confidentialité (🔒) scopé PAR INSTANCE — pas un seul état partagé
 * comme ETF/Crypto (module UNIQUE, un seul état suffit) : la clé localStorage
 * est dérivée de `container.id` (posé par dashboard.js/createModuleCard comme
 * `content-<clé>`, ex. "content-prets_2") plutôt que passée en paramètre —
 * évite de changer la signature de render() partagée par tous les modules.
 */
window.MatinModules = window.MatinModules || {};

const PRETS_MAX_LOANS = 5;
// Plafond de sécurité sur la simulation avant du CRD → fin de prêt : évite une
// boucle infinie si une mensualité mal saisie ne couvre même pas les intérêts
// (le capital ne baisserait alors jamais). 900 mois = 75 ans, largement au-delà
// de tout prêt immobilier réel.
const PRETS_MAX_SIMULATION_MONTHS = 900;

// Mois pleins entre 2 dates (peut être négatif) — n'ajuste PAS au jour du mois,
// c'est au chargement de fonction de le faire si besoin (voir pretsPaidMonths,
// qui l'utilise pour le nombre de mensualités VERSÉES, où le jour importe).
function pretsMonthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// Nombre de mensualités déjà versées à `now`.
//
// CORRIGÉ le 2026-08-09 (sur demande explicite, ~754€ d'écart signalé vs le
// calcul de la banque sur "Classique 310") : un mois n'est compté "plein" que
// s'il a atteint/dépassé le JOUR DE PRÉLÈVEMENT du mois en cours (déjà
// correct depuis la correction précédente du même jour) — MAIS il manquait
// un décalage côté DATE DE DÉPART, découvert en comparant le calcul aux 3
// relevés réels de banque de l'utilisateur (Optiplan/Classique 309/Classique
// 310, tous les 3 avec la même date de départ et le même jour de prélèvement) :
// la 1re mensualité RÉELLEMENT prélevée n'est PAS le premier jour de
// prélèvement suivant la date de départ, mais le SUIVANT ENCORE — la banque
// facture un mois d'intérêts intercalaires entre le déblocage des fonds et le
// premier jour de prélèvement disponible, et ne démarre l'amortissement
// qu'au cycle de prélèvement SUIVANT ce premier jour. Vérifié à l'euro (en
// fait au centime) près sur les 3 prêts réels de l'utilisateur simultanément
// avant d'être encodé ici — un accord aussi précis sur 3 prêts indépendants
// n'arrive pas par hasard.
//
// `firstAvailableDebitOffset` = 0 si le jour de prélèvement tombe encore
// DANS le mois de départ (jour de prélèvement > jour de départ), sinon 1
// (premier jour de prélèvement disponible reporté au mois suivant). Le "+1"
// après représente le mois d'intérêts intercalaires sauté (1re mensualité
// réelle = 2e jour de prélèvement disponible, jamais le 1er).
//
// NB : `totalMonths` (durée totale, voir pretsLoanEndDate) n'a PAS reçu le
// même ajustement — aucune donnée réelle de prêt proche de son terme pour le
// vérifier à ce jour ; à corriger si un écart apparaît un jour en fin de prêt.
function pretsPaidMonths(start, now, totalMonths, debitDay) {
  // Offset 0 : le jour de prélèvement est ENCORE disponible dans le mois de
  // départ (débit possible le même mois, dès lors que debitDay >= le jour de
  // départ — un débit programmé le jour même du départ compte). Offset 1 :
  // le jour de prélèvement du mois de départ est déjà passé, 1er débit
  // disponible reporté au mois suivant.
  const firstAvailableDebitOffset = start.getDate() <= debitDay ? 0 : 1;
  const firstPaymentOffset = firstAvailableDebitOffset + 1; // + le mois intercalaire sauté

  let n = pretsMonthsBetween(start, now) - firstPaymentOffset + 1;
  if (now.getDate() < debitDay) n -= 1;
  n = Math.max(0, n);
  return totalMonths != null ? Math.min(totalMonths, n) : n;
}

// Date de fin effective d'un prêt — `endDate` si saisie (nouveau format),
// sinon repli sur l'ancien `durationMonths` (prêts créés avant cette
// reconstruction) pour ne rien perdre de silencieusement invalide.
function pretsLoanEndDate(loan, start) {
  if (loan.endDate) return new Date(`${loan.endDate}T00:00:00`);
  const duration = Math.round(Number(loan.durationMonths)) || 0;
  if (!duration) return null;
  return new Date(start.getFullYear(), start.getMonth() + duration, start.getDate());
}

// Mensualité applicable à un MOIS donné. Fixe : toujours la même valeur.
// Paliers : le palier dont l'intervalle [début, fin] couvre ce mois ; si aucun
// ne le couvre exactement (ex. un mois après le dernier palier configuré, ou
// avant le tout premier), on retombe sur le palier le plus proche déjà
// commencé (report de la dernière mensualité connue) plutôt que 0 — plus
// réaliste qu'un trou de paiement pour une simulation prévisionnelle.
function pretsPaymentForMonth(loan, monthDate) {
  if (loan.paymentType !== 'paliers') return Number(loan.monthlyPayment) || 0;

  const paliers = (Array.isArray(loan.paliers) ? loan.paliers : []).filter(p => p.startDate && p.endDate);
  const active = paliers.find(p =>
    monthDate >= new Date(`${p.startDate}T00:00:00`) && monthDate <= new Date(`${p.endDate}T23:59:59`)
  );
  if (active) return Number(active.monthlyPayment) || 0;

  const started = paliers
    .filter(p => new Date(`${p.startDate}T00:00:00`) <= monthDate)
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  return started.length ? (Number(started[0].monthlyPayment) || 0) : 0;
}

// Prochain changement de palier après `now` — le palier dont le début est le
// plus proche dans le futur. `null` si aucun palier futur configuré (fixe, ou
// paliers dont aucun ne commence après aujourd'hui — mensualité stable).
function pretsNextPalierChange(loan, now) {
  if (loan.paymentType !== 'paliers') return null;
  const future = (Array.isArray(loan.paliers) ? loan.paliers : [])
    .filter(p => p.startDate && new Date(`${p.startDate}T00:00:00`) > now)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  if (!future.length) return null;

  const next = future[0];
  const startDate = new Date(`${next.startDate}T00:00:00`);
  return {
    monthlyPayment: Number(next.monthlyPayment) || 0,
    startDate,
    monthsUntil: Math.max(0, pretsMonthsBetween(now, startDate)),
  };
}

// Simulation mois par mois — cœur du module (voir en-tête du fichier). Deux
// passes : (1) PASSÉ, du début du prêt à aujourd'hui, pour le CRD réel et les
// intérêts déjà payés ; (2) AVENIR, d'aujourd'hui à la fin du prêt (ou jusqu'à
// solde nul), pour les intérêts restants et le temps restant réel — pas de
// simple soustraction "durée totale − mois payés", puisqu'un palier futur à
// mensualité plus élevée peut solder le prêt PLUS TÔT que la date de fin
// initialement prévue, et une mensualité trop basse peut au contraire ne
// jamais y arriver (voir garde-fou PRETS_MAX_SIMULATION_MONTHS).
function pretsSimulateLoan(loan, now) {
  const amount = Number(loan.amount) || 0;
  const annualRate = Number(loan.rate) || 0;
  const r = annualRate / 100 / 12;
  const start = loan.startDate ? new Date(`${loan.startDate}T00:00:00`) : null;

  if (!start || !amount) {
    return {
      crd: amount, percentPaid: 0, endDate: null, remainingMonths: null,
      totalInterestPaid: 0, totalInterestRemaining: null,
      currentPayment: 0, nextChange: null, debitDay: null,
    };
  }

  const endDate = pretsLoanEndDate(loan, start);
  const totalMonths = endDate ? pretsMonthsBetween(start, endDate) : null;
  // Jour de prélèvement réel (1-31, saisi par l'utilisateur) — repli sur le
  // jour de la date de départ pour un prêt créé avant l'ajout de ce champ.
  const debitDay = Number(loan.debitDay) || start.getDate();
  const paidMonths = pretsPaidMonths(start, now, totalMonths, debitDay);

  let balance = amount;
  let totalInterestPaid = 0;
  const cursor = new Date(start);
  for (let i = 0; i < paidMonths && balance > 0.005; i++) {
    const interest = balance * r;
    const payment = pretsPaymentForMonth(loan, cursor);
    const principal = Math.min(balance, Math.max(0, payment - interest));
    totalInterestPaid += interest;
    balance = Math.max(0, balance - principal);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const crd = balance;

  // Avenir : combien de mois et d'intérêts restent RÉELLEMENT, en tenant
  // compte des paliers déjà connus (futurs) plutôt que de supposer que la
  // date de fin saisie sera exactement respectée.
  let remBalance = crd;
  let totalInterestRemaining = 0;
  let remainingMonths = 0;
  const remCursor = new Date(cursor);
  while (remBalance > 0.5 && remainingMonths < PRETS_MAX_SIMULATION_MONTHS) {
    const interest = remBalance * r;
    const payment = pretsPaymentForMonth(loan, remCursor);
    const principal = payment - interest;
    if (principal <= 0) break; // mensualité insuffisante pour amortir — jamais soldé, on arrête la simulation plutôt que boucler
    totalInterestRemaining += interest;
    remBalance = Math.max(0, remBalance - Math.min(remBalance, principal));
    remCursor.setMonth(remCursor.getMonth() + 1);
    remainingMonths++;
  }

  const percentPaid = amount ? Math.min(100, Math.max(0, ((amount - crd) / amount) * 100)) : 0;

  return {
    crd,
    percentPaid,
    endDate,
    remainingMonths: crd > 0.5 ? remainingMonths : 0,
    totalInterestPaid,
    totalInterestRemaining: crd > 0.5 ? totalInterestRemaining : 0,
    currentPayment: pretsPaymentForMonth(loan, now),
    nextChange: pretsNextPalierChange(loan, now),
    debitDay,
  };
}

// PRÉCIS au centime (2026-08-09, sur demande explicite — remplace un
// `Math.round` qui n'affectait QUE l'affichage, jamais le calcul lui-même
// (déjà en pleine précision en interne), mais donnait l'impression trompeuse
// que l'app arrondissait les mensualités saisies par l'utilisateur (174,54 €
// affiché "175 €"). Même convention que le module ETF (etfFmtEUR).
function pretsFmtEUR(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// "dans 7 ans 3 mois" — pluriel FR correct (1 an / 2 ans).
function pretsFmtRemaining(months) {
  if (months == null) return '—';
  if (months <= 0) return 'Remboursé';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts = [];
  if (years) parts.push(`${years} an${years > 1 ? 's' : ''}`);
  if (rem) parts.push(`${rem} mois`);
  return `dans ${parts.join(' ')}`;
}

function pretsFmtNextChange(nextChange) {
  if (!nextChange) return '';
  const when = nextChange.monthsUntil <= 0 ? 'ce mois-ci' : `dans ${nextChange.monthsUntil} mois`;
  return `${when}, mensualité → ${pretsFmtEUR(nextChange.monthlyPayment)}`;
}

// "174,54 €/mois — Prél. 5" (2026-08-09, sur demande explicite ; libellé
// raccourci le 2026-08-11, sur demande explicite, pour gagner de la place
// horizontale) — le jour de prélèvement n'a de sens que s'il a été saisi
// (repli silencieux sur la date de départ dans pretsSimulateLoan, jamais
// `null` en pratique une fois `start` connu, mais gardé défensif ici au cas
// où).
function pretsFmtCurrentPayment(amount, debitDay) {
  const base = `${pretsFmtEUR(amount)}/mois`;
  return debitDay ? `${base} — Prél. ${debitDay}` : base;
}

function pretsLoanRowHtml(loan, calc) {
  const endLabel = calc.endDate ? calc.endDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '—';
  const rate = (Number(loan.rate) || 0).toFixed(2).replace('.', ',');
  const nextChangeHtml = calc.nextChange
    ? `<span class="prets-loan-next-change">📅 ${pretsFmtNextChange(calc.nextChange)}</span>`
    : '';

  return `
    <div class="prets-loan">
      <div class="prets-loan-header">
        <span class="prets-loan-name">${loan.name || '(sans nom)'}</span>
        <span class="prets-loan-rate">${rate} %</span>
        <span class="prets-loan-end">fin ${endLabel}</span>
      </div>
      <div class="prets-loan-stats">
        <div class="prets-loan-stat">
          <span class="prets-loan-stat-label">CRD</span>
          <span class="prets-loan-stat-value etf-money">${pretsFmtEUR(calc.crd)}</span>
        </div>
        <div class="prets-loan-stat">
          <span class="prets-loan-stat-label">Mensualité actuelle</span>
          <span class="prets-loan-stat-value etf-money" title="${pretsFmtCurrentPayment(calc.currentPayment, calc.debitDay)}">${pretsFmtCurrentPayment(calc.currentPayment, calc.debitDay)}</span>
        </div>
        <div class="prets-loan-stat">
          <span class="prets-loan-stat-label">Intérêts payés</span>
          <span class="prets-loan-stat-value etf-money">${pretsFmtEUR(calc.totalInterestPaid)}</span>
        </div>
        <div class="prets-loan-stat">
          <span class="prets-loan-stat-label">Intérêts restants</span>
          <span class="prets-loan-stat-value etf-money">${calc.totalInterestRemaining != null ? pretsFmtEUR(calc.totalInterestRemaining) : '—'}</span>
        </div>
      </div>
      <div class="prets-progress-row">
        <div class="prets-progress-bar"><div class="prets-progress-fill" style="width:${calc.percentPaid.toFixed(1)}%"></div></div>
        <span class="prets-progress-pct">${calc.percentPaid.toFixed(0)} %</span>
      </div>
      <div class="prets-loan-footer">
        <span class="prets-loan-remaining">${pretsFmtRemaining(calc.remainingMonths)}</span>
        ${nextChangeHtml}
      </div>
    </div>`;
}

// Replie/déplie un groupe de prêts — PUREMENT CSS/JS local (2026-08-10,
// CORRIGÉ sur demande explicite : la version précédente rappelait
// `window.matin.modules.update()` à CHAQUE clic, qui diffuse
// 'modules:updated' à toute la fenêtre — dashboard.js y répond par
// `window.location.reload()` (voir onUpdated dans initDashboard), donc
// chaque clic sur la flèche rechargeait TOUT le dashboard au lieu de replier
// juste ce groupe. Le clic ne fait plus QUE basculer la classe
// `.prets-collapsed` sur `.prets-module` (le CSS grid-template-rows 1fr/0fr
// + la rotation du chevron suivent seuls, voir style.css) — aucun re-render,
// aucun appel IPC synchrone. La sauvegarde disque passe par le canal
// SILENCIEUX dédié `modules:updateCollapsed` (voir main.js, même principe que
// `modules:updateLayout` pour le drag/resize : un seul champ fusionné, pas de
// broadcast), et n'est déclenchée qu'après un DEBOUNCE de 500ms suivant le
// dernier clic (ou immédiatement si la fenêtre se ferme avant l'échéance,
// voir pretsEnsureFlushOnClose) — jamais à chaque clic individuel.
const PRETS_COLLAPSE_SAVE_DEBOUNCE_MS = 500;
const pretsPendingCollapseSaves = new Map(); // instanceKey -> { timer, value }
let pretsFlushOnCloseRegistered = false;

function pretsSaveCollapsedNow(instanceKey, collapsed) {
  window.matin.modules.updateCollapsed(instanceKey, collapsed)
    .catch(err => console.error('[Prêts] Échec sauvegarde état replié/déplié', err));
}

function pretsScheduleCollapsedSave(instanceKey, collapsed) {
  const pending = pretsPendingCollapseSaves.get(instanceKey);
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    pretsPendingCollapseSaves.delete(instanceKey);
    pretsSaveCollapsedNow(instanceKey, collapsed);
  }, PRETS_COLLAPSE_SAVE_DEBOUNCE_MS);
  pretsPendingCollapseSaves.set(instanceKey, { timer, value: collapsed });
}

// Enregistré UNE SEULE FOIS (pas à chaque render()) : vide tout debounce
// encore en attente si la fenêtre se ferme avant l'échéance des 500ms,
// plutôt que de perdre silencieusement le dernier état replié/déplié.
function pretsEnsureFlushOnClose() {
  if (pretsFlushOnCloseRegistered) return;
  pretsFlushOnCloseRegistered = true;
  window.addEventListener('beforeunload', () => {
    for (const [instanceKey, pending] of pretsPendingCollapseSaves) {
      clearTimeout(pending.timer);
      pretsSaveCollapsedNow(instanceKey, pending.value);
    }
    pretsPendingCollapseSaves.clear();
  });
}

window.MatinModules.prets = {
  async render(container, config, _google, setBadge) {
    pretsEnsureFlushOnClose();
    const instanceKey = (container.id || '').replace('content-', '') || 'prets';
    const privacyStorageKey = `matin-prets-privacy-${instanceKey}`;
    const privacy = localStorage.getItem(privacyStorageKey) === '1';
    // Replié par défaut (aucune préférence enregistrée) — seul `false` explicite déplie.
    const collapsed = config?.collapsed !== false;

    const loans = (Array.isArray(config?.loans) ? config.loans : [])
      .filter(l => l?.name)
      .slice(0, PRETS_MAX_LOANS);

    if (!loans.length) {
      container.innerHTML = `<div class="module-empty">Ajoutez un prêt à ce groupe dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    const now = new Date();
    const calcs = loans.map(loan => ({ loan, calc: pretsSimulateLoan(loan, now) }));

    const totalCRD = calcs.reduce((sum, c) => sum + c.calc.crd, 0);
    // Mensualités ACTUELLES (pas la mensualité "de base" saisie) — pour un
    // prêt à paliers, c'est le palier en cours qui compte dans le total du
    // groupe, pas une valeur figée qui pourrait dater d'un palier déjà passé.
    const totalCurrentMonthly = calcs.reduce((sum, c) => sum + c.calc.currentPayment, 0);
    const groupName = (config?.name || '').trim() || 'Prêts';

    container.innerHTML = `
      <div class="prets-module ${privacy ? 'prets-privacy-on' : ''} ${collapsed ? 'prets-collapsed' : ''}">
        <div class="prets-group-header">
          <span class="prets-group-chevron">▶</span>
          <span class="prets-group-name" title="${groupName}">${groupName}</span>
          <span class="prets-group-total etf-money" title="CRD total / mensualités actuelles">Total : ${pretsFmtEUR(totalCRD)} / Mens. ${pretsFmtEUR(totalCurrentMonthly)}</span>
          <button class="etf-privacy-btn" title="${privacy ? 'Afficher les montants' : 'Masquer les montants'}">${privacy ? '🔒' : '🔓'}</button>
        </div>
        <div class="prets-group-body">
          <div class="prets-group-body-inner">
            <div class="prets-loans">${calcs.map(({ loan, calc }) => pretsLoanRowHtml(loan, calc)).join('')}</div>
          </div>
        </div>
      </div>`;

    container.querySelector('.etf-privacy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const next = localStorage.getItem(privacyStorageKey) !== '1';
      localStorage.setItem(privacyStorageKey, next ? '1' : '0');
      window.MatinModules.prets.render(container, config, _google, setBadge);
    });

    const moduleEl = container.querySelector('.prets-module');
    container.querySelector('.prets-group-header').addEventListener('click', () => {
      // Bascule locale PURE (classList, voir style.css pour l'animation
      // grid-template-rows + la rotation du chevron) — aucun re-render,
      // aucune écriture disque synchrone (voir en-tête de fichier).
      const nowCollapsed = moduleEl.classList.toggle('prets-collapsed');
      config.collapsed = nowCollapsed; // reflet mémoire pour un futur re-render (ex. bascule confidentialité)
      pretsScheduleCollapsedSave(instanceKey, nowCollapsed);
    });

    setBadge(`${loans.length}`);
  },
};
