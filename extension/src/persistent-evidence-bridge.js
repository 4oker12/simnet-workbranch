"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_PERSISTENT_EVIDENCE_BRIDGE__) return;

  const baseCore = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!baseCore?.getState || !baseCore?.subscribe) return;

  const VERSION = "0.1.3";
  const STORAGE_KEY = "simnet_wb_verified_evidence_v2";
  const EVIDENCE_TTL_MS = 30 * 60 * 1000;
  const listeners = new Set();

  let cache = {};
  let cacheLoaded = false;
  let lastRawState = null;
  let lastMergedState = null;
  let persistTimer = 0;
  let lastPersistedJson = "";

  const clone = value => {
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value ?? null)); }
  };

  const safe = (value, max = 300) => String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

  function identityKeys(context = {}) {
    const keys = [];
    const contract = safe(context.contract, 80).toLowerCase();
    const billingId = safe(context.billingId, 80);
    const customerId = safe(context.customerId, 80);
    const host = safe(context.hostname || location.hostname, 160).toLowerCase();

    if (/^abon\d{3,14}$/i.test(contract)) keys.push(`contract:${contract}`);
    if (billingId) keys.push(`billing:${host}:${billingId}`);
    if (customerId) keys.push(`userside:${host}:${customerId}`);
    return [...new Set(keys)];
  }

  function isFresh(entry) {
    return Boolean(entry?.observedAt && Date.now() - Number(entry.observedAt) <= EVIDENCE_TTL_MS);
  }

  function resolvedSession(session) {
    return Boolean(
      session?.resolved === true
      && (session.status === "active" || session.status === "absent")
    );
  }

  function verifiedLine(line) {
    return line?.polled === true;
  }

  function findRecord(context) {
    for (const key of identityKeys(context)) {
      const record = cache[key];
      if (record && typeof record === "object") return clone(record);
    }
    return null;
  }

  function newestEvidenceEntry(left, right) {
    if (!left) return right ? clone(right) : null;
    if (!right) return clone(left);
    return Number(right.observedAt || 0) >= Number(left.observedAt || 0)
      ? clone(right)
      : clone(left);
  }

  function mergeRecords(left = {}, right = {}) {
    return {
      ...left,
      ...right,
      version: Math.max(Number(left.version || 1), Number(right.version || 1)),
      aliases: [...new Set([...(left.aliases || []), ...(right.aliases || [])])],
      session: newestEvidenceEntry(left.session, right.session),
      line: newestEvidenceEntry(left.line, right.line),
      updatedAt: Math.max(Number(left.updatedAt || 0), Number(right.updatedAt || 0))
    };
  }

  function mergeCaches(left = {}, right = {}) {
    const merged = {};
    for (const key of new Set([...Object.keys(left || {}), ...Object.keys(right || {})])) {
      merged[key] = mergeRecords(left?.[key], right?.[key]);
    }
    return merged;
  }

  function evidenceFingerprint(entry) {
    try {
      return JSON.stringify({
        session: entry?.session?.evidence || null,
        line: entry?.line?.evidence || null,
        aliases: entry?.aliases || []
      });
    } catch (_) {
      return "";
    }
  }

  async function persistNow() {
    const json = JSON.stringify(cache);
    if (json === lastPersistedJson) return;
    lastPersistedJson = json;
    try {
      await chrome.storage.session.set({ [STORAGE_KEY]: cache });
    } catch (_) {
      try { await chrome.storage.local.set({ [STORAGE_KEY]: cache }); } catch (_) {}
    }
  }

  function schedulePersist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      void persistNow();
    }, 80);
  }

  function rememberVerifiedEvidence(rawState) {
    const state = rawState || {};
    const context = state.context || {};
    const keys = identityKeys(context);
    if (!keys.length) return;

    const currentSession = state.evidence?.session || null;
    const currentLine = state.evidence?.line || null;
    if (!resolvedSession(currentSession) && !verifiedLine(currentLine)) return;

    const existing = findRecord(context) || { version: 1, aliases: [] };
    const before = evidenceFingerprint(existing);
    const aliases = [...new Set([...(existing.aliases || []), ...keys])];
    const next = { ...existing, aliases, updatedAt: Date.now() };

    if (resolvedSession(currentSession)) {
      next.session = {
        evidence: clone(currentSession),
        observedAt: Date.now(),
        sourcePage: state.context?.kind || ""
      };
    }

    if (verifiedLine(currentLine)) {
      next.line = {
        evidence: clone(currentLine),
        observedAt: Date.now(),
        sourcePage: state.context?.kind || ""
      };
    }

    if (before === evidenceFingerprint(next)) return;
    for (const alias of aliases) cache[alias] = mergeRecords(cache[alias], next);
    schedulePersist();
  }

  function cachedSession(context) {
    const entry = findRecord(context)?.session;
    if (!isFresh(entry) || !resolvedSession(entry.evidence)) return null;
    return {
      ...clone(entry.evidence),
      cached: true,
      observedAt: Number(entry.observedAt),
      source: entry.evidence.source || "Juniper NEW: сохранённый подтверждённый результат"
    };
  }

  function cachedLine(context) {
    const entry = findRecord(context)?.line;
    if (!isFresh(entry) || !verifiedLine(entry.evidence)) return null;
    return {
      ...clone(entry.evidence),
      cached: true,
      observedAt: Number(entry.observedAt)
    };
  }

  function sessionAbsentAlert(session) {
    return {
      id: "session-absent",
      severity: "critical",
      title: "Juniper: статус offline",
      text: session.cached
        ? "Последняя подтверждённая проверка Juniper показала offline. Результат сохранён при переходе к опросу ONU."
        : "Активной сессии сейчас нет. Проверь ограничения Billing, авторизацию/BRAS и состояние ONU.",
      target: "session-status",
      source: "Juniper NEW"
    };
  }

  function mergePersistentEvidence(rawState) {
    const state = rawState || {};
    const context = state.context || {};
    const rawEvidence = state.evidence || {};
    const rawSession = rawEvidence.session || {};
    const rawLine = rawEvidence.line || {};

    const session = resolvedSession(rawSession)
      ? rawSession
      : cachedSession(context) || rawSession;
    const line = verifiedLine(rawLine)
      ? rawLine
      : cachedLine(context) || rawLine;

    const alerts = (Array.isArray(state.alerts) ? state.alerts : [])
      .filter(alert => alert?.id !== "session-absent");
    if (session?.status === "absent" && session?.resolved === true) {
      alerts.push(sessionAbsentAlert(session));
    }

    const checkpoints = {
      ...(state.checkpoints || {}),
      juniperOpened: Boolean(state.checkpoints?.juniperOpened || session?.opened || session?.resolved),
      sessionResolved: Boolean(state.checkpoints?.sessionResolved || resolvedSession(session)),
      sessionActive: session?.status === "active",
      onuPolled: Boolean(state.checkpoints?.onuPolled || verifiedLine(line))
    };

    return {
      ...state,
      evidence: {
        ...rawEvidence,
        session,
        line
      },
      checkpoints,
      alerts
    };
  }

  function publish(rawState) {
    lastRawState = rawState || baseCore.getState();
    rememberVerifiedEvidence(lastRawState);
    lastMergedState = mergePersistentEvidence(lastRawState);
    for (const listener of [...listeners]) {
      try { listener(clone(lastMergedState)); } catch (_) {}
    }
    return lastMergedState;
  }

  const persistentCore = {
    ...baseCore,
    version: "0.6.0",
    getState() {
      const raw = baseCore.getState();
      rememberVerifiedEvidence(raw);
      lastRawState = raw;
      lastMergedState = mergePersistentEvidence(raw);
      return clone(lastMergedState);
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      try { listener(persistentCore.getState()); } catch (_) {}
      return () => listeners.delete(listener);
    }
  };

  const unsubscribeBase = baseCore.subscribe(state => publish(state));

  async function loadCache() {
    let loaded = {};
    try {
      const result = await chrome.storage.session.get({ [STORAGE_KEY]: {} });
      loaded = result?.[STORAGE_KEY] || {};
    } catch (_) {
      try {
        const result = await chrome.storage.local.get({ [STORAGE_KEY]: {} });
        loaded = result?.[STORAGE_KEY] || {};
      } catch (_) {}
    }

    const stored = loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {};
    const storedJson = JSON.stringify(stored);
    cache = mergeCaches(stored, cache);
    lastPersistedJson = storedJson;
    cacheLoaded = true;
    if (JSON.stringify(cache) !== storedJson) schedulePersist();
    publish(lastRawState || baseCore.getState());
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!["session", "local"].includes(areaName)) return;
    const change = changes?.[STORAGE_KEY];
    if (!change || !change.newValue || typeof change.newValue !== "object") return;
    cache = mergeCaches(cache, change.newValue);
    lastPersistedJson = JSON.stringify(change.newValue);
    if (JSON.stringify(cache) !== lastPersistedJson) schedulePersist();
    if (cacheLoaded) publish(lastRawState || baseCore.getState());
  });

  globalThis.__SIMNET_WORKBENCH_CORE__ = persistentCore;
  globalThis.__SIMNET_PERSISTENT_EVIDENCE_BRIDGE__ = {
    version: VERSION,
    storageKey: STORAGE_KEY,
    identityKeys,
    resolvedSession,
    verifiedLine,
    mergeRecords,
    mergeCaches,
    mergePersistentEvidence,
    getCache: () => clone(cache)
  };

  window.addEventListener("pagehide", () => {
    window.clearTimeout(persistTimer);
    persistTimer = 0;
    void persistNow();
    listeners.clear();
    try { unsubscribeBase?.(); } catch (_) {}
  }, { once: true });

  void loadCache();
})();
