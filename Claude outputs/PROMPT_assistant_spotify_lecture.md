# Prompt Claude Code : l'assistant lance lui-même la lecture Spotify

**Problème :** `assistantControlMusic` (renderer/modules/assistant.js) appelle directement `PUT /me/player/play`. Sans appareil Spotify *actif*, l'API répond 404 et l'assistant dit « lance la lecture une fois sur un appareil ». L'API Web Spotify ne joue que sur un appareil Spotify Connect **ouvert** : il faut donc (1) trouver ou réveiller un appareil, (2) lui transférer la lecture, (3) jouer.

Les scopes OAuth nécessaires sont déjà demandés (`main/auth/spotify-oauth.js` : `user-read-playback-state`, `user-modify-playback-state`, `user-read-recently-played`, `playlist-read-private`). Aucune reconnexion n'est nécessaire. Un compte **Premium** reste obligatoire pour piloter la lecture.

Fichiers : `renderer/modules/assistant.js`, `main/main.js`, `main/preload.js`. Lis-les avant de modifier. Ne touche pas au module `spotify.js`, sauf pour le rafraîchir (§4).

---

## 1. main.js + preload.js : ouvrir l'appli Spotify du PC

Près de `youtube:openApp`, qui utilise déjà `isProtocolRegistered` :

```js
// Lance l'appli Spotify desktop (sans lecture) pour qu'elle apparaisse comme
// appareil Spotify Connect. Aucun popup Windows si l'appli n'est pas installée.
ipcMain.handle('spotify:launchApp', async () => {
  const has = await isProtocolRegistered('spotify').catch(() => false);
  if (!has) return { ok: false, reason: 'not-installed' };
  try { await shell.openExternal('spotify:'); return { ok: true }; }
  catch (err) { console.warn('[Spotify] Lancement appli échoué', err); return { ok: false, reason: 'launch-failed' }; }
});
```

preload.js, dans l'objet `spotify` existant : `launchApp: () => ipcRenderer.invoke('spotify:launchApp'),`.

## 2. assistant.js : garantir un appareil

Ajoute avant `assistantControlMusic` :

```js
async function assistantSpotifyApi(token, method, path, body) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  if (res.status !== 204) data = await res.json().catch(() => null);
  return { ok: res.ok || res.status === 204, status: res.status, data };
}

// Renvoie l'id d'un appareil utilisable, en ouvrant l'appli Spotify du PC si
// aucun appareil n'est disponible (attente max ~10 s qu'elle se connecte).
async function assistantSpotifyEnsureDevice(token) {
  const pick = (list) => list.find((d) => d.is_active)
    || list.find((d) => d.type === 'Computer' && !d.is_restricted)
    || list.find((d) => !d.is_restricted);
  let r = await assistantSpotifyApi(token, 'GET', '/me/player/devices');
  let dev = pick(r.data?.devices || []);
  if (dev) return { id: dev.id, name: dev.name, wasActive: dev.is_active };

  const launch = await window.matin.spotify.launchApp();
  if (!launch.ok) return { error: launch.reason === 'not-installed'
    ? "Aucun appareil Spotify disponible et l'application Spotify n'est pas installée sur ce PC."
    : "Impossible d'ouvrir l'application Spotify." };
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    r = await assistantSpotifyApi(token, 'GET', '/me/player/devices');
    dev = pick(r.data?.devices || []);
    if (dev) return { id: dev.id, name: dev.name, wasActive: false, launched: true };
  }
  return { error: "Spotify s'est ouvert mais ne répond pas encore : réessaie dans quelques secondes." };
}
```

## 3. assistant.js : nouvelle version de `assistantControlMusic`

Nouvelle signature : `{ action, query, kind }`.

- `action` : `play` | `pause` | `next` | `previous`.
- `query` (optionnel, avec `play`) : ce qu'il faut jouer (« Daft Punk », « ma playlist Running »).
- `kind` (optionnel) : `playlist` | `artist` | `album` | `track`.

Logique :

1. Token : garde le code actuel (`getValidToken`, message « Spotify non connecté »).
2. `const dev = await assistantSpotifyEnsureDevice(token)`. En cas d'erreur, renvoie `{ error: dev.error }`.
3. Si l'appareil n'était pas actif (`!dev.wasActive`) : `PUT /me/player` avec `{ device_ids: [dev.id], play: false }`, puis attends 400 ms.
4. Selon l'action, avec toujours `?device_id=${dev.id}` en query :
   - `pause` → `PUT /me/player/pause`, `next` → `POST /me/player/next`, `previous` → `POST /me/player/previous`.
   - `play` **sans** `query` → `PUT /me/player/play` sans corps (reprise).
     - En cas de 404, ou de 403 avec `reason` différente de `PREMIUM_REQUIRED` (rien à reprendre sur un appareil qui vient de s'ouvrir) : `GET /me/player/recently-played?limit=1`, puis rejoue `track.context.uri` via `{ context_uri }` s'il existe, sinon `{ uris: [track.uri] }`.
   - `play` **avec** `query` :
     1. Si `kind` vaut `playlist` ou n'est pas précisé : cherche d'abord dans **mes** playlists (`GET /me/playlists?limit=50`), avec une correspondance insensible à la casse et aux accents via la fonction `assistantNorm` déjà présente. Trouvée → `{ context_uri: playlist.uri }`.
     2. Sinon : `GET /search?q=${encodeURIComponent(query)}&type=${kind || 'artist,playlist,album,track'}&limit=5&market=from_token`. Priorité : artiste, puis playlist, puis album quand `kind` n'est pas précisé et que le nom correspond bien. Sinon, premier titre. Artiste, playlist ou album → `{ context_uri }`, titre → `{ uris: [uri] }`.
     3. Rien trouvé → `{ error: \`Rien trouvé sur Spotify pour « ${query} ».\` }`.
5. Réponses :
   - succès → `{ result: \`Spotify : lecture de « Nom » sur ${dev.name}\` }` (ou `pause`/`suivant`/`précédent`). Ajoute « (application Spotify ouverte) » si `dev.launched`.
   - 403 `PREMIUM_REQUIRED` → « Compte Spotify Premium requis pour piloter la lecture. »
   - autre 403 → « Spotify refuse l'action (scope à re-consentir : déconnecter/reconnecter Spotify). »
   - autres codes → `Spotify a répondu ${status}`.

## 4. Déclaration de l'outil, system prompt, rafraîchissement du module

- `control_music` dans `function_declarations`. Garde `behavior: 'BLOCKING'` s'il est présent.
  ```js
  {
    name: 'control_music',
    description: "Spotify : play (reprise, ou lance ce que demande l'utilisateur via query : artiste, playlist perso, album ou titre), pause, next, previous. Ouvre l'appli Spotify du PC si aucun appareil n'est actif.",
    parameters: { type: 'OBJECT', properties: {
      action: { type: 'STRING', enum: ['play', 'pause', 'next', 'previous'] },
      query: { type: 'STRING', description: 'Ce qu\'il faut jouer (optionnel) : « Daft Punk », « ma playlist Running »…' },
      kind: { type: 'STRING', enum: ['playlist', 'artist', 'album', 'track'] },
    }, required: ['action'] },
  },
  ```
- `ASSISTANT_SYSTEM_PROMPT`, ligne control_music : « - control_music : Spotify. play lance la musique même si rien ne joue (ouvre Spotify si besoin) ; avec query pour un artiste, une playlist de l'utilisateur, un album ou un titre ; pause, suivant, précédent. Ne demande jamais à l'utilisateur de lancer la lecture lui-même. »
- `ASSISTANT_TOOL_MODULES` : ajoute `control_music: ['spotify']` pour que la carte Spotify du dashboard se mette à jour après l'action. Vérifie la clé exacte du module dans `MODULE_REGISTRY`.

## Vérifications

1. Ferme complètement Spotify (zone de notification comprise), puis « Lance ma musique ». L'appli Spotify s'ouvre, la lecture démarre en moins de 10 s et l'assistant confirme.
2. Spotify ouvert mais en pause depuis longtemps (pas d'appareil actif) : « Mets de la musique » démarre sans ouvrir de nouvelle fenêtre.
3. « Mets ma playlist [nom d'une de tes playlists] » lance bien ta playlist. « Mets du Daft Punk » lance l'artiste.
4. « Pause », « suivant », « précédent » fonctionnent. La carte Spotify du dashboard se met à jour.
5. Compte non Premium, si tu peux tester : message clair, pas de plantage.

Commit : `feat(assistant): Spotify lance la lecture sans intervention (réveil appareil, recherche playlist/artiste)`.
