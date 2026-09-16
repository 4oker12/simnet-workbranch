'use strict';

(() => {
  const STORE_KEY = 'simnet_ai_operator_kb_gap_queue_v1';
  const statusNode = document.getElementById('aiLabStatus');
  if (!statusNode || !globalThis.chrome?.runtime?.sendMessage || !globalThis.chrome?.storage?.local) return;

  let currentState = null;
  let refreshScheduled = false;

  function text(value, max = 1200) {
    const out = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
  }
  function block(value, max = 4000) {
    const out = String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
  }
  function list(value, maxItems = 12, maxChars = 600) {
    return (Array.isArray(value) ? value : []).map(item => text(item, maxChars)).filter(Boolean).slice(0, maxItems);
  }
  function create(tag, className = '', value = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null && value !== '') node.textContent = String(value);
    return node;
  }
  function stamp(value = Date.now()) {
    const d = new Date(value); const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }
  function download(filename, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.style.display = 'none'; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function runtimeGet() {
    const response = await chrome.runtime.sendMessage({ type: 'AI_OPERATOR_LAB_GET' });
    if (!response?.success) throw new Error(response?.error || 'AI Lab state unavailable');
    return response.data && typeof response.data === 'object' ? response.data : {};
  }
  async function readQueue() {
    const raw = (await chrome.storage.local.get(STORE_KEY))?.[STORE_KEY];
    return Array.isArray(raw) ? raw : [];
  }
  async function writeQueue(queue) {
    await chrome.storage.local.set({ [STORE_KEY]: Array.isArray(queue) ? queue.slice(-500) : [] });
  }
  function activeVariant(experiment = {}) {
    const variants = Array.isArray(experiment.variants) ? experiment.variants : [];
    return variants.find(item => item.label === experiment.activeVariant) || variants[0] || null;
  }
  function latestCustomerMessage(state = {}) {
    return [...(Array.isArray(state.messages) ? state.messages : [])].reverse().find(item => item?.role === 'customer') || null;
  }
  function knowledgeContext(state = {}) {
    const experiment = state.lastExperiment || {};
    const analysis = experiment.analysis || {};
    const probe = analysis.probe || {};
    const knowledge = analysis.knowledge || {};
    const variant = activeVariant(experiment) || {};
    const latestCustomer = latestCustomerMessage(state);
    return {
      labId: text(state.id, 120),
      question: block(latestCustomer?.text, 1800),
      whatUserWants: block(probe.whatUserWants, 1200),
      latestMessageMeans: block(probe.latestMessageMeans, 1200),
      underlyingGoal: block(probe.underlyingGoal, 1200),
      knowledgeNeed: text(probe.knowledgeNeed, 120),
      knowledgeReason: block(probe.knowledgeReason, 1200),
      knowledgeGaps: list(knowledge.knowledgeGaps),
      mustNotAssume: list(knowledge.mustNotAssume),
      usedArticles: (Array.isArray(knowledge.usedArticles) ? knowledge.usedArticles : []).map(item => ({
        id: text(item?.id || item, 180),
        title: text(item?.title, 300)
      })).filter(item => item.id || item.title),
      subscriberDataNeeded: (Array.isArray(variant.subscriberDataNeeded) ? variant.subscriberDataNeeded : []).map(item => ({
        system: text(item?.system, 80), field: text(item?.field, 180), why: text(item?.why, 500)
      })),
      verificationNeeded: list(variant.verificationNeeded),
      reply: block(variant.reply, 2600),
      toolTrace: (Array.isArray(variant.toolTrace) ? variant.toolTrace : []).slice(-12).map(item => ({
        tool: text(item?.tool, 120), ok: Boolean(item?.ok), code: text(item?.code, 120), source: text(item?.source, 180)
      }))
    };
  }

  const root = create('section', 'ai-kb-curator');
  root.id = 'aiKbCurator';
  const head = create('div', 'ai-kb-curator-head');
  const titleWrap = create('div');
  titleWrap.append(create('strong', '', 'Пополнение базы знаний'), create('span', '', 'Фиксируй недостающую информацию прямо во время теста.'));
  const countBadge = create('span', 'ai-kb-curator-count', '0 записей');
  head.append(titleWrap, countBadge);

  const gapBox = create('div', 'ai-kb-curator-gap');
  const gapLabel = create('b', '', 'Текущий пробел KB');
  const gapText = create('div', 'ai-kb-curator-gap-text', 'Пока не выявлен. Запись всё равно можно добавить вручную.');
  gapBox.append(gapLabel, gapText);

  const knowledgeInput = create('textarea', 'ai-kb-curator-input');
  knowledgeInput.rows = 4;
  knowledgeInput.placeholder = 'Что должно знать AI? Пиши факт/правило так, как ты бы объяснил новому оператору. Например: «Тариф Lite 100 — до 100 Мбит/с. Если клиент спрашивает про скорость, сначала имеется в виду тарифная скорость.»';

  const sourceInput = create('input', 'ai-kb-curator-source');
  sourceInput.type = 'text';
  sourceInput.placeholder = 'Источник/комментарий (необязательно): Billing, инструкция, проверено оператором…';

  const actions = create('div', 'ai-kb-curator-actions');
  const saveButton = create('button', '', 'Сохранить в очередь'); saveButton.type = 'button';
  const exportButton = create('button', 'secondary', 'Экспорт JSON'); exportButton.type = 'button';
  const stateText = create('span', 'ai-kb-curator-state', '');
  actions.append(saveButton, exportButton, stateText);

  root.append(head, gapBox, knowledgeInput, sourceInput, actions);
  statusNode.insertAdjacentElement('afterend', root);

  async function renderQueueCount() {
    const queue = await readQueue();
    countBadge.textContent = `${queue.length} ${queue.length === 1 ? 'запись' : queue.length >= 2 && queue.length <= 4 ? 'записи' : 'записей'}`;
    exportButton.disabled = queue.length === 0;
  }
  function renderContext(state = {}) {
    currentState = state;
    const ctx = knowledgeContext(state);
    const lines = [];
    if (ctx.knowledgeGaps.length) lines.push(...ctx.knowledgeGaps);
    if (!lines.length && ctx.knowledgeReason) lines.push(ctx.knowledgeReason);
    gapText.replaceChildren();
    if (!lines.length) {
      gapText.textContent = 'Пока не выявлен. Запись всё равно можно добавить вручную.';
      root.classList.remove('has-gap');
      return;
    }
    root.classList.add('has-gap');
    for (const value of lines) gapText.append(create('div', '', value));
  }
  async function refreshContext() {
    try { renderContext(await runtimeGet()); }
    catch (error) { stateText.textContent = `Контекст: ${text(error?.message || error, 300)}`; }
  }
  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      void refreshContext();
    });
  }

  saveButton.addEventListener('click', async () => {
    const proposedKnowledge = block(knowledgeInput.value, 6000);
    if (!proposedKnowledge) {
      stateText.textContent = 'Сначала впиши информацию.';
      knowledgeInput.focus();
      return;
    }
    saveButton.disabled = true;
    try {
      const state = currentState || await runtimeGet();
      const ctx = knowledgeContext(state);
      const queue = await readQueue();
      const entry = {
        id: `kb-gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        status: 'new',
        proposedKnowledge,
        operatorSource: block(sourceInput.value, 1200),
        ...ctx
      };
      queue.push(entry);
      await writeQueue(queue);
      knowledgeInput.value = '';
      sourceInput.value = '';
      stateText.textContent = 'Сохранено. Можно продолжать тест.';
      await renderQueueCount();
    } catch (error) {
      stateText.textContent = `Ошибка: ${text(error?.message || error, 300)}`;
    } finally {
      saveButton.disabled = false;
    }
  });

  exportButton.addEventListener('click', async () => {
    try {
      const queue = await readQueue();
      if (!queue.length) return;
      download(`simnet-ai-kb-gap-queue-${stamp()}.json`, `${JSON.stringify({
        schema: 'simnet-ai-kb-gap-queue/v1',
        exportedAt: new Date().toISOString(),
        count: queue.length,
        entries: queue
      }, null, 2)}\n`);
      stateText.textContent = `Выгружено записей: ${queue.length}.`;
    } catch (error) {
      stateText.textContent = `Экспорт: ${text(error?.message || error, 300)}`;
    }
  });

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(statusNode, { childList: true, characterData: true, subtree: true });
  window.addEventListener('unload', () => observer.disconnect(), { once: true });

  void renderQueueCount();
  void refreshContext();
})();
