param(
    [Parameter(Mandatory)]
    [ValidateSet('yue2','comfy','studio','kimodo','ollama','gptoss','codex','giga','rag')]
    [string]$WorkerId
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$project = Split-Path $PSScriptRoot -Parent
$rag = 'C:\Projects\rag'
$studio = 'C:\Projects\models.xedoc.ru'
$comfy = 'C:\Projects\comfy'
$music = Join-Path $project 'worker\music-worker.ps1'
$targets = @{
    yue2 = @($music)
    comfy = @("$comfy\scripts\start-comfy-tunnel.ps1", "$comfy\ComfyUI\main.py")
    studio = @("$studio\scripts\Start-Studio.ps1", "$studio\scripts\Run-StudioTunnel.ps1", "$studio\studio\server.py")
    kimodo = @("$studio\scripts\Start-Kimodo.ps1", 'C:\Users\Rodion\Documents\Codex\2026-08-24\https-x-com-stefan-3d-ai\outputs\kimodo-local\bin\kimodo-demo.exe')
    gptoss = @("$rag\scripts\start-gpt-oss.ps1")
    codex = @("$rag\scripts\start-codex-gateway.ps1", "$rag\gateway\codex-gateway.mjs")
    giga = @("$rag\scripts\start-giga-embeddings-gateway.ps1", "$rag\gateway\giga-embeddings-gateway.py")
    rag = @("$rag\deploy\rag.xedoc.ru\windows\start-rag-tunnel.ps1")
    ollama = @()
}
$tasks = @{ yue2='XEDOC Play YuE2 worker'; comfy='ComfyUI local and tunnel'; rag='RAG xedoc reverse tunnel' }
$all = @(Get-CimInstance Win32_Process)
$roots = @($all | Where-Object {
    $candidate = $_
    if ($candidate.ProcessId -eq $PID -or $candidate.Name -notmatch '^(powershell|pwsh|python|node|llama-server|kimodo-demo)\.exe$') { return $false }
    $line = ([string]$candidate.CommandLine).Replace('/', '\')
    foreach ($target in $targets[$WorkerId]) {
        # Match a complete command-line path token, not a substring or port owner alone.
        if ($line -match ('(?i)(?:^|[\s"''])' + [regex]::Escape($target) + '(?=$|[\s"''])')) { return $true }
    }
    return ($WorkerId -eq 'gptoss' -and $candidate.Name -eq 'llama-server.exe' -and $line -match '(?:^|\s)--port\s+11435(?:\s|$)')
})
$selected = @{}
foreach ($root in $roots) { $selected[[int]$root.ProcessId] = $root }
# Snapshot children before ending supervisors. Studio/RAG dependencies have their own cards.
$changed = $true
while ($changed) {
    $changed = $false
    foreach ($candidate in $all) {
        if ($selected.ContainsKey([int]$candidate.ProcessId) -or -not $selected.ContainsKey([int]$candidate.ParentProcessId)) { continue }
        $parent = $selected[[int]$candidate.ParentProcessId]
        if ($candidate.CreationDate -lt $parent.CreationDate) { continue }
        if ($parent.Name -match '^(powershell|pwsh)\.exe$' -and $WorkerId -ne 'yue2' -and $candidate.Name -ne 'ssh.exe') { continue }
        $selected[[int]$candidate.ProcessId] = $candidate
        $changed = $true
    }
}
$jobs = @()
if ($WorkerId -eq 'yue2') {
    foreach ($candidate in $selected.Values) {
        if ($candidate.Name -eq 'audiocpp_cli.exe' -and $candidate.CommandLine -match '--out\s+"?([^"\r\n]+?\.wav)(?:"|\s|$)') {
            $jobId = [IO.Path]::GetFileNameWithoutExtension($Matches[1])
            if ($jobId -cmatch '^[a-zA-Z0-9_-]{24}$') { $jobs += $jobId }
        }
    }
}
# End the scheduled supervisor intentionally so its restart-on-failure policy is not triggered.
if ($tasks.ContainsKey($WorkerId)) {
    $task = Get-ScheduledTask -TaskName $tasks[$WorkerId] -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -InputObject $task }
}
# Parents first prevent new children; recheck identity immediately before terminating each process.
foreach ($expected in ($selected.Values | Sort-Object CreationDate)) {
    $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($expected.ProcessId)"
    if (-not $live) { continue }
    if ($live.CreationDate -ne $expected.CreationDate -or $live.CommandLine -cne $expected.CommandLine) { throw 'Process identity changed; stop was cancelled.' }
    $handle = Get-Process -Id $live.ProcessId -ErrorAction SilentlyContinue
    if ($handle) {
        # Holding the process handle protects against PID reuse between checking and stopping.
        $null = $handle.Handle
        # CIM truncates sub-microsecond ticks; compare within its timestamp precision.
        if ([Math]::Abs(($handle.StartTime.ToUniversalTime() - $expected.CreationDate.ToUniversalTime()).Ticks) -ge 10) { throw 'Process start time changed; stop was cancelled.' }
        try { if (-not $handle.HasExited) { $handle.Kill(); $handle.WaitForExit(10000) | Out-Null } }
        finally { $handle.Dispose() }
    }
}
if ($WorkerId -in @('ollama','rag')) {
    $container = if ($WorkerId -eq 'ollama') { 'rag-ollama' } else { 'rag-open-webui' }
    & docker stop --time 15 $container
    if ($LASTEXITCODE -ne 0) { throw "Could not stop $container" }
}
foreach ($jobId in $jobs) {
    $config = Get-Content -LiteralPath 'C:\ProgramData\XEDOCPlay\music-worker.json' -Raw | ConvertFrom-Json
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$($config.apiBase.TrimEnd('/'))/api/generation/worker/$jobId/failed" -Method Post -Headers @{Authorization="Bearer $($config.token)"} -ContentType 'text/plain; charset=utf-8' -Body 'Stopped from XEDOC Worker Center' -TimeoutSec 15 | Out-Null
    } catch { throw "Worker stopped, but generation $jobId could not be marked as interrupted. Refresh the generation page." }
}
