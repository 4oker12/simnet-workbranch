"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_CONNECTIVITY_STATE__) return;

  const store = globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__;
  if (!store?.ready) return;
  await store.ready;

  const listeners = new Set();
  let latestModel = null;
  let activeMark = null;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function currentAction() {
    return store.currentAction();
  }

  function statusFromSeverity(value) {
    const severity = text(value).toLowerCase();
    if (severity === "error" || severity === "conflict") return "error";
    if (severity === "warn" || severity === "warning") return "warning";
    if (severity === "ok") return "ok";
    return "unknown";
  }

  function sourceMeta(sourceId) {
    return store.sourceState(sourceId);
  }

  function entity(key, label, value, status = "unknown", sourceId = "", extra = {}) {
    const source = sourceId ? sourceMeta(sourceId) : null;
    return {
      key,
      label,
      value: text(value) || "Не получено",
      status,
      sourceId,
      sourceLabel: source?.label || "Не проверено",
      sourceAction: text(source?.snapshot?.action),
      capturedAt: Number(source?.snapshot?.capturedAt || 0),
      available: Boolean(source?.snapshot),
      ...extra
    };
  }

  function accessPart(context) {
    const source = context.sources?.access;
    const data = source?.data || {};
    const denied = Boolean(data.accessDenied) || /запрещ|заборон|off/i.test(text(data.access));
    const allowed = Boolean(data.accessAllowed) || /разреш|дозвол|on/i.test(text(data.access));
    const warning = text(data.warning);
    const stateOk = /все\s*ок/i.test(text(data.serviceState));
    const status = denied ? "error" : warning && !/не найден/i.test(warning) ? "warning" : allowed && stateOk ? "ok" : "unknown";
    return { source, data, denied, allowed, warning, stateOk, status };
  }

  function sessionPart(context) {
    const source = context.sources?.session;
    const data = source?.data || {};
    const validSource = source?.action === "252" && source?.parser === "juniper2-only";
    if (!validSource) return { source: null, data: {}, state: "missing", status: "unknown" };
    const state = text(data.state || "unknown");
    const status = state === "active" ? "ok" : state === "none" ? "warning" : "unknown";
    return { source, data, state, status };
  }

  function technologyPart(context) {
    const value = context.technology || {};
    const id = ["pon", "ethernet"].includes(value.id) ? value.id : "unknown";
    return {
      ...value,
      id,
      label: text(value.label) || (id === "pon" ? "PON / оптика" : id === "ethernet" ? "Ethernet / FTTB" : "Не определена")
    };
  }

  function ponPart(context) {
    const source = context.sources?.pon;
    const data = source?.data || {};
    if (!source) return { source: null, data: {}, state: "missing", status: "unknown" };
    const state = text(data.status || "unknown");
    const reportStatus = statusFromSeverity(data.report?.severity);
    const status = state === "offline" ? "error" : reportStatus;
    return { source, data, state, status };
  }

  function equipmentPart(context) {
    const source = context.sources?.equipment;
    return { source, data: source?.data || {} };
  }

  function formatOptics(optics = {}) {
    const parts = [];
    if (Number.isFinite(optics.onuRxDbm)) parts.push(`ONU Rx ${Number(optics.onuRxDbm).toFixed(2)} dBm`);
    if (Number.isFinite(optics.oltRxDbm)) parts.push(`OLT Rx ${Number(optics.oltRxDbm).toFixed(2)} dBm`);
    return parts.join(" · ");
  }

  function formatPort(ethernet = {}) {
    const link = text(ethernet.link || "unknown").toUpperCase();
    const parts = [link === "UNKNOWN" ? "Состояние не получено" : link];
    if (Number(ethernet.speedMbps) > 0) parts.push(`${Number(ethernet.speedMbps)} Мбит/с`);
    if (ethernet.duplex && ethernet.duplex !== "unknown") parts.push(`${ethernet.duplex}-duplex`);
    return parts.join(" · ");
  }

  function formatMacList(values) {
    return Array.isArray(values) && values.length ? values.join(", ") : "Не изучен";
  }

  function historySummary(pon) {
    const history = pon.data?.history || {};
    const report = pon.data?.report || {};
    if (Array.isArray(history.recent48h) && history.recent48h.length) return `${history.recent48h.length} событий за 48 часов`;
    if (Array.isArray(report.deviations) && report.deviations.length) return report.deviations.slice(0, 2).join(" · ");
    return pon.source ? "Свежих тревог не выделено" : "Не проверено";
  }

  function buildHypothesis(access, session, technology, pon) {
    if (access.denied) {
      return {
        status: "error",
        title: "Доступ ограничен в Billing",
        message: "Сначала устрани административную или финансовую причину. Техническая ветка не отменяет запрещённый доступ."
      };
    }

    if (!session.source) {
      return {
        status: "warning",
        title: "Juniper 2 не проверен",
        message: "Состояние сессии берётся только со страницы Juniper (NEW), action 252. Открой этот источник."
      };
    }

    if (technology.id === "unknown") {
      return {
        status: "warning",
        title: "Технология не подтверждена",
        message: "ONU-ветка не запускается, пока PON не подтверждён техническими данными, ТМЦ или live-опросом."
      };
    }

    if (technology.id === "pon" && !pon.source) {
      return {
        status: session.state === "active" ? "warning" : "unknown",
        title: "PON подтверждён, ONU ещё не опрошена",
        message: "Состояние сессии сохранено. Для локализации линии нужен результат конкретной OLT."
      };
    }

    if (technology.id === "pon") {
      const ethernet = pon.data.ethernet || {};
      const report = pon.data.report || {};
      if (pon.state === "offline") {
        return {
          status: "error",
          title: "ONU offline",
          message: text(report.conclusion) || "Проверяй оптическую линию, питание ONU и PON-порт."
        };
      }
      if (ethernet.link === "down") {
        return {
          status: "error",
          title: "ONU online, Ethernet-порт down",
          message: "Оптика до ONU работает. Проверяй кабель ONU–роутер, питание роутера и WAN-порт."
        };
      }
      if (report.routerMacMismatch) {
        return {
          status: "error",
          title: "За ONU светится другой MAC",
          message: text(report.summary) || "Изученный MAC не совпадает с MAC оборудования из технических данных."
        };
      }
      if (!report.routerMacPresent && ethernet.link === "up") {
        return {
          status: "warning",
          title: "Порт up, но MAC не изучен",
          message: "Проверь WAN-режим роутера, VLAN, кабель и фактическое подключение оборудования."
        };
      }
      if (session.state !== "active" && pon.state === "online" && ethernet.link === "up") {
        return {
          status: "warning",
          title: "Линия до роутера работает, сессии нет",
          message: "Проверяй авторизацию, привязку MAC и WAN-настройки."
        };
      }
      if (session.state === "active" && report.strongCurrentChain) {
        return {
          status: "ok",
          title: "Сеть провайдера подтверждена до роутера",
          message: "Juniper 2 видит сессию, ONU online, Ethernet up и MAC совпадает. Проверку смещай в роутер, Wi‑Fi и устройства."
        };
      }
      return {
        status: pon.status,
        title: text(report.summary) || "Результат ONU получен",
        message: text(report.conclusion) || "Сопоставь состояние сессии, Ethernet-порт и изученный MAC."
      };
    }

    return {
      status: session.state === "active" ? "ok" : "warning",
      title: session.state === "active" ? "Сессия активна" : "Активной сессии нет",
      message: "Для Ethernet/FTTB следующий источник — порт доступа и MAC на порту."
    };
  }

  function read() {
    const context = store.current();
    const access = accessPart(context);
    const session = sessionPart(context);
    const technology = technologyPart(context);
    const pon = ponPart(context);
    const equipment = equipmentPart(context);
    const route = globalThis.__SIMNET_OPERATOR_ROUTES__?.buildNoInternet?.(technology.id) || null;

    const accessValue = [access.data.serviceState, access.data.access].map(text).filter(Boolean).join(" · ") || "Не проверено";
    const sessionValue = session.source ? text(session.data.label) || (session.state === "active" ? "Сессия активна" : "Активной сессии нет") : "Не проверено в Juniper 2";
    const lineValue = technology.id === "pon"
      ? pon.source ? (pon.state === "online" ? "ONU online" : pon.state === "offline" ? "ONU offline" : "Ответ OLT получен") : "ONU не опрошена"
      : technology.id === "ethernet" ? "Порт доступа не проверен" : "Технология не определена";

    const entities = {
      accessSummary: entity("accessSummary", "Доступ и состояние", accessValue, access.status, "access"),
      serviceState: entity("serviceState", "Состояние услуги", access.data.serviceState, access.stateOk ? "ok" : access.data.serviceState ? "warning" : "unknown", "access"),
      access: entity("access", "Доступ", access.data.access, access.denied ? "error" : access.allowed ? "ok" : "unknown", "access"),
      disconnectWarning: entity("disconnectWarning", "Предупреждение Billing", access.warning || "Нет сохранённого предупреждения", access.warning && !/не найден/i.test(access.warning) ? "warning" : "ok", "access"),

      sessionState: entity("sessionState", "Сессия Juniper 2", sessionValue, session.status, "session"),
      sessionLogin: entity("sessionLogin", "Логин", session.data.login, session.data.login ? "info" : "unknown", "session"),
      sessionIp: entity("sessionIp", "IP", session.data.ip, session.data.ip ? "info" : "unknown", "session"),
      lastAuthorization: entity("lastAuthorization", "Начало / длительность", session.data.startedAt || session.data.duration, session.data.startedAt || session.data.duration ? "info" : "unknown", "session"),

      technology: entity("technology", "Технология подключения", technology.label, technology.id === "unknown" ? "warning" : "ok", "equipment", { adapter: technology.adapter }),
      lineState: entity("lineState", technology.id === "pon" ? "ONU и линия" : "Порт доступа", lineValue, technology.id === "pon" ? pon.status : "unknown", technology.id === "pon" ? "pon" : "equipment"),
      optics: entity("optics", "Оптические уровни", formatOptics(pon.data.optics), formatOptics(pon.data.optics) ? "info" : "unknown", "pon"),
      clientPort: entity("clientPort", technology.id === "pon" ? "Ethernet-порт ONU" : "Физический порт", technology.id === "pon" ? formatPort(pon.data.ethernet) : "Не проверен", pon.data.ethernet?.link === "up" ? "ok" : pon.data.ethernet?.link === "down" ? "error" : "unknown", technology.id === "pon" ? "pon" : "equipment"),
      uptime: entity("uptime", "Общее время работы", pon.data.uptime?.text, pon.data.uptime?.text ? "info" : "unknown", "pon"),
      learnedMac: entity("learnedMac", "MAC оборудования за ONU", formatMacList(pon.data.macs), pon.data.report?.routerMacMismatch ? "error" : pon.data.report?.routerMacMatched ? "ok" : pon.data.report?.routerMacPresent ? "warning" : "unknown", "pon"),
      routerMac: entity("routerMac", "MAC из технических данных", equipment.data.routerMac, equipment.data.routerMac ? "info" : "unknown", "equipment"),
      vlan: entity("vlan", "VLAN", equipment.data.vlan, equipment.data.vlan ? "info" : "unknown", "equipment"),
      historySummary: entity("historySummary", "Короткая история", historySummary(pon), pon.source ? (pon.data.report?.deviations?.length ? "warning" : "info") : "unknown", "pon")
    };

    latestModel = {
      readAt: Date.now(),
      identity: context.identity,
      subscriber: context.identity.login || (context.identity.billingId ? `Billing ID ${context.identity.billingId}` : "текущий абонент"),
      context,
      technology,
      access,
      session,
      pon,
      equipment,
      route,
      entities,
      hypothesis: buildHypothesis(access, session, technology, pon)
    };
    return latestModel;
  }

  function clearSourceHighlight() {
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("source-highlight-clear");
    if (activeMark?.isConnected) {
      const parent = activeMark.parentNode;
      activeMark.replaceWith(document.createTextNode(activeMark.textContent || ""));
      parent?.normalize?.();
    }
    activeMark = null;
  }

  function textNodesOutsidePanel() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("#dp-panel,script,style,noscript")) continue;
      if (text(node.nodeValue)) nodes.push(node);
    }
    return nodes;
  }

  function markMatch(patterns) {
    clearSourceHighlight();
    const regexes = patterns.filter(Boolean).map((value) => value instanceof RegExp ? value : new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    for (const node of textNodesOutsidePanel()) {
      const value = node.nodeValue || "";
      for (const regex of regexes) {
        const match = value.match(regex);
        if (!match || match.index === undefined) continue;
        const before = value.slice(0, match.index);
        const selected = value.slice(match.index, match.index + match[0].length);
        const after = value.slice(match.index + match[0].length);
        const fragment = document.createDocumentFragment();
        if (before) fragment.append(document.createTextNode(before));
        const mark = document.createElement("mark");
        mark.className = "dp-operator-source-mark";
        mark.textContent = selected;
        fragment.append(mark);
        if (after) fragment.append(document.createTextNode(after));
        node.replaceWith(fragment);
        activeMark = mark;
        mark.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        return mark;
      }
    }
    return null;
  }

  function findElement(patterns) {
    const regexes = patterns.filter(Boolean).map((value) => value instanceof RegExp ? value : new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    let best = null;
    let bestLength = Infinity;
    for (const element of document.querySelectorAll("tr,td,th,pre,code,div,p,span,b,strong")) {
      if (element.closest("#dp-panel")) continue;
      const value = text(element.innerText || element.textContent);
      if (!value || value.length > 1200) continue;
      if (!regexes.some((regex) => regex.test(value))) continue;
      if (value.length < bestLength) {
        best = element.closest("tr") || element;
        bestLength = value.length;
      }
    }
    return best;
  }

  function patternsForEntity(key, model) {
    const session = model.session.data || {};
    const pon = model.pon.data || {};
    const equipment = model.equipment.data || {};
    const mapping = {
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
    };
    return (mapping[key] || []).filter(Boolean);
  }

  function requiredActionForEntity(entity) {
    if (!entity?.sourceId) return "";
    return text(store.sourceState(entity.sourceId).snapshot?.action || entity.sourceAction);
  }

  function providerBase() {
    const profile = globalThis.__SIMNET_BILLING_PROVIDER__?.profileForProvider?.(latestModel?.identity?.provider);
    return profile?.base || location.origin;
  }

  function currentPp() {
    try {
      return new URL(location.href).searchParams.get("pp")
        || document.querySelector('input[name="pp"]')?.value
        || "";
    } catch (_) { return ""; }
  }

  function buildActionUrl(actionValue) {
    const model = latestModel || read();
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
    const model = latestModel || read();
    if (stepId === "session") return "252";
    if (stepId === "pon-line") return text(model.pon.source?.action)
      || ({ "bdcom-epon": "310", "bdcom-gpon": "311", gcom: "312", huawei: "313" }[model.technology.adapter] || "");
    return "";
  }

  function rememberPendingFocus(key, actionValue) {
    try {
      sessionStorage.setItem("dp_operator_pending_focus_v1", JSON.stringify({
        key,
        action: String(actionValue || ""),
        identityKey: (latestModel || read()).identity?.key || "",
        expiresAt: Date.now() + 30000
      }));
    } catch (_) {}
  }

  function focusEntity(key, options = {}) {
    const model = latestModel || read();
    const entity = model.entities[key];
    if (!entity) return { ok: false, reason: "unknown-entity" };
    const requiredAction = requiredActionForEntity(entity);
    if (requiredAction && currentAction() !== requiredAction && options.navigate !== false) {
      rememberPendingFocus(key, requiredAction);
      location.assign(buildActionUrl(requiredAction).toString());
      return { ok: false, navigating: true, action: requiredAction };
    }

    const patterns = patternsForEntity(key, model);
    const element = findElement(patterns);
    if (element) {
      clearSourceHighlight();
      globalThis.__SIMNET_PAGE_FOCUS__?.show?.(element, {
        label: `${entity.label} · ${entity.value}`,
        tone: entity.status === "error" ? "error" : entity.status === "warning" ? "warning" : entity.status === "ok" ? "ok" : "info",
        scroll: true
      });
      return { ok: true, element };
    }
    const mark = markMatch(patterns);
    return mark ? { ok: true, element: mark } : { ok: false, reason: "not-found", action: requiredAction };
  }

  function focusStep(stepId) {
    const model = latestModel || read();
    const step = model.route?.steps?.find((item) => item.id === stepId);
    return focusEntity(step?.focusKey || "", { navigate: true });
  }

  function openStep(stepId) {
    const model = latestModel || read();
    const actionValue = actionForStep(stepId);
    if (actionValue) {
      location.assign(buildActionUrl(actionValue).toString());
      return true;
    }

    if (stepId === "access" && model.identity?.billingId) {
      const url = new URL("/cgi-bin/adm/adm.pl", providerBase());
      const pp = currentPp();
      if (pp) url.searchParams.set("pp", pp);
      url.searchParams.set("a", "user");
      url.searchParams.set("id", model.identity.billingId);
      location.assign(url.toString());
      return true;
    }

    if (["detect-technology", "equipment", "ethernet-port"].includes(stepId) && model.identity?.billingId) {
      const url = new URL("/cgi-bin/adm/adm.pl", providerBase());
      const pp = currentPp();
      if (pp) url.searchParams.set("pp", pp);
      url.searchParams.set("a", "dopdata");
      url.searchParams.set("parent_type", "0");
      url.searchParams.set("id", model.identity.billingId);
      url.searchParams.set("tmpl", "1");
      location.assign(url.toString());
      return true;
    }
    return false;
  }

  function consumePendingFocus() {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem("dp_operator_pending_focus_v1") || "null"); } catch (_) { pending = null; }
    if (!pending || Number(pending.expiresAt || 0) < Date.now()) {
      try { sessionStorage.removeItem("dp_operator_pending_focus_v1"); } catch (_) {}
      return false;
    }
    const model = latestModel || read();
    if (pending.identityKey && pending.identityKey !== model.identity?.key) return false;
    if (pending.action && pending.action !== currentAction()) return false;
    try { sessionStorage.removeItem("dp_operator_pending_focus_v1"); } catch (_) {}
    window.setTimeout(() => focusEntity(pending.key, { navigate: false }), 80);
    return true;
  }

  function emit(reason = "refresh") {
    const model = read();
    for (const listener of listeners) {
      try { listener(model, reason); } catch (error) { console.warn("[SIMNET connectivity state] listener failed", error); }
    }
    document.dispatchEvent(new CustomEvent("dp:operator-connectivity-state", { detail: { model, reason } }));
    return model;
  }

  function refresh() {
    globalThis.__SIMNET_OPERATOR_SOURCE_CAPTURE__?.captureNow?.();
    return emit("manual-refresh");
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  store.subscribe(() => {
    emit("context-change");
    consumePendingFocus();
  });

  document.addEventListener("dp:operator-source-captured", () => {
    emit("source-captured");
    consumePendingFocus();
  });

  addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSourceHighlight();
  }, true);

  globalThis.__SIMNET_OPERATOR_CONNECTIVITY_STATE__ = Object.freeze({
    read,
    refresh,
    subscribe,
    focusEntity,
    focusStep,
    openStep,
    clearSourceHighlight,
    consumePendingFocus
  });

  emit("ready");
  consumePendingFocus();
})();
