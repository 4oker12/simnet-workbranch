import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// DOM fixture models node relocation: document lookups cannot see detached nodes.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.className = ''; this.attrs = {}; this.textContent = ''; this.classList = { contains: name => this.className.split(' ').includes(name), add: name => { this.className += ` ${name}`; }, toggle: (name, active) => { this.className = this.className.split(' ').filter(x => x !== name).concat(active ? [name] : []).join(' '); } }; }
  append(...nodes) { for (const node of nodes) { if (!(node instanceof Element)) throw Error('Expected DOM node'); node.remove(); node.parent = this; this.children.push(node); } }
  prepend(...nodes) { this.append(...nodes); this.children = [...nodes, ...this.children.filter(x => !nodes.includes(x))]; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
  after(node) { const parent = this.parent, index = parent.children.indexOf(this); node.remove(); node.parent = parent; parent.children.splice(index + 1, 0, node); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  matches(selector) { if (selector.startsWith('.')) return this.classList.contains(selector.slice(1)); if (selector.startsWith('[')) { const [, key, value] = selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/); return value === undefined ? key in this.attrs : this.attrs[key] === value; } return this.tag === selector; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function fixture(standalone) {
  const root = new Element('html'), head = new Element('head'), body = new Element('body'); root.append(head, body); if (standalone) body.className = 'ai-lab-standalone';
  const node = (parent, tag, id = '', cls = '') => { const e = new Element(tag); e.id = id; e.className = cls; parent.append(e); return e; };
  const panel = node(body, 'details', '', 'settings-panel-lab'), manual = node(panel, 'details'); manual.attrs['data-accordion-panel'] = 'manual';
  const content = node(manual, 'div', '', 'lab-section-body');
  const actions = node(content, 'div', '', 'ai-lab-head'); for (const id of ['aiLabDownloadTxt', 'aiLabDownloadJson', 'aiLabReset']) node(actions, 'button', id);
  node(content, 'section', 'aiLabExperiment'); node(content, 'div', 'aiLabIdentity'); node(content, 'div', 'aiLabTranscript');
  const bank = node(content, 'section', '', 'ai-lab-question-bank'); node(bank, 'div', '', 'ai-lab-question-tabs');
  const compose = node(content, 'div', '', 'ai-lab-compose'); node(compose, 'textarea', 'aiLabInput'); const send = node(compose, 'button', 'aiLabSend'); node(content, 'div', 'aiLabStatus');
  const log = node(content, 'details', '', 'ai-lab-log'); node(log, 'div', 'aiLabEvents'); node(content, 'details', '', 'ai-lab-diagnostics');
  return { root, send, document: { head, body, createElement: tag => new Element(tag), querySelector: selector => root.querySelector(selector), getElementById: id => { const walk = e => e.id === id ? e : e.children.map(walk).find(Boolean); return walk(root) || null; } } };
}
test('workspace mounts both hosts without losing controls when their parents are detached', () => {
  const source = fs.readFileSync(new URL('../src/ui/ai-operator-lab-workspace.js', import.meta.url), 'utf8');
  for (const standalone of [true, false]) {
    const { document, send } = fixture(standalone);
    const context = vm.createContext({ document, chrome: { runtime: { getURL: path => `chrome-extension://fixture/${path}` } } });
    vm.runInContext(source, context);
    assert.equal(document.getElementById('aiLabSend'), send);
    assert.equal(send.textContent, 'Отправить');
    assert.ok(document.getElementById('aiLabWorkspace'));
    assert.ok(document.getElementById('aiLabEvents'));
    const tabs = document.querySelector('.ai-workspace-tabs').querySelectorAll('button');
    tabs[1].onclick(); assert.equal(document.querySelector('.ai-workspace-inspector').dataset.view, 'calls');
    vm.runInContext(source, context); assert.equal(document.querySelectorAll?.('.ai-workspace')?.length ?? document.body.querySelectorAll('.ai-workspace').length, 1);
  }
});
