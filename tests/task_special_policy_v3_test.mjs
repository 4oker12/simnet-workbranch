import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/core/task-special-policy-v3.js', import.meta.url), 'utf8');
const sandbox = { SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'task-special-policy-v3.js' });
const api = sandbox.SIMNET_WB.taskSpecialPolicyV3;
const interpret = (text, context = {}) => api.interpretRows([{ key: 'notes', label: 'Заметки', text }], context);
const summaries = items => Array.from(items, item => item.summary);

test('GPON without cable TV stays two distinct facts', () => {
  const out = interpret('Підключення по технології Gpon без кабельного !!!');
  assert.ok(summaries(out).includes('GPON — да'));
  assert.ok(summaries(out).includes('Кабельное ТВ — нет'));
  assert.ok(!summaries(out).includes('GPON — нет'));
});

test('entrance restriction keeps its scope and visit duration', () => {
  const out = interpret('НА ЗАЯВКУ 3 ГОДИНИ ТРЕБА ! 1 и 2 пар. подключать нет возможности (секція 3 та 4 готові) Підключення по технології Gpon без кабельного !!!');
  const entrance = out.find(item => item.type === 'entrance_scope');
  assert.ok(entrance);
  assert.deepEqual(Array.from(entrance.scope.entrances), ['1', '2']);
  assert.equal(entrance.scope.wholeBuilding, false);
  assert.equal(entrance.summary, '1, 2 подъезды — не подключаем; 3, 4 — можно');
  assert.ok(summaries(out).includes('На заявку минимум 3 часа'));
});

test('non-matching selected entrance suppresses scoped block', () => {
  const out = interpret('1 и 2 пар. подключать нет возможности (секція 3 та 4 готові)', { entrance: '3' });
  assert.ok(!out.some(item => item.type === 'entrance_scope'));
  assert.ok(!out.some(item => item.type === 'connection_block'));
});

test('local entrance block never becomes whole-building block', () => {
  const out = interpret('1 парадное нет возможности подключения');
  assert.ok(out.some(item => item.type === 'entrance_scope'));
  assert.ok(!out.some(item => item.type === 'connection_block'));
});

test('explicit building capacity restrictions remain blockers without duplicate generic line', () => {
  const out = interpret('Трубки все забиты! Нет возможности для подключения!!!');
  assert.ok(summaries(out).includes('Трубки — забиты'));
  assert.ok(!out.some(item => item.type === 'connection_block'));
});

test('future maintenance instruction is not converted into a current blocker', () => {
  const out = interpret('Набирать за день иначе ТРО не пустят /// при наступній заявці замінити свіч');
  assert.ok(summaries(out).includes('Доступ — согласовать заранее'));
  const future = out.find(item => item.temporalScope === 'future_instruction');
  assert.ok(future);
  assert.equal(future.decisionMode, 'info');
});

test('unsafe forceful-access wording requires manual review', () => {
  const out = interpret('Ключи у д. Толи. снимаем двери с петель и будет нам счастье');
  const review = out.find(item => item.needsReview);
  assert.ok(review);
  assert.equal(review.decisionMode, 'manual_review');
  assert.match(review.summary, /ручная проверка/);
});

test('technology or unrelated service restrictions never become a whole-building connection block', () => {
  const ethernet = interpret('По витой паре мы не подключаем, сеть ЮжБора, они обслуживают.', { taskTypeLabel: 'Подключение Интернет' });
  assert.ok(summaries(ethernet).includes('Витая пара — не подключаем'));
  assert.ok(!ethernet.some(item => item.type === 'connection_block'));

  const domophone = interpret('по этой очереди домофоны не подключаем', { taskTypeLabel: 'Подключение Интернет' });
  assert.equal(domophone.length, 0);
});

test('domophone restriction is shown only for a domophone task', () => {
  const note = 'по этой очереди домофоны не подключаем';
  assert.ok(!interpret(note, { taskTypeLabel: 'Подключение Интернет' }).some(item => /Домофон/.test(item.summary)));
  assert.ok(interpret(note, { taskTypeLabel: 'Подключение домофона' }).some(item => item.summary === 'Домофон — не подключаем'));
});

test('embedded page-script garbage is removed from evidence', () => {
  const out = interpret('Підключення по технології Gpon без кабельного !!! recheckTaskBuildingTimeInterval();');
  assert.ok(out.length > 0);
  assert.ok(out.every(item => !item.evidence.includes('recheckTaskBuildingTimeInterval')));
});

console.log('Task special policy v3 tests passed');