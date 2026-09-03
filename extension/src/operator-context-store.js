"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__) return;

  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  if (!compat?.ready || !compat?.api) return;
  await compat.ready;

  const {
    GM_getValue,
    GM_setValue,
    GM_addValueChangeListener,
    GM_removeValueChangeListener
  } = compat.api;

  const STORE_PREFIX = "dp_operator_context_v3:";
  const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const listeners = new Set();
  let activeIdentity = null;
  let activeStorageKey = "";
  let activeContext = null;
  let remoteListenerId = 0;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function currentAction() {
    try { return new URL(location.href).searchParams.get("a") || ""; } catch (_) { return ""; }
  }

  function normalizeId(value) {
    const result = text(value);
    return /^\d+$/.test(result) && result !== "0" ? result : "";
  }

  function normalizeLogin(value) {
    const result = text(value).toLowerCase();
    return /^abon\d+$/i.test(result) ? result : "";
  }

  function normalizeAgreement(value) {
    const result = text(value).replace(/\D/g, "");
    return result.length >= 4 ? result : "";
  }

  function providerId() {
    const fromRegistry = globalThis.__SIMNET_BILLING_PROVIDER__?.providerForHostname?.(location.hostname);
    if (fromRegistry) return fromRegistry;
    if (/looknet/i.test(location.hostname)) return "looknet";
    if (/simnet/i.test(location.hostname)) return "simnet";
    return location.hostname || "unknown";
  }

  function queryValue(names) {
    let url;
    try { url = new URL(location.href); } catch (_) { return ""; }
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (text(value)) return text(value);
    }
    return "";
  }

  function controlValue(selectors) {
    for (const selector of selectors) {
      const control = document.querySelector(selector);
      if (!control) continue;
      const value = control.tagName === "SELECT"
        ? control.selectedOptions?.[0]?.textContent || control.value
        : control.value || control.textContent;
      if (text(value)) return text(value);
    }
    return "";
  }

  function linkParam(name) {
    for (const link of document.querySelectorAll('a[href*="a=user"],a[href*="stat.pl"],a[href*="adm.pl"]')) {
      try {
        const value = new URL(link.href, location.href).searchParams.get(name);
        if (text(value)) return text(value);
      } catch (_) {}
    }
    return "";
  }

  function resolveIdentity(overrides = {}) {
    const billingId = normalizeId(
      overrides.billingId
      || queryValue(["id", "mid", "billing_uid"])
      || controlValue(['input[name="id"]', 'input[name="mid"]', 'input[name="billing_uid"]'])
      || linkParam("id")
    );

    const login = normalizeLogin(
      overrides.login
      || controlValue(['input[name="login"]', 'input[name="user"]'])
      || [...document.querySelectorAll('a[href*="a=user"]')]
        .map((node) => text(node.textContent))
        .find((value) => /^abon\d+$/i.test(value))
      || text(document.body?.innerText).match(/\babon\d+\b/i)?.[0]
    );

    const agreement = normalizeAgreement(
      overrides.agreement
      || queryValue(["agreement_number", "contract"])
      || controlValue(['input[name="agreement_number"]', 'input[name="contract"]', 'input[name="dogovor"]'])
    );

    const provider = text(overrides.provider) || providerId();
    const discriminator = billingId
      ? `id:${billingId}`
      : login
        ? `login:${login}`
        : agreement
          ? `agreement:${agreement}`
          : "page:unknown";

    return {
      key: `${provider}:${discriminator}`,
      provider,
      billingId,
      login,
      agreement
    };
  }

  function storageKey(identity) {
    return `${STORE_PREFIX}${encodeURIComponent(identity.key)}`;
  }

  function emptyContext(identity) {
    return {
      schema: 3,
      identity: { ...identity },
      technology: {
        id: "unknown",
        adapter: "",
        label: "Не определена",
        confidence: "low",
        source: "",
        capturedAt: 0,
        pageId: ""
      },
      sources: {},
      updatedAt: 0
    };
  }

  function sanitizeContext(value, identity) {
    if (!value || typeof value !== "object") return emptyContext(identity);
    return {
      ...emptyContext(identity),
      ...value,
      identity: { ...identity, ...(value.identity || {}) },
      technology: { ...emptyContext(identity).technology, ...(value.technology || {}) },
      sources: value.sources && typeof value.sources === "object" ? { ...value.sources } : {}
    };
  }

  function clone(value) {
    try { return structuredClone(value); } catch (_) {
      try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }
  }

  function emit(reason = "update") {
    const detail = {
      reason,
      identity: clone(activeIdentity),
      context: clone(activeContext),
      pageId: PAGE_ID
    };
    for (const listener of listeners) {
      try { listener(detail.context, detail); } catch (error) {
        console.warn("[SIMNET operator context] listener failed", error);
      }
    }
    document.dispatchEvent(new CustomEvent("dp:operator-context-change", { detail }));
  }

  function installRemoteListener() {
    if (remoteListenerId) {
      try { GM_removeValueChangeListener(remoteListenerId); } catch (_) {}
      remoteListenerId = 0;
    }
    if (!activeStorageKey) return;
    try {
      remoteListenerId = GM_addValueChangeListener(activeStorageKey, (_key, _oldValue, newValue, remote) => {
        if (!newValue || typeof newValue !== "object") return;
        activeContext = sanitizeContext(newValue, activeIdentity);
        emit(remote ? "remote-storage" : "storage");
      });
    } catch (_) {}
  }

  function activate(identityInput = null) {
    const identity = identityInput?.key ? identityInput : resolveIdentity(identityInput || {});
    const nextKey = storageKey(identity);
    const changed = nextKey !== activeStorageKey;
    activeIdentity = identity;
    activeStorageKey = nextKey;
    activeContext = sanitizeContext(GM_getValue(activeStorageKey, null), identity);
    if (changed) installRemoteListener();
    emit(changed ? "identity" : "activate");
    return clone(activeContext);
  }

  function current() {
    if (!activeContext) activate();
    return clone(activeContext);
  }

  function persist(reason) {
    if (!activeContext || !activeStorageKey) activate();
    activeContext.updatedAt = Date.now();
    GM_setValue(activeStorageKey, clone(activeContext));
    emit(reason);
    return clone(activeContext);
  }

  function mergeIdentity(patch = {}) {
    if (!activeContext) activate();
    const merged = resolveIdentity({ ...activeContext.identity, ...patch });
    if (merged.key !== activeIdentity.key) return activate(merged);
    activeIdentity = merged;
    activeContext.identity = { ...activeContext.identity, ...merged };
    return persist("identity-merge");
  }

  function writeSource(sourceId, data, meta = {}) {
    if (!activeContext) activate(meta.identity || null);
    const source = text(sourceId);
    if (!source) throw new Error("sourceId is required");
    const capturedAt = Number(meta.capturedAt || Date.now());
    activeContext.sources[source] = {
      state: meta.state || "ready",
      data: clone(data || {}),
      source,
      action: text(meta.action || currentAction()),
      href: text(meta.href || location.href),
      capturedAt,
      pageId: PAGE_ID,
      parser: text(meta.parser || ""),
      confidence: text(meta.confidence || "")
    };
    if (meta.identity) activeContext.identity = { ...activeContext.identity, ...meta.identity };
    return persist(`source:${source}`);
  }

  function writeTechnology(value = {}, meta = {}) {
    if (!activeContext) activate(meta.identity || null);
    activeContext.technology = {
      ...activeContext.technology,
      ...clone(value),
      capturedAt: Number(meta.capturedAt || Date.now()),
      pageId: PAGE_ID,
      source: text(meta.source || value.source || activeContext.technology.source)
    };
    return persist("technology");
  }

  function clearSource(sourceId) {
    if (!activeContext) activate();
    delete activeContext.sources[text(sourceId)];
    return persist(`clear:${sourceId}`);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function sourceState(sourceId) {
    const snapshot = current().sources?.[sourceId] || null;
    if (!snapshot) return {
      state: "missing",
      label: "Не проверено",
      snapshot: null,
      currentPage: false
    };
    const currentPage = snapshot.pageId === PAGE_ID;
    const date = new Date(Number(snapshot.capturedAt || 0));
    const stamp = Number.isFinite(date.getTime())
      ? date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "время неизвестно";
    return {
      state: snapshot.state || "ready",
      label: currentPage ? `Получено сейчас · ${stamp}` : `Сохранено · ${stamp}`,
      snapshot,
      currentPage
    };
  }

  const api = Object.freeze({
    ready: Promise.resolve(true),
    pageId: PAGE_ID,
    currentAction,
    resolveIdentity,
    activate,
    current,
    mergeIdentity,
    writeSource,
    writeTechnology,
    clearSource,
    sourceState,
    subscribe
  });

  globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__ = api;
  activate();
})();
