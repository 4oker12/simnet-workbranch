"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_ACCESS_NAVIGATION__) return;

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const normalize = (value) => text(value).toLowerCase().replace(/[іi]/g, "и").replace(/ё/g, "е");

  async function waitFor(key, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (globalThis[key]) return globalThis[key];
      await sleep(25);
    }
    return null;
  }

  const store = await waitFor("__SIMNET_OPERATOR_CONTEXT_STORE__");
  if (!store) return;

  const PENDING_KEY = "dp_operator_exact_source_v1";
  const ACCESS_KEYS = new Set([
    "accessSummary", "serviceState", "access", "startDay", "subscriberGroup",
    "tariffPackage", "disconnectWarning"
  ]);
  const SESSION_KEYS = new Set([
    "sessionState", "sessionLogin", "sessionIp", "sessionStartedAt", "sessionDuration", "lastAuthorization"
  ]);
  const runtime = {
    activeElement: null,
    activeRow: null,
    decorating: false,
    captureSignature: ""
  };

  function currentAction() {
    try { return new URL(location.href).searchParams.get("a") || ""; } catch (_) { return ""; }
  }

  function currentPp() {
    try {
      return new URL(location.href).searchParams.get("pp")
        || document.querySelector('input[name="pp"]')?.value
        || "";
    } catch (_) { return ""; }
  }

  function selectedValue(control) {
    if (!control) return "";
    return text(control.tagName === "SELECT"
      ? control.selectedOptions?.[0]?.textContent || control.value
      : control.value || control.textContent);
  }

  function directCells(row) {
    return [...row.querySelectorAll(":scope > td,:scope > th")];
  }

  function rowLabel(row) {
    return text(directCells(row)[0]?.innerText || directCells(row)[0]?.textContent);
  }

  function labeledField(patterns) {
    const regexes = patterns.map((value) => value instanceof RegExp ? value : new RegExp(value, "i"));
    for (const row of document.querySelectorAll("tr")) {
      if (row.closest("#dp-panel")) continue;
      const label = rowLabel(row);
      if (!label || !regexes.some((regex) => regex.test(label))) continue;
      const control = row.querySelector("select,input:not([type='hidden']),textarea");
      const cells = directCells(row);
      return {
        row,
        control,
        value: selectedValue(control) || text(cells.at(-1)?.innerText || cells.at(-1)?.textContent)
      };
    }
    return null;
  }

  function mainCardFields() {
    const serviceStateControl = document.querySelector('select[name="cstate"]');
    const accessControl = document.querySelector('select[name="state"]');
    const startDayControl = document.querySelector('input[name="start_day"]');
    const tariffControl = document.querySelector('select[name="paket"]');
    const groupField = labeledField([/^(?:группа|група)\b/i, /группа\s+абонент/i, /група\s+абонент/i]);

    const present = Boolean(serviceStateControl || accessControl || startDayControl || tariffControl || groupField);
    if (!present) return null;

    const serviceState = selectedValue(serviceStateControl);
    const access = selectedValue(accessControl);
    const startDay = selectedValue(startDayControl);
    const tariff = selectedValue(tariffControl);
    const group = text(groupField?.value);
    const groupDeleted = /удален|видален|deleted/i.test(normalize(group));
    const tariffBlocked = /заблокирован|заблоковано|blocked/i.test(normalize(tariff));
    const accessDeniedNative = /запрещ|заборон|^off$/i.test(normalize(access)) || accessControl?.value === "off";
    const accessAllowedNative = /разреш|дозвол|^on$/i.test(normalize(access)) || accessControl?.value === "on";

    return {
      serviceState,
      access,
      startDay,
      tariff,
      group,
      groupDeleted,
      tariffBlocked,
      accessDenied: Boolean(accessDeniedNative || groupDeleted || tariffBlocked),
      accessAllowed: Boolean(accessAllowedNative && !groupDeleted && !tariffBlocked),
      blockReason: groupDeleted
        ? "Абонент находится в удалённой группе."
        : tariffBlocked
          ? "В Billing выбран пакет «Заблокирован»."
          : accessDeniedNative
            ? "Административный доступ запрещён."
            : ""
    };
  }

  function isMainCard() {
    if (mainCardFields()) return true;
    try {
      const url = new URL(location.href);
      return /\/adm\.pl$/i.test(url.pathname) && url.searchParams.get("a") === "user";
    } catch (_) { return false; }
  }

  function sameAccessData(left = {}, right = {}) {
    const keys = [
      "serviceState", "access", "startDay", "tariff", "group", "groupDeleted",
      "tariffBlocked", "accessDenied", "accessAllowed", "blockReason", "warning", "subscriber"
    ];
    return keys.every((key) => String(left[key] ?? "") === String(right[key] ?? ""));
  }

  function captureMainCard() {
    const fields = mainCardFields();
    if (!fields) return false;
    const context = store.current();
    const previous = context.sources?.access?.data || {};
    const warning = text(document.querySelector(".message.cntr,.message")?.textContent);
    const data = {
      ...previous,
      ...fields,
      warning: warning || previous.warning || "",
      subscriber: previous.subscriber || context.identity?.login || ""
    };
    const signature = JSON.stringify(data);
    if (signature === runtime.captureSignature && sameAccessData(previous, data)) return true;
    runtime.captureSignature = signature;
    if (sameAccessData(previous, data) && context.sources?.access?.href === location.href) return true;
    store.writeSource("access", data, {
      action: "user",
      href: location.href,
      parser: "billing-main-card-access-v2",
      confidence: "high",
      identity: context.identity
    });
    return true;
  }

  function sourceIdForKey(key) {
    if (ACCESS_KEYS.has(key)) return "access";
    if (SESSION_KEYS.has(key)) return "session";
    if (["lineState", "clientPort", "learnedMac", "uptime", "optics", "historySummary"].includes(key)) return "pon";
    if (["routerMac", "technology", "vlan"].includes(key)) return "equipment";
    return "";
  }

  function providerBase(identity) {
    const profile = globalThis.__SIMNET_BILLING_PROVIDER__?.profileForProvider?.(identity?.provider);
    return profile?.base || location.origin;
  }

  function withCurrentSession(rawHref) {
    if (!rawHref) return "";
    try {
      const url = new URL(rawHref, providerBase(store.current().identity));
      const pp = currentPp();
      if (pp) url.searchParams.set("pp", pp);
      return url.toString();
    } catch (_) { return ""; }
  }

  function fallbackSourceUrl(sourceId) {
    const context = store.current();
    const identity = context.identity || {};
    const base = providerBase(identity);
    const pp = currentPp();
    if (sourceId === "access") {
      const url = new URL("/cgi-bin/adm/adm.pl", base);
      if (pp) url.searchParams.set("pp", pp);
      url.searchParams.set("a", "user");
      if (identity.billingId) url.searchParams.set("id", identity.billingId);
      return url.toString();
    }
    if (sourceId === "session") {
      const url = new URL("/cgi-bin/adm/stat.pl", base);
      if (pp) url.searchParams.set("pp", pp);
      url.searchParams.set("a", "252");
      if (identity.billingId) url.searchParams.set("id", identity.billingId);
      return url.toString();
    }
    return "";
  }

  function sourceUrl(sourceId) {
    const snapshot = store.current().sources?.[sourceId];
    return withCurrentSession(snapshot?.href) || fallbackSourceUrl(sourceId);
  }

  function onCorrectSource(sourceId) {
    if (sourceId === "access") return isMainCard();
    if (sourceId === "session") return currentAction() === "252";
    const snapshot = store.current().sources?.[sourceId];
    return Boolean(snapshot?.action && String(snapshot.action) === currentAction());
  }

  function savePending(key, sourceId) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        key,
        sourceId,
        identityKey: store.current().identity?.key || "",
        expiresAt: Date.now() + 60000
      }));
    } catch (_) {}
  }

  function clearExactFocus() {
    runtime.activeElement?.classList.remove("dp-exact-source-target");
    runtime.activeRow?.classList.remove("dp-exact-source-row");
    runtime.activeElement = null;
    runtime.activeRow = null;
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  async function clickNativeAdditional() {
    const links = [...document.querySelectorAll("a,button,input[type='button']")]
      .filter((node) => !node.closest("#dp-panel") && isVisible(node))
      .filter((node) => /дополнительно|додатково|additional/i.test(text(node.innerText || node.value || node.textContent)));
    if (!links.length) return false;
    links[0].click();
    await sleep(120);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  }

  async function revealHiddenTarget(target) {
    if (!target) return null;
    if (isVisible(target)) return target;
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== document.body) {
      const idMatch = String(ancestor.id || "").match(/^my_x_(\d+)$/);
      if (idMatch) {
        const toggle = [...document.querySelectorAll("a[href]")]
          .find((node) => new RegExp(`show_x\\(${idMatch[1]}\\)`).test(String(node.getAttribute("href") || "")));
        if (toggle) {
          toggle.click();
          await sleep(100);
        }
      }
      ancestor = ancestor.parentElement;
    }
    if (!isVisible(target)) await clickNativeAdditional();
    return target;
  }

  function smallestTextElement(patterns) {
    const regexes = patterns.filter(Boolean).map((value) => value instanceof RegExp
      ? value
      : new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    let best = null;
    let bestLength = Infinity;
    for (const node of document.querySelectorAll("td,th,div,span,b,strong,p,pre,code")) {
      if (node.closest("#dp-panel")) continue;
      const value = text(node.innerText || node.textContent);
      if (!value || value.length > 1200 || !regexes.some((regex) => regex.test(value))) continue;
      if (value.length < bestLength) {
        best = node;
        bestLength = value.length;
      }
    }
    return best;
  }

  function targetForAccessKey(key) {
    if (key === "serviceState") return document.querySelector('select[name="cstate"]');
    if (key === "access") return document.querySelector('select[name="state"]');
    if (key === "startDay") return document.querySelector('input[name="start_day"]');
    if (key === "tariffPackage") return document.querySelector('select[name="paket"]');
    if (key === "subscriberGroup") return labeledField([/^(?:группа|група)\b/i])?.control || labeledField([/^(?:группа|група)\b/i])?.row || null;
    if (key === "disconnectWarning") return document.querySelector(".message.cntr,.message");
    if (key === "accessSummary") {
      return document.querySelector('select[name="cstate"]')
        || document.querySelector('select[name="state"]')
        || document.querySelector('input[name="start_day"]');
    }
    return null;
  }

  function targetForSessionKey(key) {
    const session = store.current().sources?.session?.data || {};
    if (key === "sessionLogin") return smallestTextElement([session.login, /логин|login|username/i]);
    if (key === "sessionIp") return smallestTextElement([session.ip, /ip[-\s]?адрес|^ip$/i]);
    if (key === "sessionStartedAt") return smallestTextElement([session.startedAt, /час старту|начал.*сесс|session\s+start|время входа/i]);
    if (key === "sessionDuration") return smallestTextElement([session.duration, /длительност|duration|uptime|час останньої події/i]);
    if (key === "lastAuthorization") return smallestTextElement([session.startedAt, session.duration]);
    return smallestTextElement([session.login, session.ip, /сесси|сесі|session/i]);
  }

  async function exactFocus(key) {
    clearExactFocus();
    let target = ACCESS_KEYS.has(key) ? targetForAccessKey(key) : SESSION_KEYS.has(key) ? targetForSessionKey(key) : null;
    if (!target && ACCESS_KEYS.has(key)) {
      await clickNativeAdditional();
      target = targetForAccessKey(key);
    }
    if (!target) return false;
    await revealHiddenTarget(target);
    if (!isVisible(target)) return false;
    const row = target.closest("tr") || target.parentElement;
    runtime.activeElement = target;
    runtime.activeRow = row;
    target.classList.add("dp-exact-source-target");
    row?.classList.add("dp-exact-source-row");
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
      try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
    }
    return true;
  }

  async function showSource(key) {
    const sourceId = sourceIdForKey(key);
    if (!sourceId) return false;
    if (!onCorrectSource(sourceId)) {
      const url = sourceUrl(sourceId);
      if (!url) return false;
      savePending(key, sourceId);
      location.assign(url);
      return true;
    }
    return exactFocus(key);
  }

  function activeStepKey() {
    const active = document.querySelector("#dp-live-steps [data-live-step].active span");
    const title = normalize(active?.textContent);
    if (/доступ/.test(title)) return "accessSummary";
    if (/сесси/.test(title)) return "sessionState";
    if (/onu|линия|порт/.test(title)) return "lineState";
    if (/истори/.test(title)) return "historySummary";
    return "";
  }

  function statusClass(value, kind) {
    const normalized = normalize(value);
    if (kind === "startDay") {
      const number = Number(String(value || "").replace(",", "."));
      return Number.isFinite(number) ? number >= 0 ? "ok" : "warning" : "unknown";
    }
    if (kind === "group") return /удален|видален|deleted/.test(normalized) ? "error" : value ? "ok" : "unknown";
    if (kind === "tariff") return /заблокирован|заблоковано|blocked/.test(normalized) ? "error" : value ? "ok" : "unknown";
    return "unknown";
  }

  function syntheticEntity(key, label, value, status, sourceLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dp-live-entity dp-synthetic-entity dp-key-state ${status}`;
    button.dataset.liveEntity = key;
    button.innerHTML = `<span><small></small><b></b><em></em></span><i>Подсветить</i>`;
    button.querySelector("small").textContent = label;
    button.querySelector("b").textContent = value || "Не получено";
    button.querySelector("em").textContent = sourceLabel || "Billing";
    return button;
  }

  function replaceSynthetic(container, key, node) {
    container.querySelector(`[data-live-entity="${key}"]`)?.remove();
    container.appendChild(node);
  }

  function decorateAccessStep(container, access, sourceLabel) {
    const day = text(access.startDay);
    const dayNumber = Number(day.replace(",", "."));
    const dayValue = day
      ? `${day}${Number.isFinite(dayNumber) && dayNumber >= 0 ? " · норма" : ""}`
      : "Не получено";
    replaceSynthetic(container, "startDay", syntheticEntity(
      "startDay", "День потребления услуги", dayValue, statusClass(day, "startDay"), sourceLabel
    ));
    replaceSynthetic(container, "subscriberGroup", syntheticEntity(
      "subscriberGroup", "Группа абонента", access.group || "Не получено", statusClass(access.group, "group"), sourceLabel
    ));
    replaceSynthetic(container, "tariffPackage", syntheticEntity(
      "tariffPackage", "Пакет", access.tariff || "Не получено", statusClass(access.tariff, "tariff"), sourceLabel
    ));
  }

  function decorateSessionStep(container, session, sourceLabel) {
    container.querySelector('[data-live-entity="lastAuthorization"]')?.remove();
    replaceSynthetic(container, "sessionStartedAt", syntheticEntity(
      "sessionStartedAt", "Сессия началась", session.startedAt || "Не получено", session.startedAt ? "info" : "unknown", sourceLabel
    ));
    replaceSynthetic(container, "sessionDuration", syntheticEntity(
      "sessionDuration", "Длительность сессии", session.duration || "Не получено", session.duration ? "info" : "unknown", sourceLabel
    ));
  }

  function emphasizeExisting(container) {
    ["serviceState", "access", "sessionState", "lineState", "clientPort"].forEach((key) => {
      container.querySelector(`[data-live-entity="${key}"]`)?.classList.add("dp-key-state");
    });
  }

  function decorateHypothesis(access) {
    if (!access.groupDeleted && !access.tariffBlocked) return;
    const hypothesis = document.querySelector("#dp-live-hypothesis");
    if (!hypothesis) return;
    hypothesis.className = "error";
    hypothesis.replaceChildren();
    const caption = document.createElement("span");
    caption.textContent = "Рабочая гипотеза";
    const title = document.createElement("b");
    const body = document.createElement("p");
    if (access.groupDeleted) {
      title.textContent = "Абонент находится в удалённой группе";
      body.textContent = "Для удалённой группы отсутствие доступа ожидаемо. Сначала проверь корректность группы и необходимость восстановления абонента.";
    } else {
      title.textContent = "Выбран пакет «Заблокирован»";
      body.textContent = "При заблокированном пакете интернет по умолчанию недоступен. Технический опрос не устраняет эту причину.";
    }
    hypothesis.append(caption, title, body);
  }

  function decoratePanel() {
    if (runtime.decorating) return;
    runtime.decorating = true;
    try {
      const container = document.querySelector("#dp-live-entities");
      if (!container) return;
      const context = store.current();
      const access = context.sources?.access?.data || {};
      const session = context.sources?.session?.data || {};
      const accessLabel = store.sourceState("access").label;
      const sessionLabel = store.sourceState("session").label;
      const stepTitle = normalize(document.querySelector("#dp-live-step-title")?.textContent);
      if (/доступ/.test(stepTitle)) decorateAccessStep(container, access, accessLabel);
      if (/сесси/.test(stepTitle)) decorateSessionStep(container, session, sessionLabel);
      emphasizeExisting(container);
      decorateHypothesis(access);
    } finally {
      runtime.decorating = false;
    }
  }

  async function consumePending() {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch (_) { return false; }
    if (!pending || Number(pending.expiresAt || 0) < Date.now()) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
      return false;
    }
    if (pending.identityKey && pending.identityKey !== store.current().identity?.key) return false;
    if (!onCorrectSource(pending.sourceId)) return false;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
    await sleep(180);
    return exactFocus(pending.key);
  }

  function installStyle() {
    if (document.getElementById("dp-operator-access-navigation-style")) return;
    const style = document.createElement("style");
    style.id = "dp-operator-access-navigation-style";
    style.textContent = `
      .dp-exact-source-target{position:relative!important;z-index:2147483637!important;outline:3px solid #84cc16!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(132,204,22,.22)!important}
      .dp-exact-source-row{position:relative!important;z-index:2147483636!important;background:#f7fee7!important}
      .dp-live-entity.dp-key-state b{display:inline-flex!important;align-items:center!important;width:max-content!important;max-width:100%!important;padding:2px 6px!important;border-radius:5px!important;font-size:10.5px!important;font-weight:850!important;white-space:normal!important}
      .dp-live-entity.dp-key-state.ok b{color:#166534!important;background:#dcfce7!important}
      .dp-live-entity.dp-key-state.warning b{color:#92400e!important;background:#fef3c7!important}
      .dp-live-entity.dp-key-state.error b{color:#991b1b!important;background:#fee2e2!important}
      .dp-live-entity.dp-key-state.info b{color:#1e40af!important;background:#dbeafe!important}
      .dp-synthetic-entity{width:100%!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  document.addEventListener("click", (event) => {
    const entity = event.target.closest?.("#dp-live-entities [data-live-entity]");
    const show = event.target.closest?.("#dp-live-show");
    const key = entity?.dataset.liveEntity || (show ? activeStepKey() : "");
    if (!key || (!ACCESS_KEYS.has(key) && !SESSION_KEYS.has(key))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showSource(key);
  }, true);

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.('select[name="cstate"],select[name="state"],input[name="start_day"],select[name="paket"],select,input')) {
      window.setTimeout(() => { captureMainCard(); decoratePanel(); }, 0);
    }
  }, true);

  addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearExactFocus();
  }, true);

  ["dp:operator-context-change", "dp:operator-live-captured", "dp:operation-mode-change"].forEach((name) => {
    document.addEventListener(name, () => window.setTimeout(decoratePanel, 0));
  });

  installStyle();
  captureMainCard();
  decoratePanel();
  window.setTimeout(() => { captureMainCard(); decoratePanel(); consumePending(); }, 350);
  window.setTimeout(() => { captureMainCard(); decoratePanel(); consumePending(); }, 1200);
  window.setTimeout(() => consumePending(), 2600);

  globalThis.__SIMNET_OPERATOR_ACCESS_NAVIGATION__ = Object.freeze({
    captureMainCard,
    decoratePanel,
    showSource,
    exactFocus
  });
})().catch((error) => console.error("[SIMNET access navigation] startup failed", error));
