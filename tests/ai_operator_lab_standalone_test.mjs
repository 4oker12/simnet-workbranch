import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAB_UI_MODULES, mountAiOperatorLab } from '../src/ui/ai-operator-lab-host.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function hostFor(mode) {
  const panel = {
    open: false, attributes: { 'data-accordion-group': 'settings' },
    removeAttribute(name) { delete this.attributes[name]; }
  };
  const fragment = {
    querySelector(selector) {
      return selector === '[data-accordion-panel="lab"]' ? panel : { id: 'aiLabInput' };
    }
  };
  return {
    panel, fragment, dataset: { aiLabHost: mode }, attributes: { 'aria-busy': 'true' },
    ownerDocument: { createElement: () => ({ content: fragment, innerHTML: '' }) },
    replaceChildren(content) { this.mountedView = content; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

test('both extension pages mount one shared view and the existing UI controllers', () => {
  const settings = read('src/ui/settings.html');
  const standalone = read('ai-operator-lab.html');
  const view = read('src/ui/ai-operator-lab-view.html');
  const manifest = JSON.parse(read('manifest.json'));
  assert.match(settings, /data-ai-lab-host="embedded"/);
  assert.match(standalone, /data-ai-lab-host="standalone"/);
  for (const page of [settings, standalone]) {
    assert.match(page, /type="module" src="(?:src\/ui\/)?ai-operator-lab-host\.js"/);
    assert.doesNotMatch(page, /id="(?:aiLabInput|aiReplayFile|aiBatchSeed)"/);
  }
  for (const id of ['aiLabInput', 'aiLabEvents', 'aiLabReset', 'aiLabDownloadJson', 'aiLabDownloadTxt', 'aiBatchSeed', 'aiReplayFile', 'aiReplayExportCsv']) {
    assert.equal((view.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must have one markup authority`);
  }
  assert.deepEqual(LAB_UI_MODULES, [
    './ai-operator-lab.js', './ai-operator-behavior-v2.js', './ai-operator-lab-trace.js',
    './ai-operator-batch.js', './ai-operator-replay.js', './ai-operator-scenario-replay.js', './ai-operator-lab-workspace.js', './settings-accordion.js'
  ]);
  for (const name of LAB_UI_MODULES) assert.ok(read(`src/ui/${name.slice(2)}`).length);
  const settingsStyles = [...settings.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
  const standaloneStyles = [...standalone.matchAll(/rel="stylesheet" href="src\/ui\/([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(standaloneStyles, settingsStyles);
  const styles = read('src/ui/ai-operator-lab.css');
  assert.match(styles, /\.ai-lab-standalone \.ai-lab-modes\{display:grid!important\}/);
  assert.match(styles, /\.ai-lab-standalone \.ai-lab-experiment-actions\{display:flex!important\}/);
  assert.match(styles, /\.ai-lab-diagnostics:not\(\[hidden\]\)/, 'display controls must still be able to hide diagnostics');
  assert.equal(manifest.background.service_worker, 'src/background-entry.js');
  assert.equal(manifest.background.type, 'module');
  assert.match(read('src/background-entry.js'), /features\/ai-operator\/lab-background\.js/);
  assert.match(read('src/ui/popup.html'), /href="\.\.\/\.\.\/ai-operator-lab\.html"[^>]*target="_blank"/);
});

test('bootstrap is idempotent, loads controllers after the view, and keeps standalone visible', async () => {
  for (const mode of ['embedded', 'standalone']) {
    const host = hostFor(mode);
    const loaded = [];
    let fetches = 0;
    const dependencies = {
      fetchView: async url => {
        fetches += 1;
        assert.equal(url.pathname.split('/').at(-1), 'ai-operator-lab-view.html');
        return { ok: true, text: async () => '<section>shared view</section>' };
      },
      loadModule: async name => {
        assert.equal(host.mountedView, host.fragment, 'controllers must see the complete view');
        assert.equal(host.dataset.aiLabReady, undefined, 'ready must wait for every controller');
        loaded.push(name);
      }
    };
    const first = mountAiOperatorLab(host, dependencies);
    assert.equal(mountAiOperatorLab(host, dependencies), first, 'concurrent bootstrap must not double-bind controls');
    assert.equal(await first, host);
    assert.equal(fetches, 1);
    assert.deepEqual(loaded, LAB_UI_MODULES);
    assert.equal(host.dataset.aiLabReady, 'true');
    assert.equal(host.attributes['aria-busy'], 'false');
    assert.equal(host.panel.attributes['data-accordion-group'], mode === 'embedded' ? 'settings' : undefined);
    assert.equal(host.panel.open, mode === 'standalone');
  }
});

test('failed/malformed view never starts UI controllers or constructs fallback facts', async () => {
  let loaded = 0;
  const dependencies = { loadModule: async () => { loaded += 1; } };
  await assert.rejects(mountAiOperatorLab(hostFor('standalone'), {
    ...dependencies, fetchView: async () => ({ ok: false, status: 404 })
  }), /view недоступен \(404\)/);
  const host = hostFor('standalone');
  host.fragment.querySelector = () => null;
  await assert.rejects(mountAiOperatorLab(host, {
    ...dependencies, fetchView: async () => ({ ok: true, text: async () => 'invalid' })
  }), /неполная разметка/);
  assert.equal(loaded, 0);
  assert.equal(host.dataset.aiLabReady, undefined);
});

test('shared service-worker Lab keeps four-turn dialogue; absent CRM context stays unconfirmed', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const listeners = [];
  const storage = { simnet_workbench_ai_runtime_v1: { groqApiKey: 'test-only-placeholder', chatModel: 'qwen/qwen3.8-27b' } };
  const payloads = [];
  // Chrome storage serializes JSON (including toJSON), not structuredClone.
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  globalThis.chrome = {
    runtime: { onMessage: { addListener: listener => listeners.push(listener) } },
    tabs: { query: async () => [], sendMessage: async () => { throw new Error('No CRM tab'); } },
    scripting: { executeScript: async () => { throw new Error('No CRM page may be injected in this test'); } },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, clone(storage[key])])),
        set: async patch => Object.assign(storage, clone(patch)),
        remove: async key => { delete storage[key]; }
      }
    }
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    let payload = {};
    try { payload = JSON.parse(body.messages.at(-1).content); } catch {}
    payloads.push(payload);
    const content = {
      language: 'ru', what_user_wants: payload.latest_customer_message || 'Продолжить разговор',
      latest_message_means: payload.latest_customer_message || '', underlying_goal: 'Возобновить подключение',
      facts_said_by_user: [], facts_said_by_operator: [], unresolved_requests: [], ambiguities: [],
      knowledge_need: 'none', live_data_need: 'none', confidence: 0.95,
      reply: 'Тестовый ответ без утверждений о данных Billing.',
      subscriber_data_needed: [], clarification_questions: [], verification_needed: [], next_step_offered: ''
    };
    return new Response(JSON.stringify({
      model: body.model, choices: [{ message: { content: body.model.includes('prompt-guard') ? 'SAFE' : JSON.stringify(content) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
    }), { status: 200 });
  };
  const dispatch = message => new Promise((resolve, reject) => {
    for (const listener of listeners) if (listener(message, {}, resolve)) return;
    reject(new Error(`Unhandled ${message.type}`));
  });
  try {
    const { AI_OPERATOR_LAB_KEY } = await import('../src/features/ai-operator/lab-background.js');
    const { executeOperatorTool } = await import('../src/features/ai-operator/live-tool-runtime.js');
    const { resolveFacts } = await import('../src/features/ai-operator/canonical-fact-resolver.js');
    const { bootstrapRealSubscriber } = await import('../src/features/ai-operator/scenario-replay-background.js');
    await dispatch({ type: 'AI_OPERATOR_LAB_CONFIG', payload: { knowledgeMode: 'off' } });
    const turns = [
      'У меня старый договор, хочу подключиться снова.', 'Там вроде минус какой-то оставался.',
      'А если открыть новый?', 'Сколько тогда платить?'
    ];
    let state;
    for (const text of turns) {
      const result = await dispatch({ type: 'AI_OPERATOR_LAB_SEND', payload: { text } });
      assert.equal(result.success, true, result.error);
      state = result.data;
      assert.equal(state.lastExperiment.variants[0].degraded, false, 'fixture must exercise the full semantic path');
    }
    assert.deepEqual(state.messages.filter(message => message.role === 'customer').map(message => message.text), turns);
    assert.equal(state.messages.length, 8);
    assert.ok(payloads.some(payload => (payload.dialogue || []).filter(message => message.role === 'customer').length === 4));
    assert.equal(state.toolState.confirmedSubscriber, null);
    assert.equal(state.toolState.confirmedCaseId, '');
    const reopened = await dispatch({ type: 'AI_OPERATOR_LAB_GET' });
    assert.equal(reopened.data.id, state.id);
    assert.deepEqual(reopened.data.messages, storage[AI_OPERATOR_LAB_KEY].messages);

    const lookup = await executeOperatorTool({ tool: 'customer.lookup', toolArgs: { contract: '99000001' } });
    assert.equal(lookup.ok, false);
    assert.equal(lookup.code, 'BILLING_TAB_REQUIRED');
    assert.equal(lookup.statePatch?.confirmedSubscriber, undefined);
    await assert.rejects(bootstrapRealSubscriber('99000001'), /BILLING_TAB_REQUIRED/);
    assert.equal(storage.simnet_ai_operator_billing_snapshots_v1, undefined);
    const facts = await resolveFacts({
      context: state.toolState,
      facts: ['subscriber.finance.balance.account', 'subscriber.finance.temporaryPayment'],
      execute: executeOperatorTool
    });
    assert.ok(facts.facts.length >= 2);
    for (const fact of facts.facts) {
      assert.equal(fact.status, 'unknown');
      assert.equal(fact.value, null, 'missing source must not turn into zero/false');
    }

    const reset = await dispatch({ type: 'AI_OPERATOR_LAB_RESET' });
    assert.equal(reset.success, true);
    assert.deepEqual(reset.data.messages, []);
    assert.equal(reset.data.toolState.confirmedSubscriber, null);
    assert.equal(reset.data.knowledgeMode, 'off');
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
