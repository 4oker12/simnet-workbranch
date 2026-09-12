import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  '../src/core/task-special-policy-v3.js',
  '../src/core/task-special-policy-v3-contextual.js',
  '../src/core/task-special-policy-v3-safety-net.js',
  '../src/core/task-special-policy-v3-note-refiner.js'
];

const sandbox = { SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of files) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  vm.runInContext(source, sandbox, { filename: file });
}

const api = sandbox.SIMNET_WB.taskSpecialPolicyV3;
const interpret = text => api.interpretRows([{ key: 'working_note', text }], { address: 'макс' });

test('security + keys note becomes one concrete short fact block and ignores PON box inventory', () => {
  const source = 'Необхідно попереджувати охорону абоненту про те, що в них буде бригада по інтернету. 067 107 38 08 жек , Ключі від колясочної в диспетчера, 2га секція. GPON: Абон.боксы с делит. 1/8: (1 - 2 - 3 пар., на 3 - 6 - 9 - 12 этажах, в слаботочной нише).';
  const items = interpret(source);
  const access = items.filter(item => item.type === 'access_coordination');

  assert.equal(access.length, 1);
  assert.match(access[0].summary, /^2 секция:/);
  assert.match(access[0].summary, /охрану нужно предупредить о визите интернет-бригады/);
  assert.match(access[0].summary, /Ключи от колясочной — у диспетчера/);
  assert.match(access[0].summary, /ЖЭК: 067 107 38 08/);
  assert.doesNotMatch(access[0].summary, /GPON|бокс|1\/8/iu);
  assert.equal(items.some(item => /есть важная информация по ключам|проверь исходную заметку|обязательное условие/iu.test(item.summary)), false);
});

test('positive PON-only note does not produce a generic warning card', () => {
  const items = interpret('Кембридж. Полностью можно включать по пону');
  assert.equal(items.some(item => ['access_coordination', 'manual_review'].includes(item.type)), false);
});

test('unknown mandatory note shows its useful clause instead of a template heading', () => {
  const items = interpret('Необходимо заранее согласовать вход с управляющим. GPON: боксы 1/8 в слаботочной нише.');
  assert.equal(items.some(item => /проверь исходную заметку|есть обязательное условие/iu.test(item.summary)), false);
  assert.equal(items.some(item => /заранее согласовать вход с управляющим/iu.test(item.summary)), true);
});
