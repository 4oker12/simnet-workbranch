param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LegacyLauncherCmd = Join-Path $RepoRoot 'START-WORKBENCH-HOME.cmd'
$LegacyLauncherPs1 = Join-Path $PSScriptRoot 'Start-WorkbenchHome.ps1'

$ManagedPorts = @(25344, 8090, 8765)
$VastHost = '87.106.223.150'

function Write-Step([string]$Text) {
    Write-Host ("`n=== " + $Text + " ===") -ForegroundColor Cyan
}

function Get-ManagedProcesses {
    $result = @()
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue

    foreach ($proc in @($processes)) {
        $name = [string]$proc.Name
        $cmd  = [string]$proc.CommandLine
        $reason = $null

        if ($name -ieq 'sing-box.exe') {
            $reason = 'sing-box'
        }
        elseif ($name -ieq 'ssh.exe' -and
            ($cmd -match [regex]::Escape($VastHost) -or $cmd -match '25344' -or $cmd -match '8090')) {
            $reason = 'SIMNET SSH tunnel'
        }
        elseif (($name -ieq 'python.exe' -or $name -ieq 'pythonw.exe') -and
            ($cmd -match '8765' -or $cmd -match 'simnet-vast\.pac')) {
            $reason = 'PAC server'
        }
        elseif ($name -ieq 'microsip.exe') {
            $reason = 'MicroSIP'
        }
        elseif ($name -ieq 'chrome.exe' -and
            ($cmd -match '--proxy-pac-url' -or $cmd -match 'simnet-vast\.pac' -or $cmd -match 'SIMNET-Chrome-Home')) {
            $reason = 'SIMNET Chrome'
        }

        if ($reason) {
            $result += [pscustomobject]@{
                ProcessId = [int]$proc.ProcessId
                Name      = $name
                Reason    = $reason
                Command   = $cmd
            }
        }
    }

    return @($result)
}

function Show-ManagedStatus([string]$Label) {
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
}

function Stop-ProcessSafe([int]$ProcessId, [string]$Reason) {
    try {
        $p = Get-Process -Id $ProcessId -ErrorAction Stop
        Write-Host ("KILL PID={0} NAME={1} TYPE={2}" -f $ProcessId, $p.ProcessName, $Reason)
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
        if ($_.Exception.Message -notmatch 'Cannot find a process') {
            Write-Warning ("Could not stop PID={0}: {1}" -f $ProcessId, $_.Exception.Message)
        }
    }
}

function Stop-ManagedLocalState {
    Write-Step 'KILL OLD HOME STATE'

    foreach ($port in $ManagedPorts) {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        foreach ($listener in $listeners) {
            Stop-ProcessSafe -ProcessId ([int]$listener.OwningProcess) -Reason ("listener:" + $port)
        }
    }

    foreach ($proc in @(Get-ManagedProcesses)) {
        Stop-ProcessSafe -ProcessId $proc.ProcessId -Reason $proc.Reason
    }

    Start-Sleep -Seconds 2
}

function Assert-CleanLocalState {
    Write-Step 'VERIFY CLEAN STATE'

    $dirty = $false

    $left = @(Get-ManagedProcesses)
    if ($left.Count -gt 0) {
        $dirty = $true
        foreach ($p in $left) {
            Write-Host ("LEFTOVER PROCESS PID={0} NAME={1} TYPE={2}" -f $p.ProcessId, $p.Name, $p.Reason) -ForegroundColor Red
        }
    }

    foreach ($port in $ManagedPorts) {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            $dirty = $true
            foreach ($row in $listeners) {
                Write-Host ("LEFTOVER PORT {0} PID={1}" -f $port, $row.OwningProcess) -ForegroundColor Red
            }
        }
    }

    if ($dirty) {
        throw 'CLEANUP_FAILED: old HOME state is still present; refusing to start over it'
    }

    Write-Host 'CLEAN_STATE=OK' -ForegroundColor Green
}

function Repair-KnownLauncherBug {
    if (-not (Test-Path $LegacyLauncherPs1)) {
        throw "Missing launcher: $LegacyLauncherPs1"
    }

    $text = [IO.File]::ReadAllText($LegacyLauncherPs1)

    if ($text -match '(?im)^\s*\$pid\s*=') {
        $backup = $LegacyLauncherPs1 + '.pre-home-fix.bak'
        if (-not (Test-Path $backup)) {
            Copy-Item $LegacyLauncherPs1 $backup -Force
        }

        $fixed = [regex]::Replace(
            $text,
            '\$Pid\b',
            '$PacServerPid',
            [Text.RegularExpressions.RegexOptions]::IgnoreCase
        )

        [IO.File]::WriteAllText(
            $LegacyLauncherPs1,
            $fixed,
            (New-Object Text.UTF8Encoding($false))
        )

        Write-Host 'REPAIR: launcher $Pid collision fixed'
    } else {
        Write-Host 'REPAIR: launcher PID collision not present'
    }
}

function Test-Listen([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-SocksHttpCode([string]$Url) {
    try {
        $code = & curl.exe -k -sS --max-time 10 `
            --socks5-hostname 127.0.0.1:25344 `
            -o NUL -w '%{http_code}' $Url 2>$null
        return ([string]$code).Trim()
    } catch {
        return '000'
    }
}

function Test-WhisperHealth {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri 'http://127.0.0.1:8090/health'
        if ($r.StatusCode -ne 200) { return $false }
        $obj = $r.Content | ConvertFrom-Json
        return ($obj.ok -eq $true)
    } catch {
        return $false
    }
}

function Test-PacHealth {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://127.0.0.1:8765/simnet-vast.pac'
        return ($r.StatusCode -eq 200 -and $r.Content -match 'PROXY|SOCKS')
    } catch {
        return $false
    }
}

function Show-PortState {
    foreach ($port in $ManagedPorts) {
        $c = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($c.Count -gt 0) {
            foreach ($row in $c) {
                Write-Host ("PORT {0}: LISTEN PID={1}" -f $port, $row.OwningProcess)
            }
        } else {
            Write-Host ("PORT {0}: CLOSED" -f $port)
        }
    }
}

try {
    Write-Host 'SIMNET HOME: STATUS -> KILL -> CLEAN -> START -> VERIFY' -ForegroundColor White

    Show-ManagedStatus 'PRE-START STATUS'
    Stop-ManagedLocalState
    Assert-CleanLocalState
    Repair-KnownLauncherBug

    Write-Step 'START FRESH HOME STATE'
    if (Test-Path $LegacyLauncherCmd) {
        & $LegacyLauncherCmd
        if ($LASTEXITCODE -ne 0) {
            throw "START-WORKBENCH-HOME.cmd failed with exit code $LASTEXITCODE"
        }
    } else {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $LegacyLauncherPs1
        if ($LASTEXITCODE -ne 0) {
            throw "Start-WorkbenchHome.ps1 failed with exit code $LASTEXITCODE"
        }
    }

    Write-Step 'FINAL VERIFY'

    $deadline = (Get-Date).AddSeconds(30)
    do {
        $socksListen = Test-Listen 25344
        $whisperOk   = Test-WhisperHealth
        $pacOk       = Test-PacHealth

        if ($socksListen -and $whisperOk -and $pacOk) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    $billing  = Get-SocksHttpCode 'https://admin.simnet.kiev.ua/'
    $userside = Get-SocksHttpCode 'https://userside.simnet.kiev.ua/'
    $pbx      = Get-SocksHttpCode 'https://pbx.simnet.kiev.ua/'

    Show-PortState
    Write-Host ("BILLING HTTP={0}" -f $billing)
    Write-Host ("USERSIDE HTTP={0}" -f $userside)
    Write-Host ("PBX HTTP={0}" -f $pbx)
    Write-Host ("WHISPER={0}" -f $(if (Test-WhisperHealth) { 'OK' } else { 'FAIL' }))
    Write-Host ("PAC={0}" -f $(if (Test-PacHealth) { 'OK' } else { 'FAIL' }))

    $httpOk = {
        param($code)
        return ($code -match '^(200|301|302|303|307|308|401|403)$')
    }

    $ready =
        (Test-Listen 25344) -and
        (Test-WhisperHealth) -and
        (Test-PacHealth) -and
        (& $httpOk $billing) -and
        (& $httpOk $userside) -and
        (& $httpOk $pbx)

    if (-not $ready) {
        throw 'HOME_NOT_READY: one or more final checks failed'
    }

    Write-Host "`n==============================" -ForegroundColor Green
    Write-Host 'HOME_READY' -ForegroundColor Green
    Write-Host '==============================' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "`n==============================" -ForegroundColor Red
    Write-Host 'HOME_START_FAILED' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host '==============================' -ForegroundColor Red
    Show-PortState
    exit 1
}
