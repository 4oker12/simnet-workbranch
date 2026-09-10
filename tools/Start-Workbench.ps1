[CmdletBinding()]
param(
    [switch]$Elevated
)

$target = Join-Path (Split-Path -Parent $PSCommandPath) 'Start-WorkbenchSupervisor.ps1'
if ($Elevated) {
    & $target -Elevated
} else {
    & $target
}
exit $LASTEXITCODE
