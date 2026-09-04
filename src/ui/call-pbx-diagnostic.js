(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callPbxDiagnostic) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  const PROBE_MESSAGE = 'CALL_PBX_RECORD_PROBE';
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

  async function probe(form, button) {
    const call = selectedCall();
    if (!call?.recordUrl) {
      setStatus(form, 'У выбранного звонка нет recordUrl PBX.', 'error');
      return null;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'PBX…';
    setStatus(form, 'Проверяю прямое скачивание записи PBX. GPU и регистрация звонка не запускаются.');

    try {
      const result = await runtimeRequest(PROBE_MESSAGE, { recordUrl: String(call.recordUrl) });
      const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
      console.groupCollapsed(`[SIMNET WB][PBX PROBE] ${result?.recordId || ''}`);
      console.table(attempts);
      console.log(result);
      console.groupEnd();

      const direct = attempts.find(item => item?.mode === 'direct') || attempts[0] || {};
      const range = attempts.find(item => item?.mode === 'range') || null;

      if (result?.verdict === 'DIRECT_AUDIO') {
        setStatus(
          form,
          `PBX OK: ${summarizeAttempt(direct)} · прямой GET даёт полный аудиофайл. Можно использовать для транскрипции без открытия PBX/Play.`,
          'success'
        );
      } else if (result?.verdict === 'RANGE_AUDIO_ONLY') {
        setStatus(
          form,
          `PBX частично OK: обычный GET не дал пригодный полный файл; Range-запрос дал аудио. DIRECT: ${summarizeAttempt(direct)}. RANGE: ${summarizeAttempt(range)}.`,
          'error'
        );
      } else {
        const preview = direct?.bodyPreview || range?.bodyPreview || '';
        setStatus(
          form,
          `PBX не отдал аудио. ${attempts.map(summarizeAttempt).join(' | ')}${preview ? ` · ответ: ${preview}` : ''}`,
          'error'
        );
      }
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
    button.title = 'Только проверка скачивания getrec.php: без Vast, без транскрипции, без регистрации звонка.';
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
    }
  });
})();
