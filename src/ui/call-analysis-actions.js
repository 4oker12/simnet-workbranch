(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const rail = WB?.rail;
  const bridge = WB?.callAttentionBridge;
  if (!WB || !rail || !bridge || window.top !== window.self || WB.callAnalysisActions) return;

  const REANALYZE = 'CALL_PROCESSING_REANALYZE';
  const PREF_KEY = 'simnet_workbench_call_record_preferences_v1';
  let prefs = {};
  let boundShadow = null;
  let observer = null;
  let queued = false;

  function digits(value, max = 24) {
    return String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
  }

  async function loadPrefs() {
    try {
      const raw = (await chrome.storage.local.get(PREF_KEY))?.[PREF_KEY] || {};
      prefs = raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
    } catch {
      prefs = {};
    }
  }

  function callForCard(card) {
    const meta = String(card?.querySelector?.('.call-event-meta')?.textContent || '');
    const callId = digits(meta.match(/CALL\s*#\s*(\d+)/i)?.[1], 24);
    if (!callId) return null;
    return bridge.calls.find(call => digits(call?.usersideCallId, 24) === callId) || null;
  }

  function hasSavedTranscript(call = {}) {
    return call.recordEnabled !== false && call.steps?.transcript?.status === 'done';
  }

  function effectiveMode(call = {}) {
    const runtimeMode = String(call.processing?.analysisMode || '').toLowerCase();
    if (runtimeMode === 'deep' || runtimeMode === 'brief') return runtimeMode;
    return String(prefs?.[call.callKey]?.analysisMode || 'brief').toLowerCase() === 'deep' ? 'deep' : 'brief';
  }

  function eligible(call = {}) {
    return call.status === 'DONE'
      && !call.active
      && hasSavedTranscript(call)
      && effectiveMode(call) !== 'deep';
  }

  function inject() {
    queued = false;
    const shadow = rail.shadow;
    if (!shadow) return;
    for (const card of shadow.querySelectorAll('.call-event-card')) {
      const call = callForCard(card);
      const existing = card.querySelector('[data-wb-deep-analysis]');
      if (!call || !eligible(call)) {
        existing?.remove();
        continue;
      }
      if (existing) continue;
      let actions = card.querySelector('.call-event-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'call-event-actions';
        card.appendChild(actions);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'call-event-action';
      button.dataset.wbDeepAnalysis = '1';
      button.dataset.callKey = String(call.callKey || '');
      button.title = 'Повторно использовать уже сохранённый транскрипт: Whisper не запускается';
      button.textContent = 'Глубокий разбор';
      actions.appendChild(button);
    }
  }

  function queueInject() {
    if (queued) return;
    queued = true;
    queueMicrotask(inject);
  }

  async function requestDeep(callKey) {
    const response = await chrome.runtime.sendMessage({
      type: REANALYZE,
      payload: { callKey, analysisMode: 'deep' }
    });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function onClick(event) {
    const button = event.target.closest?.('[data-wb-deep-analysis][data-call-key]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const callKey = String(button.dataset.callKey || '');
    if (!callKey || button.disabled) return;

    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'AI…';
    void requestDeep(callKey)
      .then(async () => {
        prefs[callKey] = { ...(prefs[callKey] || {}), analysisMode: 'deep' };
        rail.toast?.('Глубокий разбор готов. Whisper повторно не запускался.', 3200, 'success');
        await bridge.refresh();
        queueInject();
      })
      .catch(error => {
        rail.toast?.(`Глубокий разбор: ${String(error?.message || error)}`, 4200, 'error');
        button.disabled = false;
        button.textContent = previous;
      });
  }

  function bind() {
    const shadow = rail.shadow;
    if (!shadow || boundShadow === shadow) return;
    if (boundShadow) boundShadow.removeEventListener('click', onClick, true);
    observer?.disconnect();
    boundShadow = shadow;
    shadow.addEventListener('click', onClick, true);
    observer = new MutationObserver(queueInject);
    observer.observe(shadow, { childList: true, subtree: true });
    queueInject();
  }

  const baseSyncAttention = rail.syncAttention.bind(rail);
  rail.syncAttention = function syncAttentionWithAnalysisActions(...args) {
    const result = baseSyncAttention(...args);
    bind();
    queueInject();
    return result;
  };

  const baseDestroy = rail.destroy.bind(rail);
  rail.destroy = function destroyWithAnalysisActions(...args) {
    observer?.disconnect();
    observer = null;
    if (boundShadow) boundShadow.removeEventListener('click', onClick, true);
    boundShadow = null;
    return baseDestroy(...args);
  };

  WB.callAnalysisActions = Object.freeze({
    refresh: async () => {
      await loadPrefs();
      bind();
      queueInject();
    }
  });

  void WB.callAnalysisActions.refresh();
})();
