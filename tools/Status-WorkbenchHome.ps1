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

function Test-Pac {
    $pacName = Split-Path -Leaf $cfg.PacPath
    $url = 'http://127.0.0.1:{0}/{1}' -f $cfg.PacPort, $pacName
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
        $needle = 'SOCKS5 127.0.0.1:{0}' -f $cfg.LocalSocksPort
        return ($r.StatusCode -eq 200 -and $r.Content.Contains($needle))
    } catch { return $false }
}

$checks = New-Object System.Collections.Generic.List[object]
function Add-Check([string]$Name, [bool]$Ok, [string]$Detail) {
    $checks.Add([pscustomobject]@{ Component = $Name; OK = $Ok; Detail = $Detail })
}

$wg = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
$wgOk = (-not $wg) -or $wg.Status -ne 'Running'
Add-Check 'Legacy WireGuard OFF' $wgOk $(if ($wg) { [string]$wg.Status } else { 'not installed' })

$tun = Get-NetAdapter -Name $cfg.SingBoxTunName -ErrorAction SilentlyContinue
$tunOk = $tun -and $tun.Status -eq 'Up'
Add-Check 'SIP TUN' ([bool]$tunOk) $(if ($tun) { [string]$tun.Status } else { 'missing' })

$pacPid = Get-ListeningPid $cfg.PacPort
$pacOk = $pacPid -and (Test-Pac)
Add-Check 'PAC :8765' ([bool]$pacOk) $(if ($pacPid) { 'PID ' + $pacPid } else { 'not listening' })

$socksPid = Get-ListeningPid $cfg.LocalSocksPort
Add-Check 'SOCKS :25344' ([bool]$socksPid) $(if ($socksPid) { 'PID ' + $socksPid } else { 'not listening' })

$asrPid = Get-ListeningPid $cfg.LocalAsrPort
Add-Check 'ASR tunnel :8090' ([bool]$asrPid) $(if ($asrPid) { 'PID ' + $asrPid } else { 'not listening' })

$asrOk = $false
$asrDetail = 'unreachable'
try {
    $health = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3
    $asrOk = [bool]$health.ok
    if ($asrOk) { $asrDetail = ('{0} / {1}' -f $health.model, $health.gpu) }
} catch { $asrDetail = $_.Exception.Message }
Add-Check 'Whisper /health' $asrOk $asrDetail

$curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
$simnetOk = $false
$pbxOk = $false
if ($curl -and $socksPid) {
    & $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -fsS --max-time 6 -o NUL $cfg.SimnetProbeUrl 2>$null
    $simnetOk = ($LASTEXITCODE -eq 0)
    & $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -fsSI --max-time 6 -o NUL $cfg.PbxProbeUrl 2>$null
    $pbxOk = ($LASTEXITCODE -eq 0)
}
Add-Check 'SIMNET via Vast' $simnetOk $(if ($simnetOk) { 'OK' } else { 'FAILED' })
Add-Check 'PBX via Vast' $pbxOk $(if ($pbxOk) { 'OK' } else { 'FAILED' })

$chrome = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($cfg.ChromeUserDataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1
Add-Check 'Workbench Chrome' ([bool]$chrome) $(if ($chrome) { 'PID ' + $chrome.ProcessId } else { 'not running' })

$checks | Format-Table -AutoSize
$ready = -not ($checks | Where-Object { -not $_.OK })
Write-Host ''
if ($ready) {
    Write-Host '=== WORKBENCH HOME: READY ===' -ForegroundColor Green
    exit 0
}
Write-Host '=== WORKBENCH HOME: NOT READY ===' -ForegroundColor Red
exit 1
