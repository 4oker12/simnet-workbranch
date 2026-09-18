'use strict';

(() => {
  const ROOT_ID = 'aiLabUsageMeter';
  const STYLE_ID = 'aiLabUsageMeterStyle';
  let observer = null;
  let timer = 0;
  let rendering = false;

  function create(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function n(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function fmt(value) {
    return Math.round(n(value)).toLocaleString('ru-RU');
  }

  function shortModel(value) {
    return String(value || '')
      .replace(/^openai\//, '')
      .replace(/^qwen\//, '')
      .replace(/^meta-llama\//, '')
      .trim();
  }

  function modelsFrom(state = {}) {
    const byModel = state?.apiCost?.turn?.by_model;
    if (byModel && typeof byModel === 'object' && !Array.isArray(byModel)) {
      const models = Object.entries(byModel)
        .filter(([, usage]) => n(usage?.calls) || n(usage?.total_tokens))
        .sort((a, b) => n(b[1]?.total_tokens) - n(a[1]?.total_tokens))
        .map(([model, usage]) => `${shortModel(model)} · ${fmt(usage?.total_tokens)} ток.`);
      if (models.length) return models;
    }

    return String(state?.lastExperiment?.model || '')
      .split('→')
      .map(shortModel)
      .filter(Boolean)
      .filter((model, index, list) => list.indexOf(model) === index)
      .map(model => model);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ai-usage-meter{margin:0 0 10px;padding:9px 10px;border:1px solid #dce3ec;border-radius:10px;background:#fff;display:grid;gap:7px}
      .ai-usage-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .ai-usage-head strong{font-size:11px;color:#172033}.ai-usage-head span{font:9px/1.35 ui-monospace,monospace;color:#7b8798}
      .ai-usage-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
      .ai-usage-stat{padding:6px 7px;border:1px solid #e7ebf0;border-radius:8px;background:#f8fafc;min-width:0}
      .ai-usage-stat b{display:block;font:800 12px/1.25 ui-monospace,monospace;color:#172033;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ai-usage-stat span{display:block;margin-top:2px;font:8px/1.2 ui-monospace,monospace;color:#7b8798;text-transform:uppercase;letter-spacing:.04em}
      .ai-usage-models{font:9px/1.45 ui-monospace,monospace;color:#475569;white-space:normal;word-break:break-word}
      .ai-usage-models b{color:#172033}
      @media(max-width:900px){.ai-usage-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:560px){.ai-usage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.append(style);
  }

  function stat(label, value) {
    const node = create('div', 'ai-usage-stat');
    node.append(create('b', '', value), create('span', '', label));
    return node;
  }

  async function getState() {
    const response = await chrome.runtime.sendMessage({ type: 'AI_OPERATOR_LAB_GET' });
    if (!response?.success) throw new Error(response?.error || 'AI Lab state unavailable');
    return response.data || {};
  }

  function render(state = {}) {
    const identity = document.getElementById('aiLabIdentity');
    if (!identity) return;
    ensureStyles();

    const turn = state?.apiCost?.turn || {};
    const session = state?.apiCost?.session || {};
    const models = modelsFrom(state);

    const root = create('section', 'ai-usage-meter');
    root.id = ROOT_ID;

    const head = create('div', 'ai-usage-head');
    head.append(
      create('strong', '', 'LLM · токены'),
      create('span', '', `ход ${fmt(turn.calls)} выз. · диалог ${fmt(session.calls)} выз.`)
    );

    const grid = create('div', 'ai-usage-grid');
    grid.append(
      stat('ход · всего', fmt(turn.total_tokens)),
      stat('ход · prompt', fmt(turn.input_tokens)),
      stat('ход · answer', fmt(turn.output_tokens)),
      stat('ход · вызовы', fmt(turn.calls)),
      stat('диалог · всего', fmt(session.total_tokens)),
      stat('диалог · вызовы', fmt(session.calls))
    );

    const modelLine = create('div', 'ai-usage-models');
    modelLine.append(create('b', '', 'Модели этого хода: '));
    modelLine.append(document.createTextNode(models.length ? models.join(' · ') : 'ещё нет вызовов'));

    root.append(head, grid, modelLine);

    rendering = true;
    observer?.disconnect();
    document.getElementById(ROOT_ID)?.remove();
    identity.insertAdjacentElement('beforebegin', root);
    bindObserver();
    rendering = false;
  }

  function schedule() {
    if (rendering) return;
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try { render(await getState()); }
      catch (error) { console.warn('[AI Lab usage] render failed', error); }
    }, 60);
  }

  function bindObserver() {
    const transcript = document.getElementById('aiLabTranscript');
    const events = document.getElementById('aiLabEvents');
    const status = document.getElementById('aiLabStatus');
    if (!transcript && !events && !status) return;
    if (!observer) observer = new MutationObserver(() => schedule());
    observer.disconnect();
    if (transcript) observer.observe(transcript, { childList: true, subtree: true });
    if (events) observer.observe(events, { childList: true, subtree: true });
    if (status) observer.observe(status, { childList: true, characterData: true, subtree: true });
  }

  function boot() {
    bindObserver();
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
