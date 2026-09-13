$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(powershell|pwsh|python|node|audiocpp_cli|llama-server|kimodo-demo|kmd-generate)\.exe$' } | Select-Object ProcessId,Name,CommandLine)
$tasks = @(Get-ScheduledTask | Where-Object { $_.TaskName -in @('XEDOC Play YuE2 worker','ComfyUI local and tunnel','RAG xedoc reverse tunnel') } | ForEach-Object {
    $info = $_ | Get-ScheduledTaskInfo
    @{name=$_.TaskName;state=[string]$_.State;result=$info.LastTaskResult}
})
@{processes=$processes;tasks=$tasks;computer=$env:COMPUTERNAME} | ConvertTo-Json -Depth 5 -Compress
