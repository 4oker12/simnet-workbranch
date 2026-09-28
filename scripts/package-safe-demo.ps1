param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$safeManifestPath = Join-Path $repositoryRoot 'manifest.safe.json'

if (-not (Test-Path -LiteralPath $safeManifestPath -PathType Leaf)) {
    throw "Safe manifest not found: $safeManifestPath"
}

$manifest = Get-Content -LiteralPath $safeManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $manifest.version) {
    throw 'Safe manifest does not contain a version.'
}

$forbiddenHosts = @(
    'https://stargroup.helpcrunch.com/*',
    'http://127.0.0.1/*',
    'http://localhost/*',
    'https://api.groq.com/*',
    'https://api.deepseek.com/*'
)

foreach ($hostPattern in $forbiddenHosts) {
    if ($manifest.host_permissions -contains $hostPattern) {
        throw "Unsafe host permission present in SAFE DEMO manifest: $hostPattern"
    }
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot 'dist'
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$archivePath = Join-Path $resolvedOutputDirectory "simnet-workbench-safe-demo-$($manifest.version).zip"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "simnet-workbench-safe-$([guid]::NewGuid().ToString('N'))"

try {
    New-Item -ItemType Directory -Path $stagingDirectory | Out-Null

    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'src') -Destination $stagingDirectory -Recurse
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'assets') -Destination $stagingDirectory -Recurse
    Copy-Item -LiteralPath $safeManifestPath -Destination (Join-Path $stagingDirectory 'manifest.json')

    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }

    Compress-Archive -Path (Join-Path $stagingDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal
} finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
        Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
}

Write-Output $archivePath
