'use strict';

(() => {
  const transcriptNode = document.getElementById('aiLabTranscript');
  const eventsNode = document.getElementById('aiLabEvents');
  const identityNode = document.getElementById('aiLabIdentity');
  const input = document.getElementById('aiLabInput');
  const sendButton = document.getElementById('aiLabSend');
  const resetButton = document.getElementById('aiLabReset');
  const downloadTxtButton = document.getElementById('aiLabDownloadTxt');
  const downloadJsonButton = document.getElementById('aiLabDownloadJson');
  const statusNode = document.getElementById('aiLabStatus');
  const quickButtons = Array.from(document.querySelectorAll('[data-ai-lab-prompt]'));

  if (!transcriptNode || !eventsNode || !identityNode || !input || !sendButton || !resetButton || !statusNode) return;

  let latestState = null;
  let usageNode = null;
  let costPanel = null;
  let priceControls = null;

  function short(value, max = 260) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function setStatus(message, kind = '') {
    statusNode.textContent = String(message || '');
    statusNode.className = `status ai-lab-status${kind ? ` ${kind}` : ''}`;
  }

  async function runtime(type, payload = undefined) {
    const request = payload === undefined ? { type } : { type, payload };
    const response = await chrome.runtime.sendMessage(request);
    if (!response?.success) throw new Error(response?.error || 'Test Lab runtime did not return success');
    return response.data;
  }

  function create(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function ensureUsageNode() {
    if (usageNode?.isConnected) return usageNode;
    usageNode = document.getElementById('aiLabUsage');
    if (usageNode) return usageNode;
    usageNode = create('div', 'status compact ai-lab-token-usage', 'Tokens · —');
    usageNode.id = 'aiLabUsage';
    usageNode.title = 'Фактический usage последнего LLM-вызова и лимит Groq из HTTP headers.';
    identityNode.insertAdjacentElement('afterend', usageNode);
    return usageNode;
  }

  function json(value) {
    try { return JSON.stringify(value ?? null, null, 2); } catch { return String(value ?? ''); }
  }

  function localTime(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return String(value || '');
    return date.toLocaleString('ru-RU', { hour12: false });
  }

  function fileStamp(value = Date.now()) {
    const date = new Date(value);
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function renderUsage(state = {}) {
    const node = ensureUsageNode();
    const last = state?.lastDecision || {};
    const usage = last?.usage || {};
    const rate = last?.rateLimit || {};
    const inputTokens = number(usage.prompt_tokens ?? usage.input_tokens);
    const outputTokens = number(usage.completion_tokens ?? usage.output_tokens);
    const totalTokens = number(usage.total_tokens) || inputTokens + outputTokens;

    const cutoff = Date.now() - 60_000;
    const input60s = (Array.isArray(state?.events) ? state.events : [])
      .filter(event => event?.type === 'decision' && Date.parse(event?.at || 0) >= cutoff)
      .reduce((sum, event) => sum + number(event?.promptTokens), 0);

    if (!inputTokens && !outputTokens && !totalTokens) {
      node.textContent = 'Tokens · 0 · этот ход без LLM-вызова';
      return;
    }

    const parts = [
      `Tokens · ${inputTokens} in / ${outputTokens} out = ${totalTokens}`,
      input60s ? `input 60с: ${input60s}` : ''
    ];

    const limit = number(rate.limitTokens);
    const remaining = number(rate.remainingTokens);
    if (limit) parts.push(`Groq: ${remaining}/${limit} осталось`);
    if (rate.resetTokens) parts.push(`reset ${rate.resetTokens}`);
    if (rate.retryAfter) parts.push(`retry ${rate.retryAfter}s`);
    node.textContent = parts.filter(Boolean).join(' · ');
  }

  function usd(value) {
    const amount = Number(value || 0);
    return amount > 0 && amount < 0.000001 ? '<$0.000001' : '$' + amount.toFixed(6);
  }

  function renderCost(state = {}) {
    if (!costPanel) {
      const section = create('section', 'ai-api-cost');
      section.setAttribute('aria-label', 'Расход API');
      costPanel = create('div', 'ai-api-cost-summary');
      costPanel.id = 'aiLabCost';
      costPanel.setAttribute('aria-live', 'polite');
      const details = create('details', 'ai-api-pricing');
      details.append(create('summary', '', 'Изменить цены моделей'));
      const form = create('div', 'ai-api-price-grid');
      const model = create('select');
      const fields = {};
      const modelLabel = create('label', 'field-label', 'Модель');
      modelLabel.append(model); form.append(modelLabel);
      for (const [key, title] of [['input', 'Вход · $ / 1 млн'], ['output', 'Выход · $ / 1 млн'], ['cached', 'Кэш · $ / 1 млн']]) {
        const label = create('label', 'field-label', title);
        const field = create('input', 'text-input'); field.type = 'number'; field.min = '0'; field.step = 'any';
        if (key === 'cached') field.placeholder = 'По цене входа';
        label.append(field); form.append(label); fields[key] = field;
      }
      const save = create('button', 'secondary', 'Сохранить цену'); save.type = 'button';
      const notice = create('div', 'status'); notice.setAttribute('role', 'status');
      const fill = () => {
        const rate = latestState?.apiCost?.prices?.[model.value] || {};
        for (const [key, field] of Object.entries(fields)) field.value = rate[key] ?? '';
      };
      model.addEventListener('change', fill);
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const updated = await runtime('AI_OPERATOR_LAB_PRICE', { model: model.value, ...Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])) });
          render(updated); notice.textContent = 'Цена сохранена. Оценка пересчитана по сохранённым токенам.';
        } catch (error) { notice.textContent = short(error.message || error); }
        finally { save.disabled = false; }
      });
      details.append(form, save, notice);
      section.append(create('strong', '', 'Расход API · оценка USD'), costPanel, details,
        create('p', 'note', 'По usage ответов API. Счётчик только автооператора в этом Chrome-профиле; не баланс Groq и не расходы других приложений. Неизвестные списания не считаются нулевыми.'));
      ensureUsageNode().insertAdjacentElement('afterend', section);
      priceControls = { model, fill };
    }
    const cost = state.apiCost;
    if (!cost) { costPanel.textContent = 'Счётчик расходов недоступен.'; return; }
    const summary = (name, data = {}) => `${name}: ≈ ${usd(data.usd)}${data.missingUsage || data.unpricedCalls ? ' + неизвестная часть' : ''}`;
    costPanel.textContent = [summary('Последний ход', cost.turn), summary('Диалог', cost.session), summary('Всего с начала учёта', cost.total),
      `API-попыток в диалоге: ${cost.session.calls} · токены ${cost.session.input} вход / ${cost.session.output} выход`,
      cost.total.missingUsage ? `Без полного usage: ${cost.total.missingUsage}` : '',
      cost.total.unpricedCalls ? `Цена модели не задана: ${cost.total.unpricedCalls} выз.` : '',
      cost.total.cacheAtRegularRate ? 'Кэш с неизвестным тарифом оценён по обычной входной цене.' : '',
      cost.storageError ? 'Ошибка сохранения счётчика: итог может быть неполным.' : ''
    ].filter(Boolean).join(' · ');
    const selected = priceControls.model.value;
    const names = [...new Set([...Object.keys(cost.prices || {}), ...(cost.models || [])])];
    if (state.lastDecision?.model && !['fact-runtime', 'deterministic-basic-router'].includes(state.lastDecision.model) && !names.includes(state.lastDecision.model)) names.push(state.lastDecision.model);
    if (Array.from(priceControls.model.options).map(o => o.value).join('|') !== names.join('|')) {
      priceControls.model.replaceChildren(...names.map(name => { const option = create('option', '', name); option.value = name; return option; }));
      priceControls.model.value = names.includes(selected) ? selected : names[0];
      priceControls.fill();
    }
  }

  function identityLabel(state = {}) {
    if (state.confirmedSubscriber?.caseId || state.confirmedCaseId) {
      const subscriber = state.confirmedSubscriber || {};
      const parts = [
        subscriber.contract ? `договор ${subscriber.contract}` : '',
        subscriber.address || '',
        subscriber.ip ? `IP ${subscriber.ip}` : ''
      ].filter(Boolean);
      return {
        className: 'confirmed',
        title: 'Абонент подтверждён',
        detail: parts.join(' · ') || `case ${state.confirmedCaseId}`
      };
    }
    if (state.pendingCandidate?.caseId) {
      const candidate = state.pendingCandidate;
      const parts = [
        candidate.contract ? `договор ${candidate.contract}` : '',
        candidate.address || '',
        candidate.ip ? `IP ${candidate.ip}` : ''
      ].filter(Boolean);
      return {
        className: 'pending',
        title: 'Найден кандидат · ждём подтверждение',
        detail: parts.join(' · ') || candidate.caseId
      };
    }
    return {
      className: 'empty',
      title: 'Абонент не определён',
      detail: 'AI должен запросить договор или адрес, когда без идентификации нельзя продолжить.'
    };
  }

  function renderIdentity(state) {
    identityNode.replaceChildren();
    const identity = identityLabel(state);
    identityNode.className = `ai-lab-identity ${identity.className}`;
    identityNode.append(
      create('strong', '', identity.title),
      create('span', '', identity.detail)
    );
  }

  function renderMessages(messages = []) {
    transcriptNode.replaceChildren();
    if (!Array.isArray(messages) || !messages.length) {
      const empty = create('div', 'ai-lab-empty');
      empty.append(
        create('strong', '', 'Начни как абонент'),
        create('span', '', 'Например: «Какой у меня баланс?» или «У меня нет интернета».')
      );
      transcriptNode.append(empty);
      return;
    }

    for (const message of messages) {
      const role = message?.role === 'agent' ? 'agent' : 'customer';
      const row = create('div', `ai-lab-message ${role}`);
      const label = create('div', 'ai-lab-message-label', role === 'agent' ? 'AI оператор' : 'Ты · абонент');
      const bubble = create('div', 'ai-lab-message-bubble', message?.text || '');
      row.append(label, bubble);
      transcriptNode.append(row);
    }
    transcriptNode.scrollTop = transcriptNode.scrollHeight;
  }

  function eventSummary(event = {}) {
    if (event.type === 'tool_call') return `TOOL → ${event.tool || 'unknown'}`;
    if (event.type === 'tool_result') return `RESULT ← ${event.tool || 'unknown'} · ${event.code || (event.ok ? 'OK' : 'ERROR')}`;
    if (event.type === 'decision') {
      const tokens = number(event.promptTokens);
      return `AI DECISION · ${event.action || '—'}${event.tool ? ` → ${event.tool}` : ''}${tokens ? ` · ${tokens} in` : ''}`;
    }
    if (event.type === 'error') return `ERROR · ${event.code || 'runtime'}`;
    if (event.type === 'customer_message') return 'CLIENT MESSAGE';
    return String(event.type || 'event').toUpperCase();
  }

  function eventPayload(event = {}) {
    const copy = { ...event };
    delete copy.id;
    delete copy.type;
    return copy;
  }

  function renderEvents(events = []) {
    eventsNode.replaceChildren();
    const useful = (Array.isArray(events) ? events : [])
      .filter(event => event?.type !== 'customer_message')
      .slice(-50)
      .reverse();

    if (!useful.length) {
      eventsNode.append(create('div', 'ai-lab-log-empty', 'Tool-вызовов пока нет.'));
      return;
    }

    for (const event of useful) {
      const item = document.createElement('details');
      item.className = `ai-lab-event ${event.type || ''}`;
      if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'error') item.open = true;
      const summary = document.createElement('summary');
      summary.textContent = eventSummary(event);
      const pre = create('pre', '', json(eventPayload(event)));
      item.append(summary, pre);
      eventsNode.append(item);
    }
  }

  function render(state = {}) {
    latestState = state && typeof state === 'object' ? state : {};
    renderIdentity(latestState);
    renderUsage(latestState);
    renderCost(latestState);
    renderMessages(latestState.messages || []);
    renderEvents(latestState.events || []);
    const last = latestState.lastDecision || {};
    if (last.action) {
      setStatus(
        `Последнее решение: ${last.action}${last.tool ? ` · ${last.tool}` : ''}${last.model ? ` · ${last.model}` : ''}`,
        'ok'
      );
    } else {
      setStatus('Готово. Ты пишешь как абонент; AI сам выбирает READ-проверки.');
    }
  }

  async function refresh() {
    const state = await runtime('AI_OPERATOR_LAB_GET');
    render(state || {});
    return state;
  }

  function setBusy(busy) {
    sendButton.disabled = Boolean(busy);
    resetButton.disabled = Boolean(busy);
    input.disabled = Boolean(busy);
    if (downloadTxtButton) downloadTxtButton.disabled = Boolean(busy);
    if (downloadJsonButton) downloadJsonButton.disabled = Boolean(busy);
    for (const button of quickButtons) button.disabled = Boolean(busy);
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function txtExport(state = {}) {
    const identity = identityLabel(state);
    const lines = [
      'SIMNET Workbench · Autonomous AI Operator · Test Lab',
      `Lab: ${state.id || 'unknown'}`,
      `Created: ${localTime(state.createdAt)}`,
      `Updated: ${localTime(state.updatedAt)}`,
      `Identity: ${identity.title}${identity.detail ? ` · ${identity.detail}` : ''}`,
      '',
      `API COST ESTIMATE USD: ${json(state.apiCost || {})}`,
      '',
      '=== DIALOG ==='
    ];

    for (const message of Array.isArray(state.messages) ? state.messages : []) {
      const role = message?.role === 'agent' ? 'AI' : 'CLIENT';
      lines.push(`[${localTime(message?.at)}] ${role}: ${String(message?.text || '')}`);
    }

    lines.push('', '=== DECISIONS / TOOLS ===');
    for (const event of Array.isArray(state.events) ? state.events : []) {
      if (event?.type === 'customer_message') continue;
      lines.push(`[${localTime(event?.at)}] ${eventSummary(event)}`);
      const payload = eventPayload(event);
      const payloadText = json(payload);
      if (payloadText && payloadText !== '{}') lines.push(payloadText);
    }

    return `${lines.join('\n')}\n`;
  }

  async function download(format) {
    try {
      const state = latestState || await refresh();
      const stamp = fileStamp();
      if (format === 'json') {
        downloadFile(
          `simnet-ai-operator-lab-${stamp}.json`,
          `${JSON.stringify(state || {}, null, 2)}\n`,
          'application/json;charset=utf-8'
        );
      } else {
        downloadFile(
          `simnet-ai-operator-lab-${stamp}.txt`,
          txtExport(state || {}),
          'text/plain;charset=utf-8'
        );
      }
      setStatus(`Лог ${format.toUpperCase()} сохранён.`, 'ok');
    } catch (error) {
      setStatus(`Экспорт: ${short(error?.message || error, 500)}`, 'bad');
    }
  }

  async function send() {
    const message = String(input.value || '').trim();
    if (!message) return;
    setBusy(true);
    setStatus('AI думает и при необходимости запускает READ-проверки…');
    input.value = '';
    try {
      const state = await runtime('AI_OPERATOR_LAB_SEND', { text: message });
      render(state || {});
    } catch (error) {
      input.value = message;
      setStatus(short(error?.message || error, 600), 'bad');
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  sendButton.addEventListener('click', () => { void send(); });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send();
  });

  resetButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      const state = await runtime('AI_OPERATOR_LAB_RESET');
      render(state || {});
      setStatus('Новый тестовый диалог создан.', 'ok');
    } catch (error) {
      setStatus(short(error?.message || error, 500), 'bad');
    } finally {
      setBusy(false);
      input.focus();
    }
  });

  downloadTxtButton?.addEventListener('click', () => { void download('txt'); });
  downloadJsonButton?.addEventListener('click', () => { void download('json'); });

  for (const button of quickButtons) {
    button.addEventListener('click', () => {
      input.value = String(button.dataset.aiLabPrompt || '');
      input.focus();
    });
  }

  void refresh().catch(error => {
    setStatus(`Test Lab: ${short(error?.message || error, 500)}`, 'bad');
  });
})();
