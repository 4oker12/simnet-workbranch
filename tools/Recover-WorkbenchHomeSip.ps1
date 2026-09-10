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
    $child = Start-Process powershell.exe -Verb RunAs -ArgumentList $args -Wait -PassThru
    exit $child.ExitCode
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

function Get-ListeningPid([int]$Port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $conn) { return $null }
    return [int]$conn.OwningProcess
}

function Get-MatchingSingBox {
    Get-CimInstance Win32_Process -Filter "Name='sing-box.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($cfg.RuntimeSingBoxClientConfig,[StringComparison]::OrdinalIgnoreCase) -ge 0
        } |
        Select-Object -First 1
}

function Get-RuntimeTunName {
    if (-not (Test-Path $cfg.RuntimeSingBoxClientConfig)) { return '' }
    try {
        $client = Get-Content -Raw -Path $cfg.RuntimeSingBoxClientConfig | ConvertFrom-Json
        $tun = $client.inbounds | Where-Object { $_.type -eq 'tun' } | Select-Object -First 1
        if ($tun -and $tun.PSObject.Properties['interface_name']) {
            return [string]$tun.interface_name
        }
    } catch {}
    return ''
}

function Test-TunUp([string]$TunName) {
    if (-not $TunName) { return $false }
    $adapter = Get-NetAdapter -Name $TunName -ErrorAction SilentlyContinue
    return [bool]($adapter -and $adapter.Status -eq 'Up')
}

function Write-RuntimeConfig([string]$TunName) {
    if (-not (Test-Path $cfg.SingBoxConfig)) {
        throw ('sing-box source config not found: {0}' -f $cfg.SingBoxConfig)
    }

    $client = Get-Content -Raw -Path $cfg.SingBoxConfig | ConvertFrom-Json
    $ss = $client.outbounds | Where-Object { $_.type -eq 'shadowsocks' } | Select-Object -First 1
    if (-not $ss) { throw 'No Shadowsocks outbound found in local sing-box client config.' }
    $ss.server = '127.0.0.1'
    $ss.server_port = [int]$cfg.LocalShadowsocksPort

    $tun = $client.inbounds | Where-Object { $_.type -eq 'tun' } | Select-Object -First 1
    if (-not $tun) { throw 'No TUN inbound found in local sing-box client config.' }
    if ($tun.PSObject.Properties['interface_name']) {
        $tun.interface_name = $TunName
    } else {
        $tun | Add-Member -NotePropertyName interface_name -NotePropertyValue $TunName
    }

    $json = $client | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText(
        $cfg.RuntimeSingBoxClientConfig,
        $json,
        (New-Object Text.UTF8Encoding($false))
    )
}

function Read-SingBoxLog {
    $parts = @()
    foreach ($path in @(
        (Join-Path $cfg.RuntimeDir 'sing-box.out.log'),
        (Join-Path $cfg.RuntimeDir 'sing-box.err.log')
    )) {
        if (Test-Path $path) {
            try { $parts += (Get-Content -Raw -Path $path -ErrorAction Stop) } catch {}
        }
    }
    return ($parts -join "`n")
}

function Stop-MatchingSingBox {
    $items = Get-CimInstance Win32_Process -Filter "Name='sing-box.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($cfg.RuntimeSingBoxClientConfig,[StringComparison]::OrdinalIgnoreCase) -ge 0
        }
    foreach ($item in $items) {
        Stop-Process -Id ([int]$item.ProcessId) -Force -ErrorAction SilentlyContinue
    }
    if ($items) { Start-Sleep -Milliseconds 600 }
}

function Start-SingBoxAttempt([string]$TunName) {
    Write-RuntimeConfig $TunName
    Stop-MatchingSingBox

    $sbOut = Join-Path $cfg.RuntimeDir 'sing-box.out.log'
    $sbErr = Join-Path $cfg.RuntimeDir 'sing-box.err.log'
    Remove-Item $sbOut,$sbErr -Force -ErrorAction SilentlyContinue

    $exe = Resolve-SingBoxExe
    $args = 'run -c "{0}"' -f $cfg.RuntimeSingBoxClientConfig
    $proc = Start-Process -FilePath $exe -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput $sbOut -RedirectStandardError $sbErr

    $deadline = (Get-Date).AddSeconds([Math]::Max(20,[int]$cfg.StartTimeoutSeconds))
    do {
        if (Test-TunUp $TunName) {
            return [pscustomobject]@{ Ok=$true; ProcessId=[int]$proc.Id; TunName=$TunName; Error='' }
        }
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 400
        $proc.Refresh()
    } while ((Get-Date) -lt $deadline)

    if (-not $proc.HasExited) {
        Stop-Process -Id ([int]$proc.Id) -Force -ErrorAction SilentlyContinue
    }

    $log = Read-SingBoxLog
    if (-not $log) { $log = ('TUN {0} did not become Up.' -f $TunName) }
    return [pscustomobject]@{ Ok=$false; ProcessId=$null; TunName=$TunName; Error=$log }
}

function Save-RecoveryState([int]$ProcessId,[string]$TunName) {
    $state = $null
    if (Test-Path $cfg.StateFile) {
        try { $state = Get-Content -Raw -Path $cfg.StateFile | ConvertFrom-Json } catch { $state = $null }
    }
    if (-not $state) { $state = [pscustomobject]@{} }

    foreach ($pair in @(
        @('singBoxPid',$ProcessId),
        @('singBoxOwned',$true),
        @('singBoxTunName',$TunName),
        @('sipReady',$true)
    )) {
        $name = [string]$pair[0]
        $value = $pair[1]
        if ($state.PSObject.Properties[$name]) {
            $state.$name = $value
        } else {
            $state | Add-Member -NotePropertyName $name -NotePropertyValue $value
        }
    }

    $state | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path $cfg.StateFile
}

Write-Host '[HOME SIP RECOVERY]'

if (-not (Get-ListeningPid $cfg.LocalShadowsocksPort)) {
    Write-Host ('  ERROR: SSH Shadowsocks bridge 127.0.0.1:{0} is not listening.' -f $cfg.LocalShadowsocksPort) -ForegroundColor Red
    exit 1
}

$currentTun = Get-RuntimeTunName
$currentProcess = Get-MatchingSingBox
if ($currentProcess -and $currentTun -and (Test-TunUp $currentTun)) {
    Save-RecoveryState ([int]$currentProcess.ProcessId) $currentTun
    Write-Host ('  SIP/TUN: reuse PID {0} / {1} UP' -f $currentProcess.ProcessId,$currentTun) -ForegroundColor Green
    exit 0
}

$priorLog = Read-SingBoxLog
$staleSignature = 'Cannot create a file when that file already exists|open existing adapter: Element not found|open interface take too much time'
$attempts = New-Object System.Collections.Generic.List[string]

if ($priorLog -notmatch $staleSignature) {
    $attempts.Add([string]$cfg.SingBoxTunName)
}

$recoveryName = '{0}-r{1}' -f $cfg.SingBoxTunName,$PID
$attempts.Add($recoveryName)

foreach ($tunName in $attempts) {
    Write-Host ('  trying TUN {0}...' -f $tunName)
    $result = Start-SingBoxAttempt $tunName
    if ($result.Ok) {
        Save-RecoveryState ([int]$result.ProcessId) $result.TunName
        Write-Host ('  SIP/TUN: recovered PID {0} / {1} UP' -f $result.ProcessId,$result.TunName) -ForegroundColor Green
        exit 0
    }

    $oneLine = ([string]$result.Error -replace '[\r\n]+',' ')
    if ($oneLine.Length -gt 260) { $oneLine = $oneLine.Substring(0,260) + '...' }
    Write-Host ('  failed {0}: {1}' -f $tunName,$oneLine) -ForegroundColor Yellow
}

Write-Host '  ERROR: SIP/TUN recovery failed.' -ForegroundColor Red
exit 1
