import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const script = fs.readFileSync(
  path.join(root, 'tools', 'routerlab', 'xiaomi-r4a', 'management-plane-rehost.sh'),
  'utf8',
);

test('rehost uses stock management components without FirmAE system emulation', () => {
  assert.match(script, /usr\/sbin\/sysapihttpd/);
  assert.match(script, /usr\/bin\/fcgi-cgi/);
  assert.match(script, /www\/cgi-bin\/luci/);
  assert.match(script, /qemu-mipsel-static/);
  assert.match(script, /proot/);
  assert.doesNotMatch(script, /qemu-system-mipsel/);
  assert.doesNotMatch(script, /tunctl|tap[0-9_]/i);
});

test('rehost keeps source rootfs untouched and probes read-only endpoint', () => {
  assert.match(script, /cp -a --reflink=auto "\$ROOTFS\/\." "\$LAB\/"/);
  assert.match(script, /source rootfs modified: \*\*no\*\*/);
  assert.match(script, /guest 'cat \/tmp\/sysapihttpdconf\/sysapihttpd\.conf'/);
  assert.doesNotMatch(script, /\$LAB\/tmp\/sysapihttpdconf/);
  assert.match(script, /\/api\/xqsystem\/init_info/);
  assert.doesNotMatch(script, /set_wan_new|set_wifi/);
});

test('rehost is bounded and has explicit classifications', () => {
  assert.match(script, /PROBE_SECONDS=75/);
  assert.match(script, /PROBE_SECONDS <= 300/);
  for (const state of [
    'STOCK_SYSAPI_CONFIG_BLOCKED_IN_USERMODE',
    'STOCK_LUCI_API_ALIVE',
    'STOCK_WEB_FRONTEND_ALIVE_LUCI_BLOCKED',
    'STOCK_SYSAPI_CONFIG_VALID_RUNTIME_BLOCKED',
    'QEMU_USER_REHOST_BLOCKED',
  ]) {
    assert.match(script, new RegExp(state));
  }
});
