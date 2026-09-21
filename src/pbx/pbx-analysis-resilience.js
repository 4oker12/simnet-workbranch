(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const HOST_ID = 'simnet-wb-pbx-analysis-host';
  const ASK = 'PBX_TRANSCRIPT_ASK';
  const qaState = new Map();
  let lastRecordId = '';
  let attachedShadow = null;
  let shadowObserver = null;
  let documentObserver = null;

  function compact(value, max = 420) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function recordIdFromTools(node) {
    return String(node?.closest?.('.wb-pbx-manual-tools')?.dataset?.recordId || '').trim();
  }

  function toolsFor(recordId) {
    if (!recordId) return null;
    return document.querySelector(`.wb-pbx-manual-tools[data-record-id="${CSS.escape(recordId)}"]`);
  }

  function resultState(recordId) {
    return String(toolsFor(recordId)?.querySelector('.wb-pbx-manual-result')?.dataset?.state || '');
  }

  function syncRunButtons() {
    for (const tools of document.querySelectorAll('.wb-pbx-manual-tools[data-record-id]')) {
      const run = tools.querySelector('.wb-pbx-manual-run');
      const result = tools.querySelector('.wb-pbx-manual-result');
      if (!run || !result) continue;
      const state = String(result.dataset.state || 'idle');
      const busy = state === 'processing';
      run.disabled = busy;
      run.setAttribute('aria-disabled', busy ? 'true' : 'false');
      if (busy) {
        run.textContent = '…';
        run.title = 'Разбор уже выполняется. Повторный запуск заблокирован.';
        run.dataset.wbRetryGuard = 'busy';
      } else {
        if (state === 'error') {
          run.textContent = '↻';
          run.title = 'Ошибка разбора — нажмите, чтобы повторить';
        } else if (state === 'stopped' || state === 'partial') {
          run.textContent = '↻';
          run.title = 'Повторить разбор этого звонка';
        } else if (state === 'ready') {
          run.textContent = '↻';
          run.title = 'Пересчитать разбор этого звонка';
        }
        delete run.dataset.wbRetryGuard;
      }
    }
  }

  function installShadowStyle(shadow) {
    if (shadow.getElementById?.('wb-pbx-resilience-style')) return;
    const style = document.createElement('style');
    style.id = 'wb-pbx-resilience-style';
    style.textContent = `
      .wb-retry-box{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap}
      .wb-retry-btn{appearance:none;border:1px solid #d8a0b9;border-radius:9px;background:#fff;color:#a50046;padding:7px 11px;font:750 11px/1.2 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;cursor:pointer}
      .wb-retry-btn:hover{background:#fff4f8}
      .wb-retry-btn:disabled{opacity:.55;cursor:wait}
      .wb-retry-note{color:#7b8798;font-size:11px;line-height:1.35}
      .qaInput:disabled{background:#f7f8fa;color:#8993a1;cursor:wait}
    `;
    shadow.appendChild(style);
  }

  function paintAnswer(answer, current) {
    if (!answer) return;
    answer.replaceChildren();
    if (!current || (!current.loading && !current.answer && !current.error)) {
      answer.hidden = true;
      answer.dataset.tone = '';
      return;
    }
    answer.hidden = false;
    answer.dataset.tone = current.error ? 'error' : '';
    if (current.loading) {
      answer.textContent = current.attempt > 1 ? 'Повторяю запрос к AI…' : 'Ищу ответ в разговоре…';
      return;
    }
    if (current.answer) {
      answer.textContent = current.answer;
      return;
    }

    const message = document.createElement('div');
    message.textContent = current.error || 'AI не дал ответа.';
    answer.appendChild(message);

    const retryBox = document.createElement('div');
    retryBox.className = 'wb-retry-box';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'wb-retry-btn';
    retry.textContent = '↻ Повторить вопрос';
    retry.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const card = retry.closest('.card');
      const recordId = String(card?.dataset?.recordId || '');
      const state = qaState.get(recordId);
      if (!recordId || !state?.question || state.loading) return;
      void ask(recordId, state.question);
    });
    const note = document.createElement('span');
    note.className = 'wb-retry-note';
    note.textContent = 'Можно повторить тот же вопрос или изменить формулировку.';
    retryBox.append(retry, note);
    answer.appendChild(retryBox);
  }

  function syncQaCard(card) {
    if (!card) return;
    const recordId = String(card.dataset.recordId || lastRecordId || '');
    if (recordId && !card.dataset.recordId) card.dataset.recordId = recordId;
    if (!recordId) return;
    const state = qaState.get(recordId);
    if (!state) return;
    const input = card.querySelector('.qaInput');
    const send = card.querySelector('.qaSend');
    const answer = card.querySelector('.answer');
    if (input) {
      if (input.getRootNode()?.activeElement !== input && String(input.value || '') !== state.question) input.value = state.question || '';
      input.disabled = Boolean(state.loading);
    }
    if (send) {
      send.disabled = Boolean(state.loading);
      send.title = state.loading ? 'Запрос уже выполняется' : 'Спросить по разговору';
    }
    paintAnswer(answer, state);
  }

  function injectAnalysisRetry(card) {
    if (!card) return;
    const recordId = String(card.dataset.recordId || lastRecordId || '');
    if (recordId && !card.dataset.recordId) card.dataset.recordId = recordId;
    if (!recordId) return;
    const state = resultState(recordId);
    if (!['error', 'partial', 'stopped'].includes(state)) return;
    const body = card.querySelector('.body');
    if (!body || body.querySelector('.wb-analysis-retry')) return;

    const box = document.createElement('div');
    box.className = 'wb-retry-box wb-analysis-retry';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'wb-retry-btn';
    retry.textContent = state === 'error' ? '↻ Повторить разбор' : '↻ Запустить разбор ещё раз';
    retry.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const run = toolsFor(recordId)?.querySelector('.wb-pbx-manual-run');
      if (!run || run.disabled) return;
      run.click();
    });
    const note = document.createElement('span');
    note.className = 'wb-retry-note';
    note.textContent = state === 'partial'
      ? 'Текст звонка сохранён; повторно запускается AI-разбор.'
      : 'Предыдущая попытка завершилась неуспешно.';
    box.append(retry, note);
    body.prepend(box);
  }

  function syncCard() {
    const shadow = document.getElementById(HOST_ID)?.shadowRoot;
    const card = shadow?.querySelector('.card:not([hidden])');
    if (!card) return;
    if (lastRecordId) card.dataset.recordId = lastRecordId;
    syncQaCard(card);
    injectAnalysisRetry(card);
  }

  function retryableQaError(message) {
    const text = String(message || '');
    if (/\b(?:401|403)\b|api key|ключ.*не настроен|расшифровк.*не найдена|некорректн.*record/i.test(text)) return false;
    return /таймаут|timeout|пуст.*ответ|пуст.*финальн|служебн.*рассужд|не удалось получить ответ|failed to fetch|network|http 5\d\d/i.test(text);
  }

  function friendlyQaError(message) {
    const text = compact(message, 500);
    if (/расшифровк.*не найдена/i.test(text)) return 'Расшифровка этого звонка не найдена. Сначала повторите разбор звонка.';
    if (/api key|ключ.*не настроен|\b401\b|\b403\b/i.test(text)) return text;
    return 'AI не дал нормального ответа. Можно сразу повторить вопрос.';
  }

  async function askOnce(recordId, question) {
    if (!chrome?.runtime?.id) throw new Error('Extension context invalidated');
    const response = await chrome.runtime.sendMessage({ type: ASK, payload: { recordId, question } });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    const answer = compact(response?.data?.answer || '', 1800);
    if (!answer) throw new Error('AI вернул пустой финальный ответ');
    return answer;
  }

  async function ask(recordId, question) {
    const normalizedQuestion = compact(question, 600);
    if (!recordId || !normalizedQuestion) return;
    const current = qaState.get(recordId);
    if (current?.loading) return;

    let lastError = null;
    qaState.set(recordId, { question: normalizedQuestion, answer: '', error: '', loading: true, attempt: 1 });
    syncCard();

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      qaState.set(recordId, { question: normalizedQuestion, answer: '', error: '', loading: true, attempt });
      syncCard();
      try {
        const answer = await askOnce(recordId, normalizedQuestion);
        qaState.set(recordId, { question: normalizedQuestion, answer, error: '', loading: false, attempt });
        syncCard();
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= 2 || !retryableQaError(error?.message || error)) break;
        await new Promise(resolve => setTimeout(resolve, 450));
      }
    }

    console.warn('[SIMNET Workbench][PBX QA] request failed', { recordId, error: lastError });
    qaState.set(recordId, {
      question: normalizedQuestion,
      answer: '',
      error: friendlyQaError(lastError?.message || lastError),
      loading: false,
      attempt: 2
    });
    syncCard();
  }

  function attachShadow() {
    const shadow = document.getElementById(HOST_ID)?.shadowRoot;
    if (!shadow || shadow === attachedShadow) return;
    attachedShadow = shadow;
    installShadowStyle(shadow);

    shadow.addEventListener('submit', event => {
      const form = event.target?.closest?.('.qa');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const card = form.closest('.card');
      const recordId = String(card?.dataset?.recordId || lastRecordId || '');
      const input = form.querySelector('.qaInput');
      const question = String(input?.value || '').trim();
      if (!recordId || !question || qaState.get(recordId)?.loading) return;
      void ask(recordId, question);
    }, true);

    shadowObserver?.disconnect();
    shadowObserver = new MutationObserver(() => queueMicrotask(syncCard));
    shadowObserver.observe(shadow, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-tone'] });
    queueMicrotask(syncCard);
  }

  document.addEventListener('click', event => {
    const run = event.target?.closest?.('.wb-pbx-manual-run');
    if (!run) return;
    const recordId = recordIdFromTools(run);
    const state = resultState(recordId);
    if (state !== 'processing') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  for (const type of ['mouseenter', 'focusin', 'click']) {
    document.addEventListener(type, event => {
      const result = event.target?.closest?.('.wb-pbx-manual-result');
      if (!result) return;
      const recordId = recordIdFromTools(result);
      if (recordId) lastRecordId = recordId;
      queueMicrotask(syncCard);
    }, true);
  }

  documentObserver = new MutationObserver(() => {
    syncRunButtons();
    attachShadow();
    queueMicrotask(syncCard);
  });
  documentObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'disabled'] });

  syncRunButtons();
  attachShadow();
})();
