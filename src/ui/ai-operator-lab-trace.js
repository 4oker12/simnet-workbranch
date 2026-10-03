'use strict';

(() => {
  const TRACE_ID = 'aiLabLinearTrace';
  const RUNTIME_MAP_ID = 'aiLabRuntimeMap';
  const STYLE_ID = 'aiLabLinearTraceStyle';
  const TOOL_INSPECTOR_ID = 'aiLabToolInspector';
  const BILLING_SNAPSHOT_KEY = 'simnet_ai_operator_billing_snapshots_v1';
  const TOOL_HINT_RE = /\b(customer\.lookup|customer\.confirm|customer\.snapshot|billing\.main_summary|billing\.balance|billing\.tariff|billing\.history|billing\.payments|userside\.snapshot|building\.snapshot|network\.session|pon\.onu|pon\.signal)\b/i;
  const TOOL_REF_RE = /(?:tool:)?(?:customer\.lookup|customer\.confirm|customer\.snapshot|billing\.main_summary|billing\.balance|billing\.tariff|billing\.history|billing\.payments|userside\.snapshot|building\.snapshot|network\.session|pon\.onu|pon\.signal)/gi;
  const ACTION_TAXONOMY = Object.freeze({
    lookup: Object.freeze({ label: 'НАЙТИ / ПРОВЕРИТЬ', technical: 'LOOKUP / VERIFY', httpLike: 'READ / GET-like' }),
    read: Object.freeze({ label: 'ЧИТАТЬ', technical: 'READ', httpLike: 'GET-like' }),
    store: Object.freeze({ label: 'СОХРАНИТЬ КОНТЕКСТ', technical: 'STORE / STATE', httpLike: 'PUT-like state' }),
    action: Object.freeze({ label: 'ИЗМЕНИТЬ СОСТОЯНИЕ', technical: 'ACTION', httpLike: 'POST / PUT-like' }),
    delete: Object.freeze({ label: 'УДАЛИТЬ', technical: 'DELETE', httpLike: 'DELETE-like' }),
    calculate: Object.freeze({ label: 'ВЫЧИСЛИТЬ', technical: 'CALCULATE', httpLike: 'local deterministic' }),
    compare: Object.freeze({ label: 'СРАВНИТЬ', technical: 'COMPARE', httpLike: 'local deterministic' })
  });
  const TOOL_INSPECTOR_META = Object.freeze({
    'customer.lookup': Object.freeze({
      actionType: 'lookup',
      className: 'НАЙТИ / ПРОВЕРИТЬ (LOOKUP / VERIFY)',
      category: 'абонент (customer)',
      operation: 'поиск абонента (lookup)',
      purpose: 'Находит и однозначно привязывает абонента. После подтверждения identity запускается bounded Subscriber Bootstrap Snapshot.',
      input: 'login | contract | ip | address',
      reads: 'Billing listuser → a=user → bootstrap: main + address + technical',
      returns: 'confirmedSubscriber + confirmedCaseId + bootstrap status/snapshot'
    }),
    'customer.confirm': Object.freeze({
      actionType: 'store',
      className: 'СОХРАНИТЬ КОНТЕКСТ (STORE / STATE)',
      category: 'абонент (customer)',
      operation: 'подтверждение абонента (confirm)',
      purpose: 'Подтверждает выбранного кандидата и закрепляет абонент case.',
      input: 'candidate / caseId'
    }),
    'customer.snapshot': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'абонент (customer)',
      operation: 'рабочий снимок (snapshot)',
      purpose: 'Возвращает сохранённый рабочий профиль подтверждённого абонента.',
      input: 'confirmed абонент context',
      reads: 'local simnet_ai_operator_billing_snapshots_v1',
      returns: 'identity + address + service + finance + network + technical + bootstrapMeta'
    }),
    'billing.main_summary': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'биллинг (billing)',
      operation: 'канонический снимок главной карточки (main summary)',
      purpose: 'Одним READ получает основной Billing-блок и проецирует только запрошенные canonical facts.',
      input: 'confirmed абонент context + requiredCanonicalFacts',
      reads: 'Billing a=user · table.tbg1.nav3.width100',
      returns: 'запрошенные canonical facts: finance / tariff / service'
    }),
    'billing.balance': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'биллинг (billing)',
      operation: 'баланс (balance)',
      purpose: 'Проецирует финансовые поля из свежего снимка абонента (Subscriber Snapshot) / источника Billing.',
      input: 'confirmed абонент context',
      reads: 'снимок абонента (Subscriber Snapshot).finance; обновить Billing main только если данных нет или они устарели',
      returns: 'канонические финансовые факты'
    }),
    'billing.tariff': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'биллинг (billing)',
      operation: 'тариф (tariff)',
      purpose: 'Проецирует текущий и запланированный тариф из Снимок абонента (Subscriber Snapshot) / источник Billing.',
      input: 'confirmed абонент context',
      reads: 'снимок абонента (Subscriber Snapshot).service; обновить Billing main только если данных нет или они устарели',
      returns: 'канонические факты тарифа / услуги'
    }),
    'billing.history': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'биллинг / история (Billing payshow)',
      operation: 'история клиента (history)',
      purpose: 'Читает исторические события Billing: изменения пакета, блокировки, временные платежи, изменения данных и другие записи payshow.',
      input: 'confirmed абонент context · scope=all|events',
      reads: 'Billing payshow → table.usrlist.width100',
      returns: 'history.events[] + packageBeforeBlock + count + observedAt'
    }),
    'billing.payments': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'биллинг (billing)',
      operation: 'платежи / события (payments)',
      purpose: 'Читает доступные подтверждённые события/платежи абонента.',
      input: 'confirmed абонент context'
    }),
    'userside.snapshot': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'UserSide',
      operation: 'снимок абонента (snapshot)',
      purpose: 'Читает подтверждённый UserSide-контекст абонента.',
      input: 'confirmed абонент context'
    }),
    'building.snapshot': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'UserSide / дом',
      operation: 'карточка дома (building snapshot)',
      purpose: 'Находит карточку дома в локальном UserSide building index по адресу.',
      input: 'address | confirmedSubscriber.address',
      reads: 'simnet_crm_building_snapshot_v1',
      returns: 'данные дома / доступные возможности по найденному адресу'
    }),
    'network.session': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'сеть (network)',
      operation: 'текущая сессия (session)',
      purpose: 'Читает актуальный сетевой/session-контекст подтверждённого абонента.',
      input: 'confirmed абонент context',
      reads: 'актуальный сетевой источник / BRAS',
      returns: 'подтверждённые данные текущей сетевой сессии'
    }),
    'pon.onu': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'PON',
      operation: 'ONU / ONT',
      purpose: 'Читает подтверждённые данные ONU/ONT.',
      input: 'confirmed абонент context'
    }),
    'pon.signal': Object.freeze({
      actionType: 'read',
      className: 'ЧИТАТЬ (READ / GET-like)',
      category: 'PON',
      operation: 'сигнал (signal)',
      purpose: 'Читает актуальные PON/OLT signal evidence.',
      input: 'confirmed абонент context'
    })
  });
  const IMPORTANT_JSON_KEYS = new Set(['field', 'why', 'tool', 'ok', 'code', 'source', 'data', 'requestedBy', 'system', 'request', 'kept', 'dropped', 'completeness', 'conclusion']);
  const FACT_KEYS = new Set([
    'billingId', 'contract', 'login', 'address', 'fullName', 'connectionFamily',
    'accountBalance', 'balanceAfterTariff', 'balanceWithoutTemporary', 'temporaryPayment', 'price', 'totalDue',
    'accessState', 'serviceState', 'currentTariff', 'tariffDisplay', 'nextTariff',
    'subscriberIp', 'ip', 'subscriberMac', 'mac', 'bras', 'status', 'isOnline', 'isActive', 'vlan',
    'onuSerial', 'onuMac', 'oltName', 'oltIp', 'port', 'foundOnOlt', 'rx', 'tx', 'oltRx', 'onuLanLinkState'
  ]);

  let selectedMessageId = '';
  const inspectedTurns = new Map();
  let eventsNode = null;
  let observer = null;
  let timer = 0;
  let rendering = false;
  let inspectorNode = null;
  let inspectorPinned = false;
  let inspectorAnchor = null;
  let inspectorCloseTimer = 0;
  let inspectorLoadToken = 0;
  let inspectorState = {};
  let inspectorToolTrace = [];

  function create(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function short(value, max = 360) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function hoverTitle(node, detail = '') {
    const value = short(detail, 1400);
    if (!node || !value) return node;
    node.title = value;
    node.classList.add('ai-runtime-hover');
    return node;
  }

  function asArray(value) {
    return Array.isArray(value) ? value.filter(item => item != null && String(item).trim() !== '') : [];
  }

  function activeVariant(experiment = {}) {
    const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
    return variants.find(item => item?.label === experiment?.activeVariant) || variants[0] || null;
  }

  function toolHint(trace = {}) {
    const requested = `${trace?.requestedBy?.field || ''} ${trace?.requestedBy?.why || ''}`;
    return requested.match(TOOL_HINT_RE)?.[1]?.toLowerCase() || '';
  }

  function toolMismatch(trace = {}) {
    const expected = toolHint(trace);
    const actual = String(trace?.tool || '').toLowerCase();
    return expected && actual && expected !== actual ? { expected, actual } : null;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ai-trace-root{margin:0 0 10px;padding:10px;border:1px solid #d9e1eb;border-radius:10px;background:#fff}
      .ai-trace-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      .ai-trace-head strong{font-size:12px;color:#0f172a}.ai-trace-head span{font:700 9.5px/1.35 ui-monospace,monospace;color:#526174}
      .ai-trace-list{position:relative;display:grid;gap:0;padding-left:2px}
      .ai-trace-step{position:relative;display:grid;grid-template-columns:26px 118px minmax(0,1fr);gap:8px;padding:8px 4px 8px 0;border-top:1px solid #edf1f5}
      .ai-trace-step:first-child{border-top:0}.ai-trace-step:not(:last-child)::after{content:'';position:absolute;left:12px;top:32px;bottom:-8px;width:2px;background:#d9e1eb}
      .ai-trace-index{position:relative;z-index:1;display:grid;place-items:center;width:24px;height:24px;border-radius:999px;background:#eef2f7;color:#475569;font:800 9px ui-monospace,monospace}
      .ai-trace-label{padding-top:4px;color:#475569;font:850 9.5px/1.4 ui-monospace,monospace;letter-spacing:.04em}
      .ai-trace-body{min-width:0;color:#1e293b;font-size:10.5px;font-weight:500;line-height:1.55}.ai-trace-body b{color:#0f172a}.ai-trace-body .muted{color:#526174}
      .ai-trace-step.intent .ai-trace-index{background:#e8f1ff;color:#1d4ed8}.ai-trace-step.need .ai-trace-index{background:#e0f2fe;color:#0369a1}
      .ai-trace-step.tool .ai-trace-index{background:#dbeafe;color:#1d4ed8}.ai-trace-step.fact .ai-trace-index{background:#dcfce7;color:#166534}
      .ai-trace-step.relevance .ai-trace-index{background:#e6f7ff;color:#0369a1}.ai-trace-step.verify .ai-trace-index{background:#fef3c7;color:#92400e}.ai-trace-step.answer .ai-trace-index{background:#e2e8f0;color:#334155}
      .ai-trace-line{margin:1px 0}.ai-trace-chip{display:inline-block;margin:2px 4px 2px 0;padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px;background:#f1f5f9;color:#334155;font:800 9.5px ui-monospace,monospace}
      .ai-trace-chip.ok{background:#ecfdf3;color:#067647}.ai-trace-chip.bad{background:#fff1f1;color:#b42318}.ai-trace-chip.warn{background:#fff7e6;color:#9a6700}
      .ai-trace-mismatch{margin-top:5px;padding:6px 8px;border:1px solid #f7b4b4;border-radius:7px;background:#fff5f5;color:#b42318;font:800 9px/1.4 ui-monospace,monospace}
      .ai-trace-tools{display:grid;gap:5px}.ai-trace-tool{padding:6px 8px;border:1px solid #dbe4ef;border-radius:8px;background:#f8fbff}
      .ai-trace-tool-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.ai-trace-tool-head strong{font:800 10px ui-monospace,monospace}
      .ai-trace-filter{display:grid;gap:6px}.ai-trace-filter-group{padding:6px 8px;border-radius:8px;border:1px solid #e6ebf1;background:#fafbfc}
      .ai-trace-filter-group.keep{border-color:#b7e3c6;background:#f4fbf6}.ai-trace-filter-group.drop{border-color:#f4c9c9;background:#fff8f8}
      .ai-trace-filter-item{margin:3px 0}.ai-trace-filter-reason{color:#64748b;margin-left:4px}
      .ai-trace-raw{margin-top:5px}.ai-trace-raw>summary{cursor:pointer;color:#64748b;font:700 9px ui-monospace,monospace}
      .ai-trace-json{margin:5px 0 0;padding:7px 8px;max-height:280px;overflow:auto;border:1px solid #e6ebf1;border-radius:7px;background:#fbfcfd;font:9px/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
      .ai-trace-json-line{display:block}.ai-trace-json-line.key-intent{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#fff4db;color:#8a4b00;font-weight:800}
      .ai-trace-json-line.key-tool{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#eaf2ff;color:#174ea6;font-weight:800}
      .ai-trace-json-line.key-status{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#ecfdf3;color:#067647;font-weight:800}
      .ai-trace-json-line.key-source{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#e0f2fe;color:#0369a1;font-weight:800}
      .ai-trace-json-line.key-data{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#f0f9ff;color:#075985;font-weight:800}
      .ai-trace-json-line.key-relevance{margin:1px -4px;padding:1px 4px;border-radius:4px;background:#f1f5f9;color:#475569;font-weight:800}
      .ai-trace-history-label{margin:10px 0 5px;color:#8a95a5;font:800 8px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
      .ai-runtime-map{display:grid;gap:7px;margin:7px 0 10px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc}
      .ai-runtime-map-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.ai-runtime-map-head>div{display:grid;gap:2px}.ai-runtime-map-head strong{font-size:12px;color:#0f172a}.ai-runtime-map-head span{font:700 9px/1.35 ui-monospace,monospace;color:#475569}
      .ai-runtime-flow{display:grid;grid-template-columns:minmax(0,1.05fr) 18px minmax(0,1fr) 18px minmax(0,.9fr);gap:5px;align-items:stretch}.ai-runtime-arrow{display:grid;place-items:center;color:#64748b;font:900 14px ui-monospace,monospace}
      .ai-runtime-stage{min-width:0;padding:8px;border:1px solid #bfcada;border-radius:9px;background:#fff}.ai-runtime-stage>header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.ai-runtime-stage>header strong{font:900 10px ui-monospace,monospace;letter-spacing:.05em;color:#1e293b}.ai-runtime-stage>header span{font:800 9px ui-monospace,monospace;color:#475569}
      .ai-runtime-snapshot{border-top:3px solid #2563eb}.ai-runtime-tools-stage{border-top:3px solid #0891b2}.ai-runtime-model-stage{border-top:3px solid #64748b}
      .ai-runtime-status{display:inline-flex;padding:2px 5px;border-radius:999px;background:#eef2f7;color:#475569;font:800 8px ui-monospace,monospace}.ai-runtime-status.ok{background:#ecfdf3;color:#067647}.ai-runtime-status.warn{background:#fff7e6;color:#9a6700}.ai-runtime-status.bad{background:#fff1f1;color:#b42318}
      .ai-runtime-groups{display:grid;gap:6px}.ai-runtime-group{border:1px dashed rgba(15,23,42,.62);border-radius:7px;background:#fbfdff;overflow:hidden}.ai-runtime-group>summary{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:7px 8px;cursor:pointer;color:#0f172a;background:#f3f6fa;font:900 9.5px ui-monospace,monospace}.ai-runtime-group>summary b{color:#111827;letter-spacing:.02em}.ai-runtime-group>summary span{color:#475569;font-weight:750}.ai-runtime-group pre{margin:0;padding:9px;border-top:1px dotted rgba(15,23,42,.38);background:#fff;color:#1e293b;font:9.5px/1.55 ui-monospace,monospace;letter-spacing:.005em;white-space:pre-wrap;word-break:break-word;max-height:225px;overflow:auto}
      .ai-runtime-tool-list{display:grid;gap:5px}.ai-runtime-call{padding:6px;border:1px solid #dbe4ef;border-radius:8px;background:#f8fbff}.ai-runtime-call-head{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.ai-runtime-method{padding:2px 5px;border-radius:5px;background:#dbeafe;color:#1d4ed8;font:900 8px ui-monospace,monospace}.ai-runtime-call-title{font:900 10px ui-monospace,monospace;color:#0f172a}.ai-runtime-call-purpose{margin-top:3px;color:#3f4d61;font-size:9.5px;font-weight:600;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-runtime-call-meta{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;font-size:9px}.ai-runtime-call-meta b{display:none}.ai-runtime-call-meta span{max-width:100%;padding:2px 5px;border:1px dotted #cbd5e1;border-radius:5px;background:#fff;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-runtime-call details{margin-top:4px}.ai-runtime-call details>summary{cursor:pointer;color:#334155;font:800 9px ui-monospace,monospace}.ai-runtime-call pre{margin:4px 0 0;padding:7px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#1e293b;font:9px/1.48 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.ai-runtime-hover{cursor:help;text-decoration:underline dotted rgba(71,85,105,.55);text-underline-offset:2px}
      .ai-runtime-model-note{margin-bottom:6px;padding:6px 7px;border:1px solid #d7e0eb;border-radius:6px;background:#eef2f7;color:#334155;font-size:9px;font-weight:600;line-height:1.45}.ai-runtime-facts{display:grid;gap:3px}.ai-runtime-fact{padding:5px 6px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#1e293b;font-size:9px;font-weight:600;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-runtime-fact b{color:#0f172a}.ai-runtime-empty{padding:7px;border:1px dashed #b8c4d4;border-radius:7px;color:#526174;font-size:9px;font-weight:600}
      .ai-runtime-snapshot-portrait{display:grid;gap:6px;margin-bottom:7px;padding:7px 8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}.ai-runtime-snapshot-portrait-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.ai-runtime-snapshot-portrait-head b{font:900 9.5px ui-monospace,monospace;color:#0f172a}.ai-runtime-snapshot-portrait-head span{font-size:9px;font-weight:600;color:#526174}.ai-runtime-snapshot-portrait .ai-tool-inspector-grid{grid-template-columns:max-content minmax(0,1fr);font-size:9.5px;line-height:1.45}.ai-runtime-snapshot-portrait .ai-tool-inspector-grid b{color:#64748b}.ai-runtime-snapshot-portrait .ai-tool-inspector-grid span{color:#172033;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ai-runtime-model-section{display:grid;gap:3px;margin-top:6px;padding:5px;border:1px solid #e2e8f0;border-radius:7px;background:#fbfdff}.ai-runtime-model-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 1px 3px}.ai-runtime-model-section-head b{font:900 9.5px ui-monospace,monospace}.ai-runtime-model-section-head span{display:grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#eef2f7;color:#475569;font:900 8px ui-monospace,monospace}.ai-runtime-model-section.known{border-color:#b7e3c6;background:#f7fcf8}.ai-runtime-model-section.known .ai-runtime-model-section-head b{color:#067647}.ai-runtime-model-section.unknown{border-color:#e6d39a;background:#fffdf6}.ai-runtime-model-section.unknown .ai-runtime-model-section-head b{color:#8a5a00}.ai-runtime-model-section.error{border-color:#f1b8b8;background:#fff8f8}.ai-runtime-model-section.error .ai-runtime-model-section-head b{color:#b42318}.ai-runtime-model-section.next{border-color:#bfdbfe;background:#f8fbff}.ai-runtime-model-section.next .ai-runtime-model-section-head b{color:#1d4ed8}.ai-runtime-fact-known{border-color:#ccebd6}.ai-runtime-fact-unknown{border-color:#eadcae;background:#fffef9}.ai-runtime-intent{margin-bottom:4px;background:#f8fafc}.ai-runtime-error-row,.ai-runtime-next-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;padding:6px 7px;border-radius:6px;background:#fff;font-size:9px;font-weight:600;line-height:1.42}.ai-runtime-error-row{border:1px solid #f3c7c7}.ai-runtime-error-row b{color:#b42318}.ai-runtime-error-row span{color:#7f1d1d}.ai-runtime-next-row{grid-template-columns:minmax(0,1fr) auto auto;border:1px solid #dbeafe}.ai-runtime-next-row b{color:#1d4ed8;font:850 8px ui-monospace,monospace}.ai-runtime-next-row span{color:#475569}.ai-runtime-next-row em{align-self:center;padding:2px 4px;border-radius:4px;background:#eef2f7;color:#64748b;font:900 7px ui-monospace,monospace;font-style:normal}.ai-runtime-used{margin-top:6px}.ai-runtime-used>summary{cursor:pointer;color:#475569;font:850 8px ui-monospace,monospace}
      .ai-runtime-full{margin-top:6px}.ai-runtime-full>summary{cursor:pointer;color:#2563eb;font:900 8px ui-monospace,monospace}.ai-runtime-full pre{margin:5px 0 0;padding:7px;max-height:320px;overflow:auto;border:1px solid #dbe4ef;border-radius:6px;background:#fff;color:#334155;font:8px/1.4 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
      .ai-tool-ref{display:inline-flex;align-items:center;max-width:100%;border-bottom:1px dotted #2563eb;color:#1d4ed8;font:800 9px ui-monospace,monospace;cursor:help;outline:none}
      .ai-tool-ref:hover,.ai-tool-ref:focus{color:#1d4ed8;border-bottom-style:solid;background:#eff6ff;border-radius:3px}
      .ai-tool-inspector{position:fixed;z-index:2147483646;width:min(560px,calc(100vw - 24px));max-height:min(74vh,720px);overflow:auto;padding:0;border:1px solid #aebdce;border-radius:10px;background:#fff;color:#0f172a;box-shadow:0 18px 55px rgba(15,23,42,.24);font:11px/1.5 Inter,system-ui,sans-serif}
      .ai-tool-inspector[hidden]{display:none}
      .ai-tool-inspector-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 11px;border-bottom:1px solid #e6ebf1;background:#fff}
      .ai-tool-inspector-title{display:grid;gap:2px}.ai-tool-inspector-title strong{font:900 12px ui-monospace,monospace;color:#172033}.ai-tool-inspector-title span{font:800 8px ui-monospace,monospace;color:#2563eb;text-transform:uppercase;letter-spacing:.06em}
      .ai-tool-inspector-close{display:grid;place-items:center;width:24px;height:24px;padding:0;border:1px solid #dbe4ef;border-radius:6px;background:#f8fafc;color:#64748b;cursor:pointer;font:800 13px/1 system-ui}
      .ai-tool-inspector-body{display:grid;gap:8px;padding:10px 11px 12px}
      .ai-tool-inspector-section{padding:8px;border:1px solid #e6ebf1;border-radius:8px;background:#fbfcfd}
      .ai-tool-inspector-section>strong{display:block;margin-bottom:5px;color:#475569;font:900 9px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase}
      .ai-tool-inspector-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 9px}.ai-tool-inspector-grid b{color:#475569;font-weight:800}.ai-tool-inspector-grid span{min-width:0;word-break:break-word}
      .ai-tool-inspector pre{margin:5px 0 0;padding:7px;max-height:230px;overflow:auto;border:1px solid #e6ebf1;border-radius:6px;background:#fff;font:9px/1.4 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
      .ai-tool-inspector details>summary{cursor:pointer;color:#475569;font:800 9px ui-monospace,monospace}
      .ai-tool-inspector-empty{color:#94a3b8;font-style:italic}
      .ai-tool-inspector-pin{padding:2px 5px;border-radius:5px;background:#e0f2fe;color:#0369a1;font:800 8px ui-monospace,monospace}

      /* Color identifies each stage; labels also preserve meaning without color. */
      .ai-runtime-map{padding:12px;background:#eaf0f7;gap:12px}
      .ai-runtime-flow{gap:8px}
      .ai-runtime-stage{padding:12px;border-width:1px;border-top-width:5px}
      .ai-runtime-snapshot{background:#eff6ff;border-color:#93b8ef;border-top-color:#2563eb}
      .ai-runtime-tools-stage{background:#ecfeff;border-color:#67cbd6;border-top-color:#0891b2}
      .ai-runtime-model-stage{background:#f5f3ff;border-color:#c4b5fd;border-top-color:#7c3aed}
      .ai-runtime-stage>header strong{font:800 13px/1.4 system-ui,sans-serif;letter-spacing:0}
      .ai-runtime-map-head strong{font-size:15px}
      .ai-runtime-map-head span,.ai-runtime-stage>header span,.ai-runtime-status{font-size:11px}
      .ai-runtime-group>summary,.ai-runtime-snapshot-portrait-head b,.ai-runtime-model-section-head b{font:750 12px/1.45 system-ui,sans-serif}
      .ai-runtime-group>summary{background:#dbeafe}
      .ai-runtime-group pre,.ai-runtime-call pre,.ai-runtime-full pre{font-size:11px;line-height:1.6}
      .ai-runtime-call{padding:10px;background:#fff;border-color:#a5d8df}
      .ai-runtime-call-title{font:750 12px/1.5 system-ui,sans-serif}
      .ai-runtime-method,.ai-runtime-call-meta,.ai-runtime-call details>summary,.ai-runtime-full>summary,.ai-runtime-used>summary{font-size:11px}
      .ai-runtime-call-purpose,.ai-runtime-fact,.ai-runtime-error-row,.ai-runtime-next-row,.ai-runtime-model-note,.ai-runtime-empty{font-size:12px;line-height:1.55;font-weight:600;white-space:normal;overflow-wrap:anywhere}
      .ai-runtime-snapshot-portrait .ai-tool-inspector-grid{font-size:12px;line-height:1.55}
      .ai-runtime-model-section{padding:8px;gap:6px}
      .ai-runtime-model-section.known{background:#dcfce7;border-color:#86cda0}
      .ai-runtime-model-section.unknown{background:#fef3c7;border-color:#e7ba4d}
      .ai-runtime-model-section.error{background:#fee2e2;border-color:#eaa0a0}
      .ai-runtime-model-section.next{background:#dbeafe;border-color:#93b8ef}
      .ai-runtime-next-row b,.ai-runtime-next-row em{font-size:10px}
      .ai-runtime-request{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 9px;margin:9px 0;padding:9px;border:1px solid #a5d8df;border-radius:7px;background:#f0fdff;font:11px/1.5 ui-monospace,monospace}
      .ai-runtime-request dt{font-weight:800;color:#155e75}.ai-runtime-request dd{margin:0;color:#172033;overflow-wrap:anywhere;white-space:pre-wrap}
      @media(max-width:900px){.ai-runtime-flow{grid-template-columns:1fr}.ai-runtime-arrow{transform:rotate(90deg);height:18px}}
      @media(max-width:760px){.ai-trace-step{grid-template-columns:26px 88px minmax(0,1fr)}.ai-tool-inspector{left:12px!important;right:12px!important;width:auto!important;max-height:65vh}}
    `;
    document.head.append(style);
  }

  function normalizedToolName(value = '') {
    const raw = String(value || '').trim().replace(/^tool:/i, '').toLowerCase();
    return TOOL_INSPECTOR_META[raw] ? raw : '';
  }

  function traceForTool(tool = '') {
    const name = normalizedToolName(tool);
    if (!name) return null;
    for (let i = inspectorToolTrace.length - 1; i >= 0; i -= 1) {
      if (String(inspectorToolTrace[i]?.tool || '').toLowerCase() === name) return inspectorToolTrace[i];
    }
    return null;
  }

  function inspectorBillingId(trace = null, state = {}) {
    const values = [
      trace?.data?.candidate?.billingId,
      trace?.data?.billingId,
      state?.toolState?.confirmedSubscriber?.billingId,
      String(state?.toolState?.confirmedCaseId || '').replace(/^billing-live:/, '')
    ];
    for (const value of values) {
      const id = String(value || '').replace(/\D+/g, '').slice(0, 12);
      if (id) return id;
    }
    return '';
  }

  function jsonText(value) {
    try { return JSON.stringify(value ?? null, null, 2); }
    catch { return String(value ?? ''); }
  }

  function inspectorSection(title, content) {
    const section = create('section', 'ai-tool-inspector-section');
    section.append(create('strong', '', title));
    if (content instanceof Node) section.append(content);
    else section.append(create('div', '', content));
    return section;
  }

  function inspectorGrid(rows = []) {
    const grid = create('div', 'ai-tool-inspector-grid');
    for (const [label, value] of rows) {
      grid.append(create('b', '', label), create('span', '', value == null || value === '' ? '—' : String(value)));
    }
    return grid;
  }

  function inspectorJsonDetails(label, value, open = false) {
    const details = create('details');
    details.open = Boolean(open);
    details.append(create('summary', '', label), create('pre', '', jsonText(value)));
    return details;
  }

  function snapshotSummary(snapshot = {}) {
    const identity = snapshot?.identity || {};
    const address = snapshot?.address || {};
    const service = snapshot?.service || {};
    const finance = snapshot?.finance || {};
    const technical = snapshot?.technical || {};
    const bootstrap = snapshot?.bootstrapMeta || {};
    return inspectorGrid([
      ['ФИО', identity.fullName || '—'],
      ['Договор', identity.contract || '—'],
      ['Логин (login)', identity.login || '—'],
      ['Адрес', address.full || address.fullAddress || '—'],
      ['Тариф', service.currentTariff || service.current?.name || '—'],
      ['Баланс', finance.accountBalance ?? '—'],
      ['К оплате', finance.totalDue ?? '—'],
      ['Технология', technical.technologyHint || '—'],
      ['OLT', technical.olt || '—'],
      ['Сбор снимка (bootstrap)', bootstrap.status || '—'],
      ['Актуальность (observedAt)', snapshot.observedAt || '—']
    ]);
  }

  async function loadSubscriberSnapshot(tool, trace) {
    if (!['customer.lookup', 'customer.snapshot', 'billing.main_summary', 'billing.balance', 'billing.tariff', 'billing.history', 'billing.payments', 'building.snapshot', 'userside.snapshot', 'network.session', 'pon.onu', 'pon.signal'].includes(tool)) return null;
    const billingId = inspectorBillingId(trace, inspectorState);
    if (!billingId || !chrome?.storage?.local?.get) return null;
    const stored = await chrome.storage.local.get(BILLING_SNAPSHOT_KEY);
    const all = stored?.[BILLING_SNAPSHOT_KEY];
    const snapshot = all && typeof all === 'object' && !Array.isArray(all) ? all[billingId] : null;
    return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null;
  }

  function ensureInspector() {
    if (inspectorNode?.isConnected) return inspectorNode;
    inspectorNode = create('aside', 'ai-tool-inspector');
    inspectorNode.id = TOOL_INSPECTOR_ID;
    inspectorNode.hidden = true;
    inspectorNode.addEventListener('mouseenter', () => clearTimeout(inspectorCloseTimer));
    inspectorNode.addEventListener('mouseleave', () => {
      if (!inspectorPinned) scheduleInspectorClose();
    });
    document.body.append(inspectorNode);
    return inspectorNode;
  }

  function positionInspector(anchor) {
    const node = ensureInspector();
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) return;
    const width = Math.min(520, Math.max(320, window.innerWidth - 24));
    const gap = 8;
    let left = rect.left;
    let top = rect.bottom + gap;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    const estimatedHeight = Math.min(node.scrollHeight || 420, window.innerHeight * 0.72);
    if (top + estimatedHeight > window.innerHeight - 12) top = Math.max(12, rect.top - estimatedHeight - gap);
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
  }

  function hideInspector(force = false) {
    if (inspectorPinned && !force) return;
    clearTimeout(inspectorCloseTimer);
    inspectorPinned = false;
    inspectorAnchor = null;
    inspectorLoadToken += 1;
    if (inspectorNode) inspectorNode.hidden = true;
  }

  function scheduleInspectorClose() {
    clearTimeout(inspectorCloseTimer);
    inspectorCloseTimer = window.setTimeout(() => hideInspector(false), 180);
  }

  async function showInspector(toolValue, anchor, pin = false) {
    const tool = normalizedToolName(toolValue);
    if (!tool) return;
    clearTimeout(inspectorCloseTimer);
    inspectorPinned = Boolean(pin || inspectorPinned);
    inspectorAnchor = anchor;
    const node = ensureInspector();
    node.hidden = false;
    const meta = TOOL_INSPECTOR_META[tool] || {};
    const trace = traceForTool(tool);
    const token = ++inspectorLoadToken;

    const head = create('div', 'ai-tool-inspector-head');
    const title = create('div', 'ai-tool-inspector-title');
    title.append(create('strong', '', tool), create('span', '', `${meta.className || 'TOOL'} · ${meta.category || tool.split('.')[0]}`));
    const end = create('div');
    if (inspectorPinned) end.append(create('span', 'ai-tool-inspector-pin', 'PINNED'));
    const close = create('button', 'ai-tool-inspector-close', '×');
    close.type = 'button';
    close.title = 'Закрыть inspector';
    close.addEventListener('click', event => {
      event.stopPropagation();
      hideInspector(true);
    });
    end.append(close);
    head.append(title, end);

    const body = create('div', 'ai-tool-inspector-body');
    body.append(inspectorSection('Контракт инструмента (tool contract)', inspectorGrid([
      ['Класс действия', meta.className || '—'],
      ['Технический класс', ACTION_TAXONOMY[meta.actionType]?.technical || '—'],
      ['HTTP-аналог', ACTION_TAXONOMY[meta.actionType]?.httpLike || '—'],
      ['Категория', meta.category || tool.split('.')[0]],
      ['Операция', meta.operation || tool.split('.')[1] || '—'],
      ['Входные данные', meta.input || '—'],
      ['Что читает', meta.reads || 'источник определяется инструментом'],
      ['Что возвращает', meta.returns || 'результат / evidence инструмента'],
      ['Что делает', meta.purpose || '—']
    ])));

    body.append(inspectorSection('Последний вызов (last call)', inspectorGrid([
      ['Статус', trace ? (trace.ok ? 'УСПЕХ (OK)' : `ОШИБКА (ERROR) ${trace.code || ''}`.trim()) : 'нет вызова в текущем ходе'],
      ['Источник (source)', trace?.source || '—'],
      ['Запрошенное поле', trace?.requestedBy?.field || '—'],
      ['Зачем (why)', trace?.requestedBy?.why || '—'],
      ['Кэш (cache)', trace?.cache || '—']
    ])));
    if (trace?.args && Object.keys(trace.args).length) body.append(inspectorSection('Входные аргументы (input args)', inspectorJsonDetails('args', trace.args, true)));
    if (trace?.data) body.append(inspectorSection('Последний результат (last result)', inspectorJsonDetails('data', trace.data, false)));

    const confirmed = inspectorState?.toolState?.confirmedSubscriber || null;
    body.append(inspectorSection('Состояние абонента (subscriber state)', confirmed
      ? inspectorJsonDetails('confirmedSubscriber', confirmed, true)
      : create('div', 'ai-tool-inspector-empty', 'Подтверждённый абонент (confirmedSubscriber) отсутствует')));

    const loading = inspectorSection('Снимок абонента (Subscriber Snapshot)', create('div', 'ai-tool-inspector-empty', 'Читаю локальный снимок (snapshot)…'));
    body.append(loading);

    node.replaceChildren(head, body);
    positionInspector(anchor);

    let snapshot = null;
    try { snapshot = await loadSubscriberSnapshot(tool, trace); } catch {}
    if (token !== inspectorLoadToken || node.hidden) return;
    loading.replaceChildren(create('strong', '', 'Снимок абонента (Subscriber Snapshot)'));
    if (snapshot) {
      loading.append(snapshotSummary(snapshot), inspectorJsonDetails('Полный снимок (snapshot)', snapshot, false));
    } else {
      loading.append(create('div', 'ai-tool-inspector-empty', 'Для этого вызова локальный снимок абонента (абонент snapshot) не найден.'));
    }
    positionInspector(anchor);
  }

  function toolRef(toolValue, label = '') {
    const tool = normalizedToolName(toolValue);
    if (!tool) return create('span', '', label || toolValue);
    const ref = create('span', 'ai-tool-ref', label || toolValue || tool);
    ref.tabIndex = 0;
    ref.dataset.tool = tool;
    ref.addEventListener('mouseenter', () => showInspector(tool, ref, false));
    ref.addEventListener('mouseleave', () => scheduleInspectorClose());
    ref.addEventListener('focus', () => showInspector(tool, ref, false));
    ref.addEventListener('blur', () => scheduleInspectorClose());
    ref.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      inspectorPinned = true;
      showInspector(tool, ref, true);
    });
    return ref;
  }

  function appendDecoratedToolText(node, textValue = '') {
    const value = String(textValue || '');
    let last = 0;
    TOOL_REF_RE.lastIndex = 0;
    let match;
    while ((match = TOOL_REF_RE.exec(value))) {
      if (match.index > last) node.append(document.createTextNode(value.slice(last, match.index)));
      node.append(toolRef(match[0], match[0]));
      last = match.index + match[0].length;
    }
    if (last < value.length) node.append(document.createTextNode(value.slice(last)));
  }

  function primitivePreview(value, maxItems = 7) {
    if (!value || typeof value !== 'object') return short(value, 100);
    const parts = [];
    for (const [key, child] of Object.entries(value)) {
      if (parts.length >= maxItems) break;
      if (child == null || child === '' || typeof child === 'object') continue;
      parts.push(`${key}=${short(child, 58)}`);
    }
    return parts.join(' · ') || `${Array.isArray(value) ? value.length : Object.keys(value).length} полей`;
  }

  function runtimeSnapshotStage(snapshot = null, state = {}) {
    const stage = create('section', 'ai-runtime-stage ai-runtime-snapshot');
    const head = create('header');
    head.append(create('strong', '', 'СНИМОК АБОНЕНТА (SUBSCRIBER SNAPSHOT)'));
    const status = snapshot?.bootstrapMeta?.status || (state?.toolState?.confirmedSubscriber ? 'только identity' : 'абонент не привязан');
    head.append(create('span', `ai-runtime-status ${status === 'ready' ? 'ok' : snapshot ? 'warn' : ''}`, status.toUpperCase()));
    stage.append(head);

    if (!snapshot) {
      const confirmed = state?.toolState?.confirmedSubscriber;
      stage.append(create('div', 'ai-runtime-empty', confirmed
        ? 'Полный локальный снимок (snapshot) ещё не найден. Ниже доступен только подтверждённый абонент (confirmedSubscriber).'
        : 'Абонент ещё не подтверждён — снимок абонента отсутствует.'));
      if (confirmed) {
        const fallback = create('details', 'ai-runtime-group');
        const summary = create('summary');
        summary.append(create('b', '', 'confirmedSubscriber'), create('span', '', primitivePreview(confirmed)));
        fallback.append(summary, create('pre', '', jsonText(confirmed)));
        stage.append(fallback);
      }
      return stage;
    }

    const portrait = create('section', 'ai-runtime-snapshot-portrait');
    const portraitHead = create('div', 'ai-runtime-snapshot-portrait-head');
    portraitHead.append(
      create('b', '', 'ПОРТРЕТ АБОНЕНТА'),
      create('span', '', 'компактная проекция снимка; подробности ниже')
    );
    portrait.append(portraitHead, snapshotSummary(snapshot));
    hoverTitle(portrait, 'Сводка из Subscriber Snapshot. RAW-группы ниже не удалены, а свернуты, чтобы не дублировать портрет.');
    stage.append(portrait);

    const groups = create('div', 'ai-runtime-groups');
    const preferred = ['identity','address','contacts','customer','service','finance','network','technical','payments','bootstrapMeta'];
    const seen = new Set();
    for (const key of [...preferred, ...Object.keys(snapshot)]) {
      if (seen.has(key) || ['billingId','observedAt','financeObservedAt','source','fieldObservedAt'].includes(key)) continue;
      if (!Object.hasOwn(snapshot, key)) continue;
      seen.add(key);
      const value = snapshot[key];
      const details = create('details', 'ai-runtime-group');
      details.open = false;
      const summary = create('summary');
      summary.append(create('b', '', key), create('span', '', primitivePreview(value)));
      hoverTitle(summary, jsonText(value));
      details.append(summary, create('pre', '', jsonText(value)));
      groups.append(details);
    }
    stage.append(groups);

    const snapshotMeta = create('div', 'ai-runtime-fact', `billingId: ${snapshot.billingId || snapshot.identity?.billingId || '—'} · ${snapshot.source || '—'}`);
    hoverTitle(snapshotMeta, `observedAt: ${snapshot.observedAt || '—'}\nsource: ${snapshot.source || '—'}`);
    stage.append(snapshotMeta);

    const full = create('details', 'ai-runtime-full');
    full.append(create('summary', '', 'ПОЛНЫЙ СНИМОК (FULL SNAPSHOT) · JSON'), create('pre', '', jsonText(snapshot)));
    stage.append(full);
    return stage;
  }

  function runtimeToolCallCard(trace = {}, index = 0) {
    const tool = normalizedToolName(trace?.tool) || String(trace?.tool || 'unknown');
    const meta = TOOL_INSPECTOR_META[tool] || {};
    const card = create('article', 'ai-runtime-call');
    const head = create('div', 'ai-runtime-call-head');
    const taxonomy = ACTION_TAXONOMY[meta.actionType] || ACTION_TAXONOMY.read;
    head.append(create('span', 'ai-runtime-method', `${taxonomy.label} (${taxonomy.technical})`));
    const title = create('span', 'ai-runtime-call-title');
    title.append(toolRef(tool, tool));
    head.append(title, create('span', `ai-runtime-status ${trace?.ok ? 'ok' : 'bad'}`, trace?.ok ? 'УСПЕХ (OK)' : `ОШИБКА (ERROR) · ${trace?.code || 'UNKNOWN'}`));
    card.append(head);
    const purpose = create('div', 'ai-runtime-call-purpose', short(meta.purpose || 'Вызов runtime-инструмент.', 92));
    hoverTitle(purpose, [
      meta.purpose || '',
      trace?.requestedBy?.why ? `Зачем: ${trace.requestedBy.why}` : '',
      trace?.requestedBy?.field ? `Нужно: ${trace.requestedBy.field}` : ''
    ].filter(Boolean).join('\n'));
    card.append(purpose);

    const evidence = trace?.requestEvidence || trace?.data?.evidence || {};
    const bootstrap = trace?.data?.bootstrap || {};
    const rows = [
      ['вызов №', String(index + 1)],
      ['вход', trace?.requestedBy?.field || meta.input || '—'],
      ['зачем', trace?.requestedBy?.why || '—'],
      ['читает', meta.reads || '—'],
      ['возвращает', meta.returns || '—'],
      ['источник', trace?.source || trace?.data?.source || '—'],
      ['транспорт', evidence.transport || trace?.data?.transport || '—'],
      ['метод чтения', evidence.method || '—'],
      ['стратегия поиска', trace?.data?.lookupStrategy || '—'],
      ['вычисленный Billing ID', trace?.data?.derivedBillingId || '—'],
      ['штатный запрос', trace?.data?.nativeQuery || '—'],
      ['endpoint / URL', evidence.url || evidence.endpoint || bootstrap.endpoint || '—'],
      ['DOM selector', evidence.selector || '—'],
      ['этап ошибки', trace?.data?.failurePhase || '—'],
      ['детали ошибки', trace?.data?.failureMessage || '—'],
      ['кэш', trace?.cache || '—']
    ];
    const grid = create('div', 'ai-runtime-call-meta');
    const visibleRows = rows.filter(([label, value]) => (
      ['вход', 'источник', 'кэш'].includes(label) && String(value || '—') !== '—'
    ));
    for (const [label,value] of visibleRows) {
      const chip = create('span','',`${label}: ${short(value, 74)}`);
      hoverTitle(chip, rows.map(([fullLabel, fullValue]) => `${fullLabel}: ${fullValue}`).join('\n'));
      grid.append(chip);
    }
    card.append(grid);
    const request = create('dl', 'ai-runtime-request');
    for (const [label, value] of rows.filter(([label]) => ['endpoint / URL', 'метод чтения', 'транспорт', 'DOM selector', 'кэш'].includes(label))) {
      request.append(create('dt', '', label), create('dd', '', String(value || '—')));
    }
    card.append(request);

    const args = create('details');
    args.append(create('summary', '', 'ВХОД / АРГУМЕНТЫ (INPUT / ARGS)'), create('pre', '', jsonText(trace?.args || {})));
    card.append(args);
    const result = create('details');
    result.append(create('summary', '', 'ВЫХОД / РЕЗУЛЬТАТ (OUTPUT / RESULT)'), create('pre', '', jsonText({
      ok: Boolean(trace?.ok),
      code: trace?.code || '',
      source: trace?.source || '',
      requestedFacts: trace?.requestedFacts || [],
      data: trace?.data || {},
      warnings: trace?.warnings || []
    })));
    card.append(result);
    return card;
  }

  function runtimeToolsStage(toolTrace = []) {
    const stage = create('section', 'ai-runtime-stage ai-runtime-tools-stage');
    const head = create('header');
    head.append(create('strong', '', 'ВЫЗОВЫ ИНСТРУМЕНТОВ (TOOL CALLS)'), create('span', '', `${toolTrace.length} вызов(а)`));
    stage.append(head);
    if (!toolTrace.length) {
      stage.append(create('div', 'ai-runtime-empty', 'На этом ходе runtime-инструмент не вызывался.'));
      return stage;
    }
    const list = create('div', 'ai-runtime-tool-list');
    toolTrace.forEach((trace, index) => {
      const fold = create('details', 'ai-runtime-call-fold');
      const method = trace?.requestEvidence?.method || trace?.data?.evidence?.method || 'READ';
      fold.append(create('summary', '', `${trace.tool || 'Инструмент'} · ${method} · ${trace.ok ? 'успешно' : trace.code || 'ошибка'}`), runtimeToolCallCard(trace, index));
      list.append(fold);
    });
    stage.append(list);
    return stage;
  }

  function runtimeRequestedFacts(variant = {}, toolTrace = []) {
    return [...new Set([
      ...(Array.isArray(variant?.factDiagnostics?.requestedFacts) ? variant.factDiagnostics.requestedFacts : []),
      ...toolTrace.flatMap(item => Array.isArray(item?.requestedFacts) ? item.requestedFacts : [])
    ].filter(Boolean))];
  }

  function runtimeTraceFacts(trace = {}) {
    const facts = Array.isArray(trace?.requestedFacts) ? trace.requestedFacts.filter(Boolean) : [];
    const requestedField = String(trace?.requestedBy?.field || '').trim();
    if (requestedField && /^(subscriber|customer|billing|network|pon|userside)\./i.test(requestedField)) facts.push(requestedField);
    return [...new Set(facts)];
  }

  function runtimeFactAttempt(path = '', toolTrace = []) {
    for (let index = toolTrace.length - 1; index >= 0; index -= 1) {
      const trace = toolTrace[index] || {};
      if (runtimeTraceFacts(trace).includes(path)) return trace;
    }
    return null;
  }

  function runtimeSuggestedRead(path = '', evidence = null, toolTrace = []) {
    const attempt = runtimeFactAttempt(path, toolTrace);
    const attemptedTool = normalizedToolName(attempt?.tool || '');
    if (attemptedTool) {
      return {
        tool: attemptedTool,
        reason: attempt?.ok
          ? 'Факт остался неизвестным после выполненного READ — проверить полноту/парсинг этого источника.'
          : 'Последний READ завершился ошибкой — после устранения причины логично повторить тот же источник.',
        executed: false
      };
    }
    const evidenceTool = normalizedToolName(evidence?.source || '');
    if (evidenceTool) {
      return {
        tool: evidenceTool,
        reason: 'Источник указан evidence, но отдельный успешный READ этого факта в текущей трассе не подтверждён.',
        executed: false
      };
    }
    return { tool: '', reason: 'Источник следующего READ по текущей трассе не определён.', executed: false };
  }

  function runtimeModelSection(title, tone, count) {
    const section = create('section', `ai-runtime-model-section ${tone}`);
    const head = create('div', 'ai-runtime-model-section-head');
    head.append(create('b', '', title), create('span', '', String(count)));
    section.append(head);
    return section;
  }

  function runtimeFactRow(path, evidence, toolTrace = [], tone = '') {
    const status = String(evidence?.status || 'unknown').toLowerCase();
    const value = status === 'known' ? jsonText(evidence?.value) : status;
    const attempt = runtimeFactAttempt(path, toolTrace);
    const next = runtimeSuggestedRead(path, evidence, toolTrace);
    const row = create('div', `ai-runtime-fact ai-runtime-fact-${tone || status}`);
    row.append(create('b', '', `${path}: `), document.createTextNode(short(value, 110)));
    const diagnostic = [
      path,
      `статус: ${status}`,
      `значение: ${value}`,
      `источник evidence: ${evidence?.source || '—'}`,
      `последняя попытка: ${attempt?.tool || '—'}`,
      `результат попытки: ${attempt ? (attempt.ok ? 'OK' : `ERROR ${attempt.code || 'UNKNOWN'}`) : 'не зафиксирован'}`,
      attempt?.data?.failurePhase ? `этап ошибки: ${attempt.data.failurePhase}` : '',
      attempt?.data?.failureMessage ? `детали ошибки: ${attempt.data.failureMessage}` : '',
      `предполагаемый следующий READ: ${next.tool || 'не определён'}`,
      'выполнено: НЕТ',
      `почему: ${next.reason}`
    ].filter(Boolean).join('\n');
    hoverTitle(row, diagnostic);
    return row;
  }

  function runtimeModelStage(experiment = {}, variant = {}, toolTrace = []) {
    const stage = create('section', 'ai-runtime-stage ai-runtime-model-stage');
    const head = create('header');
    head.append(create('strong', '', 'ЧТО ПОЛУЧИЛА МОДЕЛЬ (MODEL / CANONICAL VIEW)'), create('span', '', 'ПРОЕКЦИЯ ТРАССЫ (TRACE PROJECTION)'));
    stage.append(head);
    stage.append(create('div', 'ai-runtime-model-note',
      'Здесь только данные текущего хода: что подтверждено, что запрашивалось, что не удалось получить и почему. unknown не считается false.'));

    const probe = experiment?.analysis?.probe || {};
    if (probe.whatUserWants) {
      const intent = create('div', 'ai-runtime-fact ai-runtime-intent');
      intent.append(create('b', '', 'намерение (intent): '), document.createTextNode(probe.whatUserWants));
      stage.append(intent);
    }

    const requested = runtimeRequestedFacts(variant, toolTrace);
    const evidenceList = Array.isArray(variant?.factEvidence) ? variant.factEvidence : [];
    const evidenceByPath = new Map(evidenceList.filter(item => item?.path).map(item => [item.path, item]));
    const known = [];
    const unresolved = [];
    for (const path of requested) {
      const evidence = evidenceByPath.get(path) || { path, status: 'unknown', source: '' };
      if (String(evidence?.status || '').toLowerCase() === 'known') known.push([path, evidence]);
      else unresolved.push([path, evidence]);
    }

    const knownSection = runtimeModelSection('✓ ПОЛУЧЕНО', 'known', known.length);
    if (known.length) known.forEach(([path,evidence]) => knownSection.append(runtimeFactRow(path, evidence, toolTrace, 'known')));
    else knownSection.append(create('div', 'ai-runtime-empty', 'Ни один из запрошенных canonical facts не подтверждён.'));
    stage.append(knownSection);

    const unresolvedSection = runtimeModelSection('? НЕ ПОЛУЧЕНО / UNRESOLVED', 'unknown', unresolved.length);
    if (unresolved.length) unresolved.forEach(([path,evidence]) => unresolvedSection.append(runtimeFactRow(path, evidence, toolTrace, 'unknown')));
    else unresolvedSection.append(create('div', 'ai-runtime-empty', 'Запрошенных unresolved-фактов нет.'));
    stage.append(unresolvedSection);

    const failedTools = toolTrace.filter(trace => !trace?.ok);
    const errorSection = runtimeModelSection('! ОШИБКИ ЧТЕНИЯ', 'error', failedTools.length);
    if (failedTools.length) {
      for (const trace of failedTools) {
        const affected = runtimeTraceFacts(trace).filter(path => requested.includes(path));
        const row = create('div', 'ai-runtime-error-row');
        row.append(
          create('b', '', `${trace?.tool || 'tool'} · ${trace?.code || 'UNKNOWN'}`),
          create('span', '', affected.length ? `не подтверждено: ${affected.length} факт(а)` : 'влияние на canonical facts не размечено')
        );
        hoverTitle(row, [
          `tool: ${trace?.tool || '—'}`,
          `code: ${trace?.code || 'UNKNOWN'}`,
          `source: ${trace?.source || trace?.data?.source || '—'}`,
          `этап ошибки: ${trace?.data?.failurePhase || '—'}`,
          `детали ошибки: ${trace?.data?.failureMessage || '—'}`,
          `затронутые факты: ${affected.join(', ') || '—'}`,
          'READ выполнен: ДА',
          'результат: ошибка; это не доказательство отсутствия данных'
        ].join('\n'));
        errorSection.append(row);
      }
    } else errorSection.append(create('div', 'ai-runtime-empty', 'Ошибок READ/tool в текущем ходе нет.'));
    stage.append(errorSection);

    const suggestions = [];
    const seenSuggestions = new Set();
    for (const [path,evidence] of unresolved) {
      const suggestion = runtimeSuggestedRead(path, evidence, toolTrace);
      const key = `${suggestion.tool}|${suggestion.reason}`;
      if (seenSuggestions.has(key)) continue;
      seenSuggestions.add(key);
      suggestions.push({ path, ...suggestion });
    }
    const nextSection = runtimeModelSection('→ ПРЕДПОЛАГАЕМОЕ СЛЕДУЮЩЕЕ ЧТЕНИЕ', 'next', suggestions.length);
    if (suggestions.length) {
      for (const suggestion of suggestions) {
        const row = create('div', 'ai-runtime-next-row');
        row.append(
          create('b', '', suggestion.tool || 'источник не определён'),
          create('span', '', `для: ${suggestion.path}`),
          create('em', '', 'НЕ ВЫПОЛНЕНО')
        );
        hoverTitle(row, `${suggestion.reason}\nЭто диагностическая рекомендация UI, а не ACTION и не выполненный READ.`);
        nextSection.append(row);
      }
    } else nextSection.append(create('div', 'ai-runtime-empty', 'Следующее чтение не требуется по текущей трассе.'));
    stage.append(nextSection);

    const kept = Array.isArray(variant?.answerRelevance?.kept) ? variant.answerRelevance.kept : [];
    if (kept.length) {
      const used = create('details', 'ai-runtime-used');
      used.append(create('summary', '', `ИСПОЛЬЗОВАНО В ОТВЕТЕ · ${kept.length}`));
      const body = create('div', 'ai-runtime-facts');
      for (const item of kept.slice(0,18)) {
        const row=create('div','ai-runtime-fact');
        row.append(create('b','',`${item?.fact || 'fact'}: `),document.createTextNode(short(item?.reason || item?.value || 'использован',260)));
        body.append(row);
      }
      used.append(body);
      stage.append(used);
    }
    return stage;
  }

  async function hydrateRuntimeMap(container, state = {}, experiment = {}, variant = {}, toolTrace = []) {
    let snapshot = null;
    if (!state.historicalInspection) {
      try { snapshot = await loadSubscriberSnapshot('customer.snapshot', toolTrace.at(-1) || null); } catch {}
    }

    const head = create('div', 'ai-runtime-map-head');
    const title = create('div');
    title.append(create('strong', '', 'КАРТА РАБОТЫ АГЕНТА (AGENT RUNTIME MAP)'), create('span', '', 'что уже знает агент → какой инструмент вызвал → что передал дальше'));
    const billingId = inspectorBillingId(toolTrace.at(-1) || null, state);
    head.append(title, create('span', '', billingId ? `абонент ${billingId}` : 'абонент не привязан'));

    const flow = create('div', 'ai-runtime-flow');
    flow.append(
      runtimeSnapshotStage(snapshot, state),
      create('div', 'ai-runtime-arrow', '→'),
      runtimeToolsStage(toolTrace),
      create('div', 'ai-runtime-arrow', '→'),
      runtimeModelStage(experiment, variant, toolTrace)
    );

    if (!container.isConnected) return;
    rendering = true;
    observer?.disconnect();
    container.replaceChildren(head, flow);
    observer?.observe(eventsNode, { childList: true, subtree: true });
    rendering = false;
  }

  function jsonBlock(value) {
    const details = create('details', 'ai-trace-raw');
    details.append(create('summary', '', 'Технический RAW JSON'));
    const pre = create('pre', 'ai-trace-json');
    let text = '';
    try { text = JSON.stringify(value ?? null, null, 2); } catch { text = String(value ?? ''); }
    for (const line of text.split('\n')) {
      const span = create('span', 'ai-trace-json-line');
      appendDecoratedToolText(span, line);
      const key = line.match(/^\s*"([^"]+)"\s*:/)?.[1] || '';
      if (IMPORTANT_JSON_KEYS.has(key)) {
        if (key === 'field' || key === 'why' || key === 'requestedBy' || key === 'system') span.classList.add('key-intent');
        else if (key === 'tool') span.classList.add('key-tool');
        else if (key === 'ok' || key === 'code') span.classList.add('key-status');
        else if (key === 'source') span.classList.add('key-source');
        else if (key === 'data') span.classList.add('key-data');
        else span.classList.add('key-relevance');
      }
      pre.append(span, document.createTextNode('\n'));
    }
    details.append(pre);
    return details;
  }

  function step(index, label, body, tone = '') {
    const row = create('section', `ai-trace-step ${tone}`.trim());
    row.append(create('div', 'ai-trace-index', index), create('div', 'ai-trace-label', label));
    const content = create('div', 'ai-trace-body');
    if (typeof body === 'string') content.textContent = body;
    else if (body) content.append(body);
    row.append(content);
    return row;
  }

  function lines(values = []) {
    const wrap = create('div');
    for (const value of values.filter(Boolean)) wrap.append(create('div', 'ai-trace-line', value));
    return wrap;
  }

  function contextLines(state = {}, probe = {}, experiment = {}) {
    const subscriber = state?.toolState?.confirmedSubscriber || {};
    const result = [];
    if (experiment?.knowledgeMode === 'clean') {
      result.push('CLEAN MODEL: без SIMNET KB, tool manifest и live READ-tools.');
      if (probe.refersTo) result.push(`Связь с диалогом: ${probe.refersTo}`);
      return result;
    }
    if (subscriber.contract) result.push(`Договор: ${subscriber.contract}`);
    if (subscriber.login) result.push(`Login: ${subscriber.login}`);
    if (subscriber.address) result.push(`Адрес: ${subscriber.address}`);
    if (subscriber.connectionFamily) result.push(`Технология: ${subscriber.connectionFamily}`);
    if (!result.length && state?.toolState?.confirmedCaseId) result.push(`Активный абонент case: ${state.toolState.confirmedCaseId}`);
    if (probe.refersTo) result.push(`Связь с контекстом: ${probe.refersTo}`);
    return result;
  }

  function needsLines(variant = {}) {
    return asArray(variant?.subscriberDataNeeded).map(item => {
      if (typeof item === 'string') return item;
      const system = short(item?.system || '', 60);
      const field = short(item?.field || '', 140);
      const why = short(item?.why || '', 220);
      return `${system ? `${system} → ` : ''}${field || 'данные'}${why ? ` · ${why}` : ''}`;
    });
  }

  function planNode(toolTrace = []) {
    const wrap = create('div');
    const seen = new Set();
    for (const trace of toolTrace) {
      const requestedField = short(trace?.requestedBy?.field || '', 160);
      const why = short(trace?.requestedBy?.why || '', 220);
      const tool = String(trace?.tool || '—');
      const key = `${requestedField}|${why}|${tool}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = create('div', 'ai-trace-line');
      row.append(create('span', 'ai-trace-chip', requestedField || 'live-факт'));
      row.append(document.createTextNode(' → '));
      const toolChip = create('span', 'ai-trace-chip');
      toolChip.append(toolRef(tool, tool));
      row.append(toolChip);
      if (why) row.append(document.createTextNode(` · ${why}`));
      wrap.append(row);
      const mismatch = toolMismatch(trace);
      if (mismatch) wrap.append(create('div', 'ai-trace-mismatch', `НЕСООТВЕТСТВИЕ: запросил ${mismatch.expected}, но вызван ${mismatch.actual}`));
    }
    return wrap;
  }

  function toolsNode(toolTrace = []) {
    const wrap = create('div', 'ai-trace-tools');
    for (const trace of toolTrace) {
      const card = create('div', 'ai-trace-tool');
      const head = create('div', 'ai-trace-tool-head');
      const toolName = trace?.tool || '—';
      const toolStrong = create('strong');
      toolStrong.append(toolRef(toolName, toolName));
      head.append(toolStrong);
      head.append(create('span', `ai-trace-chip ${trace?.ok ? 'ok' : 'bad'}`, trace?.ok ? 'OK ✓' : `ERROR ${trace?.code || ''}`.trim()));
      if (trace?.source) head.append(create('span', 'ai-trace-chip', trace.source));
      card.append(head);
      if (trace?.requestedBy?.field) card.append(create('div', 'ai-trace-line', `Нужно: ${trace.requestedBy.field}`));
      if (trace?.requestedBy?.why) card.append(create('div', 'ai-trace-line muted', `Зачем: ${trace.requestedBy.why}`));
      const mismatch = toolMismatch(trace);
      if (mismatch) card.append(create('div', 'ai-trace-mismatch', `ОЖИДАЛСЯ ${mismatch.expected} → ФАКТИЧЕСКИ ${mismatch.actual}`));
      card.append(jsonBlock(trace));
      wrap.append(card);
    }
    return wrap;
  }

  function collectFacts(value, prefix = '', depth = 0, out = []) {
    if (depth > 4 || out.length >= 18 || value == null) return out;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 4); i += 1) collectFacts(value[i], `${prefix}[${i}]`, depth + 1, out);
      return out;
    }
    if (typeof value !== 'object') return out;
    for (const [key, child] of Object.entries(value)) {
      if (out.length >= 18) break;
      const path = prefix ? `${prefix}.${key}` : key;
      if (FACT_KEYS.has(key) && child != null && typeof child !== 'object' && String(child).trim() !== '') {
        out.push(`${key}: ${short(child, 140)}`);
      }
      if (child && typeof child === 'object') collectFacts(child, path, depth + 1, out);
    }
    return out;
  }

  function factsNode(toolTrace = []) {
    const wrap = create('div');
    let count = 0;
    for (const trace of toolTrace.filter(item => item?.ok)) {
      const facts = [...new Set(collectFacts(trace?.data || {}))].slice(0, 10);
      if (!facts.length) continue;
      count += facts.length;
      const title = create('div', 'ai-trace-line');
      title.append(create('b', '', `${trace.tool}: `), document.createTextNode(facts.join(' · ')));
      wrap.append(title);
    }
    if (!count) wrap.append(create('div', 'ai-trace-line muted', 'Tool отработал, но компактные ключевые поля для сводки не выделены — смотри RAW JSON выше.'));
    return wrap;
  }

  function relevanceNode(variant = {}) {
    const relevance = variant?.answerRelevance || {};
    const gate = variant?.relevanceGate || null;
    const wrap = create('div', 'ai-trace-filter');
    if (relevance.request) {
      const request = create('div', 'ai-trace-line');
      request.append(create('b', '', 'Запрос: '), document.createTextNode(relevance.request));
      wrap.append(request);
    }

    const kept = Array.isArray(relevance.kept) ? relevance.kept : [];
    const dropped = Array.isArray(relevance.dropped) ? relevance.dropped : [];

    if (kept.length) {
      const group = create('div', 'ai-trace-filter-group keep');
      group.append(create('b', '', `ИСПОЛЬЗОВАНО (${kept.length})`));
      for (const item of kept) {
        const row = create('div', 'ai-trace-filter-item');
        row.append(create('span', 'ai-trace-chip ok', 'KEEP'), document.createTextNode(` ${short(item?.fact || '', 300)}`));
        if (item?.source) {
          const sourceChip = create('span', 'ai-trace-chip');
          const sourceTool = normalizedToolName(item.source);
          if (sourceTool) sourceChip.append(toolRef(sourceTool, item.source));
          else sourceChip.textContent = item.source;
          row.append(sourceChip);
        }
        if (item?.reason) row.append(create('span', 'ai-trace-filter-reason', `— ${short(item.reason, 320)}`));
        group.append(row);
      }
      wrap.append(group);
    }

    if (dropped.length) {
      const group = create('div', 'ai-trace-filter-group drop');
      group.append(create('b', '', `ОТБРОШЕНО (${dropped.length})`));
      for (const item of dropped) {
        const row = create('div', 'ai-trace-filter-item');
        row.append(create('span', 'ai-trace-chip bad', 'DROP'), document.createTextNode(` ${short(item?.fact || '', 300)}`));
        if (item?.source) {
          const sourceChip = create('span', 'ai-trace-chip');
          const sourceTool = normalizedToolName(item.source);
          if (sourceTool) sourceChip.append(toolRef(sourceTool, item.source));
          else sourceChip.textContent = item.source;
          row.append(sourceChip);
        }
        if (item?.reason) row.append(create('span', 'ai-trace-filter-reason', `— ${short(item.reason, 320)}`));
        group.append(row);
      }
      wrap.append(group);
    }

    if (!kept.length && !dropped.length) {
      const reason = gate?.reason || (gate?.degraded ? gate?.error : 'Модель не вернула детализацию kept/dropped.');
      wrap.append(create('div', 'ai-trace-line muted', `Детализация фильтра отсутствует${reason ? `: ${short(reason, 320)}` : '.'}`));
    }

    if (relevance.completeness) wrap.append(create('span', `ai-trace-chip ${relevance.completeness === 'complete' ? 'ok' : 'warn'}`, `Полнота: ${relevance.completeness}`));
    if (relevance.conclusion) wrap.append(create('div', 'ai-trace-line', `Вывод фильтра: ${relevance.conclusion}`));
    wrap.append(jsonBlock({ answerRelevance: relevance, gate }));
    return wrap;
  }

  function verifyNode(variant = {}, toolTrace = []) {
    const wrap = create('div');
    const warnings = [];
    for (const trace of toolTrace) {
      const mismatch = toolMismatch(trace);
      if (mismatch) warnings.push(`План/tool расходятся: нужно ${mismatch.expected}, вызван ${mismatch.actual}.`);
      if (!trace?.ok) warnings.push(`${trace?.tool || 'tool'} не дал подтверждённых данных: ${trace?.code || 'unknown'}.`);
    }
    warnings.push(...asArray(variant?.verificationNeeded).map(item => String(item)));
    warnings.push(...asArray(variant?.unresolvedRequests).map(item => `Не закрыто: ${item}`));
    if (!warnings.length) {
      wrap.append(create('span', 'ai-trace-chip ok', 'Данных достаточно для текущего ответа'));
      return wrap;
    }
    for (const warning of [...new Set(warnings)]) wrap.append(create('div', 'ai-trace-line', `• ${warning}`));
    return wrap;
  }

  function conclusionNode(variant = {}, toolTrace = []) {
    const wrap = create('div');
    const okTools = toolTrace.filter(item => item?.ok).length;
    const failedTools = toolTrace.length - okTools;
    const unresolved = asArray(variant?.unresolvedRequests).length + asArray(variant?.verificationNeeded).length;
    const relevanceConclusion = short(variant?.answerRelevance?.conclusion || '', 360);
    if (variant?.degraded) {
      wrap.append(create('span', 'ai-trace-chip bad', 'DEGRADED'));
      if (variant?.degradationReason) wrap.append(document.createTextNode(` ${short(variant.degradationReason, 360)}`));
    } else if (failedTools || unresolved) {
      wrap.append(create('span', 'ai-trace-chip warn', 'Частичный вывод'));
      wrap.append(document.createTextNode(` подтверждено tools: ${okTools}/${toolTrace.length}; остаются пробелы: ${unresolved + failedTools}`));
    } else {
      wrap.append(create('span', 'ai-trace-chip ok', toolTrace.length ? `Подтверждено tools: ${okTools}/${toolTrace.length}` : 'Live-проверки не требовались'));
    }
    if (relevanceConclusion) wrap.append(create('div', 'ai-trace-line', `По релевантности: ${relevanceConclusion}`));
    const next = short(variant?.nextStepOffered || '', 260);
    if (next) wrap.append(create('div', 'ai-trace-line', `Следующий шаг: ${next}`));
    return wrap;
  }

  function renderTrace(state = {}) {
    if (!eventsNode) return;
    ensureStyles();
    const latestExperiment = state?.lastExperiment;
    const modelLabel = document.getElementById('aiLabWorkspaceModel');
    if (modelLabel && latestExperiment?.model) modelLabel.textContent = String(latestExperiment.model).split('→').at(-1).trim();
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const customerIndex = messages.findIndex(message => message.id === latestExperiment?.customerMessageId);
    const answers = customerIndex >= 0 ? messages.slice(customerIndex + 1).filter(message => message.role === 'agent') : [];
    for (const answer of answers) {
      if (latestExperiment) inspectedTurns.set(answer.id, { lastExperiment: latestExperiment, toolState: state.toolState });
    }
    while (inspectedTurns.size > 20) inspectedTurns.delete(inspectedTurns.keys().next().value);
    const selected = selectedMessageId ? inspectedTurns.get(selectedMessageId) : null;
    if (selectedMessageId && !selected) {
      rendering = true; observer?.disconnect();
      document.getElementById(TRACE_ID)?.remove();
      const empty = create('section', 'ai-trace-root'); empty.id = TRACE_ID;
      empty.append(create('p', 'ai-workspace-history-empty', 'Подробная трасса этого ответа не сохранена в текущем сеансе. Выбери последний ответ или проведи новый ход.'));
      eventsNode.prepend(empty); observer?.observe(eventsNode, { childList: true, subtree: true }); rendering = false;
      return;
    }
    if (selected) state = { ...state, ...selected, historicalInspection: selected.lastExperiment.id !== latestExperiment?.id };
    const experiment = state?.lastExperiment;
    if (!experiment) return;

    const variant = activeVariant(experiment) || {};
    const probe = experiment?.analysis?.probe || {};
    const knowledge = experiment?.analysis?.knowledge || {};
    const legacyToolTrace = Array.isArray(variant?.toolTrace) ? variant.toolTrace : [];
    const canonicalSourceTrace = Array.isArray(variant?.factSourceTrace) ? variant.factSourceTrace : [];
    const toolTrace = [...legacyToolTrace, ...canonicalSourceTrace];
    inspectorState = state || {};
    inspectorToolTrace = toolTrace;
    if (!inspectorPinned) hideInspector(true);

    const root = create('section', 'ai-trace-root');
    root.id = TRACE_ID;
    const head = create('div', 'ai-trace-head');
    head.append(create('strong', '', 'DECISION TRACE · ПОСЛЕДНИЙ ХОД'));
    head.append(create('span', '', `${experiment?.knowledgeMode === 'clean' ? 'CLEAN · ' : ''}${Math.round(Number(probe?.confidence || 0) * 100)}% semantic · ${toolTrace.length} tool · ${Number(experiment?.elapsedMs || 0)} ms`));
    root.append(head);
    const decision = create('section', 'ai-workspace-decision');
    for (const [label, value] of [
      ['Понял', probe.latestMessageMeans || probe.whatUserWants || 'Понимание не записано'],
      ['Проверил', toolTrace.length ? toolTrace.map(item => item.tool).join(', ') : 'Вызовов инструментов не было']
    ]) {
      const row = create('div', 'ai-workspace-decision-row');
      row.append(create('strong', '', label), create('p', '', value)); decision.append(row);
    }
    const conclusion = create('div', 'ai-workspace-decision-row');
    conclusion.append(create('strong', '', 'Результат'), conclusionNode(variant, toolTrace)); decision.append(conclusion);
    root.append(decision);
    const runtimeMap = create('section', 'ai-runtime-map');
    runtimeMap.id = RUNTIME_MAP_ID;
    runtimeMap.append(create('div', 'ai-runtime-empty', 'Собираю runtime map…'));
    root.append(runtimeMap);
    void hydrateRuntimeMap(runtimeMap, state, experiment, variant, toolTrace);

    const list = create('div', 'ai-trace-list');
    let index = 1;

    const understood = lines([
      probe?.whatUserWants ? `Суть: ${probe.whatUserWants}` : '',
      probe?.latestMessageMeans ? `Последняя реплика: ${probe.latestMessageMeans}` : '',
      probe?.underlyingGoal ? `Общая цель: ${probe.underlyingGoal}` : ''
    ]);
    understood.append(jsonBlock({
      whatUserWants: probe?.whatUserWants || '',
      latestMessageMeans: probe?.latestMessageMeans || '',
      underlyingGoal: probe?.underlyingGoal || '',
      refersTo: probe?.refersTo || '',
      confidence: probe?.confidence || 0,
      semanticDiagnostics: experiment?.analysis?.semanticDiagnostics || {}
    }));
    list.append(step(index++, 'ПОНЯЛ', understood, 'intent'));

    const context = contextLines(state, probe, experiment);
    const kbArticles = asArray(knowledge?.usedArticles).map(item => typeof item === 'string' ? item : item?.id).filter(Boolean);
    if (kbArticles.length) context.push(`KB: ${kbArticles.join(', ')}`);
    if (context.length) list.append(step(index++, 'КОНТЕКСТ', lines(context), 'intent'));

    const needs = needsLines(variant);
    if (needs.length) list.append(step(index++, 'НУЖНО УЗНАТЬ', lines(needs), 'need'));

    if (toolTrace.length) {
      list.append(step(index++, 'ПЛАН', planNode(toolTrace), 'need'));
      list.append(step(index++, 'TOOL', toolsNode(toolTrace), 'tool'));
      list.append(step(index++, 'ФАКТЫ', factsNode(toolTrace), 'fact'));
    }

    if (variant?.answerRelevance || variant?.relevanceGate) {
      list.append(step(index++, 'ФИЛЬТР ОТВЕТА', relevanceNode(variant), 'relevance'));
    }

    list.append(step(index++, 'ПРОВЕРКА', verifyNode(variant, toolTrace), 'verify'));
    list.append(step(index++, 'ВЫВОД', conclusionNode(variant, toolTrace), 'verify'));

    const answer = create('div');
    answer.append(create('div', 'ai-trace-line', variant?.reply || state?.lastDecision?.reply || 'Ответ не сформирован.'));
    answer.append(jsonBlock({
      reply: variant?.reply || state?.lastDecision?.reply || '',
      clarificationQuestions: variant?.clarificationQuestions || [],
      nextStepOffered: variant?.nextStepOffered || '',
      degraded: Boolean(variant?.degraded),
      degradationReason: variant?.degradationReason || '',
      answerRelevance: variant?.answerRelevance || null
    }));
    list.append(step(index++, 'ОТВЕТ', answer, 'answer'));

    const advanced = create('details', 'ai-workspace-advanced');
    advanced.append(create('summary', '', 'Полная трасса и JSON'), list);
    root.append(advanced, create('div', 'ai-trace-history-label', 'Сырой журнал событий ниже'));

    rendering = true;
    observer?.disconnect();
    document.getElementById(TRACE_ID)?.remove();
    eventsNode.prepend(root);
    observer?.observe(eventsNode, { childList: true, subtree: true });
    rendering = false;
  }

  async function getState() {
    const response = await chrome.runtime.sendMessage({ type: 'AI_OPERATOR_LAB_GET' });
    if (!response?.success) throw new Error(response?.error || 'AI Lab state unavailable');
    return response.data || {};
  }

  function schedule() {
    if (rendering) return;
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try { renderTrace(await getState()); }
      catch (error) { console.warn('[AI Lab trace] render failed', error); }
    }, 40);
  }

  function boot() {
    eventsNode = document.getElementById('aiLabEvents');
    if (!eventsNode) return;
    ensureStyles();
    observer = new MutationObserver(() => schedule());
    observer.observe(eventsNode, { childList: true, subtree: true });
    document.addEventListener('ai-lab-inspect-answer', event => {
      selectedMessageId = String(event.detail?.messageId || '');
      schedule();
    });
    document.getElementById('aiLabSend')?.addEventListener('click', () => { selectedMessageId = ''; });
    document.getElementById('aiLabReset')?.addEventListener('click', () => { selectedMessageId = ''; inspectedTurns.clear(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideInspector(true);
    });
    window.addEventListener('resize', () => {
      if (!inspectorNode?.hidden && inspectorAnchor) positionInspector(inspectorAnchor);
    });
    window.addEventListener('scroll', () => {
      if (!inspectorNode?.hidden && inspectorAnchor) positionInspector(inspectorAnchor);
    }, true);
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
