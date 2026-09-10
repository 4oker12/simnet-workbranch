(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const STATE_KEY = 'simnet_workbench_state_v5';
  const STYLE_ID = 'simnet-wb-pbx-binding-column-style';
  const HEADER_ATTR = 'simnetWbContractHeader';
  const CELL_ATTR = 'simnetWbContractCell';
  const mountedCells = new Map();
  let lastState = {};
  let mountQueued = false;

  function compact(value, max = 180) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function headerKey(value) {
    return compact(value, 80).toLowerCase().replace(/[^a-z0-9_#]+/g, '');
  }

  function factValue(raw) {
    return raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value')
      ? raw.value
      : raw;
  }

  function normalizedContract(raw) {
    const value = String(factValue(raw) ?? '').trim().replace(/\D+/g, '');
    return /^\d{3,14}$/.test(value) && !/^0+$/.test(value) ? value : '';
  }

  function recordIdOf(cell) {
    if (!cell) return '';
    const nodes = Array.from(cell.querySelectorAll?.('[id],a[href],a[onclick]') || []);
    const values = [
      ...nodes.flatMap(node => [
        node.getAttribute?.('id') || '',
        node.getAttribute?.('href') || '',
        node.getAttribute?.('onclick') || ''
      ]),
      cell.innerHTML || '',
      cell.textContent || ''
    ];
    for (const value of values) {
      const match = String(value).match(/(?:getrec\.php\?id=)?(\d{9,12}\.\d{1,12})/i);
      if (match) return match[1];
    }
    return '';
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[data-${HEADER_ATTR.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}="1"]{min-width:76px!important;white-space:nowrap!important}
      .wb-pbx-contract-cell{min-width:76px!important;white-space:nowrap!important;text-align:center!important}
      .wb-pbx-contract-value{display:inline-flex!important;align-items:center!important;gap:3px!important;padding:1px 4px!important;border-radius:5px!important;background:#f7f8fa!important;color:#263648!important;font:700 10px/1.25 Arial,sans-serif!important;white-space:nowrap!important}
      .wb-pbx-contract-value[data-tone="native"]{background:#eef7f0!important;color:#2f6c43!important}
      .wb-pbx-contract-value[data-tone="bound"]{background:#fff0f6!important;color:#8b123f!important}
      .wb-pbx-contract-value[data-tone="candidate"]{background:#fff8e8!important;color:#7a5a00!important}
      .wb-pbx-contract-value[data-tone="conflict"]{background:#fff0f0!important;color:#a33232!important}
      .wb-pbx-contract-empty{color:#9aa3ad!important;font:10px/1.2 Arial,sans-serif!important}
    `;
    document.documentElement.appendChild(style);
  }

  function callEntryForRecord(state, recordId) {
    const calls = state?.callModule?.calls?.calls || {};
    const alias = `pbx:${recordId}`;
    for (const [key, call] of Object.entries(calls)) {
      if (!call || typeof call !== 'object') continue;
      if (
        String(call.pbxRecordId || '') === recordId
        || key === alias
        || (Array.isArray(call.legacyAliases) && call.legacyAliases.includes(alias))
      ) {
        return { key, call };
      }
    }
    return null;
  }

  function bindingForCall(state, entry, recordId) {
    const bindings = state?.callModule?.bindings?.bindings || {};
    const directKey = String(entry?.call?.callKey || entry?.key || '');
    if (directKey && bindings[directKey]) return bindings[directKey];

    const assignment = (state?.callModule?.bindings?.assignmentLog || []).find(item => (
      String(item?.pbxRecordId || '') === recordId
      || (directKey && String(item?.callKey || '') === directKey)
    ));
    const assignmentKey = String(assignment?.callKey || '');
    return assignmentKey && bindings[assignmentKey] ? bindings[assignmentKey] : null;
  }

  function caseContract(state, binding) {
    const caseId = String(binding?.identity?.caseId || binding?.caseId || '');
    const caseData = caseId ? state?.cases?.[caseId] : null;
    return normalizedContract(
      binding?.identity?.contract
      || binding?.contract
      || caseData?.identity?.contract
      || caseData?.identity?.login
    );
  }

  function presentationFor(recordId, nativeContract, nativeProvider, state = {}) {
    const nativeValue = normalizedContract(nativeContract);
    const providerCode = compact(nativeProvider, 12);
    const entry = callEntryForRecord(state, recordId);
    const binding = bindingForCall(state, entry, recordId);
    const bindingContract = caseContract(state, binding);
    const callContract = normalizedContract(entry?.call?.contract);
    const wbContract = bindingContract || callContract;
    const callKey = String(entry?.call?.callKey || entry?.key || '');

    if (!wbContract) {
      if (nativeValue) {
        return {
          text: `✓ ${nativeValue}`,
          tone: 'native',
          title: `PBX уже содержит договор ${nativeValue}${callKey ? ` · ${callKey}` : ''}`
        };
      }
      return { text: '—', tone: 'empty', title: callKey ? `Call: ${callKey} · привязка договора пока не определена` : 'Workbench ещё не связал этот PBX-звонок с Call' };
    }

    // PBX provider namespace prov=1 is not directly comparable with the
    // canonical SIMNET contract, matching the existing pbxCallMatch rule.
    const nativeComparable = providerCode !== '1';
    if (nativeValue && nativeComparable && nativeValue !== wbContract) {
      return {
        text: `⚠ ${wbContract}`,
        tone: 'conflict',
        title: `Конфликт: PBX ${nativeValue}, Workbench ${wbContract}${callKey ? ` · ${callKey}` : ''}`
      };
    }

    if (binding) {
      const confidence = Math.max(0, Math.min(1, Number(binding.candidateConfidence || 0)));
      const registered = String(binding.registrationStatus?.state || '') === 'registered';
      const overridden = String(binding.mode || '') === 'operator-override';
      const locked = registered || overridden;
      const suffix = locked ? ' 🔒' : confidence > 0 ? ` ~${Math.round(confidence * 100)}%` : ' •';
      const reason = locked
        ? 'подтверждённая привязка'
        : confidence > 0
          ? `вычисленная привязка ${Math.round(confidence * 100)}%`
          : 'сохранённая привязка';
      return {
        text: `${wbContract}${suffix}`,
        tone: locked ? 'bound' : 'candidate',
        title: `${reason}${callKey ? ` · ${callKey}` : ''}${binding.mode ? ` · ${binding.mode}` : ''}`
      };
    }

    return {
      text: `${wbContract} ✓`,
      tone: 'native',
      title: `Договор получен из канонической сущности Call${callKey ? ` · ${callKey}` : ''}`
    };
  }

  function paintCell(view) {
    if (!view?.cell?.isConnected) return false;
    const presentation = presentationFor(view.recordId, view.nativeContract, view.nativeProvider, lastState);
    const renderKey = `${presentation.tone}|${presentation.text}|${presentation.title}`;
    if (view.cell.dataset.wbRenderKey === renderKey) return true;
    view.cell.dataset.wbRenderKey = renderKey;
    view.cell.replaceChildren();
    if (presentation.tone === 'empty') {
      const empty = document.createElement('span');
      empty.className = 'wb-pbx-contract-empty';
      empty.textContent = presentation.text;
      empty.title = presentation.title;
      view.cell.appendChild(empty);
      return true;
    }
    const badge = document.createElement('span');
    badge.className = 'wb-pbx-contract-value';
    badge.dataset.tone = presentation.tone;
    badge.textContent = presentation.text;
    badge.title = presentation.title;
    view.cell.appendChild(badge);
    return true;
  }

  function refreshCells() {
    for (const [recordId, view] of mountedCells) {
      if (!paintCell(view)) mountedCells.delete(recordId);
    }
  }

  function sourceIndex(headerIndex, wbIndex, rowHasWbCell) {
    if (headerIndex < 0) return -1;
    if (rowHasWbCell || headerIndex < wbIndex) return headerIndex;
    return headerIndex - 1;
  }

  function mountTable(table) {
    const rows = Array.from(table?.rows || []);
    if (rows.length < 2) return false;
    const head = rows[0];
    let headerCells = Array.from(head.cells || []);
    let headers = headerCells.map(cell => headerKey(cell.textContent));
    const contractIndex = headers.indexOf('contract');
    const callIndexBefore = headers.indexOf('callid');
    if (contractIndex < 0 || callIndexBefore < 0) return false;

    let wbIndex = headerCells.findIndex(cell => cell?.dataset?.[HEADER_ATTR] === '1');
    if (wbIndex < 0) {
      const header = head.insertCell(contractIndex + 1);
      header.dataset[HEADER_ATTR] = '1';
      header.textContent = 'WB договор';
      header.title = 'Договор из единой сущности Call / Binding Workbench';
      headerCells = Array.from(head.cells || []);
      headers = headerCells.map(cell => headerKey(cell.textContent));
      wbIndex = contractIndex + 1;
    }

    const callIndex = headers.indexOf('callid');
    const nativeIndex = headers.indexOf('contract');
    const providerIndex = headers.indexOf('prov');
    if (callIndex < 0 || nativeIndex < 0 || wbIndex < 0) return false;

    for (const row of rows.slice(1)) {
      let cell = Array.from(row.cells || []).find(item => item?.dataset?.[CELL_ATTR] === '1');
      const rowHasWbCell = Boolean(cell);
      const cells = Array.from(row.cells || []);
      const callSourceIndex = sourceIndex(callIndex, wbIndex, rowHasWbCell);
      const contractSourceIndex = sourceIndex(nativeIndex, wbIndex, rowHasWbCell);
      const providerSourceIndex = sourceIndex(providerIndex, wbIndex, rowHasWbCell);
      const recordId = recordIdOf(cells[callSourceIndex]);
      if (!recordId) continue;
      const nativeContract = compact(cells[contractSourceIndex]?.textContent || '', 48);
      const nativeProvider = compact(cells[providerSourceIndex]?.textContent || '', 12);
      if (!cell) {
        cell = row.insertCell(Math.min(wbIndex, row.cells.length));
        cell.dataset[CELL_ATTR] = '1';
        cell.className = 'wb-pbx-contract-cell';
      }
      const view = { cell, recordId, nativeContract, nativeProvider };
      mountedCells.set(recordId, view);
      paintCell(view);
    }
    return true;
  }

  function mountTables() {
    mountQueued = false;
    installStyle();
    for (const table of Array.from(document.querySelectorAll('table'))) mountTable(table);
    refreshCells();
  }

  function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    queueMicrotask(mountTables);
  }

  async function readState() {
    try {
      const result = await chrome.storage.local.get(STATE_KEY);
      lastState = result?.[STATE_KEY] || {};
      refreshCells();
    } catch (error) {
      if (!/Extension context invalidated/i.test(String(error?.message || error))) {
        console.warn('[SIMNET Workbench][PBX BINDING] state read failed', error);
      }
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[STATE_KEY]) return;
    lastState = changes[STATE_KEY].newValue || {};
    refreshCells();
  });

  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  installStyle();
  mountTables();
  void readState();
})();
