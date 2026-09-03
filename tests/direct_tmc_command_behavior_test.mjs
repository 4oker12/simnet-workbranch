import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(texts = []) {
    this.isConnected = true;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.textNodes = texts.map(value => ({
      nodeValue: value,
      parentElement: { closest() { return null; } },
      parentNode: {
        insertBefore() {},
        normalize() {}
      }
    }));
    this.scrollCount = 0;
  }
  scrollIntoView() { this.scrollCount += 1; }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute(name, value) { this[name] = value; }
  appendChild(node) { this.firstChild ||= node; node.parentNode = this; }
  getBoundingClientRect() { return { width: 80, height: 18 }; }
}

const block = new FakeElement([
  'MAC: C8:3A:35:B2:C3:39',
  'BDCOM OLT P3616-2TE',
  'IP: 172.16.1.17'
]);
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  Element: FakeElement,
  NodeFilter: { SHOW_TEXT: 4 },
  SIMNET_WB: {
    runtime: {},
    tmcParser: {
      findBlocks() { return [block]; },
      parseBlock() {
        return {
          serial: null,
          mac: 'C8:3A:35:B2:C3:39',
          oltName: 'BDCOM OLT P3616-2TE',
          oltIp: '172.16.1.17'
        };
      }
    }
  }
};
sandbox.window = sandbox;
sandbox.window.top = sandbox.window;
sandbox.window.self = sandbox.window;
sandbox.document = {
  documentElement: { appendChild() {} },
  head: { appendChild() {} },
  getElementById() { return null; },
  createElement(tag) { return tag === 'span' ? new FakeElement() : new FakeElement(); },
  createTreeWalker(root) {
    let index = -1;
    return {
      currentNode: null,
      nextNode() {
        index += 1;
        this.currentNode = root.textNodes[index] || null;
        return Boolean(this.currentNode);
      }
    };
  },
  querySelectorAll() { return []; },
  addEventListener() {}
};

const source = fs.readFileSync(new URL('../src/browser/actions/focus-userside-tmc.js', import.meta.url), 'utf8');
vm.runInNewContext(source, sandbox, { filename: 'focus-userside-tmc.js' });
const action = sandbox.SIMNET_WB.browser.actions.usersideTmc;

const focused = await action.execute({ mode: 'focus', commandId: 'cmd-focus', caseId: 'login:abon1' });
assert.equal(focused.ok, true);
assert.equal(focused.mode, 'focus');
assert.ok(focused.marked >= 2, 'known MAC/OLT values are point-highlighted');
assert.equal(block.scrollCount, 1);
assert.equal(block.classList.contains('simnet-wb-direct-tmc-focus'), true);

const repeated = await action.execute({ mode: 'focus', commandId: 'cmd-focus', caseId: 'login:abon1' });
assert.equal(repeated.consumed, true, 'the same direct command is one-shot');
assert.equal(block.scrollCount, 1, 'repeated command does not focus again');

const history = await action.execute({ mode: 'scroll', commandId: 'cmd-history', caseId: 'login:abon1' });
assert.equal(history.ok, true);
assert.equal(history.mode, 'scroll');
assert.equal(block.scrollCount, 2);
assert.equal(block.classList.contains('simnet-wb-direct-tmc-focus'), false, 'history clears teaching focus and only scrolls');

console.log('direct_tmc_command_behavior_test: PASS');
