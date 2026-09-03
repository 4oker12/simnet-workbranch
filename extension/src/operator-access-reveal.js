"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_ACCESS_REVEAL__) return;

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const PENDING_KEY = "dp_operator_access_reveal_v1";
  const ACCESS_KEYS = new Set([
    "accessSummary", "serviceState", "access", "startDay", "subscriberGroup",
    "tariffPackage", "tariff", "disconnectWarning"
  ]);
  let activeTarget = null;
  let activeRow = null;

  async function waitForGlobal(key, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (globalThis[key]) return globalThis[key];
      await sleep(25);
    }
    return null;
  }

  const store = await waitForGlobal("__SIMNET_OPERATOR_CONTEXT_STORE__");
  if (!store) return;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function currentPp() {
    try {
      return new URL(location.href).searchParams.get("pp")
        || document.querySelector('input[name="pp"]')?.value
        || "";
    } catch (_) {
      return "";
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && !element.hidden
      && element.getClientRects().length > 0;
  }

  function mainCardUrl() {
    const context = store.current();
    const saved = context.sources?.access?.href;
    try {
      const base = globalThis.__SIMNET_BILLING_PROVIDER__
        ?.profileForProvider?.(context.identity?.provider)?.base || location.origin;
      const url = saved ? new URL(saved, base) : new URL("/cgi-bin/adm/adm.pl", base);
      const pp = currentPp();
      if (pp) url.searchParams.set("pp", pp);
      url.pathname = "/cgi-bin/adm/adm.pl";
      url.searchParams.set("a", "user");
      if (context.identity?.billingId) url.searchParams.set("id", context.identity.billingId);
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function isMainCard() {
    try {
      const url = new URL(location.href);
      return /\/adm\.pl$/i.test(url.pathname) && url.searchParams.get("a") === "user";
    } catch (_) {
      return false;
    }
  }

  function targetForKey(key) {
    if (key === "serviceState" || key === "accessSummary") return document.querySelector('select[name="cstate"]');
    if (key === "access") return document.querySelector('select[name="state"]');
    if (key === "startDay") return document.querySelector('input[name="start_day"]');
    if (key === "tariffPackage" || key === "tariff") return document.querySelector('select[name="paket"]');
    if (key === "disconnectWarning") return [...document.querySelectorAll(".message.cntr,.message")]
      .find((node) => /баланс ниже границы отключения|произойдет его отключение/i.test(text(node.textContent))) || null;
    if (key === "subscriberGroup") {
      for (const row of document.querySelectorAll("tr")) {
        if (row.closest("#dp-panel")) continue;
        const label = text(row.querySelector(":scope > td,:scope > th")?.textContent);
        if (!/^(?:группа|група)\b/i.test(label)) continue;
        return row.querySelector("select,input:not([type='hidden']),textarea") || row;
      }
    }
    return null;
  }

  function additionalToggle() {
    return document.querySelector('#addbutton[href*="show_x(11)"]')
      || document.querySelector('a[href*="show_x(11)"]')
      || [...document.querySelectorAll("a,button")]
        .find((node) => !node.closest("#dp-panel") && /дополнительно|додатково/i.test(text(node.textContent)));
  }

  function forceVisible(element) {
    if (!(element instanceof Element)) return;
    const chain = [];
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      chain.push(current);
      current = current.parentElement;
    }
    chain.reverse().forEach((node) => {
      if (node.hidden) node.hidden = false;
      const style = getComputedStyle(node);
      if (style.display === "none") {
        node.style.removeProperty("display");
        if (getComputedStyle(node).display === "none") {
          const fallback = node.tagName === "TR" ? "table-row"
            : node.tagName === "TBODY" ? "table-row-group"
              : node.tagName === "TABLE" ? "table"
                : "block";
          node.style.setProperty("display", fallback, "important");
        }
      }
      if (style.visibility === "hidden") node.style.setProperty("visibility", "visible", "important");
    });
  }

  async function ensureAdditionalOpen(key) {
    let target = targetForKey(key);
    if (target && isVisible(target)) return target;

    const toggle = additionalToggle();
    if (toggle) {
      try { toggle.click(); } catch (_) {
        try { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      }
    }

    const container = document.querySelector("#my_x_11");
    if (container) forceVisible(container);

    for (const delay of [40, 90, 180, 320, 520]) {
      await sleep(delay);
      target = targetForKey(key);
      if (target) forceVisible(target);
      if (target && isVisible(target)) return target;
    }
    return target;
  }

  function clearFocus() {
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("access-reveal-clear");
    activeTarget?.classList.remove("dp-access-reveal-target");
    activeRow?.classList.remove("dp-access-reveal-row");
    activeTarget = null;
    activeRow = null;
  }

  async function focusKey(key) {
    clearFocus();
    const target = await ensureAdditionalOpen(key);
    if (!target || !isVisible(target)) return false;
    const row = target.closest("tr") || target.parentElement;
    activeTarget = target;
    activeRow = row;
    target.classList.add("dp-access-reveal-target");
    row?.classList.add("dp-access-reveal-row");
    const label = {
      accessSummary: "Состояние услуги",
      serviceState: "Состояние услуги",
      access: "Доступ",
      startDay: "День потребления услуги",
      subscriberGroup: "Группа абонента",
      tariffPackage: "Пакет",
      tariff: "Пакет",
      disconnectWarning: "Предупреждение Billing"
    }[key] || "Поле Billing";
    globalThis.__SIMNET_PAGE_FOCUS__?.show?.(target, {
      label,
      tone: "info",
      padding: 7,
      scroll: true
    });
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
      window.setTimeout(() => {
        try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
      }, 260);
    }
    return true;
  }

  function savePending(key) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        key,
        identityKey: store.current().identity?.key || "",
        expiresAt: Date.now() + 60000
      }));
    } catch (_) {}
  }

  function navigateAndFocus(key) {
    const url = mainCardUrl();
    if (!url) return false;
    savePending(key);
    location.assign(url);
    return true;
  }

  async function handleKey(key) {
    if (!ACCESS_KEYS.has(key)) return false;
    if (!isMainCard()) return navigateAndFocus(key);
    return focusKey(key);
  }

  function keyFromClick(event) {
    const liveEntity = event.target.closest?.("#dp-live-entities [data-live-entity]");
    if (liveEntity) return liveEntity.dataset.liveEntity || "";
    const financeEntity = event.target.closest?.("#dp-operator-workspace [data-operator-entity]");
    if (financeEntity) return financeEntity.dataset.operatorEntity || "";
    if (event.target.closest?.("#dp-live-show")) {
      const title = text(document.querySelector("#dp-live-step-title")?.textContent);
      return /доступ/i.test(title) ? "accessSummary" : "";
    }
    if (event.target.closest?.("#dp-operator-show")) {
      const title = text(document.querySelector("#dp-operator-step-title")?.textContent);
      return /доступ/i.test(title) ? "accessSummary" : "";
    }
    return "";
  }

  async function consumePending() {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch (_) { return false; }
    if (!pending || Number(pending.expiresAt || 0) < Date.now()) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
      return false;
    }
    if (!isMainCard()) return false;
    const currentIdentity = store.current().identity?.key || "";
    if (pending.identityKey && currentIdentity && pending.identityKey !== currentIdentity) return false;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
    return focusKey(pending.key);
  }

  function installStyle() {
    if (document.getElementById("dp-access-reveal-style")) return;
    const style = document.createElement("style");
    style.id = "dp-access-reveal-style";
    style.textContent = `
      .dp-access-reveal-target{position:relative!important;z-index:2147483639!important;outline:3px solid #84cc16!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(132,204,22,.22)!important}
      .dp-access-reveal-row{position:relative!important;z-index:2147483638!important;background:#f7fee7!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  document.addEventListener("click", (event) => {
    const key = keyFromClick(event);
    if (!ACCESS_KEYS.has(key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handleKey(key);
  }, true);

  addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearFocus();
  }, true);

  installStyle();
  window.setTimeout(consumePending, 120);
  window.setTimeout(consumePending, 420);
  window.setTimeout(consumePending, 1000);

  globalThis.__SIMNET_OPERATOR_ACCESS_REVEAL__ = Object.freeze({
    focusKey,
    ensureAdditionalOpen,
    navigateAndFocus,
    consumePending
  });
})().catch((error) => console.error("[SIMNET access reveal] startup failed", error));
