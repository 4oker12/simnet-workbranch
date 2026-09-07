import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  config: new URL('../tools/workbench-home.config.ps1', import.meta.url),
  start: new URL('../tools/Start-WorkbenchHome.ps1', import.meta.url),
  stop: new URL('../tools/Stop-WorkbenchHome.ps1', import.meta.url),
  status: new URL('../tools/Status-WorkbenchHome.ps1', import.meta.url),
  startCmd: new URL('../START-WORKBENCH-HOME.cmd', import.meta.url),
  stopCmd: new URL('../STOP-WORKBENCH-HOME.cmd', import.meta.url),
  statusCmd: new URL('../STATUS-WORKBENCH-HOME.cmd', import.meta.url),
};

async function text(key) {
  return readFile(files[key], 'utf8');
}

test('HOME config keeps Vast/ports and local WireGuard invariant explicit', async () => {
  const config = await text('config');
  assert.match(config, /VastHost\s*=\s*'87\.106\.223\.150'/);
  assert.match(config, /VastSshPort\s*=\s*30036/);
  assert.match(config, /LocalSocksPort\s*=\s*25344/);
  assert.match(config, /LocalAsrPort\s*=\s*8090/);
  assert.match(config, /PacPort\s*=\s*8765/);
  assert.match(config, /WireGuardTunnel\$Zyatyev_Andriy-HOME/);
  assert.match(config, /StopConflictingWireGuard\s*=\s*\$true/);
});

test('START is bounded, selective, and never globally kills Chrome/SSH', async () => {
  const start = await text('start');
  assert.doesNotMatch(start, /taskkill/i);
  assert.doesNotMatch(start, /Stop-Process\s+-(?:Name|ProcessName)\s+['"]?(?:chrome|ssh)/i);
  assert.doesNotMatch(start, /while\s*\(\s*\$true\s*\)/i);
  assert.doesNotMatch(start, /for\s*\(\s*;\s*;\s*\)/i);
  assert.doesNotMatch(start, /-f\s*\\\s*(?:\r?\n)/);
  assert.match(start, /ExitOnForwardFailure=yes/);
  assert.match(start, /ConnectTimeout=10/);
  assert.match(start, /ServerAliveInterval=30/);
  assert.match(start, /ServerAliveCountMax=3/);
  assert.match(start, /--load-extension=/);
  assert.match(start, /--proxy-pac-url=/);
  assert.match(start, /--disable-quic/);
  assert.match(start, /Vast\s+: untouched/);
});

test('PAC proxies only the four explicit SIMNET hosts and defaults DIRECT', async () => {
  const start = await text('start');
  for (const host of [
    'simnet.kiev.ua',
    'admin.simnet.kiev.ua',
    'userside.simnet.kiev.ua',
    'pbx.simnet.kiev.ua',
  ]) {
    assert.match(start, new RegExp(host.replaceAll('.', '\\.')));
  }
  assert.match(start, /return \"DIRECT\"/);
  assert.doesNotMatch(start, /dnsDomainIs/i);
});

test('STOP is ownership/state based and leaves Vast/WireGuard alone', async () => {
  const stop = await text('stop');
  assert.match(stop, /StateFile/);
  assert.match(stop, /Owned/);
  assert.doesNotMatch(stop, /taskkill/i);
  assert.doesNotMatch(stop, /Start-Service\s+-Name\s+\$cfg\.WireGuardService/i);
  assert.match(stop, /Vast: untouched/);
});

test('STATUS checks every HOME runtime contour', async () => {
  const status = await text('status');
  for (const marker of [
    'Legacy WireGuard OFF',
    'SIP TUN',
    'PAC :8765',
    'SOCKS :25344',
    'ASR tunnel :8090',
    'Whisper /health',
    'SIMNET via Vast',
    'PBX via Vast',
    'Workbench Chrome',
  ]) assert.ok(status.includes(marker), `missing status marker: ${marker}`);
});

test('one-click wrappers call only their matching PowerShell scripts', async () => {
  assert.match(await text('startCmd'), /tools\\Start-WorkbenchHome\.ps1/i);
  assert.match(await text('stopCmd'), /tools\\Stop-WorkbenchHome\.ps1/i);
  assert.match(await text('statusCmd'), /tools\\Status-WorkbenchHome\.ps1/i);
});
