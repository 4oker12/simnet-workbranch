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

New-Item -ItemType Directory -Force -Path $cfg.RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $cfg.ChromeUserDataDir | Out-Null

$state = [ordered]@{
    version = 1
    startedAt = (Get-Date).ToString('o')
    ready = $false
    wireGuardWasRunning = $false
    singBoxPid = $null
    singBoxOwned = $false
    pacPid = $null
    pacOwned = $false
    sshPid = $null
    sshOwned = $false
    chromePid = $null
    chromeOwned = $false
    lastError = $null
}

function Save-State {
    $state | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -Path $cfg.StateFile
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

function Resolve-SingBoxExe {
    $cmd = Get-Command 'sing-box.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $pkgRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\SagerNet.sing-box_Microsoft.Winget.Source_8wekyb3d8bbwe'
    if (Test-Path $pkgRoot) {
        $candidate = Get-ChildItem -Path $pkgRoot -Recurse -Filter 'sing-box.exe' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }

    throw 'sing-box.exe not found. Install sing-box or add it to PATH.'
}

function Resolve-ChromeExe {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path $_) }
    if ($candidates.Count -gt 0) { return $candidates[0] }
    throw 'chrome.exe not found.'
}

function Resolve-PythonLauncher {
    $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($py) { return @{ File = $py.Source; Prefix = '-3 ' } }
    $python = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($python) { return @{ File = $python.Source; Prefix = '' } }
    throw 'Python 3 launcher not found (py.exe/python.exe).'
}

function Test-PacServer([string]$Url) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
        return ($r.StatusCode -eq 200 -and $r.Content -match 'SOCKS5 127\.0\.0\.1:25344')
    } catch {
        return $false
    }
}

function Find-MatchingProcess([string]$Name, [string]$Needle) {
    $items = Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        if ($item.CommandLine -and $item.CommandLine.IndexOf($Needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $item
        }
    }
    return $null
}

function Stop-OwnedProcess([Nullable[int]]$Pid, [bool]$Owned) {
    if (-not $Owned -or $null -eq $Pid) { return }
    Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue
}

$pacName = Split-Path -Leaf $cfg.PacPath
$pacUrl = 'http://127.0.0.1:{0}/{1}' -f $cfg.PacPort, $pacName
$sshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'

try {
    Write-Host '[1/7] Preparing HOME route...'

    if ($cfg.StopConflictingWireGuard) {
        $wg = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
        if ($wg -and $wg.Status -eq 'Running') {
            Stop-Service -Name $cfg.WireGuardService -Force
            $state.wireGuardWasRunning = $true
            Wait-Until { (Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue).Status -ne 'Running' } 8 'WireGuard service did not stop.'
            Write-Host '  legacy WireGuard: stopped for HOME/Vast mode'
        } else {
            Write-Host '  legacy WireGuard: already stopped/not installed'
        }
    }

    # No here-strings: this stays safe when copied/edited in PowerShell.
    @(
        'function FindProxyForURL(url, host) {'
        '    if ('
        '        host == "simnet.kiev.ua" ||'
        '        host == "admin.simnet.kiev.ua" ||'
        '        host == "userside.simnet.kiev.ua" ||'
        '        host == "pbx.simnet.kiev.ua"'
        '    ) {'
        '        return "SOCKS5 127.0.0.1:25344";'
        '    }'
        '    return "DIRECT";'
        '}'
    ) | Set-Content -Encoding ASCII -Path $cfg.PacPath

    Write-Host '[2/7] Starting SIP sing-box/TUN...'
    if (-not (Test-Path $cfg.SingBoxConfig)) {
        throw ('sing-box config not found: {0}' -f $cfg.SingBoxConfig)
    }

    $existingSingBox = Find-MatchingProcess 'sing-box.exe' $cfg.SingBoxConfig
    if ($existingSingBox) {
        $state.singBoxPid = [int]$existingSingBox.ProcessId
        $state.singBoxOwned = $false
        Write-Host ('  sing-box: already running PID {0}' -f $state.singBoxPid)
    } else {
        $singBoxExe = Resolve-SingBoxExe
        $sbOut = Join-Path $cfg.RuntimeDir 'sing-box.out.log'
        $sbErr = Join-Path $cfg.RuntimeDir 'sing-box.err.log'
        Remove-Item $sbOut,$sbErr -Force -ErrorAction SilentlyContinue
        $sbArgs = 'run -c "{0}"' -f $cfg.SingBoxConfig
        $p = Start-Process -FilePath $singBoxExe -ArgumentList $sbArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $sbOut -RedirectStandardError $sbErr
        $state.singBoxPid = [int]$p.Id
        $state.singBoxOwned = $true
        Write-Host ('  sing-box: started PID {0}' -f $state.singBoxPid)
    }

    Wait-Until {
        $adapter = Get-NetAdapter -Name $cfg.SingBoxTunName -ErrorAction SilentlyContinue
        $adapter -and $adapter.Status -eq 'Up'
    } $cfg.StartTimeoutSeconds ('TUN adapter {0} did not become Up.' -f $cfg.SingBoxTunName)
    Write-Host ('  TUN {0}: UP' -f $cfg.SingBoxTunName)

    Write-Host '[3/7] Starting PAC server...'
    $pacListenerPid = Get-ListeningPid $cfg.PacPort
    if ($pacListenerPid) {
        if (-not (Test-PacServer $pacUrl)) {
            throw ('Port {0} is occupied by PID {1}, but it is not serving the Workbench PAC.' -f $cfg.PacPort, $pacListenerPid)
        }
        $state.pacPid = $pacListenerPid
        $state.pacOwned = $false
        Write-Host ('  PAC: already available on :{0}' -f $cfg.PacPort)
    } else {
        $python = Resolve-PythonLauncher
        $pacOut = Join-Path $cfg.RuntimeDir 'pac.out.log'
        $pacErr = Join-Path $cfg.RuntimeDir 'pac.err.log'
        Remove-Item $pacOut,$pacErr -Force -ErrorAction SilentlyContinue
        $args = '{0}-m http.server {1} --bind 127.0.0.1 --directory "{2}"' -f $python.Prefix, $cfg.PacPort, $cfg.PacDirectory
        Start-Process -FilePath $python.File -ArgumentList $args -WindowStyle Hidden -RedirectStandardOutput $pacOut -RedirectStandardError $pacErr | Out-Null
        Wait-Until { (Get-ListeningPid $cfg.PacPort) -ne $null } 8 ('PAC server did not listen on :{0}.' -f $cfg.PacPort)
        $state.pacPid = Get-ListeningPid $cfg.PacPort
        $state.pacOwned = $true
        Wait-Until { Test-PacServer $pacUrl } 5 'PAC server started but PAC file is not reachable.'
        Write-Host ('  PAC: http://127.0.0.1:{0}/{1}' -f $cfg.PacPort, $pacName)
    }

    Write-Host '[4/7] Starting SSH SOCKS/ASR forwards...'
    if (-not (Test-Path $sshExe)) { throw ('ssh.exe not found: {0}' -f $sshExe) }

    $socksOwner = Get-ListeningPid $cfg.LocalSocksPort
    $asrOwner = Get-ListeningPid $cfg.LocalAsrPort
    if ($socksOwner -or $asrOwner) {
        if (-not ($socksOwner -and $asrOwner -and $socksOwner -eq $asrOwner)) {
            throw ('Ports {0}/{1} are not owned by one existing SSH process.' -f $cfg.LocalSocksPort, $cfg.LocalAsrPort)
        }
        $cmdLine = Get-ProcessCommandLine $socksOwner
        $looksRight = $cmdLine -match [regex]::Escape($cfg.VastHost) -and
                      $cmdLine -match ('127\.0\.0\.1:{0}:127\.0\.0\.1:{1}' -f $cfg.LocalSocksPort, $cfg.RemoteSocksPort) -and
                      $cmdLine -match ('127\.0\.0\.1:{0}:127\.0\.0\.1:{1}' -f $cfg.LocalAsrPort, $cfg.RemoteAsrPort)
        if (-not $looksRight) {
            throw ('Ports {0}/{1} are occupied by PID {2}, but it is not the expected Vast SSH tunnel.' -f $cfg.LocalSocksPort, $cfg.LocalAsrPort, $socksOwner)
        }
        $state.sshPid = $socksOwner
        $state.sshOwned = $false
        Write-Host ('  SSH: already running PID {0}' -f $state.sshPid)
    } else {
        $sshOut = Join-Path $cfg.RuntimeDir 'ssh.out.log'
        $sshErr = Join-Path $cfg.RuntimeDir 'ssh.err.log'
        Remove-Item $sshOut,$sshErr -Force -ErrorAction SilentlyContinue
        $sshArgs = '-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:{0}:{1}:{2} -L 127.0.0.1:{3}:{4}:{5} -p {6} {7}@{8}' -f \
            $cfg.LocalAsrPort, $cfg.RemoteAsrHost, $cfg.RemoteAsrPort, \
            $cfg.LocalSocksPort, $cfg.RemoteSocksHost, $cfg.RemoteSocksPort, \
            $cfg.VastSshPort, $cfg.VastUser, $cfg.VastHost
        $p = Start-Process -FilePath $sshExe -ArgumentList $sshArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $sshOut -RedirectStandardError $sshErr
        $state.sshPid = [int]$p.Id
        $state.sshOwned = $true
        Wait-Until { (Get-ListeningPid $cfg.LocalAsrPort) -eq $state.sshPid } $cfg.StartTimeoutSeconds ('ASR forward :{0} did not start.' -f $cfg.LocalAsrPort)
        Wait-Until { (Get-ListeningPid $cfg.LocalSocksPort) -eq $state.sshPid } $cfg.StartTimeoutSeconds ('SOCKS forward :{0} did not start.' -f $cfg.LocalSocksPort)
        Write-Host ('  SSH: started PID {0}' -f $state.sshPid)
    }

    Write-Host '[5/7] Checking Whisper...'
    $asr = $null
    Wait-Until {
        try {
            $script:asr = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3
            return [bool]$script:asr.ok
        } catch {
            return $false
        }
    } $cfg.StartTimeoutSeconds 'Whisper /health failed through localhost:8090.'
    Write-Host ('  ASR: OK ({0}, {1}, {2})' -f $asr.model, $asr.device, $asr.gpu)

    Write-Host '[6/7] Checking SIMNET/PBX through Vast SOCKS...'
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if (-not $curl) { throw 'curl.exe not found.' }
    & $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -fsS --max-time 10 -o NUL $cfg.SimnetProbeUrl
    if ($LASTEXITCODE -ne 0) { throw 'SIMNET probe failed through Vast SOCKS.' }
    & $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -fsSI --max-time 10 -o NUL $cfg.PbxProbeUrl
    if ($LASTEXITCODE -ne 0) { throw 'PBX probe failed through Vast SOCKS.' }
    Write-Host '  SIMNET: OK'
    Write-Host '  PBX: OK'

    Write-Host '[7/7] Starting isolated Workbench Chrome...'
    $chromeNeedle = '--user-data-dir=' + $cfg.ChromeUserDataDir
    $existingChrome = Find-MatchingProcess 'chrome.exe' $chromeNeedle
    if ($existingChrome) {
        $state.chromePid = [int]$existingChrome.ProcessId
        $state.chromeOwned = $false
        Write-Host ('  Chrome: Workbench profile already running PID {0}' -f $state.chromePid)
    } else {
        $chromeExe = Resolve-ChromeExe
        $chromeArgs = '--user-data-dir="{0}" --proxy-pac-url="{1}" --disable-quic' -f $cfg.ChromeUserDataDir, $pacUrl
        $p = Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs -PassThru
        $state.chromePid = [int]$p.Id
        $state.chromeOwned = $true
        Write-Host ('  Chrome: started PID {0}' -f $state.chromePid)
    }

    $state.ready = $true
    Save-State
    Write-Host ''
    Write-Host '=== WORKBENCH HOME: READY ===' -ForegroundColor Green
    Write-Host ('SIP/TUN  : {0} UP' -f $cfg.SingBoxTunName)
    Write-Host ('SOCKS    : 127.0.0.1:{0}' -f $cfg.LocalSocksPort)
    Write-Host ('ASR      : 127.0.0.1:{0} -> Vast:{1}' -f $cfg.LocalAsrPort, $cfg.RemoteAsrPort)
    Write-Host ('PAC      : {0}' -f $pacUrl)
    Write-Host 'Vast     : untouched'
    exit 0
}
catch {
    $state.lastError = $_.Exception.Message
    $state.ready = $false
    Save-State
    Write-Host ''
    Write-Host ('=== WORKBENCH HOME: ERROR === {0}' -f $state.lastError) -ForegroundColor Red

    Stop-OwnedProcess $state.chromePid $state.chromeOwned
    Stop-OwnedProcess $state.sshPid $state.sshOwned
    Stop-OwnedProcess $state.pacPid $state.pacOwned
    Stop-OwnedProcess $state.singBoxPid $state.singBoxOwned

    if ($state.wireGuardWasRunning) {
        Start-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
    }

    Write-Host ('Runtime logs: {0}' -f $cfg.RuntimeDir)
    exit 1
}
