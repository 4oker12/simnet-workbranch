const statusNode = document.getElementById('status');
const contextNode = document.getElementById('context');
const versionNode = document.getElementById('version');
const exportNode = document.getElementById('exportDiag');
const diagnosticsNode = document.getElementById('diagnostics');
const clearWorkbenchNode = document.getElementById('clearWorkbench');
const diagCountNode = document.getElementById('diagCount');
const workerDot = document.getElementById('workerDot');
const VERSION = chrome.runtime.getManifest().version;
const DIAG_KEY = 'simnet_workbench_diagnostics_v1';
const FALLBACK_KEY = 'simnet_workbench_diagnostics_fallback_v1';
const STATE_KEY = 'simnet_workbench_state_v5';
versionNode.textContent = `v${VERSION}`;

const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const short = (value, max = 260) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

async function readDirect() {
  const stored = await chrome.storage.local.get([DIAG_KEY, FALLBACK_KEY, STATE_KEY]);
  const primary = stored?.[DIAG_KEY] && typeof stored[DIAG_KEY] === 'object' ? stored[DIAG_KEY] : { entries: [], unreadCount: 0 };
  const fallback = Array.isArray(stored?.[FALLBACK_KEY]) ? stored[FALLBACK_KEY] : [];
  const entries = [...fallback.map(item => ({ ...item, emergencyFallback: true, unread: true })), ...(Array.isArray(primary.entries) ? primary.entries : [])].slice(0, 200);
  return { primary, fallback, entries, state: stored?.[STATE_KEY] || null };
}

function renderDiagnostics(data) {
  const entries = data.entries || [];
  const unread = entries.filter(item => item.unread !== false).length;
  diagCountNode.textContent = unread > 99 ? '99+' : String(unread);
  if (!entries.length) {
    diagnosticsNode.innerHTML = '<div class="empty">Записанных ошибок нет.</div>';
    return;
  }
  diagnosticsNode.innerHTML = entries.slice(0, 12).map(entry => `
    <div class="diag-item ${esc(String(entry.severity || 'ERROR').toLowerCase())}">
      <div class="diag-code">${esc(entry.code || 'WORKBENCH_FAILURE')}${Number(entry.count || 1) > 1 ? ` <span>×${Number(entry.count || 1)}</span>` : ''}</div>
      <div class="diag-msg">${esc(short(entry.message || entry.reason || ''))}</div>
      <div class="diag-meta">${esc(entry.lastSeenAt || entry.timestamp || entry.firstSeenAt || '')}${entry.subscriber ? ` · ${esc(entry.subscriber)}` : ''}${entry.emergencyFallback ? ' · fallback' : ''}</div>
    </div>`).join('');
}

async function probeWorker() {
  try {
    const ping = await Promise.race([
      chrome.runtime.sendMessage({ type: 'PING' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PING timeout')), 2500))
    ]);
    if (!ping?.success) throw new Error(ping?.error || 'Service Worker не ответил');
    statusNode.textContent = `Service Worker отвечает · v${ping.data.version}`;
    statusNode.className = 'ok';
    workerDot.className = 'dot ok';
    return true;
  } catch (error) {
    statusNode.textContent = `Service Worker НЕ отвечает · ${short(error?.message || error, 100)}`;
    statusNode.className = 'bad';
    workerDot.className = 'dot bad';
    return false;
  }
}

async function load() {
  const [direct] = await Promise.all([readDirect(), probeWorker()]);
  renderDiagnostics(direct);
  const state = direct.state;
  const active = state?.cases?.[state?.activeCaseId];
  contextNode.textContent = active ? JSON.stringify({
    caseId: active.id,
    context: active.currentContext,
    identity: active.identity
  }, null, 2) : 'Активный Case ещё не создан.';
}

exportNode.addEventListener('click', async () => {
  const direct = await readDirect();
  const active = direct.state?.cases?.[direct.state?.activeCaseId] || null;
  const bundle = {
    schema: 'simnet-workbench-emergency-export-v1',
    workbenchVersion: VERSION,
    exportedAt: new Date().toISOString(),
    activeCaseId: String(direct.state?.activeCaseId || ''),
    activeCase: active ? {
      caseId: String(active.id || ''),
      login: String(active?.identity?.login?.value || active?.identity?.login || ''),
      contract: String(active?.identity?.contract?.value || active?.identity?.contract || ''),
      currentContext: active?.currentContext ? {
        system: String(active.currentContext.system || ''),
        pageKind: String(active.currentContext.pageKind || ''),
        entityId: String(active.currentContext.entityId || '')
      } : null
    } : null,
    diagnostics: direct.primary,
    emergencyFallback: direct.fallback
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `simnet-workbench-emergency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function deleteAuditDbDirect() {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise(resolve => {
    try {
      const request = indexedDB.deleteDatabase('SIMNET_WORKBENCH_DATA_AUDIT_DB');
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch { resolve(false); }
  });
}

async function emergencyClearWorkbench() {
  try { await chrome.storage.local.clear(); } catch {}
  try { await chrome.storage.session?.clear?.(); } catch {}
  await deleteAuditDbDirect();
}

clearWorkbenchNode?.addEventListener('click', async () => {
  if (!confirm('Полностью очистить данные Workbench?\n\nCase, CALL evidence/snapshots, AI-сессии, CRM-кэш и Audit DB будут удалены. Cookies и авторизация UserSide/Billing не затрагиваются.')) return;
  clearWorkbenchNode.disabled = true;
  clearWorkbenchNode.textContent = 'Очищаю…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'WORKBENCH_DATA_CLEAR', payload: { scope: 'all' } });
    if (!response?.success) throw new Error(response?.error || 'Service Worker не выполнил сброс');
    statusNode.textContent = 'Данные Workbench очищены. Открытые CRM-вкладки можно продолжать использовать; при странном UI обновите страницу.';
    statusNode.className = 'ok';
  } catch (error) {
    await emergencyClearWorkbench();
    statusNode.textContent = `Service Worker недоступен — локальное хранилище WB очищено напрямую. ${short(error?.message || error, 90)}`;
    statusNode.className = 'bad';
  } finally {
    clearWorkbenchNode.textContent = 'Сброс данных WB';
    clearWorkbenchNode.disabled = false;
    await load().catch(() => {});
  }
});

load().catch(error => {
  statusNode.textContent = `Ошибка popup · ${error?.message || error}`;
  statusNode.className = 'bad';
});
