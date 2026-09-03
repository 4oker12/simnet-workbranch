const PARENT_ORIGIN = (() => {
  try {
    const requested = new URL(location.href).searchParams.get('parentOrigin') || '';
    const parsed = new URL(requested);
    if (!['https:'].includes(parsed.protocol)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
})();

const DB_NAME = 'SIMNET_WORKBENCH_DATA_AUDIT_DB';
const DB_VERSION = 2;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_AUDIT_LOGS = 1000;
const RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_AUDIT_RUNS = 250;
const GROUP_COLORS = ['blue', 'green', 'purple', 'amber', 'red'];

const FIELD_DEFS = {
  'billing.connectionFamily': { label: 'Billing · Технология', source: 'billing' },
  'billing.olt': { label: 'Billing · OLT', source: 'billing' },
  'billing.onuSerial': { label: 'Billing · ONU Serial', source: 'billing' },
  'billing.onuMac': { label: 'Billing · ONU MAC', source: 'billing' },
  'billing.subscriberMac': { label: 'Billing · MAC абонента', source: 'billing' },
  'tmc.olt': { label: 'ТМЦ · OLT', source: 'tmc' },
  'tmc.onuSerial': { label: 'ТМЦ · ONU Serial', source: 'tmc' },
  'tmc.onuMac': { label: 'ТМЦ · ONU MAC', source: 'tmc' },
  'tmc.interface': { label: 'ТМЦ · Interface', source: 'tmc' }
};

const OP_DEFS = {
  not_empty: { label: 'заполнено', needsValue: false },
  empty: { label: 'пусто', needsValue: false },
  eq: { label: 'равно', needsValue: true },
  neq: { label: 'не равно', needsValue: true },
  contains: { label: 'содержит', needsValue: true },
  not_contains: { label: 'не содержит', needsValue: true },
  in: { label: 'одно из списка', needsValue: true }
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);
const compact = (value, max = 300) => {
  const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

class AuditDb {
  constructor() {
    this.db = null;
  }

  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'id' });
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    });
  }

  async tx(store, mode, work) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const objectStore = transaction.objectStore(store);
      let value;
      try { value = work(objectStore); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error || new Error(`IndexedDB ${store} failed`));
      transaction.onabort = () => reject(transaction.error || new Error(`IndexedDB ${store} aborted`));
    });
  }

  async get(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async put(store, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readwrite').objectStore(store).put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async count(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  }
}

const db = new AuditDb();

async function maintainAuditStorage() {
  const now = Date.now();
  const cache = await db.getAll('cache').catch(() => []);
  const staleCache = cache.filter(item => !item?.savedAt || now - Date.parse(String(item.savedAt || '')) > CACHE_TTL_MS);
  await Promise.all(staleCache.map(item => db.delete('cache', item.key).catch(() => false)));

  const logs = (await db.getAll('logs').catch(() => []))
    .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
  const keepLogs = new Set(logs.slice(0, MAX_AUDIT_LOGS).map(item => item.id));
  const staleLogs = logs.filter(item => {
    const ts = Date.parse(String(item?.createdAt || '')) || 0;
    return !keepLogs.has(item.id) || (ts && now - ts > LOG_RETENTION_MS);
  });
  await Promise.all(staleLogs.map(item => db.delete('logs', item.id).catch(() => false)));

  const runs = (await db.getAll('runs').catch(() => []))
    .sort((a, b) => String(b?.createdAt || b?.finishedAt || '').localeCompare(String(a?.createdAt || a?.finishedAt || '')));
  const keepRuns = new Set(runs.slice(0, MAX_AUDIT_RUNS).map(item => item.id));
  const staleRuns = runs.filter(item => {
    const ts = Date.parse(String(item?.createdAt || item?.finishedAt || '')) || 0;
    return !keepRuns.has(item.id) || (ts && now - ts > RUN_RETENTION_MS);
  });
  await Promise.all(staleRuns.map(item => db.delete('runs', item.id).catch(() => false)));

  return { cacheRemoved: staleCache.length, logsRemoved: staleLogs.length, runsRemoved: staleRuns.length };
}
const hostFetchPending = new Map();

const state = {
  groups: [],
  transientGroups: [],
  selectedIds: [],
  mode: 'union',
  view: 'builder',
  rules: [
    { id: uid('rule'), field: 'billing.onuSerial', op: 'not_empty', value: '' },
    { id: uid('rule'), field: 'billing.onuMac', op: 'not_empty', value: '' },
    { id: uid('rule'), field: 'billing.olt', op: 'empty', value: '' }
  ],
  afterMode: 'billing',
  auditMode: 'onu_identity_compare',
  hostInfo: null,
  settings: { open: false, width: 690, expanded: false },
  runtime: {
    active: false,
    kind: '',
    paused: false,
    stopped: false,
    finishRequested: false,
    plannedMax: 0,
    requests: 0,
    billingRequests: 0,
    userSideRequests: 0,
    gotouserAttempts: 0,
    gotouserSuccess: 0,
    ajaxSearchRequests: 0,
    searchPageRequests: 0,
    tmcMainRequests: 0,
    fallbackSuccess: 0,
    cacheHits: 0,
    inFlight: 0,
    maxInFlight: 0,
    startedAtMs: 0,
    totalLatencyMs: 0,
    requestTimes: [],
    done: 0,
    total: 0,
    message: 'Готов к работе'
  },
  rows: [],
  lastRun: null,
  toastTimer: null,
  draftSaveTimer: null,
  wizard: {
    step: 1,
    pageCount: 5,
    filterMode: '',
    filterCompleted: false,
    filterMembers: [],
    filterRunId: '',
    groupId: '',
    groupName: '',
    groupPurpose: '',
    groupColor: 'blue',
    checkMode: '',
    runningPhase: '',
    checkCompleted: false,
    resultSaved: false,
    resultRows: [],
    resultMeta: null,
    captureRequests: 0
  }
};

function postParent(type, payload = {}) {
  if (!PARENT_ORIGIN) return;
  window.parent.postMessage({ __simnetDataAudit: true, type, payload }, PARENT_ORIGIN);
}

function toast(message) {
  let node = document.querySelector('.toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

async function logEvent(type, message, meta = {}) {
  try {
    await db.put('logs', { id: uid('log'), createdAt: nowIso(), type: String(type || 'INFO').toUpperCase(), message: compact(message, 900), meta });
    if ($('#storageLogs')) $('#storageLogs').textContent = await db.count('logs');
    if (state.view === 'journal') await renderJournal();
  } catch {}
}

function logClass(type) {
  const key = String(type || '').toUpperCase();
  if (['ERROR', 'CANCEL'].includes(key)) return 'bad';
  if (['PAUSE', 'PARTIAL', 'WARN'].includes(key)) return 'warn';
  if (['SAVE', 'DONE'].includes(key)) return 'ok';
  if (['RUN', 'SOURCE', 'ACTION', 'FILTER', 'CHECK'].includes(key)) return 'info';
  return 'muted';
}

function journalDetail(item) {
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {};
  const lines = [];
  if (meta.runId) lines.push(`Run: ${meta.runId}`);
  if (meta.groupId) lines.push(`Group: ${meta.groupId}`);
  if (meta.auditMode) lines.push(`Режим: ${meta.auditMode}`);
  if (meta.members != null) lines.push(`Абонентов: ${meta.members}`);
  if (meta.network) lines.push(`Сеть: ${JSON.stringify(meta.network, null, 2)}`);
  if (meta.trace) lines.push(`Trace: ${JSON.stringify(meta.trace, null, 2)}`);
  const rest = { ...meta }; delete rest.runId; delete rest.groupId; delete rest.auditMode; delete rest.members; delete rest.network; delete rest.trace;
  if (Object.keys(rest).length) lines.push(`Детали: ${JSON.stringify(rest, null, 2)}`);
  return lines.join('\n');
}

async function renderJournal() {
  const bodies = [$('#journalBody'), $('#wizardJournalBody')].filter(Boolean);
  if (!bodies.length) return;
  const rows = (await db.getAll('logs')).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 500);
  const html = rows.length ? rows.map(item => {
    const detail = journalDetail(item);
    return `<tr class="journal-row" data-log-id="${esc(item.id)}"><td>${detail ? '<span class="journal-chevron">▸</span>' : ''}${esc(formatDateTime(item.createdAt))}</td><td><span class="result-pill ${logClass(item.type)}">${esc(item.type)}</span></td><td>${esc(item.message)}</td></tr>${detail ? `<tr class="journal-detail-row" data-log-detail="${esc(item.id)}" hidden><td colspan="3"><pre class="journal-detail">${esc(detail)}</pre></td></tr>` : ''}`;
  }).join('') : '<tr class="empty-table"><td colspan="3">Журнал пока пуст.</td></tr>';
  for (const body of bodies) {
    body.innerHTML = html;
    body.querySelectorAll('.journal-row[data-log-id]').forEach(row => row.addEventListener('click', () => {
      const id = row.dataset.logId; const detail = body.querySelector(`[data-log-detail="${CSS.escape(id)}"]`); if (!detail) return;
      detail.hidden = !detail.hidden; const arrow = row.querySelector('.journal-chevron'); if (arrow) arrow.textContent = detail.hidden ? '▸' : '▾';
    }));
  }
}

function downloadTextFile(name, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportJournal(format = 'txt') {
  const logs = (await db.getAll('logs')).sort((a,b) => String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  const runs = await db.getAll('runs');
  const payload = { exportedAt: nowIso(), logs, runs };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (format === 'json') return downloadTextFile(`simnet_data_audit_journal_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  const lines = ['SIMNET DATA AUDIT JOURNAL', `Экспорт: ${payload.exportedAt}`, ''];
  for (const item of logs) { lines.push(`${formatDateTime(item.createdAt)}  ${item.type}  ${item.message}`); const detail = journalDetail(item); if (detail) lines.push(detail.split('\n').map(x => `  ${x}`).join('\n')); lines.push(''); }
  lines.push('=== RUNS ===', JSON.stringify(runs, null, 2));
  downloadTextFile(`simnet_data_audit_journal_${stamp}.txt`, `\uFEFF${lines.join('\r\n')}`);
}

function formatDateTime(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)); }
  catch { return '—'; }
}

async function loadSettings() {
  const record = await db.get('settings', 'workspace');
  if (record?.value) state.settings = { ...state.settings, ...record.value };
}

async function saveSettings(patch = {}) {
  state.settings = { ...state.settings, ...patch };
  await db.put('settings', { key: 'workspace', value: state.settings, updatedAt: nowIso() });
}

async function loadWorkspaceDraft() {
  const record = await db.get('settings', 'audit-draft');
  const value = record?.value;
  if (!value || typeof value !== 'object') return;
  state.transientGroups = Array.isArray(value.transientGroups) ? value.transientGroups : [];
  state.selectedIds = Array.isArray(value.selectedIds) ? value.selectedIds.map(String) : [];
  if (['union', 'intersection', 'difference'].includes(value.mode)) state.mode = value.mode;
  if (Array.isArray(value.rules) && value.rules.length) state.rules = value.rules;
  if (['billing', 'tmc'].includes(value.afterMode)) state.afterMode = value.afterMode;
  if (['olt_compare', 'onu_identity_compare', 'custom'].includes(value.auditMode)) state.auditMode = value.auditMode;
  if (value.wizard && typeof value.wizard === 'object') {
    state.wizard = { ...state.wizard, ...value.wizard };
    state.wizard.pageCount = Math.min(20, Math.max(1, Number(state.wizard.pageCount || 5)));
    state.wizard.filterMembers = uniqueMembers(state.wizard.filterMembers || []);
    state.wizard.resultRows = Array.isArray(state.wizard.resultRows) ? state.wizard.resultRows : [];
    if (state.wizard.resultRows.length) {
      state.rows = state.wizard.resultRows;
      state.lastRun = state.wizard.resultMeta || null;
    }
  }
}

async function saveWorkspaceDraft() {
  const value = {
    transientGroups: state.transientGroups,
    selectedIds: state.selectedIds,
    mode: state.mode,
    rules: state.rules,
    afterMode: state.afterMode,
    auditMode: state.auditMode,
    wizard: { ...state.wizard, runningPhase: '' }
  };
  await db.put('settings', { key: 'audit-draft', value, updatedAt: nowIso() });
}

function scheduleWorkspaceDraftSave() {
  clearTimeout(state.draftSaveTimer);
  state.draftSaveTimer = setTimeout(() => { void saveWorkspaceDraft(); }, 120);
}

function memberKey(member) {
  const login = String(member?.login || '').toLowerCase().trim();
  if (login) return login;
  const contract = String(member?.contract || '').replace(/\D/g, '');
  return contract ? `abon${contract}` : '';
}

function normalizeMember(raw) {
  const text = typeof raw === 'string' ? raw : raw?.login || raw?.contract || '';
  const match = String(text).match(/(?:abon)?\s*(\d{3,12})/i);
  if (!match) return null;
  const contract = String(raw?.contract || match[1]).replace(/\D/g, '');
  if (!contract) return null;
  return {
    login: String(raw?.login || `abon${contract}`).toLowerCase(),
    contract,
    billingId: String(raw?.billingId || ''),
    sourceUrl: String(raw?.sourceUrl || '')
  };
}

function uniqueMembers(items) {
  const map = new Map();
  for (const raw of items || []) {
    const member = normalizeMember(raw);
    if (!member) continue;
    const key = memberKey(member);
    const previous = map.get(key);
    if (!previous || (!previous.billingId && member.billingId)) map.set(key, member);
  }
  return [...map.values()];
}

async function saveGroup({ name, members, color = 'blue', source = null, lineage = null, purpose = '' }) {
  const cleanMembers = uniqueMembers(members);
  if (!cleanMembers.length) throw new Error('В группе нет договоров');
  const group = {
    id: uid('group'),
    name: compact(name || `Группа ${new Date().toLocaleString('ru-RU')}`, 120),
    color: GROUP_COLORS.includes(color) ? color : 'blue',
    members: cleanMembers,
    memberCount: cleanMembers.length,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: source || { type: 'manual' },
    lineage: lineage || null,
    purpose: compact(purpose || '', 280),
    history: [{ id: uid('gh'), type: 'created', createdAt: nowIso(), message: `Группа создана · ${cleanMembers.length} абонентов` }],
    auditHistory: []
  };
  await db.put('groups', group);
  await logEvent('SAVE', `Создана группа «${group.name}» · ${group.memberCount} абонентов${group.purpose ? ` · для чего: ${group.purpose}` : ''}`, { groupId: group.id });
  await loadGroups();
  return group;
}

async function loadGroups() {
  state.groups = (await db.getAll('groups')).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  renderGroups();
  renderSelectedGroups();
  await renderStorageStats();
}

async function renderStorageStats() {
  const [groups, rules, runs, cache, logs] = await Promise.all(['groups', 'rules', 'runs', 'cache', 'logs'].map(store => db.count(store)));
  $('#storageGroups').textContent = groups;
  $('#storageRules').textContent = rules;
  $('#storageRuns').textContent = runs;
  $('#storageCache').textContent = cache;
  if ($('#storageLogs')) $('#storageLogs').textContent = logs;
}

function groupIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v5h5"/></svg>';
}

function auditSummaryText(group) {
  const summary = group?.auditSnapshot?.summary;
  const checks = Array.isArray(group?.auditHistory) ? group.auditHistory.length : 0;
  if (!summary) return checks ? ` · проверок ${checks}` : '';
  return ` · проверок ${checks || 1} · ✓ ${Number(summary.ok || 0)} · ⚠ ${Number(summary.problem || 0)} · ? ${Number(summary.unknown || 0)}`;
}

function renderGroups() {
  const query = $('#groupSearch').value.trim().toLowerCase();
  const groups = state.groups.filter(group => !query || String(group.name || '').toLowerCase().includes(query));
  $('#groupCount').textContent = `${state.groups.length} сохранено`;
  $('#groupList').innerHTML = groups.length ? groups.map(group => `
    <div class="group-card ${esc(group.color || 'blue')}" draggable="true" data-group-id="${esc(group.id)}">
      <span class="group-file">${groupIcon()}</span>
      <span class="group-copy"><b>${esc(group.name)}</b><small>${Number(group.memberCount || group.members?.length || 0)} абонентов${esc(auditSummaryText(group))} · ${formatDate(group.updatedAt)}</small></span>
      <span class="group-actions"><button type="button" data-open-group="${esc(group.id)}">Открыть</button><button type="button" data-use-group="${esc(group.id)}">Продолжить</button></span>
    </div>
  `).join('') : '<div class="empty-library">Сохранённых групп пока нет.</div>';

  $$('[data-open-group]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const group = state.groups.find(item => item.id === button.dataset.openGroup);
    if (group) void logEvent('ACTION', `Открыта группа «${group.name}» · просмотр состава и истории.`);
    openGroupModal(button.dataset.openGroup);
  }));
  $$('[data-use-group]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    useSavedGroupInWizard(button.dataset.useGroup);
  }));
  $$('.group-card').forEach(card => {
    card.addEventListener('dblclick', () => useSavedGroupInWizard(card.dataset.groupId));
    card.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/simnet-group-id', card.dataset.groupId);
      event.dataTransfer.effectAllowed = 'copy';
    });
  });
}

function markerInfo(marker) {
  const status = marker?.status || '';
  if (status === 'ready') return ['ok', 'Готово к опросу'];
  if (status === 'ok') return ['ok', 'Совпало'];
  if (status === 'olt_mismatch') return ['bad', 'Неверная OLT в Billing'];
  if (status === 'mismatch') return ['bad', 'Расхождение OLT'];
  if (status === 'multiple_conflicts') return ['bad', 'Несколько конфликтов'];
  if (status === 'serial_mismatch') return ['bad', 'Serial не совпал'];
  if (status === 'mac_mismatch') return ['bad', 'ONU MAC не совпал'];
  if (status === 'both_mismatch') return ['bad', 'Serial + MAC не совпали'];
  if (status === 'needs_olt') return ['warn', 'Нужно заполнить OLT'];
  if (status === 'needs_serial') return ['warn', 'Нужно заполнить S/N'];
  if (status === 'needs_mac') return ['warn', 'Нужно заполнить ONU MAC'];
  if (status === 'needs_fields') return ['warn', 'Нужно дозаполнить Billing'];
  if (status === 'tmc_partial') return ['warn', 'ТМЦ прочитана частично'];
  if (status === 'tmc_insufficient') return ['warn', 'ТМЦ не дала данных'];
  if (status === 'tmc_unavailable') return ['warn', 'Карточка / ТМЦ не найдена'];
  if (status === 'billing_identity_missing') return ['warn', 'Нет Serial/MAC в Billing'];
  if (status === 'tmc_identity_missing') return ['warn', 'Нет нужного Serial/MAC в ТМЦ'];
  if (status === 'tmc_identity_unparsed') return ['warn', 'ТМЦ найдена, Serial/MAC не распознаны'];
  if (status === 'billing_empty') return ['warn', 'Нет OLT в Billing'];
  if (status === 'tmc_empty') return ['warn', 'В ТМЦ нет блока «Найдено на OLT»'];
  if (status === 'tmc_unparsed') return ['warn', 'ТМЦ найдена, OLT не распознана'];
  if (status === 'both_empty') return ['muted', 'Нет данных'];
  if (status === 'error') return ['bad', 'Ошибка'];
  return ['muted', 'Не проверено'];
}

function openGroupModal(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return toast('Группа не найдена');
  const markers = group.auditSnapshot?.markers || {};
  const rows = uniqueMembers(group.members).map(member => {
    const marker = markers[memberKey(member)] || null;
    const [cls, label] = markerInfo(marker);
    const details = [marker?.billingSerial && `B SN: ${marker.billingSerial}`, marker?.tmcSerial && `T SN: ${marker.tmcSerial}`, marker?.billingMac && `B MAC: ${marker.billingMac}`, marker?.tmcMac && `T MAC: ${marker.tmcMac}`, marker?.tmcOltIp && `OLT IP: ${marker.tmcOltIp}`, marker?.tmcParseStatus && `TMC parser: ${marker.tmcParseStatus}`, marker?.resolver && `UserSide: ${marker.resolver}`, marker?.usersideIp && `IP: ${marker.usersideIp}`, marker?.advice && `Совет: ${marker.advice}`].filter(Boolean).join(' · ');
    return `<tr><td>${esc(member.login)}</td><td>${esc(marker?.billingOlt || '—')}</td><td>${esc(marker?.tmcOlt || '—')}</td><td><span class="result-pill ${cls}">${esc(label)}</span>${details ? `<div class="cell-sub">${esc(details)}</div>` : ''}</td></tr>`;
  }).join('');
  const snap = group.auditSnapshot;
  const captures = Array.isArray(group.source?.captures) ? group.source.captures : [];
  const checks = Array.isArray(group.auditHistory) ? [...group.auditHistory].reverse() : [];
  const history = Array.isArray(group.history) ? [...group.history].reverse() : [];
  const checkHtml = checks.length ? checks.map(check => {
    const issues = Array.isArray(check.issueMembers) ? check.issueMembers : [];
    const net = check.network || {};
    const networkLine = Number(net.requests || 0)
      ? `<div class="history-network"><b>Сеть:</b> ${Number(net.requests || 0)} GET · Billing ${Number(net.billingRequests || 0)} · UserSide ${Number(net.userSideRequests || 0)} · gotouser ${Number(net.gotouserSuccess || 0)}/${Number(net.gotouserAttempts || 0)} · fallback ${Number(net.fallbackSuccess || 0)} · ~${Number(net.avgRequestsPerMinute || 0)} GET/мин</div>`
      : '';
    return `<details class="group-history-item"><summary><b>${esc(check.label || check.type || 'Проверка')}</b> · ${esc(formatDateTime(check.savedAt))} · проверено ${Number(check.checked || 0)} · проблем ${Number(check.summary?.problem || 0)}${check.partial ? ' · частично' : ''}</summary>${networkLine}${issues.length ? `<div class="history-issues">Не прошли: ${issues.map(esc).join(', ')}</div>` : '<div class="history-issues">Проблем не зафиксировано.</div>'}</details>`;
  }).join('') : '<div class="group-audit-summary">Проверок ещё не зафиксировано.</div>';
  const historyHtml = history.length ? history.map(item => `<div class="group-history-line"><span>${esc(formatDateTime(item.createdAt))}</span><b>${esc(item.message || item.type || '')}</b></div>`).join('') : '';
  openModal({
    title: `${group.name} · ${group.memberCount || group.members?.length || 0} абонентов`,
    body: `
      <div class="modal-tip"><b>Состав группы фиксирован.</b><span>Проверки добавляют отметки и историю, но не удаляют абонентов из группы.</span></div>
      <div class="group-crud-actions"><button class="outline-btn small" data-group-edit type="button">Редактировать</button><button class="danger-btn small" data-group-delete type="button">Удалить</button></div>
      <div class="group-meta-grid">
        <div><span>Создана</span><b>${esc(formatDateTime(group.createdAt))}</b></div>
        <div><span>Обновлена</span><b>${esc(formatDateTime(group.updatedAt))}</b></div>
        <div><span>Источник</span><b>${esc(group.source?.type || '—')}${captures.length ? ` · ${captures.length} стр.` : ''}</b></div>
        ${group.purpose ? `<div class="wide"><span>Для чего</span><b>${esc(group.purpose)}</b></div>` : ''}
      </div>
      ${snap ? `<div class="group-audit-summary">Последняя фиксация: ${esc(formatDateTime(snap.savedAt))} · ✓ ${Number(snap.summary?.ok || 0)} · ⚠ ${Number(snap.summary?.problem || 0)} · ? ${Number(snap.summary?.unknown || 0)}${snap.partial ? ' · частично' : ''}</div>` : '<div class="group-audit-summary">Последней проверки нет.</div>'}
      <div class="block-title">История проверок</div>
      <div class="group-history-list">${checkHtml}</div>
      ${historyHtml ? `<div class="block-title">История группы</div><div class="group-history-list">${historyHtml}</div>` : ''}
      <div class="block-title">Абоненты</div>
      <div class="group-members-table"><table><thead><tr><th>Абонент</th><th>Billing OLT</th><th>ТМЦ OLT</th><th>Последняя отметка</th></tr></thead><tbody>${rows}</tbody></table></div>
    `,
    confirmText: state.wizard.groupId === group.id ? 'Текущая группа' : 'Продолжить с группой',
    onConfirm: () => { useSavedGroupInWizard(group.id); }
  });
  $('[data-group-edit]')?.addEventListener('click', () => void editGroupModal(group.id));
  $('[data-group-delete]')?.addEventListener('click', () => deleteGroupModal(group.id));
}
function formatDate(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
  catch { return '—'; }
}

function addSelected(groupId) {
  if (!groupId || state.selectedIds.includes(groupId)) return;
  state.selectedIds.push(groupId);
  scheduleWorkspaceDraftSave();
  renderSelectedGroups();
  updatePlans();
  const group = [...state.groups, ...state.transientGroups].find(item => item.id === groupId);
  if (group) void logEvent('ACTION', `Добавлено в текущую проверку: «${group.name}» · ${group.memberCount || group.members?.length || 0} абонентов.`);
}

function removeSelected(groupId) {
  state.selectedIds = state.selectedIds.filter(id => id !== groupId);
  state.transientGroups = state.transientGroups.filter(group => group.id !== groupId);
  scheduleWorkspaceDraftSave();
  renderSelectedGroups();
  updatePlans();
}

function selectedGroups() {
  const all = [...state.groups, ...state.transientGroups];
  return state.selectedIds.map(id => all.find(group => group.id === id)).filter(Boolean);
}

function transientGroupById(groupId) {
  return state.transientGroups.find(group => group.id === groupId) || null;
}

function addTransientGroup({ name, members, color = 'blue', source = null, partial = false }) {
  const cleanMembers = uniqueMembers(members);
  if (!cleanMembers.length) throw new Error('В выборке нет договоров');
  const group = {
    id: uid('temp'),
    name: compact(name || `Временная выборка · ${cleanMembers.length}`, 120),
    color: GROUP_COLORS.includes(color) ? color : 'blue',
    members: cleanMembers,
    memberCount: cleanMembers.length,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: source || { type: 'temporary' },
    lineage: null,
    transient: true,
    partial: Boolean(partial)
  };
  state.transientGroups.push(group);
  state.selectedIds.push(group.id);
  scheduleWorkspaceDraftSave();
  renderSelectedGroups();
  updatePlans();
  return group;
}


async function mergeCapturedPage(payload) {
  const incoming = uniqueMembers(payload?.members || []);
  if (!incoming.length) throw new Error('На странице нет договоров');
  let draft = state.transientGroups.find(group => group.collectionDraft === true);
  const oldCount = draft?.members?.length || 0;
  if (!draft) {
    draft = addTransientGroup({
      name: 'Текущий сбор Billing',
      members: incoming,
      color: 'blue',
      source: { type: 'billing-manual-pages', captures: [] },
      partial: true
    });
    draft.collectionDraft = true;
  } else {
    draft.members = uniqueMembers([...(draft.members || []), ...incoming]);
    draft.memberCount = draft.members.length;
    draft.updatedAt = nowIso();
  }
  const capture = {
    page: Number(payload?.meta?.page || 1),
    url: String(payload?.meta?.sourceUrl || ''),
    signature: String(payload?.meta?.signature || ''),
    capturedAt: payload?.meta?.capturedAt || nowIso(),
    rows: incoming.length
  };
  const captures = Array.isArray(draft.source?.captures) ? draft.source.captures : [];
  const captureKey = `${capture.signature}|${capture.page}|${capture.url}`;
  if (!captures.some(item => `${item.signature}|${item.page}|${item.url}` === captureKey)) captures.push(capture);
  draft.source = { ...(draft.source || {}), type: 'billing-manual-pages', captures };
  draft.name = `Текущий сбор Billing · ${draft.memberCount}`;
  if (!state.selectedIds.includes(draft.id)) state.selectedIds.push(draft.id);
  await saveWorkspaceDraft();
  renderSelectedGroups();
  updatePlans();
  return { draft, added: Math.max(0, draft.memberCount - oldCount), duplicates: Math.max(0, incoming.length - Math.max(0, draft.memberCount - oldCount)) };
}

function renderSelectedGroups() {
  const groups = selectedGroups();
  $('#emptyDrop').style.display = groups.length ? 'none' : 'flex';
  const mixSection = $('#mixSection');
  if (mixSection) mixSection.hidden = groups.length <= 1;
  $('#selectedGroups').innerHTML = groups.map((group, index) => `
    <div class="selected-chip ${esc(group.color || 'blue')} ${group.transient ? 'transient' : ''}">
      <span class="source-letter">${String.fromCharCode(65 + index)}</span>
      <span class="mini-file">${groupIcon()}</span>
      <span class="selected-copy"><b>${esc(group.name)}</b><small>${Number(group.memberCount || group.members?.length || 0)} абонентов${group.transient ? ` · ${group.collectionDraft ? `${Number(group.source?.captures?.length || 0)} стр.` : (group.partial ? 'частичная выборка' : 'временная выборка')}` : ' · сохранена'}</small></span>
      ${group.transient ? `<button class="save-temp" type="button" data-save-temp="${esc(group.id)}" title="Сохранить весь текущий сбор без фильтра">Сохранить весь сбор</button>` : ''}
      <button type="button" data-remove-group="${esc(group.id)}" title="Убрать">×</button>
    </div>
  `).join('');
  $$('[data-remove-group]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    removeSelected(button.dataset.removeGroup);
  }));
  $$('[data-save-temp]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    saveTransientGroupModal(button.dataset.saveTemp);
  }));
  renderMixPreview();
}

function combineMembers() {
  const groups = selectedGroups();
  if (!groups.length) return [];
  const memberMaps = groups.map(group => new Map(uniqueMembers(group.members).map(member => [memberKey(member), member])));

  if (state.mode === 'intersection') {
    const [first, ...rest] = memberMaps;
    return [...first.entries()].filter(([key]) => rest.every(map => map.has(key))).map(([, member]) => member);
  }

  if (state.mode === 'difference') {
    const [first, ...rest] = memberMaps;
    const excluded = new Set(rest.flatMap(map => [...map.keys()]));
    return [...first.entries()].filter(([key]) => !excluded.has(key)).map(([, member]) => member);
  }

  const result = new Map();
  for (const map of memberMaps) {
    for (const [key, member] of map) {
      const previous = result.get(key);
      if (!previous || (!previous.billingId && member.billingId)) result.set(key, member);
    }
  }
  return [...result.values()];
}

function renderMixPreview() {
  const groups = selectedGroups();
  const result = combineMembers();
  const modeCards = $('#modeCards');
  const modeHelp = $('#modeHelp');
  let text = 'Добавь хотя бы один источник: Billing, договоры вручную или сохранённую группу.';

  if (groups.length === 1) {
    state.mode = 'union';
    $$('.mode-card').forEach(card => card.classList.toggle('active', card.dataset.mode === 'union'));
    modeCards.classList.add('single-source');
    modeHelp.textContent = 'Сейчас один список — смешивание не требуется. Сразу переходи к правилам проверки.';
    text = `A = ${groups[0].name} → проверяем этот список как есть: ${result.length} абонентов.`;
  } else {
    modeCards.classList.remove('single-source');
    modeHelp.textContent = 'Буквы A, B, C соответствуют порядку выбранных списков выше.';
    if (groups.length) {
      const labels = groups.map((group, index) => `${String.fromCharCode(65 + index)}=${group.name}`);
      const sum = groups.reduce((total, group) => total + uniqueMembers(group.members).length, 0);
      if (state.mode === 'union') text = `${labels.join(' · ')} → складываем ${sum} записей, удаляем повторы → ${result.length} уникальных.`;
      if (state.mode === 'intersection') text = `${labels.join(' · ')} → оставляем только тех, кто присутствует одновременно во всех списках → ${result.length}.`;
      if (state.mode === 'difference') {
        const rest = groups.slice(1).map((_, index) => String.fromCharCode(66 + index)).join(' + ');
        text = `A − ${groups.length > 2 ? `(${rest})` : 'B'} → из «${groups[0].name}» убираем всех, кто встречается в остальных выбранных списках → ${result.length}.`;
      }
    }
  }
  $('#mixPreview').textContent = text;
  $('#mixResult strong').textContent = result.length;
  updatePlans();
}

function setMode(mode) {
  if (selectedGroups().length <= 1) return;
  if (!['union', 'intersection', 'difference'].includes(mode)) return;
  state.mode = mode;
  scheduleWorkspaceDraftSave();
  $$('.mode-card').forEach(card => card.classList.toggle('active', card.dataset.mode === mode));
  renderMixPreview();
}

function setView(view) {
  if (!['builder', 'rules', 'results', 'journal'].includes(view)) return;
  state.view = view;
  $$('.view').forEach(node => node.classList.toggle('active', node.id === `${view}View`));
  $$('.step').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  if (view === 'rules') { renderRules(); updatePlans(); }
  if (view === 'results') renderResults();
  if (view === 'journal') void renderJournal();
}

function fieldValue(row, field) {
  const [group, key] = String(field || '').split('.');
  return row?.[group]?.[key] ?? '';
}

function normalizeCompare(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
}


function normalizeOltName(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ' ')
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchRule(row, rule) {
  const actualRaw = fieldValue(row, rule.field);
  const actual = normalizeCompare(actualRaw);
  const expected = normalizeCompare(rule.value);
  if (rule.op === 'not_empty') return actual !== '';
  if (rule.op === 'empty') return actual === '';
  if (rule.op === 'eq') return actual === expected;
  if (rule.op === 'neq') return actual !== expected;
  if (rule.op === 'contains') return actual.includes(expected);
  if (rule.op === 'not_contains') return !actual.includes(expected);
  if (rule.op === 'in') {
    const list = String(rule.value || '').split(/[\n,;]+/).map(normalizeCompare).filter(Boolean);
    return list.includes(actual);
  }
  return true;
}

function rulesForSource(source) {
  return state.rules.filter(rule => FIELD_DEFS[rule.field]?.source === source);
}

function passesRules(row, rules) {
  return (rules || []).every(rule => matchRule(row, rule));
}

function renderRules() {
  $('#rulesList').innerHTML = state.rules.map((rule, index) => {
    const op = OP_DEFS[rule.op] || OP_DEFS.not_empty;
    return `
      <div class="rule-row" data-rule-id="${esc(rule.id)}">
        <span class="rule-num">${index + 1}</span>
        <select data-rule-field>
          ${Object.entries(FIELD_DEFS).map(([value, def]) => `<option value="${esc(value)}" ${rule.field === value ? 'selected' : ''}>${esc(def.label)}</option>`).join('')}
        </select>
        <select data-rule-op>
          ${Object.entries(OP_DEFS).map(([value, def]) => `<option value="${esc(value)}" ${rule.op === value ? 'selected' : ''}>${esc(def.label)}</option>`).join('')}
        </select>
        <input class="rule-value ${op.needsValue ? '' : 'hidden'}" data-rule-value type="text" value="${esc(rule.value || '')}" placeholder="значение / список">
        <button class="delete-rule" data-rule-delete type="button" title="Удалить"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>
      </div>
    `;
  }).join('');

  $$('.rule-row').forEach(row => {
    const id = row.dataset.ruleId;
    const rule = state.rules.find(item => item.id === id);
    row.querySelector('[data-rule-field]').addEventListener('change', event => { rule.field = event.target.value; scheduleWorkspaceDraftSave(); renderRuleSummary(); updatePlans(); });
    row.querySelector('[data-rule-op]').addEventListener('change', event => { rule.op = event.target.value; scheduleWorkspaceDraftSave(); renderRules(); updatePlans(); });
    row.querySelector('[data-rule-value]').addEventListener('input', event => { rule.value = event.target.value; scheduleWorkspaceDraftSave(); renderRuleSummary(); });
    row.querySelector('[data-rule-delete]').addEventListener('click', () => { state.rules = state.rules.filter(item => item.id !== id); scheduleWorkspaceDraftSave(); renderRules(); updatePlans(); });
  });
  renderRuleSummary();
}

function ruleHuman(rule) {
  const field = FIELD_DEFS[rule.field]?.label || rule.field;
  const op = OP_DEFS[rule.op]?.label || rule.op;
  return `${field} — ${op}${OP_DEFS[rule.op]?.needsValue ? ` «${rule.value || '…'}»` : ''}`;
}

function renderRuleSummary() {
  $('#ruleSummary').innerHTML = state.rules.length
    ? `<b>Итог:</b> найдём абонентов, для которых одновременно выполняется: ${state.rules.map(ruleHuman).map(esc).join(' + ')}.`
    : '<b>Итог:</b> условий нет — в результат попадёт весь выбранный набор.';
}

function requestLoadLevel(maxRequests) {
  const value = Number(maxRequests || 0);
  if (value <= 60) return { key: 'low', label: 'низкая', note: '1 запрос за раз' };
  if (value <= 250) return { key: 'medium', label: 'средняя', note: '1 запрос за раз · контролируемо' };
  return { key: 'high', label: 'повышенная', note: 'лучше запускать частями' };
}

function updatePlans() {
  const members = combineMembers();
  const count = members.length;
  $('#planMembers').textContent = count;
  const missingIds = members.filter(member => !member.billingId).length;
  const minBilling = count;
  const maxBilling = count + missingIds;
  const compareMode = ['olt_compare', 'onu_identity_compare'].includes(state.auditMode);
  const needsTmc = compareMode || state.afterMode === 'tmc' || rulesForSource('tmc').length > 0;
  const maxTmc = needsTmc ? count * 4 : 0;
  const maxTotal = maxBilling + maxTmc;
  $('#planBillingRequests').textContent = `${minBilling}–${maxBilling}`;
  $('#planTmcRequests').textContent = needsTmc ? `0–${maxTmc}` : '0';
  $('#planRequests').textContent = maxTotal ? `≤ ${maxTotal}` : '0';
  const load = requestLoadLevel(maxTotal);
  $('#planLoad').textContent = load.label;
  $('#planLoadNote').textContent = load.note;
  const card = $('#planLoadCard');
  card.classList.remove('low', 'medium', 'high');
  card.classList.add(load.key);
  if (!state.runtime.active) state.runtime.plannedMax = maxTotal;
  updateRuntimeUi();
}

function openModal({ title, body, confirmText = 'Сохранить', onConfirm }) {
  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head"><b>${esc(title)}</b><button class="icon-btn" data-modal-close type="button">×</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions"><button class="outline-btn" data-modal-close type="button">Отмена</button><button class="primary-btn" data-modal-confirm type="button">${esc(confirmText)}</button></div>
      </div>
    </div>
  `;
  const close = () => { $('#modalRoot').innerHTML = ''; };
  $$('[data-modal-close]').forEach(button => button.addEventListener('click', close));
  $('[data-modal-confirm]').addEventListener('click', async () => {
    try {
      const result = await onConfirm?.($('.modal'));
      if (result !== false) close();
    } catch (error) { toast(error?.message || String(error)); }
  });
}

function colorPickerHtml(selected = 'blue') {
  return `<div class="color-picker">${GROUP_COLORS.map(color => `<button class="color-option ${color} ${color === selected ? 'active' : ''}" data-color="${color}" type="button" title="${color}"></button>`).join('')}</div>`;
}

function bindColorPicker(modal) {
  modal.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => {
    modal.querySelectorAll('[data-color]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
  }));
}

function manualSourceModal() {
  openModal({
    title: 'Добавить договоры в текущую проверку',
    body: `
      <div class="modal-tip"><b>Это будет временная выборка.</b><span>Имя сейчас не нужно. Если список пригодится позже — сохранишь его в библиотеку отдельной кнопкой.</span></div>
      <label style="margin-top:12px">Договоры</label><textarea data-group-members placeholder="abon123456\n123457\nabon123458"></textarea>
    `,
    confirmText: 'Добавить в проверку',
    onConfirm: async modal => {
      const members = uniqueMembers(modal.querySelector('[data-group-members]').value.split(/[\s,;]+/));
      if (!members.length) throw new Error('Вставь хотя бы один договор');
      addTransientGroup({
        name: `Вручную · ${members.length} договоров`,
        members,
        color: 'green',
        source: { type: 'manual', capturedAt: nowIso() }
      });
      toast(`Добавлено в проверку: ${members.length}`);
    }
  });
}

function saveTransientGroupModal(groupId) {
  const source = transientGroupById(groupId);
  if (!source) return toast('Временная выборка не найдена');
  const suggested = source.source?.sourceTitle
    ? compact(source.source.sourceTitle, 90)
    : source.name.replace(/^Временная выборка\s*·?\s*/i, '') || 'Новая группа';
  openModal({
    title: `Сохранить как группу · ${source.memberCount} абонентов`,
    body: `
      <div class="modal-tip"><b>Группа останется в IndexedDB.</b><span>После сохранения её можно будет использовать в следующих аудитах.</span></div>
      <label style="margin-top:12px">Название группы</label><input type="text" data-group-name value="${esc(suggested)}">
      <label style="margin-top:10px">Для чего (необязательно)</label><input type="text" data-group-purpose placeholder="Например: абоненты PON для сверки ONU">
      <label style="margin-top:10px">Цвет</label>${colorPickerHtml(source.color || 'blue')}
    `,
    confirmText: 'Сохранить группу',
    onConfirm: async modal => {
      const name = modal.querySelector('[data-group-name]').value.trim();
      const color = modal.querySelector('[data-color].active')?.dataset.color || source.color || 'blue';
      if (!name) throw new Error('Укажи название группы');
      const purpose = modal.querySelector('[data-group-purpose]')?.value.trim() || '';
      const group = await saveGroup({ name, members: source.members, color, source: source.source, lineage: source.lineage, purpose });
      const index = state.selectedIds.indexOf(source.id);
      if (index >= 0) state.selectedIds[index] = group.id;
      state.transientGroups = state.transientGroups.filter(item => item.id !== source.id);
      scheduleWorkspaceDraftSave();
      renderSelectedGroups();
      toast(`Группа сохранена: ${group.memberCount}`);
    }
  });
  bindColorPicker($('.modal'));
}

async function parentFetch(url) {
  const requestId = uid('fetch');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostFetchPending.delete(requestId);
      reject(new Error('Таймаут запроса к открытой странице Billing'));
    }, 18000);
    hostFetchPending.set(requestId, { resolve, reject, timer });
    postParent('AUDIT_FETCH_SAME_ORIGIN', { requestId, url });
  });
}

function finishHereError() {
  const error = new Error('Завершить на текущем объёме');
  error.code = 'AUDIT_FINISH_HERE';
  return error;
}

function runtimeRequestKind(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (/admin\.(?:simnet|looknet)\.kiev\.ua/i.test(url.hostname)) return 'billing';
    if (url.hostname === 'userside.simnet.kiev.ua') {
      if (/\/script\/gotouser\.php$/i.test(url.pathname)) return 'gotouser';
      if (/\/customer_list\/ajax_search$/i.test(url.pathname)) return 'ajax';
      if (/\/customer_list\/search_page$/i.test(url.pathname)) return 'searchPage';
      if (/\/customer\/tab$/i.test(url.pathname)) return 'tmcMain';
      return 'userside';
    }
  } catch {}
  return 'other';
}

function runtimeRatePerMinute(rt = state.runtime) {
  const started = Number(rt.startedAtMs || 0);
  if (!started || !rt.requests) return 0;
  const elapsedMs = Math.max(1000, Date.now() - started);
  return Math.round((Number(rt.requests || 0) * 60000) / elapsedMs);
}

function runtimeLoadLevel(rate) {
  const n = Number(rate || 0);
  if (n <= 30) return { key: 'low', label: 'низкая' };
  if (n <= 90) return { key: 'medium', label: 'средняя' };
  return { key: 'high', label: 'повышенная' };
}

function runtimeNetworkSnapshot(rt = state.runtime) {
  const requests = Number(rt.requests || 0);
  return {
    requests,
    billingRequests: Number(rt.billingRequests || 0),
    userSideRequests: Number(rt.userSideRequests || 0),
    gotouserAttempts: Number(rt.gotouserAttempts || 0),
    gotouserSuccess: Number(rt.gotouserSuccess || 0),
    ajaxSearchRequests: Number(rt.ajaxSearchRequests || 0),
    searchPageRequests: Number(rt.searchPageRequests || 0),
    tmcMainRequests: Number(rt.tmcMainRequests || 0),
    fallbackSuccess: Number(rt.fallbackSuccess || 0),
    cacheHits: Number(rt.cacheHits || 0),
    maxInFlight: Number(rt.maxInFlight || 0),
    elapsedMs: rt.startedAtMs ? Math.max(0, Date.now() - rt.startedAtMs) : 0,
    avgLatencyMs: requests ? Math.round(Number(rt.totalLatencyMs || 0) / requests) : 0,
    avgRequestsPerMinute: runtimeRatePerMinute(rt)
  };
}

async function runtimeFetch(url) {
  await waitForRuntime();
  if (state.runtime.finishRequested) throw finishHereError();
  if (state.runtime.stopped) throw new Error('Остановлено оператором');

  const rt = state.runtime;
  const kind = runtimeRequestKind(url);
  if (!rt.startedAtMs) rt.startedAtMs = Date.now();
  rt.requests += 1;
  rt.requestTimes = [...(rt.requestTimes || []).slice(-199), Date.now()];
  if (kind === 'billing') rt.billingRequests += 1;
  else if (kind !== 'other') rt.userSideRequests += 1;
  if (kind === 'gotouser') { rt.gotouserAttempts += 1; }
  if (kind === 'ajax') rt.ajaxSearchRequests += 1;
  if (kind === 'searchPage') rt.searchPageRequests += 1;
  if (kind === 'tmcMain') rt.tmcMainRequests += 1;
  rt.inFlight += 1;
  rt.maxInFlight = Math.max(Number(rt.maxInFlight || 0), rt.inFlight);
  updateRuntimeUi();

  const started = performance.now();
  try {
    let parsed = null;
    try { parsed = new URL(url); } catch {}
    const canUseParent = Boolean(parsed && state.hostInfo?.host && parsed.hostname === state.hostInfo.host);
    if (canUseParent) {
      const result = await parentFetch(url);
      if (!result?.ok) throw new Error(result?.error || `HTTP ${result?.status || 0}`);
      return { status: result.status, contentType: result.contentType || '', url: result.url || url, data: result.data || '' };
    }

    const response = await chrome.runtime.sendMessage({ type: 'FETCH_REQUEST', payload: { url, method: 'GET' } });
    if (!response?.success) throw new Error(response?.error || `Не удалось получить ${url}`);
    return response.data;
  } finally {
    rt.totalLatencyMs += Math.max(0, performance.now() - started);
    rt.inFlight = Math.max(0, Number(rt.inFlight || 0) - 1);
    updateRuntimeUi();
  }
}

async function waitForRuntime() {
  while (state.runtime.paused && !state.runtime.stopped) {
    await new Promise(resolve => setTimeout(resolve, 160));
  }
  if (state.runtime.stopped) throw new Error('Остановлено оператором');
}

async function cacheGet(key) {
  const item = await db.get('cache', key);
  if (!item || !item.savedAt || Date.now() - Date.parse(item.savedAt) > CACHE_TTL_MS) return null;
  state.runtime.cacheHits += 1;
  updateRuntimeUi();
  return item.value;
}

async function cachePut(key, value) {
  await db.put('cache', { key, value, savedAt: nowIso() });
}

function responseText(result) {
  const data = result?.data;
  return typeof data === 'string' ? data : JSON.stringify(data ?? '');
}

function parseBillingId(html, login) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const normalized = String(login || '').toLowerCase();
  const rows = [...doc.querySelectorAll('tr')];
  const row = rows.find(item => String(item.textContent || '').toLowerCase().includes(normalized));
  const roots = row ? [row, doc] : [doc];
  for (const root of roots) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href') || '', 'https://admin.simnet.kiev.ua/');
        if (!['user', 'dopdata'].includes(url.searchParams.get('a') || '')) continue;
        const id = url.searchParams.get('id') || '';
        if (/^\d+$/.test(id)) return id;
      } catch {}
    }
  }
  return '';
}

function controlDisplay(doc, name) {
  const control = doc.querySelector(`[name="${CSS.escape(name)}"]`);
  if (!control) return '';
  if (control.tagName === 'SELECT') {
    const option = control.options?.[control.selectedIndex] || control.querySelector('option[selected]');
    const value = compact(option?.textContent || control.value || '', 260);
    return /выбер|оберіть|не\s+указ|нет\s+данн/i.test(value) ? '' : value;
  }
  return compact(control.value || control.getAttribute('value') || '', 260);
}

function normalizeMac(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 12) return compact(value, 80);
  return hex.match(/.{2}/g).join(':');
}

function labeledValue(doc, patterns) {
  for (const row of doc.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
    if (cells.length < 2) continue;
    const label = compact(cells[0].innerText || cells[0].textContent || '', 180).toLowerCase().replace(/[:：]\s*$/, '');
    if (!patterns.some(pattern => pattern.test(label))) continue;
    const valueCell = cells[cells.length - 1];
    const control = valueCell.querySelector('input,select,textarea') || row.querySelector('input,select,textarea');
    if (control) {
      if (control.tagName === 'SELECT') {
        const option = control.options?.[control.selectedIndex] || control.querySelector('option[selected]');
        return compact(option?.textContent || control.value || '', 260);
      }
      return compact(control.value || control.getAttribute('value') || '', 260);
    }
    return compact(valueCell.innerText || valueCell.textContent || '', 260);
  }
  return '';
}

function normalizeConnectionFamily(value) {
  const text = String(value || '').trim();
  if (/\bpon\b|\bgpon\b|\bepon\b|\bgcom\b|huawei/i.test(text)) return 'PON';
  if (/ethernet|коммутатор|switch|порт\s+коммутатора|utp|витая\s+пара/i.test(text)) return 'Ethernet';
  return '';
}

function validIpv4(value) {
  const text = String(value || '').trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) return '';
  const parts = text.split('.').map(Number);
  if (parts.some(part => part < 0 || part > 255)) return '';
  return text;
}

function extractGotouserIp(doc) {
  for (const anchor of doc.querySelectorAll('a[href*="gotouser.php"][href*="ip="]')) {
    try {
      const url = new URL(anchor.getAttribute('href') || '', 'https://userside.simnet.kiev.ua/');
      const ip = validIpv4(url.searchParams.get('ip') || '');
      if (ip) return ip;
    } catch {}
  }
  const html = String(doc.documentElement?.innerHTML || '');
  const match = html.match(/gotouser\.php[^"'<>]{0,220}[?&]ip=((?:\d{1,3}\.){3}\d{1,3})/i);
  return validIpv4(match?.[1] || '');
}

function parseBillingTech(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const olt = controlDisplay(doc, 'dopfield_29');
  const onuSerial = controlDisplay(doc, 'dopfield_38');
  const onuMac = normalizeMac(controlDisplay(doc, 'dopfield_19'));
  const subscriberMac = normalizeMac(controlDisplay(doc, 'dopfield_4'));
  const connectionRaw = labeledValue(doc, [/^тип\s+подключ/i, /^тип\s+підключ/i, /^технолог/i, /технологи.{0,35}подключ/i]);
  const connectionFamily = normalizeConnectionFamily(`${connectionRaw} ${olt}`);
  const labeledIp = validIpv4(labeledValue(doc, [/^ip$/i, /^ip[ -]?адрес/i, /^ip[ -]?адреса/i]));
  const usersideIp = extractGotouserIp(doc) || labeledIp;
  return { olt, onuSerial: compact(onuSerial, 100), onuMac, subscriberMac, connectionRaw, connectionFamily, usersideIp };
}

async function getBillingProfile(member) {
  const key = `billing:v2:${memberKey(member)}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  let billingId = String(member.billingId || '');
  if (!billingId) {
    const searchUrl = `https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=listuser&name=${encodeURIComponent(member.contract)}`;
    const search = await runtimeFetch(searchUrl);
    billingId = parseBillingId(responseText(search), member.login);
    if (!billingId) throw new Error(`Billing ID не найден для ${member.login}`);
  }

  const techUrl = `https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=dopdata&parent_type=0&id=${encodeURIComponent(billingId)}&tmpl=1`;
  const tech = await runtimeFetch(techUrl);
  const profile = { ...parseBillingTech(responseText(tech)), billingId };
  await cachePut(key, profile);
  return profile;
}

function parseCustomerIdFromUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''), 'https://userside.simnet.kiev.ua/');
    return url.pathname.match(/^\/customer\/(\d+)\/?$/i)?.[1] || '';
  } catch {
    return '';
  }
}

function unwrapUserSideSearchHtml(result) {
  const data = result?.data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed.data === 'string') return parsed.data;
    } catch {}
    return data;
  }
  if (data && typeof data === 'object' && typeof data.data === 'string') return data.data;
  return JSON.stringify(data ?? '');
}

function parseAjaxCustomerExact(result, member) {
  const html = unwrapUserSideSearchHtml(result);
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const reqLogin = String(member?.login || '').toLowerCase();
  const reqContract = String(member?.contract || '').replace(/\D/g, '');
  const candidates = [];
  const seen = new Set();
  for (const anchor of doc.querySelectorAll('a[href*="/customer/"]')) {
    const id = String(anchor.getAttribute('href') || '').match(/\/customer\/(\d+)/)?.[1] || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const row = anchor.closest('tr,li,div') || anchor.parentElement || doc.body;
    const text = compact(row?.textContent || '', 4000);
    const logins = (text.match(/\babon\d{3,14}\b/ig) || []).map(value => value.toLowerCase());
    const agreements = text.match(/\b\d{3,14}\b/g) || [];
    candidates.push({ id, exact: logins.includes(reqLogin) || agreements.includes(reqContract) });
  }
  const exact = candidates.filter(item => item.exact);
  if (exact.length === 1) return exact[0].id;
  if (!exact.length && candidates.length === 1) return candidates[0].id;
  return '';
}

function parseSearchPageCustomerExact(result, member) {
  const doc = new DOMParser().parseFromString(responseText(result), 'text/html');
  const reqLogin = String(member?.login || '').toLowerCase();
  const reqContract = String(member?.contract || '').replace(/\D/g, '');
  const ids = [];
  for (const row of doc.querySelectorAll('tr.table_item,tr')) {
    const anchor = row.querySelector('a[href*="/customer/"]');
    const id = String(anchor?.getAttribute('href') || '').match(/\/customer\/(\d+)/)?.[1] || '';
    if (!id) continue;
    const agreementCell = row.querySelector('[id$="_agreement_full_Id"]');
    const identityCell = row.querySelector('[id$="_ip_username_Id"]');
    const agreement = compact(agreementCell?.textContent || '', 120).replace(/\D/g, '');
    const login = (compact(identityCell?.textContent || '', 180).match(/\babon\d{3,14}\b/i)?.[0] || '').toLowerCase();
    const rowText = compact(row.textContent || '', 4000).toLowerCase();
    if (agreement === reqContract || login === reqLogin || rowText.includes(reqLogin)) ids.push(id);
  }
  const unique = [...new Set(ids)];
  return unique.length === 1 ? unique[0] : '';
}

async function resolveUserSideCustomer(member, billingProfile = {}) {
  const ip = validIpv4(billingProfile?.usersideIp || '');
  if (ip) {
    try {
      const gotouserUrl = `https://userside.simnet.kiev.ua/script/gotouser.php?ip=${encodeURIComponent(ip)}`;
      const routed = await runtimeFetch(gotouserUrl);
      const customerId = parseCustomerIdFromUrl(routed?.url) || parseCustomerIdFromUrl(routed?.finalUrl);
      if (customerId) {
        state.runtime.gotouserSuccess += 1;
        updateRuntimeUi();
        return { customerId, method: 'gotouser', ip };
      }
    } catch (error) {
      if (error?.code === 'AUDIT_FINISH_HERE') throw error;
      // штатный handoff не сработал — ниже остаётся точный поисковый fallback
    }
  }

  const ajaxUrl = `https://userside.simnet.kiev.ua/customer_list/ajax_search?token=${Date.now()}&search=${encodeURIComponent(member.login)}`;
  const ajax = await runtimeFetch(ajaxUrl);
  let customerId = parseAjaxCustomerExact(ajax, member);
  if (customerId) {
    state.runtime.fallbackSuccess += 1;
    updateRuntimeUi();
    return { customerId, method: 'ajax_search', ip };
  }

  const searchPageUrl = `https://userside.simnet.kiev.ua/customer_list/search_page?search=${encodeURIComponent(member.login)}`;
  const searchPage = await runtimeFetch(searchPageUrl);
  customerId = parseSearchPageCustomerExact(searchPage, member);
  if (customerId) {
    state.runtime.fallbackSuccess += 1;
    updateRuntimeUi();
    return { customerId, method: 'search_page', ip };
  }
  throw new Error(`UserSide карточка не найдена для ${member.login}${ip ? ` (gotouser ${ip} + fallback)` : ' (fallback search)'}`);
}

function unwrapTmcHtml(raw) {
  const text = String(raw == null ? '' : raw);
  const trimmed = text.trim();
  if (!trimmed || !/^[\[{"]/.test(trimmed)) return text;
  try {
    const parsed = JSON.parse(trimmed);
    const pick = value => {
      if (typeof value === 'string') return value;
      if (!value || typeof value !== 'object') return '';
      for (const key of ['html', 'data', 'content', 'response', 'body']) {
        const candidate = pick(value[key]);
        if (candidate && /<\/?[a-z][\s\S]*>/i.test(candidate)) return candidate;
      }
      return '';
    };
    return pick(parsed) || text;
  } catch {
    return text;
  }
}

function parseTmc(html, billingProfile = {}) {
  const parser = globalThis.SIMNET_TMC_PARSER;
  if (!parser?.parseDocument) {
    throw new Error('Общий TMC-парсер Workbench не загружен');
  }
  const source = unwrapTmcHtml(html);
  const doc = new DOMParser().parseFromString(String(source || ''), 'text/html');
  const parsed = parser.parseDocument(doc, {
    expected: {
      onuSerial: billingProfile?.onuSerial || '',
      onuMac: billingProfile?.onuMac || ''
    }
  });
  const item = parsed.item || parsed.candidates?.[0]?.item || {};
  const oltName = compact(item.oltName || '', 220);
  const oltIp = validIpv4(item.oltIp || '');
  const olt = compact([oltName, oltIp ? `(${oltIp})` : ''].filter(Boolean).join(' '), 300);
  return {
    olt,
    oltName,
    oltIp,
    onuSerial: compact(item.serial || '', 100),
    onuMac: normalizeMac(item.mac || ''),
    interface: compact(item.interface || '', 120),
    deviceId: String(item.deviceId || ''),
    tmcParseStatus: parsed.result || 'missing',
    tmcBlockFound: Boolean(parsed.blockFound),
    tmcDeviceLinkFound: Boolean(parsed.deviceLinkFound),
    tmcCandidateCount: Number(parsed.candidateCount || 0),
    tmcParserVersion: parsed.parserVersion || parser.version || '',
    tmcDomTrace: parsed.domTrace || null
  };
}

async function getTmcProfile(member, billingProfile = {}) {
  const parserVersion = globalThis.SIMNET_TMC_PARSER?.version || '';
  const key = `tmc:profile:${memberKey(member)}`;
  const cached = await cacheGet(key);
  // Parsed TMC data is valid only for the parser version that produced it.
  // A parser update therefore invalidates derived data automatically.
  if (cached && cached.tmcParserVersion === parserVersion) return cached;
  const resolved = await resolveUserSideCustomer(member, billingProfile);
  const mainUrl = `https://userside.simnet.kiev.ua/customer/tab?tab=main&id=${encodeURIComponent(resolved.customerId)}`;
  const main = await runtimeFetch(mainUrl);
  const profile = { ...parseTmc(responseText(main), billingProfile), customerId: resolved.customerId, resolver: resolved.method, usersideIp: resolved.ip || billingProfile?.usersideIp || '' };
  await cachePut(key, profile);
  return profile;
}

function resetRuntime(kind, total, message, plannedMax = 0) {
  state.runtime = {
    active: true, kind, paused: false, stopped: false, finishRequested: false,
    plannedMax: Number(plannedMax || 0), requests: 0, billingRequests: 0, userSideRequests: 0,
    gotouserAttempts: 0, gotouserSuccess: 0, ajaxSearchRequests: 0, searchPageRequests: 0,
    tmcMainRequests: 0, fallbackSuccess: 0, cacheHits: 0, inFlight: 0, maxInFlight: 0,
    startedAtMs: Date.now(), totalLatencyMs: 0, requestTimes: [], done: 0, total, message
  };
  updateRuntimeUi();
}

function finishRuntime(message) {
  state.runtime.active = false;
  state.runtime.paused = false;
  state.runtime.message = message;
  updateRuntimeUi();
}

function updateRuntimeUi() {
  const rt = state.runtime;
  $('#pauseBtn').disabled = !rt.active || rt.paused;
  $('#resumeBtn').disabled = !rt.active || !rt.paused;
  $('#stopBtn').disabled = !rt.active;
  const finishButton = $('#finishHereBtn');
  const canFinishHere = Boolean(rt.active && rt.paused);
  finishButton.hidden = !canFinishHere;
  finishButton.disabled = !canFinishHere;
  finishButton.textContent = rt.kind === 'capture' ? '✓ Хватит — взять собранное' : '✓ Хватит — показать проверенное';
  $('#progressText').textContent = rt.message || 'Готов к работе';
  $('#progressCount').textContent = `${rt.done || 0} / ${rt.total || 0}`;
  const percent = rt.total ? Math.min(100, Math.round((rt.done / rt.total) * 100)) : 0;
  $('#progressBar').style.width = `${percent}%`;
  $('#requestCounter').textContent = rt.plannedMax ? `запросы: ${rt.requests || 0} / ≤${rt.plannedMax}` : `запросы: ${rt.requests || 0}`;
  const billing = Number(rt.billingRequests || 0);
  const userside = Number(rt.userSideRequests || 0);
  const breakdown = $('#requestBreakdown');
  if (breakdown) breakdown.textContent = `Billing: ${billing} · UserSide: ${userside}`;
  $('#cacheCounter').textContent = `кэш: ${rt.cacheHits || 0}`;
  const rate = runtimeRatePerMinute(rt);
  const load = runtimeLoadLevel(rate);
  const loadNode = $('#loadCounter');
  if (loadNode) {
    loadNode.classList.remove('load-low', 'load-medium', 'load-high');
    loadNode.classList.add(`load-${load.key}`);
    loadNode.textContent = rt.requests
      ? `нагрузка: ${load.label} · ~${rate} GET/мин · активных ${rt.inFlight || 0}/1`
      : (rt.active ? 'нагрузка: ожидание запросов · активных 0/1' : 'нагрузка: готов');
  }
  const resolver = $('#resolverCounter');
  if (resolver) resolver.textContent = `gotouser: ${rt.gotouserSuccess || 0}/${rt.gotouserAttempts || 0} · fallback: ${rt.fallbackSuccess || 0}`;
}

function extractIpv4FromText(value) {
  const match = String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  return validIpv4(match?.[0] || '');
}

function oltValuesEqual(left, right) {
  const leftRaw = String(left || '').trim();
  const rightRaw = String(right || '').trim();
  if (!leftRaw || !rightRaw) return false;
  const leftIp = extractIpv4FromText(leftRaw);
  const rightIp = extractIpv4FromText(rightRaw);
  if (leftIp && rightIp) return leftIp === rightIp;
  const leftName = normalizeOltName(leftRaw);
  const rightName = normalizeOltName(rightRaw);
  return Boolean(leftName && rightName && leftName === rightName);
}

function mismatchOlt(row) {
  return Boolean(row?.billing?.olt && row?.tmc?.olt && !oltValuesEqual(row.billing.olt, row.tmc.olt));
}

function normalizeSerial(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function oltCompareStatus(row) {
  if (row?.error) return 'error';
  if (row?.tmcLookupError) return 'tmc_unavailable';
  const billingRaw = String(row?.billing?.olt || '').trim();
  const tmcRaw = String(row?.tmc?.olt || '').trim();
  const parseStatus = String(row?.tmc?.tmcParseStatus || '');
  const parserSawBlock = Boolean(row?.tmc?.tmcBlockFound);
  const parserFoundOnlyIp = parseStatus === 'found' && Boolean(row?.tmc?.oltIp) && !row?.tmc?.oltName;
  if (billingRaw && tmcRaw) return oltValuesEqual(billingRaw, tmcRaw) ? 'ok' : 'mismatch';
  if (!billingRaw && tmcRaw) return 'billing_empty';
  if (!tmcRaw && (parseStatus === 'unparsed' || parserSawBlock || parserFoundOnlyIp)) return 'tmc_unparsed';
  if (billingRaw && !tmcRaw) return 'tmc_empty';
  return 'both_empty';
}

function ponReadinessAssessment(row) {
  if (row?.error) {
    return { status: 'error', advice: row.error || 'Ошибка проверки.', nextAction: 'review_error', missingBilling: [], conflicts: [], searchMac: '', fieldStates: {} };
  }

  const billingOltRaw = String(row?.billing?.olt || '').trim();
  const tmcOltRaw = String(row?.tmc?.olt || '').trim();
  const billingSerial = normalizeSerial(row?.billing?.onuSerial);
  const tmcSerial = normalizeSerial(row?.tmc?.onuSerial);
  const billingMac = normalizeMac(row?.billing?.onuMac || '');
  const tmcMac = normalizeMac(row?.tmc?.onuMac || '');
  const subscriberMac = normalizeMac(row?.billing?.subscriberMac || '');
  const searchMac = billingMac || tmcMac || subscriberMac || '';
  const parseStatus = String(row?.tmc?.tmcParseStatus || '');
  const sawTmcBlock = Boolean(row?.tmc?.tmcBlockFound);
  const sawDeviceLink = Boolean(row?.tmc?.tmcDeviceLinkFound);
  const hasTmcValues = Boolean(tmcOltRaw || tmcSerial || tmcMac);

  const fieldStates = {
    olt: !billingOltRaw && !tmcOltRaw ? 'missing_both' : !billingOltRaw ? 'billing_missing' : !tmcOltRaw ? 'tmc_missing' : oltValuesEqual(billingOltRaw, tmcOltRaw) ? 'match' : 'mismatch',
    serial: !billingSerial && !tmcSerial ? 'missing_both' : !billingSerial ? 'billing_missing' : !tmcSerial ? 'tmc_missing' : billingSerial === tmcSerial ? 'match' : 'mismatch',
    mac: !billingMac && !tmcMac ? 'missing_both' : !billingMac ? 'billing_missing' : !tmcMac ? 'tmc_missing' : normalizeCompare(billingMac) === normalizeCompare(tmcMac) ? 'match' : 'mismatch'
  };

  const missingBilling = [];
  if (!billingOltRaw) missingBilling.push('OLT');
  if (!billingSerial) missingBilling.push('S/N');
  if (!billingMac) missingBilling.push('ONU MAC');

  const conflicts = [];
  if (fieldStates.olt === 'mismatch') conflicts.push('OLT');
  if (fieldStates.serial === 'mismatch') conflicts.push('S/N');
  if (fieldStates.mac === 'mismatch') conflicts.push('ONU MAC');

  if (row?.tmcLookupError) {
    return {
      status: 'tmc_unavailable', missingBilling, conflicts, searchMac, fieldStates,
      nextAction: searchMac ? 'search_mac' : 'manual_lookup',
      advice: searchMac
        ? `ТМЦ/карточка не найдена. Следующий источник — поиск MAC ${searchMac} по оборудованию.`
        : 'ТМЦ/карточка не найдена и пригодного MAC пока нет. Нужен ручной поиск дополнительных признаков.'
    };
  }

  if (!hasTmcValues) {
    const parserProblem = parseStatus === 'unparsed' || sawTmcBlock || sawDeviceLink;
    return {
      status: 'tmc_insufficient', missingBilling, conflicts, searchMac, fieldStates,
      nextAction: searchMac ? 'search_mac' : 'manual_lookup',
      advice: searchMac
        ? `${parserProblem ? 'ТМЦ найдена, но нужные значения не извлечены.' : 'ТМЦ не дала OLT/S/N/MAC.'} Следующий источник — поиск MAC ${searchMac} по оборудованию.`
        : `${parserProblem ? 'ТМЦ найдена, но нужные значения не извлечены.' : 'ТМЦ не дала OLT/S/N/MAC.'} MAC для следующего поиска пока не определён.`
    };
  }

  const identityConflicts = conflicts.filter(value => value !== 'OLT');
  if (conflicts.includes('OLT') && identityConflicts.length) {
    return {
      status: 'multiple_conflicts', missingBilling, conflicts, searchMac, fieldStates,
      nextAction: 'review_identity',
      advice: `Одновременно расходятся ${conflicts.join(' + ')}. Сначала подтвердить, что в ТМЦ выбрана именно эта ONU; OLT автоматически не исправлять.`
    };
  }
  if (fieldStates.serial === 'mismatch' && fieldStates.mac === 'mismatch') {
    return { status: 'both_mismatch', missingBilling, conflicts, searchMac, fieldStates, nextAction: 'review_identity', advice: 'Serial и ONU MAC расходятся с ТМЦ. Сначала подтвердить идентичность ONU.' };
  }
  if (fieldStates.serial === 'mismatch') {
    return { status: 'serial_mismatch', missingBilling, conflicts, searchMac, fieldStates, nextAction: 'review_identity', advice: 'S/N в Billing расходится с ТМЦ. Проверить, что найдена правильная ONU, затем исправить данные.' };
  }
  if (fieldStates.mac === 'mismatch') {
    return { status: 'mac_mismatch', missingBilling, conflicts, searchMac, fieldStates, nextAction: 'review_identity', advice: 'ONU MAC в Billing расходится с ТМЦ. Проверить, что найдена правильная ONU, затем исправить данные.' };
  }
  if (fieldStates.olt === 'mismatch') {
    const extra = missingBilling.filter(value => value !== 'OLT');
    return {
      status: 'olt_mismatch', missingBilling, conflicts, searchMac, fieldStates,
      nextAction: 'update_billing',
      advice: `Фактическая OLT в ТМЦ отличается от Billing. Исправить OLT в Billing${extra.length ? ` и дозаполнить ${extra.join(' + ')}` : ''} перед повторным опросом ONU.`
    };
  }

  if (missingBilling.length) {
    const unresolved = missingBilling.filter(field => {
      if (field === 'OLT') return !tmcOltRaw;
      if (field === 'S/N') return !tmcSerial;
      return !tmcMac;
    });
    let status = 'needs_fields';
    if (missingBilling.length === 1 && missingBilling[0] === 'OLT') status = 'needs_olt';
    if (missingBilling.length === 1 && missingBilling[0] === 'S/N') status = 'needs_serial';
    if (missingBilling.length === 1 && missingBilling[0] === 'ONU MAC') status = 'needs_mac';
    if (unresolved.length) {
      return {
        status, missingBilling, conflicts, searchMac, fieldStates,
        nextAction: searchMac ? 'search_mac' : 'manual_lookup',
        advice: `В Billing не заполнено: ${missingBilling.join(' + ')}. Из ТМЦ не удалось добрать: ${unresolved.join(' + ')}.${searchMac ? ` Следующий источник — поиск MAC ${searchMac} по оборудованию.` : ' MAC для следующего поиска пока нет.'}`
      };
    }
    return {
      status, missingBilling, conflicts, searchMac, fieldStates,
      nextAction: 'update_billing',
      advice: `ТМЦ дала недостающие данные. Дозаполнить в Billing: ${missingBilling.join(' + ')}; затем повторить опрос ONU.`
    };
  }

  const tmcMissingForVerification = [];
  if (!tmcOltRaw) tmcMissingForVerification.push('OLT');
  if (!tmcSerial) tmcMissingForVerification.push('S/N');
  if (!tmcMac) tmcMissingForVerification.push('ONU MAC');
  if (tmcMissingForVerification.length) {
    return {
      status: 'tmc_partial', missingBilling, conflicts, searchMac, fieldStates,
      nextAction: searchMac ? 'search_mac' : 'review_tmc',
      advice: `Billing заполнен, но ТМЦ не подтверждает: ${tmcMissingForVerification.join(' + ')}.${searchMac ? ` При необходимости продолжить поиском MAC ${searchMac}.` : ''}`
    };
  }

  return {
    status: 'ready', missingBilling, conflicts, searchMac, fieldStates,
    nextAction: 'poll_ready',
    advice: 'OLT, S/N и ONU MAC согласованы между Billing и ТМЦ. Billing готов к корректному опросу ONU.'
  };
}

function onuIdentityStatus(row) {
  return ponReadinessAssessment(row).status;
}

function rowAdvice(row) {
  return ponReadinessAssessment(row).advice || '';
}

function isProblemStatus(status) {
  return [
    'olt_mismatch', 'mismatch', 'multiple_conflicts',
    'needs_olt', 'needs_serial', 'needs_mac', 'needs_fields',
    'tmc_partial', 'tmc_insufficient', 'tmc_unavailable',
    'billing_empty', 'tmc_empty', 'tmc_unparsed',
    'serial_mismatch', 'mac_mismatch', 'both_mismatch',
    'billing_identity_missing', 'tmc_identity_missing', 'tmc_identity_unparsed', 'error'
  ].includes(status);
}

function auditLabel(mode = state.auditMode) {
  if (mode === 'olt_compare') return 'Сверка OLT Billing ↔ ТМЦ';
  if (mode === 'onu_identity_compare') return 'Готовность ONU / OLT: Billing ↔ ТМЦ';
  return 'Фильтр Billing';
}

async function runAudit({ billingOnly = false } = {}) {
  if (state.runtime.active) return toast('Сначала заверши текущую операцию');
  const members = combineMembers();
  if (!members.length) return toast('Сначала собери или выбери группу');

  const oltMode = state.auditMode === 'olt_compare' && !billingOnly;
  const onuMode = state.auditMode === 'onu_identity_compare' && !billingOnly;
  const compareMode = oltMode || onuMode;
  const billingRules = compareMode ? [] : rulesForSource('billing');
  const tmcRules = compareMode ? [] : rulesForSource('tmc');
  const needsTmc = compareMode || (!billingOnly && (state.afterMode === 'tmc' || tmcRules.length > 0));
  const missingIds = members.filter(member => !member.billingId).length;
  // UserSide worst-case per candidate: gotouser + ajax fallback + search_page fallback + TMC main = <=4 GET.
  const plannedMax = members.length + missingIds + (needsTmc ? members.length * 4 : 0);
  const rows = [];
  resetRuntime('audit', members.length, compareMode ? (onuMode ? 'Billing → оцениваю OLT / S/N / MAC' : 'Billing → читаю OLT') : 'Billing → применяю фильтр', plannedMax);
  await logEvent(compareMode ? 'CHECK' : 'FILTER', `Запуск: ${auditLabel()} · ${members.length} абонентов · максимум ≤${plannedMax} GET`, { auditMode: state.auditMode, members: members.length });
  let partial = false;

  try {
    for (const member of members) {
      await waitForRuntime();
      if (state.runtime.finishRequested) { partial = true; break; }
      const row = { member, billing: {}, tmc: {}, billingMatch: false, matched: false, compareStatus: '', error: '', trace: { subscriber: member.login || member.contract || '', stages: [], startedAt: nowIso() } };
      try {
        row.billing = await getBillingProfile(member);
        row.trace.stages.push({ stage:'billing', ok:true, billingId:row.billing.billingId || member.billingId || '', olt:row.billing.olt || '', serial:row.billing.onuSerial || '', mac:row.billing.onuMac || '', usersideIp:row.billing.usersideIp || '' });
        if (oltMode) row.billingMatch = true;
        else if (onuMode) row.billingMatch = true; // Для проверки готовности всегда идём в ТМЦ: OLT может быть пустой или неверной, а S/N/MAC — недостающими.
        else row.billingMatch = passesRules(row, billingRules);
        row.matched = needsTmc ? false : row.billingMatch;
      } catch (error) {
        if (error?.code === 'AUDIT_FINISH_HERE') { partial = true; break; }
        row.error = error?.message || String(error);
        row.trace?.stages?.push({ stage:'billing', ok:false, error:row.error });
      }
      rows.push(row);
      state.runtime.done += 1;
      state.runtime.message = `Billing: ${member.login}`;
      updateRuntimeUi();
    }

    let candidates;
    if (oltMode) candidates = rows.filter(row => !row.error);
    else if (onuMode) candidates = rows.filter(row => row.billingMatch && !row.error);
    else candidates = rows.filter(row => row.billingMatch && !row.error);

    if (!partial && needsTmc && candidates.length) {
      state.runtime.done = 0;
      state.runtime.total = candidates.length;
      state.runtime.message = onuMode ? 'UserSide / ТМЦ → подтверждаю OLT и добираю S/N/MAC' : (oltMode ? 'UserSide / ТМЦ → сверяю OLT' : 'UserSide / ТМЦ → сверка отобранных');
      updateRuntimeUi();
      for (const row of candidates) {
        await waitForRuntime();
        if (state.runtime.finishRequested) { partial = true; break; }
        try {
          row.tmc = await getTmcProfile(row.member, row.billing);
          row.trace.stages.push({ stage:'tmc', ok:true, customerId:row.tmc.customerId || '', resolver:row.tmc.resolver || '', parseStatus:row.tmc.tmcParseStatus || '', blockFound:Boolean(row.tmc.tmcBlockFound), deviceLinkFound:Boolean(row.tmc.tmcDeviceLinkFound), olt:row.tmc.olt || '', oltIp:row.tmc.oltIp || '', interface:row.tmc.interface || '', serial:row.tmc.onuSerial || '', mac:row.tmc.onuMac || '', domTrace:row.tmc.tmcDomTrace || null });
          if (oltMode) {
            row.compareStatus = oltCompareStatus(row);
            row.matched = isProblemStatus(row.compareStatus);
          } else if (onuMode) {
            row.compareStatus = onuIdentityStatus(row);
            row.matched = isProblemStatus(row.compareStatus);
          } else {
            row.matched = passesRules(row, tmcRules);
          }
        } catch (error) {
          if (error?.code === 'AUDIT_FINISH_HERE') { partial = true; break; }
          const message = error?.message || String(error);
          if (onuMode && /UserSide карточка не найдена/i.test(message)) {
            row.tmcLookupError = message;
            row.compareStatus = 'tmc_unavailable';
            row.matched = true;
            row.trace?.stages?.push({ stage:'tmc', ok:false, kind:'not_found', error:message });
          } else {
            row.error = row.error || message;
            row.compareStatus = 'error';
            row.matched = true;
            row.trace?.stages?.push({ stage:'tmc', ok:false, kind:'request_or_parser_error', error:row.error });
          }
        }
        state.runtime.done += 1;
        state.runtime.message = `ТМЦ: ${row.member.login}`;
        updateRuntimeUi();
      }
    }

    if (oltMode || onuMode) {
      for (const row of rows) {
        if (!row.compareStatus) row.compareStatus = onuMode ? onuIdentityStatus(row) : oltCompareStatus(row);
        row.matched = isProblemStatus(row.compareStatus);
        const assessment = onuMode ? ponReadinessAssessment(row) : null;
        row.trace.stages.push({ stage:'decision', status:row.compareStatus, problem:row.matched, advice:assessment?.advice || '', nextAction:assessment?.nextAction || '', missingBilling:assessment?.missingBilling || [], conflicts:assessment?.conflicts || [], searchMac:assessment?.searchMac || '', fieldStates:assessment?.fieldStates || {} });
        row.trace.finishedAt = nowIso();
      }
    }

    state.rows = rows;
    const matched = rows.filter(row => row.matched);
    const run = {
      id: uid('run'), createdAt: nowIso(), groups: [...state.selectedIds], groupNames: selectedGroups().map(group => group.name),
      mode: state.mode, auditMode: state.auditMode, label: auditLabel(), rules: JSON.parse(JSON.stringify(state.rules)), afterMode: needsTmc ? 'tmc' : 'billing',
      checked: rows.length, matched: matched.length, requests: state.runtime.requests, cacheHits: state.runtime.cacheHits,
      errors: rows.filter(row => row.error).length, partial, network: runtimeNetworkSnapshot(), rows: JSON.parse(JSON.stringify(rows))
    };
    await db.put('runs', run);
    state.lastRun = run;
    await renderStorageStats();
    await logEvent(partial ? 'PARTIAL' : 'DONE', `${run.label}: ${rows.length} обработано · ${matched.length} ${compareMode ? 'проблем' : 'отобрано'} · ${state.runtime.requests} GET (Billing ${run.network.billingRequests} / UserSide ${run.network.userSideRequests}) · gotouser ${run.network.gotouserSuccess}/${run.network.gotouserAttempts} · fallback ${run.network.fallbackSuccess} · ~${run.network.avgRequestsPerMinute} GET/мин${partial ? ' · частичный результат' : ''}`, { runId: run.id, network: run.network, categories: rows.reduce((acc,row)=>{ const k=row.compareStatus || (row.error?'error':'other'); acc[k]=(acc[k]||0)+1; return acc; },{}), trace: rows.map(row=>row.trace) });
    finishRuntime(partial
      ? `Остановлено здесь: ${rows.length} обработано · ${matched.length} ${compareMode ? 'проблем' : 'отобрано'}`
      : `Готово: ${rows.length} обработано · ${matched.length} ${compareMode ? 'проблем' : 'отобрано'}`);
    if (state.wizard.runningPhase === 'filter') {
      state.wizard.filterCompleted = true;
      state.wizard.filterMembers = matched.map(row => row.member);
      state.wizard.filterRunId = run.id;
      state.wizard.runningPhase = '';
      scheduleWorkspaceDraftSave();
      renderWizardFilterState();
      setWizardStep(2);
    } else if (state.wizard.runningPhase === 'check') {
      state.wizard.checkCompleted = true;
      state.wizard.resultSaved = false;
      state.wizard.resultRows = rows;
      state.wizard.resultMeta = run;
      state.wizard.runningPhase = '';
      scheduleWorkspaceDraftSave();
      renderWizardResults();
      setWizardStep(6);
    } else {
      setView('results');
    }
  } catch (error) {
    const stopped = state.runtime.stopped;
    finishRuntime(stopped ? 'Отменено оператором' : `Ошибка: ${error?.message || error}`);
    await logEvent(stopped ? 'CANCEL' : 'ERROR', stopped ? `${auditLabel()} отменена оператором` : `Ошибка ${auditLabel()}: ${error?.message || error}`);
    if (!stopped) toast(error?.message || String(error));
  }
}
function renderResults() {
  const rows = state.rows || [];
  const selectedCount = rows.filter(row => row.matched).length;
  const errors = rows.filter(row => row.error).length;
  const compareMode = ['olt_compare', 'onu_identity_compare'].includes(state.auditMode);
  $('#statChecked').textContent = rows.length;
  $('#statMatched').textContent = selectedCount;
  $('#statMatchedLabel').textContent = compareMode ? 'Расхождения / проблемы' : 'Отобрано';
  $('#statErrors').textContent = errors;
  $('#statCache').textContent = state.lastRun?.cacheHits ?? state.runtime.cacheHits ?? 0;
  const sourceName = selectedGroups().map(group => group.name).join(' + ') || 'Текущий набор';
  $('#resultSubtitle').textContent = rows.length ? `${sourceName} · ${selectedCount} ${compareMode ? 'проблем / расхождений' : 'прошли фильтр'}` : 'Запусти проверку, чтобы получить результат.';
  $('#saveFilteredGroupBtn').hidden = state.auditMode !== 'custom' || !rows.length;
  $('#saveResultBtn').hidden = state.auditMode === 'custom';
  $('#problemsOnlyLabel').textContent = compareMode ? 'только проблемы / расхождения' : 'только прошедшие фильтр';

  const query = normalizeCompare($('#resultSearch').value);
  const problemsOnly = $('#problemsOnly').checked;
  const filtered = rows.filter(row => {
    const status = row.compareStatus || (state.auditMode === 'onu_identity_compare' ? onuIdentityStatus(row) : oltCompareStatus(row));
    const selected = compareMode ? isProblemStatus(status) : Boolean(row.matched);
    if (problemsOnly && !selected) return false;
    if (!query) return true;
    const haystack = normalizeCompare([
      row.member?.login, row.member?.contract,
      row.billing?.connectionFamily, row.billing?.connectionRaw,
      row.billing?.olt, row.tmc?.olt,
      row.billing?.onuSerial, row.tmc?.onuSerial,
      row.billing?.onuMac, row.tmc?.onuMac,
      row.error, row.tmcLookupError, state.auditMode === 'onu_identity_compare' ? rowAdvice(row) : ''
    ].join(' '));
    return haystack.includes(query);
  });

  $('#resultBody').innerHTML = filtered.length ? filtered.map(row => {
    let cls, label;
    if (state.auditMode === 'olt_compare') [cls, label] = markerInfo({ status: row.compareStatus || oltCompareStatus(row) });
    else if (state.auditMode === 'onu_identity_compare') [cls, label] = markerInfo({ status: row.compareStatus || onuIdentityStatus(row) });
    else [cls, label] = row.error ? ['bad', 'ERROR'] : row.matched ? ['ok', 'ПРОШЁЛ'] : ['muted', 'НЕ ПРОШЁЛ'];
    return `
      <tr>
        <td><span class="cell-main">${esc(row.member?.login || row.member?.contract || '—')}</span><span class="cell-sub">Billing ID ${esc(row.billing?.billingId || row.member?.billingId || '—')}${row.billing?.connectionFamily ? ` · ${esc(row.billing.connectionFamily)}` : ''}</span></td>
        <td>${esc(row.billing?.olt || '—')}</td>
        <td><span class="cell-main">${esc(row.tmc?.olt || '—')}</span>${row.tmc?.tmcParseStatus ? `<span class="cell-sub">TMC: ${esc(row.tmc.tmcParseStatus)} · block ${row.tmc.tmcBlockFound ? '✓' : '—'} · link ${row.tmc.tmcDeviceLinkFound ? '✓' : '—'}</span>` : ''}</td>
        <td><span class="cell-main">${esc(row.billing?.onuSerial || '—')}</span>${row.tmc?.onuSerial ? `<span class="cell-sub">ТМЦ: ${esc(row.tmc.onuSerial)}</span>` : ''}</td>
        <td><span class="cell-main">${esc(row.billing?.onuMac || '—')}</span>${row.tmc?.onuMac ? `<span class="cell-sub">ТМЦ: ${esc(row.tmc.onuMac)}</span>` : ''}</td>
        <td><span class="result-pill ${cls}" title="${esc(row.error || row.tmcLookupError || '')}">${esc(label)}</span>${state.auditMode === 'onu_identity_compare' ? `<span class="cell-sub">${esc(rowAdvice(row))}</span>` : ''}</td>
      </tr>
    `;
  }).join('') : '<tr class="empty-table"><td colspan="6">Нет строк для выбранного фильтра.</td></tr>';
}

async function saveFilteredGroupModal() {
  if (state.auditMode !== 'custom' || !state.rows.length || !state.lastRun) return toast('Сначала примени фильтр');
  const passed = state.rows.filter(row => row.matched && !row.error).map(row => row.member);
  if (!passed.length) return toast('По фильтру никто не отобран');
  const sourceGroups = selectedGroups();
  openModal({
    title: `Сохранить отобранных · ${passed.length} абонентов`,
    body: `
      <div class="modal-tip"><b>Создаётся новая группа только из прошедших фильтр.</b><span>Исходный текущий сбор при этом не меняется.</span></div>
      <label style="margin-top:12px">Название группы</label><input type="text" data-group-name placeholder="Например: PON · 5 страниц">
      <label style="margin-top:10px">Для чего (необязательно)</label><input type="text" data-group-purpose placeholder="Например: последующая сверка ONU Serial/MAC">
      <label style="margin-top:10px">Цвет</label>${colorPickerHtml('green')}
    `,
    confirmText: 'Создать группу',
    onConfirm: async modal => {
      const name = modal.querySelector('[data-group-name]').value.trim();
      if (!name) throw new Error('Укажи название группы');
      const purpose = modal.querySelector('[data-group-purpose]')?.value.trim() || '';
      const color = modal.querySelector('[data-color].active')?.dataset.color || 'green';
      const sourceCaptures = sourceGroups.flatMap(g => Array.isArray(g.source?.captures) ? g.source.captures : []);
      const group = await saveGroup({
        name,
        members: passed,
        color,
        purpose,
        source: { type: 'filtered-result', runId: state.lastRun.id, sourceGroups: sourceGroups.map(g => g.id), captures: sourceCaptures, capturedAt: nowIso() },
        lineage: { operation: 'filter', rules: JSON.parse(JSON.stringify(state.rules)), sourceGroups: sourceGroups.map(g => ({ id: g.id, name: g.name })) }
      });
      group.history = [...(group.history || []), { id: uid('gh'), type: 'filter', createdAt: nowIso(), message: `Создано из фильтра «${state.rules.map(ruleHuman).join(' AND ')}» · ${passed.length} из ${state.rows.length}` }];
      await db.put('groups', group);
      await loadGroups();
        state.selectedIds = [group.id];
      scheduleWorkspaceDraftSave();
      renderSelectedGroups();
      setView('builder');
      toast(`Группа «${name}» создана: ${passed.length}`);
    }
  });
  bindColorPicker($('.modal'));
}

async function saveResultModal() {
  if (!state.rows.length || !state.lastRun) return toast('Сначала запусти проверку');
  if (state.auditMode === 'custom') return toast('Для фильтра используй «Сохранить отобранных как группу»');
  const groups = selectedGroups();
  if (groups.length !== 1 || groups[0].transient) return toast('Для фиксации проверки выбери одну сохранённую группу');
  const group = state.groups.find(item => item.id === groups[0].id);
  if (!group) return toast('Сохранённая группа не найдена');
  const markers = {};
  let ok = 0, problem = 0, unknown = 0;
  const issueMembers = [];
  for (const row of state.rows) {
    const status = state.auditMode === 'onu_identity_compare' ? onuIdentityStatus(row) : oltCompareStatus(row);
    const assessment = state.auditMode === 'onu_identity_compare' ? ponReadinessAssessment(row) : null;
    markers[memberKey(row.member)] = {
      status,
      billingOlt: row.billing?.olt || '',
      tmcOlt: row.tmc?.olt || '',
      tmcOltName: row.tmc?.oltName || '',
      tmcOltIp: row.tmc?.oltIp || '',
      tmcParseStatus: row.tmc?.tmcParseStatus || '',
      tmcBlockFound: Boolean(row.tmc?.tmcBlockFound),
      tmcDeviceLinkFound: Boolean(row.tmc?.tmcDeviceLinkFound),
      tmcParserVersion: row.tmc?.tmcParserVersion || '',
      billingSerial: row.billing?.onuSerial || '',
      tmcSerial: row.tmc?.onuSerial || '',
      billingMac: row.billing?.onuMac || '',
      tmcMac: row.tmc?.onuMac || '',
      resolver: row.tmc?.resolver || '',
      usersideIp: row.tmc?.usersideIp || row.billing?.usersideIp || '',
      advice: assessment?.advice || '',
      nextAction: assessment?.nextAction || '',
      missingBilling: assessment?.missingBilling || [],
      conflicts: assessment?.conflicts || [],
      searchMac: assessment?.searchMac || '',
      fieldStates: assessment?.fieldStates || {},
      error: row.error || row.tmcLookupError || ''
    };
    if (['ok', 'ready'].includes(status)) ok += 1;
    else if (isProblemStatus(status)) { problem += 1; issueMembers.push(memberKey(row.member)); }
    else unknown += 1;
  }
  const snapshot = {
    type: state.auditMode,
    label: auditLabel(),
    runId: state.lastRun.id,
    savedAt: nowIso(),
    partial: Boolean(state.lastRun.partial),
    checked: state.rows.length,
    summary: { ok, problem, unknown },
    issueMembers,
    markers,
    network: state.lastRun?.network || runtimeNetworkSnapshot()
  };
  group.auditSnapshot = snapshot;
  group.auditHistory = [...(group.auditHistory || []), snapshot];
  group.history = [...(group.history || []), { id: uid('gh'), type: 'check', createdAt: nowIso(), message: `${snapshot.label} · проверено ${snapshot.checked} · проблем ${problem}${snapshot.partial ? ' · частично' : ''}` }];
  group.updatedAt = nowIso();
  await db.put('groups', group);
  await logEvent('SAVE', `В группе «${group.name}» зафиксирована проверка «${snapshot.label}» · ${problem} проблем из ${snapshot.checked}`, { groupId: group.id, runId: snapshot.runId });
  await loadGroups();
  toast(`Проверка зафиксирована в «${group.name}»: ${problem} проблем`);
}
function csvCell(value) {
  const text = String(value == null ? '' : value).replace(/"/g, '""');
  return `"${text}"`;
}

function exportCsv() {
  if (!state.rows.length) return toast('Нет результатов');
  const lines = [
    ['subscriber', 'billing_id', 'billing_olt', 'tmc_olt', 'billing_serial', 'tmc_serial', 'billing_onu_mac', 'tmc_onu_mac', 'status', 'next_action', 'advice', 'problem', 'error'].map(csvCell).join(',')
  ];
  for (const row of state.rows) {
    const assessment = state.auditMode === 'onu_identity_compare' ? ponReadinessAssessment(row) : null;
    const status = row.compareStatus || (state.auditMode === 'onu_identity_compare' ? assessment?.status : oltCompareStatus(row));
    lines.push([
      row.member?.login || row.member?.contract || '', row.billing?.billingId || row.member?.billingId || '', row.billing?.olt || '', row.tmc?.olt || '',
      row.billing?.onuSerial || '', row.tmc?.onuSerial || '', row.billing?.onuMac || '', row.tmc?.onuMac || '', status || '', assessment?.nextAction || '', assessment?.advice || '', row.matched ? '1' : '0', row.error || row.tmcLookupError || ''
    ].map(csvCell).join(','));
  }
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `simnet_data_audit_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveRulePreset() {
  if (!state.rules.length) return toast('Нет условий для сохранения');
  const name = prompt('Название правила:', 'Проверка техданных');
  if (!name) return;
  await db.put('rules', { id: uid('ruleset'), name: compact(name, 120), rules: JSON.parse(JSON.stringify(state.rules)), afterMode: state.afterMode, createdAt: nowIso() });
  await renderStorageStats();
  toast('Правило сохранено');
}

function setHostInfo(info) {
  state.hostInfo = info || null;
  const canCapture = Boolean(info?.canCaptureBillingList);
  $('#captureBillingBtn').disabled = !canCapture;
  if (canCapture) {
    const estimate = info?.captureEstimate || {};
    const rows = Number(estimate.currentMembers || 0);
    const page = Number(estimate.currentPage || 1);
    $('#captureHint').textContent = `Страница ${page} · ${rows || '—'} абонентов · 0 GET · добавится в текущий сбор`;
  } else {
    $('#captureHint').textContent = 'Открой любую Billing → listuser';
  }
  $('#hostLabel').textContent = info ? `${info.system || info.host} · ${info.pageKind || info.title || ''}` : 'SIMNET Workbench · ожидание страницы';
  renderWizardSource();
}

function applyAuditModeUi() {
  const select = $('#auditType');
  if (select) select.value = state.auditMode;
  const custom = $('#customRulesWrap');
  if (custom) custom.hidden = state.auditMode !== 'custom';
  const hint = $('#auditTypeHint');
  if (hint) {
    if (state.auditMode === 'olt_compare') hint.textContent = 'Для каждого абонента читаем Billing OLT и ТМЦ OLT. Состав группы не меняется — сохраняются только отметки.';
    else if (state.auditMode === 'onu_identity_compare') hint.textContent = 'Главная цель — подтвердить фактическую OLT. Для каждого абонента читаем Billing, затем ТМЦ: сверяем OLT и одновременно добираем/проверяем S/N и ONU MAC. Если ТМЦ не дала данных — результат подскажет следующий шаг: поиск MAC по оборудованию.';
    else hint.textContent = 'Отбираем абонентов по Billing. Прошедших можно сохранить как новую группу.';
  }
  $('#collectBtn').hidden = true;
  $('#saveRuleBtn').hidden = state.auditMode !== 'custom';
  const runBtn = $('#runBtn');
  if (state.auditMode === 'custom') runBtn.innerHTML = 'Применить фильтр <span>▶</span>';
  else if (state.auditMode === 'onu_identity_compare') runBtn.innerHTML = 'Проверить готовность ONU / OLT <span>▶</span>';
  else runBtn.innerHTML = 'Запустить сверку OLT <span>▶</span>';
  updatePlans();
}

function currentCollectionDraft() {
  return state.transientGroups.find(group => group.collectionDraft === true) || null;
}

function wizardGroup() {
  return state.groups.find(group => group.id === state.wizard.groupId) || null;
}

function wizardMaxUnlocked() {
  let max = 1;
  const draft = currentCollectionDraft();
  if (draft?.memberCount) max = 2;
  if (state.wizard.filterCompleted && (state.wizard.filterMembers || []).length) max = 3;
  if (wizardGroup()) max = 4;
  if (wizardGroup() && state.wizard.checkMode) max = 5;
  if (state.wizard.checkCompleted && state.rows.length) max = 6;
  return max;
}

function setWizardStep(step, { force = false } = {}) {
  const target = Math.max(1, Math.min(6, Number(step || 1)));
  const max = wizardMaxUnlocked();
  if (!force && target > max) return toast('Сначала заверши текущий шаг');
  if (state.runtime.active && target !== state.wizard.step) return toast('Сначала поставь процесс на паузу или дождись завершения');
  state.wizard.step = target;
  $$('.wizard-view').forEach(node => node.classList.toggle('active', node.id === `wizardStep${target}`));
  $$('.wizard-step').forEach(node => {
    const n = Number(node.dataset.wstep || 0);
    node.classList.toggle('active', n === target);
    node.classList.toggle('done', n < target && n <= max);
    node.disabled = n > max;
  });
  const titles = {
    1:['Сначала соберём абонентов','Укажи, сколько страниц текущей Billing-выборки забрать.'],
    2:['Теперь отберём нужных','Например, оставим только абонентов с PON-подключением.'],
    3:['Сохраним результат как группу','Дай группе понятное имя и цвет.'],
    4:['Выберем проверку','Группа уже сохранена. Теперь реши, что именно сверять.'],
    5:['Проверим нагрузку','Перед запуском видно верхнюю оценку запросов.'],
    6:['Посмотрим результат','Зафиксируй проверку в истории группы или вернись назад.']
  };
  const [title, subtitle] = titles[target];
  $('#wizardTitle').textContent = title;
  $('#wizardSubtitle').textContent = subtitle;
  $('#wizardJournalPanel').hidden = true;
  renderWizardAll();
  scheduleWorkspaceDraftSave();
}

function renderWizardSource() {
  const info = state.hostInfo || {};
  const ready = Boolean(info.canCaptureBillingList);
  const estimate = info.captureEstimate || {};
  const currentPage = Number(estimate.currentPage || 1);
  const count = Math.min(20, Math.max(1, Number(state.wizard.pageCount || 5)));
  state.wizard.pageCount = count;
  $('#pageCountRange').value = String(count);
  $('#pageCountValue').textContent = String(count);
  $('#wizardCaptureBtn').textContent = `Собрать ${count} ${count === 1 ? 'страницу' : (count < 5 ? 'страницы' : 'страниц')}`;
  $('#wizardCaptureBtn').disabled = !ready || state.runtime.active;
  $('#wizardSourceReady').textContent = ready ? 'готово' : 'не готово';
  $('#wizardSourceReady').className = `wizard-state ${ready ? 'ok' : 'bad'}`;
  $('#wizardSourceHost').textContent = ready
    ? `Сейчас открыта страница ${currentPage}. На ней найдено примерно ${Number(estimate.currentMembers || 0)} абонентов.`
    : 'Открой Billing → listuser с нужной улицей/фильтрами.';
  if (ready) {
    const end = currentPage + count - 1;
    $('#pagePlanText').innerHTML = `Возьмём <b>страницы ${currentPage}${count > 1 ? `–${end}` : ''}</b> этой же Billing-выборки. Текущая страница = 0 GET, следующие — максимум <b>${Math.max(0, count - 1)} GET</b>.`;
  } else {
    $('#pagePlanText').textContent = 'Сначала открой Billing → listuser. После этого здесь появится точный диапазон страниц.';
  }
  const draft = currentCollectionDraft();
  const captures = Array.isArray(draft?.source?.captures) ? draft.source.captures : [];
  $('#collectionPages').textContent = String(captures.length || 0);
  $('#collectionMembers').textContent = String(draft?.memberCount || 0);
  $('#collectionRequests').textContent = String(state.wizard.captureRequests || 0);
  $('#collectionStatusText').textContent = draft?.memberCount
    ? `Сейчас в рабочем сборе ${draft.memberCount} уникальных абонентов. Можно добавить ещё страницы или перейти к отбору.`
    : 'Сбор ещё не запускался.';
  $('#wizardStep1Next').disabled = !(draft?.memberCount) || state.runtime.active;
}

function renderWizardFilterState() {
  const draft = currentCollectionDraft();
  const total = Number(draft?.memberCount || 0);
  $('#filterPlanMembers').textContent = String(total);
  const mode = state.wizard.filterMode;
  const selected = document.querySelector(`input[name="wizardFilter"][value="${mode}"]`);
  if (selected) selected.checked = true;
  if (mode === 'pon') {
    $('#filterHumanText').innerHTML = `Из <b>${total}</b> собранных абонентов оставим только тех, у кого Billing определяет технологию как <b>PON</b>. Для этого потребуется до <b>${total} GET</b> к техданным Billing, но кэш может уменьшить число.`;
    $('#filterPlanRequests').textContent = `≤ ${total}`;
  } else if (mode === 'all') {
    $('#filterHumanText').innerHTML = `Оставим <b>всех ${total}</b> собранных абонентов. Дополнительных запросов для отбора не будет.`;
    $('#filterPlanRequests').textContent = '0';
  } else {
    $('#filterHumanText').textContent = 'Сначала выбери, кого оставить. До этого запуск недоступен.';
    $('#filterPlanRequests').textContent = '—';
  }
  $('#wizardFilterRun').disabled = !total || !mode || state.runtime.active;
  const filtered = uniqueMembers(state.wizard.filterMembers || []);
  const summary = $('#filterResultSummary');
  if (state.wizard.filterCompleted) {
    summary.hidden = false;
    summary.innerHTML = `Готово: из <b>${total}</b> дальше идут <b>${filtered.length}</b> абонентов. Исключено: <b>${Math.max(0, total - filtered.length)}</b>.`;
  } else summary.hidden = true;
  $('#wizardStep2Next').disabled = !state.wizard.filterCompleted || !filtered.length || state.runtime.active;
}

function renderWizardGroupState() {
  const members = uniqueMembers(state.wizard.filterMembers || []);
  $('#wizardGroupCount').textContent = String(members.length);
  const group = wizardGroup();
  if (group) {
    state.wizard.groupName = group.name || '';
    state.wizard.groupPurpose = group.purpose || '';
    if (!$('#wizardGroupName').matches(':focus')) $('#wizardGroupName').value = state.wizard.groupName;
    if (!$('#wizardGroupPurpose').matches(':focus')) $('#wizardGroupPurpose').value = state.wizard.groupPurpose;
    state.wizard.groupColor = group.color || state.wizard.groupColor || 'blue';
    $('#wizardGroupSave').textContent = 'Сохранить изменения';
    $('#wizardGroupSaved').hidden = false;
    $('#wizardGroupSaved').innerHTML = `Группа <b>«${esc(group.name)}»</b> сохранена · ${group.memberCount || group.members?.length || 0} абонентов.`;
  } else {
    if (!$('#wizardGroupName').matches(':focus')) $('#wizardGroupName').value = state.wizard.groupName || '';
    if (!$('#wizardGroupPurpose').matches(':focus')) $('#wizardGroupPurpose').value = state.wizard.groupPurpose || '';
    $('#wizardGroupSave').textContent = 'Создать группу';
    $('#wizardGroupSaved').hidden = true;
  }
  $$('[data-wizard-color]').forEach(button => button.classList.toggle('active', button.dataset.wizardColor === state.wizard.groupColor));
  $('#wizardGroupSave').disabled = !members.length || !$('#wizardGroupName').value.trim() || state.runtime.active;
  $('#wizardStep3Next').disabled = !group || state.runtime.active;
}

function renderWizardCheckState() {
  const group = wizardGroup();
  $('#wizardCheckGroupLabel').textContent = group ? `Группа «${group.name}» · ${group.memberCount || group.members?.length || 0} абонентов. Состав группы не будет меняться.` : 'Сначала должна быть создана или выбрана сохранённая группа.';
  const mode = state.wizard.checkMode;
  const selected = document.querySelector(`input[name="wizardCheck"][value="${mode}"]`);
  if (selected) selected.checked = true;
  if (mode === 'onu_identity_compare') $('#checkHumanText').innerHTML = '<b>Как пройдёт проверка:</b> Billing → ТМЦ для каждого абонента → подтверждаем фактическую OLT → одновременно сверяем или добираем S/N и ONU MAC. Пустое поле Billing не считается mismatch: если значение есть в ТМЦ, получим совет дозаполнить Billing. Если ТМЦ не дала данных, следующим шагом будет поиск MAC по оборудованию.';
  else if (mode === 'olt_compare') $('#checkHumanText').innerHTML = '<b>Как пройдёт проверка:</b> читаем OLT в Billing → идём в ТМЦ → сравниваем найденную OLT → ставим отметку каждому абоненту.';
  else $('#checkHumanText').textContent = 'Выбери тип проверки. Состав группы не изменится.';
  $('#wizardStep4Next').disabled = !group || !mode || state.runtime.active;
}

function renderWizardPlan() {
  const group = wizardGroup();
  const members = uniqueMembers(group?.members || []);
  const count = members.length;
  const missing = members.filter(member => !member.billingId).length;
  const billingMax = count + missing;
  const tmcMax = count * 4;
  const max = billingMax + tmcMax;
  $('#wizardPlanMembers').textContent = String(count);
  $('#wizardPlanBilling').textContent = `≤ ${billingMax}`;
  $('#wizardPlanTmc').textContent = `0–${tmcMax}`;
  $('#wizardPlanMax').textContent = `≤ ${max}`;
  const label = state.wizard.checkMode === 'onu_identity_compare' ? 'Готовность ONU / OLT: Billing ↔ ТМЦ' : 'OLT Billing ↔ ТМЦ';
  $('#wizardPlanHuman').innerHTML = group ? `Будет запущена проверка <b>${esc(label)}</b> для группы <b>«${esc(group.name)}»</b>. Для UserSide сначала используется штатный переход <b>gotouser.php?ip=…</b> из Billing; поиск по login/договору — только fallback. Запросы идут последовательно — по одному. В любой момент можно нажать <b>Пауза</b>, затем продолжить или принять уже проверенное.` : 'Группа не выбрана.';
  $('#wizardRunCheck').disabled = !group || !state.wizard.checkMode || state.runtime.active;
}

function renderWizardResults() {
  const rows = state.rows || [];
  const group = wizardGroup();
  const problems = rows.filter(row => isProblemStatus(row.compareStatus || (state.wizard.checkMode === 'onu_identity_compare' ? onuIdentityStatus(row) : oltCompareStatus(row)))).length;
  const errors = rows.filter(row => row.error).length;
  $('#wizardStatChecked').textContent = String(rows.length);
  $('#wizardStatProblems').textContent = String(problems);
  $('#wizardStatErrors').textContent = String(errors);
  $('#wizardStatCache').textContent = String(state.lastRun?.cacheHits ?? state.runtime.cacheHits ?? 0);
  const network = state.lastRun?.network || (rows.length ? runtimeNetworkSnapshot() : null);
  const networkNode = $('#wizardNetworkSummary');
  if (networkNode) {
    networkNode.innerHTML = network
      ? `<b>Сеть:</b> ${network.requests || 0} GET · Billing ${network.billingRequests || 0} · UserSide ${network.userSideRequests || 0} · gotouser ${network.gotouserSuccess || 0}/${network.gotouserAttempts || 0} · fallback ${network.fallbackSuccess || 0} · средняя скорость ~${network.avgRequestsPerMinute || 0} GET/мин · средний ответ ${network.avgLatencyMs || 0} мс · максимум одновременно ${network.maxInFlight || 0}/1.`
      : 'Сетевая статистика появится после запуска.';
  }
  $('#wizardResultSubtitle').textContent = rows.length && group ? `Группа «${group.name}» · проверено ${rows.length} · проблем ${problems}${state.lastRun?.partial ? ' · частичный результат' : ''}` : 'Проверка ещё не запускалась.';
  const q = normalizeCompare($('#wizardResultSearch')?.value || '');
  const problemsOnly = Boolean($('#wizardProblemsOnly')?.checked);
  const visible = rows.filter(row => {
    const status = row.compareStatus || (state.wizard.checkMode === 'onu_identity_compare' ? onuIdentityStatus(row) : oltCompareStatus(row));
    if (problemsOnly && !isProblemStatus(status)) return false;
    if (!q) return true;
    return normalizeCompare([row.member?.login,row.billing?.olt,row.tmc?.olt,row.billing?.onuSerial,row.tmc?.onuSerial,row.billing?.onuMac,row.tmc?.onuMac,row.error,row.tmcLookupError,rowAdvice(row)].join(' ')).includes(q);
  });
  $('#wizardResultBody').innerHTML = visible.length ? visible.map(row => {
    const status = row.compareStatus || (state.wizard.checkMode === 'onu_identity_compare' ? onuIdentityStatus(row) : oltCompareStatus(row));
    const [cls,label] = markerInfo({ status });
    return `<tr><td><span class="cell-main">${esc(row.member?.login || '—')}</span><span class="cell-sub">Billing ID ${esc(row.billing?.billingId || row.member?.billingId || '—')}</span></td><td>${esc(row.billing?.olt || '—')}</td><td>${esc(row.tmc?.olt || '—')}</td><td><span class="cell-main">${esc(row.billing?.onuSerial || '—')}</span>${row.tmc?.onuSerial ? `<span class="cell-sub">ТМЦ: ${esc(row.tmc.onuSerial)}</span>` : ''}</td><td><span class="cell-main">${esc(row.billing?.onuMac || '—')}</span>${row.tmc?.onuMac ? `<span class="cell-sub">ТМЦ: ${esc(row.tmc.onuMac)}</span>` : ''}</td><td><span class="result-pill ${cls}" title="${esc(row.error || row.tmcLookupError || '')}">${esc(label)}</span>${state.wizard.checkMode === 'onu_identity_compare' ? `<span class="cell-sub">${esc(rowAdvice(row))}</span>` : ''}</td></tr>`;
  }).join('') : '<tr class="empty-table"><td colspan="6">Нет строк для отображения.</td></tr>';
  $('#wizardFixResult').disabled = !rows.length || !group || state.wizard.resultSaved;
  $('#wizardFixResult').textContent = state.wizard.resultSaved ? 'Проверка зафиксирована ✓' : 'Зафиксировать проверку в группе';
  $('#wizardOpenGroup').disabled = !group;
}

function renderWizardAll() {
  renderWizardSource();
  renderWizardFilterState();
  renderWizardGroupState();
  renderWizardCheckState();
  renderWizardPlan();
  renderWizardResults();
  const max = wizardMaxUnlocked();
  $$('.wizard-step').forEach(node => {
    const n = Number(node.dataset.wstep || 0);
    node.disabled = n > max;
    node.classList.toggle('active', n === state.wizard.step);
    node.classList.toggle('done', n < state.wizard.step && n <= max);
  });
}

async function runWizardFilter() {
  const draft = currentCollectionDraft();
  if (!draft?.memberCount) return toast('Сначала собери страницы Billing');
  if (!state.wizard.filterMode) return toast('Выбери, кого оставить');
  state.wizard.filterCompleted = false;
  state.wizard.filterMembers = [];
  state.wizard.groupId = '';
  state.wizard.checkMode = '';
  state.wizard.checkCompleted = false;
  state.wizard.resultSaved = false;
  state.wizard.resultRows = [];
  state.wizard.resultMeta = null;
  state.rows = [];
  state.lastRun = null;
  if (state.wizard.filterMode === 'all') {
    state.wizard.filterMembers = uniqueMembers(draft.members);
    state.wizard.filterCompleted = true;
    await logEvent('FILTER', `Отбор без фильтра: оставлены все ${state.wizard.filterMembers.length} абонентов текущего сбора.`);
    scheduleWorkspaceDraftSave();
    renderWizardFilterState();
    return;
  }
  state.auditMode = 'custom';
  state.afterMode = 'billing';
  state.rules = [{ id: uid('rule'), field: 'billing.connectionFamily', op: 'eq', value: 'PON' }];
  state.selectedIds = [draft.id];
  state.wizard.runningPhase = 'filter';
  scheduleWorkspaceDraftSave();
  await logEvent('ACTION', `Выбран отбор «Только PON»: из ${draft.memberCount} собранных абонентов оставим PON.`);
  await runAudit({ billingOnly: true });
}

async function saveWizardGroup() {
  const members = uniqueMembers(state.wizard.filterMembers || []);
  const name = $('#wizardGroupName').value.trim();
  const purpose = $('#wizardGroupPurpose').value.trim();
  state.wizard.groupName = name;
  state.wizard.groupPurpose = purpose;
  const color = state.wizard.groupColor || 'blue';
  if (!members.length) return toast('Нет абонентов для группы');
  if (!name) return toast('Укажи название группы');
  let group = wizardGroup();
  if (group) {
    group.name = compact(name, 120);
    group.purpose = compact(purpose, 280);
    group.color = GROUP_COLORS.includes(color) ? color : 'blue';
    group.updatedAt = nowIso();
    group.history = [...(group.history || []), { id: uid('gh'), type: 'edited', createdAt: nowIso(), message: 'Изменены название / описание / цвет группы' }];
    await db.put('groups', group);
    await logEvent('SAVE', `Группа «${group.name}» обновлена.` , { groupId: group.id });
    await loadGroups();
  } else {
    const draft = currentCollectionDraft();
    const captures = Array.isArray(draft?.source?.captures) ? draft.source.captures : [];
    group = await saveGroup({
      name,
      members,
      color,
      purpose,
      source: { type: state.wizard.filterMode === 'pon' ? 'billing-pon-filter' : 'billing-selection', captures, capturedAt: nowIso() },
      lineage: { operation: state.wizard.filterMode === 'pon' ? 'filter:PON' : 'keep-all', sourceCount: draft?.memberCount || members.length, resultCount: members.length, runId: state.wizard.filterRunId || '' }
    });
    group.history = [...(group.history || []), { id: uid('gh'), type: 'filter', createdAt: nowIso(), message: state.wizard.filterMode === 'pon' ? `Оставлены только PON · ${members.length} абонентов` : `Сохранён весь текущий сбор · ${members.length} абонентов` }];
    await db.put('groups', group);
    await loadGroups();
    state.wizard.groupId = group.id;
    state.selectedIds = [group.id];
  }
  state.wizard.groupId = group.id;
  state.selectedIds = [group.id];
  await saveWorkspaceDraft();
  renderWizardGroupState();
  toast(`Группа «${group.name}» сохранена`);
}

function useSavedGroupInWizard(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return toast('Группа не найдена');
  state.selectedIds = [group.id];
  state.wizard.groupId = group.id;
  state.wizard.groupName = group.name || '';
  state.wizard.groupPurpose = group.purpose || '';
  state.wizard.groupColor = group.color || 'blue';
  state.wizard.filterCompleted = true;
  state.wizard.filterMembers = uniqueMembers(group.members);
  state.wizard.checkMode = '';
  state.wizard.checkCompleted = false;
  state.wizard.resultSaved = false;
  state.wizard.resultRows = [];
  state.wizard.resultMeta = null;
  state.rows = [];
  state.lastRun = null;
  scheduleWorkspaceDraftSave();
  void logEvent('ACTION', `Продолжена работа с группой «${group.name}» · ${group.memberCount || group.members?.length || 0} абонентов.`);
  setWizardStep(4, { force: true });
}

async function editGroupModal(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return toast('Группа не найдена');
  openModal({
    title: `Редактировать «${group.name}»`,
    body: `<label>Название</label><input type="text" data-edit-name value="${esc(group.name)}"><label style="margin-top:10px">Для чего</label><input type="text" data-edit-purpose value="${esc(group.purpose || '')}"><label style="margin-top:10px">Цвет</label>${colorPickerHtml(group.color || 'blue')}`,
    confirmText: 'Сохранить изменения',
    onConfirm: async modal => {
      const name = modal.querySelector('[data-edit-name]').value.trim();
      if (!name) throw new Error('Название не может быть пустым');
      group.name = compact(name,120);
      group.purpose = compact(modal.querySelector('[data-edit-purpose]').value.trim(),280);
      group.color = modal.querySelector('[data-color].active')?.dataset.color || group.color || 'blue';
      group.updatedAt = nowIso();
      group.history = [...(group.history || []), { id: uid('gh'), type:'edited', createdAt:nowIso(), message:'Группа отредактирована' }];
      await db.put('groups',group);
      await logEvent('SAVE',`Группа «${group.name}» отредактирована.`,{groupId:group.id});
      await loadGroups();
      renderWizardAll();
    }
  });
  bindColorPicker($('.modal'));
}

function deleteGroupModal(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return toast('Группа не найдена');
  openModal({
    title: `Удалить группу «${group.name}»?`,
    body: `<div class="modal-tip danger"><b>Будет удалена сама группа и её сохранённая история проверок.</b><span>Это не изменяет данные Billing/UserSide.</span></div>`,
    confirmText: 'Удалить группу',
    onConfirm: async () => {
      await db.delete('groups', group.id);
      state.selectedIds = state.selectedIds.filter(id => id !== group.id);
      if (state.wizard.groupId === group.id) {
        state.wizard.groupId = '';
        state.wizard.checkMode = '';
        state.wizard.checkCompleted = false;
        state.wizard.resultSaved = false;
        state.wizard.resultRows = [];
        state.wizard.resultMeta = null;
        state.rows = [];
        state.lastRun = null;
      }
      await logEvent('CANCEL', `Удалена группа «${group.name}».`, { groupId: group.id });
      await loadGroups();
      await saveWorkspaceDraft();
      setWizardStep(Math.min(state.wizard.step, wizardMaxUnlocked()), { force:true });
    }
  });
}

async function runWizardCheck() {
  const group = wizardGroup();
  if (!group) return toast('Группа не выбрана');
  if (!state.wizard.checkMode) return toast('Выбери проверку');
  state.selectedIds = [group.id];
  state.auditMode = state.wizard.checkMode;
  state.wizard.runningPhase = 'check';
  state.wizard.checkCompleted = false;
  state.wizard.resultSaved = false;
  state.wizard.resultRows = [];
  state.wizard.resultMeta = null;
  state.rows = [];
  scheduleWorkspaceDraftSave();
  await runAudit({ billingOnly:false });
}

async function fixWizardResult() {
  if (!state.rows.length || !wizardGroup()) return toast('Нет результата для сохранения');
  state.auditMode = state.wizard.checkMode;
  await saveResultModal();
  state.wizard.resultSaved = true;
  await saveWorkspaceDraft();
  renderWizardResults();
}

async function repeatWizardCheck() {
  if (state.runtime.active) return toast('Сначала останови текущий процесс');
  const group = wizardGroup();
  if (!group) return toast('Исходная группа не найдена');
  const parentRunId = state.wizard.resultMeta?.id || state.lastRun?.id || '';
  state.rows = []; state.lastRun = null;
  state.wizard = { ...state.wizard, step:4, checkMode:'', runningPhase:'', checkCompleted:false, resultSaved:false, resultRows:[], resultMeta:null };
  await saveWorkspaceDraft();
  await logEvent('ACTION', `Новая проверка на группе «${group.name}»${parentRunId ? ` · после ${parentRunId}` : ''}.`, { groupId:group.id, parentRunId });
  setWizardStep(4,{force:true});
}

async function resetWizard() {
  if (state.runtime.active) return toast('Сначала останови текущий процесс');
  state.transientGroups = [];
  state.selectedIds = [];
  state.rows = [];
  state.lastRun = null;
  state.wizard = { step:1,pageCount:5,filterMode:'',filterCompleted:false,filterMembers:[],filterRunId:'',groupId:'',groupName:'',groupPurpose:'',groupColor:'blue',checkMode:'',runningPhase:'',checkCompleted:false,resultSaved:false,resultRows:[],resultMeta:null,captureRequests:0 };
  await saveWorkspaceDraft();
  await logEvent('ACTION','Начат новый пошаговый аудит.');
  setWizardStep(1,{force:true});
}

function bindUi() {
  $('#closeBtn').addEventListener('click', () => postParent('AUDIT_CLOSE'));
  $('#expandBtn').addEventListener('click', () => {
    const expanded = !state.settings.expanded;
    saveSettings({ expanded });
    postParent('AUDIT_EXPAND', { expanded });
    $('#expandBtn').title = expanded ? 'Вернуть разделение' : 'Развернуть';
  });
  $('#pageCountRange').addEventListener('input', event => {
    state.wizard.pageCount = Math.min(20, Math.max(1, Number(event.target.value || 5)));
    scheduleWorkspaceDraftSave();
    renderWizardSource();
  });
  $('#wizardCaptureBtn').addEventListener('click', () => {
    if (state.runtime.active) return toast('Сначала заверши текущую операцию');
    if (!state.hostInfo?.canCaptureBillingList) return toast('Открой Billing → listuser');
    const count = state.wizard.pageCount;
    const currentPage = Number(state.hostInfo?.captureEstimate?.currentPage || 1);
    resetRuntime('capture', count, `Собираю страницы ${currentPage}${count > 1 ? `–${currentPage + count - 1}` : ''}`, Math.max(0, count - 1));
    state.wizard.captureRequests = 0;
    void logEvent('ACTION', `Запущен сбор ${count} страниц Billing начиная со страницы ${currentPage}. Текущая страница читается из DOM; максимум ${Math.max(0,count-1)} дополнительных GET.`);
    postParent('AUDIT_CAPTURE_BILLING_PAGES', { count });
  });
  $('#wizardStep1Next').addEventListener('click', () => setWizardStep(2));
  $$('input[name="wizardFilter"]').forEach(input => input.addEventListener('change', event => {
    state.wizard.filterMode = event.target.value;
    state.wizard.filterCompleted = false;
    state.wizard.filterMembers = [];
    state.wizard.groupId = '';
    state.wizard.checkMode = '';
    state.wizard.checkCompleted = false;
    state.wizard.resultSaved = false;
    state.wizard.resultRows = [];
    state.wizard.resultMeta = null;
    state.rows = [];
    state.lastRun = null;
    scheduleWorkspaceDraftSave();
    void logEvent('ACTION', event.target.value === 'pon' ? 'Выбран отбор: оставить только PON.' : 'Выбран отбор: оставить всех собранных абонентов.');
    renderWizardFilterState();
  }));
  $('#wizardFilterRun').addEventListener('click', () => void runWizardFilter());
  $('#wizardStep2Back').addEventListener('click', () => setWizardStep(1,{force:true}));
  $('#wizardStep2Next').addEventListener('click', () => setWizardStep(3));
  $('#wizardGroupName').addEventListener('input', event => { state.wizard.groupName = event.target.value; scheduleWorkspaceDraftSave(); renderWizardGroupState(); });
  $('#wizardGroupPurpose').addEventListener('input', event => { state.wizard.groupPurpose = event.target.value; scheduleWorkspaceDraftSave(); });
  $$('[data-wizard-color]').forEach(button => button.addEventListener('click', () => {
    state.wizard.groupColor = button.dataset.wizardColor || 'blue';
    scheduleWorkspaceDraftSave();
    renderWizardGroupState();
  }));
  $('#wizardGroupSave').addEventListener('click', () => void saveWizardGroup());
  $('#wizardStep3Back').addEventListener('click', () => setWizardStep(2,{force:true}));
  $('#wizardStep3Next').addEventListener('click', () => setWizardStep(4));
  $$('input[name="wizardCheck"]').forEach(input => input.addEventListener('change', event => {
    state.wizard.checkMode = event.target.value;
    state.wizard.checkCompleted = false;
    state.wizard.resultSaved = false;
    state.wizard.resultRows = [];
    state.wizard.resultMeta = null;
    state.rows = [];
    state.lastRun = null;
    scheduleWorkspaceDraftSave();
    void logEvent('ACTION', `Выбрана проверка: ${event.target.value === 'onu_identity_compare' ? 'Готовность ONU / OLT: Billing ↔ ТМЦ' : 'OLT Billing ↔ ТМЦ'}.`);
    renderWizardCheckState();
    renderWizardPlan();
  }));
  $('#wizardStep4Back').addEventListener('click', () => setWizardStep(3,{force:true}));
  $('#wizardStep4Next').addEventListener('click', () => setWizardStep(5));
  $('#wizardStep5Back').addEventListener('click', () => setWizardStep(4,{force:true}));
  $('#wizardRunCheck').addEventListener('click', () => void runWizardCheck());
  $('#wizardResultSearch').addEventListener('input', renderWizardResults);
  $('#wizardProblemsOnly').addEventListener('change', renderWizardResults);
  $('#wizardFixResult').addEventListener('click', () => void fixWizardResult());
  $('#wizardOpenGroup').addEventListener('click', () => { if (state.wizard.groupId) openGroupModal(state.wizard.groupId); });
  $('#wizardExportCsv').addEventListener('click', exportCsv);
  $('#wizardRepeatAudit').addEventListener('click', () => void repeatWizardCheck());
  $('#wizardNewAudit').addEventListener('click', () => void resetWizard());
  $('#wizardSaveProgressBtn').addEventListener('click', async () => {
    await saveWorkspaceDraft();
    await logEvent('SAVE', `Состояние Data Audit сохранено вручную · шаг ${state.wizard.step}.`);
    toast('Состояние сохранено');
  });
  $('#wizardJournalBtn').addEventListener('click', async () => {
    $('#wizardJournalPanel').hidden = false;
    await renderJournal();
  });
  $('#wizardJournalTxt').addEventListener('click', () => void exportJournal('txt'));
  $('#wizardJournalJson').addEventListener('click', () => void exportJournal('json'));
  $('#wizardJournalClose').addEventListener('click', () => { $('#wizardJournalPanel').hidden = true; });
  $$('.wizard-step').forEach(step => step.addEventListener('click', () => setWizardStep(Number(step.dataset.wstep || 1))));

  $('#captureBillingBtn').addEventListener('click', () => {
    if (state.runtime.active) return toast('Сначала заверши текущую операцию');
    state.runtime.message = 'Парсю текущую страницу Billing…';
    updateRuntimeUi();
    void logEvent('ACTION', 'Нажато «Добавить текущую страницу»: текущая Billing/listuser страница будет добавлена в текущий сбор без дополнительных GET.');
    postParent('AUDIT_CAPTURE_CURRENT_BILLING_LIST');
  });
  $('#auditType').addEventListener('change', event => {
    state.auditMode = ['custom', 'olt_compare', 'onu_identity_compare'].includes(event.target.value) ? event.target.value : 'olt_compare';
    scheduleWorkspaceDraftSave();
    applyAuditModeUi();
  });
  $('#manualBtn').addEventListener('click', manualSourceModal);
  $('#refreshGroupsBtn').addEventListener('click', loadGroups);
  $('#groupSearch').addEventListener('input', renderGroups);
  $('#clearWorkspaceBtn').addEventListener('click', () => { state.selectedIds = []; state.transientGroups = []; scheduleWorkspaceDraftSave(); renderSelectedGroups(); });

  $('#dropZone').addEventListener('dragover', event => { event.preventDefault(); $('#dropZone').classList.add('dragover'); });
  $('#dropZone').addEventListener('dragleave', () => $('#dropZone').classList.remove('dragover'));
  $('#dropZone').addEventListener('drop', event => {
    event.preventDefault();
    $('#dropZone').classList.remove('dragover');
    addSelected(event.dataTransfer.getData('text/simnet-group-id'));
  });

  $$('.mode-card').forEach(card => card.addEventListener('click', () => setMode(card.dataset.mode)));
  $$('.step').forEach(step => step.addEventListener('click', () => setView(step.dataset.view)));
  $('#toRulesBtn').addEventListener('click', () => {
    if (!combineMembers().length) return toast('Сначала добавь группу');
    setView('rules');
  });
  $('#backToBuilderBtn').addEventListener('click', () => setView('builder'));
  $('#backToRulesBtn').addEventListener('click', () => setView('rules'));
  $('#addRuleBtn').addEventListener('click', () => { state.rules.push({ id: uid('rule'), field: 'billing.olt', op: 'eq', value: '' }); scheduleWorkspaceDraftSave(); renderRules(); updatePlans(); });
  $('#saveRuleBtn').addEventListener('click', saveRulePreset);
  $('#ponPresetBtn').addEventListener('click', () => {
    state.auditMode = 'custom';
    state.afterMode = 'billing';
    state.rules = [{ id: uid('rule'), field: 'billing.connectionFamily', op: 'eq', value: 'PON' }];
    const billingRadio = document.querySelector('input[name="afterMode"][value="billing"]');
    if (billingRadio) billingRadio.checked = true;
    scheduleWorkspaceDraftSave();
    applyAuditModeUi();
    renderRules();
    void logEvent('ACTION', 'Выбран быстрый фильтр «Только PON»: технология Billing должна быть PON.');
  });

  $$('input[name="afterMode"]').forEach(input => input.addEventListener('change', event => {
    state.afterMode = event.target.value;
    scheduleWorkspaceDraftSave();
    $('#tmcFields').classList.toggle('disabled', state.afterMode !== 'tmc');
    updatePlans();
  }));

  $('#collectBtn').addEventListener('click', () => runAudit({ billingOnly: true }));
  $('#runBtn').addEventListener('click', () => runAudit({ billingOnly: false }));
  $('#pauseBtn').addEventListener('click', () => {
    if (!state.runtime.active) return;
    state.runtime.paused = true;
    if (state.runtime.kind === 'capture') postParent('AUDIT_CAPTURE_PAUSE');
    state.runtime.message = 'Пауза';
    updateRuntimeUi();
    void logEvent('PAUSE', `Пауза: новые запросы временно не запускаются · ${state.runtime.done}/${state.runtime.total}.`);
  });
  $('#resumeBtn').addEventListener('click', () => {
    if (!state.runtime.active) return;
    state.runtime.paused = false;
    if (state.runtime.kind === 'capture') postParent('AUDIT_CAPTURE_RESUME');
    state.runtime.message = state.runtime.kind === 'capture' ? 'Продолжаю сбор списка' : 'Продолжаю проверку';
    updateRuntimeUi();
    void logEvent('ACTION', `Продолжено: ${state.runtime.kind === 'capture' ? 'сбор списка' : 'проверка'} · ${state.runtime.done}/${state.runtime.total}.`);
  });
  $('#finishHereBtn').addEventListener('click', () => {
    if (!state.runtime.active || !state.runtime.paused) return;
    state.runtime.finishRequested = true;
    state.runtime.paused = false;
    if (state.runtime.kind === 'capture') postParent('AUDIT_CAPTURE_FINISH_HERE');
    state.runtime.message = state.runtime.kind === 'capture' ? 'Завершаю сбор на текущем объёме…' : 'Завершаю на уже проверенных…';
    updateRuntimeUi();
    void logEvent('PARTIAL', `Нажато «Хватит»: принимаем текущий объём · ${state.runtime.done}/${state.runtime.total}.`);
  });
  $('#stopBtn').addEventListener('click', () => {
    if (!state.runtime.active) return;
    state.runtime.stopped = true;
    state.runtime.paused = false;
    if (state.runtime.kind === 'capture') postParent('AUDIT_CAPTURE_STOP');
    state.runtime.message = 'Отмена…';
    updateRuntimeUi();
    void logEvent('CANCEL', `Нажата отмена операции · ${state.runtime.done}/${state.runtime.total}.`);
  });
  $('#resultSearch').addEventListener('input', renderResults);
  $('#problemsOnly').addEventListener('change', renderResults);
  $('#saveResultBtn').addEventListener('click', saveResultModal);
  $('#saveFilteredGroupBtn').addEventListener('click', saveFilteredGroupModal);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#refreshJournalBtn').addEventListener('click', renderJournal);
}

function applyCaptureNetwork(network = {}) {
  if (!network || typeof network !== 'object') return;
  state.runtime.billingRequests = Number(network.billingRequests ?? network.requests ?? state.runtime.requests ?? 0);
  state.runtime.userSideRequests = 0;
  state.runtime.inFlight = Number(network.inFlight || 0);
  state.runtime.maxInFlight = Math.max(Number(state.runtime.maxInFlight || 0), Number(network.maxInFlight || 0));
  state.runtime.totalLatencyMs = Number(network.avgLatencyMs || 0) * Number(network.requests || 0);
  if (!state.runtime.startedAtMs && Number(network.elapsedMs || 0) > 0) state.runtime.startedAtMs = Date.now() - Number(network.elapsedMs || 0);
}

window.addEventListener('message', async event => {
  if (event.source !== window.parent || !PARENT_ORIGIN || event.origin !== PARENT_ORIGIN) return;
  const message = event.data;
  if (!message || message.__simnetDataAudit !== true) return;

  if (message.type === 'HOST_INFO') setHostInfo(message.payload || {});
  if (message.type === 'HOST_FETCH_RESULT') {
    const requestId = String(message.payload?.requestId || '');
    const pending = hostFetchPending.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      hostFetchPending.delete(requestId);
      pending.resolve(message.payload || {});
    }
  }
  if (message.type === 'HOST_OPEN_STATE' && message.payload?.persist !== false) await saveSettings({ open: Boolean(message.payload?.open) });
  if (message.type === 'HOST_WIDTH_CHANGED') await saveSettings({ width: Number(message.payload?.width) || state.settings.width, expanded: Boolean(message.payload?.expanded) });
  if (message.type === 'HOST_RESIZE_PREVIEW') state.settings.width = Number(message.payload?.width) || state.settings.width;

  if (message.type === 'SOURCE_PROGRESS') {
    state.runtime.kind = 'capture';
    state.runtime.active = true;
    state.runtime.total = Math.max(state.runtime.total, Number(message.payload?.totalPages || message.payload?.pages || 0));
    state.runtime.done = Number(message.payload?.pages || 0);
    state.runtime.requests = Number(message.payload?.requests || 0);
    applyCaptureNetwork(message.payload?.network || {});
    if (!state.runtime.plannedMax) state.runtime.plannedMax = Math.max(0, Number(state.wizard.pageCount || 1) - 1);
    state.runtime.message = message.payload?.message || 'Собираю список Billing';
    updateRuntimeUi();
  }

  if (message.type === 'SOURCE_PAGE_RESULT') {
    const payload = message.payload || {};
    try {
      const result = await mergeCapturedPage(payload);
      state.wizard.captureRequests = Math.max(state.wizard.captureRequests || 0, Number(payload.meta?.requests || 0));
      state.runtime.requests = state.wizard.captureRequests;
      applyCaptureNetwork(payload.meta?.network || {});
      state.runtime.message = `Страница ${payload.meta?.page || '—'}: +${result.added} новых · всего ${result.draft.memberCount}`;
      renderWizardSource();
      updateRuntimeUi();
      await logEvent('SOURCE', `Billing страница ${payload.meta?.page || '—'} собрана: +${result.added} новых · ${result.duplicates} повторов · всего ${result.draft.memberCount}.`, { page: payload.meta?.page || null, total: result.draft.memberCount });
    } catch (error) {
      await logEvent('ERROR', `Не удалось добавить страницу Billing: ${error?.message || error}`);
      toast(error?.message || String(error));
    }
  }

  if (message.type === 'SOURCE_CAPTURE_DONE') {
    const payload = message.payload || {};
    state.wizard.captureRequests = Number(payload.requests || state.wizard.captureRequests || 0);
    state.runtime.requests = state.wizard.captureRequests;
    applyCaptureNetwork(payload.network || {});
    const captureNet = runtimeNetworkSnapshot();
    finishRuntime(payload.partial ? `Сбор остановлен здесь · ${payload.pages || 0} стр.` : `Сбор завершён · ${payload.pages || 0} стр.`);
    renderWizardSource();
    await logEvent(payload.partial ? 'PARTIAL' : 'DONE', `Сбор Billing завершён: ${payload.pages || 0} страниц · ${currentCollectionDraft()?.memberCount || 0} уникальных абонентов · ${state.wizard.captureRequests} GET · ~${captureNet.avgRequestsPerMinute} GET/мин · средний ответ ${captureNet.avgLatencyMs} мс${payload.partial ? ' · частично' : ''}.`, { network: captureNet });
    await saveWorkspaceDraft();
  }

  if (message.type === 'SOURCE_RESULT') {
    const payload = message.payload || {};
    state.runtime.active = false;
    state.runtime.paused = false;
    try {
      const result = await mergeCapturedPage(payload);
      state.runtime.message = `Добавлена страница ${payload.meta?.page || '—'}: +${result.added} новых · всего ${result.draft.memberCount}`;
      updateRuntimeUi();
      await logEvent('SOURCE', `Billing страница ${payload.meta?.page || '—'} добавлена в текущий сбор: +${result.added} новых · ${result.duplicates} повторов · всего ${result.draft.memberCount}.`, { page: payload.meta?.page || null, total: result.draft.memberCount });
      toast(`+${result.added} новых · ${result.duplicates} повторов · всего ${result.draft.memberCount}`);
    } catch (error) {
      state.runtime.message = error?.message || String(error);
      updateRuntimeUi();
      toast(error?.message || String(error));
    }
  }

  if (message.type === 'SOURCE_CANCELLED') {
    finishRuntime('Сбор остановлен оператором');
    renderWizardSource();
    await logEvent('CANCEL', `Сбор Billing остановлен. Уже собранные страницы остаются в текущем сборе · ${currentCollectionDraft()?.memberCount || 0} абонентов.`);
    toast('Сбор остановлен. Уже собранные страницы сохранены в текущем сборе.');
  }

  if (message.type === 'SOURCE_ERROR') {
    const text = message.payload?.message || 'Ошибка сбора списка';
    finishRuntime(text);
    await logEvent('ERROR', `Ошибка сбора Billing: ${text}`);
    toast(text);
  }
});

async function init() {
  try {
    await db.open();
    await maintainAuditStorage();
    await loadSettings();
    await loadWorkspaceDraft();
    bindUi();
    const afterInput = document.querySelector(`input[name="afterMode"][value="${state.afterMode}"]`);
    if (afterInput) afterInput.checked = true;
    $('#tmcFields').classList.toggle('disabled', state.afterMode !== 'tmc');
    renderRules();
    applyAuditModeUi();
    await loadGroups();
    renderSelectedGroups();
    updateRuntimeUi();
    const savedStep = Math.min(Number(state.wizard.step || 1), wizardMaxUnlocked());
    setWizardStep(savedStep, { force: true });
    renderWizardAll();
    $('#expandBtn').title = state.settings.expanded ? 'Вернуть разделение' : 'Развернуть';
    postParent('AUDIT_READY', { settings: state.settings });
    postParent('AUDIT_REQUEST_HOST_INFO');
  } catch (error) {
    $('#dbBadge').classList.remove('ok');
    $('#dbBadge').textContent = 'IndexedDB error';
    console.error('[SIMNET Data Audit] init failed', error);
  }
}

init();
