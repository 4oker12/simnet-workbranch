import assert from 'node:assert/strict';
import { buildAiContext, AI_CONTEXT_BUDGET } from '../src/ai/context-builder.js';

const now = new Date().toISOString();
const caseData = {
  updatedAt: now,
  network: { connectionFamily: { value: 'PON' }, mac: { value: '80:AF:CA:2C:F9:89' } },
  profile: { tariff: { value: 'Швидкість - 1000 Мбіт/с', observedAt: now } },
  live: { oltSnapshot: { capturedAt: now, onuStatus: 'online', evidence: [
    { family: 'ont_port_state', facts: { linkState: 'up', speedMbps: 100, duplex: 'full' } },
    { family: 'mac_address', facts: { macs: ['80:AF:CA:2C:F9:89', 'AA:BB:CC:DD:EE:FF'] } },
    { family: 'history', facts: { events24h: 8, events7d: 12, power7d: 8, latestReason: 'dying-gasp' } },
    { family: 'optical', facts: { onuRxDbm: -19.5, temperatureC: 37 } }
  ] } },
  juniper: { result: 'online', lastReadAt: now }
};
const cards = [
  ['scope', 'одно ↔ несколько', ['скорость']],
  ['wifi_band', '2.4 ↔ 5', ['wifi','скорость']],
  ['wifi_distance', 'рядом ↔ далеко', ['wifi','скорость']],
  ['wifi_phy', 'PHY ↔ throughput', ['wifi','скорость']],
  ['wifi_radio', 'channel/width ↔ air load', ['wifi','скорость']],
  ['medium', 'wifi ↔ lan', ['wifi','скорость']],
  ['router_bypass', 'lan ↔ direct', ['скорость']],
  ['ethernet_capacity', 'link ↔ tariff', ['скорость']],
  ['multiple_macs', '1 MAC ↔ many', ['mac']],
  ['stability_events', 'stable ↔ flaps', ['обрыв']],
  ['onu_current_state', 'fresh poll ↔ unknown', ['pon']]
].map(([id, split, tags]) => ({ id, split, tags, use: `use:${id}` }));

const ctx = buildAiContext({
  caseData,
  message: 'скорость по вифи 300-400, по кабелю 700',
  dialogMemory: {},
  recentHistory: [],
  playbook: { revision: 'test', cards, suggestedCardIds: ['wifi_band','wifi_distance','medium'] },
  systemPrompt: 'SYSTEM'.repeat(200)
});

assert.equal(ctx.meta.budget.status, 'ok');
assert.ok(ctx.snapshotText.length <= AI_CONTEXT_BUDGET.snapshotChars);
assert.ok(ctx.playbookText.length <= AI_CONTEXT_BUDGET.playbookChars);
assert.ok(ctx.meta.budget.dynamicChars <= AI_CONTEXT_BUDGET.totalDynamicChars);
assert.ok(ctx.playbook.cards.some(card => card.id === 'wifi_band'));
assert.ok(ctx.playbook.cards.some(card => card.id === 'wifi_distance'));
assert.ok(ctx.playbook.cards.some(card => card.id === 'ethernet_capacity'));
assert.ok(ctx.playbook.cards.some(card => card.id === 'multiple_macs'), 'snapshot anomaly must activate a card even when operator did not type MAC');
assert.ok(ctx.playbook.cards.some(card => card.id === 'stability_events'), 'frequent ONU events must activate stability card');
assert.ok(!ctx.playbook.cards.some(card => card.id === 'medium'), 'current message already contains Wi-Fi and cable result, so do not ask that split again');
assert.ok(ctx.meta.playbookCards.every(card => card.reason), 'inspector must explain why each card was selected');
assert.ok(ctx.meta.selectedSnapshot.every(row => row.path && row.reason), 'inspector must explain why each fact was selected');
assert.ok(ctx.meta.excludedSnapshot.includes('temperature'));

const withMemory = buildAiContext({
  caseData,
  message: 'что дальше?',
  dialogMemory: { wifi_band: '5 GHz', direct_test: 'unavailable' },
  recentHistory: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `long message ${i} `.repeat(80) })),
  playbook: { revision: 'test', cards, suggestedCardIds: ['wifi_band','router_bypass','wifi_distance','wifi_phy','wifi_radio'] },
  systemPrompt: 'SYSTEM'
});
assert.ok(!withMemory.playbook.cards.some(card => card.id === 'wifi_band'), 'known dialog fact must remove already-resolved split');
assert.ok(!withMemory.playbook.cards.some(card => card.id === 'router_bypass'), 'unavailable test must not be proposed again');
assert.ok(withMemory.playbook.cards.some(card => ['wifi_phy','wifi_radio','wifi_distance'].includes(card.id)), 'vague continuation with Wi-Fi memory must still surface a proactive technical next step');
assert.ok(withMemory.meta.historyMessages <= AI_CONTEXT_BUDGET.maxHistoryMessages);
assert.ok(withMemory.meta.sections.history.chars <= AI_CONTEXT_BUDGET.historyChars);

console.log('ai_context_builder_contract_test: PASS', { cards: ctx.playbook.cards.map(x => x.id), dynamicChars: ctx.meta.budget.dynamicChars });

const generalCards = [
  ['scope', 'одно ↔ несколько', ['нет интернета']],
  ['link_vs_internet', 'Wi-Fi остаётся ↔ падает', ['нет интернета','обрыв']],
  ['ip_gateway', 'IP/gateway ↔ DHCP/LAN', ['нет интернета','dhcp']],
  ['dns_path', 'IP ↔ DNS', ['dns','нет интернета','сайт']],
  ['recovery', 'сам ↔ reboot', ['обрыв']],
  ['vpn_path', 'VPN/другая сеть', ['vpn','сайт']],
  ['cpe_reboot', 'reboot effect', ['нет интернета','обрыв']],
  ['pon_lights', 'LOS/power', ['pon','нет интернета']],
  ['service_scope', 'one ↔ many services', ['сайт','сервис']]
].map(([id, split, tags]) => ({ id, split, tags, use: `use:${id}` }));

const noInternetCtx = buildAiContext({
  caseData,
  message: 'что еще проверить если интернета нет?',
  dialogMemory: {
    affected_devices: 'all',
    wifi_association: 'stays',
    cpe_reboot: 'tried_no_effect',
    wired_test: 'unavailable'
  },
  recentHistory: [],
  playbook: { revision: 'general', cards: generalCards, suggestedCardIds: generalCards.map(x => x.id) },
  systemPrompt: 'SYSTEM'
});
assert.ok(!noInternetCtx.playbook.cards.some(card => card.id === 'scope'), 'known affected-device scope must not be asked again');
assert.ok(!noInternetCtx.playbook.cards.some(card => card.id === 'link_vs_internet'), 'known Wi-Fi association behavior must close that split');
assert.ok(!noInternetCtx.playbook.cards.some(card => card.id === 'cpe_reboot'), 'known no-effect CPE reboot must not be repeated');
assert.ok(noInternetCtx.playbook.cards.some(card => ['ip_gateway','dns_path','pon_lights'].includes(card.id)), 'no-internet continuation must still have proactive technical branches');
assert.match(noInternetCtx.memoryText, /wired_test: unavailable/, 'unavailable tests must survive context memory selection');
assert.match(noInternetCtx.memoryText, /cpe_reboot: tried_no_effect/, 'no-effect tests must survive context memory selection');

const serviceCtx = buildAiContext({
  caseData,
  message: 'что дальше с этим сервисом?',
  dialogMemory: { service_scope: 'one_service', vpn_effect: 'fixes', mobile_network_test: 'works' },
  recentHistory: [],
  playbook: { revision: 'general', cards: generalCards, suggestedCardIds: ['service_scope','vpn_path','dns_path'] },
  systemPrompt: 'SYSTEM'
});
assert.ok(!serviceCtx.playbook.cards.some(card => card.id === 'service_scope'), 'known one-service scope must not be re-asked');
assert.ok(!serviceCtx.playbook.cards.some(card => card.id === 'vpn_path'), 'known VPN/other-network discriminator must not be re-asked');
assert.ok(serviceCtx.playbook.cards.some(card => card.id === 'dns_path'), 'remaining DNS/path branch should still be available');
