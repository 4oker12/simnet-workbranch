import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAiCaseSnapshot } from '../src/ai/case-snapshot.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/abon507126-poll-desync.json', import.meta.url), 'utf8'));
function findCase(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.id && value.network && value.pon && value.juniper) return value;
  for (const child of Object.values(value)) {
    const found = findCase(child);
    if (found) return found;
  }
  return null;
}
const fixtureCase = findCase(fixture);
assert.ok(fixtureCase, 'fixture must contain a case');
const fixtureSnapshot = buildAiCaseSnapshot(fixtureCase, { message: 'нет интернета' });
assert.equal(fixtureSnapshot.schema, 'simnet-ai-diagnostic-snapshot-v2');
assert.equal(fixtureSnapshot.access.family, 'PON');
assert.equal(fixtureSnapshot.bras.state, 'online');
const fixtureSerialized = JSON.stringify(fixtureSnapshot);
assert.doesNotMatch(fixtureSerialized, /sourceUrl|sessionId|journal|operations|contexts|viewsByTab|bindingFingerprint|responseSummary|temperatureC|tmcOnuRx/,
  'default AI snapshot must be diagnostic state, not a technical dump');

const now = new Date().toISOString();
const caseData = {
  id: 'billing:billing:test',
  updatedAt: now,
  network: {
    connectionFamily: { value: 'PON' },
    mac: { value: '80:AF:CA:2C:F9:89' }
  },
  profile: {
    tariff: {
      value: 'Безліміт 1000 (1000 Mbit) Швидкість - 1000 Мбіт/с',
      source: 'billing:labeled-tariff',
      observedAt: now
    }
  },
  pon: { onuMac: { value: 'B4:64:15:A2:C5:EA' } },
  live: {
    oltSnapshot: {
      capturedAt: now,
      onuStatus: 'online',
      evidence: [
        { family: 'ont_info', state: 'normal', facts: { runState: 'online', lastDownCause: 'dying-gasp', onlineDuration: '2 day(s)' } },
        { family: 'ont_port_state', state: 'normal', facts: { linkState: 'up', speedMbps: 100, duplex: 'full' } },
        { family: 'mac_address', state: 'attention', facts: { macs: ['80:AF:CA:2C:F9:89', 'AA:BB:CC:DD:EE:FF'] } },
        { family: 'history', state: 'attention', facts: { events24h: 20, events7d: 20, power7d: 20, latestReason: 'dying-gasp' } },
        { family: 'optical', state: 'normal', facts: { onuRxDbm: -19.5, oltRxDbm: -23.27, onuTxDbm: 2.43, temperatureC: 37 } },
        { family: 'service_port', state: 'normal', facts: { state: 'up', vlan: 3764 } }
      ]
    }
  },
  juniper: { result: 'online', lastReadAt: now },
  diagnostic: { usersideVisited: true, hasTmcOnu: true }
};

const snapshot = buildAiCaseSnapshot(caseData, { message: 'скорость по вифи 300' });
assert.equal(snapshot.tariff.speedMbps, 1000);
assert.equal(snapshot.onu.status, 'online');
assert.equal(snapshot.onu.lastDownCause, 'dying-gasp');
assert.equal(snapshot.ethernet.link, 'up');
assert.equal(snapshot.ethernet.speedMbps, 100);
assert.equal(snapshot.ethernet.duplex, 'full');
assert.equal(snapshot.ethernet.capacityVsTariff, 'insufficient');
assert.equal(snapshot.identity.learnedCount, 2);
assert.equal(snapshot.identity.learnedState, 'multiple');
assert.equal(snapshot.identity.subscriberMacMatch, 'match');
assert.equal(snapshot.stability.state, 'abnormal');
assert.equal(snapshot.stability.dyingGasp7d, 20);
assert.ok(snapshot.anomalies.some(row => row.id === 'ethernet_below_tariff'));
assert.ok(snapshot.anomalies.some(row => row.id === 'multiple_learned_macs'));
assert.ok(snapshot.anomalies.some(row => row.id === 'frequent_onu_events'));
const serialized = JSON.stringify(snapshot);
assert.doesNotMatch(serialized, /temperatureC|\"temperature\"|3764|-19\.5|-23\.27|B4:64:15|80:AF:CA|AA:BB:CC/,
  'temperature, optical values, VLAN and raw MAC values must not travel by default');

const optical = buildAiCaseSnapshot(caseData, { message: 'какой сейчас Rx и Tx?' });
assert.equal(optical.details.optical.onuRxDbm, -19.5);
assert.equal(optical.details.optical.oltRxDbm, -23.27);
assert.equal(optical.details.optical.onuTxDbm, 2.43);
assert.doesNotMatch(JSON.stringify(optical.details.optical), /temperature/i, 'temperature stays excluded even on optical detail request');

const mac = buildAiCaseSnapshot(caseData, { message: 'какие MAC видит ONU?' });
assert.equal(mac.details.mac.learnedMacs.length, 2);

console.log('ai_case_snapshot_contract_test: PASS', { chars: serialized.length, anomalies: snapshot.anomalies.map(x => x.id) });

const mbTariffCase = structuredClone(caseData);
mbTariffCase.profile = { ...(mbTariffCase.profile || {}), tariff: { value: 'Internet_ Aktsiya 89 (1000Mb)' } };
mbTariffCase.live = mbTariffCase.live || {};
mbTariffCase.live.oltSnapshot = {
  ...(mbTariffCase.live.oltSnapshot || {}),
  speedMbps: 1000,
  linkState: 'up',
  duplex: 'full',
  evidence: [
    ...((mbTariffCase.live.oltSnapshot?.evidence || []).filter(row => row?.family !== 'ont_port_state')),
    { family: 'ont_port_state', facts: { speedMbps: 1000, linkState: 'up', duplex: 'full' } }
  ]
};
const mbTariffSnapshot = buildAiCaseSnapshot(mbTariffCase, { message: 'низкая скорость' });
assert.equal(mbTariffSnapshot.tariff.speedMbps, 1000, 'Billing tariff text with 1000Mb must parse as 1000 Mbps');
assert.equal(mbTariffSnapshot.ethernet.capacityVsTariff, 'sufficient', '1G Ethernet must be sufficient for a 1000Mb tariff');

