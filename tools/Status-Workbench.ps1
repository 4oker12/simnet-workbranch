[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
. (Join-Path $ScriptDir 'workbench-home.config.ps1')
$cfg = $WorkbenchHomeConfig

function Get-ListeningPid([int]$Port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $conn) { return $null }
    return [int]$conn.OwningProcess
}

function Test-DirectUrl([string]$Url) {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return @{ Ok=$false; Detail='curl missing' } }
    try {
        $code = & $curl.Source -k -sS --connect-timeout 3 --max-time 5 -o NUL -w '%{http_code}' $Url
        $ok = ($LASTEXITCODE -eq 0 -and [int]$code -ge 200 -and [int]$code -lt 400)
        return @{ Ok=$ok; Detail=('HTTP ' + [string]$code) }
    } catch { return @{ Ok=$false; Detail=$_.Exception.Message } }
}

$mode = $null
if (Test-Path $cfg.UnifiedStateFile) {
    try { $state = Get-Content -Raw -Path $cfg.UnifiedStateFile | ConvertFrom-Json; $mode = [string]$state.mode } catch {}
}
if (-not $mode) {
    $direct = Test-DirectUrl $cfg.SimnetProbeUrl
    $mode = if ($direct.Ok) { 'WORK' } else { 'HOME' }
}

Write-Host '=== SIMNET WORKBENCH STATUS ==='
Write-Host ('MODE       {0}' -f $mode)
Write-Host ('VAST       {0}:{1}' -f $cfg.VastHost,$cfg.VastSshPort)

if ($mode -eq 'HOME') {
    & (Join-Path $ScriptDir 'Status-WorkbenchHome.ps1')
    exit $LASTEXITCODE
}

$failed = $false
$asrPid = Get-ListeningPid $cfg.LocalAsrPort
if ($asrPid) { Write-Host ('WHISPER    tunnel PID {0}' -f $asrPid) } else { Write-Host 'WHISPER    tunnel OFF'; $failed = $true }

try {
    $health = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3
    if ($health.ok) { Write-Host ('ASR        OK {0} / {1}' -f $health.model,$health.gpu) } else { Write-Host 'ASR        NOT OK'; $failed = $true }
} catch { Write-Host ('ASR        FAILED ' + $_.Exception.Message); $failed = $true }

$billing = Test-DirectUrl 'https://admin.simnet.kiev.ua/'
$userside = Test-DirectUrl 'https://userside.simnet.kiev.ua/'
$pbx = Test-DirectUrl 'https://pbx.simnet.kiev.ua/'
Write-Host ('BILLING    {0} DIRECT' -f $(if ($billing.Ok) { $billing.Detail } else { 'FAILED' }))
Write-Host ('USERSIDE   {0} DIRECT' -f $(if ($userside.Ok) { $userside.Detail } else { 'FAILED' }))
Write-Host ('PBX        {0} DIRECT' -f $(if ($pbx.Ok) { $pbx.Detail } else { 'FAILED' }))
if (-not $billing.Ok -or -not $userside.Ok -or -not $pbx.Ok) { $failed = $true }

Write-Host 'SOCKS      NOT NEEDED'
Write-Host ''
if ($failed) { Write-Host '=== WORK_READY: NO ===' -ForegroundColor Red; exit 1 }
Write-Host '=== WORK_READY ===' -ForegroundColor Green
