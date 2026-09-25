import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_OPERATOR_SOFT_TOOL_CAPABILITIES,
  AI_OPERATOR_SOFT_TOOL_CATALOG,
  mapInformationNeedsToTools
} from '../src/features/ai-operator/semantic-tool-broker.js';

const REQUIRED_TOOLS = [
  'customer.lookup',
  'customer.confirm',
  'customer.snapshot',
  'billing.balance',
  'billing.tariff',
  'billing.history',
  'billing.payments',
  'userside.snapshot',
  'building.snapshot',
  'network.session',
  'pon.onu',
  'pon.signal'
];

test('tool manifest explains what each tool establishes, answers, returns and when to use it', () => {
  const byName = new Map(AI_OPERATOR_SOFT_TOOL_CATALOG.map(tool => [tool.name, tool]));
  assert.deepEqual([...byName.keys()], REQUIRED_TOOLS);

  for (const name of REQUIRED_TOOLS) {
    const tool = byName.get(name);
    assert.ok(tool.establishes?.length > 20, `${name} must explain what it establishes`);
    assert.ok(Array.isArray(tool.answers) && tool.answers.length >= 2, `${name} must list questions it answers`);
    assert.ok(Array.isArray(tool.recommendedWhen) && tool.recommendedWhen.length >= 1, `${name} must explain when to use it`);
    assert.ok(Array.isArray(tool.returns) && tool.returns.length >= 1, `${name} must list returned evidence`);
    assert.ok(Array.isArray(tool.requires) && tool.requires.length >= 1, `${name} must list runtime requirements`);
    assert.ok(Array.isArray(tool.limitations) && tool.limitations.length >= 1, `${name} must state limitations`);
    assert.match(tool.implementation, /^implemented/);
    assert.ok(tool.mode);
  }
});

test('planner receives the manifest and an explicit goal -> Billing identity -> fact -> tool -> result contract', () => {
  const planner = AI_OPERATOR_SOFT_TOOL_CAPABILITIES.toolPlanner;
  assert.equal(AI_OPERATOR_SOFT_TOOL_CAPABILITIES.billing, true);
  assert.equal(AI_OPERATOR_SOFT_TOOL_CAPABILITIES.userside, true);
  assert.equal(AI_OPERATOR_SOFT_TOOL_CAPABILITIES.network, true);
  assert.equal(planner.version, 11);
  assert.equal(planner.tools.length, REQUIRED_TOOLS.length);
  assert.equal(planner.identityPolicy.primarySystem, 'Billing');
  assert.equal(planner.identityPolicy.primaryTool, 'customer.lookup');
  assert.match(planner.identityPolicy.rule, /первый и основной поиск.*Billing customer\.lookup/i);
  assert.match(planner.instruction, /ПЕРВЫМ действием используй Billing customer\.lookup/i);
  assert.match(planner.instruction, /UserSide не используй как основной первичный поиск/i);
  assert.match(planner.instruction, /точного имени инструмента/i);
  assert.match(planner.instruction, /billing\.balance и billing\.tariff.*один и тот же.*table\.tbg1\.nav3\.width100/i);
  assert.match(planner.instruction, /network\.session.*ранним рекомендуемым инструментом/i);
  assert.match(planner.instruction, /authoritative/i);
  assert.match(planner.semanticFrameRule, /Первый semantic understanding.*authoritative/i);
  assert.match(planner.replyStyleRule, /живой оператор/i);
  assert.match(planner.replyStyleRule, /1–3 коротких предложения/i);
  assert.match(planner.replyStyleRule, /не показывай/i);
  assert.match(planner.planningRule, /Цель клиента.*Billing customer\.lookup.*неизвестный факт.*tool.*результат tool/i);
  assert.match(planner.successRule, /ok=true/i);
  assert.match(planner.successRule, /ok=false/i);
});

test('planner keeps full runtime manifest but serializes a compact prompt-safe view', () => {
  const planner = AI_OPERATOR_SOFT_TOOL_CAPABILITIES.toolPlanner;
  assert.ok(planner.tools.every(tool => Array.isArray(tool.answers) && tool.answers.length >= 2));
  const serialized = JSON.stringify(AI_OPERATOR_SOFT_TOOL_CAPABILITIES);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.toolPlanner.version, 11);
  assert.match(parsed.toolPlanner.replyStyleRule, /живой оператор/i);
  assert.deepEqual(parsed.toolPlanner.tools.map(tool => tool.name), REQUIRED_TOOLS);
  assert.ok(parsed.toolPlanner.tools.every(tool => !('answers' in tool) && !('returns' in tool) && !('limitations' in tool)));
  assert.ok(serialized.length < 12000, `serialized reply capability context is too large: ${serialized.length}`);
});

test('customer.lookup is the default primary subscriber search and UserSide is post-identification', () => {
  const lookup = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'customer.lookup');
  const userside = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'userside.snapshot');
  assert.ok(lookup);
  assert.ok(userside);
  assert.equal(lookup.system, 'Billing');
  assert.equal(lookup.mode, 'billing-live-read-only');
  assert.ok(lookup.recommendedWhen.some(item => /ПЕРВЫМ? и основной поиск.*Billing/i.test(item)) || lookup.recommendedWhen.some(item => /ПЕРВЫЙ и основной поиск.*Billing/i.test(item)));
  assert.ok(userside.requires.some(item => /через Billing customer\.lookup/i.test(item)));
  assert.ok(userside.limitations.some(item => /не использовать UserSide как основной первичный поиск/i.test(item)));
});

test('billing balance and tariff share the same main Billing DOM evidence source', () => {
  const balance = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'billing.balance');
  const tariff = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'billing.tariff');
  assert.ok(balance);
  assert.ok(tariff);
  assert.equal(balance.endpoint, '/cgi-bin/adm/adm.pl?a=user&id=<billingId>');
  assert.equal(tariff.endpoint, balance.endpoint);
  assert.match(balance.evidenceSource, /table\.tbg1\.nav3\.width100/i);
  assert.match(tariff.evidenceSource, /table\.tbg1\.nav3\.width100/i);
  assert.match(balance.evidenceSource, /один fresh GET/i);
  assert.match(tariff.recommendedWhen.join(' '), /общий main-summary snapshot/i);
  assert.ok(balance.limitations.some(item => /balanceAfterTariff.*не.*accountBalance/i.test(item)));
});

test('network.session uses fresh Billing stat.pl a=252 and keeps Workbench only as fallback', () => {
  const tool = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'network.session');
  assert.ok(tool);
  assert.equal(tool.implementation, 'implemented');
  assert.equal(tool.mode, 'billing-stat-live-read-only + workbench-fallback');
  assert.match(tool.endpoint, /stat\.pl.*a=252/i);
  assert.match(tool.evidenceSource, /Billing stat\.pl a=252/i);
  assert.ok(tool.recommendedWhen.some(item => /нет интернета/i.test(item)));
  assert.ok(tool.answers.some(item => /сесси/i.test(item)));
  assert.ok(tool.returns.includes('router'));
  assert.ok(tool.returns.includes('vendor'));
  assert.ok(tool.returns.includes('vlan'));
  assert.ok(tool.limitations.some(item => /Workbench fallback/i.test(item)));
});

test('building.snapshot is a distinct building-card tool, not a PON signal tool', () => {
  const building = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'building.snapshot');
  assert.ok(building);
  assert.equal(building.mode, 'userside-building-snapshot-local');
  assert.ok(building.answers.some(item => /GPON.*дом|оптическое покрытие/i.test(item)));
  assert.ok(building.recommendedWhen.some(item => /дому|зданию|покрытию/i.test(item)));
  assert.ok(building.limitations.some(item => /NOT_FOUND.*не доказывает/i.test(item)));

  const buildingPlan = mapInformationNeedsToTools([
    { system: 'UserSide', field: 'building.snapshot: GPON coverage по дому', why: 'Проверить оптику по адресу.' }
  ]);
  assert.deepEqual(buildingPlan.map(item => item.tool), ['building.snapshot']);

  const signalPlan = mapInformationNeedsToTools([
    { system: 'UserSide', field: 'pon.signal: RX/TX/dBm', why: 'Проверить текущий оптический сигнал ONU.' }
  ]);
  assert.deepEqual(signalPlan.map(item => item.tool), ['pon.signal']);
});

test('exact tool names placed in subscriber_data_needed.field route to the intended executor', () => {
  const needs = [
    { system: 'Network', field: 'network.session: current/last BRAS session', why: 'Проверить авторизацию при жалобе нет интернета.' },
    { system: 'UserSide', field: 'userside.snapshot: access family and connection point', why: 'Понять PON это или Ethernet.' },
    { system: 'UserSide', field: 'pon.onu: ONU/OLT/port', why: 'Проверить PON ветку.' },
    { system: 'UserSide', field: 'pon.signal: RX/TX/dBm', why: 'Проверить оптический сигнал.' },
    { system: 'Billing', field: 'billing.balance: current balance', why: 'Ответить на вопрос о балансе.' },
    { system: 'Billing', field: 'billing.tariff: current tariff', why: 'Ответить про скорость по тарифу.' },
    { system: 'Billing', field: 'billing.payments: latest payments', why: 'Проверить, виден ли платёж.' }
  ];
  assert.deepEqual(
    mapInformationNeedsToTools(needs).map(item => item.tool),
    ['network.session', 'userside.snapshot', 'pon.onu', 'pon.signal', 'billing.balance']
  );
});

test('billing.history is a distinct lazy payshow historical source', () => {
  const history = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'billing.history');
  assert.ok(history);
  assert.equal(history.mode, 'billing-payshow-history-live-read-only + snapshot-cache');
  assert.match(history.endpoint, /a=payshow/);
  assert.match(history.establishes, /изменения пакета|блокировки|временные платежи/i);
  assert.ok(history.limitations.some(item => /historical|current state/i.test(item)));
  assert.ok(history.limitations.some(item => /session token/i.test(item)));

  const planned = mapInformationNeedsToTools([
    { system: 'Billing', field: 'billing.history: когда меняли пакет и когда блокировали', why: 'Нужна история изменений клиента.' }
  ]);
  assert.deepEqual(planned.map(item => item.tool), ['billing.history']);
});
