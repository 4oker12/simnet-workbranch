import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  recovery: new URL('../tools/Recover-WorkbenchHomeSip.ps1', import.meta.url),
  startCmd: new URL('../START-WORKBENCH-HOME.cmd', import.meta.url),
  homeCmd: new URL('../HOME.cmd', import.meta.url),
};

async function text(key) {
  return readFile(files[key], 'utf8');
}

test('HOME one-click launcher runs bounded SIP recovery after the core launcher', async () => {
  const start = await text('startCmd');
  assert.match(start, /Start-WorkbenchHome\.ps1/i);
  assert.match(start, /if errorlevel 1 exit \/b %ERRORLEVEL%/i);
  assert.match(start, /Recover-WorkbenchHomeSip\.ps1/i);
});

test('legacy HOME.cmd delegates to the current HOME launcher instead of stale Start-HomeFresh', async () => {
  const home = await text('homeCmd');
  assert.match(home, /START-WORKBENCH-HOME\.cmd/i);
  assert.doesNotMatch(home, /Start-HomeFresh\.ps1/i);
});

test('SIP recovery only touches the matching sing-box process and is bounded', async () => {
  const recovery = await text('recovery');
  assert.doesNotMatch(recovery, /taskkill/i);
  assert.doesNotMatch(recovery, /Stop-Process\s+-(?:Name|ProcessName)\s+['"]?sing-box/i);
  assert.match(recovery, /RuntimeSingBoxClientConfig/);
  assert.match(recovery, /AddSeconds\(\[Math\]::Max\(20,\[int\]\$cfg\.StartTimeoutSeconds\)\)/);
  assert.doesNotMatch(recovery, /while\s*\(\s*\$true\s*\)/i);
  assert.doesNotMatch(recovery, /for\s*\(\s*;\s*;\s*\)/i);
});

test('sleep recovery recognizes the observed stale Wintun failure and retries with a fresh interface name', async () => {
  const recovery = await text('recovery');
  assert.match(recovery, /Cannot create a file when that file already exists/);
  assert.match(recovery, /open existing adapter: Element not found/);
  assert.match(recovery, /open interface take too much time/);
  assert.match(recovery, /SingBoxTunName,\$PID/);
  assert.match(recovery, /interface_name/);
});

test('runtime sing-box config is written UTF-8 without BOM', async () => {
  const recovery = await text('recovery');
  assert.match(recovery, /Text\.UTF8Encoding\(\$false\)/);
  assert.match(recovery, /WriteAllText/);
});

test('recovery refuses to create SIP TUN without the SSH Shadowsocks bridge', async () => {
  const recovery = await text('recovery');
  assert.match(recovery, /Get-ListeningPid \$cfg\.LocalShadowsocksPort/);
  assert.match(recovery, /SSH Shadowsocks bridge/);
  assert.match(recovery, /exit 1/);
});
