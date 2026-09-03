import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const storageData = {};
const messageListeners = [];
const installedListeners = [];
const startupListeners = [];
const removedListeners = [];
const globalListeners = new Map();
const badgeCalls = [];

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return structuredClone(storageData);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(k => k in storageData).map(k => [k, structuredClone(storageData[k])]));
      },
      async set(patch) {
        for (const [k, v] of Object.entries(patch)) storageData[k] = structuredClone(v);
      },
      async remove(keys) {
        for (const k of (Array.isArray(keys) ? keys : [keys])) delete storageData[k];
      }
    },
    onChanged: { addListener() {}, removeListener() {} }
  },
  runtime: {
    id: 'startup-smoke-test',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    onInstalled: { addListener(fn) { installedListeners.push(fn); } },
    onStartup: { addListener(fn) { startupListeners.push(fn); } }
  },
  tabs: {
    onRemoved: { addListener(fn) { removedListeners.push(fn); } },
    async query() { return []; },
    async update(id, patch) { return { id, ...patch }; },
    async create(patch) { return { id: 99, ...patch }; },
    async get(id) { return { id, windowId: 1, url: 'https://admin.simnet.kiev.ua/' }; }
  },
  windows: { async update(id, patch) { return { id, ...patch }; } },
  action: {
    async setBadgeText(payload) { badgeCalls.push(['text', payload]); },
    async setBadgeBackgroundColor(payload) { badgeCalls.push(['color', payload]); }
  },
  scripting: { async executeScript() {} }
};

globalThis.addEventListener = (type, fn) => globalListeners.set(type, fn);

await import(pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href + `?startup=${Date.now()}`);

assert.equal(messageListeners.length, 1, 'Service Worker message handler must register');
assert.equal(installedListeners.length, 1, 'onInstalled handler must register');
assert.equal(startupListeners.length, 1, 'onStartup handler must register');

await assert.doesNotReject(
  installedListeners[0]({ reason: 'install' }),
  'onInstalled must complete without removed telemetry references'
);

assert.doesNotThrow(
  () => startupListeners[0](),
  'onStartup must not throw synchronously'
);
await new Promise(resolve => setTimeout(resolve, 25));

assert.equal(badgeCalls.length, 0, 'runtime does not maintain a telemetry badge');
const pingResult = await new Promise((resolve, reject) => {
  const handled = messageListeners[0]({ type: 'PING', payload: {} }, {}, response => {
    if (!response?.success) reject(new Error(response?.error || 'PING'));
    else resolve(response.data);
  });
  assert.equal(handled, false, 'PING is handled synchronously');
});
assert.equal(pingResult.version, manifest.version);

const errorHandler = globalListeners.get('error');
assert.equal(typeof errorHandler, 'function', 'unhandled Service Worker error reporter must register');
assert.doesNotThrow(() => errorHandler({ error: new Error('startup-smoke-synthetic') }));
await new Promise(resolve => setTimeout(resolve, 180));
assert.equal(storageData.simnet_workbench_diagnostics_v1, undefined, 'runtime does not persist removed telemetry logs');

console.log('service_worker_startup_smoke_test: PASS');
