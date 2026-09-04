(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callTranscription) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  const TRANSCRIBE_MESSAGE = 'CALL_TRANSCRIBE_RECORD';
  const HEALTH_MESSAGE = 'CALL_TRANSCRIBER_HEALTH';
  const PBX_QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';
  const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
  const MAX_COMMENT_TRANSCRIPT_CHARS = 12_000;
  const hookedHosts = new WeakSet();

  function compact(value, max = 220) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function customerIdOf(caseData = {}) {
    const valueOf = raw => raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
    const candidates = [
      valueOf(caseData?.identity?.customerId),
      valueOf(caseData?.profile?.customerId),
      String(caseData?.id || '').match(/^userside:(\d{1,12})$/)?.[1]
    ];
    for (const value of candidates) {
      const id = String(value || '').match(/^\d{1,12}$/)?.[0] || '';
      if (id) return id;
    }
    return '';
  }

  async function runtimeRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function statusNode(form) {
    let node = form.querySelector('[data-call-transcription-status]');
    if (node) return node;
    node = document.createElement('div');
    node.dataset.callTranscriptionStatus = '1';
    node.style.cssText = 'font:11px/1.35 inherit;color:#475467;margin:-2px 0 6px;white-space:normal';
    const comment = form.querySelector('textarea[name="comment"]');
    comment?.closest('label')?.insertAdjacentElement('afterend', node);
    return node;
  }

  function setStatus(form, message, kind = 'info') {
    const node = statusNode(form);
    node.textContent = String(message || '');
    node.style.color = kind === 'error' ? '#B42318' : kind === 'success' ? '#067647' : '#475467';
  }

  function transcriptDraft(text) {
    const raw = String(text || '').trim();
    if (raw.length <= MAX_COMMENT_TRANSCRIPT_CHARS) return raw;
    return `${raw.slice(0, MAX_COMMENT_TRANSCRIPT_CHARS - 120).trim()}\n\n[Полный транскрипт сохранён в Workbench; комментарий сокращён.]`;
  }

  function applyTranscript(form, entry) {
    const textarea = form.querySelector('textarea[name="comment"]');
    if (!textarea) throw new Error('Поле комментария UserSide не найдено');
    const draft = transcriptDraft(entry?.text || '');
    if (!draft) throw new Error('Транскрипт пуст');

    const existing = String(textarea.value || '').trim();
    if (!existing) {
      textarea.value = draft;
    } else if (!existing.includes(draft.slice(0, Math.min(120, draft.length)))) {
      textarea.value = `${existing}\n\nТранскрипт звонка:\n${draft}`;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.focus({ preventScroll: true });
  }

  function selectedCall() {
    const registration = WB.callRegistration;
    return registration?.selectedPbxCall?.()
      || registration?.focusCall
      || null;
  }

  function recordIdOf(call = {}) {
    return String(call?.recordId || call?.pbxRecordId || '').match(/^\d{9,12}\.\d{1,12}$/)?.[0] || '';
  }

  function recordUrlOf(call = {}) {
    const direct = String(call?.recordUrl || '').trim();
    if (direct) return direct;
    const recordId = recordIdOf(call);
    return recordId ? `${PBX_RECORD_BASE}${encodeURIComponent(recordId)}` : '';
  }

  function usableRecordedCall(call) {
    return Boolean(
      call
      && typeof call === 'object'
      && !call.ongoing
      && recordUrlOf(call)
    );
  }

  function describeCall(call = {}) {
    const callId = String(call.usersideCallId || '').trim();
    const recordId = recordIdOf(call);
    const phone = String(call.callerMasked || call.callerId || '').trim();
    const when = [call.date, call.time].filter(Boolean).join(' ');
    return [
      callId ? `CALL #${callId}` : '',
      recordId ? `PBX ${recordId}` : '',
      phone,
      when
    ].filter(Boolean).join(' · ');
  }

  async function resolveRecordedCall(form) {
    const local = selectedCall();
    if (usableRecordedCall(local)) return local;

    setStatus(form, 'Обновляю UserSide call_list и ищу запись последнего звонка оператора…');
    const pbx = await runtimeRequest(PBX_QUERY_MESSAGE, {
      fresh: true,
      forceRefresh: true,
      focusCallKey: String(local?.callKey || '')
    });

    const focus = pbx?.focusCall && typeof pbx.focusCall === 'object' ? pbx.focusCall : null;
    if (focus?.ongoing && !recordUrlOf(focus)) {
      throw new Error('Текущий звонок ещё идёт или запись PBX ещё не появилась. После завершения нажми «Транскрибировать» ещё раз.');
    }
    if (usableRecordedCall(focus)) return focus;

    const calls = Array.isArray(pbx?.calls) ? pbx.calls : [];
    const latestRecorded = calls.find(usableRecordedCall) || null;
    if (latestRecorded) return latestRecorded;

    throw new Error('В свежем UserSide call_list не найден завершённый звонок с готовой PBX-записью.');
  }

  async function transcribe(form, button, force = false) {
    const caseData = WB.store?.activeCase?.() || null;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'CALL…';

    try {
      const call = await resolveRecordedCall(form);
      const recordUrl = recordUrlOf(call);
      if (!recordUrl) throw new Error('PBX recordUrl не найден');
      setStatus(form, `Нашёл ${describeCall(call)}. Скачиваю запись PBX и отправляю её в транскрибер…`);
      button.textContent = 'GPU…';

      const entry = await runtimeRequest(TRANSCRIBE_MESSAGE, {
        callKey: String(call.callKey || ''),
        usersideCallId: String(call.usersideCallId || ''),
        customerId: customerIdOf(caseData),
        recordUrl,
        profile: 'simnet',
        language: 'auto',
        force
      });
      applyTranscript(form, entry);
      const duration = Number(entry?.durationSeconds || 0);
      const processing = Number(entry?.processingSeconds || 0);
      const language = String(entry?.language || '');
      const cached = entry?.cached ? ' · из кеша' : '';
      setStatus(
        form,
        `Транскрипт готов${cached}${language ? ` · ${language}` : ''}${duration ? ` · ${duration.toFixed(1)}с аудио` : ''}${processing ? ` · ${processing.toFixed(1)}с GPU` : ''}. Проверь комментарий и регистрируй штатной кнопкой UserSide.`,
        'success'
      );
      return entry;
    } catch (error) {
      const message = String(error?.message || error || 'Не удалось транскрибировать');
      const tunnelHint = /Failed to fetch|таймаут|Transcriber health|127\.0\.0\.1|localhost/i.test(message)
        ? ' Проверь SSH-туннель к Vast и /health.'
        : '';
      setStatus(form, `${compact(message, 420)}${tunnelHint}`, 'error');
      throw error;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function installIntoForm(form) {
    if (!form || form.querySelector('[data-call-transcribe]')) return;
    const actions = form.querySelector('.actions');
    const submit = form.querySelector('button[type="submit"]');
    if (!actions || !submit) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.dataset.callTranscribe = '1';
    button.textContent = 'Транскрибировать';
    button.title = 'Сам обновит UserSide call_list, найдёт PBX-запись последнего завершённого звонка → Vast GPU → текст. Shift+клик распознаёт заново.';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void transcribe(form, button, Boolean(event.shiftKey)).catch(() => {});
    });
    actions.insertBefore(button, submit);
  }

  function scanShadow(shadow) {
    shadow.querySelectorAll('form[data-call-form]').forEach(installIntoForm);
  }

  function hookHost(host) {
    if (!host?.shadowRoot || hookedHosts.has(host)) return;
    hookedHosts.add(host);
    const shadow = host.shadowRoot;
    scanShadow(shadow);
    const observer = new MutationObserver(() => scanShadow(shadow));
    observer.observe(shadow, { childList: true, subtree: true });
  }

  function scanDocument() {
    hookHost(document.getElementById(HOST_ID));
  }

  const documentObserver = new MutationObserver(scanDocument);
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  scanDocument();

  WB.callTranscription = Object.freeze({
    health: () => runtimeRequest(HEALTH_MESSAGE),
    transcribeSelected: async ({ force = false } = {}) => {
      const host = document.getElementById(HOST_ID);
      const form = host?.shadowRoot?.querySelector('form[data-call-form]');
      const button = form?.querySelector('[data-call-transcribe]');
      if (!form || !button) throw new Error('Открой форму регистрации звонка');
      return transcribe(form, button, force);
    }
  });
})();
