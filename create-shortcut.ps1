# create-shortcut.ps1
# A executer UNE SEULE FOIS (double-clic, ou clic droit > Executer avec PowerShell)
# Cree un raccourci "Matin" sur le Bureau qui lance l'application sans passer par Claude Code.

$ProjectRoot = $PSScriptRoot
$TargetBat = Join-Path $ProjectRoot "Matin.bat"
$IconPath = Join-Path $ProjectRoot "renderer\assets\icons\matin_icon_v2.ico"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "Matin.lnk"

if (-not (Test-Path $TargetBat)) {
    Write-Host "Erreur : Matin.bat introuvable dans $ProjectRoot" -ForegroundColor Red
    exit 1
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetBat
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.WindowStyle = 7  # fenetre minimisee au lancement
$Shortcut.Description = "Lancer Matin!*"
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = $IconPath
}
$Shortcut.Save()

Write-Host "Raccourci cree sur le Bureau : $ShortcutPath" -ForegroundColor Green
