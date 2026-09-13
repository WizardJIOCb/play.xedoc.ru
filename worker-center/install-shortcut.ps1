$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'Центр воркеров XEDOC.lnk'))
$shortcut.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'launch.ps1') + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'XEDOC: состояние и запуск локальных воркеров'
$shortcut.IconLocation = "$env:WINDIR\System32\shell32.dll,21"
$shortcut.Save()
Write-Output (Join-Path $desktop 'Центр воркеров XEDOC.lnk')
