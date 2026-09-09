(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const ASK = 'PBX_TRANSCRIPT_ASK';
  const CHANGED = 'CALL_PROCESSING_CHANGED';
  const POPOVER_ID = 'simnet-wb-pbx-manual-analysis-popover';
  const STYLE_ID = 'simnet-wb-pbx-manual-analysis-polish-style';
  const qaState = new Map();
  let activeRecordId = '';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .wb-pbx-manual-tools{width:52px!important}
      .wb-pbx-manual-result[data-state="ready"]{font-size:12px!important}
      #${POPOVER_ID}{width:min(560px,calc(100vw - 24px))!important;background:#fff!important;border-color:#dfe5eb!important;border-radius:14px!important}
      #${POPOVER_ID} .wb-card-head{padding:12px 14px 10px!important;background:rgba(255,255,255,.99)!important}
      #${POPOVER_ID} .h{font-size:15px!important;font-weight:800!important}
      #${POPOVER_ID} .wb-status{padding:3px 7px!important;font-size:9px!important}
      #${POPOVER_ID} .m{display:flex!important;align-items:center!important;gap:0!important;margin-top:6px!important;color:#7a8594!important;font-size:10px!important}
      #${POPOVER_ID} .m span{display:inline!important;min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}
      #${POPOVER_ID} .m span+span::before{content:'·';display:inline-block;margin:0 6px;color:#b0b7c0}
      #${POPOVER_ID} .wb-card-body{display:block!important;padding:8px 14px 12px!important}
      #${POPOVER_ID} .s{margin:0!important;padding:8px 0!important;border:0!important;border-top:1px solid #edf0f3!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
      #${POPOVER_ID} .s:first-child{border-top:0!important}
      #${POPOVER_ID} .l{margin:0 0 2px!important;color:#788394!important;font-size:10px!important;font-weight:700!important;letter-spacing:0!important;text-transform:none!important}
      #${POPOVER_ID} .s>div:last-child{color:#29384a!important;font-size:12.5px!important;line-height:1.48!important}
      #${POPOVER_ID} .s[data-kind="summary"]{padding:5px 0 10px!important;border-left:0!important;background:transparent!important}
      #${POPOVER_ID} .s[data-kind="summary"] .l{display:none!important}
      #${POPOVER_ID} .s[data-kind="summary"]>div:last-child{font-size:13.5px!important;font-weight:600!important;line-height:1.5!important;color:#243247!important}
      #${POPOVER_ID} .s[data-kind="error"]{padding:8px 0!important;border-color:#f1d4d4!important;background:transparent!important;color:#a33232!important}
      #${POPOVER_ID} .s[data-kind="meta"]{background:transparent!important}
      #${POPOVER_ID} details{margin:0!important;border:0!important;border-top:1px solid #edf0f3!important;border-radius:0!important;background:transparent!important;overflow:visible!important}
      #${POPOVER_ID} summary{padding:9px 0!important;color:#4c5a6b!important;font-size:10.5px!important;font-weight:700!important}
      #${POPOVER_ID} details[open] summary{border-bottom:0!important}
      #${POPOVER_ID} pre{margin:0 0 6px!important;padding:8px 0 10px!important;max-height:300px!important;background:transparent!important;color:#344256!important;font-size:11.5px!important;line-height:1.55!important}
      #${POPOVER_ID} .wb-qa{margin-top:4px;padding:11px 0 10px;border-top:1px solid #e8edf2}
      #${POPOVER_ID} .wb-qa-label{margin:0 0 6px;color:#465568;font-size:10.5px;font-weight:750}
      #${POPOVER_ID} .wb-qa-row{display:flex;align-items:center;gap:6px}
      #${POPOVER_ID} .wb-qa-input{min-width:0;flex:1;height:32px;box-sizing:border-box;padding:5px 9px;border:1px solid #d8e0e8;border-radius:8px;background:#fff;color:#263648;outline:none;font:12px/1.35 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      #${POPOVER_ID} .wb-qa-input:focus{border-color:#9aa8b8;box-shadow:0 0 0 2px rgba(148,163,184,.14)}
      #${POPOVER_ID} .wb-qa-send{flex:0 0 auto;width:32px;height:32px;padding:0;border:1px solid #d5dde6;border-radius:8px;background:#f8fafc;color:#344256;font:800 15px/30px Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;cursor:pointer}
      #${POPOVER_ID} .wb-qa-send:hover{background:#f1f5f9}
      #${POPOVER_ID} .wb-qa-send:disabled{opacity:.55;cursor:wait}
      #${POPOVER_ID} .wb-qa-answer{margin-top:7px;padding-left:9px;border-left:2px solid #d6dde5;color:#344256;font-size:11.5px;line-height:1.48;white-space:pre-wrap;overflow-wrap:anywhere}
      #${POPOVER_ID} .wb-qa-answer[data-tone="error"]{border-left-color:#dca8a8;color:#9b2c2c}
      #${POPOVER_ID} .wb-tech{color:#768293!important}
      #${POPOVER_ID} .wb-tech-body{padding:0 0 9px;color:#7a8594;font-size:9.5px;line-height:1.45;overflow-wrap:anywhere}
      @media (max-width:620px){#${POPOVER_ID}{width:calc(100vw - 16px)!important}#${POPOVER_ID} .wb-card-body{padding:7px 12px 10px!important}}
    `;
    document.documentElement.appendChild(style);
  }

  async function runtimeRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function recordIdFromTarget(target) {
    return String(target?.closest?.('.wb-pbx-manual-tools')?.dataset?.recordId || '');
  }

  function polishBadges() {
    for (const badge of document.querySelectorAll('.wb-pbx-manual-result')) {
      const state = String(badge.dataset.state || '');
      if (state === 'ready') {
        badge.textContent = '✓';
        badge.title = 'Разбор готов';
      } else if (state === 'processing' && /AI/i.test(badge.textContent || '')) {
        badge.textContent = '…';
        badge.title = 'Идёт разбор';
      }
    }
  }

  function technicalText(popover) {
    for (const section of popover.querySelectorAll('.s')) {
      const label = String(section.querySelector('.l')?.textContent || '').trim();
      if (label === 'AI / токены') {
        const value = String(section.querySelector(':scope > div:last-child')?.textContent || '').trim();
        section.remove();
        return value;
      }
      if (label === 'AI') {
        const title = section.querySelector('.l');
        if (title) title.textContent = 'Ошибка разбора';
      }
    }
    return '';
  }

  function renamePresentation(popover) {
    const status = popover.querySelector('.wb-status');
    if (status) {
      const map = new Map([
        ['AI готов', 'Готово'],
        ['AI анализ', 'Разбор…'],
        ['Whisper', 'Расшифровка…']
      ]);
      const current = String(status.textContent || '').trim();
      if (map.has(current)) status.textContent = map.get(current);
    }
    for (const section of popover.querySelectorAll('.s')) {
      const value = section.querySelector(':scope > div:last-child');
      if (value && /AI-разбор/i.test(value.textContent || '')) {
        value.textContent = String(value.textContent || '').replace(/AI-разбор/gi, 'разбор');
      }
    }
  }

  function renderQaAnswer(box, state) {
    if (!state || (!state.loading && !state.answer && !state.error)) {
      box.hidden = true;
      box.textContent = '';
      box.dataset.tone = '';
      return;
    }
    box.hidden = false;
    box.dataset.tone = state.error ? 'error' : '';
    box.textContent = state.loading ? 'Ищу в расшифровке…' : (state.error || state.answer || '');
  }

  function addQuestionForm(popover, recordId, transcriptDetails) {
    if (!recordId || !transcriptDetails || popover.querySelector('.wb-qa')) return;
    const state = qaState.get(recordId) || { question: '', answer: '', error: '', loading: false };

    const form = document.createElement('form');
    form.className = 'wb-qa';
    const label = document.createElement('div');
    label.className = 'wb-qa-label';
    label.textContent = 'Спросить по разговору';
    const row = document.createElement('div');
    row.className = 'wb-qa-row';
    const input = document.createElement('input');
    input.className = 'wb-qa-input';
    input.type = 'text';
    input.maxLength = 600;
    input.autocomplete = 'off';
    input.placeholder = 'Например: упоминалась ли скидка?';
    input.value = state.question || '';
    const send = document.createElement('button');
    send.className = 'wb-qa-send';
    send.type = 'submit';
    send.textContent = '↑';
    send.title = 'Спросить по сохранённой расшифровке';
    send.disabled = Boolean(state.loading);
    row.append(input, send);
    const answer = document.createElement('div');
    answer.className = 'wb-qa-answer';
    renderQaAnswer(answer, state);
    form.append(label, row, answer);

    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      const question = String(input.value || '').trim();
      if (!question || send.disabled) return;
      const next = { question, answer: '', error: '', loading: true };
      qaState.set(recordId, next);
      send.disabled = true;
      renderQaAnswer(answer, next);
      void runtimeRequest(ASK, { recordId, question })
        .then(result => {
          const done = { question, answer: String(result?.answer || '').trim(), error: '', loading: false };
          qaState.set(recordId, done);
          send.disabled = false;
          renderQaAnswer(answer, done);
        })
        .catch(error => {
          const failed = { question, answer: '', error: String(error?.message || error || 'Не удалось получить ответ'), loading: false };
          qaState.set(recordId, failed);
          send.disabled = false;
          renderQaAnswer(answer, failed);
        });
    });

    transcriptDetails.insertAdjacentElement('beforebegin', form);
  }

  function addTechnicalDetails(popover, text, transcriptDetails) {
    if (!text || popover.querySelector('.wb-tech')) return;
    const details = document.createElement('details');
    details.className = 'wb-tech';
    const summary = document.createElement('summary');
    summary.textContent = 'Технические данные';
    const body = document.createElement('div');
    body.className = 'wb-tech-body';
    body.textContent = text;
    details.append(summary, body);
    if (transcriptDetails) transcriptDetails.insertAdjacentElement('afterend', details);
    else popover.querySelector('.wb-card-body')?.appendChild(details);
  }

  function polishPopover(recordId = activeRecordId) {
    installStyle();
    polishBadges();
    const popover = document.getElementById(POPOVER_ID);
    if (!popover || popover.dataset.open !== '1') return;
    renamePresentation(popover);
    const tech = technicalText(popover);
    const transcriptDetails = Array.from(popover.querySelectorAll('details')).find(details =>
      /^Расшифровка\s*·/i.test(String(details.querySelector('summary')?.textContent || '').trim())
    ) || null;
    if (transcriptDetails) addQuestionForm(popover, recordId, transcriptDetails);
    addTechnicalDetails(popover, tech, transcriptDetails);
  }

  function queuePolish(recordId = activeRecordId) {
    requestAnimationFrame(() => {
      polishPopover(recordId);
      requestAnimationFrame(() => polishPopover(recordId));
    });
  }

  document.addEventListener('mouseover', event => {
    const badge = event.target?.closest?.('.wb-pbx-manual-result');
    if (!badge) return;
    activeRecordId = recordIdFromTarget(badge);
    queuePolish(activeRecordId);
  }, true);

  document.addEventListener('focusin', event => {
    const badge = event.target?.closest?.('.wb-pbx-manual-result');
    if (!badge) return;
    activeRecordId = recordIdFromTarget(badge);
    queuePolish(activeRecordId);
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED) return false;
    queuePolish(activeRecordId);
    return false;
  });

  installStyle();
  polishBadges();
})();
