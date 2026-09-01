/**
 * Module YouTube Notifications (2026-08-15, sur demande explicite) —
 * REDESSINÉ 3 FOIS le 2026-09-01 : liste verticale [avatar+nom+badge]
 * ("more compact vertical layout"), puis avatars ultra-compacts empilés en 1
 * colonne de 36px ("ultra-compact... ~60px total"), puis la version ACTUELLE
 * ("Keep larger avatar thumbnails (~70-80px)... exactly 2 avatars per row")
 * — grille de 2 colonnes d'avatars de 76px, toujours sans nom visible par
 * défaut (bulle CSS au survol, voir ytAvatarHtml/style.css
 * .youtube-avatar-*). Badge rouge si nouvelle vidéo publiée dans les
 * dernières 24h depuis la dernière vérification — chiffre si plusieurs,
 * simple point si une seule (voir ytAvatarHtml). Bouton "Vérifier
 * maintenant" déplacé dans l'en-tête de carte, à droite du titre (voir
 * render() plus bas), plus dans le contenu.
 *
 * Détection SANS coût de quota API : flux Atom public de chaque chaîne
 * (`https://www.youtube.com/feeds/videos.xml?channel_id=...`) via le même
 * `window.matin.rss.fetchFeed` générique que les modules RSS classiques
 * (voir main.js, handler `rss:fetchFeed` — agnostique du format, texte brut).
 * Aucune auth Google nécessaire ICI : seule la RÉSOLUTION d'une chaîne
 * (nom/URL → ID), faite dans Paramètres (voir config.js,
 * renderYoutubeConfigSection), appelle l'API YouTube Data v3 avec un token.
 *
 * Auto-refresh à heures FIXES uniquement (8h/12h/16h/18h/20h/22h, sur demande
 * explicite) — PAS de `refreshMs` dans MODULE_REGISTRY (voir dashboard.js) :
 * un planificateur interne (setInterval 60s, même principe que
 * initAutoBrightness) vérifie l'heure courante et ne déclenche qu'aux
 * créneaux exacts, avec un garde-fou `lastCheckSlot` persisté (électron-store,
 * chemin étroit `modules.youtube.config.lastCheckSlot`) pour ne jamais
 * redéclencher deux fois le même créneau le même jour.
 *
 * `lastSeenVideoId` (un par chaîne, dans `config.channels`) : mémorise la
 * dernière vidéo déjà vue/ouverte par l'utilisateur — comparé à la 1re entrée
 * du flux (toujours la plus récente, convention Atom/RSS universelle) pour
 * décider s'il y a du nouveau contenu. Persisté via le même chemin étroit
 * `window.matin.store.set('modules.youtube.config.channels', ...)` — SANS
 * passer par `window.matin.modules.update()`, qui déclencherait un
 * `location.reload()` du dashboard entier à chaque clic sur une chaîne (voir
 * dashboard.js, commentaire sur `modules:updated`).
 */
window.MatinModules = window.MatinModules || {};

const YT_FIXED_TIMES = ['08:00', '12:00', '16:00', '18:00', '20:00', '22:00'];
const YT_SCHEDULE_CHECK_MS = 60 * 1000;
const YT_NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const YT_RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const YT_LAST_SLOT_KEY = 'modules.youtube.config.lastCheckSlot';
const YT_CHANNELS_KEY = 'modules.youtube.config.channels';

async function ytFetchLatestVideos(channelId) {
  const xmlText = await window.matin.rss.fetchFeed(YT_RSS_BASE + channelId);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Flux YouTube invalide');

  // <yt:videoId> porte un préfixe d'espace de noms littéral dans le XML —
  // getElementsByTagName (pas querySelector) matche le nom qualifié tel quel,
  // même technique que itunes:duration dans podcast.js.
  return Array.from(doc.getElementsByTagName('entry')).map((entry) => {
    const videoId = entry.getElementsByTagName('yt:videoId')[0]?.textContent || '';
    return {
      videoId,
      title: entry.querySelector('title')?.textContent || '',
      published: entry.querySelector('published')?.textContent || '',
      link: entry.querySelector('link')?.getAttribute('href') || `https://www.youtube.com/watch?v=${videoId}`,
    };
  });
}

// Nombre d'entrées publiées dans les dernières 24h ET plus récentes que la
// dernière vidéo déjà vue (`lastSeenVideoId`) — le flux est trié du plus
// récent au plus ancien (convention Atom), donc tout ce qui précède
// `lastSeenVideoId` dans la liste est "nouveau". Si cette vidéo de référence
// n'apparaît plus dans le flux (sortie des ~15 entrées retournées), tout ce
// qui reste dans la fenêtre de 24h est considéré nouveau plutôt que 0 (mieux
// vaut un badge que du contenu manqué en silence).
function ytCountNewSince(entries, lastSeenVideoId, now) {
  const nowMs = now.getTime();
  const recent = entries.filter((e) => {
    const pubMs = new Date(e.published).getTime();
    return !Number.isNaN(pubMs) && (nowMs - pubMs) <= YT_NEW_WINDOW_MS;
  });
  const idx = recent.findIndex((e) => e.videoId === lastSeenVideoId);
  return idx === -1 ? recent.length : idx;
}

// "08:00" uniquement si l'heure/minute courante correspond EXACTEMENT à un
// des 6 créneaux fixes — le suffixe date (toDateString) rend le créneau
// unique par jour, pour ne jamais redéclencher le même le lendemain avec le
// même lastCheckSlot stocké.
function ytCurrentSlot(now) {
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return YT_FIXED_TIMES.includes(time) ? `${now.toDateString()} ${time}` : null;
}

// Échappe une valeur destinée à un attribut HTML entre guillemets doubles
// (2026-09-01, sur demande explicite — le nom de chaîne, jusqu'ici seulement
// injecté en TEXTE de nœud dans .youtube-row-name, part maintenant aussi dans
// `data-name` pour la bulle CSS ci-dessous : un nom contenant `"` casserait
// l'attribut sans cet échappement).
function ytEscapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Avatar seul (2026-09-01, sur demande explicite, "avatars only, no channel
// names visible") — le nom part en bulle CSS au survol (`data-name`, voir
// .youtube-avatar[data-name]::after dans style.css) au lieu d'être affiché en
// permanence à côté. Badge en absolu sur le coin de l'avatar (voir "Keep red
// notification badge on top-right corner of each avatar"). Point demandé :
// point simple (sans chiffre) si UNE seule nouvelle vidéo, nombre sinon —
// distinction utile seulement au-delà de 1.
function ytAvatarHtml(channel, idx, newCount, latest) {
  const avatarHtml = channel.avatar
    ? `<img class="youtube-avatar-img" src="${channel.avatar}" alt="">`
    : `<div class="youtube-avatar-img youtube-avatar-fallback">🔔</div>`;
  const isNew = newCount > 0;
  const badgeHtml = isNew
    ? `<span class="youtube-avatar-badge${newCount === 1 ? ' youtube-avatar-badge-dot' : ''}">${newCount === 1 ? '' : newCount}</span>`
    : '';
  const clickable = !!latest;
  const name = channel.title || channel.query;

  return `
    <div class="youtube-avatar${isNew ? ' youtube-avatar-new' : ''}${clickable ? ' youtube-avatar-clickable' : ''}"
         data-channel-idx="${idx}"
         data-name="${ytEscapeAttr(name)}"
         ${clickable ? `data-video-url="${latest.link}" data-latest-id="${latest.videoId}"` : ''}>
      ${avatarHtml}
      ${badgeHtml}
    </div>`;
}

function ytStartScheduler(refreshFn) {
  setInterval(async () => {
    const now = new Date();
    const slot = ytCurrentSlot(now);
    if (!slot) return;

    const lastSlot = await window.matin.store.get(YT_LAST_SLOT_KEY).catch(() => null);
    if (lastSlot === slot) return;

    await window.matin.store.set(YT_LAST_SLOT_KEY, slot);
    refreshFn().catch((err) => console.error('[YouTube] Erreur auto-refresh planifié', err));
  }, YT_SCHEDULE_CHECK_MS);
}

window.MatinModules.youtube = {
  async render(container, config, _google, setBadge) {
    const channels = (config?.channels || []).filter((c) => c.channelId);

    if (!channels.length) {
      container.innerHTML = `<div class="module-empty">Ajoutez une chaîne YouTube dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    container.innerHTML = `
      <div class="youtube-module">
        <div class="youtube-module-avatars-wrap">
          <div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>
        </div>
      </div>
    `;
    const listWrap = container.querySelector('.youtube-module-avatars-wrap');

    // Bouton "Vérifier maintenant" (2026-08-16, sur demande explicite, pour
    // pouvoir tester la détection sans attendre un des 6 créneaux fixes ni
    // relancer toute l'app) — déplacé dans `.module-header`, À DROITE du
    // titre "YOUTUBE" (2026-09-01, 3e révision, sur demande explicite),
    // plutôt que dans le contenu de la carte. `render()` (cette fonction) ne
    // s'exécute qu'UNE SEULE fois par chargement de dashboard (voir
    // ytStartScheduler/loadAndRender plus bas — c'est loadAndRender qui est
    // rappelée en boucle, jamais render() elle-même ; confirmé aussi côté
    // dashboard.js : `youtube` n'a pas de `refreshMs`, donc le bouton
    // "Actualiser" global — voir btnRefresh — ne rappelle pas non plus
    // render() pour ce module), donc CE bouton n'est créé/inséré qu'une
    // seule fois — jamais dupliqué à chaque vérification, contrairement à
    // `.youtube-module-avatars` reconstruite ci-dessous à chaque cycle.
    // Inséré comme DERNIER enfant de `.module-title` (pas un sibling de
    // `.module-header`) pour rester visuellement collé au titre plutôt que
    // dispersé par le `justify-content: space-between` du header (qui
    // n'a que 2 emplacements : titre à gauche, badge de compte à droite) —
    // `.module-title` est lui-même cliquable pour 'youtube' (voir
    // dashboard.js MODULE_CLICK_URLS, ouvre youtube.com/feed/subscriptions),
    // d'où le `stopPropagation` ci-dessous : sans lui, cliquer le bouton
    // déclencherait AUSSI l'ouverture du site en plus du rafraîchissement.
    const card = container.closest('.module-card');
    const titleEl = card?.querySelector('.module-title');
    // Garde-fou anti-doublon (2026-09-01, sur demande explicite, "remove the
    // duplicate refresh button") — retire tout `.youtube-check-now-btn`
    // déjà présent AVANT d'en (re)créer un : `render()` ne s'exécute
    // normalement qu'une fois par chargement de dashboard (voir commentaire
    // ci-dessus), donc ceci ne devrait rien trouver à retirer en usage
    // normal, mais protège contre un doublon visuel si un ancien bouton
    // était resté dans le DOM d'une fenêtre non relancée depuis une
    // précédente version de ce fichier (Electron ne recharge jamais le JS du
    // renderer tout seul). Cible TOUTE la carte (pas juste `titleEl`), au
    // cas où un bouton résiduel d'une ancienne révision traînerait ailleurs
    // dans `.module-content` plutôt que dans le titre.
    card?.querySelectorAll('.youtube-check-now-btn').forEach(el => el.remove());
    const checkNowBtn = document.createElement('button');
    checkNowBtn.type = 'button';
    checkNowBtn.className = 'youtube-check-now-btn';
    checkNowBtn.title = 'Vérifier maintenant, sans attendre le prochain créneau planifié';
    checkNowBtn.textContent = '🔄';
    titleEl?.appendChild(checkNowBtn);

    async function loadAndRender() {
      checkNowBtn.disabled = true;
      setBadge('…');
      const now = new Date();

      // Debug ajouté le 2026-08-16 (sur demande explicite, bug signalé :
      // badge absent malgré une nouvelle vidéo attendue) — log du créneau
      // planifié enregistré (`lastCheckSlot`, voir ytStartScheduler) : sert
      // UNIQUEMENT à éviter de redéclencher 2 fois le même créneau horaire,
      // PAS de référence pour la détection "nouveau" elle-même (voir plus
      // bas — c'est `lastSeenVideoId` + la fenêtre de 24h qui décide, pas
      // ce créneau). Affiché ici pour lever toute ambiguïté sur ce que
      // représente vraiment cette valeur.
      const lastSlot = await window.matin.store.get(YT_LAST_SLOT_KEY).catch(() => null);
      console.log(`[YouTube] Vérification lancée à ${now.toString()} — dernier créneau planifié enregistré (anti-double-déclenchement, PAS la référence de détection) : ${lastSlot || '(aucun pour l’instant)'}`);

      const results = await Promise.allSettled(channels.map((ch) => ytFetchLatestVideos(ch.channelId)));
      let totalNew = 0;
      let baselineChanged = false;

      const avatarsHtml = results.map((r, i) => {
        const ch = channels[i];
        if (r.status === 'rejected') {
          console.warn(`[YouTube] ${ch.title || ch.query} indisponible`, r.reason?.message);
          return ytAvatarHtml(ch, i, 0, null);
        }

        const entries = r.value;
        const latest = entries[0] || null;

        // Pas encore de référence pour cette chaîne (venant d'être ajoutée) :
        // on pose une base silencieuse plutôt que d'afficher tout l'historique
        // récent comme "nouveau" d'un coup.
        if (!ch.lastSeenVideoId && latest) {
          console.log(`[YouTube] ${ch.title || ch.query} — pas de référence connue, pose silencieuse de la base sur "${latest.title}" (${latest.videoId}, publiée ${latest.published})`);
          ch.lastSeenVideoId = latest.videoId;
          baselineChanged = true;
          return ytAvatarHtml(ch, i, 0, latest);
        }

        const newCount = ytCountNewSince(entries, ch.lastSeenVideoId, now);
        totalNew += newCount;

        // Log détaillé par chaîne (points 2/3/4 de la demande) : date de
        // publication de la dernière vidéo, âge en heures, videoId déjà vu,
        // et le résultat de la comparaison — permet de vérifier à l'œil que
        // la logique "vidéo plus récente que lastSeenVideoId ET publiée il y
        // a moins de 24h ⇒ comptée comme nouvelle" fait bien ce qu'elle dit.
        if (latest) {
          const publishedMs = new Date(latest.published).getTime();
          const ageHours = Number.isNaN(publishedMs) ? null : ((now.getTime() - publishedMs) / 3600000).toFixed(1);
          const isLatestAlreadySeen = latest.videoId === ch.lastSeenVideoId;
          console.log(
            `[YouTube] ${ch.title || ch.query} — dernière vidéo : "${latest.title}" (${latest.videoId}), publiée ${latest.published}` +
            (ageHours !== null ? ` (il y a ${ageHours}h)` : ' (date illisible)') +
            ` | lastSeenVideoId=${ch.lastSeenVideoId || '(aucun)'} ${isLatestAlreadySeen ? '(= dernière vidéo, déjà vue)' : '(≠ dernière vidéo)'}` +
            ` | nouveau(x) détecté(s) : ${newCount}`
          );
        } else {
          console.log(`[YouTube] ${ch.title || ch.query} — flux vide (0 vidéo dans le flux Atom)`);
        }

        return ytAvatarHtml(ch, i, newCount, latest);
      }).join('');

      listWrap.innerHTML = `<div class="youtube-module-avatars">${avatarsHtml}</div>`;

      listWrap.querySelectorAll('.youtube-avatar-clickable').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = Number(el.dataset.channelIdx);
          const ch = channels[idx];
          const url = el.dataset.videoUrl;
          const latestId = el.dataset.latestId;
          if (url) window.matin.shell.openExternal(url);

          if (ch && latestId && ch.lastSeenVideoId !== latestId) {
            ch.lastSeenVideoId = latestId;
            window.matin.store.set(YT_CHANNELS_KEY, channels);
          }
          el.classList.remove('youtube-avatar-new');
          el.querySelector('.youtube-avatar-badge')?.remove();
        });
      });

      if (baselineChanged) {
        window.matin.store.set(YT_CHANNELS_KEY, channels);
      }

      console.log(`[YouTube] Vérification terminée : ${totalNew} nouvelle(s) vidéo(s) au total sur ${channels.length} chaîne(s).`);
      setBadge(totalNew > 0 ? String(totalNew) : '—');
      checkNowBtn.disabled = false;
    }

    checkNowBtn.addEventListener('click', (e) => {
      // `.module-title` (parent de ce bouton) est lui-même cliquable pour
      // 'youtube' — voir dashboard.js MODULE_CLICK_URLS — sans ceci, un clic
      // sur 🔄 ouvrirait AUSSI youtube.com/feed/subscriptions en plus de
      // déclencher la vérification.
      e.stopPropagation();
      console.log('[YouTube] Vérification manuelle déclenchée ("Vérifier maintenant")');
      loadAndRender().catch((err) => console.error('[YouTube] Erreur lors de la vérification manuelle', err));
    });

    await loadAndRender();

    ytStartScheduler(loadAndRender);
  },
};
