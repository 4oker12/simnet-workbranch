'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);
const HISTORY_READ_MESSAGE = 'SIMNET_AI_BILLING_HISTORY_READ_V1';
const BILLING_CAPTURE_SCRIPT = 'src/features/ai-operator/billing-snapshot-capture.js';
const RETRYABLE_CODES = new Set([
  'BILLING_SESSION_REQUIRED',
  'BILLING_AUTH_REQUIRED',
  'BILLING_TAB_INVALID',
  'BILLING_HISTORY_EXECUTION_FAILED',
  'BILLING_CONTENT_BRIDGE_UNAVAILABLE'
]);

function clean(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function billingId(value) {
  const id = String(value == null ? '' : value).replace(/\D+/g, '').slice(0, 12);
  return /^\d{1,12}$/.test(id) ? id : '';
}
function rankTabs(tabs = []) {
  return [...tabs].sort((a, b) => {
    const activeDelta = Number(Boolean(b?.active)) - Number(Boolean(a?.active));
    if (activeDelta) return activeDelta;
    return Number(b?.lastAccessed || 0) - Number(a?.lastAccessed || 0);
  });
}
async function billingTabs() {
  if (!globalThis.chrome?.tabs?.query) return [];
  return rankTabs(await chrome.tabs.query({ url: [...BILLING_TAB_URLS] }));
}
async function sendHistoryRead(tabId, request) {
  return chrome.tabs.sendMessage(tabId, {
    type: HISTORY_READ_MESSAGE,
    request
  });
}
async function executeHistoryRead(tabId, request) {
  let initialBridgeError = '';
  try {
    const result = await sendHistoryRead(tabId, request);
    if (result && typeof result === 'object') return result;
    initialBridgeError = 'Billing history bridge returned an empty response';
  } catch (error) {
    initialBridgeError = clean(error?.message || error, 360);
  }

  if (!globalThis.chrome?.scripting?.executeScript) {
    return {
      ok: false,
      code: 'BILLING_CONTENT_BRIDGE_UNAVAILABLE',
      failurePhase: 'content-bridge-bootstrap',
      message: initialBridgeError || 'chrome.scripting.executeScript unavailable'
    };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [BILLING_CAPTURE_SCRIPT]
    });
    const retried = await sendHistoryRead(tabId, request);
    if (retried && typeof retried === 'object') {
      return {
        ...retried,
        bridgeRecovered: true,
        ...(initialBridgeError ? { initialBridgeError } : {})
      };
    }
    return {
      ok: false,
      code: 'BILLING_HISTORY_NO_RESULT',
      failurePhase: 'content-bridge-response',
      message: 'Current Billing history bridge returned an empty response after reinjection',
      initialBridgeError
    };
  } catch (error) {
    return {
      ok: false,
      code: 'BILLING_CONTENT_BRIDGE_UNAVAILABLE',
      failurePhase: 'content-bridge-reinject',
      message: clean(error?.message || error, 500),
      initialBridgeError
    };
  }
}

export async function readBillingHistoryLive({ billingId: rawBillingId, scope = 'all' } = {}) {
  const id = billingId(rawBillingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED', history: null };
  if (!globalThis.chrome?.tabs?.query || !globalThis.chrome?.tabs?.sendMessage) {
    return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE', history: null };
  }

  const tabs = await billingTabs();
  if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED', history: null };

  const request = {
    billingId: id,
    scope: String(scope || 'all').toLowerCase() === 'events' ? 'events' : 'all'
  };
  let last = null;
  let lastTabId = null;

  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    lastTabId = tab.id;
    try {
      const outcome = await executeHistoryRead(tab.id, request);
      last = outcome;
      if (outcome?.ok) {
        return {
          ...outcome,
          request,
          tabId: tab.id,
          source: 'billing-payshow-history-live-read-only'
        };
      }
      if (!RETRYABLE_CODES.has(String(outcome?.code || ''))) {
        return {
          ...outcome,
          request,
          tabId: tab.id,
          source: 'billing-payshow-history-live-read-only'
        };
      }
    } catch (error) {
      last = {
        ok: false,
        code: 'BILLING_HISTORY_EXECUTION_FAILED',
        failurePhase: 'billing-tab-loop',
        message: clean(error?.message || error, 500)
      };
    }
  }

  return {
    ...(last || { ok: false, code: 'BILLING_SESSION_REQUIRED', history: null }),
    request,
    ...(Number.isInteger(lastTabId) ? { tabId: lastTabId } : {}),
    source: 'billing-payshow-history-live-read-only'
  };
}
