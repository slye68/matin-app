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
// Catégories mises à jour le 2026-09-01 (sur demande explicite) — remplace
// intégralement l'ancienne liste (health/call/task/birthday/other). Les
// clés changent aussi (pas seulement les libellés/emojis) : un rappel déjà
// enregistré sous une ANCIENNE clé (ex. 'task'/'birthday'/'other') ne
// correspond plus à aucune entrée ici — `byKey[cetteClé]` redevient
// `undefined`, ce que reminders.js/config.js gèrent déjà par un repli sûr
// (⏰ générique, voir reminders.js reminderCategory) plutôt qu'un crash :
// dégradation visuelle acceptable pour d'anciens rappels, pas une perte de
// données (le champ `icon` d'origine reste tel quel dans le store).
window.ReminderCategories = {
  list: [
    { key: 'health', emoji: '💊', label: 'Santé' },
    { key: 'call',   emoji: '📞', label: 'Appeler' },
    { key: 'event',  emoji: '🎂', label: 'Événement' },
    { key: 'admin',  emoji: '💰', label: 'Administratif' },
    { key: 'home',   emoji: '🏠', label: 'Maison' },
    { key: 'work',   emoji: '💼', label: 'Travail' },
  ],
};
window.ReminderCategories.byKey = Object.fromEntries(
  window.ReminderCategories.list.map(c => [c.key, c])
);
