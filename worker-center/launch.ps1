param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$centerUrl = 'http://127.0.0.1:8787'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'XEDOCWorkerCenter'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
function Test-Center {
    try { return (Invoke-RestMethod -Uri "$centerUrl/api/health" -TimeoutSec 2).service -eq 'xedoc-worker-center' } catch { return $false }
}
$mutex = [System.Threading.Mutex]::new($false, 'Local\XEDOCWorkerCenterLauncher')
$owned = $false
try {
    try { $owned = $mutex.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { throw 'Another launcher is busy. Try again shortly.' }
    if (-not (Test-Center)) {
        if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8787 is used by another application.' }
        $python = (Get-Command python.exe -ErrorAction Stop).Source
        Start-Process -FilePath $python -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'server.py') + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDirectory 'center.stdout.log') -RedirectStandardError (Join-Path $stateDirectory 'center.stderr.log') | Out-Null
        $ready = $false
        foreach ($attempt in 1..20) {
            if (Test-Center) { $ready = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw "Worker center did not start. See $stateDirectory\center.stderr.log" }
    }
} finally {
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
if (-not $NoBrowser) { Start-Process $centerUrl }
