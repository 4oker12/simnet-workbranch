(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const ASK = 'PBX_TRANSCRIPT_ASK';
  const CHANGED = 'CALL_PROCESSING_CHANGED';
  const POPOVER_ID = 'simnet-wb-pbx-manual-analysis-popover';
  const STYLE_ID = 'simnet-wb-pbx-manual-analysis-polish-style';
  const qaState = new Map();
  let activeRecordId = '';
  let pinnedRecordId = '';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .wb-pbx-manual-tools{width:52px!important}
      .wb-pbx-manual-result[data-state="ready"]{font-size:12px!important}

      #${POPOVER_ID}{width:min(640px,calc(100vw - 24px))!important;max-height:min(720px,calc(100vh - 24px))!important;background:#fff!important;border:1px solid #e3e8ef!important;border-radius:18px!important;color:#1f2d3d!important;box-shadow:0 18px 48px rgba(15,23,42,.18)!important}
      #${POPOVER_ID}[data-pinned="1"]{box-shadow:0 22px 58px rgba(15,23,42,.24)!important}
      #${POPOVER_ID} .wb-card-head{padding:16px 18px 12px!important;border-bottom:1px solid #edf0f4!important;background:rgba(255,255,255,.985)!important}
      #${POPOVER_ID} .wb-card-title-row{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:9px!important}
      #${POPOVER_ID} .h{min-width:0!important;color:#1f2d3d!important;font-size:18px!important;font-weight:800!important;line-height:1.2!important}
      #${POPOVER_ID} .wb-status{padding:3px 8px!important;font-size:9.5px!important;font-weight:750!important}
      #${POPOVER_ID} .wb-popover-controls{display:flex;align-items:center;gap:3px;margin-left:auto}
      #${POPOVER_ID} .wb-popover-control{width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:#526174;font:700 16px/28px Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;text-align:center;cursor:pointer}
      #${POPOVER_ID} .wb-popover-control:hover{background:#f3f6f9;color:#25364a}
      #${POPOVER_ID} .wb-popover-pin[data-active="1"]{background:#fbf2f7;color:#a50046}

      #${POPOVER_ID} .m{display:flex!important;align-items:center!important;flex-wrap:wrap!important;gap:0!important;margin-top:7px!important;color:#7a8798!important;font-size:10.5px!important}
      #${POPOVER_ID} .m span{display:inline!important;min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;overflow-wrap:anywhere!important}
      #${POPOVER_ID} .m span+span::before{content:'·';display:inline-block;margin:0 7px;color:#b2bac4}

      #${POPOVER_ID} .wb-card-body{display:block!important;padding:13px 18px 16px!important}
      #${POPOVER_ID} .s{display:grid!important;grid-template-columns:155px minmax(0,1fr)!important;column-gap:16px!important;margin:0!important;padding:11px 0!important;border:0!important;border-top:1px solid #edf0f3!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
      #${POPOVER_ID} .s:first-child{border-top:0!important}
      #${POPOVER_ID} .l{margin:0!important;color:#59687a!important;font-size:11.5px!important;font-weight:700!important;letter-spacing:0!important;text-transform:none!important;line-height:1.45!important}
      #${POPOVER_ID} .s>div:last-child{color:#33445a!important;font-size:12.5px!important;line-height:1.52!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important}

      #${POPOVER_ID} .s[data-kind="summary"]{display:block!important;margin:0 0 9px!important;padding:12px 14px!important;border:0!important;border-left:3px solid #a50046!important;border-radius:10px!important;background:linear-gradient(90deg,#fbf3f8 0%,#fdf8fb 100%)!important}
      #${POPOVER_ID} .s[data-kind="summary"] .l{display:none!important}
      #${POPOVER_ID} .s[data-kind="summary"]>div:last-child{color:#202d3d!important;font-size:14px!important;font-weight:650!important;line-height:1.5!important}
      #${POPOVER_ID} .s[data-kind="error"]{display:block!important;padding:9px 0!important;border-color:#f1d4d4!important;color:#a33232!important}
      #${POPOVER_ID} .s[data-kind="meta"]{display:block!important;background:transparent!important}

      #${POPOVER_ID} .wb-qa{margin-top:4px;padding:13px 0 4px;border-top:1px solid #e8edf2}
      #${POPOVER_ID} .wb-qa-label{margin:0 0 7px;color:#27384d;font-size:12px;font-weight:750}
      #${POPOVER_ID} .wb-qa-row{display:flex;align-items:center;gap:7px}
      #${POPOVER_ID} .wb-qa-input{min-width:0;flex:1;height:38px;box-sizing:border-box;padding:7px 11px;border:1px solid #d9e1e9;border-radius:9px;background:#fff;color:#263648;outline:none;font:12.5px/1.35 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;transition:border-color .12s,box-shadow .12s}
      #${POPOVER_ID} .wb-qa-input:focus{border-color:#c69ab0;box-shadow:0 0 0 3px rgba(165,0,70,.07)}
      #${POPOVER_ID} .wb-qa-send{flex:0 0 auto;width:38px;height:38px;padding:0;border:0;border-radius:9px;background:#a50046;color:#fff;box-shadow:0 2px 7px rgba(165,0,70,.16);font:800 17px/38px Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;cursor:pointer}
      #${POPOVER_ID} .wb-qa-send:hover{background:#8f003d}
      #${POPOVER_ID} .wb-qa-send:disabled{opacity:.5;cursor:wait}
      #${POPOVER_ID} .wb-qa-answer{margin-top:8px;padding:10px 12px;border:0;border-radius:9px;background:#f7f9fb;color:#2f4055;font-size:12.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
      #${POPOVER_ID} .wb-qa-answer[data-tone="loading"]{color:#758294}
      #${POPOVER_ID} .wb-qa-answer[data-tone="error"]{background:#fff5f5;color:#9b2c2c}

      #${POPOVER_ID} details.wb-tech{margin:10px 0 0!important;border:0!important;border-top:1px solid #edf0f3!important;border-radius:0!important;background:transparent!important;overflow:visible!important}
      #${POPOVER_ID} details.wb-tech summary{padding:9px 0 0!important;color:#8a95a3!important;font-size:9.5px!important;font-weight:650!important;list-style:none!important}
      #${POPOVER_ID} details.wb-tech summary::-webkit-details-marker{display:none!important}
      #${POPOVER_ID} details.wb-tech summary::after{content:'▾';float:right;color:#aab2bc}
      #${POPOVER_ID} details.wb-tech[open] summary::after{transform:rotate(180deg)}
      #${POPOVER_ID} .wb-tech-body{padding:7px 0 0;color:#8a95a3;font-size:9.5px;line-height:1.45;overflow-wrap:anywhere}

      @media (max-width:680px){
        #${POPOVER_ID}{width:calc(100vw - 16px)!important;border-radius:14px!important}
        #${POPOVER_ID} .wb-card-head{padding:13px 14px 10px!important}
        #${POPOVER_ID} .wb-card-body{padding:10px 14px 13px!important}
        #${POPOVER_ID} .s{grid-template-columns:120px minmax(0,1fr)!important;column-gap:10px!important}
      }
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

  function protectPinnedBadge(badge) {
    if (badge.dataset.wbPinGuard === '1') return;
    badge.dataset.wbPinGuard = '1';
    badge.addEventListener('mouseleave', event => {
      const recordId = recordIdFromTarget(badge);
      if (pinnedRecordId && pinnedRecordId === recordId) event.stopImmediatePropagation();
    }, true);
    badge.addEventListener('blur', event => {
      const recordId = recordIdFromTarget(badge);
      if (pinnedRecordId && pinnedRecordId === recordId) event.stopImmediatePropagation();
    }, true);
  }

  function polishBadges() {
    for (const badge of document.querySelectorAll('.wb-pbx-manual-result')) {
      protectPinnedBadge(badge);
      const state = String(badge.dataset.state || '');
      if (state === 'ready') {
        badge.textContent = '✓';
        badge.title = 'Разбор готов · нажмите, чтобы закрепить';
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

  function removeUnwantedSections(popover) {
    for (const section of popover.querySelectorAll('.s')) {
      const label = String(section.querySelector('.l')?.textContent || '').trim();
      if (label === 'Следующий шаг') section.remove();
    }
    for (const details of Array.from(popover.querySelectorAll('details'))) {
      const label = String(details.querySelector('summary')?.textContent || '').trim();
      if (/^Расшифровка\s*·/i.test(label)) details.remove();
    }
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
    box.dataset.tone = state.loading ? 'loading' : (state.error ? 'error' : '');
    box.textContent = state.loading ? 'Ищу в разговоре…' : (state.error || state.answer || '');
  }

  function addQuestionForm(popover, recordId) {
    if (!recordId || popover.querySelector('.wb-qa')) return;
    const body = popover.querySelector('.wb-card-body');
    if (!body) return;
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
    input.placeholder = 'Задайте любой вопрос по этому звонку…';
    input.value = state.question || '';
    const send = document.createElement('button');
    send.className = 'wb-qa-send';
    send.type = 'submit';
    send.textContent = '↑';
    send.title = 'Спросить по разговору';
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

    body.appendChild(form);
  }

  function addTechnicalDetails(popover, text) {
    if (!text || popover.querySelector('.wb-tech')) return;
    const bodyRoot = popover.querySelector('.wb-card-body');
    if (!bodyRoot) return;
    const details = document.createElement('details');
    details.className = 'wb-tech';
    const summary = document.createElement('summary');
    summary.textContent = 'Технические данные';
    const body = document.createElement('div');
    body.className = 'wb-tech-body';
    body.textContent = text;
    details.append(summary, body);
    bodyRoot.appendChild(details);
  }

  function ensurePopoverControls(popover, recordId) {
    const titleRow = popover.querySelector('.wb-card-title-row');
    if (!titleRow) return;
    let controls = titleRow.querySelector('.wb-popover-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'wb-popover-controls';
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'wb-popover-control wb-popover-pin';
      pin.textContent = '⌖';
      pin.title = 'Закрепить / открепить';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'wb-popover-control wb-popover-close';
      close.textContent = '×';
      close.title = 'Закрыть';
      pin.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        pinnedRecordId = pinnedRecordId === recordId ? '' : recordId;
        popover.dataset.pinned = pinnedRecordId === recordId ? '1' : '0';
        pin.dataset.active = pinnedRecordId === recordId ? '1' : '0';
      });
      close.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        pinnedRecordId = '';
        activeRecordId = '';
        popover.dataset.pinned = '0';
        popover.dataset.open = '0';
      });
      controls.append(pin, close);
      titleRow.appendChild(controls);
    }
    const pin = controls.querySelector('.wb-popover-pin');
    if (pin) pin.dataset.active = pinnedRecordId === recordId ? '1' : '0';
    popover.dataset.pinned = pinnedRecordId === recordId ? '1' : '0';
  }

  function protectPinnedPopover(popover) {
    if (popover.dataset.wbPinGuard === '1') return;
    popover.dataset.wbPinGuard = '1';
    popover.addEventListener('mouseleave', event => {
      if (pinnedRecordId) event.stopImmediatePropagation();
    }, true);
  }

  function polishPopover(recordId = activeRecordId) {
    installStyle();
    polishBadges();
    const popover = document.getElementById(POPOVER_ID);
    if (!popover || popover.dataset.open !== '1') return;
    protectPinnedPopover(popover);
    renamePresentation(popover);
    const tech = technicalText(popover);
    removeUnwantedSections(popover);
    addQuestionForm(popover, recordId);
    addTechnicalDetails(popover, tech);
    ensurePopoverControls(popover, recordId);
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
    const recordId = recordIdFromTarget(badge);
    if (pinnedRecordId && pinnedRecordId !== recordId) return;
    activeRecordId = recordId;
    queuePolish(activeRecordId);
  }, true);

  document.addEventListener('click', event => {
    const badge = event.target?.closest?.('.wb-pbx-manual-result');
    if (!badge) return;
    const recordId = recordIdFromTarget(badge);
    if (!recordId) return;
    event.preventDefault();
    event.stopPropagation();
    activeRecordId = recordId;
    pinnedRecordId = pinnedRecordId === recordId ? '' : recordId;
    queuePolish(recordId);
  }, true);

  document.addEventListener('focusin', event => {
    const badge = event.target?.closest?.('.wb-pbx-manual-result');
    if (!badge) return;
    const recordId = recordIdFromTarget(badge);
    if (pinnedRecordId && pinnedRecordId !== recordId) return;
    activeRecordId = recordId;
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
