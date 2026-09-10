import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeElement {
  constructor({ id = '', dataset = {}, tagName = 'DIV' } = {}) {
    this.id = id;
    this.dataset = dataset;
    this.tagName = tagName;
    this.innerText = '';
    this.textContent = '';
    this.value = '';
  }
  matches(selector) {
    if (selector.includes('select') && this.tagName === 'SELECT') return true;
    if (selector.includes('button') && this.tagName === 'BUTTON') return true;
    return false;
  }
  closest() { return null; }
  hasAttribute() { return false; }
}

let clickHandler = null;
const emitted = [];
const sandbox = {
  console,
  AbortController,
  Element: FakeElement,
  queueMicrotask,
  SIMNET_WB: {
    bus: {
      emit(type, payload) { emitted.push({ type, payload }); }
    }
  }
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.window.top = sandbox.window;
sandbox.window.self = sandbox.window;
sandbox.document = {
  addEventListener(type, handler) {
    if (type === 'click') clickHandler = handler;
  }
};

const source = fs.readFileSync(new URL('../src/core/click-debug.js', import.meta.url), 'utf8');
vm.runInNewContext(source, sandbox, { filename: 'click-debug.js' });
assert.equal(typeof clickHandler, 'function', 'click debugger must attach its capture listener');

const select = new FakeElement({ tagName: 'SELECT' });
const railHost = new FakeElement({ id: 'simnet-workbench-rail-host' });
clickHandler({
  type: 'click',
  target: select,
  defaultPrevented: false,
  composedPath() { return [select, railHost]; }
});
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(emitted.length, 0, 'Workbench Shadow DOM clicks must not feed debug:click back into the rail');
assert.equal(sandbox.SIMNET_WB.clickDebug.recent().length, 0, 'Workbench UI clicks must not pollute native-page click history');

const pageButton = new FakeElement({ tagName: 'BUTTON' });
clickHandler({
  type: 'click',
  target: pageButton,
  defaultPrevented: false,
  composedPath() { return [pageButton]; }
});
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(emitted.length, 1, 'native CRM/page click must still be observed');
assert.equal(emitted[0].type, 'debug:click');
assert.equal(sandbox.SIMNET_WB.clickDebug.recent().length, 1);

console.log('click_debug_workbench_ui_regression_test: PASS');
