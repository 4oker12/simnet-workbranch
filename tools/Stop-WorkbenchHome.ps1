[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
. (Join-Path $ScriptDir 'workbench-home.config.ps1')
$cfg = $WorkbenchHomeConfig

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $args | Out-Null
    exit 0
}

if (-not (Test-Path $cfg.StateFile)) {
    Write-Host 'WORKBENCH HOME: no runtime state; nothing to stop.'
    exit 0
}

try { $state = Get-Content -Raw -Path $cfg.StateFile | ConvertFrom-Json } catch { throw 'Runtime state is unreadable.' }

function Get-CommandLine([int]$ProcessId) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $proc) { return '' }
    return [string]$proc.CommandLine
}

function Stop-IfOwnedAndMatches([string]$Label, $PidValue, $OwnedValue, [string[]]$Needles) {
    if (-not [bool]$OwnedValue -or $null -eq $PidValue) {
        Write-Host ('  {0}: not owned by launcher, leave running' -f $Label)
        return
    }
    $processId = [int]$PidValue
    $line = Get-CommandLine $processId
    if (-not $line) {
        Write-Host ('  {0}: already stopped' -f $Label)
        return
    }
    foreach ($needle in $Needles) {
        if ($line.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            Write-Host ('  {0}: PID {1} no longer matches; NOT stopping it' -f $Label, $processId)
            return
        }
    }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Host ('  {0}: stopped PID {1}' -f $Label, $processId)
}

Write-Host 'Stopping only Workbench-owned HOME processes...'

if ([bool]$state.chromeOwned) {
    $chromeProcesses = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue
    $stoppedChrome = 0
    foreach ($proc in $chromeProcesses) {
        $line = [string]$proc.CommandLine
        if ($line -and $line.IndexOf($cfg.ChromeUserDataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Stop-Process -Id ([int]$proc.ProcessId) -Force -ErrorAction SilentlyContinue
            $stoppedChrome++
        }
    }
    Write-Host ('  Chrome profile: stopped {0} process(es)' -f $stoppedChrome)
} else {
    Write-Host '  Chrome profile: not owned by launcher, leave running'
}

$asrSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort, $cfg.RemoteAsrHost, $cfg.RemoteAsrPort
$socksSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalSocksPort, $cfg.RemoteSocksHost, $cfg.RemoteSocksPort
$ssSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalShadowsocksPort, $cfg.RemoteShadowsocksHost, $cfg.RemoteShadowsocksPort
Stop-IfOwnedAndMatches 'SSH' $state.sshPid $state.sshOwned @($cfg.VastHost, $asrSpec, $socksSpec, $ssSpec)
Stop-IfOwnedAndMatches 'PAC' $state.pacPid $state.pacOwned @('http.server', [string]$cfg.PacPort)
Stop-IfOwnedAndMatches 'sing-box' $state.singBoxPid $state.singBoxOwned @($cfg.RuntimeSingBoxClientConfig)

$state.ready = $false
$state | Add-Member -NotePropertyName stoppedAt -NotePropertyValue (Get-Date).ToString('o') -Force
$state | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -Path $cfg.StateFile

Write-Host 'Legacy HOME WireGuard: left OFF.'
Write-Host 'Vast: untouched.'
Write-Host '=== WORKBENCH HOME: STOPPED ===' -ForegroundColor Yellow
