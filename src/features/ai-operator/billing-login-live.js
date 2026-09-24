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
  'BILLING_SEARCH_EXECUTION_FAILED'
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

async function executeExactIdentitySearch(tabId, request) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [request],
    func: async lookupRequest => {
      const allowedHost = /^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname);
      if (!allowedHost) return { ok: false, code: 'BILLING_TAB_INVALID' };

      const compact = (value, max = 500) => {
        const normalized = String(value == null ? '' : value)
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
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
        const response = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store' });
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
      const candidateIds = (page, ids) => {
        const add = (id, rowText = '') => {
          const normalizedId = String(id || '').replace(/\D+/g, '').slice(0, 12);
          if (!normalizedId || ids.has(normalizedId)) return;
          ids.set(normalizedId, compact(rowText, 800));
        };
        if (String(page.url.searchParams.get('a') || '').toLowerCase() === 'user') {
          add(page.url.searchParams.get('id') || '', page.doc.body?.textContent || '');
        }
        for (const link of page.doc.querySelectorAll('a[href]')) {
          try {
            const target = new URL(link.getAttribute('href') || '', page.url);
            if (String(target.searchParams.get('a') || '').toLowerCase() !== 'user') continue;
            add(target.searchParams.get('id') || '', link.closest('tr')?.textContent || link.textContent || '');
          } catch {}
        }
      };
      const identityMatches = ({ login, contract }) => {
        if (lookupRequest.mode === 'login') {
          const actual = compact(login, 80);
          return !actual || actual.toLowerCase() === String(lookupRequest.value || '').toLowerCase();
        }
        if (lookupRequest.mode === 'contract') {
          const actual = compact(contract, 80).replace(/\D+/g, '');
          const requested = String(lookupRequest.value || '').replace(/\D+/g, '');
          return !actual || actual === requested;
        }
        return false;
      };

      const current = new URL(location.href);
      let pp = compact(current.searchParams.get('pp') || '', 200);
      let uu = compact(current.searchParams.get('uu') || '', 80);
      if (!pp) pp = compact(document.querySelector('input[name="pp"]')?.value || '', 200);
      if (!uu) uu = compact(document.querySelector('input[name="uu"]')?.value || '', 80);
      if (!pp) return { ok: false, code: 'BILLING_SESSION_REQUIRED' };

      const base = { pp, ...(uu ? { uu } : {}), a: 'listuser', f: 'n', name: lookupRequest.value };
      const attempts = [
        makeUrl(base),
        makeUrl({ ...base, what_search: lookupRequest.mode })
      ];
      const ids = new Map();
      let lastStatus = 0;

      for (const searchUrl of attempts) {
        const searchPage = await fetchDoc(searchUrl);
        lastStatus = searchPage.status;
        if (!searchPage.ok) continue;
        if (authPage(searchPage.doc)) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };
        candidateIds(searchPage, ids);
        if (ids.size) break;
      }

      if (!ids.size) {
        if (lastStatus && lastStatus >= 400) return { ok: false, code: 'BILLING_SEARCH_FAILED', status: lastStatus };
        return { ok: true, code: 'NOT_FOUND', candidates: [] };
      }

      const candidates = [];
      for (const billingId of [...ids.keys()].slice(0, 8)) {
        try {
          const page = await fetchDoc(makeUrl({ pp, ...(uu ? { uu } : {}), a: 'user', id: billingId }));
          if (!page.ok || authPage(page.doc)) continue;

          const candidate = {
            billingId,
            contract: input(page.doc, 'contract'),
            login: input(page.doc, 'name'),
            fullName: input(page.doc, 'fio'),
            address: '',
            ip: input(page.doc, 'ip'),
            connectionFamily: '',
            resultText: ids.get(billingId) || ''
          };
          if (!identityMatches(candidate)) continue;
          candidates.push(candidate);
        } catch {}
      }

      return { ok: true, code: candidates.length ? 'OK' : 'NOT_FOUND', candidates };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_SEARCH_NO_RESULT' };
}

export async function searchBillingExactIdentityLive(args = {}) {
  const request = classifyBillingExactIdentity(args);
  if (!request) return { ok: false, code: 'IDENTITY_QUERY_REQUIRED', candidates: [] };
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) {
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
