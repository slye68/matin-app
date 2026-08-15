/**
 * Module Tâches Google — Google Tasks API v1, liste par défaut.
 *
 * Même convention que gmail.js/calendar.js : appel direct depuis le renderer
 * avec le bearer token OAuth (`googleData.accessToken`, déjà validé/rafraîchi
 * par dashboard.js avant l'appel à render()) — aucun IPC dédié, l'API Google
 * accepte les requêtes authentifiées par bearer token depuis n'importe quelle
 * origine (pas de restriction CORS spécifique côté navigateur ici).
 *
 * Nécessite le scope `tasks` (écriture — pas `tasks.readonly`, puisque ce
 * module coche/ajoute/supprime des tâches), ajouté le 2026-08-06 à
 * `main/auth/google-oauth.js`. Un compte déjà connecté AVANT cet ajout n'a
 * PAS ce scope sur son token existant (OAuth n'accorde jamais un scope a
 * posteriori) : il faut se déconnecter puis se reconnecter à Google depuis
 * Paramètres pour que ce module fonctionne — sans quoi l'API répond 403.
 *
 * "Liste par défaut" = la première renvoyée par `/users/@me/lists` (l'API
 * Google Tasks n'expose aucun flag "default" explicite, mais la liste "Mes
 * tâches" créée automatiquement pour chaque compte est systématiquement en
 * première position).
 */
window.MatinModules = window.MatinModules || {};

async function googleTasksApi(path, googleData, options = {}) {
  const res = await fetch(`https://tasks.googleapis.com/tasks/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${googleData.accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    // Le corps JSON d'erreur de Google (`error.message`/`error.status`) est
    // bien plus parlant qu'un simple code HTTP pour distinguer les 2 causes
    // possibles d'un 403 ici : API Tasks pas encore activée pour ce projet
    // dans Google Cloud Console ("Google Tasks API has not been used in
    // project ... before or it is disabled") vs scope `tasks` manquant sur
    // le token actuel ("Request had insufficient authentication scopes",
    // compte connecté avant l'ajout du scope — voir doc en tête de fichier).
    // Loggué EN ENTIER (pas juste res.status) pour permettre ce diagnostic.
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => '');
    }
    console.error(`[Tâches Google] ${options.method || 'GET'} ${path} → HTTP ${res.status}`, detail || '(pas de détail dans la réponse)');
    throw new Error(`Google Tasks API ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function googleTasksDefaultListId(googleData) {
  const data = await googleTasksApi('/users/@me/lists', googleData);
  const first = (data.items || [])[0];
  if (!first) throw new Error('Aucune liste de tâches trouvée sur ce compte');
  return first.id;
}

function googleTasksRowHtml(task) {
  const safeTitle = (task.title || '(sans titre)').replace(/</g, '&lt;');
  return `
    <div class="gtasks-row" data-id="${task.id}">
      <input type="checkbox" class="gtasks-checkbox">
      <span class="gtasks-title">${safeTitle}</span>
      <button type="button" class="gtasks-delete-btn" title="Supprimer">×</button>
    </div>`;
}

window.MatinModules.googleTasks = {
  async render(container, _config, googleData, setBadge) {
    if (!googleData?.accessToken) {
      container.innerHTML = `<span class="module-empty">Non connecté à Google</span>`;
      setBadge('—');
      return;
    }

    container.innerHTML = `
      <div class="gtasks-module">
        <div class="gtasks-list"><div class="loading-spinner" style="margin:12px auto;width:16px;height:16px"></div></div>
        <form class="gtasks-add-form">
          <input type="text" class="gtasks-add-input" placeholder="Nouvelle tâche…" autocomplete="off" maxlength="200">
          <button type="submit" class="gtasks-add-btn" title="Ajouter">+</button>
        </form>
      </div>`;

    const listEl = container.querySelector('.gtasks-list');
    const form = container.querySelector('.gtasks-add-form');
    const input = container.querySelector('.gtasks-add-input');

    let listId;
    try {
      listId = await googleTasksDefaultListId(googleData);
    } catch (err) {
      container.innerHTML = `<span class="module-error">Tâches Google indisponibles</span>`;
      console.error('[Tâches Google]', err);
      setBadge('⚠');
      return;
    }

    function bindRows() {
      listEl.querySelectorAll('.gtasks-row').forEach((row) => {
        const id = row.dataset.id;

        row.querySelector('.gtasks-checkbox').addEventListener('change', async (e) => {
          if (!e.target.checked) return;
          row.classList.add('gtasks-row-done');
          setTimeout(() => row.remove(), 400);
          try {
            await googleTasksApi(`/lists/${listId}/tasks/${id}`, googleData, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'completed' }),
            });
          } catch (err) {
            console.error('[Tâches Google] Échec de la complétion (tâche retirée localement quand même)', err);
          }
        });

        row.querySelector('.gtasks-delete-btn').addEventListener('click', async () => {
          row.remove();
          try {
            await googleTasksApi(`/lists/${listId}/tasks/${id}`, googleData, { method: 'DELETE' });
          } catch (err) {
            console.error('[Tâches Google] Échec de la suppression (tâche retirée localement quand même)', err);
          }
        });
      });
    }

    async function loadTasks() {
      try {
        const data = await googleTasksApi(`/lists/${listId}/tasks?showCompleted=false&showHidden=false&maxResults=50`, googleData);
        const tasks = (data.items || []).filter(t => t.status !== 'completed');
        setBadge(tasks.length ? String(tasks.length) : '—');
        listEl.innerHTML = tasks.length
          ? tasks.map(googleTasksRowHtml).join('')
          : `<div class="module-empty">Rien à faire 🎉</div>`;
        bindRows();
      } catch (err) {
        listEl.innerHTML = `<span class="module-error">Chargement impossible</span>`;
        console.error('[Tâches Google]', err);
        setBadge('⚠');
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      try {
        await googleTasksApi(`/lists/${listId}/tasks`, googleData, {
          method: 'POST',
          body: JSON.stringify({ title }),
        });
        await loadTasks();
      } catch (err) {
        console.error('[Tâches Google] Échec de l\'ajout', err);
      }
    });

    await loadTasks();
  },
};
