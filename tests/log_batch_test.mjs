import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const data = {};
let writes = 0;
const window = { addEventListener() {}, dispatchEvent() {} };
window.top = window.self = window;
const context = vm.createContext({
  window, location: { hostname: 'example.test', pathname: '/' },
  console, Date, Math, setTimeout: () => 1, clearTimeout() {}, queueMicrotask() {},
  CustomEvent: class {},
  chrome: { runtime: { getManifest: () => ({ version: 'test' }) }, storage: { local: {
    get: async () => data,
    set: async value => { writes++; Object.assign(data, value); }
  } } }
});
vm.runInContext(fs.readFileSync(new URL('../src/content/namespace.js', import.meta.url), 'utf8'), context);
for (let n = 0; n < 200; n++) context.SIMNET_WB.log.info('TEST', `entry ${n}`);
assert.equal(writes, 0, 'logging does not start one write per event');
const rows = await context.SIMNET_WB.log.recent(120);
assert.equal(writes, 1);
assert.equal(rows.length, 80, 'pending data is bounded');
assert.equal(rows[0].event, 'entry 199');
console.log('log batch: PASS');
