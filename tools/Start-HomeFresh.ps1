[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime'
$ChromeProfile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\ChromeProfile'
$SingBoxConfig = Join-Path $env:LOCALAPPDATA 'sing-box-simnet\client.json'
$PacPath = Join-Path $env:USERPROFILE 'simnet-vast.pac'
$PacPort = 8765
$SocksPort = 25344
$AsrPort = 8090
$VastHost = '87.106.223.150'
$VastSshPort = 30036
$VastUser = 'root'
$VastUotPublicPort = 30047
$TunName = 'simnet-uot'
$WireGuardService = 'WireGuardTunnel$Zyatyev_Andriy-HOME'
$RemoteSingBox = '/workspace/sing-box-test/sing-box'
$RemoteSingBoxConfig = '/workspace/sing-box-test/server-unified.json'
$RemoteTranscriberDir = '/workspace/simnet-transcripter'
$RemoteAsrPort = 8000
$RemoteSocksPort = 25344
$RemoteUotPort = 10200
$script:DetectedMicroSipPath = $null
$script:SshIdentity = $null
$ManagedPorts = @($SocksPort, $AsrPort, $PacPort)

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $ChromeProfile | Out-Null

function Write-Step([string]$Text) {
    Write-Host ("`n=== " + $Text + " ===") -ForegroundColor Cyan
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    Write-Host 'HOME requires elevation for TUN. Requesting Administrator...' -ForegroundColor Yellow
    $elevatedArgs = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $elevatedArgs -Wait -PassThru
    exit $child.ExitCode
}

function Test-Listen([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$FailureMessage) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw $FailureMessage
}

function Stop-ProcessSafe([int]$ProcessId, [string]$Reason) {
    if ($ProcessId -le 4) { throw "Refusing to kill protected PID $ProcessId ($Reason)." }
    $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($p) {
        Write-Host ("KILL PID={0} NAME={1} TYPE={2}" -f $ProcessId, $p.ProcessName, $Reason)
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Get-ManagedProcesses {
    $result = @()
    $items = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    foreach ($item in @($items)) {
        $name = [string]$item.Name
        $line = [string]$item.CommandLine
        $reason = $null

        if ($name -ieq 'sing-box.exe') {
            $reason = 'sing-box'
        }
        elseif ($name -ieq 'ssh.exe' -and ($line -match [regex]::Escape($VastHost) -or $line -match '25344' -or $line -match '8090')) {
            $reason = 'SIMNET SSH tunnel'
        }
        elseif (($name -ieq 'python.exe' -or $name -ieq 'pythonw.exe' -or $name -ieq 'py.exe') -and ($line -match 'http\.server\s+8765' -or $line -match 'simnet-vast\.pac')) {
            $reason = 'PAC server'
        }
        elseif ($name -ieq 'MicroSIP.exe') {
            $reason = 'MicroSIP'
        }
        elseif ($name -ieq 'chrome.exe' -and ($line -match [regex]::Escape($ChromeProfile) -or $line -match 'simnet-vast\.pac')) {
            $reason = 'SIMNET Chrome'
        }

        if ($reason) {
            $result += [pscustomobject]@{
                ProcessId = [int]$item.ProcessId
                Name = $name
                Reason = $reason
                CommandLine = $line
                ExecutablePath = [string]$item.ExecutablePath
            }
        }
    }
    return @($result)
}

function Capture-ExistingPaths {
    foreach ($p in @(Get-ManagedProcesses)) {
        if ($p.Reason -eq 'MicroSIP' -and $p.ExecutablePath -and (Test-Path $p.ExecutablePath)) {
            $script:DetectedMicroSipPath = $p.ExecutablePath
            break
        }
    }
}

function Show-LocalStatus([string]$Label) {
    Write-Step $Label
    $managed = @(Get-ManagedProcesses)
    if ($managed.Count -eq 0) {
        Write-Host 'MANAGED PROCESSES: NONE'
    } else {
        foreach ($p in $managed) {
            Write-Host ("PID={0} NAME={1} TYPE={2}" -f $p.ProcessId, $p.Name, $p.Reason)
        }
    }
    foreach ($port in $ManagedPorts) {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 0) {
            Write-Host ("PORT {0}: CLOSED" -f $port)
        } else {
            foreach ($row in $listeners) {
                Write-Host ("PORT {0}: LISTEN PID={1}" -f $port, $row.OwningProcess)
            }
        }
    }
    $tun = Get-NetAdapter -Name $TunName -ErrorAction SilentlyContinue
    if ($tun) { Write-Host ("TUN {0}: {1}" -f $TunName, $tun.Status) }
    else { Write-Host ("TUN {0}: ABSENT" -f $TunName) }
}

function Stop-LocalHomeState {
    Write-Step 'KILL OLD LOCAL HOME STATE'

    foreach ($port in $ManagedPorts) {
        foreach ($listener in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
            Stop-ProcessSafe -ProcessId ([int]$listener.OwningProcess) -Reason ("listener:" + $port)
        }
    }

    foreach ($p in @(Get-ManagedProcesses)) {
        Stop-ProcessSafe -ProcessId $p.ProcessId -Reason $p.Reason
    }

    Remove-Item (Join-Path $RuntimeDir 'home-state.json') -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

function Assert-CleanLocalState {
    Write-Step 'VERIFY LOCAL CLEAN STATE'
    $dirty = $false

    foreach ($p in @(Get-ManagedProcesses)) {
        Write-Host ("LEFTOVER PID={0} NAME={1} TYPE={2}" -f $p.ProcessId, $p.Name, $p.Reason) -ForegroundColor Red
        $dirty = $true
    }
    foreach ($port in $ManagedPorts) {
        foreach ($listener in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
            Write-Host ("LEFTOVER PORT={0} PID={1}" -f $port, $listener.OwningProcess) -ForegroundColor Red
            $dirty = $true
        }
    }

    if ($dirty) { throw 'LOCAL_CLEANUP_FAILED' }
    Write-Host 'LOCAL_CLEAN_STATE=OK' -ForegroundColor Green
}

function Resolve-SshExe {
    $path = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    if (Test-Path $path) { return $path }
    $cmd = Get-Command 'ssh.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'ssh.exe not found.'
}

function Resolve-SshIdentity {
    $candidates = @(
        (Join-Path $env:USERPROFILE '.ssh\id_ed25519_simnet_autostart'),
        (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
        (Join-Path $env:USERPROFILE '.ssh\id_rsa')
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

function Get-SshCommonArgs {
    $args = @(
        '-p', [string]$VastSshPort,
        '-T',
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3'
    )
    if ($script:SshIdentity) {
        $args += @('-i', $script:SshIdentity, '-o', 'IdentitiesOnly=yes')
    }
    return $args
}

function Join-CommandArgs([string[]]$Args) {
    $parts = @()
    foreach ($arg in $Args) {
        if ($arg -match '[\s"]') {
            $parts += ('"' + ($arg -replace '"','\"') + '"')
        } else {
            $parts += $arg
        }
    }
    return ($parts -join ' ')
}

function Invoke-RemoteScript([string]$Script, [int]$TimeoutSeconds = 120) {
    $sshExe = Resolve-SshExe
    $args = @(Get-SshCommonArgs)
    $args += @(("{0}@{1}" -f $VastUser,$VastHost), 'bash', '-s')

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $sshExe
    $psi.Arguments = Join-CommandArgs $args
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $proc.StandardInput.Write($Script)
    $proc.StandardInput.Close()

    if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
        try { $proc.Kill() } catch {}
        throw "Remote SSH command timed out after ${TimeoutSeconds}s."
    }

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()

    if ($stdout) { $stdout.TrimEnd() -split "`r?`n" | ForEach-Object { Write-Host ('REMOTE> ' + $_) } }
    if ($stderr) { $stderr.TrimEnd() -split "`r?`n" | ForEach-Object { Write-Host ('REMOTE! ' + $_) -ForegroundColor DarkGray } }

    if ($proc.ExitCode -ne 0) {
        throw "REMOTE_START_FAILED exit=$($proc.ExitCode)"
    }
}

function Restart-RemoteHomeState {
    Write-Step 'REMOTE STATUS -> KILL -> START'

    $script = @'
set -eu

echo "pre: managed processes"
pgrep -a -x sing-box || true
pgrep -a -x wireproxy || true
if command -v supervisorctl >/dev/null 2>&1; then supervisorctl status simnet-transcriber 2>/dev/null || true; fi

echo "kill: old transport"
pkill -x wireproxy 2>/dev/null || true
pkill -x sing-box 2>/dev/null || true
sleep 1

echo "start: unified sing-box"
test -x /workspace/sing-box-test/sing-box
test -f /workspace/sing-box-test/server-unified.json
nohup /workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json >/workspace/sing-box-test/sing-box.log 2>&1 </dev/null &

n=0
until ss -lntu | grep -q ':25344 '; do
  n=$((n+1)); if [ "$n" -ge 20 ]; then echo 'remote :25344 failed'; tail -80 /workspace/sing-box-test/sing-box.log || true; exit 41; fi
  sleep 1
done
n=0
until ss -lntu | grep -q ':10200 '; do
  n=$((n+1)); if [ "$n" -ge 20 ]; then echo 'remote :10200 failed'; tail -80 /workspace/sing-box-test/sing-box.log || true; exit 42; fi
  sleep 1
done

echo "restart: transcriber"
if command -v supervisorctl >/dev/null 2>&1 && supervisorctl status simnet-transcriber >/dev/null 2>&1; then
  supervisorctl restart simnet-transcriber >/dev/null
elif [ -x /workspace/simnet-transcripter/start.sh ]; then
  cd /workspace/simnet-transcripter
  ./start.sh
else
  echo 'transcriber start method not found'
  exit 43
fi

n=0
until curl -fsS --max-time 3 http://127.0.0.1:8000/health >/dev/null 2>&1; do
  n=$((n+1)); if [ "$n" -ge 60 ]; then echo 'remote whisper /health failed'; exit 44; fi
  sleep 1
done

echo "remote ports:"
ss -lntu | grep -E ':25344 |:10200 |:8000 ' || true
echo 'REMOTE_HOME_READY'
'@

    Invoke-RemoteScript -Script $script -TimeoutSeconds 120
}

function Ensure-LegacyWireGuardOff {
    Write-Step 'LOCAL LEGACY WIREGUARD OFF'
    $svc = Get-Service -Name $WireGuardService -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        Stop-Service -Name $WireGuardService -Force
        Wait-Until { $s = Get-Service -Name $WireGuardService -ErrorAction SilentlyContinue; (-not $s) -or $s.Status -ne 'Running' } 10 'Legacy HOME WireGuard did not stop.'
        Write-Host 'legacy WireGuard: STOPPED'
    } else {
        Write-Host 'legacy WireGuard: already OFF'
    }
}

function Resolve-SingBoxExe {
    $cmd = Get-Command 'sing-box.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $root = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\SagerNet.sing-box_Microsoft.Winget.Source_8wekyb3d8bbwe'
    if (Test-Path $root) {
        $candidate = Get-ChildItem -Path $root -Recurse -Filter 'sing-box.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }
    throw 'sing-box.exe not found.'
}

function Start-LocalTun {
    Write-Step 'LOCAL SIP TUN'
    if (-not (Test-Path $SingBoxConfig)) { throw "sing-box config not found: $SingBoxConfig" }
    $exe = Resolve-SingBoxExe
    $out = Join-Path $RuntimeDir 'sing-box.out.log'
    $err = Join-Path $RuntimeDir 'sing-box.err.log'
    Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
    $args = 'run -c "{0}"' -f $SingBoxConfig
    $p = Start-Process -FilePath $exe -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    Write-Host ("sing-box: start PID {0}" -f $p.Id)
    Wait-Until { $a = Get-NetAdapter -Name $TunName -ErrorAction SilentlyContinue; $a -and $a.Status -eq 'Up' } 20 "TUN $TunName did not become Up."
    Write-Host ("{0}: UP" -f $TunName) -ForegroundColor Green
}

function Resolve-Python {
    $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($py) { return @{ File=$py.Source; Prefix='-3 ' } }
    $python = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($python) { return @{ File=$python.Source; Prefix='' } }
    throw 'Python 3 not found.'
}

function Test-Pac {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri ("http://127.0.0.1:{0}/simnet-vast.pac" -f $PacPort)
        return ($r.StatusCode -eq 200 -and $r.Content.Contains("SOCKS5 127.0.0.1:$SocksPort") -and $r.Content.Contains('return "DIRECT";'))
    } catch { return $false }
}

function Start-Pac {
    Write-Step 'PAC'
    $pac = @"
function FindProxyForURL(url, host) {
    if (
        host == "simnet.kiev.ua" ||
        host == "admin.simnet.kiev.ua" ||
        host == "userside.simnet.kiev.ua" ||
        host == "pbx.simnet.kiev.ua"
    ) {
        return "SOCKS5 127.0.0.1:$SocksPort";
    }
    return "DIRECT";
}
"@
    [IO.File]::WriteAllText($PacPath, $pac, [Text.Encoding]::ASCII)

    $python = Resolve-Python
    $out = Join-Path $RuntimeDir 'pac.out.log'
    $err = Join-Path $RuntimeDir 'pac.err.log'
    Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
    $args = '{0}-m http.server {1} --bind 127.0.0.1 --directory "{2}"' -f $python.Prefix,$PacPort,$env:USERPROFILE
    $p = Start-Process -FilePath $python.File -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    Wait-Until { Test-Listen $PacPort } 10 'PAC server did not listen.'
    Wait-Until { Test-Pac } 10 'PAC content verification failed.'
    Write-Host ("PAC: OK PID {0}" -f $p.Id) -ForegroundColor Green
}

function Start-SshForwards {
    Write-Step 'SSH FORWARDS 25344 + 8090'
    $sshExe = Resolve-SshExe
    $common = @(Get-SshCommonArgs)
    $args = @('-N') + $common + @(
        '-o','ExitOnForwardFailure=yes',
        '-L',("127.0.0.1:{0}:127.0.0.1:{1}" -f $SocksPort,$RemoteSocksPort),
        '-L',("127.0.0.1:{0}:127.0.0.1:{1}" -f $AsrPort,$RemoteAsrPort),
        ("{0}@{1}" -f $VastUser,$VastHost)
    )
    $argLine = Join-CommandArgs $args
    $out = Join-Path $RuntimeDir 'ssh.out.log'
    $err = Join-Path $RuntimeDir 'ssh.err.log'
    Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $sshExe -ArgumentList $argLine -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    Wait-Until { (Test-Listen $SocksPort) -and (Test-Listen $AsrPort) } 20 'SSH forwards did not start.'
    Write-Host ("SSH: OK PID {0}" -f $p.Id) -ForegroundColor Green
}

function Test-Whisper {
    try {
        $r = Invoke-RestMethod -TimeoutSec 5 -Uri ("http://127.0.0.1:{0}/health" -f $AsrPort)
        return [bool]$r.ok
    } catch { return $false }
}

function Get-SocksHttpCode([string]$Url) {
    try {
        $code = & curl.exe -k -sS --max-time 10 --socks5-hostname ("127.0.0.1:{0}" -f $SocksPort) -o NUL -w '%{http_code}' $Url 2>$null
        if ($LASTEXITCODE -ne 0) { return '000' }
        return ([string]$code).Trim()
    } catch { return '000' }
}

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 4000) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $ar = $client.BeginConnect($HostName,$Port,$null,$null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs)) { $client.Close(); return $false }
        $client.EndConnect($ar)
        $client.Close()
        return $true
    } catch { return $false }
}

function Resolve-MicroSipExe {
    if ($script:DetectedMicroSipPath -and (Test-Path $script:DetectedMicroSipPath)) { return $script:DetectedMicroSipPath }
    $cmd = Get-Command 'MicroSIP.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'MicroSIP\MicroSIP.exe'),
        (Join-Path $env:LOCALAPPDATA 'MicroSIP\microsip.exe'),
        (Join-Path $env:ProgramFiles 'MicroSIP\MicroSIP.exe')
    )
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'MicroSIP\MicroSIP.exe') }
    foreach ($path in $candidates) { if ($path -and (Test-Path $path)) { return $path } }
    throw 'MicroSIP.exe not found.'
}

function Start-MicroSip {
    Write-Step 'MICROSIP'
    $exe = Resolve-MicroSipExe
    Start-Process -FilePath $exe | Out-Null
    Wait-Until { [bool](Get-Process -Name 'MicroSIP' -ErrorAction SilentlyContinue) } 10 'MicroSIP did not start.'
    $p = Get-Process -Name 'MicroSIP' -ErrorAction SilentlyContinue | Select-Object -First 1
    Write-Host ("MicroSIP: RUNNING PID {0}" -f $p.Id) -ForegroundColor Green
}

function Resolve-ChromeExe {
    $paths = @()
    if ($env:ProgramFiles) { $paths += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe') }
    if (${env:ProgramFiles(x86)}) { $paths += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe') }
    foreach ($path in $paths) { if (Test-Path $path) { return $path } }
    $cmd = Get-Command 'chrome.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'Chrome not found.'
}

function Start-WorkbenchChrome {
    Write-Step 'WORKBENCH CHROME'
    $chrome = Resolve-ChromeExe
    $pacUrl = "http://127.0.0.1:$PacPort/simnet-vast.pac"
    $args = '--user-data-dir="{0}" --load-extension="{1}" --proxy-pac-url="{2}" --disable-quic "{3}" "{4}" "{5}"' -f $ChromeProfile,$RepoRoot,$pacUrl,'https://userside.simnet.kiev.ua/customer_list','https://admin.simnet.kiev.ua/','https://pbx.simnet.kiev.ua/'
    Start-Process -FilePath $chrome -ArgumentList $args | Out-Null
    Wait-Until {
        $items = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue
        [bool]($items | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($ChromeProfile,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1)
    } 15 'Workbench Chrome did not start.'
    Write-Host 'Chrome: RUNNING with PAC' -ForegroundColor Green
}

function Show-DiagnosticsBeforeCleanup([string]$PrimaryError) {
    Write-Host "`n=== PRIMARY ERROR ===" -ForegroundColor Red
    Write-Host $PrimaryError -ForegroundColor Red
    Write-Host '=== LIVE DIAGNOSTICS BEFORE CLEANUP ===' -ForegroundColor Yellow
    Show-LocalStatus 'LIVE STATE'
    foreach ($name in @('sing-box.err.log','sing-box.out.log','pac.err.log','ssh.err.log','ssh.out.log')) {
        $path = Join-Path $RuntimeDir $name
        if (Test-Path $path) {
            Write-Host ("--- {0} ---" -f $name)
            Get-Content -Path $path -Tail 60 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
        }
    }
}

try {
    Write-Host 'SIMNET HOME: STATUS -> KILL -> CLEAN -> REMOTE RESTART -> LOCAL START -> VERIFY' -ForegroundColor White

    Capture-ExistingPaths
    Show-LocalStatus 'PRE-START STATUS'
    Stop-LocalHomeState
    Assert-CleanLocalState
    Ensure-LegacyWireGuardOff

    $script:SshIdentity = Resolve-SshIdentity
    if ($script:SshIdentity) { Write-Host ("SSH identity: {0}" -f $script:SshIdentity) }
    else { Write-Host 'SSH identity: default OpenSSH/agent (BatchMode)' -ForegroundColor Yellow }

    Restart-RemoteHomeState
    Start-LocalTun
    Start-Pac
    Start-SshForwards

    Write-Step 'WHISPER HEALTH'
    Wait-Until { Test-Whisper } 30 'Whisper localhost:8090 /health failed.'
    Write-Host 'Whisper: OK' -ForegroundColor Green

    Write-Step 'SERVICE PROBES VIA SOCKS'
    $billing = Get-SocksHttpCode 'https://admin.simnet.kiev.ua/'
    $userside = Get-SocksHttpCode 'https://userside.simnet.kiev.ua/'
    $pbx = Get-SocksHttpCode 'https://pbx.simnet.kiev.ua/'
    Write-Host ("BILLING  HTTP={0}" -f $billing)
    Write-Host ("USERSIDE HTTP={0}" -f $userside)
    Write-Host ("PBX      HTTP={0}" -f $pbx)

    $reachableCount = 0
    foreach ($code in @($billing,$userside,$pbx)) { if ($code -match '^[1-5]\d\d$') { $reachableCount++ } }
    if ($reachableCount -eq 0) { throw 'No SIMNET service is reachable through SOCKS.' }
    if ($userside -eq '000' -or $userside -match '^5\d\d$') {
        Write-Host 'USERSIDE: service unavailable/maintenance possible; HOME transport remains independently verified.' -ForegroundColor Yellow
    }

    Write-Step 'SIP ENTRY'
    if (-not (Test-TcpPort -HostName $VastHost -Port $VastUotPublicPort -TimeoutMs 5000)) { throw "Vast UOT public port $VastUotPublicPort is unreachable." }
    Write-Host ("Vast UOT :{0}: REACHABLE" -f $VastUotPublicPort) -ForegroundColor Green

    Start-MicroSip
    Start-WorkbenchChrome

    Write-Step 'FINAL VERIFY'
    if (-not (Test-Listen $SocksPort)) { throw 'Final SOCKS listener missing.' }
    if (-not (Test-Listen $AsrPort)) { throw 'Final ASR listener missing.' }
    if (-not (Test-Pac)) { throw 'Final PAC check failed.' }
    if (-not (Test-Whisper)) { throw 'Final Whisper check failed.' }
    $tun = Get-NetAdapter -Name $TunName -ErrorAction SilentlyContinue
    if (-not ($tun -and $tun.Status -eq 'Up')) { throw 'Final TUN check failed.' }
    if (-not (Get-Process -Name 'MicroSIP' -ErrorAction SilentlyContinue)) { throw 'Final MicroSIP check failed.' }

    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host 'HOME_READY' -ForegroundColor Green
    Write-Host ("SOCKS   127.0.0.1:{0} OK" -f $SocksPort)
    Write-Host ("WHISPER 127.0.0.1:{0} OK" -f $AsrPort)
    Write-Host ("PAC     127.0.0.1:{0} OK" -f $PacPort)
    Write-Host ("TUN     {0} UP" -f $TunName)
    Write-Host 'MicroSIP RUNNING'
    Write-Host ("Billing={0} UserSide={1} PBX={2}" -f $billing,$userside,$pbx)
    Write-Host '========================================' -ForegroundColor Green
    exit 0
}
catch {
    $primary = $_.Exception.Message
    Show-DiagnosticsBeforeCleanup -PrimaryError $primary
    Write-Step 'FAILURE CLEANUP'
    try { Stop-LocalHomeState } catch { Write-Warning $_.Exception.Message }
    Write-Host "`n========================================" -ForegroundColor Red
    Write-Host 'HOME_START_FAILED' -ForegroundColor Red
    Write-Host ("PRIMARY_ERROR={0}" -f $primary) -ForegroundColor Red
    Write-Host 'Local HOME processes were cleaned after diagnostics.'
    Write-Host '========================================' -ForegroundColor Red
    exit 1
}
