import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let storageListener = null;
const published = [];
globalThis.document = { hidden: true };
globalThis.location = { href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=1' };
globalThis.chrome = {
  runtime: {
    id: 'test-extension',
    async sendMessage(message) {
      assert.equal(message.type, 'STORE_GET_STATE');
      return {
        success: true,
        data: { meta: { updatedAt: 'v1' }, activeCaseId: 'case:1', cases: { 'case:1': { id: 'case:1' } } }
      };
    }
  },
  storage: {
    onChanged: {
      addListener(listener) { storageListener = listener; },
      removeListener() {}
    }
  }
};
globalThis.SIMNET_WB = {
  stateKey: 'simnet_workbench_state_v5',
  runtime: {},
  bus: { emit(type, payload) { published.push({ type, payload }); } }
};

vm.runInThisContext(fs.readFileSync(new URL('../../src/core/store-client.js', import.meta.url), 'utf8'));
await globalThis.SIMNET_WB.store.init();
assert.equal(published.length, 0, 'hidden tab must not render after Store init');

storageListener({
  simnet_workbench_state_v5: {
    newValue: { meta: { updatedAt: 'v2' }, activeCaseId: 'case:1', cases: { 'case:1': { id: 'case:1', updated: true } } }
  }
}, 'local');
assert.equal(published.length, 0, 'hidden tab must retain state without cross-tab render');
assert.equal(globalThis.SIMNET_WB.store.state.meta.updatedAt, 'v2');

globalThis.document.hidden = false;
assert.equal(globalThis.SIMNET_WB.store.resume(), true);
assert.equal(published.length, 1, 'visible resume publishes exactly the latest state once');
assert.equal(published[0].payload.meta.updatedAt, 'v2');
assert.equal(globalThis.SIMNET_WB.store.resume(), false, 'second resume is deduplicated');

storageListener({
  simnet_workbench_state_v5: {
    newValue: { meta: { updatedAt: 'v3' }, activeCaseId: 'case:1', cases: { 'case:1': { id: 'case:1' } } }
  }
}, 'local');
assert.equal(published.length, 2, 'visible tab still renders a genuine State revision');
console.log('store_client_hidden_tab_unit_test: PASS');
