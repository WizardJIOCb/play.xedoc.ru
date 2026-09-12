[CmdletBinding()]
param(
    [string]$ConfigPath = 'C:\ProgramData\XEDOCPlay\music-worker.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Worker configuration not found: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($property in @('apiBase', 'token', 'cliPath', 'modelPath', 'outputPath')) {
    if (-not $config.$property) { throw "Worker configuration is missing '$property'" }
}
if (-not (Test-Path -LiteralPath $config.cliPath)) { throw "audio.cpp CLI was not found: $($config.cliPath)" }
if (-not (Test-Path -LiteralPath $config.modelPath)) { throw "YuE2 model directory was not found: $($config.modelPath)" }

New-Item -ItemType Directory -Force -Path $config.outputPath | Out-Null
$headers = @{ Authorization = "Bearer $($config.token)" }
$claimUri = "$($config.apiBase.TrimEnd('/'))/api/generation/worker/claim"
$job = $null

function Report-Failure([string]$JobId, [string]$Message) {
    try {
        Invoke-WebRequest -Uri "$($config.apiBase.TrimEnd('/'))/api/generation/worker/$JobId/failed" -Method Post -Headers $headers -ContentType 'text/plain; charset=utf-8' -Body $Message | Out-Null
    } catch {
        Write-Warning "Could not report failed job ${JobId}: $($_.Exception.Message)"
    }
}

function Upload-Wav([string]$JobId, [string]$Output, [object]$DurationMs) {
    # Invoke-WebRequest can close a large request body before Nginx has passed it
    # upstream. Stream the existing WAV with HttpClient instead: this keeps the
    # bearer token out of command-line arguments and does not load the file into RAM.
    $client = $null
    $request = $null
    $response = $null
    $content = $null
    $stream = $null
    try {
        $client = [System.Net.Http.HttpClient]::new()
        $client.Timeout = [TimeSpan]::FromMinutes(10)
        $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', [string]$config.token)
        $client.DefaultRequestHeaders.ExpectContinue = $false

        $request = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::Post,
            "$($config.apiBase.TrimEnd('/'))/api/generation/worker/$JobId/complete"
        )
        if ($null -ne $DurationMs) {
            [void]$request.Headers.TryAddWithoutValidation('X-Generation-Duration-Ms', [string]$DurationMs)
        }
        $stream = [System.IO.File]::OpenRead($Output)
        $content = [System.Net.Http.StreamContent]::new($stream)
        $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('audio/wav')
        $request.Content = $content
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            $detail = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            throw "Upload returned HTTP $([int]$response.StatusCode): $detail"
        }
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        if ($null -ne $request) { $request.Dispose() }
        if ($null -ne $client) { $client.Dispose() }
    }
}

while ($true) {
    try {
        $job = $null
        $claim = Invoke-WebRequest -Uri $claimUri -Method Post -Headers $headers -ContentType 'application/json'
        if ([string]::IsNullOrWhiteSpace($claim.Content) -or $claim.Content.Trim() -eq 'null') {
            Start-Sleep -Seconds 8
            continue
        }
        $job = $claim.Content | ConvertFrom-Json

        $output = Join-Path $config.outputPath "$($job.id).wav"
        if (-not [bool]$job.uploadOnly) {
            if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
            $arguments = @(
                '--task', 'gen', '--family', 'yue2', '--model', $config.modelPath,
                '--backend', 'cuda', '--threads', '8', '--lyrics', [string]$job.lyrics,
                '--request-option', "style=$([string]$job.style)", '--request-option', 'cot=full',
                '--session-option', 'yue2.model_gguf=yue2-3b-q4_0.gguf',
                '--session-option', 'yue2.vae_gguf=yue2-vae-f16.gguf',
                '--out', $output, '--metrics', '--log'
            )
            Write-Host "[$(Get-Date -Format s)] Generating $($job.id): $($job.title)"
            & $config.cliPath @arguments
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output) -or (Get-Item -LiteralPath $output).Length -lt 44) {
                throw "YuE2 exited with code $LASTEXITCODE and did not produce a valid WAV"
            }
        } elseif (-not (Test-Path -LiteralPath $output) -or (Get-Item -LiteralPath $output).Length -lt 44) {
            throw "The ready WAV is no longer available on this computer"
        }

        $durationMs = $null
        $ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
        if ($ffprobe) {
            $seconds = & $ffprobe.Source -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $output
            if ($LASTEXITCODE -eq 0 -and $seconds -as [double]) { $durationMs = [int]([double]$seconds * 1000) }
        }
        Write-Host "[$(Get-Date -Format s)] Uploading $($job.id): $($job.title)"
        Upload-Wav -JobId ([string]$job.id) -Output $output -DurationMs $durationMs
        Remove-Item -LiteralPath $output -Force
        Write-Host "[$(Get-Date -Format s)] Completed $($job.id)"
    } catch {
        $message = $_.Exception.Message
        Write-Warning "YuE2 worker error: $message"
        if ($null -ne $job -and $null -ne $job.PSObject.Properties['id']) { Report-Failure -JobId ([string]$job.id) -Message $message }
        Start-Sleep -Seconds 12
    }
}
