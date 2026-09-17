'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);
const SUMMARY_SELECTOR = 'table.tbg1.nav3.width100';
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
    args: [id, SUMMARY_SELECTOR],
    func: async (targetBillingId, summarySelector) => {
      const allowedHost = /^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname);
      if (!allowedHost) return { ok: false, code: 'BILLING_TAB_INVALID' };

      const compact = (value, max = 700) => {
        const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
      };
      const money = value => {
        const match = compact(value, 160).replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
      };
      const rowValue = (root, patterns) => {
        for (const row of root?.querySelectorAll?.('tr') || []) {
          const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
          if (cells.length < 2) continue;
          const label = compact(cells[0]?.textContent || '', 260).toLowerCase();
          if (!patterns.some(pattern => pattern.test(label))) continue;
          return compact(cells[cells.length - 1]?.textContent || '', 500);
        }
        return '';
      };
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
        let html = '';
        try { html = new TextDecoder(charset).decode(bytes); }
        catch { html = new TextDecoder('utf-8').decode(bytes); }
        if (html.includes('\uFFFD') && charset !== 'windows-1251') {
          const legacy = new TextDecoder('windows-1251').decode(bytes);
          const replacementCount = value => (String(value).match(/\uFFFD/g) || []).length;
          if (replacementCount(legacy) < replacementCount(html)) html = legacy;
        }
        return html;
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
      if (!response.ok) return { ok: false, code: 'BILLING_SUMMARY_FETCH_FAILED', status: response.status };
      if (authPage(doc)) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };

      const table = doc.querySelector(summarySelector);
      if (!table) return { ok: false, code: 'BILLING_SUMMARY_TABLE_NOT_FOUND', selector: summarySelector };

      const tariffDisplay = rowValue(table, [/^тарифи\s+на\s+інтернет/i, /^тарифы\s+на\s+интернет/i]);
      const tariffMatch = tariffDisplay.match(/^\[(\d+)\]\s*(.+)$/);
      const currentTariff = compact(tariffMatch?.[2] || tariffDisplay, 260);
      const tariffId = compact(tariffMatch?.[1] || '', 40);
      const price = money(rowValue(table, [/^ціна,?\s*грн/i, /^цена,?\s*грн/i]));
      const totalDue = money(rowValue(table, [/^разом\s+до\s+сплати/i, /^итого\s+к\s+оплате/i]));
      const accountBalance = money(rowValue(table, [/^на\s+счету,?\s*грн/i, /^на\s+рахунку,?\s*грн/i]));
      const balanceAfterTariff = money(rowValue(table, [
        /на\s+счете\s+с\s+учетом\s+стоимости\s+тарифного\s+плана/i,
        /на\s+рахунку\s+з\s+урахуванням\s+вартості\s+тарифного\s+плану/i
      ]));
      const balanceWithoutTemporary = money(rowValue(table, [
        /на\s+счете\s+без\s+учета\s+временных\s+платежей/i,
        /на\s+рахунку\s+без\s+урахування\s+тимчасових\s+платежів/i
      ]));

      return {
        ok: true,
        code: 'OK',
        data: {
          service: { currentTariff, tariffId, tariffDisplay },
          finance: {
            accountBalance,
            price,
            totalDue,
            balanceAfterTariff,
            balanceWithoutTemporary,
            priceSemantics: 'internet_tariff_price_from_main_summary_table',
            totalDueSemantics: 'current_total_due_from_main_summary_table_not_future_charge'
          },
          network: {
            trafficIncomingBytes: rowValue(table, [/^інтернет\s+входящий,?\s*байт/i, /^интернет\s+входящий,?\s*байт/i]),
            trafficOutgoingBytes: rowValue(table, [/^інтернет\s+исходящий,?\s*байт/i, /^интернет\s+исходящий,?\s*байт/i]),
            uaixIncomingBytes: rowValue(table, [/^ua-ix\s+входящий,?\s*байт/i]),
            uaixOutgoingBytes: rowValue(table, [/^ua-ix\s+исходящий,?\s*байт/i])
          },
          evidence: {
            source: 'billing-main-summary-live-read-only',
            endpoint: '/cgi-bin/adm/adm.pl?a=user&id=<billingId>',
            selector: summarySelector
          }
        }
      };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_SUMMARY_NO_RESULT' };
}

export async function readBillingSummaryLive({ billingId: rawBillingId, refresh = false, maxAgeMs = 30000 } = {}) {
  const id = billingId(rawBillingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED' };
  const cached = CACHE.get(id);
  const age = cached ? Date.now() - Number(cached.cachedAt || 0) : Infinity;
  if (!refresh && cached?.result?.ok && age < Math.max(1000, Number(maxAgeMs) || 30000)) {
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
          source: 'billing-main-summary-live-read-only',
          cache: 'miss'
        };
        CACHE.set(id, { cachedAt: Date.now(), result });
        return result;
      }
      if (!['BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID', 'BILLING_SESSION_REQUIRED'].includes(String(outcome?.code || ''))) break;
    } catch (error) {
      last = { ok: false, code: 'BILLING_SUMMARY_EXECUTION_FAILED', message: clean(error?.message || error, 500) };
    }
  }
  return { ...(last || { ok: false, code: 'BILLING_SUMMARY_READ_FAILED' }), billingId: id, source: 'billing-main-summary-live-read-only' };
}

export const BILLING_MAIN_SUMMARY_SELECTOR = SUMMARY_SELECTOR;
