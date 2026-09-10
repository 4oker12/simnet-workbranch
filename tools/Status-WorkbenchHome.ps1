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

function Get-PacUri {
    $path = [IO.Path]::GetFullPath($cfg.PacPath)
    return 'file:///' + $path.Replace('\','/')
}

function Test-PacFile {
    if (-not (Test-Path $cfg.PacPath)) { return $false }
    try {
        $content = Get-Content -Raw -Path $cfg.PacPath
        $proxyNeedle = 'SOCKS5 127.0.0.1:{0}' -f $cfg.LocalSocksPort
        $directNeedle = 'return "DIRECT";'
        return ($content.Contains($proxyNeedle) -and $content.Contains($directNeedle))
    } catch { return $false }
}

function Test-SocksHttp([string]$Url) {
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if (-not $curl) { return @{ Ok=$false; Detail='curl missing' } }
    try {
        $code = (& $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -sS --connect-timeout 4 --max-time 7 -o NUL -w '%{http_code}' $Url 2>$null | Select-Object -Last 1)
        $exitCode = $LASTEXITCODE
        $code = [string]$code
        $ok = ($exitCode -eq 0 -and $code -match '^[23]\d\d$')
        return @{ Ok=$ok; Detail=('HTTP ' + $code) }
    } catch {
        return @{ Ok=$false; Detail=$_.Exception.Message }
    }
}

$checks = New-Object System.Collections.Generic.List[object]
function Add-Check([string]$Name, [bool]$Ok, [bool]$Required, [string]$Detail) {
    $checks.Add([pscustomobject]@{
        Component = $Name
        OK = $Ok
        Required = $Required
        Detail = $Detail
    })
}

$wg = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
$wgOk = (-not $wg) -or $wg.Status -ne 'Running'
Add-Check 'Legacy WireGuard OFF' $wgOk $true $(if ($wg) { [string]$wg.Status } else { 'not installed' })

$pacUri = Get-PacUri
$pacOk = Test-PacFile
Add-Check 'PAC file split route' $pacOk $true $(if ($pacOk) { $pacUri } else { 'missing/invalid' })

$socksPid = Get-ListeningPid $cfg.LocalSocksPort
Add-Check 'SOCKS :25344' ([bool]$socksPid) $true $(if ($socksPid) { 'PID ' + $socksPid } else { 'not listening' })

$asrPid = Get-ListeningPid $cfg.LocalAsrPort
Add-Check 'ASR tunnel :8090' ([bool]$asrPid) $true $(if ($asrPid) { 'PID ' + $asrPid } else { 'not listening' })

$ssPid = Get-ListeningPid $cfg.LocalShadowsocksPort
Add-Check 'SS bridge :10200' ([bool]$ssPid) $false $(if ($ssPid) { 'PID ' + $ssPid } else { 'not listening' })

$sameTunnel = $socksPid -and $asrPid -and $socksPid -eq $asrPid
Add-Check 'Browser+ASR one SSH' ([bool]$sameTunnel) $true $(if ($sameTunnel) { 'PID ' + $socksPid } else { 'ports are not on one SSH process' })

$pbx = if ($socksPid) { Test-SocksHttp $cfg.PbxProbeUrl } else { @{ Ok=$false; Detail='SOCKS unavailable' } }
Add-Check 'PBX via Vast' ([bool]$pbx.Ok) $true $pbx.Detail

$asrOk = $false
$asrDetail = 'unreachable'
try {
    $health = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3
    $asrOk = [bool]$health.ok
    if ($asrOk) { $asrDetail = ('{0} / {1}' -f $health.model,$health.gpu) }
} catch { $asrDetail = $_.Exception.Message }
Add-Check 'Whisper /health' $asrOk $true $asrDetail

$groqOk = $false
$groqDetail = 'unreachable'
$curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
if ($curl) {
    $groqStatus = (& $curl.Source --noproxy '*' -sS --max-time 6 -o NUL -w '%{http_code}' $cfg.GroqProbeUrl 2>$null | Select-Object -Last 1)
    $groqExit = $LASTEXITCODE
    $groqStatus = [string]$groqStatus
    $groqOk = ($groqExit -eq 0 -and $groqStatus -match '^[234]\d\d$')
    $groqDetail = if ($groqOk) { 'HTTP ' + $groqStatus + ' DIRECT' } else { 'FAILED / HTTP ' + $groqStatus }
}
Add-Check 'Groq DIRECT' $groqOk $true $groqDetail

$chrome = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine.IndexOf($cfg.ChromeUserDataDir,[StringComparison]::OrdinalIgnoreCase) -ge 0
    } |
    Select-Object -First 1
$chromeOk = [bool]$chrome
Add-Check 'HOME Chrome profile' $chromeOk $true $(if ($chrome) { 'PID ' + $chrome.ProcessId } else { 'not running' })

$chromeRouteOk = $false
$chromeRouteDetail = 'Chrome not running'
if ($chrome) {
    $line = [string]$chrome.CommandLine
    $usesExpectedPac = $line.IndexOf($pacUri,[StringComparison]::OrdinalIgnoreCase) -ge 0
    $usesGlobalProxy = $line.IndexOf('--proxy-server',[StringComparison]::OrdinalIgnoreCase) -ge 0
    $chromeRouteOk = $usesExpectedPac -and -not $usesGlobalProxy
    $chromeRouteDetail = if ($chromeRouteOk) {
        'SIMNET=SOCKS / external=DIRECT'
    } elseif ($usesGlobalProxy) {
        'GLOBAL PROXY detected'
    } else {
        'file PAC flag missing'
    }
}
Add-Check 'Chrome split route' $chromeRouteOk $true $chromeRouteDetail

$tun = Get-NetAdapter -Name $cfg.SingBoxTunName -ErrorAction SilentlyContinue
$tunOk = $tun -and $tun.Status -eq 'Up'
Add-Check 'SIP TUN (optional)' ([bool]$tunOk) $false $(if ($tun) { [string]$tun.Status } else { 'not running' })

$checks | Format-Table -AutoSize
$requiredFailed = $checks | Where-Object { $_.Required -and -not $_.OK }

Write-Host ''
if (-not $requiredFailed) {
    Write-Host '=== WORKBENCH HOME: READY ===' -ForegroundColor Green
    if (-not $tunOk) {
        Write-Host 'SIP/TUN is optional and currently unavailable; browser/PBX remains ready.' -ForegroundColor Yellow
    }
    exit 0
}

Write-Host '=== WORKBENCH HOME: NOT READY ===' -ForegroundColor Red
exit 1
