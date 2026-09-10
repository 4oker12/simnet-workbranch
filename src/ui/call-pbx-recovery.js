(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.callPbxRecovery || window.top !== window.self || location.hostname !== 'userside.simnet.kiev.ua') return;

  const LIST = 'CALL_PROCESSING_LIST';
  const RETRY = 'CALL_PROCESSING_RETRY';
  const REFRESH = 'PBX_RECENT_CALLS_QUERY';
  const CHANGED = 'CALL_PROCESSING_CHANGED';

  const MAX_ATTEMPTS = 6;
  const RETRY_DELAYS_MS = Object.freeze([0, 1200, 2500, 5000, 9000, 15000]);

  const attempts = new Map();
  let running = false;
  let timer = 0;
  let destroyed = false;

  async function request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function callKeyOf(call = {}) {
    return String(call.callKey || '');
  }

  function needsPbx(call = {}) {
    return Boolean(
      callKeyOf(call)
      && call.usersideCallId
      && call.registeredAt
      && call.status === 'WAIT_PBX'
      && !call.pbxRecordId
      && !call.active
    );
  }

  function nextDelayFor(pending = []) {
    const delays = pending.map(call => {
      const count = Math.max(0, Number(attempts.get(callKeyOf(call)) || 0));
      return RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length - 1)];
    });
    return delays.length ? Math.max(250, Math.min(...delays)) : 0;
  }

  function clearSchedule() {
    clearTimeout(timer);
    timer = 0;
  }

  function schedule(reason = 'event', delay = 0) {
    if (destroyed || timer) return;
    timer = setTimeout(() => {
      timer = 0;
      void recover(reason);
    }, Math.max(0, Number(delay) || 0));
  }

  async function recover(reason = 'event') {
    if (destroyed || running) return;
    running = true;
    try {
      const before = await request(LIST);
      const pending = (Array.isArray(before) ? before : []).filter(needsPbx);
      if (!pending.length) {
        clearSchedule();
        attempts.clear();
        return;
      }

      const eligible = pending.filter(call => Number(attempts.get(callKeyOf(call)) || 0) < MAX_ATTEMPTS);
      if (!eligible.length) return;

      WB.log?.info?.('CALL', 'PBX recovery: обновляем UserSide call_list', {
        reason,
        calls: eligible.map(call => call.usersideCallId).slice(0, 8)
      });

      // Authoritative source: server-rendered UserSide /message/call_list.
      // Its same <tr> contains both identifiers:
      //   loadRecordFile(<UserSide CALL id>, '...getrec.php?id=<PBX recordId>')
      await request(REFRESH, {
        fresh: true,
        forceRefresh: true,
        reason: 'wait-pbx-recovery'
      });

      const after = await request(LIST);
      const rows = Array.isArray(after) ? after : [];
      const byKey = new Map(rows.map(call => [callKeyOf(call), call]));

      for (const previous of eligible) {
        const key = callKeyOf(previous);
        const current = byKey.get(key);
        if (current?.pbxRecordId) {
          attempts.delete(key);
          WB.log?.info?.('CALL', 'PBX recovery: recordId найден', {
            usersideCallId: current.usersideCallId,
            pbxRecordId: current.pbxRecordId
          });
          await request(RETRY, { callKey: key });
          continue;
        }
        attempts.set(key, Number(attempts.get(key) || 0) + 1);
      }

      const latest = await request(LIST);
      const stillPending = (Array.isArray(latest) ? latest : [])
        .filter(needsPbx)
        .filter(call => Number(attempts.get(callKeyOf(call)) || 0) < MAX_ATTEMPTS);

      if (stillPending.length) {
        schedule('bounded-retry', nextDelayFor(stillPending));
      }
    } catch (error) {
      console.warn('[SIMNET WB][CALL PBX RECOVERY] failed', error);
      const fallback = [...attempts.values()].length
        ? RETRY_DELAYS_MS[Math.min(Math.max(...attempts.values()), RETRY_DELAYS_MS.length - 1)]
        : 2500;
      schedule('error-retry', fallback);
    } finally {
      running = false;
    }
  }

  function onRuntimeMessage(message) {
    if (message?.type !== CHANGED) return false;
    schedule('processing-changed', 150);
    return false;
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  WB.callPbxRecovery = Object.freeze({
    recover: () => recover('manual'),
    status: () => ({
      running,
      scheduled: Boolean(timer),
      attempts: Object.fromEntries(attempts)
    })
  });

  // One bounded initial pass repairs calls that were already stuck before
  // this content script was loaded/reloaded.
  schedule('startup', 250);
})();
