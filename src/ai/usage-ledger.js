const LEDGER_KEY = 'simnet_workbench_ai_usage_ledger_v1';
const SESSION_KEY = 'simnet_workbench_ai_sessions_v1';
const ANALYSIS_KEY = 'simnet_workbench_call_ai_analysis_v1';
const SCHEMA_VERSION = 1;

let writeQueue = Promise.resolve();

function normalizeUsage(raw = {}) {
  const promptTokens = Math.max(0, Number(raw?.prompt_tokens ?? raw?.promptTokens ?? 0) || 0);
  const completionTokens = Math.max(0, Number(raw?.completion_tokens ?? raw?.completionTokens ?? 0) || 0);
  const reportedTotal = Math.max(0, Number(raw?.total_tokens ?? raw?.totalTokens ?? 0) || 0);
  const totalTokens = reportedTotal || promptTokens + completionTokens;
  const requests = Math.max(0, Number(raw?.requests ?? 0) || 0);
  return { promptTokens, completionTokens, totalTokens, requests };
}

function plus(left = {}, right = {}) {
  const a = normalizeUsage(left);
  const b = normalizeUsage(right);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    requests: a.requests + b.requests
  };
}

function positiveDelta(current = {}, previous = {}) {
  const now = normalizeUsage(current);
  const old = normalizeUsage(previous);
  return {
    promptTokens: Math.max(0, now.promptTokens - old.promptTokens),
    completionTokens: Math.max(0, now.completionTokens - old.completionTokens),
    totalTokens: Math.max(0, now.totalTokens - old.totalTokens),
    requests: Math.max(0, now.requests - old.requests)
  };
}

function hasUsage(value = {}) {
  const row = normalizeUsage(value);
  return Boolean(row.totalTokens || row.promptTokens || row.completionTokens || row.requests);
}

function sumSessionUsage(store = {}) {
  const bySession = {};
  let total = normalizeUsage();
  for (const [key, session] of Object.entries(store && typeof store === 'object' ? store : {})) {
    const usage = normalizeUsage(session?.usage || {});
    bySession[key] = usage;
    total = plus(total, usage);
  }
  return { total, bySession };
}

function sumAnalysisUsage(store = {}) {
  const entries = store?.entries && typeof store.entries === 'object' ? store.entries : {};
  let total = normalizeUsage();
  const seen = new Set();
  for (const [key, entry] of Object.entries(entries)) {
    const analysis = entry?.analysis || {};
    const usage = normalizeUsage(analysis?.usage || entry?.usage || {});
    if (!hasUsage(usage)) continue;
    const fingerprint = [
      entry?.cacheKey || key,
      entry?.createdAt || analysis?.processedAt || '',
      usage.promptTokens,
      usage.completionTokens,
      usage.totalTokens
    ].join('|');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    total = plus(total, { ...usage, requests: usage.requests || 1 });
  }
  return total;
}

function normalizeLedger(raw = {}) {
  const bySource = raw?.bySource && typeof raw.bySource === 'object' ? raw.bySource : {};
  const companionSeen = raw?.companionSeen && typeof raw.companionSeen === 'object' ? raw.companionSeen : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    total: normalizeUsage(raw?.total || {}),
    bySource: {
      companion: normalizeUsage(bySource.companion || {}),
      callAnalysis: normalizeUsage(bySource.callAnalysis || {}),
      transcriptQa: normalizeUsage(bySource.transcriptQa || {})
    },
    companionSeen,
    initializedAt: String(raw?.initializedAt || ''),
    updatedAt: String(raw?.updatedAt || '')
  };
}

async function initialLedger() {
  const row = await chrome.storage.local.get([LEDGER_KEY, SESSION_KEY, ANALYSIS_KEY]);
  const existing = row?.[LEDGER_KEY];
  if (existing && typeof existing === 'object') return normalizeLedger(existing);

  const companion = sumSessionUsage(row?.[SESSION_KEY] || {});
  const callAnalysis = sumAnalysisUsage(row?.[ANALYSIS_KEY] || {});
  const now = new Date().toISOString();
  const ledger = normalizeLedger({
    total: plus(companion.total, callAnalysis),
    bySource: {
      companion: companion.total,
      callAnalysis,
      transcriptQa: normalizeUsage()
    },
    companionSeen: companion.bySession,
    initializedAt: now,
    updatedAt: now
  });
  await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
  return ledger;
}

function serial(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function syncCompanionUnlocked() {
  const ledger = await initialLedger();
  const row = await chrome.storage.local.get(SESSION_KEY);
  const current = sumSessionUsage(row?.[SESSION_KEY] || {});
  let delta = normalizeUsage();

  for (const [key, usage] of Object.entries(current.bySession)) {
    delta = plus(delta, positiveDelta(usage, ledger.companionSeen[key] || {}));
  }

  ledger.companionSeen = current.bySession;
  if (hasUsage(delta)) {
    ledger.bySource.companion = plus(ledger.bySource.companion, delta);
    ledger.total = plus(ledger.total, delta);
    ledger.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
  } else {
    // Keep the per-session baseline current after resets/removals without
    // subtracting already consumed tokens from the cumulative ledger.
    await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
  }
  return ledger;
}

export async function recordAiUsage(source, rawUsage = {}) {
  const usage = normalizeUsage(rawUsage);
  if (!hasUsage(usage)) return readAiUsageTotals();
  if (!usage.requests) usage.requests = 1;

  return serial(async () => {
    const ledger = await initialLedger();
    const key = source === 'transcript-qa' ? 'transcriptQa' : source === 'call-analysis' ? 'callAnalysis' : 'companion';
    ledger.bySource[key] = plus(ledger.bySource[key], usage);
    ledger.total = plus(ledger.total, usage);
    ledger.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
    return normalizeLedger(ledger);
  });
}

export async function readAiUsageTotals() {
  return serial(async () => {
    const ledger = await syncCompanionUnlocked();
    return {
      ...normalizeUsage(ledger.total),
      bySource: {
        companion: normalizeUsage(ledger.bySource.companion),
        callAnalysis: normalizeUsage(ledger.bySource.callAnalysis),
        transcriptQa: normalizeUsage(ledger.bySource.transcriptQa)
      },
      updatedAt: ledger.updatedAt,
      initializedAt: ledger.initializedAt
    };
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[SESSION_KEY]) return;
  void serial(syncCompanionUnlocked).catch(() => {});
});

export const AI_USAGE_LEDGER_KEY = LEDGER_KEY;
