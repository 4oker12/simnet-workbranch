const statusNode = document.getElementById('status');
const contextNode = document.getElementById('context');
const versionNode = document.getElementById('version');
const exportNode = document.getElementById('exportDiag');
const diagnosticsNode = document.getElementById('diagnostics');
const clearWorkbenchNode = document.getElementById('clearWorkbench');
const diagCountNode = document.getElementById('diagCount');
const workerDot = document.getElementById('workerDot');
const groqKeyStatusNode = document.getElementById('groqKeyStatus');
const groqKeyBadgeNode = document.getElementById('groqKeyBadge');
const openSettingsNode = document.getElementById('openSettings');
const perfBadgeNode = document.getElementById('perfBadge');
const perfStatusNode = document.getElementById('perfStatus');
const perfProgressNode = document.getElementById('perfProgress');
const perfReportNode = document.getElementById('perfReport');
const startPerfNode = document.getElementById('startPerf');
const finishPerfNode = document.getElementById('finishPerf');
const exportPerfNode = document.getElementById('exportPerf');
const VERSION = chrome.runtime.getManifest().version;
const DIAG_KEY = 'simnet_workbench_diagnostics_v1';
const FALLBACK_KEY = 'simnet_workbench_diagnostics_fallback_v1';
const STATE_KEY = 'simnet_workbench_state_v5';
const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const PERF_CONTROL_KEY = 'simnet_workbench_performance_control_v1';
const PERF_SESSION_DURATION_MS = 30 * 60 * 1000;
const CRM_TAB_URLS = [
  'https://userside.simnet.kiev.ua/*',
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
];
let currentPerformanceSession = null;
let performanceRefreshTimer = null;
versionNode.textContent = `v${VERSION}`;

const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const short = (value, max = 260) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

async function readDirect() {
  const stored = await chrome.storage.local.get([DIAG_KEY, FALLBACK_KEY, STATE_KEY, AI_RUNTIME_CONFIG_KEY]);
  const primary = stored?.[DIAG_KEY] && typeof stored[DIAG_KEY] === 'object' ? stored[DIAG_KEY] : { entries: [], unreadCount: 0 };
  const fallback = Array.isArray(stored?.[FALLBACK_KEY]) ? stored[FALLBACK_KEY] : [];
  const entries = [...fallback.map(item => ({ ...item, emergencyFallback: true, unread: true })), ...(Array.isArray(primary.entries) ? primary.entries : [])].slice(0, 200);
  return {
    primary,
    fallback,
    entries,
    state: stored?.[STATE_KEY] || null,
    aiRuntime: stored?.[AI_RUNTIME_CONFIG_KEY] || null
  };
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

function renderAiStatus(aiRuntime) {
  const configured = Boolean(String(aiRuntime?.groqApiKey || '').trim());
  groqKeyStatusNode.textContent = configured
    ? 'Ключ настроен локально. AI-помощник и разбор звонков могут использовать Groq.'
    : 'Ключ не настроен. Whisper продолжит работать, AI-разбор остановится на TXT.';
  groqKeyStatusNode.className = configured ? 'ai-state ok' : 'ai-state';
  groqKeyBadgeNode.textContent = configured ? 'OK' : 'нет ключа';
  groqKeyBadgeNode.className = configured ? 'mini-badge ok' : 'mini-badge';
}

async function runtimeRequest(type, payload = {}) {
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type, payload }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${type} timeout`)), 5000))
  ]);
  if (!response?.success) throw new Error(response?.error || `${type} failed`);
  return response.data;
}

function durationText(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const tail = seconds % 60;
  return minutes ? `${minutes} мин ${tail ? `${tail} с` : ''}`.trim() : `${tail} с`;
}

function metricValue(value, unit) {
  if (!Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (unit === 'bytes') return `${(number / (1024 * 1024)).toFixed(number >= 100 * 1024 * 1024 ? 0 : 1)} МБ`;
  if (unit === 'count') return Math.round(number).toLocaleString('ru-RU');
  if (unit === 'per_min') return `${number.toFixed(1)}/мин`;
  if (unit === 'ms' && number >= 1000) return `${(number / 1000).toFixed(2)} с`;
  return `${Math.round(number)} мс`;
}

function verdictText(verdict) {
  if (verdict === 'degraded') return 'Есть заметная деградация';
  if (verdict === 'watch') return 'Есть один растущий показатель';
  if (verdict === 'stable') return 'Скорость остаётся стабильной';
  return 'Пока мало данных для сравнения';
}

function renderPerformanceReport(report = null) {
  if (!report) {
    perfReportNode.hidden = true;
    perfReportNode.innerHTML = '';
    return;
  }
  const visibleKeys = new Set([
    'navigation.load',
    'resource.average',
    'workbench.ready',
    'memory.used',
    'storage.used',
    'dom.nodes',
    'runtime.long_tasks'
  ]);
  const metrics = (report.metrics || [])
    .filter(metric => visibleKeys.has(metric.key) && metric.state !== 'unknown')
    .slice(0, 6);
  const route = (report.routes || []).find(item => item.currentAvgMs != null) || report.routes?.[0] || null;
  const pageRoute = (report.pageRoutes || []).find(item => item.currentAvgMs != null) || report.pageRoutes?.[0] || null;
  const operation = (report.operations || []).find(item => item.currentAvgMs != null) || null;
  const confidence = report.confidence === 'high' ? 'высокая' : report.confidence === 'medium' ? 'средняя' : 'низкая';
  perfReportNode.innerHTML = `
    <div class="perf-verdict ${esc(report.verdict || 'insufficient')}">${esc(verdictText(report.verdict))} · уверенность ${confidence}</div>
    ${metrics.map(metric => {
      const delta = metric.deltaPercent != null && Number.isFinite(Number(metric.deltaPercent))
        ? ` (${metric.deltaPercent > 0 ? '+' : ''}${Math.round(metric.deltaPercent)}%)`
        : '';
      return `<div class="perf-metric" data-state="${esc(metric.state)}"><span>${esc(metric.label)}</span><b>${esc(metricValue(metric.baseline, metric.unit))} → ${esc(metricValue(metric.current, metric.unit))}${esc(delta)}</b></div>`;
    }).join('')}
    ${pageRoute ? `<div class="perf-route">Страница: <b>${esc(pageRoute.route)}</b> · ${esc(metricValue(pageRoute.currentAvgMs ?? pageRoute.maxMs, 'ms'))}${pageRoute.deltaPercent != null && Number.isFinite(Number(pageRoute.deltaPercent)) ? ` · ${pageRoute.deltaPercent > 0 ? '+' : ''}${Math.round(pageRoute.deltaPercent)}%` : ''}</div>` : ''}
    ${route ? `<div class="perf-route">Запрос: <b>${esc(route.route)}</b> · ${esc(metricValue(route.currentAvgMs ?? route.maxMs, 'ms'))}${route.deltaPercent != null && Number.isFinite(Number(route.deltaPercent)) ? ` · ${route.deltaPercent > 0 ? '+' : ''}${Math.round(route.deltaPercent)}%` : ''}</div>` : ''}
    ${operation ? `<div class="perf-route">Операция Workbench: <b>${esc(operation.metric)}</b> · ${esc(metricValue(operation.currentAvgMs, 'ms'))}${operation.deltaPercent != null && Number.isFinite(Number(operation.deltaPercent)) ? ` · ${operation.deltaPercent > 0 ? '+' : ''}${Math.round(operation.deltaPercent)}%` : ''}</div>` : ''}
  `;
  perfReportNode.hidden = false;
}

function renderPerformanceSession(session = null) {
  currentPerformanceSession = session;
  const status = session?.status || 'idle';
  if (status === 'active') {
    const elapsed = Number(session.elapsedMs || 0);
    const target = Math.max(1, Number(session.targetDurationMs || PERF_SESSION_DURATION_MS));
    perfBadgeNode.textContent = 'идёт';
    perfBadgeNode.className = 'mini-badge running';
    perfStatusNode.textContent = `Прошло ${durationText(elapsed)} · точек ${Number(session.sampleCount || 0)}. Срез уже можно снять.`;
    perfProgressNode.style.width = `${Math.max(1, Math.min(100, (elapsed / target) * 100))}%`;
    startPerfNode.hidden = true;
    finishPerfNode.hidden = false;
    exportPerfNode.hidden = true;
    renderPerformanceReport(null);
    schedulePerformanceRefresh();
    return;
  }

  if (status === 'completed') {
    const report = session.report || null;
    const verdict = report?.verdict || 'insufficient';
    perfBadgeNode.textContent = verdict === 'stable' ? 'стабильно' : verdict === 'degraded' ? 'медленнее' : verdict === 'watch' ? 'проверить' : 'мало данных';
    perfBadgeNode.className = `mini-badge ${verdict === 'stable' ? 'ok' : verdict === 'degraded' ? 'bad' : verdict === 'watch' ? 'warn' : ''}`.trim();
    perfStatusNode.textContent = `Срез за ${durationText(report?.durationMs || session.elapsedMs)} · точек ${Number(report?.sampleCount || session.sampleCount || 0)} · страниц ${Number(report?.pageLoadCount || 0)} · запросов ${Number(report?.resourceRequestCount || 0)}.`;
    perfProgressNode.style.width = '100%';
    startPerfNode.textContent = 'Новый замер · 30 мин';
    startPerfNode.hidden = false;
    finishPerfNode.hidden = true;
    exportPerfNode.hidden = false;
    renderPerformanceReport(report);
    schedulePerformanceRefresh();
    return;
  }

  perfBadgeNode.textContent = 'не запущен';
  perfBadgeNode.className = 'mini-badge';
  perfStatusNode.textContent = 'Можно запустить фоновый замер на время обычной работы.';
  perfProgressNode.style.width = '0%';
  startPerfNode.textContent = 'Начать · 30 мин';
  startPerfNode.hidden = false;
  finishPerfNode.hidden = true;
  exportPerfNode.hidden = true;
  renderPerformanceReport(null);
  schedulePerformanceRefresh();
}

function schedulePerformanceRefresh() {
  clearTimeout(performanceRefreshTimer);
  performanceRefreshTimer = null;
  if (currentPerformanceSession?.status !== 'active') return;
  performanceRefreshTimer = setTimeout(() => {
    performanceRefreshTimer = null;
    void refreshPerformanceSession();
  }, 5000);
}

async function refreshPerformanceSession() {
  try {
    const session = await runtimeRequest('PERF_SESSION_STATUS');
    renderPerformanceSession(session);
    return session;
  } catch (error) {
    perfBadgeNode.textContent = 'недоступно';
    perfBadgeNode.className = 'mini-badge bad';
    perfStatusNode.textContent = `Не удалось прочитать замер: ${short(error?.message || error, 100)}`;
    return null;
  }
}

async function flushActivePerformanceTabs() {
  const tabs = await chrome.tabs.query({ active: true, url: CRM_TAB_URLS });
  await Promise.allSettled(tabs.map(tab => (
    tab.id == null
      ? Promise.resolve()
      : chrome.tabs.sendMessage(tab.id, { type: 'PERF_SESSION_FLUSH' })
  )));
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [direct] = await Promise.all([readDirect(), probeWorker(), refreshPerformanceSession()]);
  renderDiagnostics(direct);
  renderAiStatus(direct.aiRuntime);
  const state = direct.state;
  const active = state?.cases?.[state?.activeCaseId];
  contextNode.textContent = active ? JSON.stringify({
    caseId: active.id,
    context: active.currentContext,
    identity: active.identity
  }, null, 2) : 'Активный Case ещё не создан.';
}

openSettingsNode?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

startPerfNode?.addEventListener('click', async () => {
  if (currentPerformanceSession?.status === 'completed' && !confirm('Начать новый замер? Предыдущий срез будет заменён. При необходимости сначала скачай его JSON.')) return;
  startPerfNode.disabled = true;
  try {
    const session = await runtimeRequest('PERF_SESSION_START', { durationMs: PERF_SESSION_DURATION_MS });
    renderPerformanceSession(session);
  } catch (error) {
    perfStatusNode.textContent = `Не удалось начать замер: ${short(error?.message || error, 100)}`;
  } finally {
    startPerfNode.disabled = false;
  }
});

finishPerfNode?.addEventListener('click', async () => {
  finishPerfNode.disabled = true;
  finishPerfNode.textContent = 'Снимаю…';
  try {
    await flushActivePerformanceTabs();
    const session = await runtimeRequest('PERF_SESSION_FINISH');
    renderPerformanceSession(session);
  } catch (error) {
    perfStatusNode.textContent = `Не удалось снять срез: ${short(error?.message || error, 100)}`;
  } finally {
    finishPerfNode.disabled = false;
    finishPerfNode.textContent = 'Снять срез сейчас';
  }
});

exportPerfNode?.addEventListener('click', async () => {
  exportPerfNode.disabled = true;
  try {
    const session = await runtimeRequest('PERF_SESSION_EXPORT');
    if (!session?.id) throw new Error('Нет сохранённого среза');
    downloadJson(session, `simnet-workbench-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  } catch (error) {
    perfStatusNode.textContent = `Экспорт не выполнен: ${short(error?.message || error, 100)}`;
  } finally {
    exportPerfNode.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes?.[AI_RUNTIME_CONFIG_KEY]) renderAiStatus(changes[AI_RUNTIME_CONFIG_KEY].newValue || {});
  if (changes?.[PERF_CONTROL_KEY]) void refreshPerformanceSession();
});

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
  if (!confirm('Полностью очистить данные Workbench?\n\nCase, CALL evidence/snapshots, AI-сессии, CRM-кэш, локальный Groq key и Audit DB будут удалены. Cookies и авторизация UserSide/Billing не затрагиваются.')) return;
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

window.addEventListener('pagehide', () => clearTimeout(performanceRefreshTimer), { once: true });
