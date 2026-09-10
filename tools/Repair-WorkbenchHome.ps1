$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot 'Start-WorkbenchHome.ps1'
if (-not (Test-Path $path)) {
    throw "Missing HOME launcher: $path"
}

$text = [IO.File]::ReadAllText($path)
$original = $text

# PowerShell automatic variable $PID is read-only and case-insensitive.
# The legacy launcher used $Pid as function parameters. Normalize only the
# exact variable token; names such as $singBoxPid are not matched.
$text = [regex]::Replace(
    $text,
    '\$Pid\b',
    '$ProcessId',
    [Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# PAC source is PowerShell single-quoted text. Backslash does not escape a
# double quote there, so \" was being written literally into JavaScript.
$replacements = [ordered]@{
    '$directNeedle = ''return \"DIRECT\";''' = '$directNeedle = ''return "DIRECT";'''
    '''        host == \"simnet.kiev.ua\" ||''' = '''        host == "simnet.kiev.ua" ||'''
    '''        host == \"admin.simnet.kiev.ua\" ||''' = '''        host == "admin.simnet.kiev.ua" ||'''
    '''        host == \"userside.simnet.kiev.ua\" ||''' = '''        host == "userside.simnet.kiev.ua" ||'''
    '''        host == \"pbx.simnet.kiev.ua\"''' = '''        host == "pbx.simnet.kiev.ua"'''
    '(''        return \"SOCKS5 127.0.0.1:{0}\";'' -f $cfg.LocalSocksPort)' = '(''        return "SOCKS5 127.0.0.1:{0}";'' -f $cfg.LocalSocksPort)'
    '''    return \"DIRECT\";''' = '''    return "DIRECT";'''
}

foreach ($pair in $replacements.GetEnumerator()) {
    $text = $text.Replace($pair.Key, $pair.Value)
}

if ($text -ne $original) {
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'HOME launcher repair: APPLIED'
} else {
    Write-Host 'HOME launcher repair: already clean'
}

# Fail early if the two known defects are still present.
if ($text -match '\$Pid\b') {
    throw 'HOME launcher repair failed: $Pid token remains.'
}

$badPacPatterns = @(
    'host == \"',
    'return \"SOCKS5',
    'return \"DIRECT'
)
foreach ($pattern in $badPacPatterns) {
    if ($text.Contains($pattern)) {
        throw "HOME launcher repair failed: escaped PAC JavaScript remains: $pattern"
    }
}
