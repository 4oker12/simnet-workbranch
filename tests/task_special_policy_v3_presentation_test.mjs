import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const baseSource = fs.readFileSync(new URL('../src/core/task-special-policy-v3.js', import.meta.url), 'utf8');
const contextualSource = fs.readFileSync(new URL('../src/core/task-special-policy-v3-contextual.js', import.meta.url), 'utf8');
const sandbox = { SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(baseSource, sandbox, { filename: 'task-special-policy-v3.js' });
vm.runInContext(contextualSource, sandbox, { filename: 'task-special-policy-v3-contextual.js' });
const api = sandbox.SIMNET_WB.taskSpecialPolicyV3;

function present(item, context = {}) {
  return api.presentItem(item, context);
}

test('presentation API is available globally after contextual policy layer', () => {
  assert.equal(typeof api.presentItem, 'function');
  assert.equal(api.contextualPolicyVersion, 2);
});

test('access window explains why timing can break the visit and gives a concrete action', () => {
  const view = present({
    type: 'access_window',
    severity: 'warning',
    summary: 'ЖЭК — до 17:00'
  });
  assert.equal(view.tag, 'ДОСТУП / ВРЕМЯ');
  assert.match(view.impact, /выезд сорвётся/);
  assert.match(view.action, /до 17:00/);
});

test('key and domophone access note becomes an access risk instead of a vague warning', () => {
  const view = present({
    type: 'access_coordination',
    severity: 'review',
    needsReview: true,
    summary: 'Доступ — есть важная информация по ключам',
    evidence: '3 парадне доступ домофон B100B7273'
  });
  assert.equal(view.tag, 'ДОСТУП');
  assert.equal(view.severityLabel, 'НУЖНА ПРОВЕРКА');
  assert.match(view.impact, /ключа, кода|ключа\/кода|ключа/);
  assert.match(view.action, /ключ\/код\/контакт/);
});

test('hard connection block is visually and semantically the strongest level', () => {
  const view = present({
    type: 'connection_block',
    severity: 'blocker',
    decisionMode: 'hard_block_if_scope_matches',
    summary: 'Подключение — нет технической возможности'
  });
  assert.equal(view.severity, 'blocker');
  assert.equal(view.severityLabel, 'МОЖЕТ СОРВАТЬ ЗАЯВКУ');
  assert.match(view.impact, /невыполнима/);
  assert.match(view.action, /Не обещать подключение/);
});

test('technology restriction explains execution risk instead of merely repeating CRM text', () => {
  const view = present({
    type: 'technology_restriction',
    severity: 'warning',
    summary: 'Подключение — только GPON'
  });
  assert.equal(view.tag, 'ТЕХНОЛОГИЯ');
  assert.match(view.impact, /Неверная технология/);
  assert.match(view.action, /Сверить технологию заявки/);
});

test('unknown special condition still gets safe generic impact and action', () => {
  const view = present({ type: 'unknown_future_type', summary: 'Особое условие' });
  assert.equal(view.tag, 'ВАЖНО');
  assert.ok(view.impact.length > 20);
  assert.ok(view.action.length > 20);
});
