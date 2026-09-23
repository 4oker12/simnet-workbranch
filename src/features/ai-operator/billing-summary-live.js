'use strict';

import { normalizeBillingTariffSnapshot } from './billing-tariff-normalizer.js';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);
const SUMMARY_SELECTOR = 'table.tbg1.nav3.width100';
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
    args: [id, SUMMARY_SELECTOR, PAYMENTS_SELECTOR],
    func: async (targetBillingId, summarySelector, paymentsSelector) => {
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
      const selected = (root, name) => {
        const node = root?.querySelector?.(`select[name="${CSS.escape(name)}"]`);
        if (!node) return null;
        return compact(node.options?.[node.selectedIndex]?.textContent || node.value || '', 260);
      };
      const input = (root, name) => compact(root?.querySelector?.(`[name="${CSS.escape(name)}"]`)?.value || '', 260);
      const indexRows = root => {
        const byLabel = new Map();
        if (!root) return byLabel;
        const rows = root.querySelectorAll('tr');
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          const cells = row.querySelectorAll(':scope > td, :scope > th');
          if (!cells || cells.length < 2) continue;
          const label = compact(cells[0].textContent || '', 260).toLowerCase();
          if (!label) continue;
          const last = cells[cells.length - 1];
          const control = last.querySelector('select,input:not([type="hidden"]),textarea');
          const hiddenControls = [...last.querySelectorAll('input[type="hidden"]')]
            .map(node => compact(node.value || '', 500))
            .filter(Boolean);
          let value = '';
          if (control?.tagName === 'SELECT') value = compact(control.options?.[control.selectedIndex]?.textContent || control.value || '', 500);
          else if (control) value = compact(control.value || '', 500);
          else {
            value = compact(last.textContent || '', 500);
            // Billing stores some observed values (notably discount) only in a hidden
            // input. Use that value only when the row has no visible value, so
            // technical hidden ids cannot override normal Billing text/controls.
            if (!value && hiddenControls.length === 1) value = hiddenControls[0];
          }
          // Prefer the first non-empty value when Billing repeats a label.
          if (!byLabel.has(label) || (!byLabel.get(label) && value)) byLabel.set(label, value);
        }
        return byLabel;
      };
      const rowValueFromIndex = (index, patterns) => {
        for (const [label, value] of index) {
          if (patterns.some(pattern => pattern.test(label))) return value;
        }
        return '';
      };
      const readPayments = root => {
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
      const readActiveServices = root => [...root.querySelectorAll('input[type="checkbox"][name^="sr"]')]
        .filter(control => control.checked)
        .map(control => {
          const row = control.closest('tr');
          const cells = row ? [...row.querySelectorAll(':scope > td, :scope > th')] : [];
          const amountText = compact(cells.at(-1)?.textContent || '', 120);
          const nameCell = cells.find(cell => cell !== cells.at(-1) && compact(cell.textContent || '', 220));
          return {
            name: compact(nameCell?.textContent || control.name, 220).replace(/^услуга\s*/i, ''),
            amount: money(amountText),
            amountText
          };
        })
        .slice(0, 20);
      const parseMainPage = root => {
        const table = root?.querySelector?.(summarySelector);
        if (!table) return null;
        // The right summary table owns tariff/total rows, but "На счету, грн."
        // lives elsewhere on a=user. Index the whole page as an authoritative
        // fallback so current balance can never be confused with derived balances.
        const index = indexRows(table);
        const pageIndex = indexRows(root);
        const tariffDisplay = rowValueFromIndex(index, [/^тарифи\s+на\s+інтернет/i, /^тарифы\s+на\s+интернет/i]);
        const tariffMatch = tariffDisplay.match(/^\[(\d+)\]\s*(.+)$/);
        const currentTariff = compact(tariffMatch?.[2] || tariffDisplay || selected(root, 'paket') || '', 260);
        const tariffId = compact(tariffMatch?.[1] || '', 40);
        const nextTariffNode = root.querySelector('select[name="next_paket"]');
        const finance = {
          priceSemantics: 'internet_tariff_price_from_main_summary_table',
          totalDueSemantics: 'current_total_due_from_main_summary_table_not_future_charge'
        };
        const observedMoney = [
          ['accountBalance', rowValueFromIndex(pageIndex, [/^на\s+счету,?\s*грн/i, /^на\s+рахунку,?\s*грн/i])],
          ['price', rowValueFromIndex(index, [/^ціна,?\s*грн/i, /^цена,?\s*грн/i])],
          ['totalDue', rowValueFromIndex(index, [/^разом\s+до\s+сплати/i, /^итого\s+к\s+оплате/i])],
          ['balanceAfterTariff', rowValueFromIndex(index, [
            /на\s+счете\s+с\s+учетом\s+стоимости\s+тарифного\s+плана/i,
            /на\s+рахунку\s+з\s+урахуванням\s+вартості\s+тарифного\s+плану/i
          ])],
          ['balanceWithoutTemporary', rowValueFromIndex(pageIndex, [
            /на\s+счете\s+без\s+учета\s+временных\s+платежей/i,
            /на\s+рахунку\s+без\s+урахування\s+тимчасових\s+платежів/i
          ])]
        ];
        for (const [key, raw] of observedMoney) {
          const value = money(raw);
          // 0 is a real observed balance. A missing/unparseable row is omitted so
          // canonical runtime can mark it UNKNOWN and invoke broader fallback.
          if (Number.isFinite(value)) finance[key] = value;
        }
        const discountText = rowValueFromIndex(pageIndex, [
          /^скидк/i,
          /^знижк/i,
          /^discount/i
        ]);
        if (discountText) {
          finance.discountText = discountText;
          finance.discountSemantics = 'billing_observed_discount_field_raw_units_not_assumed';
        }
        return {
          identity: {
            billingId: String(targetBillingId),
            contract: input(root, 'contract'),
            login: input(root, 'name').toLowerCase()
          },
          service: {
            currentTariff,
            tariffId,
            tariffDisplay,
            nextTariff: nextTariffNode ? selected(root, 'next_paket') : null,
            nextTariffDelay: selected(root, 'next_paket_delay'),
            accessState: selected(root, 'state'),
            serviceState: selected(root, 'cstate'),
            group: selected(root, 'grp'),
            activeServices: readActiveServices(root)
          },
          finance,
          payments: readPayments(root),
          network: {
            trafficIncomingBytes: rowValueFromIndex(index, [/^інтернет\s+входящий,?\s*байт/i, /^интернет\s+входящий,?\s*байт/i]),
            trafficOutgoingBytes: rowValueFromIndex(index, [/^інтернет\s+исходящий,?\s*байт/i, /^интернет\s+исходящий,?\s*байт/i]),
            uaixIncomingBytes: rowValueFromIndex(index, [/^ua-ix\s+входящий,?\s*байт/i]),
            uaixOutgoingBytes: rowValueFromIndex(index, [/^ua-ix\s+исходящий,?\s*байт/i])
          }
        };
      };
      const currentPageMatches = () => {
        try {
          const current = new URL(location.href);
          return (current.searchParams.get('a') || '') === 'user'
            && String(current.searchParams.get('id') || '').replace(/\D+/g, '').slice(0, 12) === String(targetBillingId);
        } catch { return false; }
      };
      const decodeResponseHtml = async response => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = String(response.headers.get('content-type') || '');
        const headerCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || '';
        const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
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

      if (currentPageMatches()) {
        const data = parseMainPage(document);
        if (data) {
          return {
            ok: true,
            code: 'OK',
            data: {
              ...data,
              evidence: {
                source: 'billing-main-summary-live-read-only',
                endpoint: 'current-document',
                selector: summarySelector,
                transport: 'dom'
              }
            }
          };
        }
      }

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
      const data = parseMainPage(doc);
      if (!data) return { ok: false, code: 'BILLING_SUMMARY_TABLE_NOT_FOUND', selector: summarySelector };

      return {
        ok: true,
        code: 'OK',
        data: {
          ...data,
          evidence: {
            source: 'billing-main-summary-live-read-only',
            endpoint: '/cgi-bin/adm/adm.pl?a=user&id=<billingId>',
            selector: summarySelector,
            transport: 'fetch'
          }
        }
      };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_SUMMARY_NO_RESULT' };
}

export async function readBillingSummaryLive({ billingId: rawBillingId, refresh = false, maxAgeMs = 120000 } = {}) {
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
          data: normalizeBillingTariffSnapshot(outcome.data, { now: new Date() }),
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
