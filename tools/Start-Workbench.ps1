[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
. (Join-Path $ScriptDir 'workbench-home.config.ps1')
$cfg = $WorkbenchHomeConfig
New-Item -ItemType Directory -Force -Path $cfg.RuntimeDir | Out-Null

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-DirectSimnet {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return $false }
    try {
        $code = & $curl.Source -k -sS --connect-timeout 3 --max-time 5 -o NUL -w '%{http_code}' $cfg.SimnetProbeUrl
        return ($LASTEXITCODE -eq 0 -and [int]$code -ge 200 -and [int]$code -lt 400)
    } catch { return $false }
}

function Get-ListeningPid([int]$Port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $conn) { return $null }
    return [int]$conn.OwningProcess
}

function Get-ProcessCommandLine([int]$Pid) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$Pid" -ErrorAction SilentlyContinue
    if ($null -eq $proc) { return '' }
    return [string]$proc.CommandLine
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$FailureMessage) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw $FailureMessage
}

function Resolve-SshIdentityArgs {
    $candidate = Join-Path $HOME '.ssh\id_ed25519_simnet_autostart'
    if (Test-Path $candidate) { return @('-i', $candidate) }
    return @()
}

function Invoke-Vast([string]$RemoteCommand) {
    $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    if (-not (Test-Path $ssh)) { throw "ssh.exe not found: $ssh" }
    $args = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=10')
    $args += Resolve-SshIdentityArgs
    $args += @('-p', [string]$cfg.VastSshPort, ('{0}@{1}' -f $cfg.VastUser,$cfg.VastHost), $RemoteCommand)
    & $ssh @args
    if ($LASTEXITCODE -ne 0) { throw "Vast command failed with exit code $LASTEXITCODE" }
}

function Ensure-Remote([string]$Mode) {
    $remote = @'
set -e
if [ ! -d /workspace/simnet-transcriber ]; then
  echo 'REMOTE_NOT_BOOTSTRAPPED: /workspace/simnet-transcriber missing' >&2
  exit 41
fi
cd /workspace/simnet-transcriber
if [ -x ./start.sh ]; then
  ./start.sh
else
  echo 'REMOTE_NOT_BOOTSTRAPPED: start.sh missing' >&2
  exit 42
fi
'@
    if ($Mode -eq 'HOME') {
        $remote += @'

if [ ! -x /workspace/sing-box-test/sing-box ] || [ ! -f /workspace/sing-box-test/server-unified.json ]; then
  echo 'REMOTE_NOT_BOOTSTRAPPED: sing-box server missing' >&2
  exit 43
fi
if ! pgrep -af '/workspace/sing-box-test/sing-box run' >/dev/null 2>&1; then
  nohup /workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json >/workspace/sing-box-test/sing-box.log 2>&1 &
  sleep 2
fi
ss -lntup | grep -E ':25344|:10200' >/dev/null
'@
    }
    Invoke-Vast $remote
}

function Start-WorkTunnel {
    $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    $owner = Get-ListeningPid $cfg.LocalAsrPort
    if ($owner) {
        $line = Get-ProcessCommandLine $owner
        $expectedHost = [string]$cfg.VastHost
        $expectedForward = ('127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort)
        if ($line.IndexOf($expectedHost,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $line.IndexOf($expectedForward,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return [int]$owner
        }
        throw "Local port $($cfg.LocalAsrPort) is occupied by PID $owner, not the expected Vast tunnel."
    }

    $out = Join-Path $cfg.RuntimeDir 'work-ssh.out.log'
    $err = Join-Path $cfg.RuntimeDir 'work-ssh.err.log'
    Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
    $argList = @('-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3')
    $argList += Resolve-SshIdentityArgs
    $argList += @('-L',('127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort),'-p',[string]$cfg.VastSshPort,('{0}@{1}' -f $cfg.VastUser,$cfg.VastHost))
    $p = Start-Process -FilePath $ssh -ArgumentList $argList -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    Wait-Until { (Get-ListeningPid $cfg.LocalAsrPort) -eq $p.Id } $cfg.StartTimeoutSeconds "ASR forward localhost:$($cfg.LocalAsrPort) did not start."
    return [int]$p.Id
}

$mode = if (Test-DirectSimnet) { 'WORK' } else { 'HOME' }
Write-Host "=== SIMNET WORKBENCH START ==="
Write-Host "MODE       $mode"
Write-Host "VAST       $($cfg.VastHost):$($cfg.VastSshPort)"

if ($mode -eq 'HOME' -and -not (Test-IsAdministrator)) {
    $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args | Out-Null
    exit 0
}

try {
    Write-Host '[1/3] Remote services'
    Ensure-Remote $mode
    Write-Host '  remote: OK'

    if ($mode -eq 'HOME') {
        Write-Host '[2/3] HOME transport'
        & (Join-Path $ScriptDir 'Start-WorkbenchHome.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'HOME launcher failed.' }
        $state = [ordered]@{ version=1; mode='HOME'; startedAt=(Get-Date).ToString('o'); ready=$true; sshPid=$null }
    } else {
        Write-Host '[2/3] WORK ASR tunnel'
        $pid = Start-WorkTunnel
        $health = $null
        Wait-Until { try { $script:health = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3; [bool]$script:health.ok } catch { $false } } $cfg.StartTimeoutSeconds 'Whisper health failed through localhost:8090.'
        Write-Host ("  ASR: OK {0} / {1}" -f $script:health.model,$script:health.gpu)
        $state = [ordered]@{ version=1; mode='WORK'; startedAt=(Get-Date).ToString('o'); ready=$true; sshPid=$pid }
    }

    Write-Host '[3/3] Save state'
    $state.vastHost = $cfg.VastHost
    $state.vastSshPort = $cfg.VastSshPort
    $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
    Write-Host ''
    Write-Host ("{0}_READY" -f $mode)
} catch {
    $failed = [ordered]@{ version=1; mode=$mode; startedAt=(Get-Date).ToString('o'); ready=$false; vastHost=$cfg.VastHost; vastSshPort=$cfg.VastSshPort; error=$_.Exception.Message }
    $failed | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
    Write-Error $_
    exit 1
}
