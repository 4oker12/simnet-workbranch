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
  'billing.payments',
  'userside.snapshot',
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
  assert.equal(planner.version, 2);
  assert.equal(planner.tools.length, REQUIRED_TOOLS.length);
  assert.equal(planner.identityPolicy.primarySystem, 'Billing');
  assert.equal(planner.identityPolicy.primaryTool, 'customer.lookup');
  assert.match(planner.identityPolicy.rule, /первый и основной поиск.*Billing customer\.lookup/i);
  assert.match(planner.instruction, /ПЕРВЫМ действием используй Billing customer\.lookup/i);
  assert.match(planner.instruction, /UserSide не используй как основной первичный поиск/i);
  assert.match(planner.instruction, /точного имени инструмента/i);
  assert.match(planner.planningRule, /Цель клиента.*Billing customer\.lookup.*неизвестный факт.*tool.*результат tool/i);
  assert.match(planner.successRule, /ok=true/i);
  assert.match(planner.successRule, /ok=false/i);
});

test('customer.lookup is the default primary subscriber search and UserSide is post-identification', () => {
  const lookup = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'customer.lookup');
  const userside = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'userside.snapshot');
  assert.ok(lookup);
  assert.ok(userside);
  assert.equal(lookup.system, 'Billing');
  assert.equal(lookup.mode, 'billing-live-read-only');
  assert.ok(lookup.recommendedWhen.some(item => /ПЕРВЫЙ и основной поиск.*Billing/i.test(item)));
  assert.ok(userside.requires.some(item => /через Billing customer\.lookup/i.test(item)));
  assert.ok(userside.limitations.some(item => /не использовать UserSide как основной первичный поиск/i.test(item)));
});

test('network.session is explicitly documented as useful for no-internet diagnosis but not fresh Juniper live read', () => {
  const tool = AI_OPERATOR_SOFT_TOOL_CATALOG.find(item => item.name === 'network.session');
  assert.ok(tool);
  assert.equal(tool.implementation, 'implemented_limited');
  assert.equal(tool.mode, 'workbench-case-read-only');
  assert.ok(tool.recommendedWhen.some(item => /нет интернета/i.test(item)));
  assert.ok(tool.answers.some(item => /BRAS-сесси/i.test(item)));
  assert.ok(tool.limitations.some(item => /не выдавать.*свежий.*Juniper/i.test(item)));
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
