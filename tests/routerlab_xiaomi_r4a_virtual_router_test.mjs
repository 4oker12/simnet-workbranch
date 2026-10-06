import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const scriptPath = path.join(root, 'tools', 'routerlab', 'xiaomi-r4a', 'virtual-router.sh');
const wrapperPath = path.join(root, 'tools', 'routerlab', 'xiaomi-r4a', 'Run-VirtualRouter.ps1');

const script = fs.readFileSync(scriptPath, 'utf8');
const wrapper = fs.readFileSync(wrapperPath, 'utf8');

test('virtual router keeps exact stock LuCI and replaces transport only', () => {
  assert.match(script, /usr\/bin\/fcgi-cgi/);
  assert.match(script, /www\/cgi-bin\/luci/);
  assert.match(script, /compat-frontdoor\.py/);
  assert.doesNotMatch(script, /usr\/sbin\/sysapihttpd.*-c/);
  assert.doesNotMatch(script, /FirmAE/);
});

test('virtual router has explicit persistent-state cold boot lifecycle', () => {
  assert.match(script, /state-v1/);
  assert.match(script, /save_state\(\)/);
  assert.match(script, /prepare_runtime\(\)/);
  assert.match(script, /cold boot: exact stock rootfs \+ state-v1/);
  assert.match(script, /start\|stop\|restart\|status\|reset/);
  assert.match(script, /cp -a --reflink=auto "\$ROOTFS\/\." "\$LAB\/"/);
  assert.match(script, /cp -a "\$STATE_CONFIG\/\." "\$LAB\/etc\/config\/"/);
});

test('factory and configured profiles preserve exact R4A state semantics', () => {
  assert.match(script, /PROFILE="factory"/);
  assert.match(script, /profile must be factory or configured/);
  assert.match(script, /config interface 'wan'[\s\S]*option proto 'dhcp'/);
  assert.match(script, /config wifi-device 'mt7603e'[\s\S]*option ifname 'wl1'/);
  assert.match(script, /config wifi-device 'mt7612'[\s\S]*option ifname 'wl0'/);
  assert.match(script, /if \[\[ "\$PROFILE" == "configured" \]\]/);
  assert.match(script, /option 'INITTED' 'YES'/);
  assert.match(script, /sed -i "\/option 'INITTED'\/d"/);
  assert.match(script, /--stock-init-gate/);
});

test('Windows wrapper exposes the same lifecycle without embedding router logic', () => {
  assert.match(wrapper, /ValidateSet\('Start','Stop','Restart','Status','Reset'\)/);
  assert.match(wrapper, /ValidateSet\('Factory','Configured'\)/);
  assert.match(wrapper, /virtual-router\.sh/);
  assert.doesNotMatch(wrapper, /set_wan|set_wifi|wifi_detail_all/);
});

test('virtual router safely reclaims only stale RouterLab listeners', () => {
  assert.match(script, /reclaim_stale_routerlab_port\(\)/);
  assert.match(script, /qemu-mipsel-static\*fcgi-cgi/);
  assert.match(script, /compat-frontdoor\.py/);
  assert.match(script, /non-RouterLab pid=/);
  assert.doesNotMatch(script, /for p in \$port_pids; do\s*kill -TERM "\$p"/);
});
