$ErrorActionPreference = 'Stop'
$platformRuntimeFile = Join-Path $PSScriptRoot 'data\runtime.json'
if (-not (Test-Path -LiteralPath $platformRuntimeFile)) {
    Write-Output 'No managed background instance is recorded.'
    exit 0
}
$platformRuntime = Get-Content -LiteralPath $platformRuntimeFile -Raw | ConvertFrom-Json
$platformProcess = Get-Process -Id $platformRuntime.pid -ErrorAction SilentlyContinue
if (-not $platformProcess) {
    Write-Output 'Platform is already stopped.'
    exit 0
}
$platformExpectedStart = if ($platformRuntime.started -is [DateTime]) {
    $platformRuntime.started.ToUniversalTime()
} else {
    [DateTimeOffset]::Parse($platformRuntime.started).UtcDateTime
}
$platformActualStart = $platformProcess.StartTime.ToUniversalTime()
if ([Math]::Abs(($platformActualStart - $platformExpectedStart).TotalSeconds) -gt 1 -or $platformProcess.ProcessName -notlike 'python*') {
    throw 'Process identity does not match the platform record. Nothing was stopped.'
}
Stop-Process -Id $platformProcess.Id -ErrorAction Stop
Write-Output 'RideChoice stopped. All saved data remain in place.'
