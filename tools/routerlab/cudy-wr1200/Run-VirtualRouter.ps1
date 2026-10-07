[CmdletBinding()]
param(
    [ValidateSet('Start','Stop','Restart','Status','Reset','Test')]
    [string]$Action = 'Status',
    [int]$HttpPort = 18120
)

$ErrorActionPreference = 'Stop'

$serverScript = Join-Path $PSScriptRoot 'virtual-router.py'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$testScript = Join-Path $repoRoot 'tests\routerlab_cudy_wr1200_bootstrap_test.py'
$base = Join-Path $env:USERPROFILE '.routerlab\cudy-wr1200'
$stateFile = Join-Path $base 'state-v1.json'
$pidFile = Join-Path $base 'server.pid'
$stdoutFile = Join-Path $base 'server.stdout.log'
$stderrFile = Join-Path $base 'server.stderr.log'
$url = "http://127.0.0.1:$HttpPort/"

New-Item -ItemType Directory -Force -Path $base | Out-Null

function Get-PythonCommand {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) { return @{ Exe = $python.Source; Prefix = @() } }

    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { return @{ Exe = $py.Source; Prefix = @('-3') } }

    throw 'Python 3 was not found in PATH.'
}

function Get-LabProcess {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $storedPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $storedPid" -ErrorAction SilentlyContinue
    if (-not $proc) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        return $null
    }
    if ($proc.CommandLine -notmatch 'virtual-router\.py') {
        throw "Refusing to manage PID $storedPid because it is not RouterLab Cudy."
    }
    return $proc
}

function Stop-Lab {
    $proc = Get-LabProcess
    if (-not $proc) {
        Write-Host 'RouterLab Cudy: already stopped.'
        return
    }
    Stop-Process -Id $proc.ProcessId -Force
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "RouterLab Cudy: stopped PID $($proc.ProcessId)."
}

function Start-Lab {
    $proc = Get-LabProcess
    if ($proc) {
        Write-Host "RouterLab Cudy: already running PID $($proc.ProcessId)."
        Write-Host $url
        return
    }

    $py = Get-PythonCommand
    $args = @()
    $args += $py.Prefix
    $args += @(
        ('"' + $serverScript + '"'),
        'serve',
        '--port', "$HttpPort",
        '--state-file', ('"' + $stateFile + '"')
    )

    $p = Start-Process -FilePath $py.Exe -ArgumentList $args -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru -WindowStyle Hidden
    Set-Content -LiteralPath $pidFile -Value $p.Id -NoNewline

    $ready = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Milliseconds 200
        try {
            $health = Invoke-RestMethod -Uri ($url + 'health') -TimeoutSec 1
            if ($health.ok) { $ready = $true; break }
        } catch {}
    }
    if (-not $ready) {
        Stop-Lab
        throw "RouterLab Cudy failed to become healthy. See $stderrFile"
    }

    Write-Host "RouterLab Cudy WR1200: running PID $($p.Id)"
    Write-Host 'Fidelity: synthetic-bootstrap; no vendor API or RF/PHY emulation.'
    Write-Host $url
}

switch ($Action) {
    'Start' {
        Start-Lab
    }
    'Stop' {
        Stop-Lab
    }
    'Restart' {
        Stop-Lab
        Start-Lab
    }
    'Status' {
        $proc = Get-LabProcess
        if (-not $proc) {
            Write-Host 'RouterLab Cudy: stopped.'
            exit 0
        }
        try {
            $health = Invoke-RestMethod -Uri ($url + 'health') -TimeoutSec 2
            $health | ConvertTo-Json -Depth 5
        } catch {
            Write-Host "RouterLab Cudy PID $($proc.ProcessId) exists but health check failed."
            exit 1
        }
    }
    'Reset' {
        Stop-Lab
        Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
        Write-Host 'RouterLab Cudy: persistent state reset to factory.'
    }
    'Test' {
        $py = Get-PythonCommand
        & $py.Exe @($py.Prefix + @($testScript))
        if ($LASTEXITCODE -ne 0) { throw "Cudy bootstrap tests failed with exit code $LASTEXITCODE" }
    }
}
