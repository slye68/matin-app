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

# Spotify en priorité (appli classique « Spotify.exe » ou version Store
# « SpotifyAB.SpotifyMusic_…!Spotify »), sinon la session courante de Windows.
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
  $status = "$($pb.PlaybackStatus)".ToLower()       # playing | paused | stopped | changing | opened | closed
  $title  = if ($props) { $props.Title } else { '' }
  $artist = if ($props) { $props.Artist } else { '' }
  if (-not $artist -and $props) { $artist = $props.AlbumArtist }
  $album  = if ($props) { $props.AlbumTitle } else { '' }

  # Position : valeur au moment LastUpdatedTime ; on l'extrapole si ça joue.
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

  # Pochette : seulement quand le morceau change (coûteux).
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
    # Commandes en attente (lecture non bloquante de stdin)
    while ($pending.IsCompleted) {
      $line = $pending.Result
      if ($null -eq $line) { exit 0 }               # stdin fermé : l'app s'est arrêtée
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
