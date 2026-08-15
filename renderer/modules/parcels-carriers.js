/**
 * Colis — détection du transporteur + URL de suivi publique par numéro,
 * partagé entre le module dashboard (parcels.js) et la page de configuration
 * (config.js, pour afficher un indice du transporteur détecté pendant la
 * saisie) — même principe que fdj-games.js/sports-sources.js : un seul
 * fichier pour éviter toute divergence entre les deux.
 *
 * Remplace le suivi via API tierce (17TRACK, lui-même choisi après avoir
 * écarté AfterShip — API réservée à son palier payant) par du scraping direct
 * des pages de suivi publiques des transporteurs (2026-08-05, sur demande
 * explicite) : plus de clé API, plus de compte, plus de quota d'enregistrement
 * à gérer. FedEx (présent dans l'ancienne liste 17TRACK) n'a pas de cible de
 * scraping fournie ni de règle de détection : non supporté ici — un numéro
 * FedEx ne sera simplement pas détecté (transporteur `null`).
 *
 * Règles de détection par format (aucune n'est une garantie à 100% — deux
 * transporteurs différents peuvent en théorie partager un format proche —
 * mais couvrent les formats standards documentés de chaque transporteur) :
 *   - UPS        : commence par "1Z"
 *   - Colissimo  : commence par 6V/8V/CA/CB/CC/CY, ou 13 chiffres, ou format
 *                  international UPU S10 (2 lettres + 9 chiffres + 2 lettres,
 *                  ex. "CA123456785FR" — norme utilisée par les envois postaux
 *                  internationaux, La Poste inclus, 2026-08-05 sur demande
 *                  explicite), ou "FR" + 10 chiffres (ex. "FR3156080283",
 *                  format signalé le 2026-08-06 — distinct du UPU S10 qui
 *                  se TERMINE par "FR" plutôt que de commencer par, testé en
 *                  premier pour ne jamais être masqué par lui)
 *   - Chronopost : commence par XK/XX, ou 8 chiffres
 *   - DHL        : 10 chiffres
 *   - Amazon     : commence par "TBA" + chiffres, ou "1TZ" + alphanumérique,
 *                  ou 28 caractères alphanumériques (2026-08-06, sur demande
 *                  explicite — AUCUN numéro Amazon réel disponible pour
 *                  vérifier ces formats, notamment "1TZ" qui ne correspond à
 *                  aucune convention Amazon publiquement documentée trouvée ;
 *                  implémenté tel que spécifié, à corriger si un vrai numéro
 *                  ne matche pas comme attendu)
 * Testées dans cet ordre (préfixes lettres d'abord, qui sont sans ambiguïté,
 * puis longueurs numériques, mutuellement exclusives entre elles).
 *
 * Repli : si aucune règle ne matche, DEFAULT_FALLBACK_CARRIER (Colissimo) est
 * essayé en dernier recours par parcels.js — La Poste gère en pratique un
 * large éventail de formats (y compris des envois internationaux confiés à
 * d'autres opérateurs postaux mais distribués par La Poste en France), donc
 * une part des numéros non reconnus par les règles ci-dessus a de bonnes
 * chances d'y être malgré tout suivable.
 */
window.ParcelsCarriers = (function () {
  const DEFAULT_FALLBACK_CARRIER = 'Colissimo';

  function detectCarrier(trackingNumber) {
    const t = (trackingNumber || '').trim().toUpperCase();
    if (!t) return null;
    if (/^1Z/.test(t)) return 'UPS';
    if (/^TBA\d+$/.test(t)) return 'Amazon';
    if (/^1TZ[A-Z0-9]+$/.test(t)) return 'Amazon';
    if (/^(6V|8V|CA|CB|CC|CY)/.test(t)) return 'Colissimo';
    // "FR" + 10 chiffres (ex. "FR3156080283") — DISTINCT du format
    // international UPU S10 juste en dessous, qui se TERMINE par "FR" au
    // lieu de commencer par : testé avant lui pour ne jamais être masqué.
    if (/^FR\d{10}$/.test(t)) return 'Colissimo';
    if (/^(XK|XX)/.test(t)) return 'Chronopost';
    if (/^\d{13}$/.test(t)) return 'Colissimo';
    if (/^\d{10}$/.test(t)) return 'DHL';
    if (/^\d{8}$/.test(t)) return 'Chronopost';
    // Format international UPU S10 : 2 lettres + 9 chiffres + 2 lettres —
    // testé après les règles ci-dessus (plus spécifiques) pour ne jamais
    // masquer un préfixe transporteur déjà reconnu (ex. "CA..." Colissimo
    // domestique est déjà couvert plus haut).
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t)) return 'Colissimo';
    // 28 caractères alphanumériques : format Amazon générique, testé en
    // dernier (le plus large) pour ne jamais masquer un format plus précis
    // ci-dessus — aucun autre transporteur de cette liste n'a un format de
    // cette longueur exacte.
    if (/^[A-Z0-9]{28}$/.test(t)) return 'Amazon';
    return null;
  }

  // BUG SIGNALÉ LE 2026-08-06 — l'ancienne URL Colissimo/La Poste
  // (`/outils/suivre-un-courrier-ou-un-colis?code=`) est un vrai 404 côté
  // serveur (vérifié en direct, fetch ET jina.ai). La Poste a migré son outil
  // de suivi vers `/suivi` — mais cette nouvelle page est une appli JS
  // (Nuxt) qui n'exécute PAS de recherche à partir du paramètre `?code=` :
  // même rendue par jina.ai (qui exécute le JS avant d'extraire), elle
  // n'affiche que la page d'accueil générique de l'outil, jamais un vrai
  // statut — le paramètre est ignoré, la recherche semble exiger une vraie
  // interaction (soumission du formulaire), pas juste une URL profonde.
  // Gardée quand même comme URL CORRECTE et à jour (mieux qu'un 404 garanti),
  // mais le suivi Colissimo via scraping est donc probablement non
  // fonctionnel en pratique tant qu'un nouveau point d'entrée exploitable
  // n'est pas trouvé — voir CONTEXT.md.
  const TRACKING_URL_BUILDERS = {
    Colissimo:  (num) => `https://www.laposte.fr/suivi?code=${encodeURIComponent(num)}`,
    Chronopost: (num) => `https://www.chronopost.fr/tracking-no-cms/suivi-colis?listeNumerosLT=${encodeURIComponent(num)}`,
    UPS:        (num) => `https://www.ups.com/track?tracknum=${encodeURIComponent(num)}`,
    DHL:        (num) => `https://www.dhl.com/fr-fr/home/tracking.html?tracking-id=${encodeURIComponent(num)}`,
    // Vérifié en direct le 2026-08-06 : répond 200, page rendue côté serveur
    // (pas une coquille SPA vide comme La Poste ci-dessus), le numéro de
    // suivi apparaît dans le HTML retourné (lien "Aide" en pied de page) —
    // scraping du statut plausible, mais non vérifié avec un vrai colis.
    Amazon:     (num) => `https://track.amazon.fr/tracking/${encodeURIComponent(num)}`,
  };

  function buildTrackingUrl(carrier, trackingNumber) {
    const builder = TRACKING_URL_BUILDERS[carrier];
    return builder ? builder(trackingNumber) : null;
  }

  return { detectCarrier, buildTrackingUrl, DEFAULT_FALLBACK_CARRIER };
})();
