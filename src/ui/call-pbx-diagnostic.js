(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callPbxDiagnostic) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  const PROBE_MESSAGE = 'CALL_PBX_RECORD_PROBE';
  const PBX_QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';
  const CALL_LIST_DEBUG_MESSAGE = 'CALL_LIST_DEBUG';
  const hookedHosts = new WeakSet();

  function selectedCall() {
    const registration = WB.callRegistration;
    return registration?.selectedPbxCall?.()
      || registration?.focusCall
      || null;
  }

  async function runtimeRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '0 B';
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
  }

  function statusNode(form) {
    let node = form.querySelector('[data-pbx-record-probe-status]');
    if (node) return node;
    node = document.createElement('div');
    node.dataset.pbxRecordProbeStatus = '1';
    node.style.cssText = 'font:11px/1.35 inherit;color:#475467;margin:-2px 0 6px;white-space:normal';
    const existing = form.querySelector('[data-call-transcription-status]');
    if (existing) existing.insertAdjacentElement('afterend', node);
    else form.querySelector('textarea[name="comment"]')?.closest('label')?.insertAdjacentElement('afterend', node);
    return node;
  }

  function setStatus(form, message, kind = 'info') {
    const node = statusNode(form);
    node.textContent = String(message || '');
    node.style.color = kind === 'error' ? '#B42318' : kind === 'success' ? '#067647' : '#475467';
  }

  function summarizeAttempt(attempt = {}) {
    const parts = [
      `${String(attempt.mode || '').toUpperCase()} HTTP ${Number(attempt.status || 0) || 'ERR'}`,
      attempt.contentType || 'без Content-Type',
      formatBytes(attempt.bytesReceived),
      attempt.signature || attempt.firstBytesHex || 'без сигнатуры'
    ];
    if (attempt.contentRange) parts.push(`Content-Range ${attempt.contentRange}`);
    if (attempt.error) parts.push(attempt.error);
    return parts.filter(Boolean).join(' · ');
  }

  function logResult(result) {
    const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
    console.groupCollapsed(`[SIMNET WB][PBX PROBE] ${result?.recordId || ''}`);
    console.table(attempts);
    console.log(result);
    console.groupEnd();
    return attempts;
  }

  function renderResult(form, result, call = null) {
    const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
    const direct = attempts.find(item => item?.mode === 'direct') || attempts[0] || {};
    const range = attempts.find(item => item?.mode === 'range') || null;
    const identity = describeCall(call);
    const prefix = identity ? `${identity} · ` : '';

    if (result?.verdict === 'DIRECT_AUDIO') {
      setStatus(
        form,
        `${prefix}PBX OK: ${summarizeAttempt(direct)} · прямой GET даёт полный аудиофайл. Можно использовать для транскрипции без открытия PBX/Play.`,
        'success'
      );
      return;
    }

    if (result?.verdict === 'RANGE_AUDIO_ONLY') {
      setStatus(
        form,
        `${prefix}PBX частично OK: обычный GET не дал пригодный полный файл; Range-запрос дал аудио. DIRECT: ${summarizeAttempt(direct)}. RANGE: ${summarizeAttempt(range)}.`,
        'error'
      );
      return;
    }

    const preview = direct?.bodyPreview || range?.bodyPreview || '';
    setStatus(
      form,
      `${prefix}PBX не отдал аудио. ${attempts.map(summarizeAttempt).join(' | ')}${preview ? ` · ответ: ${preview}` : ''}`,
      'error'
    );
  }

  function usableRecordedCall(call) {
    return Boolean(
      call
      && typeof call === 'object'
      && !call.ongoing
      && String(call.recordUrl || '').trim()
    );
  }

  function describeCall(call = {}) {
    const callId = String(call.usersideCallId || '').trim();
    const recordId = String(call.recordId || '').trim();
    const phone = String(call.callerMasked || call.callerId || '').trim();
    const when = [call.date, call.time].filter(Boolean).join(' ');
    return [
      callId ? `CALL #${callId}` : '',
      recordId ? `PBX ${recordId}` : '',
      phone,
      when
    ].filter(Boolean).join(' · ');
  }

  function formPhone(form) {
    return String(form?.elements?.dopf_13?.value || form?.querySelector?.('input[name="dopf_13"]')?.value || '').trim();
  }

  function logCallResolution({ local, pbx, debug, phone }) {
    console.groupCollapsed(`[SIMNET WB][CALL RESOLVE] ${phone || 'без телефона'}`);
    console.log('selected/local call', local || null);
    console.log('PBX_RECENT_CALLS_QUERY result', pbx || null);
    if (debug) {
      console.log('CALL_LIST_DEBUG request', debug.request || null);
      console.log('CALL_LIST_DEBUG raw', debug.raw || null);
      console.log('CALL_LIST_DEBUG parsed', debug.parsed || null);
      if (Array.isArray(debug.targetRows) && debug.targetRows.length) console.table(debug.targetRows);
      if (Array.isArray(debug.latestRaw)) console.table(debug.latestRaw);
      if (Array.isArray(debug.latestParsed)) console.table(debug.latestParsed);
      console.log('CALL_LIST_DEBUG full', debug);
    }
    console.groupEnd();
  }

  function debugSummary(debug = {}) {
    const req = debug.request || {};
    const raw = debug.raw || {};
    const parsed = debug.parsed || {};
    const target = Array.isArray(debug.targetRows) ? debug.targetRows[0] : null;
    const parts = [
      `HTTP ${Number(req.status || 0) || 'ERR'}`,
      `${Number(req.bytes || 0)} B`,
      `rows=${Number(raw.tableItemRows || 0)}`,
      `getrec=${Number(raw.getrecCount || 0)}`,
      `6047=${Number(raw.extension6047Count || 0)}`,
      `parsed=${Number(parsed.ownRows || 0)}`,
      `ready=${Number(parsed.withRecordId || 0)}`
    ];
    if (debug.targetPhone) parts.push(`phone=${raw.targetPhonePresent ? 'raw-found' : 'raw-missing'}`);
    if (target) parts.push(`target[${target.rejection || 'none'}]`);
    if (req.redirected) parts.push(`redirect→${req.finalUrl || '?'}`);
    return parts.join(' · ');
  }

  async function resolveRecordedCall(form, explicitRecordUrl = '') {
    const direct = String(explicitRecordUrl || '').trim();
    if (direct) return { recordUrl: direct };

    const local = selectedCall();
    if (usableRecordedCall(local)) return local;

    const phone = formPhone(form);
    setStatus(form, `Обновляю UserSide call_list${phone ? ` для ${phone}` : ''} и ищу PBX-ссылку последнего звонка оператора…`);
    const pbx = await runtimeRequest(PBX_QUERY_MESSAGE, {
      fresh: true,
      forceRefresh: true,
      focusCallKey: String(local?.callKey || '')
    });

    console.groupCollapsed(`[SIMNET WB][CALL RESOLVE] PBX query ${phone || ''}`);
    console.log('selected/local call', local || null);
    console.log('PBX_RECENT_CALLS_QUERY result', pbx || null);
    console.groupEnd();

    const focus = pbx?.focusCall && typeof pbx.focusCall === 'object' ? pbx.focusCall : null;
    if (focus?.ongoing && !focus?.recordUrl) {
      throw new Error('Текущий звонок ещё идёт или PBX-запись ещё не появилась. После завершения нажми «Проверить PBX» ещё раз.');
    }
    if (usableRecordedCall(focus)) return focus;

    const calls = Array.isArray(pbx?.calls) ? pbx.calls : [];
    const latestRecorded = calls.find(usableRecordedCall) || null;
    if (latestRecorded) return latestRecorded;

    let debug = null;
    try {
      debug = await runtimeRequest(CALL_LIST_DEBUG_MESSAGE, { phone });
      logCallResolution({ local, pbx, debug, phone });
    } catch (error) {
      console.error('[SIMNET WB][CALL_LIST DEBUG] failed', error);
    }

    const suffix = debug ? ` Диагностика: ${debugSummary(debug)}.` : '';
    throw new Error(`В свежем UserSide call_list не найден завершённый звонок с готовой PBX-записью.${suffix}`);
  }

  async function probe(form, button, explicitRecordUrl = '') {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'CALL…';

    try {
      const call = await resolveRecordedCall(form, explicitRecordUrl);
      const recordUrl = String(call?.recordUrl || '').trim();
      if (!recordUrl) throw new Error('PBX recordUrl не найден');

      button.textContent = 'PBX…';
      setStatus(form, `${describeCall(call) || 'PBX запись найдена'} · проверяю прямое скачивание. GPU и регистрация звонка не запускаются.`);
      const result = await runtimeRequest(PROBE_MESSAGE, { recordUrl });
      logResult(result);
      renderResult(form, result, call);
      return result;
    } catch (error) {
      setStatus(form, `PBX probe: ${String(error?.message || error || 'ошибка')}`, 'error');
      throw error;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function installIntoForm(form) {
    if (!form || form.querySelector('[data-pbx-record-probe]')) return;
    const actions = form.querySelector('.actions');
    const submit = form.querySelector('button[type="submit"]');
    if (!actions || !submit) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.dataset.pbxRecordProbe = '1';
    button.textContent = 'Проверить PBX';
    button.title = 'Сам обновит UserSide call_list и возьмёт getrec.php последнего завершённого звонка. При ошибке пишет подробный CALL_LIST DEBUG в Console.';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void probe(form, button).catch(() => {});
    });

    const transcribe = actions.querySelector('[data-call-transcribe]');
    actions.insertBefore(button, transcribe || submit);
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

  WB.callPbxDiagnostic = Object.freeze({
    probeSelected: async () => {
      const host = document.getElementById(HOST_ID);
      const form = host?.shadowRoot?.querySelector('form[data-call-form]');
      const button = form?.querySelector('[data-pbx-record-probe]');
      if (!form || !button) throw new Error('Открой форму регистрации звонка');
      return probe(form, button);
    },
    probeUrl: async recordUrl => {
      const host = document.getElementById(HOST_ID);
      const form = host?.shadowRoot?.querySelector('form[data-call-form]');
      const button = form?.querySelector('[data-pbx-record-probe]');
      if (!form || !button) throw new Error('Открой форму регистрации звонка');
      return probe(form, button, String(recordUrl || ''));
    }
  });
})();
