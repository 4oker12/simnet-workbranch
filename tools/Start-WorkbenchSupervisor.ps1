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
        $legacyTunnelName = ([string]$cfg.WireGuardService) -replace '^WireGuardTunnel\$', ''
        if ($legacyTunnelName) {
            $wgAdapter = Get-NetAdapter -Name $legacyTunnelName -ErrorAction SilentlyContinue
            if ($wgAdapter -and $wgAdapter.Status -eq 'Up') { return $true }
        }
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

function Get-ProcessCommandLine([int]$ProcessId) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
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
    $RemoteCommand = $RemoteCommand.Replace("`r`n", "`n").Replace("`r", '')
    $args = Get-SshBaseArgs
    $args += @('-p', [string]$cfg.VastSshPort, ('{0}@{1}' -f $cfg.VastUser,$cfg.VastHost), $RemoteCommand)
    & $ssh @args
    if ($LASTEXITCODE -ne 0) { throw "Vast command failed with exit code $LASTEXITCODE" }
}

function Get-IniValue([string]$Text, [string]$Section, [string]$Key) {
    $sectionPattern = '(?ms)^\s*\[' + [regex]::Escape($Section) + '\]\s*(.*?)(?=^\s*\[|\z)'
    $sectionMatch = [regex]::Match($Text, $sectionPattern)
    if (-not $sectionMatch.Success) { return $null }
    $keyPattern = '(?im)^\s*' + [regex]::Escape($Key) + '\s*=\s*(.+?)\s*$'
    $keyMatch = [regex]::Match($sectionMatch.Groups[1].Value, $keyPattern)
    if (-not $keyMatch.Success) { return $null }
    return $keyMatch.Groups[1].Value.Trim()
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Build-PrivateHomeConfig {
    if (-not (Test-Path $cfg.PrivateWireGuardConfig)) {
        throw ('Private WireGuard config missing: {0}' -f $cfg.PrivateWireGuardConfig)
    }
    if (-not (Test-Path $cfg.SingBoxConfig)) {
        throw ('Local sing-box client config missing: {0}' -f $cfg.SingBoxConfig)
    }

    $wgText = Get-Content -Raw -Path $cfg.PrivateWireGuardConfig
    $wgPrivateKey = Get-IniValue $wgText 'Interface' 'PrivateKey'
    $wgAddress = Get-IniValue $wgText 'Interface' 'Address'
    $wgListenPort = Get-IniValue $wgText 'Interface' 'ListenPort'
    $peerPublicKey = Get-IniValue $wgText 'Peer' 'PublicKey'
    $peerAllowedIps = Get-IniValue $wgText 'Peer' 'AllowedIPs'
    $peerEndpoint = Get-IniValue $wgText 'Peer' 'Endpoint'

    foreach ($required in @(
        @{ Name='Interface.PrivateKey'; Value=$wgPrivateKey },
        @{ Name='Interface.Address'; Value=$wgAddress },
        @{ Name='Peer.PublicKey'; Value=$peerPublicKey },
        @{ Name='Peer.AllowedIPs'; Value=$peerAllowedIps },
        @{ Name='Peer.Endpoint'; Value=$peerEndpoint }
    )) {
        if ([string]::IsNullOrWhiteSpace([string]$required.Value)) { throw ('WireGuard config missing {0}' -f $required.Name) }
    }

    $endpointMatch = [regex]::Match([string]$peerEndpoint, '^\s*([^:]+):(\d+)\s*$')
    if (-not $endpointMatch.Success) { throw 'WireGuard Peer.Endpoint must be host:port.' }
    $peerHost = $endpointMatch.Groups[1].Value
    $peerPort = [int]$endpointMatch.Groups[2].Value
    $listenPort = if ($wgListenPort -match '^\d+$') { [int]$wgListenPort } else { 0 }
    $addresses = @([string]$wgAddress -split '\s*,\s*' | Where-Object { $_ })
    $allowedIps = @([string]$peerAllowedIps -split '\s*,\s*' | Where-Object { $_ })

    $client = Get-Content -Raw -Path $cfg.SingBoxConfig | ConvertFrom-Json
    $ss = @($client.outbounds | Where-Object { $_.type -eq 'shadowsocks' } | Select-Object -First 1)
    if ($ss.Count -eq 0 -or -not $ss[0]) { throw 'No Shadowsocks outbound found in local sing-box client config.' }
    $ss = $ss[0]
    if ([string]::IsNullOrWhiteSpace([string]$ss.method) -or [string]::IsNullOrWhiteSpace([string]$ss.password)) {
        throw 'Local Shadowsocks outbound is missing method/password.'
    }

    $ssInbound = [ordered]@{
        type = 'shadowsocks'
        tag = 'sip-shadowsocks'
        listen = '127.0.0.1'
        listen_port = [int]$cfg.RemoteShadowsocksPort
        method = [string]$ss.method
        password = [string]$ss.password
    }
    if ($ss.PSObject.Properties['multiplex']) { $ssInbound.multiplex = $ss.multiplex }

    $wgEndpoint = [ordered]@{
        type = 'wireguard'
        tag = 'simnet-wg'
        system = $false
        mtu = 1400
        address = $addresses
        private_key = [string]$wgPrivateKey
        peers = @(
            [ordered]@{
                address = $peerHost
                port = $peerPort
                public_key = [string]$peerPublicKey
                allowed_ips = $allowedIps
                persistent_keepalive_interval = 25
            }
        )
    }
    if ($listenPort -gt 0) { $wgEndpoint.listen_port = $listenPort }

    $serverConfig = [ordered]@{
        log = [ordered]@{ level = 'info'; timestamp = $true }
        dns = [ordered]@{
            servers = @([ordered]@{ type = 'local'; tag = 'local' })
        }
        inbounds = @(
            [ordered]@{
                type = 'socks'
                tag = 'browser-socks'
                listen = '127.0.0.1'
                listen_port = [int]$cfg.RemoteSocksPort
            },
            $ssInbound
        )
        outbounds = @([ordered]@{ type = 'direct'; tag = 'direct' })
        endpoints = @($wgEndpoint)
        route = [ordered]@{
            rules = @(
                [ordered]@{
                    inbound = @('browser-socks','sip-shadowsocks')
                    action = 'route'
                    outbound = 'simnet-wg'
                }
            )
            final = 'direct'
            default_domain_resolver = 'local'
            auto_detect_interface = $true
        }
    }

    $json = $serverConfig | ConvertTo-Json -Depth 20
    Write-Utf8NoBom $cfg.PrivateSingBoxServerConfig $json
    Write-Host '  private HOME config: regenerated locally from WireGuard + Shadowsocks sources'
}

function Sync-PrivateHomeConfig {
    $scp = Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe'
    if (-not (Test-Path $scp)) { throw "scp.exe not found: $scp" }
    Invoke-Vast 'mkdir -p /workspace/sing-box-test'

    $base = @('-q','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=10')
    $base += Resolve-SshIdentityArgs
    $base += @('-P',[string]$cfg.VastSshPort)
    $remote = ('{0}@{1}:/workspace/sing-box-test/server-unified.json' -f $cfg.VastUser,$cfg.VastHost)

    if (-not (Test-Path $cfg.PrivateSingBoxServerConfig)) {
        if ((Test-Path $cfg.PrivateWireGuardConfig) -and (Test-Path $cfg.SingBoxConfig)) {
            Build-PrivateHomeConfig
        } else {
            & $scp @base $remote $cfg.PrivateSingBoxServerConfig
            if ($LASTEXITCODE -eq 0 -and (Test-Path $cfg.PrivateSingBoxServerConfig)) {
                Write-Host ('  private HOME config: backed up to {0}' -f $cfg.PrivateSingBoxServerConfig)
            } else {
                Remove-Item $cfg.PrivateSingBoxServerConfig -Force -ErrorAction SilentlyContinue
                throw ('HOME private inputs missing. Need {0} and {1}' -f $cfg.PrivateWireGuardConfig,$cfg.SingBoxConfig)
            }
        }
    }

    # Windows PowerShell 5.1 Set-Content -Encoding UTF8 writes a BOM. sing-box rejects it.
    $jsonText = [IO.File]::ReadAllText($cfg.PrivateSingBoxServerConfig)
    Write-Utf8NoBom $cfg.PrivateSingBoxServerConfig $jsonText

    & $scp @base $cfg.PrivateSingBoxServerConfig $remote
    if ($LASTEXITCODE -ne 0) { throw 'Failed to upload private HOME sing-box config to Vast.' }
    Write-Host '  private HOME config: synced to Vast'
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
export DEBIAN_FRONTEND=noninteractive
mkdir -p /workspace/sing-box-test

if [ ! -x /workspace/sing-box-test/sing-box ]; then
  command -v curl >/dev/null 2>&1 || { apt-get update -y && apt-get install -y curl; }
  command -v jq >/dev/null 2>&1 || { apt-get update -y && apt-get install -y jq; }
  command -v tar >/dev/null 2>&1 || { apt-get update -y && apt-get install -y tar; }

  URL="$(curl -fsSL https://api.github.com/repos/SagerNet/sing-box/releases/latest \
    | jq -r '.assets[].browser_download_url' \
    | grep -E 'linux-amd64\.tar\.gz$' \
    | head -n 1)"

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
/workspace/sing-box-test/sing-box check -c /workspace/sing-box-test/server-unified.json || {
  echo 'REMOTE_HOME_NOT_READY: generated sing-box config is invalid' >&2
  exit 46
}

mkdir -p /opt/supervisor-scripts /etc/supervisor/conf.d
cat >/opt/supervisor-scripts/simnet-home-singbox.sh <<'EOF'
#!/bin/bash
set -euo pipefail
exec /workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json
EOF
chmod +x /opt/supervisor-scripts/simnet-home-singbox.sh

cat >/etc/supervisor/conf.d/simnet-home-singbox.conf <<'EOF'
[program:simnet-home-singbox]
command=/opt/supervisor-scripts/simnet-home-singbox.sh
autostart=true
autorestart=unexpected
startsecs=1
stopasgroup=true
killasgroup=true
stdout_logfile=/dev/stdout
redirect_stderr=true
stdout_logfile_maxbytes=0
EOF

supervisorctl reread >/dev/null
supervisorctl update >/dev/null

CONFIG_HASH="$(sha256sum /workspace/sing-box-test/server-unified.json | awk '{print $1}')"
RUNNING_HASH="$(cat /workspace/sing-box-test/server-unified.running.sha256 2>/dev/null || true)"
STATUS="$(supervisorctl status simnet-home-singbox 2>/dev/null || true)"

if printf '%s\n' "$STATUS" | grep -q 'RUNNING' && [ "$CONFIG_HASH" = "$RUNNING_HASH" ]; then
  echo '  sing-box supervisor: reuse RUNNING'
else
  if printf '%s\n' "$STATUS" | grep -q 'RUNNING'; then
    supervisorctl restart simnet-home-singbox >/dev/null
    echo '  sing-box supervisor: restarted for config update'
  else
    PIDS="$(pgrep -f '^/workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json$' 2>/dev/null || true)"
    if [ -n "$PIDS" ]; then kill $PIDS 2>/dev/null || true; sleep 1; fi
    supervisorctl start simnet-home-singbox >/dev/null
    echo '  sing-box supervisor: started'
  fi
  printf '%s\n' "$CONFIG_HASH" >/workspace/sing-box-test/server-unified.running.sha256
fi

for i in $(seq 1 20); do
  if ss -lntup | grep -q ':25344' && ss -lntup | grep -q ':10200'; then break; fi
  sleep 1
done

ss -lntup | grep -q ':25344' || { echo 'REMOTE_HOME_NOT_READY: SOCKS :25344 is not listening' >&2; supervisorctl status simnet-home-singbox >&2 || true; exit 45; }
ss -lntup | grep -q ':10200' || { echo 'REMOTE_HOME_NOT_READY: Shadowsocks :10200 is not listening' >&2; supervisorctl status simnet-home-singbox >&2 || true; exit 45; }

PBX_CODE="$(curl --socks5-hostname 127.0.0.1:25344 -k -sS --connect-timeout 5 --max-time 10 -o /dev/null -w '%{http_code}' https://pbx.simnet.kiev.ua/ || true)"
case "$PBX_CODE" in
  2??|3??) echo "  Vast HOME PBX probe: HTTP $PBX_CODE" ;;
  *) echo "REMOTE_HOME_NOT_READY: PBX through WireGuard returned HTTP ${PBX_CODE:-000}" >&2; exit 47 ;;
esac
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
            Write-Host ('  WORK ASR SSH: reuse PID {0}' -f $owner)
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
    Write-Host '[1/4] Vast transcriber / supervisor'
    Ensure-RemoteBase
    Write-Host '  transcriber: OK'

    if ($mode -eq 'HOME') {
        Write-Host '[2/4] Vast HOME sing-box / supervisor'
        Sync-PrivateHomeConfig
        Ensure-RemoteHomeTransport
        Write-Host '  Vast HOME transport: OK'

        Write-Host '[3/4] Local HOME transport'
        & (Join-Path $ScriptDir 'Start-WorkbenchHome.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'HOME launcher failed.' }
        $state = [ordered]@{ version=5; mode='HOME'; startedAt=(Get-Date).ToString('o'); ready=$true; sshPid=$null; remoteManaged=$false; remoteSupervisor=$true }
    } else {
        Write-Host '[2/4] Vast HOME transport'
        Write-Host '  not needed at WORK'
        Write-Host '[3/4] WORK ASR tunnel'
        $workSshPid = Start-WorkTunnel
        $script:health = $null
        Wait-Until { try { $script:health = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3; [bool]$script:health.ok } catch { $false } } $cfg.StartTimeoutSeconds 'Whisper health failed through localhost:8090.'
        Write-Host ("  ASR: OK {0} / {1}" -f $script:health.model,$script:health.gpu)
        $state = [ordered]@{ version=5; mode='WORK'; startedAt=(Get-Date).ToString('o'); ready=$true; sshPid=$workSshPid; remoteManaged=$false; remoteSupervisor=$true }
    }

    Write-Host '[4/4] Save state'
    $state.vastHost = $cfg.VastHost
    $state.vastSshPort = $cfg.VastSshPort
    $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
    Write-Host ''
    Write-Host ("{0}_READY" -f $mode) -ForegroundColor Green
} catch {
    $failed = [ordered]@{ version=5; mode=$mode; startedAt=(Get-Date).ToString('o'); ready=$false; vastHost=$cfg.VastHost; vastSshPort=$cfg.VastSshPort; error=$_.Exception.Message }
    $failed | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $cfg.UnifiedStateFile
    Write-Error $_
    exit 1
}
