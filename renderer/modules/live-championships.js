/**
 * Compétitions ESPN "soccer" proposées par le module LIVE FOOT! (2026-09-04,
 * réécriture complète — remplace l'ancien catalogue mixte TheSportsDB/ESPN à
 * 10 entrées, dont 2 (National/Autre) sans endpoint ESPN fonctionnel) —
 * partagé entre le dashboard (live.js, résolution slug→libellé pour
 * l'affichage/les logs) et Paramètres (config.js, peuplement du <select>
 * "Compétition"), même convention que indices-defs.js/fdj-games.js/
 * sports-sources.js : un seul fichier chargé via <script> dans index.html ET
 * config.html, avant live.js/config.js.
 *
 * `kind` catégorise chaque slug pour les 3 groupes du <select> Compétition
 * (voir config.js liveCompetitionOptionsHtml) — 'domestic' (7, championnats
 * de club nationaux), 'european' (3, coupes européennes de club),
 * 'national' (3, sélections nationales). Servait aussi à un 2e <select>
 * "Championnat" (mode "Équipe") RETIRÉ ENTIÈREMENT le 2026-09-05, sur
 * demande explicite — `kind` reste utile tel quel pour les 3 groupes
 * ci-dessus, rien à changer dans ce catalogue.
 */
window.LiveCompetitions = [
  { slug: 'fra.1', label: 'Ligue 1',        emoji: '🇫🇷', kind: 'domestic' },
  { slug: 'fra.2', label: 'Ligue 2',        emoji: '🇫🇷', kind: 'domestic' },
  { slug: 'eng.1', label: 'Premier League', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', kind: 'domestic' },
  { slug: 'esp.1', label: 'La Liga',        emoji: '🇪🇸', kind: 'domestic' },
  { slug: 'ita.1', label: 'Serie A',        emoji: '🇮🇹', kind: 'domestic' },
  { slug: 'ger.1', label: 'Bundesliga',     emoji: '🇩🇪', kind: 'domestic' },
  { slug: 'por.1', label: 'Primeira Liga',  emoji: '🇵🇹', kind: 'domestic' },

  { slug: 'uefa.champions',         label: 'Champions League',  emoji: '⭐', kind: 'european' },
  { slug: 'uefa.europa',            label: 'Europa League',     emoji: '🌍', kind: 'european' },
  { slug: 'uefa.europa.conference', label: 'Conference League', emoji: '🌐', kind: 'european' },

  { slug: 'fifa.world',   label: 'Coupe du Monde',    emoji: '🌍', kind: 'national' },
  { slug: 'uefa.euro',    label: 'Euro',              emoji: '🏆', kind: 'national' },
  { slug: 'uefa.nations', label: 'Ligue des Nations', emoji: '🏆', kind: 'national' },
];

function liveCompetitionBySlug(slug) {
  return window.LiveCompetitions.find(c => c.slug === slug) || null;
}
