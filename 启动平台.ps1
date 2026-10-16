param([switch]$LAN, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$platformPython = Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $platformPython) {
    throw 'Python 3.10 or newer is required.'
}
$platformBind = if ($LAN) { '0.0.0.0' } else { '127.0.0.1' }
$platformUrl = 'http://127.0.0.1:8896/admin'
$platformHealth = $null
try {
    $platformHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8896/api/health' -TimeoutSec 2
} catch { }
if ($platformHealth -and $platformHealth.ok -and $platformHealth.app -eq 'RideChoice') {
    if ($LAN -and $platformHealth.host -ne '0.0.0.0') {
        throw 'A local-only instance is running. Stop it before enabling LAN access.'
    }
    if (-not $NoBrowser) { Start-Process $platformUrl }
    Write-Output ('Ready: ' + $platformUrl)
    exit 0
}
if ($LAN) {
    Write-Host 'LAN participant URLs (researcher workspace stays local-only):'
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } |
        ForEach-Object { Write-Host ('http://' + $_.IPAddress + ':8896/p/YOUR_EXPERIMENT_CODE') }
}
$platformLogDir = Join-Path $PSScriptRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $platformLogDir | Out-Null
$platformLogStamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
$platformOutLog = Join-Path $platformLogDir ($platformLogStamp + '.out.log')
$platformErrLog = Join-Path $platformLogDir ($platformLogStamp + '.err.log')
$platformServerFile = Join-Path $PSScriptRoot 'server.py'
$platformArgs = @('-u', ('"' + $platformServerFile + '"'), '--host', $platformBind, '--port', '8896')
$env:RIDECHOICE_DATA = Join-Path $PSScriptRoot 'data'
$platformProcess = Start-Process -FilePath $platformPython.Source -ArgumentList $platformArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $platformOutLog -RedirectStandardError $platformErrLog -PassThru
$platformClock = [System.Diagnostics.Stopwatch]::StartNew()
while ($platformClock.Elapsed.TotalSeconds -lt 15) {
    $platformProcess.Refresh()
    if ($platformProcess.HasExited) {
        $platformFailure = Get-Content -LiteralPath $platformErrLog -Raw -ErrorAction SilentlyContinue
        throw ('Startup failed. Log: ' + $platformErrLog + [Environment]::NewLine + $platformFailure)
    }
    try {
        $platformHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8896/api/health' -TimeoutSec 1
        if ($platformHealth.ok -and $platformHealth.app -eq 'RideChoice') {
            [pscustomobject]@{pid=$platformProcess.Id; started=$platformProcess.StartTime.ToUniversalTime().ToString('o'); port=8896; host=$platformBind} |
                ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'data\runtime.json') -Encoding utf8
            if (-not $NoBrowser) { Start-Process $platformUrl }
            Write-Output ('Ready: ' + $platformUrl)
            Write-Output ('Running in background. PID: ' + $platformProcess.Id)
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 250
}
throw ('Startup timed out. Check log: ' + $platformErrLog)
