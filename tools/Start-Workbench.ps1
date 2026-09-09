[CmdletBinding()]
param(
    [switch]$Elevated
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
. (Join-Path $ScriptDir 'workbench-home.config.ps1')
$cfg = $WorkbenchHomeConfig
New-Item -ItemType Directory -Force -Path $cfg.RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $cfg.PrivateDir | Out-Null

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-DirectSimnet {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return $false }
    try {
        $code = & $curl.Source --noproxy '*' -k -sS --connect-timeout 3 --max-time 5 -o NUL -w '%{http_code}' $cfg.SimnetProbeUrl
        return ($LASTEXITCODE -eq 0 -and [int]$code -ge 200 -and [int]$code -lt 400)
    } catch { return $false }
}

function Test-HomeTransportActive {
    try {
        $wg = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
        if ($wg -and $wg.Status -eq 'Running') { return $true }
    } catch {}
    try {
        $wgAny = Get-Service -Name 'WireGuardTunnel$*' -ErrorAction SilentlyContinue |
            Where-Object { $_.Status -eq 'Running' } |
            Select-Object -First 1
        if ($wgAny) { return $true }
    } catch {}
    try {
        $tun = Get-NetAdapter -Name $cfg.SingBoxTunName -ErrorAction SilentlyContinue
        if ($tun -and $tun.Status -eq 'Up') { return $true }
    } catch {}
    return $false
}

function Resolve-Mode {
    if (Test-HomeTransportActive) { return 'HOME' }
    if (Test-DirectSimnet) { return 'WORK' }
    return 'HOME'
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
    $standard = Join-Path $HOME '.ssh\id_ed25519'
    if (Test-Path $standard) { return @('-i', $standard, '-o', 'IdentitiesOnly=yes') }
    $legacy = Join-Path $HOME '.ssh\id_ed25519_simnet_autostart'
    if (Test-Path $legacy) { return @('-i', $legacy, '-o', 'IdentitiesOnly=yes') }
    return @()
}

function Get-SshBaseArgs {
    $args = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=10','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3')
    $args += Resolve-SshIdentityArgs
    return $args
}

function Invoke-Vast([string]$RemoteCommand) {
    $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    if (-not (Test-Path $ssh)) { throw "ssh.exe not found: $ssh" }
    # PowerShell here-strings on Windows can carry CRLF. bash interprets the CR in
    # `set -euo pipefail` as part of the option name, so always send LF-only text.
    $RemoteCommand = $RemoteCommand.Replace("`r`n", "`n").Replace("`r", '')
    $args = Get-SshBaseArgs
    $args += @('-p', [string]$cfg.VastSshPort, ('{0}@{1}' -f $cfg.VastUser,$cfg.VastHost), $RemoteCommand)
    & $ssh @args
    if ($LASTEXITCODE -ne 0) { throw "Vast command failed with exit code $LASTEXITCODE" }
}

function Sync-PrivateHomeConfig {
    $scp = Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe'
    if (-not (Test-Path $scp)) { throw "scp.exe not found: $scp" }
    Invoke-Vast 'mkdir -p /workspace/sing-box-test'

    $base = @('-q','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=10')
    $base += Resolve-SshIdentityArgs
    $base += @('-P',[string]$cfg.VastSshPort)
    $remote = ('{0}@{1}:/workspace/sing-box-test/server-unified.json' -f $cfg.VastUser,$cfg.VastHost)

    if (Test-Path $cfg.PrivateSingBoxServerConfig) {
        & $scp @base $cfg.PrivateSingBoxServerConfig $remote
        if ($LASTEXITCODE -ne 0) { throw 'Failed to upload private HOME sing-box config to Vast.' }
        Write-Host '  private HOME config: restored from local backup'
        return
    }

    & $scp @base $remote $cfg.PrivateSingBoxServerConfig
    if ($LASTEXITCODE -eq 0 -and (Test-Path $cfg.PrivateSingBoxServerConfig)) {
        Write-Host ('  private HOME config: backed up to {0}' -f $cfg.PrivateSingBoxServerConfig)
        return
    }

    Remove-Item $cfg.PrivateSingBoxServerConfig -Force -ErrorAction SilentlyContinue
    throw ('Private HOME config is missing both locally and on Vast. Restore it once at: {0}' -f $cfg.PrivateSingBoxServerConfig)
}

function Ensure-RemoteBase {
    $remote = @'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y git
fi
if [ ! -d /workspace/simnet-transcriber/.git ]; then
  rm -rf /workspace/simnet-transcriber
  git clone https://github.com/4oker12/simnet-transcripter.git /workspace/simnet-transcriber
else
  git -C /workspace/simnet-transcriber fetch origin main
  git -C /workspace/simnet-transcriber checkout -f main
  git -C /workspace/simnet-transcriber reset --hard origin/main
  git -C /workspace/simnet-transcriber pull --ff-only origin main
fi
cd /workspace/simnet-transcriber
chmod +x bootstrap-vast.sh start.sh status.sh restart.sh simnet-transcriber-supervisor.sh
./bootstrap-vast.sh
'@
    Invoke-Vast $remote
}

function Ensure-RemoteHomeTransport {
    $remote = @'
set -euo pipefail
mkdir -p /workspace/sing-box-test
if [ ! -x /workspace/sing-box-test/sing-box ]; then
  command -v curl >/dev/null 2>&1 || { apt-get update -y && apt-get install -y curl; }
  command -v jq >/dev/null 2>&1 || { apt-get update -y && apt-get install -y jq; }
  command -v tar >/dev/null 2>&1 || { apt-get update -y && apt-get install -y tar; }
  URL="$(curl -fsSL https://api.github.com/repos/SagerNet/sing-box/releases/latest | jq -r '.assets[].browser_download_url | select(test("linux-amd64\\.tar\\.gz$"))' | head -n 1)"
  [ -n "$URL" ] || { echo 'Unable to resolve latest sing-box linux-amd64 asset' >&2; exit 42; }
  rm -rf /tmp/simnet-sing-box /tmp/simnet-sing-box.tgz
  mkdir -p /tmp/simnet-sing-box
  curl -fL "$URL" -o /tmp/simnet-sing-box.tgz
  tar -xzf /tmp/simnet-sing-box.tgz -C /tmp/simnet-sing-box
  BIN="$(find /tmp/simnet-sing-box -type f -name sing-box | head -n 1)"
  [ -n "$BIN" ] || { echo 'sing-box binary not found in release archive' >&2; exit 42; }
  install -m 0755 "$BIN" /workspace/sing-box-test/sing-box
fi
[ -f /workspace/sing-box-test/server-unified.json ] || { echo 'REMOTE_HOME_NOT_READY: server-unified.json missing' >&2; exit 44; }
PIDS="$(pgrep -f '^/workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json$' 2>/dev/null || true)"
if [ -z "$PIDS" ]; then
  nohup /workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json >/workspace/sing-box-test/sing-box.log 2>&1 &
  sleep 2
fi
ss -lntup | grep -E ':25344|:10200' >/dev/null || {
  echo 'REMOTE_HOME_NOT_READY: sing-box ports 25344/10200 are not listening' >&2
  tail -n 50 /workspace/sing-box-test/sing-box.log 2>/dev/null || true
  exit 45
}
'@
    Invoke-Vast $remote
}

function Start-WorkTunnel {
    $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    if (-not (Test-Path $ssh)) { throw "ssh.exe not found: $ssh" }
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

$mode = Resolve-Mode
Write-Host '=== SIMNET WORKBENCH START ==='
Write-Host ("MODE       {0}" -f $mode)
Write-Host ("VAST       {0}:{1}" -f $cfg.VastHost,$cfg.VastSshPort)

if ($mode -eq 'HOME' -and -not (Test-IsAdministrator)) {
    if ($Elevated) { throw 'HOME mode requires Administrator privileges, but elevation failed.' }
    Write-Host 'HOME requires Administrator privileges. Requesting UAC...'
    $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Elevated' -f $PSCommandPath
    $child = Start-Process powershell.exe -Verb RunAs -ArgumentList $args -Wait -PassThru
    if ($child.ExitCode -ne 0 -and (Test-Path $cfg.UnifiedStateFile)) {
        try {
            $failedState = Get-Content -Raw -Path $cfg.UnifiedStateFile | ConvertFrom-Json
            if ($failedState.error) { Write-Host ('ERROR      ' + [string]$failedState.error) -ForegroundColor Red }
        } catch {}
    }
    exit $child.ExitCode
}

try {
    Write-Host '[1/4] Vast transcriber / bootstrap'
    Ensure-RemoteBase
    Write-Host '  transcriber: OK'

    if ($mode -eq 'HOME') {
        Write-Host '[2/4] HOME private config / sing-box'
        Sync-PrivateHomeConfig
        Ensure-RemoteHomeTransport
        Write-Host '  Vast HOME transport: OK'

        Write-Host '[3/4] Local HOME transport'
        & (Join-Path $ScriptDir 'Start-WorkbenchHome.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'HOME launcher failed.' }
        $state = [ordered]@{ version=3; mode='HOME'; startedAt=(Get-Date).ToString('o'); ready=$true; sshPid=$null; remoteManaged=$true }
    } else {
        Write-Host '[2/4] HOME transport'
        Write-Host '  not needed at WORK'
        Write-Host '[3/4] WORK ASR tunnel'
        $pid = Start-WorkTunnel
        $script:health = $null
        Wait-Until { try { $script:health = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3; [bool]$script:health.ok } catch { $false } } $cfg.StartTimeoutSeconds 'Whisper health failed through localhost:8090.'
        Write-Host ("  ASR: OK {0} / {1}" -f $script:health.model,$script:health.gpu)
        $state = [ordered]@{ version=3; mode='WORK'; startedAt=(Get-Date).ToString('o'); ready=$true; sshPid=$pid; remoteManaged=$true }
    }

    Write-Host '[4/4] Save state'
    $state.vastHost = $cfg.VastHost
    $state.vastSshPort = $cfg.VastSshPort
    $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
    Write-Host ''
    Write-Host ("{0}_READY" -f $mode) -ForegroundColor Green
} catch {
    $failed = [ordered]@{ version=3; mode=$mode; startedAt=(Get-Date).ToString('o'); ready=$false; vastHost=$cfg.VastHost; vastSshPort=$cfg.VastSshPort; error=$_.Exception.Message }
    $failed | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
    Write-Error $_
    exit 1
}
