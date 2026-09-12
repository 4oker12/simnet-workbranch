(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'userside.simnet.kiev.ua') return;

  const EVENT_NAME = 'simnet-wb-native-pbx-state';
  const DATASET_KEY = 'simnetWbNativePbxState';
  const STORAGE_KEY = 'simnet_call_active_6047_v1';
  const WRITE_THROTTLE_MS = 3000;
  let lastSignature = '';
  let lastWriteAt = 0;

  function parseState() {
    try {
      const raw = document.documentElement?.dataset?.[DATASET_KEY] || '';
      const value = JSON.parse(raw);
      if (!value || value.schema !== 'simnet-wb-native-pbx-state-v1') return null;
      if (String(value.agentExtension || '') !== '6047') return null;
      return {
        schema: 'simnet-wb-native-pbx-state-v1',
        active: value.active === true,
        agentExtension: '6047',
        talkStartMs: Math.max(0, Number(value.talkStartMs || 0)),
        lastCallEndMs: Math.max(0, Number(value.lastCallEndMs || 0)),
        observedAtMs: Math.max(0, Number(value.observedAtMs || Date.now())),
        source: 'userside-native-widget'
      };
    } catch { return null; }
  }

  function persist() {
    const state = parseState();
    if (!state) return;
    const signature = [state.active ? 1 : 0, state.talkStartMs, state.lastCallEndMs].join(':');
    const now = Date.now();
    if (signature === lastSignature && now - lastWriteAt < WRITE_THROTTLE_MS) return;
    lastSignature = signature;
    lastWriteAt = now;
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch {}
  }

  document.documentElement?.addEventListener(EVENT_NAME, persist);
  persist();

  window.addEventListener('pagehide', () => {
    document.documentElement?.removeEventListener(EVENT_NAME, persist);
  }, { once: true });
})();
