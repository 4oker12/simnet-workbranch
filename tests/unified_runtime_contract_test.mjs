import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const startCmd = read('START-WORKBENCH.cmd');
const statusCmd = read('STATUS-WORKBENCH.cmd');
const stopCmd = read('STOP-WORKBENCH.cmd');
const start = read('tools/Start-Workbench.ps1');
const home = read('tools/Start-WorkbenchHome.ps1');
const homeStatus = read('tools/Status-WorkbenchHome.ps1');
const homeStop = read('tools/Stop-WorkbenchHome.ps1');
const status = read('tools/Status-Workbench.ps1');
const stop = read('tools/Stop-Workbench.ps1');
const cfg = read('tools/workbench-home.config.ps1');

test('universal command wrappers execute PowerShell instead of relying on .ps1 file association', () => {
  assert.match(startCmd, /powershell\.exe\s+-NoProfile\s+-ExecutionPolicy Bypass\s+-File/);
  assert.match(startCmd, /tools\\Start-Workbench\.ps1/);
  assert.match(statusCmd, /tools\\Status-Workbench\.ps1/);
  assert.match(stopCmd, /tools\\Stop-Workbench\.ps1/);
});

test('runtime endpoint is centralized for HOME and WORK', () => {
  assert.match(cfg, /VastHost\s*=\s*'91\.150\.160\.38'/);
  assert.match(cfg, /VastSshPort\s*=\s*11674/);
  assert.match(cfg, /LocalAsrPort\s*=\s*8090/);
  assert.match(cfg, /RemoteAsrPort\s*=\s*8000/);
  assert.match(cfg, /LocalSocksPort\s*=\s*25344/);
  assert.match(cfg, /LocalShadowsocksPort\s*=\s*10200/);
  assert.match(cfg, /UnifiedStateFile/);
});

test('START automatically selects WORK or HOME without proxy false positives', () => {
  assert.match(start, /function Test-DirectSimnet/);
  assert.match(start, /--noproxy '\*'/);
  assert.match(start, /function Test-HomeTransportActive/);
  assert.match(start, /WireGuardTunnel\$\*/);
  assert.match(start, /legacyTunnelName/);
  assert.match(start, /function Resolve-Mode/);
  assert.match(start, /\$mode\s*=\s*Resolve-Mode/);
});

test('remote bash commands are normalized to LF before SSH execution', () => {
  assert.match(start, /RemoteCommand\.Replace\("`r`n", "`n"\)\.Replace\("`r", ''\)/);
});

test('new standard laptop SSH key is preferred while legacy key remains a fallback', () => {
  assert.match(start, /\.ssh\\id_ed25519'/);
  assert.match(start, /\.ssh\\id_ed25519_simnet_autostart'/);
  assert.match(start, /IdentitiesOnly=yes/);
  assert.match(home, /\.ssh\\id_ed25519'/);
  assert.match(home, /IdentitiesOnly=yes/);
});

test('fresh Vast transcriber is restored and dirty managed checkouts self-heal', () => {
  assert.match(start, /git clone https:\/\/github\.com\/4oker12\/simnet-transcripter\.git \/workspace\/simnet-transcriber/);
  assert.match(start, /git -C \/workspace\/simnet-transcriber checkout -f main/);
  assert.match(start, /git -C \/workspace\/simnet-transcriber reset --hard origin\/main/);
  assert.match(start, /git -C \/workspace\/simnet-transcriber pull --ff-only origin main/);
  assert.match(start, /\.\/bootstrap-vast\.sh/);
});

test('HOME private server config is reproducible from local WireGuard and Shadowsocks sources', () => {
  assert.match(cfg, /PrivateWireGuardConfig/);
  assert.match(cfg, /wireguard-home\.conf/);
  assert.match(start, /function Build-PrivateHomeConfig/);
  assert.match(start, /Get-IniValue \$wgText 'Interface' 'PrivateKey'/);
  assert.match(start, /Get-IniValue \$wgText 'Peer' 'AllowedIPs'/);
  assert.match(start, /No Shadowsocks outbound found/);
  assert.match(start, /type = 'wireguard'/);
  assert.match(start, /tag = 'simnet-wg'/);
  assert.match(start, /type = 'socks'/);
  assert.match(start, /type = 'shadowsocks'/);
  assert.match(start, /private HOME config: regenerated locally/);
  assert.doesNotMatch(start + cfg, /cHAAvm2V5OhFi1dbQY12qwppfm\/dFlNRp5UqNF8XWEU=/);
});

test('HOME SIP Shadowsocks path is private over the same SSH transport', () => {
  assert.match(cfg, /LocalShadowsocksPort\s*=\s*10200/);
  assert.match(home, /Write-RuntimeSingBoxConfig/);
  assert.match(home, /\$ss\.server\s*=\s*'127\.0\.0\.1'/);
  assert.match(home, /\$ss\.server_port\s*=\s*\[int\]\$cfg\.LocalShadowsocksPort/);
  assert.match(home, /'-L',\$asrSpec,'-L',\$socksSpec,'-L',\$ssSpec/);
  assert.match(homeStatus, /SS bridge :10200/);
  assert.match(homeStop, /\$ssSpec/);
});

test('WORK uses only the ASR forward while HOME delegates to the full HOME transport', () => {
  assert.match(start, /Start-WorkTunnel/);
  assert.match(start, /LocalAsrPort/);
  assert.match(start, /Start-WorkbenchHome\.ps1/);
  assert.match(status, /SOCKS\s+NOT NEEDED/);
});

test('runtime PowerShell scripts never assign to the read-only PID automatic variable', () => {
  for (const source of [start, home, homeStop]) {
    assert.doesNotMatch(source, /(?im)^\s*\$pid\s*=/);
    assert.doesNotMatch(source, /function\s+\w+\([^)]*\$pid\b/i);
  }
  assert.match(start, /\$workSshPid\s*=\s*Start-WorkTunnel/);
});

test('HOME elevation returns the elevated process exit code to the command wrapper', () => {
  assert.match(start, /\[switch\]\$Elevated/);
  assert.match(start, /Start-Process powershell\.exe -Verb RunAs/);
  assert.match(start, /-Wait -PassThru/);
  assert.match(start, /exit \$child\.ExitCode/);
});

test('STOP closes only recorded local runtime and explicitly managed Vast services', () => {
  assert.match(stop, /remoteManaged/);
  assert.match(stop, /supervisorctl stop simnet-transcriber/);
  assert.match(stop, /pgrep -f '\^\/workspace\/sing-box-test\/sing-box run/);
  assert.match(stop, /expectedForward/);
});

test('runtime orchestration uses bounded waits and no polling interval', () => {
  assert.match(cfg, /StartTimeoutSeconds\s*=\s*20/);
  assert.doesNotMatch(start, /setInterval|while\s*\(\s*\$true\s*\)/i);
  assert.doesNotMatch(status, /setInterval/i);
  assert.doesNotMatch(stop, /setInterval/i);
});
