# Prompt Claude Code : Pont SMTC Windows — lecture universelle sans API Spotify

**Objectif :** Intégrer un pont PowerShell qui lit les médias Windows (SMTC — System Media Transport Controls) pour contrôler la lecture depuis la carte Spotify ET depuis l'assistant vocal, **sans API Spotify, sans Premium, sans compte**. Fonctionne avec Spotify desktop, Deezer, Chrome, Edge, Firefox.

Fichiers à modifier : `main/main.js`, `main/preload.js`, `renderer/modules/spotify.js`, `renderer/modules/assistant.js`.  
Fichier à créer : `scripts/media-session.ps1`.  
Ne pas toucher à `main/auth/spotify-oauth.js`.

---

## 0. Prérequis : vérification initiale

Lis ces fichiers dans l'ordre avant toute modification :
1. `main/main.js` — repère `const { execFile, spawn } = require('child_process');` (ligne ~7), la fonction `isProtocolRegistered`, et le bloc `ipcMain.handle('youtube:openApp', ...)`. Le pont SMTC s'insère dans le même style.
2. `main/preload.js` — repère l'objet `spotify: { ... }` déjà existant.
3. `renderer/modules/spotify.js` — tu en auras besoin pour la phase 3.
4. `renderer/modules/assistant.js` — repère `assistantControlMusic` (vers la ligne 253).

---

## 1. Script PowerShell — `scripts/media-session.ps1`

Crée le dossier `scripts/` à la racine du projet et place-y ce fichier exactement tel quel (ne pas reformater) :

```powershell
# ─────────────────────────────────────────────────────────────────────────────
# media-session.ps1 — Pont « média Windows » pour Mon Matin
#
# Lit la session média Windows (SMTC : ce que montre le panneau volume de
# Windows 10/11) et la pilote, sans API Spotify, sans Premium, sans compte.
# Fonctionne avec l'appli Spotify (et Deezer, navigateurs…).
#
# Protocole :  stdout = une ligne JSON par événement
#   {"type":"ready"}
#   {"type":"state", ...}            (à chaque changement + toutes les 5 s)
#   {"type":"none"}                  (aucune session média)
#   {"type":"thumb","key":..,"mime":..,"data":<base64>}   (nouvelle pochette)
#   {"type":"ack","id":..,"cmd":..,"ok":true|false}
#   {"type":"error","message":..}
#              stdin  = une commande par ligne : "<id> <cmd>"
#   cmd ∈ play | pause | toggle | next | previous | refresh
#
# Windows 10 1809+ requis. PowerShell 5.1 (inclus dans Windows).
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding  = New-Object System.Text.UTF8Encoding($false)

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
} catch {
  Emit @{ type = 'error'; fatal = $true; message = "WinRT indisponible : $($_.Exception.Message)" }
  exit 2
}

# Touches multimédia (repli quand aucune session n'est encore ouverte)
Add-Type -Namespace MonMatin -Name Keys -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
'@
function Send-MediaKey([byte]$vk) {
  [MonMatin.Keys]::keybd_event($vk, 0, 1, [UIntPtr]::Zero)   # EXTENDEDKEY
  [MonMatin.Keys]::keybd_event($vk, 0, 3, [UIntPtr]::Zero)   # EXTENDEDKEY | KEYUP
}
$VK = @{ toggle = 0xB3; play = 0xB3; next = 0xB0; previous = 0xB1 }

# await d'une IAsyncOperation<T> WinRT depuis PowerShell 5.1
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type, [int]$timeoutMs = 4000) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if ($task.Wait($timeoutMs)) { return $task.Result }
  return $null
}

$Mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
             ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if (-not $Mgr) { Emit @{ type = 'error'; fatal = $true; message = 'Gestionnaire média Windows inaccessible.' }; exit 3 }

# Spotify en priorité, sinon la session courante de Windows.
function Get-TargetSession {
  $sessions = @($Mgr.GetSessions())
  $spotify = $sessions | Where-Object { $_.SourceAppUserModelId -like '*spotify*' } | Select-Object -First 1
  if ($spotify) { return $spotify }
  return $Mgr.GetCurrentSession()
}

function Get-AppLabel([string]$id) {
  if ($id -like '*spotify*') { return 'Spotify' }
  if ($id -like '*deezer*')  { return 'Deezer' }
  if ($id -like '*chrome*')  { return 'Chrome' }
  if ($id -like '*msedge*')  { return 'Edge' }
  if ($id -like '*firefox*') { return 'Firefox' }
  return ($id -replace '\.exe$', '' -replace '^.*!', '')
}

$lastSig = ''
$lastThumbKey = ''
$lastEmit = [DateTime]::MinValue

function Read-State([bool]$force) {
  $s = Get-TargetSession
  if (-not $s) {
    if ($script:lastSig -ne 'none' -or $force) { Emit @{ type = 'none' }; $script:lastSig = 'none' }
    return
  }
  $props = Await ($s.TryGetMediaPropertiesAsync()) `
                 ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $pb = $s.GetPlaybackInfo()
  $tl = $s.GetTimelineProperties()
  $status = "$($pb.PlaybackStatus)".ToLower()
  $title  = if ($props) { $props.Title } else { '' }
  $artist = if ($props) { $props.Artist } else { '' }
  if (-not $artist -and $props) { $artist = $props.AlbumArtist }
  $album  = if ($props) { $props.AlbumTitle } else { '' }

  $posMs = [int64]$tl.Position.TotalMilliseconds
  $durMs = [int64]($tl.EndTime - $tl.StartTime).TotalMilliseconds
  if ($status -eq 'playing' -and $tl.LastUpdatedTime.Year -gt 2000) {
    $posMs += [int64]([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalMilliseconds
  }
  if ($durMs -gt 0 -and $posMs -gt $durMs) { $posMs = $durMs }

  $thumbKey = "$($s.SourceAppUserModelId)|$title|$artist|$album"
  $sig = "$thumbKey|$status"
  $now = [DateTime]::UtcNow
  if ($force -or $sig -ne $script:lastSig -or ($now - $script:lastEmit).TotalSeconds -ge 5) {
    Emit @{
      type = 'state'; appId = $s.SourceAppUserModelId; app = (Get-AppLabel $s.SourceAppUserModelId)
      title = $title; artist = $artist; album = $album; status = $status
      positionMs = $posMs; durationMs = $durMs; at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
      thumbKey = $thumbKey
    }
    $script:lastSig = $sig
    $script:lastEmit = $now
  }

  if ($thumbKey -ne $script:lastThumbKey) {
    $script:lastThumbKey = $thumbKey
    if ($props -and $props.Thumbnail) {
      try {
        $ras = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        if ($ras) {
          $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
          $ms = New-Object System.IO.MemoryStream
          $net.CopyTo($ms)
          $mime = if ($ras.ContentType) { $ras.ContentType } else { 'image/png' }
          Emit @{ type = 'thumb'; key = $thumbKey; mime = $mime; data = [Convert]::ToBase64String($ms.ToArray()) }
          $net.Dispose(); $ms.Dispose()
        }
      } catch { Emit @{ type = 'thumb'; key = $thumbKey; mime = ''; data = '' } }
    } else {
      Emit @{ type = 'thumb'; key = $thumbKey; mime = ''; data = '' }
    }
  }
}

function Invoke-Command([string]$cmd) {
  $s = Get-TargetSession
  if (-not $s) {
    if ($VK.ContainsKey($cmd)) { Send-MediaKey $VK[$cmd]; return $true }
    return $false
  }
  switch ($cmd) {
    'play'     { return [bool](Await ($s.TryPlayAsync()) ([bool])) }
    'pause'    { return [bool](Await ($s.TryPauseAsync()) ([bool])) }
    'toggle'   { return [bool](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
    'next'     { return [bool](Await ($s.TrySkipNextAsync()) ([bool])) }
    'previous' { return [bool](Await ($s.TrySkipPreviousAsync()) ([bool])) }
    'refresh'  { return $true }
    default    { return $false }
  }
}

Emit @{ type = 'ready' }
$stdin = [Console]::In
$pending = $stdin.ReadLineAsync()

while ($true) {
  try {
    while ($pending.IsCompleted) {
      $line = $pending.Result
      if ($null -eq $line) { exit 0 }
      $pending = $stdin.ReadLineAsync()
      $parts = $line.Trim().Split(' ', 2)
      if ($parts.Count -lt 2) { continue }
      $ok = $false
      try { $ok = Invoke-Command $parts[1] } catch { $ok = $false }
      Emit @{ type = 'ack'; id = $parts[0]; cmd = $parts[1]; ok = $ok }
      Start-Sleep -Milliseconds 250
      Read-State $true
    }
    Read-State $false
  } catch {
    Emit @{ type = 'error'; message = $_.Exception.Message }
  }
  Start-Sleep -Milliseconds 1000
}
```

---

## 2. main.js — pont SMTC (spawn + IPC)

Insère ce bloc **juste après** le bloc `ipcMain.handle('youtube:openApp', ...)` dans `main/main.js` :

```js
// ── Pont SMTC (System Media Transport Controls Windows) ──────────────────────
// Spawn d'un processus PowerShell persistant qui lit et pilote le lecteur actif
// du système (Spotify, Deezer, Chrome…) via WinRT, sans API ni compte.
// Protocole : JSON lines sur stdout / commandes texte sur stdin.
// Windows 10 1809+ uniquement. Sur les autres plateformes, les handles IPC
// répondent immédiatement avec des valeurs neutres.
let smtcProc = null;
let smtcWin  = null;   // BrowserWindow cible pour les événements renderer
let smtcSeq  = 0;
const smtcPending = new Map(); // id → { resolve, timer }

function smtcStart(win) {
  if (smtcProc || process.platform !== 'win32') return;
  smtcWin = win;
  const scriptPath = path.join(__dirname, '..', 'scripts', 'media-session.ps1');
  smtcProc = spawn(
    'powershell.exe',
    ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  );
  smtcProc.stdout.setEncoding('utf8');
  let buf = '';
  smtcProc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'ack') {
          const p = smtcPending.get(msg.id);
          if (p) { clearTimeout(p.timer); smtcPending.delete(msg.id); p.resolve(msg.ok); }
        } else if (msg.type === 'state' || msg.type === 'none') {
          smtcWin?.webContents?.send('smtc:state', msg);
        } else if (msg.type === 'thumb') {
          smtcWin?.webContents?.send('smtc:thumb', msg);
        } else if (msg.type === 'error') {
          console.warn('[SMTC]', msg.message, msg.fatal ? '(fatal)' : '');
          if (msg.fatal) { smtcProc = null; }
        }
      } catch { /* ligne non-JSON, ignorer */ }
    }
  });
  smtcProc.stderr.on('data', (d) => console.warn('[SMTC stderr]', d.toString().trim()));
  smtcProc.on('close', (code) => {
    console.log('[SMTC] Processus terminé (code', code, ')');
    smtcProc = null;
    // Notifier le renderer que la session est perdue
    smtcWin?.webContents?.send('smtc:state', { type: 'none' });
  });
}

function smtcStop() {
  if (smtcProc) {
    try { smtcProc.stdin.end(); } catch {}
    try { smtcProc.kill(); } catch {}
    smtcProc = null;
  }
}

ipcMain.handle('smtc:start', (e) => {
  if (process.platform !== 'win32') return false;
  const win = BrowserWindow.fromWebContents(e.sender);
  smtcStart(win);
  return true;
});

ipcMain.handle('smtc:send', async (_e, cmd) => {
  if (!smtcProc) return false;
  return new Promise((resolve) => {
    const id = ++smtcSeq;
    const timer = setTimeout(() => {
      smtcPending.delete(id);
      resolve(false);
    }, 5000);
    smtcPending.set(id, { resolve, timer });
    try { smtcProc.stdin.write(`${id} ${cmd}\n`); }
    catch (err) { clearTimeout(timer); smtcPending.delete(id); resolve(false); }
  });
});

ipcMain.on('smtc:stop', () => smtcStop());
// ── Fin pont SMTC ─────────────────────────────────────────────────────────────
```

**Démarrage automatique** : dans la fonction `createWindow()` (ou son équivalent), après que la fenêtre principale est créée, ajoute :

```js
smtcStart(mainWindow);
```

Cherche le commentaire `// mainWindow est prête` ou l'appel à `mainWindow.loadFile(...)` et insère la ligne juste après.

**Arrêt propre** : dans le handler `app.on('before-quit', ...)` ou `app.on('will-quit', ...)`, ajoute `smtcStop()` pour fermer proprement le processus PowerShell.

**Import path** : vérifie que `const path = require('path');` est bien présent en tête de `main.js` (c'est normalement le cas).

---

## 3. preload.js — exposition de l'API SMTC

Dans le bloc `contextBridge.exposeInMainWorld('matin', { ... })`, à l'intérieur du même objet que `spotify: { ... }`, ajoute la clé `smtc` :

```js
smtc: {
  /** Lance le pont (no-op si déjà démarré ou si non-Windows). */
  start: () => ipcRenderer.invoke('smtc:start'),
  /** Envoie une commande : 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'refresh'. */
  send: (cmd) => ipcRenderer.invoke('smtc:send', cmd),
  /** Arrête le pont (utilisé à la fermeture). */
  stop: () => ipcRenderer.send('smtc:stop'),
  /** Abonnement aux changements d'état. cb reçoit { type:'state'|'none', ... }. */
  onState: (cb) => { ipcRenderer.on('smtc:state', (_e, msg) => cb(msg)); },
  /** Abonnement aux pochettes. cb reçoit { type:'thumb', key, mime, data }. */
  onThumb: (cb) => { ipcRenderer.on('smtc:thumb', (_e, msg) => cb(msg)); },
  /** Désabonnement (passe la même référence cb qu'à onState). */
  offState: (cb) => ipcRenderer.removeAllListeners('smtc:state'),
  offThumb: (cb) => ipcRenderer.removeAllListeners('smtc:thumb'),
},
```

---

## 4. spotify.js — intégration SMTC comme source secondaire

**Objectif :** quand l'API Spotify ne renvoie rien (pas de playback, utilisateur non connecté ou non Premium), la carte affiche quand même ce qui joue sur le PC grâce à SMTC. Quand Spotify est actif, l'affichage Spotify reste prioritaire.

### 4a. Ajouter l'état SMTC en haut du module

Juste après les lignes `let spotifyRecentCache = ...` :

```js
// État SMTC — partagé dans tout le module (un seul processus PowerShell global)
let smtcState   = null;  // dernier { type:'state', title, artist, app, status, positionMs, durationMs, thumbKey } ou null
let smtcThumbs  = new Map(); // thumbKey → data-URL (ex : "data:image/png;base64,…")
let smtcListening = false;   // true si les listeners ipcRenderer sont déjà posés

function smtcEnsureListening() {
  if (smtcListening) return;
  smtcListening = true;
  window.matin.smtc.onState((msg) => {
    smtcState = (msg.type === 'state') ? msg : null;
  });
  window.matin.smtc.onThumb((msg) => {
    if (msg.data) smtcThumbs.set(msg.key, `data:${msg.mime};base64,${msg.data}`);
    else smtcThumbs.delete(msg.key);
  });
  window.matin.smtc.start();
}
```

### 4b. Nouvelle fonction `spotifySmtcHtml(state, thumbDataUrl)`

Ajoute cette fonction après `spotifyIdleHtml` :

```js
function spotifySmtcHtml(state, thumbDataUrl) {
  const pct = state.durationMs ? Math.min(100, (state.positionMs / state.durationMs) * 100) : 0;
  const isPlaying = state.status === 'playing';
  return `
    <div class="spotify-player spotify-player--smtc">
      <div class="spotify-top-row">
        ${thumbDataUrl
          ? `<img class="spotify-cover" src="${thumbDataUrl}" alt="">`
          : '<div class="spotify-cover spotify-cover-empty"></div>'}
        <div class="spotify-meta">
          <div class="spotify-title" title="${state.title || ''}">${state.title || '—'}</div>
          <div class="spotify-artist" title="${state.artist || ''}">${state.artist || state.app || ''}</div>
        </div>
      </div>
      <div class="spotify-controls-row">
        <div class="spotify-controls-main">
          <button class="spotify-btn smtc-btn" data-smtc="previous" title="Précédent">${SPOTIFY_ICONS.previous}</button>
          <button class="spotify-btn spotify-btn-play smtc-btn" data-smtc="toggle" title="${isPlaying ? 'Pause' : 'Lecture'}">${isPlaying ? SPOTIFY_ICONS.pause : SPOTIFY_ICONS.play}</button>
          <button class="spotify-btn smtc-btn" data-smtc="next" title="Suivant">${SPOTIFY_ICONS.next}</button>
        </div>
        <div class="spotify-smtc-app">${state.app || ''}</div>
      </div>
      ${state.durationMs > 0 ? `
      <div class="spotify-progress">
        <div class="spotify-progress-bar"><div class="spotify-progress-fill" style="width:${pct}%"></div></div>
        <div class="spotify-progress-times">
          <span>${spotifyFmtTime(state.positionMs)}</span>
          <span>${spotifyFmtTime(state.durationMs)}</span>
        </div>
      </div>` : ''}
    </div>`;
}
```

Ajoute aussi ce CSS inline à la fin du fichier (ou dans le fichier CSS du module si tu en trouves un) :

```js
// Style spécifique à la vue SMTC (label app à droite des contrôles)
if (!document.querySelector('#smtc-style')) {
  const s = document.createElement('style');
  s.id = 'smtc-style';
  s.textContent = `
    .spotify-smtc-app { font-size: 10px; color: var(--text-muted, #8b95a8); text-transform: uppercase;
                        letter-spacing: .04em; margin-left: auto; }
    .spotify-player--smtc .spotify-volume { display: none; }
  `;
  document.head.appendChild(s);
}
```

Appelle cette injection une seule fois au chargement du module, par exemple au tout début de `window.MatinModules.spotify = { ... }` dans la fonction `render`, juste avant `smtcEnsureListening()`.

### 4c. Modifier la fonction `tick()` dans `render()`

Dans la fonction `tick()`, **après le bloc** `if (!playback || !playback.item) { ... }` (qui affiche `spotifyIdleHtml`), remplace le `return true;` de ce bloc par le code suivant :

```js
// Pas de lecture Spotify — essaie SMTC
if (smtcState && smtcState.title) {
  const thumb = smtcThumbs.get(smtcState.thumbKey) || null;
  container.innerHTML = spotifySmtcHtml(smtcState, thumb);
  setBadge(smtcState.status === 'playing' ? (smtcState.app || '') : 'en pause');
  // Câblage des boutons SMTC
  container.querySelectorAll('.smtc-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.matin.smtc.send(btn.dataset.smtc);
    });
  });
  return true;
}
// Vraiment rien — affichage "écoutés récemment" Spotify comme avant
const recent = await spotifyFetchRecentlyPlayed(accessToken).catch(() => []);
container.innerHTML = spotifyIdleHtml(recent);
container.querySelectorAll('.spotify-recent-item').forEach(el => {
  el.addEventListener('click', () => {
    const link = el.dataset.link;
    if (link) window.matin.shell.openExternal(link);
  });
});
updateBadge(null);
return true;
```

### 4d. Appel initial dans `render()`

Tout en haut de la méthode `render(container, _config, _google, setBadge)`, **avant** le `const tokenData = await window.matin.spotify.getValidToken();` :

```js
smtcEnsureListening();
injectSmtcStyle();   // renomme le bloc d'injection CSS de §4b en fonction injectSmtcStyle()
```

La fonction `injectSmtcStyle` doit être déclarée une seule fois dans la portée du module (hors de `render`) et protégée par `if (document.querySelector('#smtc-style')) return;`.

---

## 5. assistant.js — `assistantControlMusic` via SMTC

### 5a. Ajouter une fonction helper SMTC

Ajoute juste avant `assistantControlMusic` :

```js
/** Commande SMTC + retour formaté pour l'assistant. */
async function assistantSmtcControl(cmd) {
  const ok = await window.matin.smtc.send(cmd);
  return ok;
}
```

### 5b. Modifier `assistantControlMusic`

Dans la fonction `assistantControlMusic({ action, query, kind })`, **avant** le bloc qui fait l'appel `PUT /me/player/play` (l'action `play` sans query), ajoute :

```js
// Si aucun query (reprise simple) et que SMTC est disponible, utiliser SMTC
// directement — plus fiable qu'une API qui nécessite un appareil actif.
if (action === 'play' && !query) {
  const smtcOk = await assistantSmtcControl('play');
  if (smtcOk) return { result: 'Lecture lancée.' };
  // sinon continuer avec la logique Spotify API existante
}
if (action === 'pause') {
  const smtcOk = await assistantSmtcControl('pause');
  if (smtcOk) return { result: 'Lecture en pause.' };
}
if (action === 'next') {
  const smtcOk = await assistantSmtcControl('next');
  if (smtcOk) return { result: 'Morceau suivant.' };
}
if (action === 'previous') {
  const smtcOk = await assistantSmtcControl('previous');
  if (smtcOk) return { result: 'Morceau précédent.' };
}
// Si SMTC échoue pour ces actions, continuer avec Spotify API...
```

**Important :** ce bloc SMTC doit précéder l'appel `getValidToken()` pour les actions sans query. Si l'action est `play` avec `query`, passe directement à la logique Spotify API (recherche) car SMTC ne peut pas choisir une playlist.

### 5c. Modifier le system prompt de l'assistant

Dans `ASSISTANT_SYSTEM_PROMPT`, à la ligne `control_music`, mets à jour la description :

```
- control_music : Spotify / contrôle audio Windows. play lance la musique même si rien ne joue ; avec query pour un artiste, playlist ou album (Spotify Premium requis pour la recherche) ; pause, suivant, précédent (fonctionnent sans Premium via le système Windows).
```

---

## 6. Vérifications

1. **Lance `npm start`** — vérifie dans la console Electron qu'on voit `[SMTC]` au démarrage si Windows (pas d'erreur fatale).
2. **Ouvre Spotify desktop et joue un morceau**, puis ferme la fenêtre Spotify (mise en fond). La carte Spotify de Matin doit afficher le titre/artiste/pochette et les boutons ▶⏭⏮ doivent fonctionner sans API Spotify.
3. **Lance Deezer ou une vidéo YouTube dans Chrome**, puis vérifie que la carte Spotify affiche le contenu Deezer/Chrome avec le label de l'app à droite.
4. **Dis à l'assistant « mets en pause »** — la lecture doit s'arrêter sans message d'erreur, même sans appareil Spotify Connect actif.
5. **Dis « joue du Daft Punk »** — l'assistant doit utiliser Spotify API (query avec recherche) et ouvrir Spotify si besoin, comme prévu dans `PROMPT_assistant_spotify_lecture.md`. SMTC ne gère pas la recherche.
6. **Sur un PC sans PowerShell** (très rare) ou **macOS en développement** : la carte Spotify doit continuer à s'afficher normalement avec l'API Spotify seule — aucun crash, `smtcState` reste `null`.

---

## Notes d'architecture

- Le processus PowerShell est unique et global (lancé à l'ouverture de l'app, tué à la fermeture). Ne pas relancer à chaque render du module.
- `smtcEnsureListening()` pose les listeners `ipcRenderer` une seule fois, même si `render()` est appelé plusieurs fois (rechargement de la carte).
- La pochette SMTC est transmise en base64 (une seule fois par morceau). Le cache `smtcThumbs` est une `Map` en mémoire — perdu à la fermeture, acceptable.
- Le volume n'est pas contrôlable via SMTC (WinRT ne l'expose pas dans GSMTC). Le slider de volume reste uniquement pour la vue Spotify Premium.
- La barre de progression SMTC est informative (position extrapolée dans le script PS1). Il n'y a pas de seek via SMTC.

Commit suggéré : `feat(media): pont SMTC Windows — lecture universelle sans API Spotify`
