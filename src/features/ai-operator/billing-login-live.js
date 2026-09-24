'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);

const LOGIN_RE = /^(?=.{3,64}$)(?=.*[A-Za-z])[A-Za-z][A-Za-z0-9._-]*$/;
const CONTRACT_RE = /^\d{3,12}$/;
const EXCLUDED_LOGIN_WORDS = new Set([
  'internet', 'wifi', 'wi-fi', 'router', 'balance', 'tariff', 'speed',
  'help', 'hello', 'privet', 'test', 'online', 'offline'
]);
const RETRYABLE_TAB_CODES = new Set([
  'BILLING_SESSION_REQUIRED',
  'BILLING_AUTH_REQUIRED',
  'BILLING_TAB_INVALID',
  'BILLING_SEARCH_NO_RESULT',
  'BILLING_SEARCH_EXECUTION_FAILED',
  'BILLING_CONTENT_BRIDGE_UNAVAILABLE'
]);

function clean(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function classifyStandaloneBillingLogin(value) {
  const login = clean(value, 80).replace(/\s+/g, '');
  const normalized = login.toLowerCase();
  if (!login || EXCLUDED_LOGIN_WORDS.has(normalized)) return '';
  return LOGIN_RE.test(login) ? login : '';
}

export function classifyBillingExactIdentity({ login, contract } = {}) {
  const exactLogin = classifyStandaloneBillingLogin(login);
  if (exactLogin) return { mode: 'login', value: exactLogin };

  const exactContract = clean(contract, 80).replace(/\s+/g, '');
  if (CONTRACT_RE.test(exactContract)) return { mode: 'contract', value: exactContract };

  return null;
}

function rankBillingTabs(tabs = []) {
  return [...tabs].sort((a, b) => {
    const activeDelta = Number(Boolean(b?.active)) - Number(Boolean(a?.active));
    if (activeDelta) return activeDelta;
    return Number(b?.lastAccessed || 0) - Number(a?.lastAccessed || 0);
  });
}

async function billingTabs() {
  if (!globalThis.chrome?.tabs?.query) return [];
  return rankBillingTabs(await chrome.tabs.query({ url: [...BILLING_TAB_URLS] }));
}

const EXACT_LOOKUP_MESSAGE = 'SIMNET_AI_BILLING_EXACT_LOOKUP_V2';
const BILLING_CAPTURE_SCRIPT = 'src/features/ai-operator/billing-snapshot-capture.js';

async function sendExactLookup(tabId, request) {
  return chrome.tabs.sendMessage(tabId, {
    type: EXACT_LOOKUP_MESSAGE,
    request
  });
}

async function executeExactIdentitySearch(tabId, request) {
  try {
    const result = await sendExactLookup(tabId, request);
    if (result && typeof result === 'object') return result;
  } catch {}

  // Existing Billing tabs do not receive newly reloaded extension content scripts
  // automatically. Bootstrap the existing Billing bridge once, then retry.
  if (!globalThis.chrome?.scripting?.executeScript) {
    return { ok: false, code: 'BILLING_CONTENT_BRIDGE_UNAVAILABLE', candidates: [] };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [BILLING_CAPTURE_SCRIPT]
    });
    const retried = await sendExactLookup(tabId, request);
    return retried && typeof retried === 'object'
      ? retried
      : { ok: false, code: 'BILLING_SEARCH_NO_RESULT', candidates: [] };
  } catch (error) {
    return {
      ok: false,
      code: 'BILLING_CONTENT_BRIDGE_UNAVAILABLE',
      message: clean(error?.message || error, 500),
      candidates: []
    };
  }
}

export async function searchBillingExactIdentityLive(args = {}) {
  const request = classifyBillingExactIdentity(args);
  if (!request) return { ok: false, code: 'IDENTITY_QUERY_REQUIRED', candidates: [] };
  if (!globalThis.chrome?.tabs?.query || !globalThis.chrome?.tabs?.sendMessage) {
    return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE', candidates: [] };
  }

  const tabs = await billingTabs();
  if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED', candidates: [] };

  let last = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    try {
      const outcome = await executeExactIdentitySearch(tab.id, request);
      last = outcome;
      if (outcome?.ok) {
        return { ...outcome, request, tabId: tab.id, source: 'billing-live-read-only' };
      }
      if (!RETRYABLE_TAB_CODES.has(String(outcome?.code || ''))) {
        return { ...outcome, request, tabId: tab.id, source: 'billing-live-read-only' };
      }
    } catch (error) {
      last = { ok: false, code: 'BILLING_SEARCH_EXECUTION_FAILED', message: clean(error?.message || error, 500) };
    }
  }

  return {
    ...(last || { ok: false, code: 'BILLING_SESSION_REQUIRED' }),
    request,
    source: 'billing-live-read-only'
  };
}

export async function searchBillingLoginLive({ login } = {}) {
  return searchBillingExactIdentityLive({ login });
}
