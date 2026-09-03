import assert from 'node:assert/strict';
import { aiDialogSessionKey, normalizeDialogMemory, normalizeAiSession, aiRecentHistory, mergeDialogMemory, deriveOperatorDialogMemory } from '../src/ai/dialog-session.js';

const caseA = { id: 'billing:billing:625', episodeId: 'episode-A' };
const caseB = { id: 'billing:billing:625', episodeId: 'episode-B' };
assert.equal(aiDialogSessionKey(caseA), 'billing:billing:625::episode-A');
assert.notEqual(aiDialogSessionKey(caseA), aiDialogSessionKey(caseB), 'same subscriber in another episode must not inherit previous chat');

const memory = normalizeDialogMemory({
  complaint: 'низкая скорость',
  wifi_band: '5 GHz',
  direct_test: 'unavailable',
  'bad key!': 'drop',
  service_name: 'x'.repeat(500)
});
assert.equal(memory.wifi_band, '5 GHz');
assert.equal(memory.wired_test, 'unavailable', 'legacy direct_test must migrate to wired_test');
assert.ok(!('bad key!' in memory));
assert.ok(memory.service_name.length <= 181);

const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, ...(i === 19 ? { context: { actualPromptTokens: 1234, selectedSnapshot: [{ path: 'ethernet.link', value: 'up', reason: 'physical link' }], playbookCards: [{ id: 'wifi_band', reason: 'split' }], sections: { snapshot: { chars: 100, approxTokens: 25 } } } } : {}) }));
const session = normalizeAiSession({ messages, dialogMemory: memory }, { caseId: caseA.id, episodeId: caseA.episodeId });
assert.equal(session.messages.length, 16, 'stored literal transcript must be bounded');
const history = aiRecentHistory(session, 6);
assert.equal(history.length, 6, 'model must receive only a short literal tail');
assert.equal(history.at(-1).content, 'm19');
assert.equal(session.messages.at(-1).context.actualPromptTokens, 1234, 'context inspector metadata must survive persisted session normalization');
assert.equal(session.messages.at(-1).context.selectedSnapshot[0].path, 'ethernet.link');

const guardedMemory = normalizeDialogMemory({ fact_key: 'value', key: 'example', wifi_band: '5GHz', wired_test: 'unavailable' });
assert.deepEqual(guardedMemory, { wifi_band: '5GHz', wired_test: 'unavailable' }, 'placeholder memory keys must never survive normalization');

console.log('ai_dialog_session_test: PASS');


const operatorMemory1 = deriveOperatorDialogMemory({}, 'та на 5 ггц он, я же говорил');
assert.equal(operatorMemory1.wifi_band, '5GHz', 'explicit operator Wi-Fi band must be remembered deterministically');
const operatorMemory2 = deriveOperatorDialogMemory(operatorMemory1, 'нет возможности!', [{ role: 'assistant', content: 'По кабелю или напрямую от ONU замерить можете?' }]);
assert.equal(operatorMemory2.wired_test, 'unavailable', 'short unavailable answer must bind to the previous wired-test question');
const operatorMemory3 = deriveOperatorDialogMemory({ wifi_band: '2.4GHz' }, 'нет, я ошибся, он на 5 ггц');
assert.equal(operatorMemory3.wifi_band, '5GHz', 'operator correction must replace the previous deterministic fact');
const operatorMemory4 = deriveOperatorDialogMemory({}, 'а если он на 5 ггц?');
assert.ok(!operatorMemory4.wifi_band, 'hypothetical Wi-Fi band must not become a fact');
const operatorMemory5 = deriveOperatorDialogMemory({}, 'меряет возле роутера, на двух телефонах одинаково');
assert.equal(operatorMemory5.wifi_distance, 'near_router');
assert.equal(operatorMemory5.affected_devices, 'multiple');
const sticky = mergeDialogMemory({ wifi_band: '5GHz', wired_test: 'unavailable' }, { wifi_band: 'unknown', wired_test: 'unknown', wifi_distance: 'near_router' });
assert.deepEqual(sticky, { wifi_band: '5GHz', wired_test: 'unavailable', wifi_distance: 'near_router' }, 'model memory must not downgrade established operator facts to unknown');

// Generalized sparse memory across complaint types.
const noInternetMemory = deriveOperatorDialogMemory({}, 'интернет пропадает на всех устройствах, но Wi-Fi остаётся подключенным');
assert.equal(noInternetMemory.affected_devices, 'all');
assert.equal(noInternetMemory.wifi_association, 'stays');
assert.equal(noInternetMemory.problem_pattern, 'intermittent');

const rebootMemory = deriveOperatorDialogMemory({}, 'роутер уже перезагружали, не помогло');
assert.equal(rebootMemory.cpe_reboot, 'tried_no_effect');

const serviceMemory = deriveOperatorDialogMemory({}, 'только Netflix не открывается, остальные сайты работают, через VPN работает');
assert.equal(serviceMemory.service_scope, 'one_service');
assert.equal(serviceMemory.service_name.toLowerCase(), 'netflix');
assert.equal(serviceMemory.vpn_effect, 'fixes');

const dnsMemory = deriveOperatorDialogMemory({}, 'пинг 8.8.8.8 идет, nslookup дает таймаут, DNS меняли — не помогло');
assert.equal(dnsMemory.ping_ip, 'works');
assert.equal(dnsMemory.dns_resolution, 'fails');
assert.equal(dnsMemory.dns_change, 'tried_no_effect');

const dropsMemory = deriveOperatorDialogMemory({}, 'вайфай остается, интернет пропадает на 20 секунд и сам восстанавливается каждые 10 минут');
assert.equal(dropsMemory.wifi_association, 'stays');
assert.equal(dropsMemory.drop_recovery, 'automatic');
assert.match(dropsMemory.drop_duration, /20/);
assert.match(dropsMemory.drop_frequency, /10/);

const ponMemory = deriveOperatorDialogMemory({}, 'сейчас LOS мигает красным, ONU включена');
assert.equal(ponMemory.los_reported, 'now');
assert.equal(ponMemory.onu_power_state, 'on');

const massMemory = deriveOperatorDialogMemory({}, 'со слов абонента соседи тоже жалуются, но обращений по дому нет');
assert.equal(massMemory.mass_neighbor_report, 'subscriber_report');
assert.equal(massMemory.mass_other_tickets, 'none_confirmed');

const shortOtherDeviceUnavailable = deriveOperatorDialogMemory({}, 'нет возможности', [{ role: 'assistant', content: 'На другом телефоне проверить можете?' }]);
assert.equal(shortOtherDeviceUnavailable.other_device_test, 'unavailable');

const mixedHypothetical = deriveOperatorDialogMemory({}, 'на всех устройствах проблема. А если сосед тоже жалуется?');
assert.equal(mixedHypothetical.affected_devices, 'all');
assert.ok(!mixedHypothetical.mass_neighbor_report, 'hypothetical tail must not become a mass-outage fact');

const allowlistedOnly = normalizeDialogMemory({
  wifi_band: '5GHz',
  wired_test_suggested: 'true',
  invented_diagnosis: 'router is guilty',
  dns_resolution: 'fails'
});
assert.deepEqual(allowlistedOnly, { wifi_band: '5GHz', dns_resolution: 'fails' }, 'dialog memory must reject model-invented schema keys');

