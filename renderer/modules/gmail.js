/**
 * Module Gmail — API Gmail v1
 * Affiche les 8 derniers emails non lus
 */
window.MatinModules = window.MatinModules || {};

window.MatinModules.gmail = {
  async render(container, _config, googleData, setBadge) {
    if (!googleData?.accessToken) {
      container.innerHTML = `<span class="module-empty">Non connecté à Google</span>`;
      return;
    }

    try {
      // Récupérer les IDs des non-lus
      // labelIds doit être répété (labelIds=INBOX&labelIds=UNREAD), pas une
      // valeur unique séparée par virgule — sinon Gmail répond 400.
      const listParams = new URLSearchParams();
      listParams.append('labelIds', 'INBOX');
      listParams.append('labelIds', 'UNREAD');
      listParams.append('maxResults', '8');

      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`,
        { headers: { Authorization: `Bearer ${googleData.accessToken}` } }
      );
      if (!listRes.ok) throw new Error(`API error ${listRes.status}`);
      const listData = await listRes.json();
      const messages = listData.messages || [];

      setBadge(`${messages.length} non lu${messages.length !== 1 ? 's' : ''}`);

      if (!messages.length) {
        container.innerHTML = `<span class="module-empty">Boîte vide 🎉</span>`;
        return;
      }

      // Récupérer les détails en parallèle
      const details = await Promise.all(
        messages.map(m =>
          fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
            { headers: { Authorization: `Bearer ${googleData.accessToken}` } }
          ).then(r => r.json())
        )
      );

      container.innerHTML = `<div class="gmail-list">
        ${details.map(msg => {
          const headers = msg.payload?.headers || [];
          const from    = headers.find(h => h.name === 'From')?.value || 'Inconnu';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(Sans objet)';
          const sender  = from.replace(/<.*>/, '').trim().replace(/"/g, '') || from;
          const isUnread = msg.labelIds?.includes('UNREAD');

          return `
            <div class="gmail-item ${isUnread ? 'unread' : ''}" data-id="${msg.id}">
              <div class="gmail-sender">${sender}</div>
              <div class="gmail-subject">${subject}</div>
            </div>`;
        }).join('')}
      </div>`;

      // Ouvrir dans Gmail au clic
      container.querySelectorAll('.gmail-item').forEach(el => {
        el.addEventListener('click', () => {
          window.matin.shell.openExternal(`https://mail.google.com/mail/u/0/#inbox/${el.dataset.id}`);
        });
      });
    } catch (err) {
      container.innerHTML = `<span class="module-error">Gmail indisponible</span>`;
      console.error('[Gmail]', err);
    }
  }
};
