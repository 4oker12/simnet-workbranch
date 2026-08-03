"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_SESSION_STABILITY__) return;

  const PENDING_KEY = "dp_operator_session_focus_v2";
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  let activeMark = null;
  let observer = null;
  let timer = 0;

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

  function storeApi() {
    return globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__ || null;
  }

  function statusMatch(raw) {
    return String(raw || "").match(
      /(?:^|[\r\n])\s*(?:\d+\.\s*)?(?:Статус\s+(?:сесії|сессии)|Session\s+status)\s*[-:]\s*([^\r\n]+)/im
    );
  }

  function findStatusEvidence() {
    let best = null;
    for (const node of document.querySelectorAll("td,th,pre,code,div,p,span")) {
      if (node.closest("#dp-panel,script,style,noscript")) continue;
      const raw = String(node.innerText || node.textContent || "");
      if (!raw || raw.length > 2500) continue;
      const match = statusMatch(raw);
      if (!match) continue;
      const candidate = {
        node,
        raw,
        value: text(match[1]),
        length: raw.length
      };
      if (!best || candidate.length < best.length) best = candidate;
    }
    return best;
  }

  function stateFromValue(value) {
    const normalized = text(value);
    if (!normalized) return "unknown";
    if (/\boffline\b|\binactive\b|\bnone\b|\bdown\b|(?:^|\D)0\s*(?:sessions?|сесси|сесі)/i.test(normalized)) return "none";
    if (/\bonline\b|\bactive(?:\s*\(\d+\))?\b|\bup\b/i.test(normalized)) return "active";
    return "unknown";
  }

  function normalizeSession() {
    if (currentAction() !== "252") return false;
    const store = storeApi();
    if (!store?.current || !store?.writeSource) return false;
    const evidence = findStatusEvidence();
    if (!evidence?.value) return false;

    const state = stateFromValue(evidence.value);
    const label = state === "active"
      ? "Сессия активна"
      : state === "none"
        ? "Активной сессии нет"
        : "Статус сессии не подтверждён";
    const context = store.current();
    const snapshot = context.sources?.session;
    const previous = snapshot?.data || {};

    if (previous.state === state
      && previous.label === label
      && previous.statusRaw === evidence.value
      && snapshot?.parser === "juniper2-only") return true;

    store.writeSource("session", {
      ...previous,
      state,
      label,
      statusRaw: evidence.value
    }, {
      action: "252",
      href: location.href,
      parser: "juniper2-only",
      confidence: state === "unknown" ? "low" : "high",
      identity: context.identity
    });
    return true;
  }

  function clearMark() {
    if (!activeMark?.isConnected) {
      activeMark = null;
      return;
    }
    const parent = activeMark.parentNode;
    activeMark.replaceWith(document.createTextNode(activeMark.textContent || ""));
    parent?.normalize?.();
    activeMark = null;
  }

  function markInTextNode(root, expectedValue) {
    if (!(root instanceof Element)) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent && !parent.closest("#dp-panel,script,style,noscript")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const raw = String(node.nodeValue || "");
      const line = raw.match(/(?:Статус\s+(?:сесії|сессии)|Session\s+status)\s*[-:]\s*([^\r\n]+)/i);
      let start = -1;
      let selected = "";
      if (line?.[1]) {
        selected = line[1];
        start = (line.index || 0) + line[0].lastIndexOf(selected);
      } else if (expectedValue) {
        start = raw.toLowerCase().indexOf(expectedValue.toLowerCase());
        if (start >= 0) selected = raw.slice(start, start + expectedValue.length);
      }
      if (start < 0 || !selected) continue;

      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + selected.length);
      const mark = document.createElement("mark");
      mark.className = "dp-session-status-mark";
      try { range.surroundContents(mark); } catch (_) { continue; }
      activeMark = mark;
      mark.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      return true;
    }
    return false;
  }

  function focusStatus() {
    clearMark();
    normalizeSession();
    const evidence = findStatusEvidence();
    if (!evidence?.node) return false;
    if (markInTextNode(evidence.node, evidence.value)) return true;

    for (const node of document.querySelectorAll("td,th,pre,code,div,p,span")) {
      if (node.closest("#dp-panel")) continue;
      if (markInTextNode(node, evidence.value)) return true;
    }
    return false;
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

  function isSessionClick(event) {
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
    style.textContent = `
      mark.dp-session-status-mark{
        display:inline!important;
        padding:2px 5px!important;
        color:#14532d!important;
        background:#dcfce7!important;
        border:1px solid #22c55e!important;
        border-radius:4px!important;
        box-shadow:none!important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function scheduleNormalize() {
    window.clearTimeout(timer);
    timer = window.setTimeout(normalizeSession, 80);
  }

  document.addEventListener("click", (event) => {
    if (!isSessionClick(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showSessionSource();
  }, true);

  document.addEventListener("dp:operator-live-captured", scheduleNormalize);
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearMark();
  }, true);

  installStyle();
  [0, 250, 700, 1500, 3000].forEach((delay) => window.setTimeout(() => {
    normalizeSession();
    consumePending();
  }, delay));

  if (currentAction() === "252") {
    const startedAt = Date.now();
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        return target && !target.closest("#dp-panel");
      });
      if (!relevant) return;
      scheduleNormalize();
      if (Date.now() - startedAt > 8000) observer?.disconnect();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    window.setTimeout(() => observer?.disconnect(), 8500);
  }

  globalThis.__SIMNET_OPERATOR_SESSION_STABILITY__ = Object.freeze({
    normalizeSession,
    focusStatus,
    showSessionSource,
    findStatusEvidence
  });
})();
