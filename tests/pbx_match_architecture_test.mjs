import assert from 'node:assert/strict';
import {
  callIpv4,
  normalizedPhone,
  normalizedContract,
  pbxRecordId,
  pbxCallKey,
  pbxCallMatch
} from '../src/features/call/pbx-match.js';

const fact = value => ({ value, source: 'test', confidence: 1 });
const caseData = {
  identity: { login: fact('abon203949'), contract: fact('203949') },
  network: { ip: fact('10.20.30.40') },
  profile: { phone: fact('0631234567') }
};

assert.equal(callIpv4('10.20.30.40'), '10.20.30.40');
assert.equal(callIpv4('999.20.30.40'), '');
assert.equal(normalizedPhone('+380631234567'), '0631234567');
assert.equal(normalizedContract('abon203949'), '203949');
assert.equal(pbxRecordId('1786645430.185722'), '1786645430.185722');
assert.equal(pbxCallKey('1786645430.185722'), 'pbx:1786645430.185722');
assert.equal(pbxCallMatch({ contract: '203949', subscriberIp: '10.20.30.40' }, caseData).level, 'strong');
assert.equal(pbxCallMatch({ contract: '999999', subscriberIp: '10.20.30.99' }, caseData).level, 'conflict');
assert.equal(pbxCallMatch({ callerId: '+380631234567' }, caseData).level, 'supporting');

console.log('pbx_match_architecture_test: PASS');
