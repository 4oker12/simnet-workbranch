'use strict';

(() => {
  const TRACE_ID = 'aiLabLinearTrace';
  const STYLE_ID = 'aiLabLinearTraceStyle';
  const TOOL_HINT_RE = /\b(customer\.lookup|customer\.confirm|customer\.snapshot|billing\.balance|billing\.tariff|billing\.payments|userside\.snapshot|network\.session|pon\.onu|pon\.signal)\b/i;
  const IMPORTANT_JSON_KEYS = new Set(['field', 'why', 'tool', 'ok', 'code', 'source', 'data', 'requestedBy', 'system']);
  const FACT_KEYS = new Set([
    'billingId', 'contract', 'login', 'address', 'fullName', 'connectionFamily',
    'accountBalance', 'balanceAfterTariff', 'balanceWithoutTemporary', 'temporaryPayment', 'price', 'totalDue',
    'accessState', 'serviceState', 'currentTariff', 'tariffDisplay', 'nextTariff',
    'subscriberIp', 'ip', 'subscriberMac', 'mac', 'bras', 'status', 'isOnline', 'isActive', 'vlan',
    'onuSerial', 'onuMac', 'oltName', 'oltIp', 'port', 'foundOnOlt', 'rx', 'tx', 'oltRx', 'onuLanLinkState'
  ]);

  let eventsNode = null;
  let observer = null;
  let timer = 0;
  let rendering = false;

  function create(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function short(value, max = 360) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function asArray(value) {
    return Array.isArray(value) ? value.filter(item => item != null && String(item).trim() !== '') : [];
  }

  function activeVariant(experiment = {}) {
    const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
    return variants.find(item => item?.label === experiment?.activeVariant) || variants[0] || null;
  }

  function toolHint(trace = {}) {
    const requested = `${trace?.requestedBy?.field || ''} ${trace?.requestedBy?.why || ''}`;
    return requested.match(TOOL_HINT_RE)?.[1]?.toLowerCase() || '';
  }

  function toolMismatch(trace = {}) {
    const expected = toolHint(trace);
    const actual = String(trace?.tool || '').toLowerCase();
    return expected && actual && expected !== actual ? { expected, actual } : null;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ai-trace-root{margin:0 0 10px;padding:10px;border:1px solid #d9e1eb;border-radius:10px;background:#fff}
      .ai-trace-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      .ai-trace-head strong{font-size:11px;color:#172033}.ai-trace-head span{font:9px/1.3 ui-monospace,monospace;color:#7b8798}
      .ai-trace-list{position:relative;display:grid;gap:0;padding-left:2px}
      .ai-trace-step{position:relative;display:grid;grid-template-columns:26px 118px minmax(0,1fr);gap:8px;padding:8px 4px 8px 0;border-top:1px solid #edf1f5}
      .ai-trace-step:first-child{border-top:0}.ai-trace-step:not(:last-child)::after{content:'';position:absolute;left:12px;top:32px;bottom:-8px;width:2px;background:#d9e1eb}
      .ai-trace-index{position:relative;z-index:1;display:grid;place-items:center;width:24px;height:24px;border-radius:999px;background:#eef2f7;color:#475569;font:800 9px ui-monospace,monospace}
      .ai-trace-label{padding-top:4px;color:#64748b;font:800 9px/1.35 ui-monospace,monospace;letter-spacing:.04em}
      .ai-trace-body{min-width:0;color:#243044;font-size:10px;line-height:1.5}.ai-trace-body b{color:#172033}.ai-trace-body .muted{color:#7b8798}
      .ai-trace-step.intent .ai-trace-index{background:#ede9fe;color:#6d28d9}.ai-trace-step.need .ai-trace-index{background:#e0f2fe;color:#0369a1}
      .ai-trace-step.tool .ai-trace-index{background:#dbeafe;color:#1d4ed8}.ai-trace-step.fact .ai-trace-index{background:#dcfce7;color:#166534}
      .ai-trace-step.verify .ai-trace-index{background:#fef3c7;color:#92400e}.ai-trace-step.answer .ai-trace-index{background:#fbe7ef;color:#8c1646}
      .ai-trace-line{margin:1px 0}.ai-trace-chip{display:inline-block;margin:2px 4px 2px 0;padding:2px 5px;border-radius:6px;background:#f2f5f8;color:#475569;font:700 9px ui-monospace,monospace}
      .ai-trace-chip.ok{background:#ecfdf3;color:#067647}.ai-trace-chip.bad{background:#fff1f1;color:#b42318}.ai-trace-chip.warn{background:#fff7e6;color:#9a6700}
      .ai-trace-mismatch{margin-top:5px;padding:6px 8px;border:1px solid #f7b4b4;border-radius:7px;background:#fff5f5;color:#b42318;font:800 9px/1.4 ui-monospace,monospace}
      .ai-trace-tools{display:grid;gap:5px}.ai-trace-tool{padding:6px 8px;border:1px solid #dbe4ef;border-radius:8px;background:#f8fbff}
      .ai-trace-tool-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.ai-trace-tool-head strong{font:800 10px ui-monospace,monospace}
      .ai-trace-raw{margin-top:5px}.ai-trace-raw>summary{cursor:pointer;color:#64748b;font:700 9px ui-monospace,monospace}
      .ai-trace-json{margin:5px 0 0;padding:7px 8px;max-height:280px;overflow:auto;border:1px solid #e6ebf1;border-radius:7px;background:#fbfcfd;font:9px/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
      .ai-trace-json-line{display:block}.ai-trace-json-line.key-intent{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#fff4db;color:#8a4b00;font-weight:800}
      .ai-trace-json-line.key-tool{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#eaf2ff;color:#174ea6;font-weight:800}
      .ai-trace-json-line.key-status{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#ecfdf3;color:#067647;font-weight:800}
      .ai-trace-json-line.key-source{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#f3e8ff;color:#6b21a8;font-weight:800}
      .ai-trace-json-line.key-data{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#f0f9ff;color:#075985;font-weight:800}
      .ai-trace-history-label{margin:10px 0 5px;color:#8a95a5;font:800 8px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
      @media(max-width:760px){.ai-trace-step{grid-template-columns:26px 88px minmax(0,1fr)}}
    `;
    document.head.append(style);
  }

  function jsonBlock(value) {
    const details = create('details', 'ai-trace-raw');
    details.append(create('summary', '', 'RAW JSON'));
    const pre = create('pre', 'ai-trace-json');
    let text = '';
    try { text = JSON.stringify(value ?? null, null, 2); } catch { text = String(value ?? ''); }
    for (const line of text.split('\n')) {
      const span = create('span', 'ai-trace-json-line', line);
      const key = line.match(/^\s*"([^"]+)"\s*:/)?.[1] || '';
      if (IMPORTANT_JSON_KEYS.has(key)) {
        if (key === 'field' || key === 'why' || key === 'requestedBy' || key === 'system') span.classList.add('key-intent');
        else if (key === 'tool') span.classList.add('key-tool');
        else if (key === 'ok' || key === 'code') span.classList.add('key-status');
        else if (key === 'source') span.classList.add('key-source');
        else if (key === 'data') span.classList.add('key-data');
      }
      pre.append(span, document.createTextNode('\n'));
    }
    details.append(pre);
    return details;
  }

  function step(index, label, body, tone = '') {
    const row = create('section', `ai-trace-step ${tone}`.trim());
    row.append(create('div', 'ai-trace-index', index), create('div', 'ai-trace-label', label));
    const content = create('div', 'ai-trace-body');
    if (typeof body === 'string') content.textContent = body;
    else if (body) content.append(body);
    row.append(content);
    return row;
  }

  function lines(values = []) {
    const wrap = create('div');
    for (const value of values.filter(Boolean)) wrap.append(create('div', 'ai-trace-line', value));
    return wrap;
  }

  function contextLines(state = {}, probe = {}) {
    const subscriber = state?.toolState?.confirmedSubscriber || {};
    const result = [];
    if (subscriber.contract) result.push(`Договор: ${subscriber.contract}`);
    if (subscriber.login) result.push(`Login: ${subscriber.login}`);
    if (subscriber.address) result.push(`Адрес: ${subscriber.address}`);
    if (subscriber.connectionFamily) result.push(`Технология: ${subscriber.connectionFamily}`);
    if (!result.length && state?.toolState?.confirmedCaseId) result.push(`Активный subscriber case: ${state.toolState.confirmedCaseId}`);
    if (probe.refersTo) result.push(`Связь с контекстом: ${probe.refersTo}`);
    return result;
  }

  function needsLines(variant = {}) {
    return asArray(variant?.subscriberDataNeeded).map(item => {
      if (typeof item === 'string') return item;
      const system = short(item?.system || '', 60);
      const field = short(item?.field || '', 140);
      const why = short(item?.why || '', 220);
      return `${system ? `${system} → ` : ''}${field || 'данные'}${why ? ` · ${why}` : ''}`;
    });
  }

  function planNode(toolTrace = []) {
    const wrap = create('div');
    const seen = new Set();
    for (const trace of toolTrace) {
      const requestedField = short(trace?.requestedBy?.field || '', 160);
      const why = short(trace?.requestedBy?.why || '', 220);
      const tool = String(trace?.tool || '—');
      const key = `${requestedField}|${why}|${tool}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = create('div', 'ai-trace-line');
      row.append(create('span', 'ai-trace-chip', requestedField || 'live-факт'));
      row.append(document.createTextNode(' → '));
      row.append(create('span', 'ai-trace-chip', tool));
      if (why) row.append(document.createTextNode(` · ${why}`));
      wrap.append(row);
      const mismatch = toolMismatch(trace);
      if (mismatch) wrap.append(create('div', 'ai-trace-mismatch', `НЕСООТВЕТСТВИЕ: запросил ${mismatch.expected}, но вызван ${mismatch.actual}`));
    }
    return wrap;
  }

  function toolsNode(toolTrace = []) {
    const wrap = create('div', 'ai-trace-tools');
    for (const trace of toolTrace) {
      const card = create('div', 'ai-trace-tool');
      const head = create('div', 'ai-trace-tool-head');
      head.append(create('strong', '', trace?.tool || '—'));
      head.append(create('span', `ai-trace-chip ${trace?.ok ? 'ok' : 'bad'}`, trace?.ok ? 'OK ✓' : `ERROR ${trace?.code || ''}`.trim()));
      if (trace?.source) head.append(create('span', 'ai-trace-chip', trace.source));
      card.append(head);
      if (trace?.requestedBy?.field) card.append(create('div', 'ai-trace-line', `Нужно: ${trace.requestedBy.field}`));
      if (trace?.requestedBy?.why) card.append(create('div', 'ai-trace-line muted', `Зачем: ${trace.requestedBy.why}`));
      const mismatch = toolMismatch(trace);
      if (mismatch) card.append(create('div', 'ai-trace-mismatch', `ОЖИДАЛСЯ ${mismatch.expected} → ФАКТИЧЕСКИ ${mismatch.actual}`));
      card.append(jsonBlock(trace));
      wrap.append(card);
    }
    return wrap;
  }

  function collectFacts(value, prefix = '', depth = 0, out = []) {
    if (depth > 4 || out.length >= 18 || value == null) return out;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 4); i += 1) collectFacts(value[i], `${prefix}[${i}]`, depth + 1, out);
      return out;
    }
    if (typeof value !== 'object') return out;
    for (const [key, child] of Object.entries(value)) {
      if (out.length >= 18) break;
      const path = prefix ? `${prefix}.${key}` : key;
      if (FACT_KEYS.has(key) && child != null && typeof child !== 'object' && String(child).trim() !== '') {
        out.push(`${key}: ${short(child, 140)}`);
      }
      if (child && typeof child === 'object') collectFacts(child, path, depth + 1, out);
    }
    return out;
  }

  function factsNode(toolTrace = []) {
    const wrap = create('div');
    let count = 0;
    for (const trace of toolTrace.filter(item => item?.ok)) {
      const facts = [...new Set(collectFacts(trace?.data || {}))].slice(0, 10);
      if (!facts.length) continue;
      count += facts.length;
      const title = create('div', 'ai-trace-line');
      title.append(create('b', '', `${trace.tool}: `), document.createTextNode(facts.join(' · ')));
      wrap.append(title);
    }
    if (!count) wrap.append(create('div', 'ai-trace-line muted', 'Tool отработал, но компактные ключевые поля для сводки не выделены — смотри RAW JSON выше.'));
    return wrap;
  }

  function verifyNode(variant = {}, toolTrace = []) {
    const wrap = create('div');
    const warnings = [];
    for (const trace of toolTrace) {
      const mismatch = toolMismatch(trace);
      if (mismatch) warnings.push(`План/tool расходятся: нужно ${mismatch.expected}, вызван ${mismatch.actual}.`);
      if (!trace?.ok) warnings.push(`${trace?.tool || 'tool'} не дал подтверждённых данных: ${trace?.code || 'unknown'}.`);
    }
    warnings.push(...asArray(variant?.verificationNeeded).map(item => String(item)));
    warnings.push(...asArray(variant?.unresolvedRequests).map(item => `Не закрыто: ${item}`));
    if (!warnings.length) {
      wrap.append(create('span', 'ai-trace-chip ok', 'Данных достаточно для текущего ответа'));
      return wrap;
    }
    for (const warning of [...new Set(warnings)]) wrap.append(create('div', 'ai-trace-line', `• ${warning}`));
    return wrap;
  }

  function conclusionNode(variant = {}, toolTrace = []) {
    const wrap = create('div');
    const okTools = toolTrace.filter(item => item?.ok).length;
    const failedTools = toolTrace.length - okTools;
    const unresolved = asArray(variant?.unresolvedRequests).length + asArray(variant?.verificationNeeded).length;
    if (variant?.degraded) {
      wrap.append(create('span', 'ai-trace-chip bad', 'DEGRADED'));
      if (variant?.degradationReason) wrap.append(document.createTextNode(` ${short(variant.degradationReason, 360)}`));
    } else if (failedTools || unresolved) {
      wrap.append(create('span', 'ai-trace-chip warn', 'Частичный вывод'));
      wrap.append(document.createTextNode(` подтверждено tools: ${okTools}/${toolTrace.length}; остаются пробелы: ${unresolved + failedTools}`));
    } else {
      wrap.append(create('span', 'ai-trace-chip ok', toolTrace.length ? `Подтверждено tools: ${okTools}/${toolTrace.length}` : 'Live-проверки не требовались'));
    }
    const next = short(variant?.nextStepOffered || '', 260);
    if (next) wrap.append(create('div', 'ai-trace-line', `Следующий шаг: ${next}`));
    return wrap;
  }

  function renderTrace(state = {}) {
    if (!eventsNode) return;
    ensureStyles();
    const experiment = state?.lastExperiment;
    if (!experiment) return;

    const variant = activeVariant(experiment) || {};
    const probe = experiment?.analysis?.probe || {};
    const knowledge = experiment?.analysis?.knowledge || {};
    const toolTrace = Array.isArray(variant?.toolTrace) ? variant.toolTrace : [];

    const root = create('section', 'ai-trace-root');
    root.id = TRACE_ID;
    const head = create('div', 'ai-trace-head');
    head.append(create('strong', '', 'ЦЕПОЧКА ПОСЛЕДНЕГО ХОДА'));
    head.append(create('span', '', `${Math.round(Number(probe?.confidence || 0) * 100)}% semantic · ${toolTrace.length} tool · ${Number(experiment?.elapsedMs || 0)} ms`));
    root.append(head);

    const list = create('div', 'ai-trace-list');
    let index = 1;

    const understood = lines([
      probe?.whatUserWants ? `Суть: ${probe.whatUserWants}` : '',
      probe?.latestMessageMeans ? `Последняя реплика: ${probe.latestMessageMeans}` : '',
      probe?.underlyingGoal ? `Общая цель: ${probe.underlyingGoal}` : ''
    ]);
    understood.append(jsonBlock({
      whatUserWants: probe?.whatUserWants || '',
      latestMessageMeans: probe?.latestMessageMeans || '',
      underlyingGoal: probe?.underlyingGoal || '',
      refersTo: probe?.refersTo || '',
      confidence: probe?.confidence || 0
    }));
    list.append(step(index++, 'ПОНЯЛ', understood, 'intent'));

    const context = contextLines(state, probe);
    const kbArticles = asArray(knowledge?.usedArticles).map(item => typeof item === 'string' ? item : item?.id).filter(Boolean);
    if (kbArticles.length) context.push(`KB: ${kbArticles.join(', ')}`);
    if (context.length) list.append(step(index++, 'КОНТЕКСТ', lines(context), 'intent'));

    const needs = needsLines(variant);
    if (needs.length) list.append(step(index++, 'НУЖНО УЗНАТЬ', lines(needs), 'need'));

    if (toolTrace.length) {
      list.append(step(index++, 'ПЛАН', planNode(toolTrace), 'need'));
      list.append(step(index++, 'TOOL', toolsNode(toolTrace), 'tool'));
      list.append(step(index++, 'ФАКТЫ', factsNode(toolTrace), 'fact'));
    }

    list.append(step(index++, 'ПРОВЕРКА', verifyNode(variant, toolTrace), 'verify'));
    list.append(step(index++, 'ВЫВОД', conclusionNode(variant, toolTrace), 'verify'));

    const answer = create('div');
    answer.append(create('div', 'ai-trace-line', variant?.reply || state?.lastDecision?.reply || 'Ответ не сформирован.'));
    answer.append(jsonBlock({
      reply: variant?.reply || state?.lastDecision?.reply || '',
      clarificationQuestions: variant?.clarificationQuestions || [],
      nextStepOffered: variant?.nextStepOffered || '',
      degraded: Boolean(variant?.degraded),
      degradationReason: variant?.degradationReason || ''
    }));
    list.append(step(index++, 'ОТВЕТ', answer, 'answer'));

    root.append(list, create('div', 'ai-trace-history-label', 'Сырой журнал событий ниже'));

    rendering = true;
    observer?.disconnect();
    document.getElementById(TRACE_ID)?.remove();
    eventsNode.prepend(root);
    observer?.observe(eventsNode, { childList: true, subtree: true });
    rendering = false;
  }

  async function getState() {
    const response = await chrome.runtime.sendMessage({ type: 'AI_OPERATOR_LAB_GET' });
    if (!response?.success) throw new Error(response?.error || 'AI Lab state unavailable');
    return response.data || {};
  }

  function schedule() {
    if (rendering) return;
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try { renderTrace(await getState()); }
      catch (error) { console.warn('[AI Lab trace] render failed', error); }
    }, 40);
  }

  function boot() {
    eventsNode = document.getElementById('aiLabEvents');
    if (!eventsNode) return;
    ensureStyles();
    observer = new MutationObserver(() => schedule());
    observer.observe(eventsNode, { childList: true, subtree: true });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
