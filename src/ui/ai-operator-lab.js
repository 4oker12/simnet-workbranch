'use strict';

(() => {
  const transcriptNode = document.getElementById('aiLabTranscript');
  const eventsNode = document.getElementById('aiLabEvents');
  const identityNode = document.getElementById('aiLabIdentity');
  const input = document.getElementById('aiLabInput');
  const sendButton = document.getElementById('aiLabSend');
  const resetButton = document.getElementById('aiLabReset');
  const statusNode = document.getElementById('aiLabStatus');
  const quickButtons = Array.from(document.querySelectorAll('[data-ai-lab-prompt]'));

  if (!transcriptNode || !eventsNode || !identityNode || !input || !sendButton || !resetButton || !statusNode) return;

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

  function json(value) {
    try { return JSON.stringify(value ?? null, null, 2); } catch { return String(value ?? ''); }
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
    if (event.type === 'decision') return `AI DECISION · ${event.action || '—'}${event.tool ? ` → ${event.tool}` : ''}`;
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
    renderIdentity(state);
    renderMessages(state.messages || []);
    renderEvents(state.events || []);
    const last = state.lastDecision || {};
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
    for (const button of quickButtons) button.disabled = Boolean(busy);
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
