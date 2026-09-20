'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);
const PAYMENTS_SELECTOR = '#my_x_16';
const CACHE = new Map();

function clean(value, max = 700) {
  const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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

async function executeRead(tabId, id) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [id, PAYMENTS_SELECTOR],
    func: async (targetBillingId, paymentsSelector) => {
      const allowedHost = /^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname);
      if (!allowedHost) return { ok: false, code: 'BILLING_TAB_INVALID' };

      const compact = (value, max = 700) => {
        const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
      };
      const parsePayments = root => {
        const table = root?.querySelector?.(paymentsSelector);
        if (!table) return null;
        return [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].map(row => {
          const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
          return {
            date: compact(cells[0]?.textContent || '', 80),
            description: compact(cells[1]?.textContent || '', 220),
            amount: compact(cells[2]?.textContent || '', 100)
          };
        }).filter(item => item.date || item.description || item.amount).slice(0, 12);
      };
      const pageBillingId = () => {
        try {
          const current = new URL(location.href);
          if ((current.searchParams.get('a') || '') !== 'user') return '';
          return String(current.searchParams.get('id') || '').replace(/\D+/g, '').slice(0, 12);
        } catch { return ''; }
      };
      if (pageBillingId() === String(targetBillingId)) {
        const payments = parsePayments(document);
        if (payments) return { ok: true, code: 'OK', payments, transport: 'dom', endpoint: 'current-document' };
      }

      const decodeResponseHtml = async response => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = String(response.headers.get('content-type') || '');
        const headerCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || '';
        const head = new TextDecoder('windows-1252').decode(bytes.slice(0, 8192));
        const metaCharset = head.match(/charset\s*=\s*["']?\s*([a-z0-9._-]+)/i)?.[1] || '';
        const declared = String(headerCharset || metaCharset || '').toLowerCase();
        const charset = /^(?:windows-1251|win-?1251|cp1251)$/i.test(declared)
          ? 'windows-1251'
          : /^(?:utf-?8)$/i.test(declared) ? 'utf-8' : declared || 'utf-8';
        try { return new TextDecoder(charset).decode(bytes); }
        catch { return new TextDecoder('utf-8').decode(bytes); }
      };
      const authPage = doc => Boolean(doc.querySelector('input[type="password"]'));

      let pp = '';
      let uu = '';
      try {
        const current = new URL(location.href);
        pp = current.searchParams.get('pp') || '';
        uu = current.searchParams.get('uu') || '';
      } catch {}
      if (!pp) pp = compact(document.querySelector('input[name="pp"]')?.value || '', 200);
      if (!uu) uu = compact(document.querySelector('input[name="uu"]')?.value || '', 80);
      if (!pp) return { ok: false, code: 'BILLING_SESSION_REQUIRED' };

      const url = new URL('/cgi-bin/adm/adm.pl', location.origin);
      url.searchParams.set('pp', pp);
      if (uu) url.searchParams.set('uu', uu);
      url.searchParams.set('a', 'user');
      url.searchParams.set('id', String(targetBillingId));

      const response = await fetch(url.href, { method: 'GET', credentials: 'include', cache: 'no-store' });
      const html = await decodeResponseHtml(response);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!response.ok) return { ok: false, code: 'BILLING_PAYMENTS_FETCH_FAILED', status: response.status };
      if (authPage(doc)) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };
      const payments = parsePayments(doc);
      if (!payments) return { ok: false, code: 'BILLING_PAYMENTS_TABLE_NOT_FOUND', selector: paymentsSelector };
      return { ok: true, code: 'OK', payments, transport: 'fetch', endpoint: '/cgi-bin/adm/adm.pl?a=user&id=<billingId>' };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_PAYMENTS_NO_RESULT' };
}

export async function readBillingPaymentsLive({ billingId: rawBillingId, refresh = false, maxAgeMs = 120000 } = {}) {
  const id = billingId(rawBillingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED' };
  const cached = CACHE.get(id);
  const age = cached ? Date.now() - Number(cached.cachedAt || 0) : Infinity;
  if (!refresh && cached?.result?.ok && age < Math.max(1000, Number(maxAgeMs) || 120000)) {
    return { ...cached.result, cache: 'hit' };
  }
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) {
    return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE' };
  }
  const tabs = await billingTabs();
  if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED' };

  let last = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    try {
      const outcome = await executeRead(tab.id, id);
      last = outcome;
      if (outcome?.ok) {
        const result = {
          ...outcome,
          billingId: id,
          tabId: tab.id,
          observedAt: new Date().toISOString(),
          source: 'billing-payments-live-read-only',
          cache: 'miss'
        };
        CACHE.set(id, { cachedAt: Date.now(), result });
        return result;
      }
      if (!['BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID', 'BILLING_SESSION_REQUIRED'].includes(String(outcome?.code || ''))) break;
    } catch (error) {
      last = { ok: false, code: 'BILLING_PAYMENTS_EXECUTION_FAILED', message: clean(error?.message || error, 500) };
    }
  }
  return { ...(last || { ok: false, code: 'BILLING_PAYMENTS_READ_FAILED' }), billingId: id, source: 'billing-payments-live-read-only' };
}

export const BILLING_PAYMENTS_SELECTOR = PAYMENTS_SELECTOR;
