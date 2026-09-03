import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

const document = {
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  getElementById() { return null; },
  createElement() { return { dataset: {}, style: {}, appendChild() {}, setAttribute() {} }; },
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll() { return []; },
  querySelector() { return null; }
};
const windowObject = {};
windowObject.top = windowObject;
windowObject.self = windowObject;

const context = {
  console,
  Date,
  Math,
  URL,
  location: { href: 'https://userside.simnet.kiev.ua/task/dialog_add?typer=1', pathname: '/task/dialog_add' },
  document,
  window: windowObject,
  globalThis: null,
  HTMLFormElement: class {},
  HTMLSelectElement: class {},
  Element: class {},
  CSS: { escape(value) { return String(value); } },
  SIMNET_WB: {}
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'task-form-assistant.js' });

const t = context.SIMNET_WB.taskFormAssistant?._test;
assert.ok(t, 'test helpers must be available');
assert.equal(t.parseDate('23.08.2026')?.day, 23);
assert.equal(t.parseDate('31.02.2026'), null);
assert.equal(t.parseDateTime('23.08.2026 16:05')?.hour, 16);
assert.equal(t.parseDateTime('23.08.2026 24:00'), null);
assert.equal(t.parseDateTime('23.08.2026 16:60'), null);
assert.equal(t.parseNumber('2'), 2);
assert.equal(t.parseNumber('2,5'), 2.5);
assert.equal(Number.isNaN(t.parseNumber('-1')), true);
assert.equal(t.parseNumber(''), null);

console.log('task_form_assistant_parser_unit_test: PASS');
