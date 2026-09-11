(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__operatorCompanionSessionControlsLoaded) return;
  WB.__operatorCompanionSessionControlsLoaded = true;

  const HOST_ID = 'simnet-workbench-operator-companion';
  const STORAGE_KEY = 'simnet_workbench_ai_session_control_v1';
  const SCHEMA = 'simnet-ai-session-control-v1';
  const MAX_RECORDS = 100;

  let observer = null;
  let busy = false;
  let lastStatus = '';

  const nowIso = () => new Date().toISOString();
  const safeText = value => String(value == null ? '' : value).trim();

  function identity() {
    const caseData = WB.store?.activeCase?.() || null;
    const caseId = safeText(caseData?.id);
    const episodeId = safeText(caseData?.episodeId);
    const key = caseId ? `${caseId}::${episodeId || 'episode-current'}` : '__no_case__';
    const label = safeText(
      caseData?.identity?.login?.value
      || caseData?.identity?.contract?.value
      || caseData?.profile?.fullName?.value
      || caseData?.id
      || 'no-case'
    );
    return { caseData, caseId, episodeId, key, label };
  }

  function storageGet() {
    return new Promise(resolve => chrome.storage.local.get(STORAGE_KEY, resolve));
  }

  function storageSet(store) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: store }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else resolve();
      });
    });
  }

  async function readStore() {
    const row = await storageGet();
    const raw = row?.[STORAGE_KEY];
    return raw && typeof raw === 'object'
      ? { schema: SCHEMA, records: { ...(raw.records || {}) } }
      : { schema: SCHEMA, records: {} };
  }

  async function writeRecord(id, patch) {
    const store = await readStore();
    const current = store.records[id.key] || {};
    store.records[id.key] = {
      sessionKey: id.key,
      caseId: id.caseId,
      episodeId: id.episodeId,
      label: id.label,
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    const entries = Object.entries(store.records)
      .sort(([, a], [, b]) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
      .slice(0, MAX_RECORDS);
    store.records = Object.fromEntries(entries);
    await storageSet(store);
    return store.records[id.key];
  }

  async function readRecord(id) {
    const store = await readStore();
    return store.records[id.key] || null;
  }

  function runtimeRequest(type, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, response => {
          const error = chrome.runtime.lastError;
          if (error) return reject(new Error(error.message || String(error)));
          if (!response?.success) return reject(new Error(response?.error || `${type} failed`));
          resolve(response.data || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function slug(value) {
    return safeText(value)
      .toLowerCase()
      .replace(/[^a-zа-я0-9._-]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'session';
  }

  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function shadowRoot() {
    return document.getElementById(HOST_ID)?.shadowRoot || null;
  }

  function setStatus(message) {
    lastStatus = safeText(message);
    const root = shadowRoot();
    const node = root?.querySelector('[data-role="session-control-status"]');
    if (node) node.textContent = lastStatus;
  }

  function ensureStyles(root) {
    if (!root || root.getElementById('simnet-ai-session-control-style')) return;
    const style = document.createElement('style');
    style.id = 'simnet-ai-session-control-style';
    style.textContent = `
      .ai-session-controls{display:flex;align-items:center;gap:5px;padding:6px 9px;border-bottom:1px solid #f0e7eb;background:#fff;flex-wrap:wrap}
      .ai-session-controls button{appearance:none;border:1px solid #dccbd3;background:#fff;color:#6d1538;border-radius:8px;padding:5px 7px;font:600 9px/1.1 Inter,Arial,sans-serif;cursor:pointer}
      .ai-session-controls button:hover{border-color:#a50046;color:#a50046}
      .ai-session-controls button[data-kind="end"]{color:#8f3c3c}
      .ai-session-controls button[disabled]{opacity:.45;cursor:default}
      .ai-session-control-status{margin-left:auto;color:#8d747f;font:9px/1.2 Inter,Arial,sans-serif;white-space:nowrap}
      .ai-session-control-status.ended{color:#8f3c3c}
    `;
    root.appendChild(style);
  }

  async function applyLifecycleState(root) {
    if (!root) return;
    const id = identity();
    const record = await readRecord(id).catch(() => null);
    const ended = record?.status === 'ended';
    const status = root.querySelector('[data-role="session-control-status"]');
    if (status) {
      status.textContent = lastStatus || (ended ? 'сессия завершена' : 'сессия активна');
      status.classList.toggle('ended', ended);
    }

    const input = root.querySelector('[data-role="input"]');
    const send = root.querySelector('[data-action="send"]');
    if (ended) {
      if (input) {
        input.disabled = true;
        input.placeholder = 'Сессия завершена. Начните новую.';
      }
      if (send) send.disabled = true;
    }

    const endButton = root.querySelector('[data-session-action="end"]');
    if (endButton) endButton.disabled = ended || busy;
    const startButton = root.querySelector('[data-session-action="start"]');
    const exportButton = root.querySelector('[data-session-action="export"]');
    if (startButton) startButton.disabled = busy;
    if (exportButton) exportButton.disabled = busy;
  }

  function ensureControls() {
    const root = shadowRoot();
    const panel = root?.querySelector('.panel');
    const context = root?.querySelector('.context');
    if (!root || !panel || !context) return;

    ensureStyles(root);
    const legacyReset = root.querySelector('[data-action="reset"]');
    if (legacyReset) legacyReset.style.display = 'none';

    let controls = root.querySelector('[data-role="session-controls"]');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'ai-session-controls';
      controls.dataset.role = 'session-controls';
      controls.innerHTML = `
        <button type="button" data-session-action="start">Начать сессию</button>
        <button type="button" data-session-action="end" data-kind="end">Завершить сессию</button>
        <button type="button" data-session-action="export">Выгрузить сессию</button>
        <span class="ai-session-control-status" data-role="session-control-status"></span>
      `;
      context.insertAdjacentElement('afterend', controls);
    }
    void applyLifecycleState(root);
  }

  async function startSession() {
    if (busy) return;
    busy = true;
    const id = identity();
    setStatus('начинаю…');
    ensureControls();
    try {
      if (typeof WB.operatorCompanion?.reset === 'function') await WB.operatorCompanion.reset();
      await writeRecord(id, {
        status: 'active',
        startedAt: nowIso(),
        endedAt: '',
        sessionId: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      });
      setStatus('сессия активна');
    } catch (error) {
      setStatus(`ошибка старта: ${safeText(error?.message || error)}`);
    } finally {
      busy = false;
      ensureControls();
    }
  }

  async function endSession() {
    if (busy) return;
    busy = true;
    const id = identity();
    setStatus('завершаю…');
    try {
      const existing = await readRecord(id);
      await writeRecord(id, {
        status: 'ended',
        startedAt: existing?.startedAt || nowIso(),
        sessionId: existing?.sessionId || `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        endedAt: nowIso()
      });
      setStatus('сессия завершена');
    } catch (error) {
      setStatus(`ошибка завершения: ${safeText(error?.message || error)}`);
    } finally {
      busy = false;
      ensureControls();
    }
  }

  async function exportSession() {
    if (busy) return;
    busy = true;
    const id = identity();
    setStatus('выгружаю…');
    try {
      const [session, record] = await Promise.all([
        runtimeRequest('AI_CHAT_STATE_GET', { caseId: id.caseId, episodeId: id.episodeId }),
        readRecord(id)
      ]);
      const exportedAt = nowIso();
      const payload = {
        schema: 'simnet-ai-dialog-export-v1',
        exportedAt,
        identity: {
          caseId: id.caseId,
          episodeId: id.episodeId,
          sessionKey: id.key,
          label: id.label
        },
        lifecycle: record || {
          status: 'active',
          startedAt: '',
          endedAt: '',
          sessionId: ''
        },
        session
      };
      const stamp = exportedAt.replace(/[:.]/g, '-');
      downloadJson(`simnet-ai-session-${slug(id.label)}-${stamp}.json`, payload);
      setStatus(`выгружено · ${Array.isArray(session?.messages) ? session.messages.length : 0} сообщ.`);
    } catch (error) {
      setStatus(`ошибка выгрузки: ${safeText(error?.message || error)}`);
    } finally {
      busy = false;
      ensureControls();
    }
  }

  function handleClick(event) {
    const button = event.composedPath?.().find(node => node?.dataset?.sessionAction);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = safeText(button.dataset.sessionAction);
    if (action === 'start') return void startSession();
    if (action === 'end') return void endSession();
    if (action === 'export') return void exportSession();
  }

  function mount() {
    const root = shadowRoot();
    const panel = root?.querySelector('.panel');
    if (!root || !panel) return false;
    ensureControls();
    root.addEventListener('click', handleClick, true);
    observer = new MutationObserver(() => ensureControls());
    observer.observe(panel, { childList: true, subtree: true });
    return true;
  }

  if (!mount()) {
    queueMicrotask(() => {
      if (!mount()) {
        window.addEventListener('simnet-workbench-module-open', () => {
          if (!observer) mount();
          else ensureControls();
        });
      }
    });
  }
})();
