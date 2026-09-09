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

function Resolve-SshIdentityArgs {
    $candidate = Join-Path $HOME '.ssh\id_ed25519_simnet_autostart'
    if (Test-Path $candidate) { return @('-i', $candidate) }
    return @()
}

function Stop-RemoteManagedServices {
    $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    if (-not (Test-Path $ssh)) {
        Write-Host '  Vast services: ssh.exe missing, could not stop remote services'
        return
    }
    $remote = @'
set +e
supervisorctl stop simnet-transcriber >/dev/null 2>&1
PIDS="$(pgrep -f '^/workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json$' 2>/dev/null)"
if [ -n "$PIDS" ]; then kill $PIDS 2>/dev/null; fi
sleep 1
echo -n '  transcriber: '
supervisorctl status simnet-transcriber 2>/dev/null || echo STOPPED
echo -n '  sing-box: '
pgrep -af '^/workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json$' || echo STOPPED
'@
    $args = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=8')
    $args += Resolve-SshIdentityArgs
    $args += @('-p',[string]$cfg.VastSshPort,('{0}@{1}' -f $cfg.VastUser,$cfg.VastHost),$remote)
    & $ssh @args
    if ($LASTEXITCODE -ne 0) { Write-Host ('  Vast services: stop command failed (exit {0})' -f $LASTEXITCODE) }
}

$mode = $null
$state = $null
if (Test-Path $cfg.UnifiedStateFile) {
    try { $state = Get-Content -Raw -Path $cfg.UnifiedStateFile | ConvertFrom-Json; $mode = [string]$state.mode } catch {}
}

Write-Host '=== SIMNET WORKBENCH STOP ==='
Write-Host ('MODE       {0}' -f $(if ($mode) { $mode } else { 'UNKNOWN' }))

if ($mode -eq 'HOME') {
    & (Join-Path $ScriptDir 'Stop-WorkbenchHome.ps1')
    $localRc = $LASTEXITCODE
} else {
    $localRc = 0
    Write-Host 'Stopping local WORK runtime...'
    if ($state -and $state.sshPid) {
        $pid = [int]$state.sshPid
        $line = Get-CommandLine $pid
        $expectedForward = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort
        if ($line -and $line.IndexOf($cfg.VastHost,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $line.IndexOf($expectedForward,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Write-Host ('  ASR tunnel: stopped PID {0}' -f $pid)
        } elseif ($line) {
            Write-Host ('  PID {0} no longer matches expected tunnel; left running' -f $pid)
        } else {
            Write-Host '  ASR tunnel: already stopped'
        }
    } else {
        Write-Host '  ASR tunnel: no owned PID recorded'
    }
}

if ($state -and $state.PSObject.Properties['remoteManaged'] -and [bool]$state.remoteManaged) {
    Write-Host 'Stopping remote services started by Workbench...'
    Stop-RemoteManagedServices
} else {
    Write-Host 'Remote services: no managed runtime recorded; left untouched.'
}

if ($state) {
    $state.ready = $false
    $state | Add-Member -NotePropertyName stoppedAt -NotePropertyValue (Get-Date).ToString('o') -Force
    $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
}

Write-Host '=== WORKBENCH: STOPPED ===' -ForegroundColor Yellow
exit $localRc
