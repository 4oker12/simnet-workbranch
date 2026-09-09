[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
. (Join-Path $ScriptDir 'workbench-home.config.ps1')
$cfg = $WorkbenchHomeConfig

function Get-CommandLine([int]$Pid) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$Pid" -ErrorAction SilentlyContinue
    if ($null -eq $p) { return '' }
    return [string]$p.CommandLine
}

$mode = $null
$state = $null
if (Test-Path $cfg.UnifiedStateFile) {
    try { $state = Get-Content -Raw -Path $cfg.UnifiedStateFile | ConvertFrom-Json; $mode = [string]$state.mode } catch {}
}

if ($mode -eq 'HOME') {
    & (Join-Path $ScriptDir 'Stop-WorkbenchHome.ps1')
    $rc = $LASTEXITCODE
    if ($state) {
        $state.ready = $false
        $state | Add-Member -NotePropertyName stoppedAt -NotePropertyValue (Get-Date).ToString('o') -Force
        $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
    }
    exit $rc
}

Write-Host 'Stopping Workbench runtime...'
if ($state -and $state.sshPid) {
    $pid = [int]$state.sshPid
    $line = Get-CommandLine $pid
    $expectedForward = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort
    if ($line -and $line.IndexOf($cfg.VastHost,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $line.IndexOf($expectedForward,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        Write-Host ('  WORK ASR tunnel: stopped PID {0}' -f $pid)
    } elseif ($line) {
        Write-Host ('  PID {0} no longer matches expected tunnel; left running' -f $pid)
    } else {
        Write-Host '  WORK ASR tunnel: already stopped'
    }
} else {
    Write-Host '  No WORK tunnel recorded.'
}

if ($state) {
    $state.ready = $false
    $state | Add-Member -NotePropertyName stoppedAt -NotePropertyValue (Get-Date).ToString('o') -Force
    $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
}
Write-Host 'Vast services: untouched.'
Write-Host '=== WORKBENCH: STOPPED ===' -ForegroundColor Yellow
