import assert from 'node:assert/strict';
import { createFetchClient } from '../src/infrastructure/fetch-client.js';

const calls = [];
const response = body => ({
  ok: true, status: 200, statusText: 'OK', redirected: false, url: 'https://userside.simnet.kiev.ua/test',
  headers: { get(name){ return name === 'content-type' ? 'application/json' : ''; } },
  async text(){ return body; }
});
const client = createFetchClient({
  allowedHosts: ['userside.simnet.kiev.ua'],
  fetchFn: async (url, options) => { calls.push({ url, options }); return response('{"ok":true}'); },
  timeoutMs: 1000,
  nowMs: (() => { let n = 100; return () => n += 5; })()
});
assert.equal(client.isUrlAllowed('https://userside.simnet.kiev.ua/test'), true);
assert.equal(client.isUrlAllowed('https://evil.example/test'), false);
await assert.rejects(() => client.request({ url: 'https://evil.example/test' }), /Blocked URL/);
const out = await client.request({ url: 'https://userside.simnet.kiev.ua/test' });
assert.deepEqual(out.data, { ok: true });
assert.equal(calls.length, 1);
console.log('fetch_client_architecture_test: PASS');
