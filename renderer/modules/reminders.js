/**
 * Module Rappels — rappels personnels avec notification Windows native.
 *
 * Purement local (aucune API externe) : les rappels sont stockés dans
 * config.items ({id, title, date, time, recurrence, icon, lastFired}). La
 * PLANIFICATION/NOTIFICATION tourne côté process main (voir main.js,
 * checkReminders) — PAS ici : un setInterval côté renderer serait throttlé
 * par Chromium quand la fenêtre est minimisée/masquée (backgroundThrottling),
 * ce qui casserait justement l'exigence "fonctionne même minimisé". Ce
 * fichier ne fait que l'AFFICHAGE (aujourd'hui / à venir / en retard),
 * recalculé localement à chaque rendu (aucun réseau, aucun IPC nécessaire) —
 * voir dashboard.js, MODULE_REGISTRY.reminders.refreshMs pour le réaffichage
 * périodique qui garde ce classement à jour (ex. un rappel qui bascule de
 * "à venir" à "aujourd'hui" à minuit, ou d'"à l'heure" à "en retard" dans la
 * journée).
 */
window.MatinModules = window.MatinModules || {};

const REMINDERS_RECUR_LABEL = { daily: 'quotidien', weekly: 'hebdo', monthly: 'mensuel' };

function remindersCategory(key) {
  return window.ReminderCategories?.byKey?.[key] || { emoji: '⏰', label: 'Autre' };
}

function remindersPad2(n) { return String(n).padStart(2, '0'); }
function remindersDateStr(d) { return `${d.getFullYear()}-${remindersPad2(d.getMonth() + 1)}-${remindersPad2(d.getDate())}`; }

// Le rappel a-t-il lieu à la date `on` selon sa récurrence ? Même logique que
// reminderIsDueNow côté main.js (voir ce fichier pour le détail des règles
// hebdo/mensuel) — dupliquée ici volontairement : ce fichier tourne dans le
// renderer (affichage), main.js dans le process main (notification), pas de
// module partageable directement entre les deux sans IPC dédié pour 25 lignes
// de logique pure.
function remindersOccursOn(item, on) {
  if (!item.recurrence || item.recurrence === 'once') return item.date === remindersDateStr(on);
  if (item.recurrence === 'daily') return true;
  if (!item.date) return false;
  const ref = new Date(`${item.date}T00:00:00`);
  if (item.recurrence === 'weekly') return ref.getDay() === on.getDay();
  if (item.recurrence === 'monthly') {
    const targetDay = ref.getDate();
    const lastDayThisMonth = new Date(on.getFullYear(), on.getMonth() + 1, 0).getDate();
    return Math.min(targetDay, lastDayThisMonth) === on.getDate();
  }
  return false;
}

// Prochaine occurrence à partir de `from` (exclu), recherche bornée à 60
// jours — sert uniquement à classer un rappel dans "à venir (7 jours)"
// quand il n'a pas lieu aujourd'hui.
function remindersNextOccurrence(item, from) {
  for (let i = 1; i <= 60; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (remindersOccursOn(item, d)) return d;
  }
  return null;
}

function remindersRowHtml(item, late) {
  const cat = remindersCategory(item.icon);
  const meta = [item.time || '--:--'];
  if (item.recurrence && item.recurrence !== 'once') meta.push(REMINDERS_RECUR_LABEL[item.recurrence]);
  return `
    <div class="reminders-row ${late ? 'reminders-row-late' : ''}">
      <span class="reminders-row-icon">${cat.emoji}</span>
      <div class="reminders-row-main">
        <span class="reminders-row-title">${item.title || '(sans titre)'}</span>
        <span class="reminders-row-meta">${meta.join(' · ')}</span>
      </div>
    </div>`;
}

window.MatinModules.reminders = {
  async render(container, config, _google, setBadge) {
    const items = Array.isArray(config?.items) ? config.items : [];

    if (!items.length) {
      container.innerHTML = `<div class="module-empty">Aucun rappel configuré — ajoutez-en dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    const now = new Date();
    const todayStr = remindersDateStr(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const pastDue = [];
    const today = [];
    const upcoming = [];

    for (const item of items) {
      if (remindersOccursOn(item, now)) {
        const [h, m] = (item.time || '00:00').split(':').map(Number);
        const late = (h * 60 + (m || 0)) < nowMinutes;
        today.push({ item, late });
        continue;
      }
      // Rappel ponctuel dont la date est révolue et qui n'a donc plus aucune
      // occurrence future (contrairement à daily/weekly/monthly, toujours "à
      // venir" par construction) — c'est la seule vraie notion d'"en retard"
      // durable ; un rappel du jour dont l'heure est passée reste dans le
      // bucket "Aujourd'hui" (juste surligné rouge), il ne migre pas ici.
      if (item.recurrence === 'once' && item.date && item.date < todayStr) {
        pastDue.push(item);
        continue;
      }
      const next = remindersNextOccurrence(item, now);
      if (next) {
        const daysAhead = Math.round((next - todayMidnight) / 86400000);
        if (daysAhead >= 1 && daysAhead <= 7) upcoming.push({ item, next });
      }
    }

    today.sort((a, b) => (a.item.time || '').localeCompare(b.item.time || ''));
    upcoming.sort((a, b) => a.next - b.next);

    const sections = [];
    if (pastDue.length) {
      sections.push(`
        <div class="reminders-section">
          <div class="reminders-section-title reminders-section-title-late">⚠ En retard</div>
          ${pastDue.map(item => remindersRowHtml(item, true)).join('')}
        </div>`);
    }
    if (today.length) {
      sections.push(`
        <div class="reminders-section">
          <div class="reminders-section-title">Aujourd'hui</div>
          ${today.map(({ item, late }) => remindersRowHtml(item, late)).join('')}
        </div>`);
    }
    if (upcoming.length) {
      sections.push(`
        <div class="reminders-section">
          <div class="reminders-section-title">À venir (7 jours)</div>
          ${upcoming.map(({ item }) => remindersRowHtml(item, false)).join('')}
        </div>`);
    }

    container.innerHTML = sections.length
      ? `<div class="reminders-module">${sections.join('')}</div>`
      : `<div class="module-empty">Rien de prévu dans les 7 prochains jours.</div>`;

    setBadge(today.length ? String(today.length) : (pastDue.length ? '⚠' : '—'));
  },
};
