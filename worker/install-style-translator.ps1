[CmdletBinding()]
param(
    [string]$PythonPath = 'C:\Users\Rodion\AppData\Local\Programs\Python\Python310\python.exe',
    [string]$InstallPath = 'C:\ProgramData\XEDOCPlay\style-translator'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PythonPath)) {
    throw "Python was not found: $PythonPath"
}

& $PythonPath -m venv $InstallPath
$venvPython = Join-Path $InstallPath 'Scripts\python.exe'
& $venvPython -m pip install --upgrade pip argostranslate
& $venvPython -c @'
import argostranslate.package
argostranslate.package.update_package_index()
package = next((item for item in argostranslate.package.get_available_packages() if item.from_code == "ru" and item.to_code == "en"), None)
if package is None:
    raise RuntimeError("Russian-to-English Argos package was not found")
argostranslate.package.install_from_path(package.download())
'@

Write-Host "Installed the local Russian-to-English style translator at $InstallPath"
