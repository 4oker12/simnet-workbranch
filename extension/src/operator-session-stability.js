"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_SESSION_STABILITY__) return;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const PENDING_KEY = "dp_operator_session_focus_v1";
  let lastSanitized = "";
  let activeTarget = null;

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

  function patchRoutes() {
    const routes = globalThis.__SIMNET_OPERATOR_ROUTES__;
    if (!routes || routes.__sessionStabilityPatched) return Boolean(routes);
    const originalBuild = routes.buildNoInternet;
    if (typeof originalBuild !== "function") return false;

    const buildNoInternet = (technology) => {
      const route = originalBuild(technology);
      const steps = route.steps.map((step) => {
        if (step.id !== "session") return step;
        return Object.freeze({
          ...step,
          short: "Только факт активной авторизации в Juniper",
          entityKeys: Object.freeze(["sessionState"]),
          focusKey: "sessionState",
          why: "Активная сессия подтверждает авторизацию абонента. Логин, IP и служебные таймеры не являются отдельными диагностическими выводами."
        });
      });
      return Object.freeze({ ...route, title: "Проверка связи", steps: Object.freeze(steps) });
    };

    globalThis.__SIMNET_OPERATOR_ROUTES__ = Object.freeze({
      ...routes,
      buildNoInternet,
      __sessionStabilityPatched: true
    });
    return true;
  }

  function pageText() {
    const chunks = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("#dp-panel,script,style,noscript")) continue;
      const value = text(node.nodeValue);
      if (value) chunks.push(value);
    }
    return chunks.join("\n");
  }

  function explicitSessionState(raw = pageText()) {
    const active = /(?:статус\s+(?:сесії|сессии)|session\s+status)[^\n]{0,100}(?:online|active\s*(?:\(\d+\))?|up)\b/i.test(raw);
    const none = /(?:статус\s+(?:сесії|сессии)|session\s+status)[^\n]{0,100}(?:offline|inactive|none|0\s*(?:session|сес))/i.test(raw)
      || /(?:нет|немає|відсутн|отсутствует)\s+(?:активн(?:ой|ої)?\s+)?(?:сесси|сесі)/i.test(raw);
    if (none) return "none";
    if (active) return "active";
    return "unknown";
  }

  function storeApi() {
    return globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__ || null;
  }

  function sanitizeSession() {
    if (currentAction() !== "252") return false;
    const store = storeApi();
    if (!store?.current || !store?.writeSource) return false;
    const state = explicitSessionState();
    const context = store.current();
    const snapshot = context.sources?.session;
    const previous = snapshot?.data || {};
    const label = state === "active"
      ? "Сессия активна"
      : state === "none"
        ? "Активной сессии нет"
        : "Статус сессии не подтверждён";
    const signature = `${context.identity?.key || ""}|${state}|${label}`;
    if (signature === lastSanitized && previous.state === state && previous.label === label) return true;
    lastSanitized = signature;
    if (previous.state === state && previous.label === label && snapshot?.parser === "juniper2-only") return true;
    store.writeSource("session", { ...previous, state, label }, {
      action: "252",
      href: location.href,
      parser: "juniper2-only",
      confidence: state === "unknown" ? "low" : "high",
      identity: context.identity
    });
    return true;
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function sessionStatusTarget() {
    let best = null;
    let bestLength = Infinity;
    const pattern = /(?:статус\s+(?:сесії|сессии)|session\s+status)[\s\S]{0,120}(?:online|active|offline|inactive|none)/i;
    for (const node of document.querySelectorAll("tr,td,th,pre,code,div,p,span,b,strong")) {
      if (node.closest("#dp-panel")) continue;
      const value = text(node.innerText || node.textContent);
      if (!value || value.length > 1000 || !pattern.test(value)) continue;
      const target = node.closest("tr") || node;
      if (value.length < bestLength && isVisible(target)) {
        best = target;
        bestLength = value.length;
      }
    }
    return best;
  }

  function clearFocus() {
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("session-stability-clear");
    activeTarget?.classList.remove("dp-session-status-target");
    activeTarget = null;
  }

  function focusStatus() {
    clearFocus();
    const target = sessionStatusTarget();
    if (!target) return false;
    activeTarget = target;
    target.classList.add("dp-session-status-target");
    const state = explicitSessionState();
    globalThis.__SIMNET_PAGE_FOCUS__?.show?.(target, {
      label: "Статус сессии Juniper",
      tone: state === "active" ? "ok" : state === "none" ? "warning" : "info",
      padding: 7,
      scroll: true
    });
    return true;
  }

  function sessionUrl() {
    const store = storeApi();
    const context = store?.current?.() || {};
    const saved = context.sources?.session?.href;
    try {
      const base = globalThis.__SIMNET_BILLING_PROVIDER__
        ?.profileForProvider?.(context.identity?.provider)?.base || location.origin;
      const url = saved ? new URL(saved, base) : new URL("/cgi-bin/adm/stat.pl", base);
      url.pathname = "/cgi-bin/adm/stat.pl";
      const pp = currentPp();
      if (pp) url.searchParams.set("pp", pp);
      url.searchParams.set("a", "252");
      if (context.identity?.billingId) url.searchParams.set("id", context.identity.billingId);
      return url.toString();
    } catch (_) { return ""; }
  }

  function savePending() {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        identityKey: storeApi()?.current?.().identity?.key || "",
        expiresAt: Date.now() + 60000
      }));
    } catch (_) {}
  }

  function showSessionSource() {
    if (currentAction() === "252") return focusStatus();
    const url = sessionUrl();
    if (!url) return false;
    savePending();
    location.assign(url);
    return true;
  }

  function isSessionShowClick(event) {
    if (event.target.closest?.('#dp-live-entities [data-live-entity="sessionState"]')) return true;
    if (!event.target.closest?.("#dp-live-show")) return false;
    return /сесси/i.test(text(document.querySelector("#dp-live-step-title")?.textContent));
  }

  function consumePending() {
    if (currentAction() !== "252") return false;
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch (_) { return false; }
    if (!pending || Number(pending.expiresAt || 0) < Date.now()) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
      return false;
    }
    const currentIdentity = storeApi()?.current?.().identity?.key || "";
    if (pending.identityKey && currentIdentity && pending.identityKey !== currentIdentity) return false;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
    window.setTimeout(focusStatus, 180);
    return true;
  }

  function installStyle() {
    if (document.getElementById("dp-session-stability-style")) return;
    const style = document.createElement("style");
    style.id = "dp-session-stability-style";
    style.textContent = ".dp-session-status-target{position:relative!important;z-index:2147483639!important;outline:3px solid #84cc16!important;outline-offset:3px!important}";
    (document.head || document.documentElement).appendChild(style);
  }

  document.addEventListener("click", (event) => {
    if (!isSessionShowClick(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showSessionSource();
  }, true);

  document.addEventListener("dp:operator-live-captured", () => window.setTimeout(sanitizeSession, 0));
  document.addEventListener("dp:operator-context-change", () => window.setTimeout(sanitizeSession, 0));
  addEventListener("keydown", (event) => { if (event.key === "Escape") clearFocus(); }, true);

  installStyle();
  patchRoutes();
  [0, 250, 700, 1500, 3000].forEach((delay) => window.setTimeout(() => {
    patchRoutes();
    sanitizeSession();
    consumePending();
  }, delay));

  globalThis.__SIMNET_OPERATOR_SESSION_STABILITY__ = Object.freeze({
    patchRoutes,
    sanitizeSession,
    focusStatus,
    showSessionSource
  });
})();
