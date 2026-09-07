(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.callConsoleDiagnostics || window.top !== window.self) return;

  const LIST = 'CALL_PROCESSING_LIST';
  const CHANGED = 'CALL_PROCESSING_CHANGED';
  const seen = new Map();
  let refreshPromise = null;
  let destroyed = false;

  const problemStatuses = new Set([
    'WAIT_PBX',
    'WAIT_TRANSCRIBER',
    'WAIT_TASK_ID',
    'USERSIDE_REVIEW',
    'USERSIDE_ERROR',
    'PBX_ERROR',
    'ERROR',
    'STALE'
  ]);

  function clean(value, max = 700) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function stageMeta(call = {}) {
    const stage = String(call.processing?.stage || '');
    const id = String(call.pbxRecordId || '');
    const table = {
      pbx: {
        functionName: 'parseUsersideCallListHtml() → attachPbx()',
        operation: 'GET https://userside.simnet.kiev.ua/message/call_list'
      },
      audio: {
        functionName: 'processCall()/processManual() → transcribeRecord()',
        operation: id
          ? `GET https://pbx.simnet.kiev.ua/fop2/getrec.php?id=${id}`
          : 'GET PBX getrec.php'
      },
      whisper: {
        functionName: 'transcribeRecord()',
        operation: 'POST http://127.0.0.1:8090/transcribe'
      },
      ai: {
        functionName: 'postprocessTranscript()',
        operation: 'POST Groq chat/completions'
      },
      userside: {
        functionName: 'processUsersideWrite() → writeTranscriptToUserSide()',
        operation: 'UserSide writeback'
      }
    };
    return table[stage] || {
      functionName: 'CallRecord processing pipeline',
      operation: 'внутренний вызов Workbench'
    };
  }

  function titleOf(call = {}) {
    const status = String(call.status || '');
    const stage = String(call.processing?.stage || '');
    if (status === 'WAIT_PBX') return 'PBX recordId не найден';
    if (status === 'WAIT_TRANSCRIBER') return 'Транскрипция не состоялась: transcriber недоступен';
    if (status === 'PBX_ERROR') return 'Не удалось получить PBX-аудио';
    if (status === 'USERSIDE_ERROR') return 'Не удалось записать результат в UserSide';
    if (status === 'WAIT_TASK_ID') return 'Не найдено обращение UserSide для записи результата';
    if (status === 'USERSIDE_REVIEW') return 'Запись в UserSide требует проверки';
    if (status === 'STALE') return 'Цепочка обработки была прервана';
    if (status === 'ERROR' && stage === 'whisper') return 'Транскрипция завершилась ошибкой';
    if (status === 'ERROR' && stage === 'ai') return 'AI-разбор завершился ошибкой';
    if (status === 'ERROR') return 'Ошибка обработки звонка';
    return `Проблема обработки: ${status || 'unknown'}`;
  }

  function shouldReport(call = {}) {
    const status = String(call.status || '');
    if (!problemStatuses.has(status)) return false;
    if (status === 'WAIT_PBX') return Boolean(call.needsAttention);
    return Boolean(call.needsAttention || call.error || ['PBX_ERROR', 'USERSIDE_ERROR', 'ERROR', 'STALE', 'WAIT_TRANSCRIBER'].includes(status));
  }

  function detailsOf(call = {}) {
    const meta = stageMeta(call);
    return {
      callKey: String(call.callKey || ''),
      usersideCallId: String(call.usersideCallId || ''),
      pbxRecordId: String(call.pbxRecordId || ''),
      customerId: String(call.customerId || ''),
      status: String(call.status || ''),
      stage: String(call.processing?.stage || ''),
      function: meta.functionName,
      operation: meta.operation,
      reason: clean(call.error || (call.status === 'WAIT_PBX'
        ? `PBX recordId не появился за ${Number(call.waitSeconds || 0)} сек.`
        : ''), 1000),
      lastSuccessfulStage: String(call.processing?.lastSuccessfulStage || ''),
      owner: String(call.processing?.owner || ''),
      attempts: Number(call.attempts || call.processing?.attempts || 0),
      updatedAt: String(call.updatedAt || ''),
      waitSeconds: Number(call.waitSeconds || 0)
    };
  }

  function signatureOf(call = {}) {
    const d = detailsOf(call);
    return JSON.stringify([
      d.status,
      d.stage,
      d.reason,
      d.lastSuccessfulStage,
      d.attempts,
      d.pbxRecordId,
      d.updatedAt
    ]);
  }

  function report(call = {}) {
    if (!shouldReport(call)) return;
    const key = String(call.callKey || call.usersideCallId || call.pbxRecordId || 'unknown');
    const signature = signatureOf(call);
    if (seen.get(key) === signature) return;
    seen.set(key, signature);

    const details = detailsOf(call);
    WB.log?.error?.('CALL', titleOf(call), details);
  }

  async function requestList() {
    const response = await chrome.runtime.sendMessage({ type: LIST, payload: {} });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return Array.isArray(response.data) ? response.data : [];
  }

  async function refresh(reason = 'event') {
    if (destroyed) return [];
    if (refreshPromise) return refreshPromise;
    refreshPromise = requestList()
      .then(calls => {
        for (const call of calls) report(call);
        const liveKeys = new Set(calls.map(call => String(call?.callKey || '')).filter(Boolean));
        for (const key of [...seen.keys()]) {
          if (!liveKeys.has(key)) seen.delete(key);
        }
        return calls;
      })
      .catch(error => {
        WB.log?.error?.('CALL', 'Не удалось прочитать состояние обработки звонков', {
          reason,
          function: 'call-console-diagnostics.refresh()',
          operation: 'chrome.runtime.sendMessage(CALL_PROCESSING_LIST)',
          error: clean(error?.message || error, 1000)
        });
        return [];
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function onMessage(message) {
    if (message?.type !== CHANGED) return false;
    queueMicrotask(() => void refresh('CALL_PROCESSING_CHANGED'));
    return false;
  }

  chrome.runtime.onMessage.addListener(onMessage);

  WB.callConsoleDiagnostics = Object.freeze({
    refresh: () => refresh('manual'),
    destroy() {
      destroyed = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      seen.clear();
    }
  });

  queueMicrotask(() => void refresh('startup'));
})();
