/**
 * Module Anniversaires — Google People API (contacts.readonly), même schéma
 * que calendar.js/gmail.js : fetch DIRECT depuis le renderer avec le Bearer
 * token (l'API Google supporte CORS pour les requêtes authentifiées, pas
 * besoin de passer par un canal IPC côté process main comme pour les sites
 * sans CORS scrapés ailleurs dans l'app).
 *
 * Nécessite le scope `contacts.readonly` (voir main/auth/google-oauth.js,
 * SCOPES) ajouté le 2026-08-07 — un compte DÉJÀ connecté avant cet ajout n'a
 * PAS ce scope sur son token existant (Google ne l'accorde qu'au moment du
 * consentement, un simple rafraîchissement de token ne peut pas l'ajouter) :
 * la Google People API renvoie alors un 403 "insufficient authentication
 * scopes" — détecté spécifiquement ci-dessous pour afficher un message
 * actionnable ("reconnectez-vous") plutôt qu'une erreur générique.
 *
 * `people.connections.list` retourne les contacts de l'utilisateur (pas ses
 * propres infos) avec pagination (`pageToken`) — un usage personnel dépasse
 * rarement 1000 contacts (taille de page max autorisée par l'API), mais la
 * boucle de pagination reste correcte au-delà.
 */
window.MatinModules = window.MatinModules || {};

const BIRTHDAYS_LOOKAHEAD_DAYS = 30;
const BIRTHDAYS_PAGE_SIZE = 1000;

async function birthdaysFetchAllConnections(accessToken) {
  let connections = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      personFields: 'names,birthdays',
      pageSize: String(BIRTHDAYS_PAGE_SIZE),
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = body?.error?.message || `People API ${res.status}`;
      if (res.status === 403 && /insufficient|scope/i.test(message)) {
        throw new Error('Reconnectez votre compte Google (Paramètres) pour autoriser l\'accès aux contacts');
      }
      throw new Error(message);
    }

    const data = await res.json();
    connections = connections.concat(data.connections || []);
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return connections;
}

function birthdaysExtractName(person) {
  const name = person.names?.find(n => n.metadata?.primary) || person.names?.[0];
  return name?.displayName || null;
}

// Prochaine occurrence de l'anniversaire à partir d'aujourd'hui — Google
// fournit un mois 1-12 (pas 0-indexé comme le Date JS natif, d'où le -1).
// Cas particulier non traité spécifiquement : un anniversaire un 29 février
// tombe sur le 1er mars une année non bissextile — comportement natif du
// constructeur Date (rollover), acceptable tel quel plutôt qu'une règle
// spéciale pour un cas très rare.
function birthdaysNextOccurrence(month, day, now) {
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let candidate = new Date(now.getFullYear(), month - 1, day);
  if (candidate < todayMidnight) candidate = new Date(now.getFullYear() + 1, month - 1, day);
  return candidate;
}

function birthdaysBuildList(connections, now) {
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const items = [];

  for (const person of connections) {
    const bday = person.birthdays?.find(b => b.date?.month && b.date?.day);
    if (!bday) continue;
    const name = birthdaysExtractName(person);
    if (!name) continue;

    const nextDate = birthdaysNextOccurrence(bday.date.month, bday.date.day, now);
    const daysRemaining = Math.round((nextDate - todayMidnight) / 86400000);
    if (daysRemaining > BIRTHDAYS_LOOKAHEAD_DAYS) continue;

    items.push({ name, date: nextDate, daysRemaining });
  }

  items.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return items;
}

function birthdaysDaysLabel(n) {
  if (n === 0) return 'Aujourd\'hui';
  if (n === 1) return 'Demain';
  return `Dans ${n} jours`;
}

// J-1/J-0 en rouge (urgent), J-7 et en dessous en orange (à prévoir),
// au-delà neutre — comme demandé explicitement.
function birthdaysUrgencyClass(n) {
  if (n <= 1) return 'birthdays-row-red';
  if (n <= 7) return 'birthdays-row-orange';
  return '';
}

function birthdaysRowHtml(item) {
  const dateLabel = item.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `
    <div class="birthdays-row ${birthdaysUrgencyClass(item.daysRemaining)}">
      <span class="birthdays-row-name">${item.name}</span>
      <div class="birthdays-row-meta">
        <span class="birthdays-row-date">${dateLabel}</span>
        <span class="birthdays-row-days">${birthdaysDaysLabel(item.daysRemaining)}</span>
      </div>
    </div>`;
}

window.MatinModules.birthdays = {
  async render(container, _config, googleData, setBadge) {
    if (!googleData?.accessToken) {
      container.innerHTML = `<div class="module-empty">Connectez votre compte Google dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    setBadge('…');
    try {
      const connections = await birthdaysFetchAllConnections(googleData.accessToken);
      const items = birthdaysBuildList(connections, new Date());

      if (!items.length) {
        container.innerHTML = `<div class="module-empty">Aucun anniversaire dans les 30 prochains jours.</div>`;
        setBadge('—');
        return;
      }

      container.innerHTML = `<div class="birthdays-list">${items.map(birthdaysRowHtml).join('')}</div>`;
      setBadge(String(items.length));
    } catch (err) {
      container.innerHTML = `<span class="module-error">${err.message.startsWith('Reconnectez') ? err.message : 'Anniversaires indisponibles'}</span>`;
      console.error('[Anniversaires]', err);
      setBadge('⚠');
    }
  },
};
