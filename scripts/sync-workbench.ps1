param(
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $repositoryRoot
try {
    $pending = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect the Git working tree.'
    }
    if ($pending.Count -gt 0) {
        throw 'Uncommitted changes detected. Update stopped to protect local work.'
    }

    Write-Host 'Fetching the latest main branch...' -ForegroundColor Cyan
    git fetch origin --prune
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }

    git switch main
    if ($LASTEXITCODE -ne 0) { throw 'Unable to switch to main.' }

    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'main cannot be updated with fast-forward.' }

    if (-not $SkipTests) {
        Write-Host 'Running tests...' -ForegroundColor Cyan
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    }

    Write-Host 'Building the extension ZIP...' -ForegroundColor Cyan
    & npm.cmd run package:extension
    if ($LASTEXITCODE -ne 0) { throw 'Extension build failed.' }

    Write-Host ''
    Write-Host 'Done. Return to UserSide/Billing and click the green Reload EXT button.' -ForegroundColor Green
} finally {
    Pop-Location
}
