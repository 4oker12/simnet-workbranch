import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/readers/billing.js'), 'utf8');

const WB = {
  readers: {},
  parsers: { billing: { pollResult: {
      classifyPollText() {
        return {
          result: 'confirmed',
          ready: true,
          pending: false,
          pollResponded: true,
          identityAssessment: 'matched',
          identityConflicts: [],
          matchedBy: ['synthetic-runtime-smoke'],
          observedOnuMac: 'AA:BB:CC:DD:EE:FF',
          observedSerial: 'SERIAL123',
          observedSubscriberMac: '',
          interface: '0/1/1',
          summary: 'synthetic confirmed poll response',
          expected: {}
        };
      }
    } } },
  pollTerminal: { snapshot() { return []; } },
  interactionGuards: {
    recentPollRequest() { return null; },
    pollRequestMatches() { return true; },
    isUiReady() { return true; },
    resolvePollRequest() {}
  }
};

globalThis.SIMNET_WB = WB;
globalThis.document = {
  readyState: 'complete',
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

globalThis.location = {
  href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl',
  search: ''
};

vm.runInThisContext(source, { filename: 'src/readers/billing.js' });
assert.equal(typeof WB.readers.billing?.read, 'function', 'Billing reader must register read()');

const compact = (value, max = 10000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const validIp = value => {
  const match = String(value || '').match(/(?:\d{1,3}\.){3}\d{1,3}/);
  return match?.[0] || '';
};
const fact = (value, sourceName, confidence) => ({ value, source: sourceName, confidence });

function collectPoll(openedAction, diagnosticAction = openedAction) {
  globalThis.location.search = `?a=${openedAction}&id=41014&act=askolt&olt_ip=172.16.1.50`;
  return WB.readers.billing.read({
    pageInfo: { kind: 'billing_onu_poll', entityId: '41014' },
    text: 'ONU gpon0/1/1:1 is - online RX Power: -20.10 dBm OLT IP: 172.16.1.50',
    fact,
    normalizeMac: value => String(value || '').toUpperCase(),
    validIp,
    compact,
    controlValue: () => '',
    activeCase: {
      diagnostic: { pollAction: diagnosticAction },
      pon: {
        oltName: { value: 'Huawei MA5800-X15', source: 'billing:olt-selected-option' },
        onuMac: { value: 'AA:BB:CC:DD:EE:FF' },
        onuSerial: { value: 'SERIAL123' }
      },
      network: {}
    }
  });
}

const expectedTypes = {
  '310': 'EPON',
  '311': 'GPON',
  '312': 'GCOM',
  '313': 'Huawei'
};

for (const [action, type] of Object.entries(expectedTypes)) {
  let result;
  assert.doesNotThrow(() => { result = collectPoll(action); }, `${action}/${type}: native poll parser must execute without ReferenceError`);
  assert.equal(result.facts.pon.pollAction.value, action, `${action}: confirmed native action must be observed`);
  assert.equal(result.facts.pon.pollType.value, type, `${action}: opened native poll tab determines observed poll type`);
  assert.equal(result.meta.poll.expectedPollAction, action, `${action}: expected action comes from canonical diagnostic case-view`);
  assert.equal(result.meta.poll.wrongPollTab, false, `${action}: matching canonical action must not be rejected`);
  assert.equal(result.meta.locatorObservations[0].details.technology, type, `${action}: observation reports actual opened poll type`);
}

const staleEpon = collectPoll('310', '313');
assert.equal(staleEpon.meta.poll.wrongPollTab, true, 'stale EPON tab must not override canonical Huawei action');
assert.equal(staleEpon.facts.pon.pollAction.value, '', 'wrong poll tab cannot create confirmed canonical pollAction evidence');
assert.equal(staleEpon.meta.locatorObservations[0].passive, true, 'wrong poll tab remains passive context only');

assert.doesNotMatch(source, /\browExpected\b/, 'removed native-row fallback identifier must not remain in Billing poll parser');

console.log('billing_reader_runtime_smoke_test: PASS');
