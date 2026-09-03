"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_LIVE_STATE__) return;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function waitForGlobal(key, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (globalThis[key]) return globalThis[key];
      await sleep(25);
    }
    throw new Error(`Dependency ${key} was not initialized`);
  }

  const compat = await waitForGlobal("__SIMNET_EXTENSION_COMPAT__");
  await compat.ready;
  const { GM_getValue, GM_setValue, GM_addStyle } = compat.api;
  const store = await waitForGlobal("__SIMNET_OPERATOR_CONTEXT_STORE__");
  await store.ready;

  const SCENARIO_KEY = "dp_operator_scenario_v4";
  const STEP_KEY = "dp_operator_connectivity_step_v4";
  const runtime = {
    scenario: GM_getValue(SCENARIO_KEY, "finance") === "no-internet" ? "no-internet" : "finance",
    stepIndex: Math.max(0, Number(GM_getValue(STEP_KEY, 0)) || 0),
    workspace: null,
    section: null,
    model: null,
    unsubscribe: null,
    explanationOpen: false,
    activeMark: null,
    captureFingerprint: ""
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const action = () => store.currentAction();
  const currentMode = () => globalThis.__SIMNET_OPERATION_MODE__?.get?.()
    || document.querySelector("#dp-panel")?.dataset.operationMode
    || "diagnostic";

  function normalizeMac(value) {
    const hex = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    return hex.length === 12 ? hex : "";
  }

  function formatMac(value) {
    const hex = normalizeMac(value);
    return hex ? hex.match(/.{2}/g).join(":") : "";
  }

  function pageText() {
    const chunks = [];
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("#dp-panel,script,style,noscript")) continue;
      const value = text(node.nodeValue);
      if (value) chunks.push(value);
    }
    for (const textarea of document.querySelectorAll("textarea")) {
      if (!textarea.closest("#dp-panel") && text(textarea.value)) chunks.push(textarea.value);
    }
    return chunks.join("\n");
  }

  function rows() {
    const result = [];
    for (const row of document.querySelectorAll("tr")) {
      if (row.closest("#dp-panel")) continue;
      const cells = [...row.querySelectorAll(":scope > td,:scope > th")];
      if (cells.length < 2) continue;
      result.push({
        row,
        label: text(cells[0]?.innerText || cells[0]?.textContent),
        value: text(cells.at(-1)?.innerText || cells.at(-1)?.textContent)
      });
    }
    return result;
  }

  function findRow(patterns) {
    const regexes = patterns.map((item) => item instanceof RegExp ? item : new RegExp(item, "i"));
    return rows().find((item) => regexes.some((regex) => regex.test(item.label))) || null;
  }

  function activateIdentity(overrides = {}) {
    const identity = store.resolveIdentity(overrides);
    store.activate(identity);
    return identity;
  }

  function captureAccess() {
    const finance = globalThis.__SIMNET_OPERATOR_FINANCE__;
    if (!finance?.read) return false;
    let model;
    try { model = finance.read(); } catch (_) { return false; }
    const entities = model?.entities || {};
    const access = text(entities.access?.value);
    const serviceState = text(entities.serviceState?.value);
    if ((!access || /не найден/i.test(access)) && (!serviceState || /не найден/i.test(serviceState))) return false;
    store.writeSource("access", {
      subscriber: text(model.subscriber),
      access,
      serviceState,
      startDay: text(entities.startDay?.value),
      warning: text(entities.disconnectWarning?.value),
      accessDenied: Boolean(model.evidence?.accessDenied),
      accessAllowed: Boolean(model.evidence?.accessAllowed)
    }, {
      action: action(),
      parser: "operator-finance",
      confidence: "high",
      identity: activateIdentity()
    });
    return true;
  }

  function captureEquipment() {
    const values = {};
    const evidence = [];
    const controls = [...document.querySelectorAll("input,select,textarea")]
      .filter((node) => !node.closest("#dp-panel"));

    for (const control of controls) {
      const value = text(control.tagName === "SELECT"
        ? control.selectedOptions?.[0]?.textContent || control.value
        : control.value);
      if (!value) continue;
      const name = text(control.name || control.id);
      const rowValue = text(control.closest("tr")?.innerText || control.closest("tr")?.textContent);
      const combined = `${name} ${rowValue}`;
      if (/mac/i.test(combined) && /роутер|router|маршрутизатор/i.test(combined)) values.routerMac = formatMac(value) || value;
      if (/mac/i.test(combined) && /onu|ont/i.test(combined)) values.onuMac = formatMac(value) || value;
      if (/sn|serial/i.test(combined) && /onu|ont/i.test(combined)) values.onuSerial = value;
      if (/\bolt\b/i.test(combined)) values.olt = value;
      if (/(?:onu|ont|olt|gpon|epon|gcom|fttb|коммутатор|switch)/i.test(combined)) evidence.push(`${combined} ${value}`);
    }

    for (const item of rows()) {
      const combined = `${item.label} ${item.value}`;
      if (!values.routerMac && /mac/i.test(item.label) && /роутер|router|маршрутизатор/i.test(item.label)) values.routerMac = formatMac(item.value) || item.value;
      if (!values.onuMac && /mac/i.test(item.label) && /onu|ont/i.test(item.label)) values.onuMac = formatMac(item.value) || item.value;
      if (!values.onuSerial && /sn|serial/i.test(item.label) && /onu|ont/i.test(item.label)) values.onuSerial = item.value;
      if (!values.olt && /\bolt\b/i.test(item.label) && item.value) values.olt = item.value;
      if (item.value && /(?:onu|ont|olt|gpon|epon|gcom|fttb|коммутатор|switch)/i.test(combined)) evidence.push(combined);
    }

    const identity = activateIdentity();
    if (Object.values(values).some(Boolean)) {
      store.writeSource("equipment", values, {
        action: action(),
        parser: "billing-technical-data",
        confidence: "medium",
        identity
      });
    }

    const joined = evidence.join(" ");
    const explicitPon = Boolean(values.onuMac || values.onuSerial || values.olt)
      && /(?:onu|ont|olt|gpon|epon|gcom|huawei)/i.test(joined);
    const explicitEthernet = /(?:fttb|коммутатор|switch|порт подключения)/i.test(joined);
    if (explicitPon) {
      const adapter = /huawei/i.test(joined) ? "huawei"
        : /gcom/i.test(joined) ? "gcom"
          : /gpon/i.test(joined) ? "bdcom-gpon"
            : /epon/i.test(joined) ? "bdcom-epon" : "";
      store.writeTechnology({
        id: "pon",
        adapter,
        label: adapter === "huawei" ? "Huawei GPON"
          : adapter === "gcom" ? "GCOM"
            : adapter === "bdcom-gpon" ? "BDCOM GPON"
              : adapter === "bdcom-epon" ? "BDCOM EPON" : "PON / оптика",
        confidence: "high"
      }, { source: "billing-technical-data", identity });
      return true;
    }
    if (explicitEthernet) {
      store.writeTechnology({ id: "ethernet", adapter: "", label: "Ethernet / FTTB", confidence: "medium" }, {
        source: "billing-technical-data",
        identity
      });
      return true;
    }
    return Object.values(values).some(Boolean);
  }

  function parseJuniper2() {
    if (action() !== "252") return null;
    const full = pageText();
    if (full.length < 20) return null;
    const noSession = /(?:нет|не найден[ао]?|відсутн|отсутствует)\s+(?:активн(?:ой|ої)?\s+)?(?:сесси|сесі)|no\s+active\s+session|session\s+not\s+found|0\s+sessions?/i.test(full);
    const loginRow = findRow([/логин/i, /login/i, /account/i]);
    const ipRow = findRow([/^ip$/i, /ip[-\s]?адрес/i, /address/i]);
    const macRow = findRow([/^mac$/i, /mac[-\s]?адрес/i]);
    const durationRow = findRow([/длительност/i, /duration/i, /uptime/i, /время сессии/i]);
    const startRow = findRow([/начал[оа]\s+сесс/i, /session\s+start/i, /время входа/i]);
    const login = text(loginRow?.value).match(/\babon\d+\b/i)?.[0] || full.match(/\babon\d+\b/i)?.[0] || "";
    const ip = text(ipRow?.value).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || full.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || "";
    const macMatch = text(macRow?.value).match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i)
      || full.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i);
    const active = /(?:сесси|сесі|session)[^\n]{0,60}(?:active|активн|online|up)|(?:active|активн|online)[^\n]{0,60}(?:сесси|сесі|session)/i.test(full)
      || Boolean(login && ip);
    const state = noSession ? "none" : active ? "active" : "unknown";
    return {
      state,
      label: state === "active" ? "Сессия активна" : state === "none" ? "Активной сессии нет" : "Ответ Juniper 2 получен",
      login,
      ip,
      mac: formatMac(macMatch?.[0]),
      duration: text(durationRow?.value),
      startedAt: text(startRow?.value)
    };
  }

  function captureJuniper2() {
    const parsed = parseJuniper2();
    if (!parsed) return false;
    const identity = activateIdentity({ login: parsed.login });
    store.mergeIdentity({ login: parsed.login || identity.login });
    store.writeSource("session", parsed, {
      action: "252",
      parser: "juniper2-only",
      confidence: parsed.state === "unknown" ? "low" : "high",
      identity: store.resolveIdentity({ ...identity, login: parsed.login || identity.login })
    });
    return true;
  }

  function rawPollText() {
    const candidates = [];
    for (const node of document.querySelectorAll("pre,textarea,code,td,div")) {
      if (node.closest("#dp-panel")) continue;
      const value = node.tagName === "TEXTAREA" ? node.value : node.innerText || node.textContent;
      if (String(value || "").length < 120) continue;
      if (/pon_port_by_onu|display\s+(?:ont|onu)|ONU\s+.+\s+is\s+-|optical\s+power|learned[-\s]?mac/i.test(value)) {
        candidates.push(String(value));
      }
    }
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  async function capturePon() {
    if (!/^(310|311|312|313)$/.test(action())) return false;
    let analyzer;
    try { analyzer = await waitForGlobal("__SIMNET_ONU_ANALYSIS__", 20000); } catch (_) { return false; }
    if (!analyzer?.analyzeOnuPollResult) return false;
    const raw = rawPollText();
    if (raw.length < 120) return false;
    const identity = activateIdentity();
    const context = store.current();
    const equipment = context.sources?.equipment?.data || {};
    let analysis;
    try {
      analysis = analyzer.analyzeOnuPollResult(raw, {
        action: action(),
        expectedRouterMac: normalizeMac(equipment.routerMac),
        expectedOnuMac: normalizeMac(equipment.onuMac),
        expectedOnuSerial: text(equipment.onuSerial)
      });
    } catch (_) { return false; }
    const facts = analysis?.facts || {};
    const report = analysis?.report || {};
    const macs = Array.isArray(facts.macTable?.subscriberMacs)
      ? facts.macTable.subscriberMacs.map(formatMac).filter(Boolean) : [];
    const payload = {
      adapter: text(analysis?.adapter),
      status: text(facts.status || "unknown"),
      ethernet: {
        link: text(facts.ethernet?.link || "unknown"),
        speedMbps: facts.ethernet?.speedMbps ?? null,
        duplex: text(facts.ethernet?.duplex || "unknown")
      },
      macs,
      macTableSeen: Boolean(facts.macTable?.seen),
      uptime: { text: text(facts.uptime?.text), seconds: Number(facts.uptime?.seconds || 0) },
      optics: {
        onuRxDbm: facts.optics?.onuRxDbm ?? null,
        oltRxDbm: facts.optics?.oltRxDbm ?? null,
        onuTxDbm: facts.optics?.onuTxDbm ?? null
      },
      serial: text(facts.serial),
      distanceMeters: facts.distanceMeters ?? null,
      history: facts.history || {},
      report: {
        severity: text(report.severity || "unknown"),
        summary: text(report.summary),
        conclusion: text(report.conclusion),
        deviations: Array.isArray(report.deviations) ? report.deviations.map(text) : [],
        routerMacPresent: Boolean(report.routerMacPresent),
        routerMacMatched: Boolean(report.routerMacMatched),
        routerMacMismatch: Boolean(report.routerMacMismatch),
        strongCurrentChain: Boolean(report.strongCurrentChain)
      }
    };
    store.writeSource("pon", payload, {
      action: action(),
      parser: `onu-analysis:${payload.adapter || "unknown"}`,
      confidence: payload.status === "unknown" ? "medium" : "high",
      identity
    });
    const adapterInfo = {
      "310": ["bdcom-epon", "BDCOM EPON"],
      "311": ["bdcom-gpon", "BDCOM GPON"],
      "312": ["gcom", "GCOM"],
      "313": ["huawei", "Huawei GPON"]
    }[action()];
    store.writeTechnology({
      id: "pon",
      adapter: adapterInfo?.[0] || payload.adapter,
      label: adapterInfo?.[1] || "PON / оптика",
      confidence: "high"
    }, { source: `live-poll:${action()}`, identity });
    return true;
  }

  async function captureNow() {
    activateIdentity();
    const result = {
      access: captureAccess(),
      equipment: captureEquipment(),
      session: false,
      pon: false
    };
    if (action() === "252") result.session = captureJuniper2();
    if (/^(310|311|312|313)$/.test(action())) result.pon = await capturePon();
    document.dispatchEvent(new CustomEvent("dp:operator-live-captured", { detail: result }));
    return result;
  }

  function installBoundedCaptureObserver() {
    if (!/^(252|310|311|312|313)$/.test(action())) return;
    const startedAt = Date.now();
    let debounce = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(async () => {
        const value = action() === "252" ? pageText() : rawPollText();
        const fingerprint = `${value.length}:${value.slice(-240)}`;
        if (fingerprint && fingerprint !== runtime.captureFingerprint) {
          runtime.captureFingerprint = fingerprint;
          await captureNow();
        }
        if (Date.now() - startedAt > 30000) observer.disconnect();
      }, 180);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), 31000);
  }

  function sourceMeta(id) {
    return store.sourceState(id);
  }

  function statusFromSeverity(value) {
    const severity = text(value).toLowerCase();
    if (["error", "conflict"].includes(severity)) return "error";
    if (["warn", "warning"].includes(severity)) return "warning";
    if (severity === "ok") return "ok";
    return "unknown";
  }

  function entity(key, label, value, status, sourceId) {
    const meta = sourceMeta(sourceId);
    return {
      key,
      label,
      value: text(value) || "Не получено",
      status: status || "unknown",
      sourceId,
      sourceLabel: meta.label,
      sourceAction: text(meta.snapshot?.action),
      available: Boolean(meta.snapshot)
    };
  }

  function buildModel() {
    const context = store.current();
    const accessSource = context.sources?.access;
    const access = accessSource?.data || {};
    const sessionSource = context.sources?.session;
    const session = sessionSource?.action === "252" && sessionSource?.parser === "juniper2-only" ? sessionSource.data || {} : {};
    const ponSource = context.sources?.pon;
    const pon = ponSource?.data || {};
    const equipment = context.sources?.equipment?.data || {};
    const technology = context.technology || { id: "unknown", label: "Не определена" };
    const technologyId = ["pon", "ethernet"].includes(technology.id) ? technology.id : "unknown";
    const route = globalThis.__SIMNET_OPERATOR_ROUTES__?.buildNoInternet?.(technologyId);

    const accessDenied = Boolean(access.accessDenied) || /запрещ|заборон|off/i.test(text(access.access));
    const accessAllowed = Boolean(access.accessAllowed) || /разреш|дозвол|on/i.test(text(access.access));
    const accessStatus = accessDenied ? "error" : text(access.warning) && !/не найден/i.test(access.warning) ? "warning"
      : accessAllowed && /все\s*ок/i.test(text(access.serviceState)) ? "ok" : "unknown";
    const sessionState = text(session.state || "missing");
    const sessionStatus = sessionState === "active" ? "ok" : sessionState === "none" ? "warning" : "unknown";
    const ponStatus = text(pon.status) === "offline" ? "error" : statusFromSeverity(pon.report?.severity);
    const portText = pon.ethernet?.link && pon.ethernet.link !== "unknown"
      ? [String(pon.ethernet.link).toUpperCase(), pon.ethernet.speedMbps ? `${pon.ethernet.speedMbps} Мбит/с` : "", pon.ethernet.duplex && pon.ethernet.duplex !== "unknown" ? pon.ethernet.duplex : ""].filter(Boolean).join(" · ")
      : "Не получено";
    const opticsText = [
      Number.isFinite(pon.optics?.onuRxDbm) ? `ONU Rx ${Number(pon.optics.onuRxDbm).toFixed(2)} dBm` : "",
      Number.isFinite(pon.optics?.oltRxDbm) ? `OLT Rx ${Number(pon.optics.oltRxDbm).toFixed(2)} dBm` : ""
    ].filter(Boolean).join(" · ");
    const macText = Array.isArray(pon.macs) && pon.macs.length ? pon.macs.join(", ") : "Не изучен";

    let hypothesis = { status: "unknown", title: "Недостаточно данных", message: "Проверь Juniper 2 и технологический источник." };
    if (accessDenied) hypothesis = { status: "error", title: "Доступ ограничен в Billing", message: "Сначала устрани административную или финансовую причину." };
    else if (!sessionSource) hypothesis = { status: "warning", title: "Juniper 2 не проверен", message: "Сессия берётся только со страницы Juniper (NEW), action 252." };
    else if (technologyId === "unknown") hypothesis = { status: "warning", title: "Технология не подтверждена", message: "Открой техданные; ONU-ветка без подтверждения не запускается." };
    else if (technologyId === "pon" && !ponSource) hypothesis = { status: "warning", title: "PON подтверждён, ONU не опрошена", message: "Сессия сохранена; для линии нужен результат конкретной OLT." };
    else if (technologyId === "pon" && text(pon.status) === "offline") hypothesis = { status: "error", title: "ONU offline", message: text(pon.report?.conclusion) || "Проверяй оптику, питание ONU и PON-порт." };
    else if (technologyId === "pon" && pon.ethernet?.link === "down") hypothesis = { status: "error", title: "ONU online, Ethernet-порт down", message: "Проверяй кабель ONU–роутер, питание и WAN-порт." };
    else if (technologyId === "pon" && pon.report?.routerMacMismatch) hypothesis = { status: "error", title: "За ONU светится другой MAC", message: text(pon.report?.summary) || "Изученный MAC не совпадает с техданными." };
    else if (technologyId === "pon" && sessionState === "active" && pon.report?.strongCurrentChain) hypothesis = { status: "ok", title: "Сеть подтверждена до роутера", message: "Juniper 2 видит сессию, ONU online, Ethernet up и MAC совпадает." };
    else if (technologyId === "pon" && ponSource) hypothesis = { status: ponStatus, title: text(pon.report?.summary) || "Результат ONU получен", message: text(pon.report?.conclusion) || "Сопоставь сессию, порт и MAC." };
    else if (technologyId === "ethernet") hypothesis = { status: sessionStatus, title: sessionState === "active" ? "Сессия активна" : "Сессия не активна", message: "Следующий источник — порт доступа и MAC на коммутаторе." };

    const entities = {
      accessSummary: entity("accessSummary", "Доступ и состояние", [access.serviceState, access.access].map(text).filter(Boolean).join(" · ") || "Не проверено", accessStatus, "access"),
      serviceState: entity("serviceState", "Состояние услуги", access.serviceState, /все\s*ок/i.test(text(access.serviceState)) ? "ok" : access.serviceState ? "warning" : "unknown", "access"),
      access: entity("access", "Доступ", access.access, accessDenied ? "error" : accessAllowed ? "ok" : "unknown", "access"),
      disconnectWarning: entity("disconnectWarning", "Предупреждение Billing", access.warning || "Нет сохранённого предупреждения", text(access.warning) && !/не найден/i.test(access.warning) ? "warning" : "ok", "access"),
      sessionState: entity("sessionState", "Сессия Juniper 2", session.label || "Не проверено в Juniper 2", sessionStatus, "session"),
      sessionLogin: entity("sessionLogin", "Логин", session.login, session.login ? "info" : "unknown", "session"),
      sessionIp: entity("sessionIp", "IP", session.ip, session.ip ? "info" : "unknown", "session"),
      lastAuthorization: entity("lastAuthorization", "Начало / длительность", session.startedAt || session.duration, session.startedAt || session.duration ? "info" : "unknown", "session"),
      technology: entity("technology", "Технология подключения", technology.label || "Не определена", technologyId === "unknown" ? "warning" : "ok", "equipment"),
      lineState: entity("lineState", technologyId === "pon" ? "ONU и линия" : "Порт доступа", technologyId === "pon" ? ponSource ? text(pon.status) === "online" ? "ONU online" : text(pon.status) === "offline" ? "ONU offline" : "Ответ OLT получен" : "ONU не опрошена" : "Порт не проверен", technologyId === "pon" ? ponStatus : "unknown", technologyId === "pon" ? "pon" : "equipment"),
      optics: entity("optics", "Оптические уровни", opticsText, opticsText ? "info" : "unknown", "pon"),
      clientPort: entity("clientPort", technologyId === "pon" ? "Ethernet-порт ONU" : "Физический порт", technologyId === "pon" ? portText : "Не проверен", pon.ethernet?.link === "up" ? "ok" : pon.ethernet?.link === "down" ? "error" : "unknown", technologyId === "pon" ? "pon" : "equipment"),
      uptime: entity("uptime", "Общее время работы", pon.uptime?.text, pon.uptime?.text ? "info" : "unknown", "pon"),
      learnedMac: entity("learnedMac", "MAC оборудования за ONU", macText, pon.report?.routerMacMismatch ? "error" : pon.report?.routerMacMatched ? "ok" : pon.report?.routerMacPresent ? "warning" : "unknown", "pon"),
      routerMac: entity("routerMac", "MAC из технических данных", equipment.routerMac, equipment.routerMac ? "info" : "unknown", "equipment"),
      vlan: entity("vlan", "VLAN", equipment.vlan, equipment.vlan ? "info" : "unknown", "equipment"),
      historySummary: entity("historySummary", "Короткая история", Array.isArray(pon.report?.deviations) && pon.report.deviations.length ? pon.report.deviations.slice(0, 2).join(" · ") : ponSource ? "Свежих тревог не выделено" : "Не проверено", ponSource ? pon.report?.deviations?.length ? "warning" : "info" : "unknown", "pon")
    };

    return {
      identity: context.identity,
      subscriber: context.identity.login || (context.identity.billingId ? `Billing ID ${context.identity.billingId}` : "текущий абонент"),
      technology: { ...technology, id: technologyId },
      route,
      entities,
      hypothesis,
      context
    };
  }

  function clearHighlight() {
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("operator-live-clear");
    if (runtime.activeMark?.isConnected) {
      const parent = runtime.activeMark.parentNode;
      runtime.activeMark.replaceWith(document.createTextNode(runtime.activeMark.textContent || ""));
      parent?.normalize?.();
    }
    runtime.activeMark = null;
  }

  function patternsFor(key) {
    const model = runtime.model || buildModel();
    const session = model.context.sources?.session?.data || {};
    const pon = model.context.sources?.pon?.data || {};
    const equipment = model.context.sources?.equipment?.data || {};
    return ({
      accessSummary: [/Состояние/i, /Доступ/i],
      serviceState: [/Состояние/i],
      access: [/Доступ/i],
      disconnectWarning: [/баланс ниже границы отключения/i, /произойдет его отключение/i],
      sessionState: [session.login, session.ip, /(?:session|сесси|сесі).*(?:active|актив|none|нет|відсут)/i],
      sessionLogin: [session.login, /логин|login/i],
      sessionIp: [session.ip, /ip[-\s]?адрес|^ip$/i],
      lastAuthorization: [session.startedAt, session.duration, /duration|длительност|начал.*сесс/i],
      technology: [equipment.olt, equipment.onuSerial, equipment.onuMac, /технические данные/i],
      lineState: [/ONU\s+.+\s+is\s+-\s+(?:online|offline)/i, /Run state\s*:\s*(?:online|offline)/i, /OAM operational status/i],
      optics: [/Rx optical power/i, /OLT Rx ONT optical power/i, /RxPower/i],
      clientPort: [/LinkState/i, /display ont port state/i, /Ethernet.*(?:up|down)/i],
      uptime: [/ONT online duration/i, /Statistic duration/i, /online duration/i, /uptime/i],
      learnedMac: [...(pon.macs || []), /learned[-\s]?mac/i, /MAC-ADDRESS/i],
      routerMac: [equipment.routerMac, /MAC.*(?:роутер|router|маршрутизатор)/i],
      historySummary: [/Last down cause/i, /Last down time/i, /последн.*(?:LOS|отключ)/i]
    }[key] || []).filter(Boolean);
  }

  function findSource(patterns) {
    const regexes = patterns.map((value) => value instanceof RegExp ? value : new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    for (const textarea of document.querySelectorAll("textarea")) {
      if (textarea.closest("#dp-panel")) continue;
      for (const regex of regexes) {
        const match = textarea.value.match(regex);
        if (!match || match.index === undefined) continue;
        textarea.focus();
        textarea.setSelectionRange(match.index, match.index + match[0].length);
        textarea.scrollIntoView({ behavior: "smooth", block: "center" });
        return textarea;
      }
    }
    let best = null;
    let bestLength = Infinity;
    for (const element of document.querySelectorAll("tr,td,th,pre,code,div,p,span,b,strong")) {
      if (element.closest("#dp-panel")) continue;
      const value = text(element.innerText || element.textContent);
      if (!value || value.length > 1800) continue;
      if (!regexes.some((regex) => regex.test(value))) continue;
      const target = element.closest("tr") || element;
      if (value.length < bestLength) { best = target; bestLength = value.length; }
    }
    if (best) return best;

    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("#dp-panel,script,style,noscript")) continue;
      for (const regex of regexes) {
        const match = String(node.nodeValue || "").match(regex);
        if (!match || match.index === undefined) continue;
        clearHighlight();
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const mark = document.createElement("mark");
        mark.className = "dp-live-source-mark";
        try { range.surroundContents(mark); } catch (_) { return parent; }
        runtime.activeMark = mark;
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
        return mark;
      }
    }
    return null;
  }

  function currentPp() {
    try { return new URL(location.href).searchParams.get("pp") || document.querySelector('input[name="pp"]')?.value || ""; } catch (_) { return ""; }
  }

  function providerBase() {
    const provider = (runtime.model || buildModel()).identity?.provider;
    return globalThis.__SIMNET_BILLING_PROVIDER__?.profileForProvider?.(provider)?.base || location.origin;
  }

  function buildActionUrl(actionValue) {
    const model = runtime.model || buildModel();
    const url = new URL("/cgi-bin/adm/stat.pl", providerBase());
    const pp = currentPp();
    if (pp) url.searchParams.set("pp", pp);
    if (model.identity?.billingId) url.searchParams.set("id", model.identity.billingId);
    const uu = new URL(location.href).searchParams.get("uu");
    if (uu) url.searchParams.set("uu", uu);
    url.searchParams.set("a", String(actionValue));
    return url;
  }

  function actionForStep(stepId) {
    const model = runtime.model || buildModel();
    if (stepId === "session") return "252";
    if (stepId === "pon-line") return text(model.context.sources?.pon?.action)
      || ({ "bdcom-epon": "310", "bdcom-gpon": "311", gcom: "312", huawei: "313" }[model.technology.adapter] || "");
    return "";
  }

  function navigateTo(actionValue, entityKey = "") {
    if (!actionValue) return false;
    try {
      sessionStorage.setItem("dp_operator_live_pending_focus_v1", JSON.stringify({
        entityKey,
        action: String(actionValue),
        identityKey: (runtime.model || buildModel()).identity?.key || "",
        expiresAt: Date.now() + 45000
      }));
    } catch (_) {}
    location.assign(buildActionUrl(actionValue).toString());
    return true;
  }

  function focusEntity(key, navigate = true) {
    const model = runtime.model || buildModel();
    const entityValue = model.entities[key];
    if (!entityValue) return false;
    const sourceAction = entityValue.sourceAction;
    if (navigate && sourceAction && sourceAction !== action()) return navigateTo(sourceAction, key);
    const target = findSource(patternsFor(key));
    if (!target) return false;
    if (!(target instanceof HTMLTextAreaElement) && !target.matches?.("mark.dp-live-source-mark")) {
      clearHighlight();
      globalThis.__SIMNET_PAGE_FOCUS__?.show?.(target, {
        label: `${entityValue.label} · ${entityValue.value}`,
        tone: entityValue.status === "error" ? "error" : entityValue.status === "warning" ? "warning" : entityValue.status === "ok" ? "ok" : "info",
        scroll: true
      });
    }
    return true;
  }

  function consumePendingFocus() {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem("dp_operator_live_pending_focus_v1") || "null"); } catch (_) { return; }
    if (!pending || Number(pending.expiresAt || 0) < Date.now()) return;
    if (pending.action && pending.action !== action()) return;
    try { sessionStorage.removeItem("dp_operator_live_pending_focus_v1"); } catch (_) {}
    window.setTimeout(() => focusEntity(pending.entityKey, false), 250);
  }

  function ensureUi() {
    const panel = document.querySelector("#dp-panel");
    const workspace = panel?.querySelector("#dp-operator-workspace");
    if (!panel || !workspace) return false;
    runtime.workspace = workspace;
    workspace.querySelector("#dp-operator-scenarios-v2")?.remove();
    workspace.querySelector("#dp-connectivity-workspace-v2")?.remove();

    let controls = workspace.querySelector("#dp-operator-scenarios-live");
    if (!controls) {
      controls = document.createElement("nav");
      controls.id = "dp-operator-scenarios-live";
      controls.innerHTML = `<button type="button" data-live-scenario="finance">Финансы</button><button type="button" data-live-scenario="no-internet">Нет интернета</button>`;
      workspace.querySelector(":scope > .dp-operator-header")?.insertAdjacentElement("afterend", controls);
      controls.addEventListener("click", (event) => {
        const button = event.target.closest("[data-live-scenario]");
        if (!button) return;
        runtime.scenario = button.dataset.liveScenario === "no-internet" ? "no-internet" : "finance";
        GM_setValue(SCENARIO_KEY, runtime.scenario);
        applyScenario();
      });
    }

    let section = workspace.querySelector("#dp-connectivity-live");
    if (!section) {
      section = document.createElement("section");
      section.id = "dp-connectivity-live";
      section.hidden = true;
      section.innerHTML = `
        <div class="dp-live-summary">
          <header><div><b>Нет интернета</b><span id="dp-live-context"></span></div><button type="button" id="dp-live-refresh">↻</button></header>
          <div id="dp-live-axes"></div><article id="dp-live-hypothesis"></article>
        </div>
        <section class="dp-live-route"><header><b>Маршрут локализации</b><span>Состояние сохраняется между разделами</span></header><div id="dp-live-steps"></div></section>
        <section class="dp-live-card"><header><div><span>Текущий источник</span><b id="dp-live-step-title"></b></div><em id="dp-live-step-number"></em></header><p id="dp-live-step-short"></p><div id="dp-live-entities"></div><aside id="dp-live-why" hidden></aside><footer><button class="primary" id="dp-live-show">Показать источник</button><button id="dp-live-open">Открыть раздел</button><button id="dp-live-explain">Что означает</button></footer></section>
        <section class="dp-live-next"><div><b id="dp-live-next-title"></b><span id="dp-live-next-short"></span></div><button id="dp-live-next-button">Дальше</button></section>`;
      workspace.appendChild(section);
      section.querySelector("#dp-live-refresh").addEventListener("click", async () => { await captureNow(); render(); });
      section.querySelector("#dp-live-steps").addEventListener("click", (event) => {
        const button = event.target.closest("[data-live-step]");
        if (!button) return;
        runtime.stepIndex = Number(button.dataset.liveStep) || 0;
        GM_setValue(STEP_KEY, runtime.stepIndex);
        render();
      });
      section.querySelector("#dp-live-axes").addEventListener("click", (event) => {
        const button = event.target.closest("[data-live-axis]");
        if (!button) return;
        const index = runtime.model?.route?.steps?.findIndex((step) => step.id === button.dataset.liveAxis) ?? -1;
        if (index >= 0) { runtime.stepIndex = index; render(); }
      });
      section.querySelector("#dp-live-entities").addEventListener("click", (event) => {
        const button = event.target.closest("[data-live-entity]");
        if (button) focusEntity(button.dataset.liveEntity, true);
      });
      section.querySelector("#dp-live-show").addEventListener("click", () => {
        const step = runtime.model?.route?.steps?.[runtime.stepIndex];
        if (step && !focusEntity(step.focusKey, true)) openStep(step.id);
      });
      section.querySelector("#dp-live-open").addEventListener("click", () => {
        const step = runtime.model?.route?.steps?.[runtime.stepIndex];
        if (step) openStep(step.id);
      });
      section.querySelector("#dp-live-explain").addEventListener("click", () => { runtime.explanationOpen = !runtime.explanationOpen; render(); });
      section.querySelector("#dp-live-next-button").addEventListener("click", () => {
        const count = runtime.model?.route?.steps?.length || 1;
        runtime.stepIndex = (runtime.stepIndex + 1) % count;
        GM_setValue(STEP_KEY, runtime.stepIndex);
        render();
      });
    }
    runtime.section = section;
    return true;
  }

  function openStep(stepId) {
    const actionValue = actionForStep(stepId);
    if (actionValue) return navigateTo(actionValue, "");
    return false;
  }

  function axisHtml(title, entityValue, stepId) {
    return `<button class="dp-live-axis ${escapeHtml(entityValue.status)}" data-live-axis="${escapeHtml(stepId)}"><span>${escapeHtml(title)}</span><b>${escapeHtml(entityValue.value)}</b><small>${escapeHtml(entityValue.sourceLabel)}</small></button>`;
  }

  function entityHtml(entityValue) {
    return `<button class="dp-live-entity ${escapeHtml(entityValue.status)}" data-live-entity="${escapeHtml(entityValue.key)}"><span><small>${escapeHtml(entityValue.label)}</small><b>${escapeHtml(entityValue.value)}</b><em>${escapeHtml(entityValue.sourceLabel)}</em></span><i>${entityValue.available ? entityValue.sourceAction && entityValue.sourceAction !== action() ? "Открыть источник" : "Подсветить" : "Открыть раздел"}</i></button>`;
  }

  function render() {
    if (!runtime.section) return;
    runtime.model = buildModel();
    const model = runtime.model;
    if (!model.route) return;
    const steps = model.route.steps;
    runtime.stepIndex = Math.max(0, Math.min(steps.length - 1, runtime.stepIndex));
    runtime.section.querySelector("#dp-live-context").textContent = `${model.subscriber} · ${model.technology.label}`;
    runtime.section.querySelector("#dp-live-axes").innerHTML = [
      axisHtml("Доступ", model.entities.accessSummary, "access"),
      axisHtml("Juniper 2", model.entities.sessionState, "session"),
      axisHtml(model.technology.id === "pon" ? "Линия PON" : model.technology.id === "ethernet" ? "Порт Ethernet" : "Технология", model.technology.id === "unknown" ? model.entities.technology : model.entities.lineState, model.technology.id === "pon" ? "pon-line" : model.technology.id === "ethernet" ? "ethernet-port" : "detect-technology")
    ].join("");
    const hypothesis = runtime.section.querySelector("#dp-live-hypothesis");
    hypothesis.className = model.hypothesis.status;
    hypothesis.innerHTML = `<span>Рабочая гипотеза</span><b>${escapeHtml(model.hypothesis.title)}</b><p>${escapeHtml(model.hypothesis.message)}</p>`;
    const routeNode = runtime.section.querySelector("#dp-live-steps");
    routeNode.style.gridTemplateColumns = `repeat(${steps.length},minmax(0,1fr))`;
    routeNode.innerHTML = steps.map((step, index) => `<button data-live-step="${index}" class="${index === runtime.stepIndex ? "active" : ""}"><i>${index + 1}</i><span>${escapeHtml(step.title)}</span></button>`).join("");
    const step = steps[runtime.stepIndex];
    runtime.section.querySelector("#dp-live-step-title").textContent = step.title;
    runtime.section.querySelector("#dp-live-step-number").textContent = `${runtime.stepIndex + 1} / ${steps.length}`;
    runtime.section.querySelector("#dp-live-step-short").textContent = step.short;
    runtime.section.querySelector("#dp-live-entities").innerHTML = step.entityKeys.map((key) => entityHtml(model.entities[key])).join("");
    const why = runtime.section.querySelector("#dp-live-why");
    why.textContent = step.why;
    why.hidden = !runtime.explanationOpen;
    runtime.section.querySelector("#dp-live-explain").textContent = runtime.explanationOpen ? "Скрыть пояснение" : "Что означает";
    const next = steps[runtime.stepIndex + 1];
    runtime.section.querySelector("#dp-live-next-title").textContent = next ? `Следом: ${next.title}` : "Маршрут пройден";
    runtime.section.querySelector("#dp-live-next-short").textContent = next ? next.short : "Полученные источники сохранены в контексте абонента.";
    runtime.section.querySelector("#dp-live-next-button").textContent = next ? "Дальше" : "Сначала";
  }

  function applyScenario() {
    if (!runtime.workspace || !runtime.section) return;
    runtime.workspace.dataset.scenario = runtime.scenario;
    runtime.workspace.querySelectorAll("#dp-operator-scenarios-live [data-live-scenario]").forEach((button) => {
      button.classList.toggle("active", button.dataset.liveScenario === runtime.scenario);
    });
    runtime.section.hidden = !(currentMode() === "navigator" && runtime.scenario === "no-internet");
    if (!runtime.section.hidden) render();
  }

  GM_addStyle(`
    #dp-operator-scenarios-live{display:grid!important;grid-template-columns:1fr 1fr!important;gap:5px!important;padding:7px 10px!important;background:#fff!important;border-bottom:1px solid #d5dde8!important}#dp-operator-scenarios-live button{min-height:30px!important;color:#526174!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-radius:7px!important;font:750 9px Segoe UI,Arial!important}#dp-operator-scenarios-live button.active{color:#1d4ed8!important;background:#eff6ff!important;border-color:#93c5fd!important}
    #dp-operator-workspace[data-scenario="no-internet"]>:is(.dp-operator-summary,.dp-operator-route,.dp-operator-focus-card,.dp-operator-next){display:none!important}#dp-connectivity-live{display:grid!important;background:#eef2f7!important}#dp-connectivity-live[hidden]{display:none!important}
    .dp-live-summary{display:grid!important;gap:7px!important;padding:9px 10px!important}.dp-live-summary>header{display:flex!important;justify-content:space-between!important;align-items:center!important}.dp-live-summary>header>div{display:grid!important}.dp-live-summary>header b{font-size:12px!important}.dp-live-summary>header span{font-size:9px!important;color:#64748b!important}.dp-live-summary>header button{width:27px!important;height:27px!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:7px!important}
    #dp-live-axes{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important}.dp-live-axis{display:grid!important;gap:2px!important;min-width:0!important;min-height:64px!important;padding:7px!important;text-align:left!important;background:#fff!important;border:1px solid #d5dde8!important;border-top:3px solid #94a3b8!important;border-radius:8px!important}.dp-live-axis.ok{border-top-color:#16a34a!important}.dp-live-axis.warning{border-top-color:#d97706!important}.dp-live-axis.error{border-top-color:#dc2626!important}.dp-live-axis span,.dp-live-axis small{font-size:7.5px!important;color:#64748b!important}.dp-live-axis b{font-size:9px!important;line-height:1.25!important}
    #dp-live-hypothesis{display:grid!important;gap:2px!important;padding:8px 9px!important;background:#f8fafc!important;border:1px solid #cbd5e1!important;border-left:4px solid #64748b!important;border-radius:8px!important}#dp-live-hypothesis.ok{background:#f0fdf4!important;border-left-color:#16a34a!important}#dp-live-hypothesis.warning{background:#fffbeb!important;border-left-color:#d97706!important}#dp-live-hypothesis.error{background:#fef2f2!important;border-left-color:#dc2626!important}#dp-live-hypothesis span{font-size:7.5px!important;color:#64748b!important}#dp-live-hypothesis b{font-size:10px!important}#dp-live-hypothesis p{margin:0!important;font-size:8.7px!important;color:#526174!important}
    .dp-live-route{padding:9px 10px!important;background:#fff!important;border-top:1px solid #d5dde8!important;border-bottom:1px solid #d5dde8!important}.dp-live-route>header{display:flex!important;justify-content:space-between!important;margin-bottom:7px!important}.dp-live-route>header b{font-size:10px!important}.dp-live-route>header span{font-size:8px!important;color:#7b8798!important}#dp-live-steps{display:grid!important;gap:4px!important}#dp-live-steps button{display:grid!important;place-items:center!important;gap:3px!important;min-height:45px!important;color:#64748b!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-radius:7px!important;font:700 7.8px Segoe UI,Arial!important}#dp-live-steps i{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;background:#e2e8f0!important;border-radius:50%!important;font-style:normal!important}#dp-live-steps button.active{color:#1d4ed8!important;background:#eff6ff!important;border-color:#93c5fd!important}#dp-live-steps button.active i{color:#fff!important;background:#2563eb!important}
    .dp-live-card{display:grid!important;gap:8px!important;margin:9px 10px!important;padding:10px!important;background:#fff!important;border:1px solid #b8c6d8!important;border-radius:10px!important}.dp-live-card>header{display:flex!important;justify-content:space-between!important}.dp-live-card>header>div{display:grid!important}.dp-live-card>header span{font-size:8px!important;color:#1d4ed8!important;text-transform:uppercase!important}.dp-live-card>header b{font-size:13px!important}.dp-live-card>header em{font-size:8px!important;font-style:normal!important}.dp-live-card>p{margin:0!important;font-size:9px!important;color:#526174!important}#dp-live-entities{display:grid!important;gap:5px!important}.dp-live-entity{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;padding:8px 9px!important;text-align:left!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-left:3px solid #64748b!important;border-radius:7px!important}.dp-live-entity.ok{border-left-color:#16a34a!important}.dp-live-entity.warning{border-left-color:#d97706!important}.dp-live-entity.error{border-left-color:#dc2626!important}.dp-live-entity>span{display:grid!important;min-width:0!important}.dp-live-entity small{font-size:8px!important;color:#64748b!important}.dp-live-entity b{font-size:9.5px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.dp-live-entity em{font-size:7.3px!important;color:#7b8798!important;font-style:normal!important}.dp-live-entity i{font-size:7.8px!important;color:#1d4ed8!important;font-style:normal!important}.dp-live-card footer{display:flex!important;gap:5px!important;flex-wrap:wrap!important}.dp-live-card footer button,.dp-live-next button{min-height:29px!important;padding:0 8px!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:7px!important;font:750 8.5px Segoe UI,Arial!important}.dp-live-card footer button.primary{color:#fff!important;background:#2563eb!important;border-color:#1d4ed8!important}#dp-live-why{padding:8px!important;background:#fff8eb!important;border:1px solid #f2d39b!important;border-radius:7px!important;font-size:8.5px!important}
    .dp-live-next{position:sticky!important;bottom:0!important;display:flex!important;justify-content:space-between!important;align-items:center!important;padding:9px 10px!important;background:#fff!important;border-top:1px solid #d5dde8!important}.dp-live-next>div{display:grid!important}.dp-live-next b{font-size:9px!important}.dp-live-next span{font-size:8px!important;color:#64748b!important}.dp-live-next button{color:#1d4ed8!important;border-color:#93c5fd!important}mark.dp-live-source-mark{padding:2px 4px!important;background:#fde047!important;color:#111827!important;border:2px solid #f59e0b!important;border-radius:3px!important}
  `);

  const startedAt = Date.now();
  while (!ensureUi() && Date.now() - startedAt < 15000) await sleep(50);
  if (!runtime.section) throw new Error("Operator workspace was not mounted");

  if (!runtime.unsubscribe) runtime.unsubscribe = store.subscribe(() => { render(); consumePendingFocus(); });
  document.addEventListener("dp:operation-mode-change", applyScenario);
  addEventListener("keydown", (event) => { if (event.key === "Escape") clearHighlight(); }, true);

  await captureNow();
  window.setTimeout(() => captureNow(), 500);
  window.setTimeout(() => captureNow(), 1800);
  installBoundedCaptureObserver();
  render();
  applyScenario();
  consumePendingFocus();

  globalThis.__SIMNET_OPERATOR_LIVE_STATE__ = Object.freeze({ captureNow, buildModel, render, focusEntity });
})().catch((error) => {
  console.error("[SIMNET operator live state] startup failed", error);
});
