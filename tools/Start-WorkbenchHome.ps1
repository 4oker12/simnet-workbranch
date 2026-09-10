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
    $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $elevatedArgs -Wait -PassThru
    exit $child.ExitCode
}

New-Item -ItemType Directory -Force -Path $cfg.RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $cfg.ChromeUserDataDir | Out-Null

$previous = $null
if (Test-Path $cfg.StateFile) {
    try { $previous = Get-Content -Raw -Path $cfg.StateFile | ConvertFrom-Json } catch { $previous = $null }
}

$state = [ordered]@{
    version = 4
    startedAt = (Get-Date).ToString('o')
    ready = $false
    browserReady = $false
    sipReady = $false
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

function Test-PreviouslyOwned([string]$Kind, [int]$ProcessId) {
    if ($null -eq $previous) { return $false }
    $pidName = $Kind + 'Pid'
    $ownedName = $Kind + 'Owned'
    $pidProp = $previous.PSObject.Properties[$pidName]
    $ownedProp = $previous.PSObject.Properties[$ownedName]
    if ($null -eq $pidProp -or $null -eq $ownedProp) { return $false }
    return ([int]$pidProp.Value -eq $ProcessId -and [bool]$ownedProp.Value)
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
        Start-Sleep -Milliseconds 400
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
    throw 'sing-box.exe not found.'
}

function Resolve-ChromeExe {
    $paths = @()
    if ($env:ProgramFiles) { $paths += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe') }
    if (${env:ProgramFiles(x86)}) { $paths += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe') }
    foreach ($path in $paths) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    throw 'chrome.exe not found.'
}

function Find-MatchingProcess([string]$Name, [string[]]$Needles) {
    $items = Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        $line = [string]$item.CommandLine
        if (-not $line) { continue }
        $match = $true
        foreach ($needle in $Needles) {
            if ($line.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                $match = $false
                break
            }
        }
        if ($match) { return $item }
    }
    return $null
}

function Stop-OwnedProcess([Nullable[int]]$ProcessId, [bool]$Owned) {
    if ($Owned -and $null -ne $ProcessId) {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Write-RuntimeSingBoxConfig {
    if (-not (Test-Path $cfg.SingBoxConfig)) {
        throw ('sing-box source config not found: {0}' -f $cfg.SingBoxConfig)
    }
    $client = Get-Content -Raw -Path $cfg.SingBoxConfig | ConvertFrom-Json
    $ss = $client.outbounds | Where-Object { $_.type -eq 'shadowsocks' } | Select-Object -First 1
    if (-not $ss) { throw 'No Shadowsocks outbound found in local sing-box client config.' }
    $ss.server = '127.0.0.1'
    $ss.server_port = [int]$cfg.LocalShadowsocksPort
    $json = $client | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText(
        $cfg.RuntimeSingBoxClientConfig,
        $json,
        (New-Object Text.UTF8Encoding($false))
    )
}

function Test-SocksHttp([string]$Url) {
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if (-not $curl) { return @{ Ok = $false; Code = '000' } }
    try {
        $code = (& $curl.Source --socks5-hostname ('127.0.0.1:{0}' -f $cfg.LocalSocksPort) -k -sS --connect-timeout 5 --max-time 10 -o NUL -w '%{http_code}' $Url 2>$null | Select-Object -Last 1)
        $exitCode = $LASTEXITCODE
        $code = [string]$code
        return @{ Ok = ($exitCode -eq 0 -and $code -match '^[23]\d\d$'); Code = $code }
    } catch {
        return @{ Ok = $false; Code = '000' }
    }
}

$pacPath = [IO.Path]::GetFullPath($cfg.PacPath)
$pacUri = 'file:///' + $pacPath.Replace('\','/')
$sshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$browserCoreReady = $false

try {
    Write-Host '[1/6] HOME browser route / PAC'
    if ($cfg.StopConflictingWireGuard) {
        $wg = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
        if ($wg -and $wg.Status -eq 'Running') {
            $state.legacyWireGuardWasRunning = $true
            Stop-Service -Name $cfg.WireGuardService -Force
            Wait-Until {
                $svc = Get-Service -Name $cfg.WireGuardService -ErrorAction SilentlyContinue
                (-not $svc) -or $svc.Status -ne 'Running'
            } 8 'Legacy WireGuard did not stop.'
            Write-Host '  legacy WireGuard: OFF'
        } else {
            Write-Host '  legacy WireGuard: already OFF'
        }
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
    Write-Host ('  PAC: {0}' -f $pacUri)

    Write-Host '[2/6] SSH forwards'
    if (-not (Test-Path $sshExe)) { throw ('ssh.exe not found: {0}' -f $sshExe) }

    $asrSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalAsrPort,$cfg.RemoteAsrHost,$cfg.RemoteAsrPort
    $socksSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalSocksPort,$cfg.RemoteSocksHost,$cfg.RemoteSocksPort
    $ssSpec = '127.0.0.1:{0}:{1}:{2}' -f $cfg.LocalShadowsocksPort,$cfg.RemoteShadowsocksHost,$cfg.RemoteShadowsocksPort

    $asrOwner = Get-ListeningPid $cfg.LocalAsrPort
    $socksOwner = Get-ListeningPid $cfg.LocalSocksPort
    $ssOwner = Get-ListeningPid $cfg.LocalShadowsocksPort

    $canReuse = $asrOwner -and $socksOwner -and $ssOwner -and
        $asrOwner -eq $socksOwner -and $asrOwner -eq $ssOwner

    if ($canReuse) {
        $cmdLine = Get-ProcessCommandLine $asrOwner
        $canReuse = $cmdLine.IndexOf($cfg.VastHost,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $cmdLine.IndexOf($asrSpec,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $cmdLine.IndexOf($socksSpec,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $cmdLine.IndexOf($ssSpec,[StringComparison]::OrdinalIgnoreCase) -ge 0
    }

    if ($canReuse) {
        $state.sshPid = [int]$asrOwner
        $state.sshOwned = Test-PreviouslyOwned 'ssh' $state.sshPid
        Write-Host ('  SSH: reuse PID {0} / ASR+SOCKS+SS' -f $state.sshPid)
    } else {
        $owners = @($asrOwner,$socksOwner,$ssOwner) |
            Where-Object { $null -ne $_ } |
            Select-Object -Unique

        foreach ($owner in $owners) {
            $line = Get-ProcessCommandLine ([int]$owner)
            if ($line -and
                $line.IndexOf($cfg.VastHost,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                $line.IndexOf('ssh.exe',[StringComparison]::OrdinalIgnoreCase) -ge 0) {
                Stop-Process -Id ([int]$owner) -Force -ErrorAction SilentlyContinue
            } else {
                throw ('Required HOME port is occupied by unrelated PID {0}.' -f $owner)
            }
        }

        Wait-Until {
            -not (Get-ListeningPid $cfg.LocalAsrPort) -and
            -not (Get-ListeningPid $cfg.LocalSocksPort) -and
            -not (Get-ListeningPid $cfg.LocalShadowsocksPort)
        } 8 'Old SSH forwards did not stop.'

        $sshOut = Join-Path $cfg.RuntimeDir 'ssh.out.log'
        $sshErr = Join-Path $cfg.RuntimeDir 'ssh.err.log'
        Remove-Item $sshOut,$sshErr -Force -ErrorAction SilentlyContinue

        $sshArgs = @(
            '-N',
            '-o','BatchMode=yes',
            '-o','StrictHostKeyChecking=accept-new',
            '-o','ExitOnForwardFailure=yes',
            '-o','ConnectTimeout=10',
            '-o','ServerAliveInterval=30',
            '-o','ServerAliveCountMax=3'
        )
        $sshArgs += Resolve-SshIdentityArgs
        $sshArgs += @(
            '-L',$asrSpec,
            '-L',$socksSpec,
            '-L',$ssSpec,
            '-p',[string]$cfg.VastSshPort,
            ('{0}@{1}' -f $cfg.VastUser,$cfg.VastHost)
        )

        $sshProcess = Start-Process -FilePath $sshExe -ArgumentList $sshArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $sshOut -RedirectStandardError $sshErr
        $state.sshPid = [int]$sshProcess.Id
        $state.sshOwned = $true
        Save-State

        Wait-Until { (Get-ListeningPid $cfg.LocalAsrPort) -eq $state.sshPid } $cfg.StartTimeoutSeconds ('ASR forward :{0} did not start.' -f $cfg.LocalAsrPort)
        Wait-Until { (Get-ListeningPid $cfg.LocalSocksPort) -eq $state.sshPid } $cfg.StartTimeoutSeconds ('SOCKS forward :{0} did not start.' -f $cfg.LocalSocksPort)
        Wait-Until { (Get-ListeningPid $cfg.LocalShadowsocksPort) -eq $state.sshPid } $cfg.StartTimeoutSeconds ('Shadowsocks bridge :{0} did not start.' -f $cfg.LocalShadowsocksPort)
        Write-Host ('  SSH: start PID {0} / ASR+SOCKS+SS' -f $state.sshPid)
    }

    Write-Host '[3/6] Browser route probe'
    $pbx = Test-SocksHttp $cfg.PbxProbeUrl
    if (-not $pbx.Ok) {
        throw ('PBX through localhost:{0} failed (HTTP {1}).' -f $cfg.LocalSocksPort,$pbx.Code)
    }
    Write-Host ('  PBX: HTTP {0} via Vast SOCKS' -f $pbx.Code)

    Write-Host '[4/6] Work Chrome'
    $chromeNeedles = @('--user-data-dir', $cfg.ChromeUserDataDir)
    $existingChrome = Find-MatchingProcess 'chrome.exe' $chromeNeedles

    if ($existingChrome) {
        $line = [string]$existingChrome.CommandLine
        $usesExpectedPac = $line.IndexOf($pacUri,[StringComparison]::OrdinalIgnoreCase) -ge 0
        $usesGlobalProxy = $line.IndexOf('--proxy-server',[StringComparison]::OrdinalIgnoreCase) -ge 0
        if (-not $usesExpectedPac -or $usesGlobalProxy) {
            Write-Host '  Chrome: restarting dedicated HOME profile with file PAC'
            $profileProcesses = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.CommandLine -and
                    $_.CommandLine.IndexOf($cfg.ChromeUserDataDir,[StringComparison]::OrdinalIgnoreCase) -ge 0
                }
            foreach ($item in $profileProcesses) {
                Stop-Process -Id ([int]$item.ProcessId) -Force -ErrorAction SilentlyContinue
            }
            Wait-Until { $null -eq (Find-MatchingProcess 'chrome.exe' $chromeNeedles) } 8 'HOME Chrome profile did not stop.'
            $existingChrome = $null
        }
    }

    if ($existingChrome) {
        $state.chromePid = [int]$existingChrome.ProcessId
        $state.chromeOwned = Test-PreviouslyOwned 'chrome' $state.chromePid
        Write-Host ('  Chrome: reuse PID {0}' -f $state.chromePid)
    } else {
        $chromeExe = Resolve-ChromeExe
        $chromeArgs = @(
            '--new-window',
            ('--user-data-dir="{0}"' -f $cfg.ChromeUserDataDir),
            ('--load-extension="{0}"' -f $RepoRoot),
            ('--proxy-pac-url="{0}"' -f $pacUri),
            '--disable-quic',
            '--no-first-run',
            $cfg.UsersideUrl,
            $cfg.BillingUrl,
            $cfg.PbxProbeUrl
        )
        Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs | Out-Null
        Wait-Until { $null -ne (Find-MatchingProcess 'chrome.exe' $chromeNeedles) } 10 'Chrome HOME profile did not start.'
        $startedChrome = Find-MatchingProcess 'chrome.exe' $chromeNeedles
        $state.chromePid = [int]$startedChrome.ProcessId
        $state.chromeOwned = $true
        Write-Host ('  Chrome: start PID {0}' -f $state.chromePid)
    }

    $state.browserReady = $true
    $browserCoreReady = $true
    Save-State

    Write-Host '[5/6] Whisper health'
    $script:asrHealth = $null
    Wait-Until {
        try {
            $script:asrHealth = Invoke-RestMethod -Uri $cfg.AsrHealthUrl -TimeoutSec 3
            [bool]$script:asrHealth.ok
        } catch {
            $false
        }
    } $cfg.StartTimeoutSeconds 'Whisper /health failed through localhost:8090.'
    Write-Host ('  ASR: OK {0} / {1}' -f $script:asrHealth.model,$script:asrHealth.gpu)

    Write-Host '[6/6] Optional SIP/TUN'
    try {
        Write-RuntimeSingBoxConfig
        $existingSingBox = Find-MatchingProcess 'sing-box.exe' @($cfg.RuntimeSingBoxClientConfig)
        $adapter = Get-NetAdapter -Name $cfg.SingBoxTunName -ErrorAction SilentlyContinue

        if ($existingSingBox -and $adapter -and $adapter.Status -eq 'Up') {
            $state.singBoxPid = [int]$existingSingBox.ProcessId
            $state.singBoxOwned = Test-PreviouslyOwned 'singBox' $state.singBoxPid
            $state.sipReady = $true
            Write-Host ('  SIP/TUN: reuse PID {0} / {1} UP' -f $state.singBoxPid,$cfg.SingBoxTunName)
        } else {
            if ($existingSingBox) {
                Stop-Process -Id ([int]$existingSingBox.ProcessId) -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 500
            }

            $singBoxExe = Resolve-SingBoxExe
            $sbOut = Join-Path $cfg.RuntimeDir 'sing-box.out.log'
            $sbErr = Join-Path $cfg.RuntimeDir 'sing-box.err.log'
            Remove-Item $sbOut,$sbErr -Force -ErrorAction SilentlyContinue
            $sbArgs = 'run -c "{0}"' -f $cfg.RuntimeSingBoxClientConfig
            $singBoxProcess = Start-Process -FilePath $singBoxExe -ArgumentList $sbArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $sbOut -RedirectStandardError $sbErr
            $state.singBoxPid = [int]$singBoxProcess.Id
            $state.singBoxOwned = $true
            Save-State

            Wait-Until {
                $tun = Get-NetAdapter -Name $cfg.SingBoxTunName -ErrorAction SilentlyContinue
                $tun -and $tun.Status -eq 'Up'
            } 5 ('TUN {0} did not become Up.' -f $cfg.SingBoxTunName)

            $state.sipReady = $true
            Write-Host ('  SIP/TUN: {0} UP' -f $cfg.SingBoxTunName)
        }
    } catch {
        $state.sipReady = $false
        $sipError = $_.Exception.Message
        if ($state.singBoxPid) {
            Stop-Process -Id ([int]$state.singBoxPid) -Force -ErrorAction SilentlyContinue
        }
        $state.singBoxPid = $null
        $state.singBoxOwned = $false
        Write-Host ('  SIP/TUN: WARN - {0}' -f $sipError) -ForegroundColor Yellow
        Write-Host '  Browser/PBX remains READY; SIP is isolated from browser startup.' -ForegroundColor Yellow
    }

    $state.ready = $true
    $state.lastError = $null
    Save-State

    Write-Host ''
    Write-Host '=== WORKBENCH HOME: READY ===' -ForegroundColor Green
    Write-Host ('BROWSER : PBX via Vast SOCKS 127.0.0.1:{0}' -f $cfg.LocalSocksPort)
    Write-Host ('CHROME  : HOME profile PID {0}' -f $state.chromePid)
    Write-Host ('PAC     : {0}' -f $pacUri)
    Write-Host ('ASR     : 127.0.0.1:{0} OK' -f $cfg.LocalAsrPort)
    Write-Host ('SIP/TUN : {0}' -f $(if ($state.sipReady) { 'UP' } else { 'WARN / optional' }))
    Write-Host 'External: DIRECT'
    exit 0
}
catch {
    $state.lastError = $_.Exception.Message
    $state.ready = $false
    Save-State

    Write-Host ''
    Write-Host ('=== WORKBENCH HOME: ERROR === {0}' -f $state.lastError) -ForegroundColor Red

    if ($browserCoreReady) {
        Write-Host 'Browser/PBX route is already up and will be left running.' -ForegroundColor Yellow
        Stop-OwnedProcess $state.singBoxPid $state.singBoxOwned
    } else {
        Stop-OwnedProcess $state.chromePid $state.chromeOwned
        Stop-OwnedProcess $state.singBoxPid $state.singBoxOwned
        Stop-OwnedProcess $state.sshPid $state.sshOwned
    }

    Write-Host ('Runtime logs: {0}' -f $cfg.RuntimeDir)
    Write-Host 'Legacy HOME WireGuard remains OFF by design.'
    exit 1
}
