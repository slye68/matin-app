/**
 * Raccourcis Google suivis par le module Raccourcis — partagé entre le
 * dashboard (shortcuts.js, affichage) et la page Paramètres (config.js,
 * toggle par service), même convention que indices-defs.js/fdj-games.js : un
 * seul fichier chargé via <script> dans index.html ET config.html.
 *
 * Pas de champ `icon` local (favicon Google utilisée à la place, voir
 * shortcuts.js shortcutsIconUrl) — le domaine nécessaire à cette URL est
 * dérivé de `url` au moment du rendu plutôt que dupliqué ici.
 *
 * `iconUrl` (2026-09-13, sur demande explicite, capture d'écran à l'appui) —
 * override MANUEL pour Drive ET Agenda : le service favicon Google
 * (`s2/favicons?domain=...`) ne renvoie PAS leur logo officiel mais une
 * icône générique 20×20 (vérifié en direct, curl, pour les 2 — taille réelle
 * 20×20 malgré `sz=64` demandé) — les 4 autres services n'ont pas ce
 * problème, `iconUrl` reste absent pour eux. URLs vérifiées EN DIRECT (curl,
 * HTTP 200, PNG 128×128, logo officiel correct à l'ouverture du fichier) :
 * même CDN officiel Google Fonts/Material Symbols pour les deux (même
 * hébergement que les polices déjà chargées par ce projet, fonts.gstatic.com,
 * voir index.html). Pour Agenda, l'URL `ssl.gstatic.com/calendar/images/
 * dynamiclogo_2020q4/calendar_31_2x.jpg` fournie dans la demande d'origine
 * renvoie 404 (testé pour plusieurs jours du mois, pas seulement "31" —
 * chemin d'icône dynamique visiblement retiré côté Google) : remplacée par
 * l'équivalent STATIQUE (logo générique, sans numéro de jour) du même CDN
 * productlogos que Drive ci-dessus.
 */
window.ShortcutsDefs = [
  { id: 'gmail',    label: 'Gmail',    url: 'https://mail.google.com' },
  {
    id: 'drive', label: 'Drive', url: 'https://drive.google.com',
    iconUrl: 'https://fonts.gstatic.com/s/i/productlogos/drive_2020q4/v8/web-64dp/logo_drive_2020q4_color_2x_web_64dp.png',
  },
  { id: 'youtube',  label: 'YouTube',  url: 'https://www.youtube.com' },
  {
    id: 'calendar', label: 'Agenda', url: 'https://calendar.google.com',
    iconUrl: 'https://fonts.gstatic.com/s/i/productlogos/calendar_2020q4/v8/web-64dp/logo_calendar_2020q4_color_2x_web_64dp.png',
  },
  { id: 'photos',   label: 'Photos',   url: 'https://photos.google.com' },
  { id: 'maps',     label: 'Maps',     url: 'https://maps.google.com' },
];
