[CmdletBinding()]
param(
    [ValidateSet('Start','Stop','Restart','Status','Reset')]
    [string]$Action = 'Status',

    [int]$HttpPort = 18090,

    [switch]$InstallDeps = $true
)

$ErrorActionPreference = 'Stop'

$scriptWindows = Join-Path $PSScriptRoot 'virtual-router.sh'
if (-not (Test-Path -LiteralPath $scriptWindows)) {
    throw "virtual-router.sh not found: $scriptWindows"
}

$scriptWsl = (& wsl -e wslpath -a $scriptWindows).Trim()
if (-not $scriptWsl) {
    throw 'Could not convert RouterLab virtual router script path to WSL.'
}

$actionLower = $Action.ToLowerInvariant()
$argsText = "$actionLower --port $HttpPort"
if ($InstallDeps) {
    $argsText += ' --install-deps'
}

Write-Host "RouterLab Xiaomi R4A virtual router: $Action"
Write-Host "Mode: exact stock LuCI/API + persistent UCI state; no RF/PHY/ASIC emulation."

& wsl -e bash -lc "bash '$scriptWsl' $argsText"
if ($LASTEXITCODE -ne 0) {
    throw "RouterLab virtual router failed with exit code $LASTEXITCODE"
}
