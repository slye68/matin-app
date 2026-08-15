/**
 * Module Google Calendar — API Calendar v3
 * Affiche les événements du jour.
 *
 * RÉÉCRIT le 2026-08-10 (sur demande explicite) — ne se limitait qu'à
 * l'agenda "primary" (l'agenda principal du compte), ignorant silencieusement
 * tout agenda secondaire (partagé, "Anniversaires", un agenda dédié à un
 * projet, etc.). Passe désormais par 2 appels : `calendarList` pour
 * récupérer TOUS les agendas du compte connecté, puis un fetch d'événements
 * PAR agenda (en parallèle, `Promise.allSettled` — un agenda en échec ne doit
 * pas faire échouer les autres), fusionnés et triés par heure de début.
 */
window.MatinModules = window.MatinModules || {};

// Repli si un agenda ne fournit pas de `backgroundColor` (rare — Google en
// assigne toujours un en pratique, mais l'API ne le garantit pas).
const CALENDAR_FALLBACK_COLORS = ['#4f8ef7', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c'];
// Cap d'affichage APRÈS fusion — l'ancien `maxResults=10` limitait un seul
// agenda ; avec plusieurs agendas fusionnés le total pourrait dépasser ce que
// la carte (petite par défaut) peut raisonnablement montrer. Le badge, lui,
// reflète le nombre RÉEL d'événements du jour, pas ce cap d'affichage.
const CALENDAR_MAX_DISPLAYED = 15;

async function calendarFetchAllCalendars(accessToken) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Liste des agendas indisponible (${res.status})`);
  const data = await res.json();
  return data.items || [];
}

// `calendarId` peut être une adresse email (agendas partagés) — DOIT être
// encodé dans le chemin de l'URL, sinon un "@" ou "#" mal échappé casse la
// requête.
async function calendarFetchEvents(accessToken, calendarId, timeMin, timeMax) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
    `timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

function calendarEventStartKey(ev) {
  // Événement "toute la journée" (`start.date`, pas `start.dateTime`) trié
  // avant les événements à heure fixe du même jour — comportement Google
  // Calendar standard.
  return ev.start?.dateTime || ev.start?.date || '';
}

window.MatinModules.calendar = {
  async render(container, _config, googleData, setBadge) {
    if (!googleData?.accessToken) {
      container.innerHTML = `<span class="module-empty">Non connecté à Google</span>`;
      return;
    }

    try {
      const now   = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const calendars = await calendarFetchAllCalendars(googleData.accessToken);
      if (!calendars.length) {
        container.innerHTML = `<span class="module-empty">Aucun agenda trouvé sur ce compte</span>`;
        setBadge('—');
        return;
      }

      const results = await Promise.allSettled(
        calendars.map(cal => calendarFetchEvents(googleData.accessToken, cal.id, start, end))
      );

      const events = [];
      results.forEach((result, i) => {
        const cal = calendars[i];
        if (result.status === 'rejected') {
          console.error(`[Calendar] Échec de récupération pour "${cal.summary}"`, result.reason);
          return;
        }
        const color = cal.backgroundColor || CALENDAR_FALLBACK_COLORS[i % CALENDAR_FALLBACK_COLORS.length];
        for (const ev of result.value) {
          events.push({ ev, calendarName: cal.summary || cal.id, color });
        }
      });

      events.sort((a, b) => calendarEventStartKey(a.ev).localeCompare(calendarEventStartKey(b.ev)));

      setBadge(`${events.length} événement${events.length !== 1 ? 's' : ''}`);

      if (!events.length) {
        container.innerHTML = `<span class="module-empty">Aucun événement aujourd'hui</span>`;
        return;
      }

      container.innerHTML = `<div class="cal-events">
        ${events.slice(0, CALENDAR_MAX_DISPLAYED).map(({ ev, calendarName, color }) => {
          const startLabel = ev.start?.dateTime
            ? new Date(ev.start.dateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            : 'Toute la journée';
          return `
            <div class="cal-event">
              <div class="cal-color-dot" style="background:${color}" title="${calendarName}"></div>
              <span class="cal-time">${startLabel}</span>
              <span class="cal-title">${ev.summary || 'Sans titre'}</span>
            </div>`;
        }).join('')}
      </div>`;
    } catch (err) {
      container.innerHTML = `<span class="module-error">Agenda indisponible</span>`;
      console.error('[Calendar]', err);
    }
  }
};
