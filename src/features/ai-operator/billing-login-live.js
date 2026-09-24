'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);

const LOGIN_RE = /^(?=.{3,64}$)(?=.*[A-Za-z])[A-Za-z][A-Za-z0-9._-]*$/;
const EXCLUDED_LOGIN_WORDS = new Set([
  'internet', 'wifi', 'wi-fi', 'router', 'balance', 'tariff', 'speed',
  'help', 'hello', 'privet', 'test', 'online', 'offline'
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

async function executeLoginSearch(tabId, login) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [login],
    func: async requestedLogin => {
      const allowedHost = /^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname);
      if (!allowedHost) return { ok: false, code: 'BILLING_TAB_INVALID' };

      const compact = (value, max = 500) => {
        const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
      };
      const input = (doc, name) => compact(doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '', 240);
      const authPage = doc => Boolean(doc.querySelector('input[type="password"]'));
      const decodeResponseHtml = async response => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = String(response.headers.get('content-type') || '');
        const headerCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || '';
        const head = new TextDecoder('windows-1252').decode(bytes.slice(0, 8192));
        const metaCharset = head.match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1] || '';
        const charset = String(headerCharset || metaCharset || 'windows-1251').toLowerCase();
        const labels = charset.includes('utf') ? ['utf-8'] : [charset, 'windows-1251', 'utf-8'];
        for (const label of labels) {
          try { return new TextDecoder(label).decode(bytes); } catch {}
        }
        return new TextDecoder('utf-8').decode(bytes);
      };
      const fetchDoc = async url => {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
        const html = await decodeResponseHtml(response);
        return {
          ok: response.ok,
          status: response.status,
          url: new URL(response.url || url, location.origin),
          doc: new DOMParser().parseFromString(html, 'text/html')
        };
      };
      const makeUrl = params => {
        const url = new URL('/cgi-bin/adm/adm.pl', location.origin);
        for (const [key, value] of Object.entries(params || {})) {
          if (value === null || value === undefined || value === '') continue;
          url.searchParams.set(key, String(value));
        }
        return url;
      };

      const current = new URL(location.href);
      let pp = compact(current.searchParams.get('pp') || '', 200);
      let uu = compact(current.searchParams.get('uu') || '', 80);
      if (!pp) pp = compact(document.querySelector('input[name="pp"]')?.value || '', 200);
      if (!uu) uu = compact(document.querySelector('input[name="uu"]')?.value || '', 80);
      if (!pp) return { ok: false, code: 'BILLING_SESSION_REQUIRED' };

      // Native Billing free-text search. SIMNET login matching is case-insensitive;
      // the classifier supplies a normalized lowercase login in name=.
      const searchUrl = makeUrl({ pp, ...(uu ? { uu } : {}), a: 'listuser', f: 'n', name: requestedLogin });
      const searchPage = await fetchDoc(searchUrl);
      if (!searchPage.ok) return { ok: false, code: 'BILLING_SEARCH_FAILED', status: searchPage.status };
      if (authPage(searchPage.doc)) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };

      const ids = new Map();
      const addCandidate = (id, rowText = '') => {
        const normalizedId = String(id || '').replace(/\D+/g, '').slice(0, 12);
        if (!normalizedId) return;
        if (!ids.has(normalizedId)) ids.set(normalizedId, compact(rowText, 800));
      };
      if (String(searchPage.url.searchParams.get('a') || '').toLowerCase() === 'user') {
        addCandidate(searchPage.url.searchParams.get('id') || '', searchPage.doc.body?.textContent || '');
      }
      for (const link of searchPage.doc.querySelectorAll('a[href]')) {
        try {
          const target = new URL(link.getAttribute('href') || '', searchPage.url);
          if (String(target.searchParams.get('a') || '').toLowerCase() !== 'user') continue;
          addCandidate(target.searchParams.get('id') || '', link.closest('tr')?.textContent || link.textContent || '');
        } catch {}
      }

      if (!ids.size) return { ok: true, code: 'NOT_FOUND', candidates: [] };
      const candidates = [];
      for (const billingId of [...ids.keys()].slice(0, 8)) {
        try {
          const page = await fetchDoc(makeUrl({ pp, ...(uu ? { uu } : {}), a: 'user', id: billingId }));
          if (!page.ok || authPage(page.doc)) continue;
          const actualLogin = input(page.doc, 'name');
          candidates.push({
            billingId,
            contract: input(page.doc, 'contract'),
            login: actualLogin || String(requestedLogin || ''),
            fullName: input(page.doc, 'fio'),
            address: '',
            ip: input(page.doc, 'ip'),
            connectionFamily: '',
            resultText: ids.get(billingId) || ''
          });
        } catch {}
      }

      return { ok: true, code: candidates.length ? 'OK' : 'NOT_FOUND', candidates };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_SEARCH_NO_RESULT' };
}

export async function searchBillingLoginLive({ login } = {}) {
  const normalizedLogin = classifyStandaloneBillingLogin(login);
  if (!normalizedLogin) return { ok: false, code: 'IDENTITY_QUERY_REQUIRED', candidates: [] };
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) {
    return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE', candidates: [] };
  }
  const tabs = await billingTabs();
  if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED', candidates: [] };

  let last = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    try {
      const outcome = await executeLoginSearch(tab.id, normalizedLogin);
      last = outcome;
      if (outcome?.ok || !['BILLING_SESSION_REQUIRED', 'BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID'].includes(String(outcome?.code || ''))) {
        return { ...outcome, request: { mode: 'login', value: normalizedLogin }, tabId: tab.id, source: 'billing-live-read-only' };
      }
    } catch (error) {
      last = { ok: false, code: 'BILLING_SEARCH_EXECUTION_FAILED', message: clean(error?.message || error, 500) };
    }
  }
  return { ...(last || { ok: false, code: 'BILLING_SESSION_REQUIRED' }), request: { mode: 'login', value: normalizedLogin }, source: 'billing-live-read-only' };
}