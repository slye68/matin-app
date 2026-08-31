/**
 * Catégories de rappel — partagées entre le dashboard (reminders.js, affichage)
 * et la page Paramètres (config.js, sélecteur de catégorie), même convention
 * que fdj-games.js : un seul fichier chargé via <script> dans index.html ET
 * config.html plutôt qu'une constante dupliquée dans les deux fenêtres.
 *
 * Le process main (main.js) a sa PROPRE petite copie de ces emojis pour le
 * titre des notifications Windows — pas de require() possible ici, ce fichier
 * expose un global navigateur (window.ReminderCategories), pas un module
 * CommonJS. Si la liste change, la garder synchronisée avec REMINDER_ICONS
 * dans main.js.
 */
window.ReminderCategories = {
  list: [
    { key: 'health',   emoji: '💊', label: 'Santé' },
    { key: 'call',     emoji: '📞', label: 'Appel' },
    { key: 'task',     emoji: '🔧', label: 'Tâche' },
    { key: 'birthday', emoji: '🎂', label: 'Anniversaire' },
    { key: 'other',    emoji: '⏰', label: 'Autre' },
  ],
};
window.ReminderCategories.byKey = Object.fromEntries(
  window.ReminderCategories.list.map(c => [c.key, c])
);
