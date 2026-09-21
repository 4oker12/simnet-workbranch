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

function Get-ProcessCommandLine([int]$ProcessId) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $proc) { return '' }
    return [string]$proc.CommandLine
}

function Test-Http([string]$Url, [string[]]$ExtraArgs = @()) {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return @{ Ok=$false; Code='000'; Error='curl.exe not found' } }
    try {
        $args = @('-k','-sS','--connect-timeout','3','--max-time','7','-o','NUL','-w','%{http_code}') + $ExtraArgs + @($Url)
        $code = & $curl.Source @args 2>$null
        $exit = $LASTEXITCODE
        $text = [string]($code | Select-Object -Last 1)
        return @{ Ok=($exit -eq 0 -and $text -match '^[23]\d\d$'); Code=$text; Error='' }
    } catch {
        return @{ Ok=$false; Code='000'; Error=$_.Exception.Message }
    }
}

Write-Host '=== SIMNET WORKBENCH STABLE CHECK ==='
Write-Host ('VAST       {0}:{1}' -f $cfg.VastHost,$cfg.VastSshPort)
Write-Host ('ASR LOCAL  {0}' -f $cfg.AsrHealthUrl)

$asr = $null
try {
    $asr = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 5
} catch {}

if ($asr -and $asr.ok) {
    Write-Host ('ASR        OK  {0} / {1} / {2}' -f $asr.model,$asr.device,$asr.gpu) -ForegroundColor Green
} else {
    Write-Host 'ASR        FAIL' -ForegroundColor Red
}

$owner = Get-ListeningPid $cfg.LocalAsrPort
if ($owner) {
    $line = Get-ProcessCommandLine $owner
    $short = if ($line.Length -gt 220) { $line.Substring(0,220) + '…' } else { $line }
    Write-Host ('ASR PID    {0}' -f $owner)
    Write-Host ('ASR CMD    {0}' -f $short)

    $forwardA = ('-L {0}:{1}:{2}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort)
    $forwardB = ('-L 127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort)
    $hostOk = $line.IndexOf([string]$cfg.VastHost,[StringComparison]::OrdinalIgnoreCase) -ge 0
    $portOk = $line.IndexOf(('-p {0}' -f $cfg.VastSshPort),[StringComparison]::OrdinalIgnoreCase) -ge 0
    $forwardOk = $line.IndexOf($forwardA,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                 $line.IndexOf($forwardB,[StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($hostOk -and $portOk -and $forwardOk) {
        Write-Host 'ASR TUNNEL OK  expected Vast SSH forward' -ForegroundColor Green
    } else {
        Write-Host 'ASR TUNNEL WARN listener exists but command line differs from current Vast config' -ForegroundColor Yellow
    }
} else {
    Write-Host 'ASR PID    none' -ForegroundColor Yellow
}

$direct = Test-Http $cfg.PbxProbeUrl @('--noproxy','*')
if ($direct.Ok) {
    Write-Host ('MODE       WORK  PBX direct HTTP {0}' -f $direct.Code) -ForegroundColor Green
} else {
    $socks = Test-Http $cfg.PbxProbeUrl @('--socks5-hostname',('127.0.0.1:{0}' -f $cfg.LocalSocksPort))
    if ($socks.Ok) {
        Write-Host ('MODE       HOME  PBX via SOCKS HTTP {0}' -f $socks.Code) -ForegroundColor Green
    } else {
        Write-Host ('MODE       UNKNOWN  PBX direct={0}, SOCKS={1}' -f $direct.Code,$socks.Code) -ForegroundColor Red
    }
}

if ($asr -and $asr.ok) {
    Write-Host 'RESULT     ASR_READY' -ForegroundColor Green
    exit 0
}

Write-Host 'RESULT     NOT_READY' -ForegroundColor Red
exit 1
