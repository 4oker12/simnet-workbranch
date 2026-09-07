[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot = Split-Path -Parent $ScriptDir
. (Join-Path $ScriptDir 'workbench-home.config.ps1')
$cfg = $WorkbenchHomeConfig

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $elevatedArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $elevatedArgs | Out-Null
    exit 0
}

New-Item -ItemType Directory -Force -Path $cfg.RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $cfg.ChromeUserDataDir | Out-Null

$previous = $null
if (Test-Path $cfg.StateFile) {
    try { $previous = Get-Content -Raw -Path $cfg.StateFile | ConvertFrom-Json } catch { $previous = $null }
}

$state = [ordered]@{
    version = 2
    startedAt = (Get-Date).ToString('o')
    ready = $false
    legacyWireGuardWasRunning = $false
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

function Test-PreviouslyOwned([string]$Kind, [int]$Pid) {
    if ($null -eq $previous) { return $false }
    $pidName = $Kind + 'Pid'
    $ownedName = $Kind + 'Owned'
    $pidProp = $previous.PSObject.Properties[$pidName]
    $ownedProp = $previous.PSObject.Properties[$ownedName]
    if ($null -eq $pidProp -or $null -eq $ownedProp) { return $false }
    return ([int]$pidProp.Value -eq $Pid -and [bool]$ownedProp.Value)
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
        $candidate = Get-ChildItem -Path $pkgRoot -Recurse -Filter 'sing-box.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }
    throw 'sing-box.exe not found.'
}

function Resolve-ChromeExe {
    $paths = @()
    if ($env:ProgramFiles) { $paths += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe') }
    if (${env:ProgramFiles(x86)}) { $paths += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe') }
    foreach ($path in $paths) { if ($path -and (Test-Path $path)) { return $path } }
    throw 'chrome.exe not found.'
}

function Resolve-PythonLauncher {
    $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($py) { return @{ File = $py.Source; Prefix = '-3 ' } }
    $python = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($python) { return @{ File = $python.Source; Prefix = '' } }
    throw 'Python 3 launcher not found.'
}

function Find-MatchingProcess([string]$Name, [string[]]$Needles) {
    $items = Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        $line = [string]$item.CommandLine
        if (-not $line) { continue }
        $match = $true
        foreach ($needle in $Needles) {
            if ($line.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) { $match = $false; break }
        }
        if ($match) { return $item }
    }
    return $null
}

function Test-PacServer([string]$Url) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
        $needle = 'SOCKS5 127.0.0.1:{0}' -f $cfg.LocalSocksPort
        return ($r.StatusCode -eq 200 -and $r.Content.Contains($needle))
    } catch { return $false }
}

function Stop-OwnedProcess([Nullable[int]]$Pid, [bool]$Owned) {
    if ($Owned -and $null -ne $Pid) { Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue }
}

$pacName = Split-Path -Leaf $cfg.PacPath
$pacUrl = 'http://127.0.0.1:{0}/{1}' -f $cfg.PacPort, $pacName
$sshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'

try {
    Write-Host '[1/7] HOME route'
    if ($cfg.StopConflictingWireGuard) {
        $wg = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
        if ($wg -and $wg.Status -eq 'Running') {
            $state.legacyWireGuardWasRunning = $true
            Stop-Service -Name $cfg.WireGuardService -Force
            Wait-Until { $svc = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue; (-not $svc) -or $svc.Status -ne 'Running' } 8 'Legacy WireGuard did not stop.'
            Write-Host '  legacy WireGuard: OFF'
        } else { Write-Host '  legacy WireGuard: already OFF' }
    }

    @(
        'function FindProxyForURL(url, host) {'
        '    if ('
        '        host == "simnet.kiev.ua" ||'
        '        host == "admin.simnet.kiev.ua" ||'
        '        host == "userside.simnet.kiev.ua" ||'
        '        host == "pbx.simnet.kiev.ua"'
        '    ) {'
        ('        return "SOCKS5 127.0.0.1:{0}";' -f $cfg.LocalSocksPort)
        '    }'
        '    return "DIRECT";'
        '}'
    ) | Set-Content -Encoding ASCII -Path $cfg.PacPath

    Write-Host '[2/7] SIP sing-box/TUN'
    if (-not (Test-Path $cfg.SingBoxConfig)) { throw ('sing-box config not found: {0}' -f $cfg.SingBoxConfig) }
    $existingSingBox = Find-MatchingProcess 'sing-box.exe' @($cfg.SingBoxConfig)
    if ($existingSingBox) {
        $state.singBoxPid = [int]$existingSingBox.ProcessId
        $state.singBoxOwned = Test-PreviouslyOwned 'singBox' $state.singBoxPid
        Write-Host ('  sing-box: reuse PID {0}' -f $state.singBoxPid)
    } else {
        $singBoxExe = Resolve-SingBoxExe
        $sbOut = Join-Path $cfg.RuntimeDir 'sing-box.out.log'
        $sbErr = Join-Path $cfg.RuntimeDir 'sing-box.err.log'
        Remove-Item $sbOut,$sbErr -Force -ErrorAction SilentlyContinue
        $sbArgs = 'run -c "{0}"' -f $cfg.SingBoxConfig
        $p = Start-Process -FilePath $singBoxExe -ArgumentList $sbArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $sbOut -RedirectStandardError $sbErr
        $state.singBoxPid = [int]$p.Id
        $state.singBoxOwned = $true
        Save-State
        Write-Host ('  sing-box: start PID {0}' -f $state.singBoxPid)
    }
    Wait-Until { $adapter = Get-NetAdapter -Name $cfg.SingBoxTunName -ErrorAction SilentlyContinue; $adapter -and $adapter.Status -eq 'Up' } $cfg.StartTimeoutSeconds ('TUN {0} did not become Up.' -f $cfg.SingBoxTunName)
    Write-Host ('  {0}: UP' -f $cfg.SingBoxTunName)

    Write-Host '[3/7] PAC server'
    $pacListenerPid = Get-ListeningPid $cfg.PacPort
    if ($pacListenerPid) {
        if (-not (Test-PacServer $pacUrl)) { throw ('Port {0} is occupied by PID {1}, not Workbench PAC.' -f $cfg.PacPort, $pacListenerPid) }
        $state.pacPid = $pacListenerPid
        $state.pacOwned = Test-PreviouslyOwned 'pac' $state.pacPid
        Write-Host ('  PAC: reuse PID {0}' -f $state.pacPid)
    } else {
        $python = Resolve-PythonLauncher
        $pacOut = Join-Path $cfg.RuntimeDir 'pac.out.log'
        $pacErr = Join-Path $cfg.RuntimeDir 'pac.err.log'
        Remove-Item $pacOut,$pacErr -Force -ErrorAction SilentlyContinue
        $pacArgs = '{0}-m http.server {1} --bind 127.0.0.1 --directory "{2}"' -f $python.Prefix, $cfg.PacPort, $cfg.PacDirectory
        Start-Process -FilePath $python.File -ArgumentList $pacArgs -WindowStyle Hidden -RedirectStandardOutput $pacOut -RedirectStandardError $pacErr | Out-Null
        Wait-Until { (Get-ListeningPid $cfg.PacPort) -ne $null } 8 ('PAC server did not listen on :{0}.' -f $cfg.PacPort)
        $state.pacPid = Get-ListeningPid $cfg.PacPort
        $state.pacOwned = $true
        Save-State
        Wait-Until { Test-PacServer $pacUrl } 5 'PAC file is not reachable.'
        Write-Host ('  PAC: start PID {0}' -f $state.pacPid)
    }

    Write-Host '[4/7] SSH forwards'
    if (-not (Test-Path $sshExe)) { throw ('ssh.exe not found: {0}' -f $sshExe) }
    $socksOwner = Get-ListeningPid $cfg.LocalSocksPort
    $asrOwner = Get-ListeningPid $cfg.LocalAsrPort
    if ($socksOwner -or $asrOwner) {
        if (-not ($socksOwner -and $asrOwner -and $socksOwner -eq $asrOwner)) { throw ('Ports {0}/{1} are not owned by one process.' -f $cfg.LocalSocksPort, $cfg.LocalAsrPort) }
        $cmdLine = Get-ProcessCommandLine $socksOwner
        $asrSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort, $cfg.RemoteAsrHost, $cfg.RemoteAsrPort
        $socksSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalSocksPort, $cfg.RemoteSocksHost, $cfg.RemoteSocksPort
        if ($cmdLine.IndexOf($cfg.VastHost, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $cmdLine.IndexOf($asrSpec, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $cmdLine.IndexOf($socksSpec, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw ('Ports {0}/{1} belong to PID {2}, not expected Vast tunnel.' -f $cfg.LocalSocksPort, $cfg.LocalAsrPort, $socksOwner)
        }
        $state.sshPid = $socksOwner
        $state.sshOwned = Test-PreviouslyOwned 'ssh' $state.sshPid
        Write-Host ('  SSH: reuse PID {0}' -f $state.sshPid)
    } else {
        $sshOut = Join-Path $cfg.RuntimeDir 'ssh.out.log'
        $sshErr = Join-Path $cfg.RuntimeDir 'ssh.err.log'
        Remove-Item $sshOut,$sshErr -Force -ErrorAction SilentlyContinue
        $sshArgs = '-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:{0}:{1}:{2} -L 127.0.0.1:{3}:{4}:{5} -p {6} {7}@{8}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort,$cfg.LocalSocksPort,$cfg.RemoteSocksHost,$cfg.RemoteSocksPort,$cfg.VastSshPort,$cfg.VastUser,$cfg.VastHost
        $p = Start-Process -FilePath $sshExe -ArgumentList $sshArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $sshOut -RedirectStandardError $sshErr
        $state.sshPid = [int]$p.Id
        $state.sshOwned = $true
        Save-State
        Wait-Until { (Get-ListeningPid $cfg.LocalAsrPort) -eq $state.sshPid } $cfg.StartTimeoutSeconds ('ASR forward :{0} did not start.' -f $cfg.LocalAsrPort)
        Wait-Until { (Get-ListeningPid $cfg.LocalSocksPort) -eq $state.sshPid } $cfg.StartTimeoutSeconds ('SOCKS forward :{0} did not start.' -f $cfg.LocalSocksPort)
        Write-Host ('  SSH: start PID {0}' -f $state.sshPid)
    }

    Write-Host '[5/7] Whisper health'
    $script:asrHealth = $null
    Wait-Until { try { $script:asrHealth = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3; [bool]$script:asrHealth.ok } catch { $false } } $cfg.StartTimeoutSeconds 'Whisper /health failed through localhost:8090.'
    Write-Host ('  ASR: OK {0} / {1}' -f $script:asrHealth.model, $script:asrHealth.gpu)

    Write-Host '[6/7] SIMNET/PBX probe'
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if (-not $curl) { throw 'curl.exe not found.' }
    & $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -fsS --max-time 10 -o NUL $cfg.SimnetProbeUrl
    if ($LASTEXITCODE -ne 0) { throw 'SIMNET probe failed through Vast SOCKS.' }
    & $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -fsSI --max-time 10 -o NUL $cfg.PbxProbeUrl
    if ($LASTEXITCODE -ne 0) { throw 'PBX probe failed through Vast SOCKS.' }
    Write-Host '  SIMNET: OK'
    Write-Host '  PBX: OK'

    Write-Host '[7/7] Workbench Chrome'
    $chromeNeedles = @('--user-data-dir', $cfg.ChromeUserDataDir)
    $existingChrome = Find-MatchingProcess 'chrome.exe' $chromeNeedles
    if ($existingChrome) {
        $state.chromePid = [int]$existingChrome.ProcessId
        $state.chromeOwned = Test-PreviouslyOwned 'chrome' $state.chromePid
        Write-Host ('  Chrome: reuse Workbench profile PID {0}' -f $state.chromePid)
    } else {
        $chromeExe = Resolve-ChromeExe
        $chromeArgs = '--user-data-dir="{0}" --load-extension="{1}" --proxy-pac-url="{2}" --disable-quic' -f $cfg.ChromeUserDataDir, $RepoRoot, $pacUrl
        $p = Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs -PassThru
        $state.chromePid = [int]$p.Id
        $state.chromeOwned = $true
        Save-State
        Write-Host ('  Chrome: start PID {0}' -f $state.chromePid)
    }

    $state.ready = $true
    $state.lastError = $null
    Save-State
    Write-Host ''
    Write-Host '=== WORKBENCH HOME: READY ===' -ForegroundColor Green
    Write-Host ('SIP/TUN : {0} UP' -f $cfg.SingBoxTunName)
    Write-Host ('SOCKS   : 127.0.0.1:{0}' -f $cfg.LocalSocksPort)
    Write-Host ('ASR     : 127.0.0.1:{0}' -f $cfg.LocalAsrPort)
    Write-Host ('PAC     : {0}' -f $pacUrl)
    Write-Host 'Vast    : untouched'
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
    Write-Host ('Runtime logs: {0}' -f $cfg.RuntimeDir)
    Write-Host 'Legacy HOME WireGuard remains OFF by design.'
    exit 1
}
