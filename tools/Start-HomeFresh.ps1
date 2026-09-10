[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$RepoRoot      = Split-Path -Parent $PSScriptRoot
$RuntimeDir    = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\runtime'
$ChromeProfile = Join-Path $env:LOCALAPPDATA 'SIMNET-Workbench\ChromeProfile'
$SingBoxConfig = Join-Path $env:LOCALAPPDATA 'sing-box-simnet\client.json'
$PacPath       = Join-Path $env:USERPROFILE 'simnet-vast.pac'
$PacPort       = 8765
$SocksPort     = 25344
$AsrPort       = 8090
$VastHost      = '87.106.223.150'
$VastSshPort   = 30036
$VastUser      = 'root'
$TunName       = 'simnet-uot'
$WireGuardService = 'WireGuardTunnel$Zyatyev_Andriy-HOME'
$ChromeUrls = @(
    'https://admin.simnet.kiev.ua/',
    'https://userside.simnet.kiev.ua/customer_list',
    'https://pbx.simnet.kiev.ua/'
)
$ManagedPorts = @($SocksPort,$AsrPort,$PacPort)
$script:SshIdentity = $null
$script:MicroSipPath = $null

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $ChromeProfile | Out-Null

function Step([string]$Name) { Write-Host ("`n=== $Name ===") -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host $Text -ForegroundColor Green }
function Warn([string]$Text) { Write-Host $Text -ForegroundColor Yellow }

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host 'HOME requires Administrator for TUN. Requesting elevation...' -ForegroundColor Yellow
    $args = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    $child = Start-Process powershell.exe -Verb RunAs -ArgumentList $args -Wait -PassThru
    exit $child.ExitCode
}

function Test-Tcp([string]$HostName,[int]$Port,[int]$TimeoutMs=5000) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect($HostName,$Port,$null,$null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($ar)
        return $true
    } catch { return $false } finally { $client.Close() }
}

function Resolve-SshExe {
    $p = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    if (Test-Path $p) { return $p }
    $c = Get-Command ssh.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    throw 'ssh.exe not found.'
}

function Quote-Arg([string]$Value) {
    if ($Value -match '[\s"]') { return '"' + ($Value -replace '"','\"') + '"' }
    return $Value
}

function Join-Args([string[]]$Values) {
    return (($Values | ForEach-Object { Quote-Arg $_ }) -join ' ')
}

function Invoke-SshCapture([string[]]$ExtraArgs,[int]$TimeoutSec=20) {
    $ssh = Resolve-SshExe
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $ssh
    $psi.Arguments = Join-Args $ExtraArgs
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $proc = New-Object Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    if (-not $proc.WaitForExit($TimeoutSec*1000)) {
        try { $proc.Kill() } catch {}
        return [pscustomobject]@{ ExitCode=124; StdOut=''; StdErr='SSH timeout' }
    }
    return [pscustomobject]@{
        ExitCode=$proc.ExitCode
        StdOut=$proc.StandardOutput.ReadToEnd()
        StdErr=$proc.StandardError.ReadToEnd()
    }
}

function Base-SshArgs([string]$Identity=$null,[bool]$ForceIdentity=$false) {
    $a = @(
        '-p',[string]$VastSshPort,
        '-T',
        '-o','BatchMode=yes',
        '-o','StrictHostKeyChecking=accept-new',
        '-o','ConnectTimeout=8',
        '-o','ServerAliveInterval=30',
        '-o','ServerAliveCountMax=3'
    )
    if ($Identity) {
        $a += @('-i',$Identity)
        if ($ForceIdentity) { $a += @('-o','IdentitiesOnly=yes') }
    }
    return $a
}

function Resolve-WorkingSshIdentity {
    Step 'PREFLIGHT VAST TCP + SSH AUTH'
    if (-not (Test-Tcp $VastHost $VastSshPort 5000)) {
        throw "VAST_TCP_UNREACHABLE $VastHost`:$VastSshPort"
    }
    Ok "VAST_TCP=OK $VastHost`:$VastSshPort"

    $candidates = @(
        (Join-Path $env:USERPROFILE '.ssh\id_ed25519_simnet_autostart'),
        (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
        (Join-Path $env:USERPROFILE '.ssh\id_rsa')
    ) | Where-Object { Test-Path $_ }

    foreach ($key in $candidates) {
        $args = @(Base-SshArgs $key $true)
        $args += @(("{0}@{1}" -f $VastUser,$VastHost),'echo','SSH_OK')
        $r = Invoke-SshCapture $args 15
        if ($r.ExitCode -eq 0 -and $r.StdOut -match 'SSH_OK') {
            $script:SshIdentity = $key
            Ok ('SSH_AUTH=OK key=' + (Split-Path -Leaf $key))
            return
        }
        Warn ('SSH key rejected: ' + (Split-Path -Leaf $key))
    }

    # Last chance: ssh-agent/default OpenSSH resolution.
    $args = @(Base-SshArgs)
    $args += @(("{0}@{1}" -f $VastUser,$VastHost),'echo','SSH_OK')
    $r = Invoke-SshCapture $args 15
    if ($r.ExitCode -eq 0 -and $r.StdOut -match 'SSH_OK') {
        $script:SshIdentity = $null
        Ok 'SSH_AUTH=OK key=agent/default'
        return
    }

    Write-Host '--- SSH STDERR ---' -ForegroundColor Red
    if ($r.StdErr) { Write-Host $r.StdErr.Trim() -ForegroundColor Red }
    throw 'VAST_SSH_AUTH_FAILED'
}

function Get-SshArgs {
    $a = @(Base-SshArgs $script:SshIdentity ([bool]$script:SshIdentity))
    return $a
}

function Invoke-RemoteScript([string]$Script,[int]$TimeoutSec=120) {
    $ssh = Resolve-SshExe
    $args = @(Get-SshArgs)
    $args += @(("{0}@{1}" -f $VastUser,$VastHost),'bash','-s')

    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $ssh
    $psi.Arguments = Join-Args $args
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $proc = New-Object Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $proc.StandardInput.Write($Script)
    $proc.StandardInput.Close()
    if (-not $proc.WaitForExit($TimeoutSec*1000)) {
        try { $proc.Kill() } catch {}
        throw 'REMOTE_START_TIMEOUT'
    }
    $out = $proc.StandardOutput.ReadToEnd()
    $err = $proc.StandardError.ReadToEnd()
    if ($out) { $out.TrimEnd() -split "`r?`n" | ForEach-Object { Write-Host ('REMOTE> '+$_) } }
    if ($err) { $err.TrimEnd() -split "`r?`n" | ForEach-Object { Write-Host ('REMOTE! '+$_) -ForegroundColor DarkGray } }
    if ($proc.ExitCode -ne 0) { throw "REMOTE_START_FAILED exit=$($proc.ExitCode)" }
}

function Get-ManagedProcesses {
    $result=@()
    foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        $name=[string]$p.Name; $line=[string]$p.CommandLine; $reason=$null
        if ($name -ieq 'sing-box.exe') { $reason='sing-box' }
        elseif ($name -ieq 'ssh.exe' -and ($line -match [regex]::Escape($VastHost) -or $line -match '25344' -or $line -match '8090')) { $reason='SIMNET SSH tunnel' }
        elseif (($name -ieq 'python.exe' -or $name -ieq 'pythonw.exe' -or $name -ieq 'py.exe') -and ($line -match 'http\.server\s+8765' -or $line -match 'simnet-vast\.pac')) { $reason='PAC server' }
        elseif ($name -ieq 'MicroSIP.exe') { $reason='MicroSIP' }
        elseif ($name -ieq 'chrome.exe' -and ($line -match [regex]::Escape($ChromeProfile) -or $line -match 'simnet-vast\.pac')) { $reason='SIMNET Chrome' }
        if ($reason) {
            $result += [pscustomobject]@{ ProcessId=[int]$p.ProcessId; Name=$name; Reason=$reason; ExecutablePath=[string]$p.ExecutablePath }
        }
    }
    return @($result)
}

function Capture-Paths {
    foreach ($p in @(Get-ManagedProcesses)) {
        if ($p.Reason -eq 'MicroSIP' -and $p.ExecutablePath -and (Test-Path $p.ExecutablePath)) { $script:MicroSipPath=$p.ExecutablePath; break }
    }
    if (-not $script:MicroSipPath) {
        foreach ($candidate in @(
            (Join-Path $env:LOCALAPPDATA 'MicroSIP\MicroSIP.exe'),
            (Join-Path $env:ProgramFiles 'MicroSIP\MicroSIP.exe')
        )) { if (Test-Path $candidate) { $script:MicroSipPath=$candidate; break } }
    }
}

function Show-Status([string]$Label) {
    Step $Label
    $m=@(Get-ManagedProcesses)
    if ($m.Count -eq 0) { Write-Host 'MANAGED PROCESSES: NONE' }
    else { foreach ($p in $m) { Write-Host ("PID={0} NAME={1} TYPE={2}" -f $p.ProcessId,$p.Name,$p.Reason) } }
    foreach ($port in $ManagedPorts) {
        $l=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($l.Count -eq 0) { Write-Host "PORT $port`: CLOSED" }
        else { foreach ($x in $l) { Write-Host ("PORT {0}: LISTEN PID={1}" -f $port,$x.OwningProcess) } }
    }
    $tun=Get-NetAdapter -Name $TunName -ErrorAction SilentlyContinue
    if ($tun) { Write-Host "TUN $TunName`: $($tun.Status)" } else { Write-Host "TUN $TunName`: ABSENT" }
}

function Kill-Local {
    Step 'KILL OLD LOCAL HOME STATE'
    foreach ($port in $ManagedPorts) {
        foreach ($l in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
            if ([int]$l.OwningProcess -gt 4) { Stop-Process -Id ([int]$l.OwningProcess) -Force -ErrorAction SilentlyContinue }
        }
    }
    foreach ($p in @(Get-ManagedProcesses)) {
        if ($p.ProcessId -gt 4) {
            Write-Host ("KILL PID={0} NAME={1} TYPE={2}" -f $p.ProcessId,$p.Name,$p.Reason)
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep 2
}

function Assert-Clean {
    Step 'VERIFY LOCAL CLEAN STATE'
    $dirty=$false
    foreach ($p in @(Get-ManagedProcesses)) { Write-Host "LEFTOVER PID=$($p.ProcessId) $($p.Name)" -ForegroundColor Red; $dirty=$true }
    foreach ($port in $ManagedPorts) {
        foreach ($l in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { Write-Host "LEFTOVER PORT=$port PID=$($l.OwningProcess)" -ForegroundColor Red; $dirty=$true }
    }
    if ($dirty) { throw 'LOCAL_CLEANUP_FAILED' }
    Ok 'LOCAL_CLEAN_STATE=OK'
}

function Restart-Remote {
    Step 'REMOTE STATUS -> KILL -> START'
    $script=@'
set -eu

echo 'pre: managed processes'
pgrep -a -x sing-box || true
pgrep -a -x wireproxy || true
if command -v supervisorctl >/dev/null 2>&1; then supervisorctl status simnet-transcriber 2>/dev/null || true; fi

echo 'kill: old transport'
pkill -x wireproxy 2>/dev/null || true
pkill -x sing-box 2>/dev/null || true
sleep 1

echo 'start: unified sing-box'
test -x /workspace/sing-box-test/sing-box
test -f /workspace/sing-box-test/server-unified.json
nohup /workspace/sing-box-test/sing-box run -c /workspace/sing-box-test/server-unified.json >/workspace/sing-box-test/sing-box.log 2>&1 </dev/null &

for i in $(seq 1 20); do ss -lntu | grep -q ':25344 ' && break; sleep 1; done
ss -lntu | grep -q ':25344 ' || { echo 'remote :25344 failed'; tail -80 /workspace/sing-box-test/sing-box.log || true; exit 41; }
for i in $(seq 1 20); do ss -lntu | grep -q ':10200 ' && break; sleep 1; done
ss -lntu | grep -q ':10200 ' || { echo 'remote :10200 failed'; tail -80 /workspace/sing-box-test/sing-box.log || true; exit 42; }

echo 'restart: transcriber'
if command -v supervisorctl >/dev/null 2>&1 && supervisorctl status simnet-transcriber >/dev/null 2>&1; then
  supervisorctl restart simnet-transcriber >/dev/null
elif [ -x /workspace/simnet-transcripter/start.sh ]; then
  cd /workspace/simnet-transcripter && ./start.sh
else
  echo 'transcriber start method not found'; exit 43
fi

for i in $(seq 1 60); do curl -fsS --max-time 3 http://127.0.0.1:8000/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS --max-time 3 http://127.0.0.1:8000/health >/dev/null 2>&1 || { echo 'remote whisper failed'; exit 44; }

ss -lntu | grep -E ':25344 |:10200 |:8000 ' || true
echo 'REMOTE_HOME_READY'
'@
    Invoke-RemoteScript $script 120
}

function Ensure-WireGuardOff {
    Step 'LEGACY WIREGUARD OFF'
    $svc=Get-Service -Name $WireGuardService -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') { Stop-Service -Name $WireGuardService -Force; Start-Sleep 1 }
    $svc=Get-Service -Name $WireGuardService -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') { throw 'LEGACY_WIREGUARD_STILL_RUNNING' }
    Ok 'LEGACY_WIREGUARD=OFF'
}

function Resolve-SingBoxExe {
    $c=Get-Command sing-box.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $root=Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\SagerNet.sing-box_Microsoft.Winget.Source_8wekyb3d8bbwe'
    if (Test-Path $root) {
        $f=Get-ChildItem $root -Recurse -Filter sing-box.exe -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($f) { return $f.FullName }
    }
    throw 'sing-box.exe not found.'
}

function Start-Tun {
    Step 'LOCAL SIP TUN'
    if (-not (Test-Path $SingBoxConfig)) { throw "SINGBOX_CONFIG_MISSING $SingBoxConfig" }
    $exe=Resolve-SingBoxExe
    $out=Join-Path $RuntimeDir 'sing-box.out.log'; $err=Join-Path $RuntimeDir 'sing-box.err.log'
    Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
    $p=Start-Process $exe -ArgumentList ('run -c "{0}"' -f $SingBoxConfig) -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $deadline=(Get-Date).AddSeconds(20)
    do {
        $tun=Get-NetAdapter -Name $TunName -ErrorAction SilentlyContinue
        if ($tun -and $tun.Status -eq 'Up') { Ok "TUN $TunName=UP PID=$($p.Id)"; return }
        if ($p.HasExited) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (Test-Path $err) { Write-Host '--- sing-box.err.log ---'; Get-Content $err -Tail 80 }
    throw "TUN_START_FAILED $TunName"
}

function Resolve-Python {
    $py=Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { return [pscustomobject]@{Exe=$py.Source;ArgsPrefix='-3 '} }
    $p=Get-Command python.exe -ErrorAction SilentlyContinue
    if ($p) { return [pscustomobject]@{Exe=$p.Source;ArgsPrefix=''} }
    throw 'PYTHON_NOT_FOUND'
}

function Start-Pac {
    Step 'PAC SERVER'
    @'
function FindProxyForURL(url, host) {
    if (
        host == "simnet.kiev.ua" ||
        host == "admin.simnet.kiev.ua" ||
        host == "userside.simnet.kiev.ua" ||
        host == "pbx.simnet.kiev.ua"
    ) {
        return "SOCKS5 127.0.0.1:25344";
    }
    return "DIRECT";
}
'@ | Set-Content -Path $PacPath -Encoding ASCII

    $py=Resolve-Python
    $out=Join-Path $RuntimeDir 'pac.out.log'; $err=Join-Path $RuntimeDir 'pac.err.log'
    Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
    Start-Process $py.Exe -ArgumentList ($py.ArgsPrefix + '-m http.server 8765 --bind 127.0.0.1 --directory "' + $env:USERPROFILE + '"') -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    $url='http://127.0.0.1:8765/simnet-vast.pac'
    $deadline=(Get-Date).AddSeconds(10)
    do {
        try {
            $r=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
            if ($r.StatusCode -eq 200 -and $r.Content.Contains('SOCKS5 127.0.0.1:25344') -and $r.Content.Contains('return "DIRECT";')) { Ok 'PAC=OK'; return }
        } catch {}
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (Test-Path $err) { Write-Host '--- pac.err.log ---'; Get-Content $err -Tail 40 }
    throw 'PAC_START_FAILED'
}

function Start-Forwards {
    Step 'SSH FORWARDS 25344 + 8090'
    $ssh=Resolve-SshExe
    $args=@(Get-SshArgs)
    $args += @('-N','-o','ExitOnForwardFailure=yes','-L','127.0.0.1:8090:127.0.0.1:8000','-L','127.0.0.1:25344:127.0.0.1:25344',("{0}@{1}" -f $VastUser,$VastHost))
    $out=Join-Path $RuntimeDir 'ssh.out.log'; $err=Join-Path $RuntimeDir 'ssh.err.log'
    Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
    $p=Start-Process $ssh -ArgumentList (Join-Args $args) -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $deadline=(Get-Date).AddSeconds(20)
    do {
        if ((Get-NetTCPConnection -LocalPort $SocksPort -State Listen -ErrorAction SilentlyContinue) -and (Get-NetTCPConnection -LocalPort $AsrPort -State Listen -ErrorAction SilentlyContinue)) { Ok "SSH_FORWARDS=OK PID=$($p.Id)"; return }
        if ($p.HasExited) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (Test-Path $err) { Write-Host '--- ssh.err.log ---'; Get-Content $err -Tail 80 }
    throw 'SSH_FORWARD_START_FAILED'
}

function Test-Whisper {
    Step 'WHISPER HEALTH'
    $deadline=(Get-Date).AddSeconds(20)
    do {
        try { $r=Invoke-RestMethod 'http://127.0.0.1:8090/health' -TimeoutSec 3; if ($r.ok) { Ok ("WHISPER=OK model={0} gpu={1}" -f $r.model,$r.gpu); return } } catch {}
        Start-Sleep 1
    } while ((Get-Date) -lt $deadline)
    throw 'WHISPER_HEALTH_FAILED'
}

function Socks-Code([string]$Url) {
    try { return ([string](& curl.exe -k -sS --max-time 8 --socks5-hostname 127.0.0.1:25344 -o NUL -w '%{http_code}' $Url 2>$null)).Trim() } catch { return '000' }
}

function Probe-Services {
    Step 'SERVICE PROBES'
    $b=Socks-Code 'https://admin.simnet.kiev.ua/'
    $u=Socks-Code 'https://userside.simnet.kiev.ua/'
    $p=Socks-Code 'https://pbx.simnet.kiev.ua/'
    Write-Host "BILLING_HTTP=$b"
    Write-Host "USERSIDE_HTTP=$u"
    Write-Host "PBX_HTTP=$p"
    if ($u -eq '000') { Warn 'USERSIDE=DOWN/MAINTENANCE (does not invalidate HOME transport)' }
}

function Start-MicroSip {
    Step 'MICROSIP'
    if ($script:MicroSipPath -and (Test-Path $script:MicroSipPath)) {
        $p=Start-Process $script:MicroSipPath -PassThru
        Start-Sleep 2
        if (Get-Process MicroSIP -ErrorAction SilentlyContinue) { Ok "MICROSIP=RUNNING PID=$($p.Id)"; return }
    }
    Warn 'MICROSIP=NOT_FOUND/NOT_STARTED'
}

function Resolve-Chrome {
    foreach ($p in @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    )) { if ($p -and (Test-Path $p)) { return $p } }
    throw 'CHROME_NOT_FOUND'
}

function Start-Chrome {
    Step 'SIMNET CHROME'
    $chrome=Resolve-Chrome
    $pacUrl='http://127.0.0.1:8765/simnet-vast.pac'
    $args=@('--user-data-dir="'+$ChromeProfile+'"','--load-extension="'+$RepoRoot+'"','--proxy-pac-url="'+$pacUrl+'"','--disable-quic') + $ChromeUrls
    $p=Start-Process $chrome -ArgumentList ($args -join ' ') -PassThru
    Ok "CHROME=STARTED PID=$($p.Id)"
}

function Diagnostics {
    Step 'LIVE DIAGNOSTICS BEFORE CLEANUP'
    Show-Status 'LOCAL STATUS AT FAILURE'
    foreach ($name in @('sing-box.err.log','ssh.err.log','pac.err.log')) {
        $path=Join-Path $RuntimeDir $name
        if (Test-Path $path) { Write-Host "--- $name ---"; Get-Content $path -Tail 60 -ErrorAction SilentlyContinue }
    }
}

try {
    Write-Host 'SIMNET HOME: PREFLIGHT -> STATUS -> KILL -> CLEAN -> REMOTE RESTART -> LOCAL START -> VERIFY' -ForegroundColor White

    # Critical change: do not destroy local state until Vast TCP + SSH auth are proven.
    Resolve-WorkingSshIdentity

    Capture-Paths
    Show-Status 'PRE-START STATUS'
    Kill-Local
    Assert-Clean
    Ensure-WireGuardOff
    Restart-Remote
    Start-Tun
    Start-Pac
    Start-Forwards
    Test-Whisper
    Probe-Services
    Start-MicroSip
    Start-Chrome

    Step 'FINAL VERIFY'
    $tun=Get-NetAdapter -Name $TunName -ErrorAction SilentlyContinue
    $pacOk=$false
    try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/simnet-vast.pac' -TimeoutSec 3; $pacOk=($r.StatusCode -eq 200) } catch {}
    $ready=($tun -and $tun.Status -eq 'Up' -and (Get-NetTCPConnection -LocalPort 25344 -State Listen -ErrorAction SilentlyContinue) -and (Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue) -and $pacOk)
    if (-not $ready) { throw 'FINAL_TRANSPORT_VERIFY_FAILED' }

    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host 'HOME_READY' -ForegroundColor Green
    Write-Host '========================================' -ForegroundColor Green
    exit 0
}
catch {
    $primary=$_.Exception.Message
    Write-Host "`n=== PRIMARY ERROR ===" -ForegroundColor Red
    Write-Host $primary -ForegroundColor Red
    Diagnostics
    Write-Host "`n=== FAILURE CLEANUP ===" -ForegroundColor Yellow
    Kill-Local
    Write-Host "`n========================================" -ForegroundColor Red
    Write-Host 'HOME_START_FAILED' -ForegroundColor Red
    Write-Host "PRIMARY_ERROR=$primary" -ForegroundColor Red
    Write-Host 'Local HOME processes were cleaned after diagnostics.' -ForegroundColor Red
    Write-Host '========================================' -ForegroundColor Red
    exit 1
}
