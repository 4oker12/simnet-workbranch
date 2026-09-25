'use strict';

import { normalizeBillingTariffSnapshot } from './billing-tariff-normalizer.js';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);
const MAIN_FORM_SELECTOR = 'form#formedit > table.tbg1.width100';
const AUTH_SELECTOR = 'table.usrlist.width100';
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
    args: [id, MAIN_FORM_SELECTOR, AUTH_SELECTOR, SUMMARY_SELECTOR, PAYMENTS_SELECTOR],
    func: async (targetBillingId, mainFormSelector, authSelector, summarySelector, paymentsSelector) => {
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
      const selectedOption = (root, name) => {
        const node = root?.querySelector?.(`select[name="${CSS.escape(name)}"]`);
        if (!node) return null;
        const option = node.options?.[node.selectedIndex];
        return {
          value: compact(option?.value ?? node.value ?? '', 80),
          label: compact(option?.textContent || node.value || '', 260)
        };
      };
      const selected = (root, name) => selectedOption(root, name)?.label ?? null;
      const input = (root, name) => compact(root?.querySelector?.(`[name="${CSS.escape(name)}"]`)?.value || '', 260);
      const readRows = root => {
        if (!root?.querySelectorAll) return [];
        return [...root.querySelectorAll('tr')].map(row => {
          const cells = [...row.querySelectorAll(':scope > td, :scope > th')].map(cell => {
            const control = cell.querySelector('select,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea');
            let value = '';
            if (control?.tagName === 'SELECT') value = compact(control.options?.[control.selectedIndex]?.textContent || control.value || '', 500);
            else if (control) value = compact(control.value || '', 500);
            const text = control ? value : compact(cell.textContent || '', 500);
            if (!value) value = text;
            return { text, value };
          }).filter(cell => cell.text || cell.value);
          return { cells, text: compact(cells.map(cell => cell.value || cell.text).join(' '), 700) };
        }).filter(row => row.cells.length);
      };
      const indexRows = rows => {
        const byLabel = new Map();
        for (const row of Array.isArray(rows) ? rows : []) {
          if (row.cells.length < 2) continue;
          const label = compact(row.cells[0]?.text || '', 260).toLowerCase();
          if (!label) continue;
          const value = compact(row.cells.at(-1)?.value || row.cells.at(-1)?.text || '', 500);
          // Prefer the first non-empty value when Billing repeats a label.
          if (!byLabel.has(label) || (!byLabel.get(label) && value)) byLabel.set(label, value);
        }
        return byLabel;
      };
      const discountFromRows = rows => {
        const entries = [];
        let percent = null;
        let adjustmentUAH = null;
        for (const row of Array.isArray(rows) ? rows : []) {
          // Nested Billing tables mean a wrapper <tr> can contain the whole
          // tariff table text. Only a real direct label/value row is evidence.
          if (!Array.isArray(row.cells) || row.cells.length < 2) continue;
          const label = compact(row.cells[0]?.text || '', 260);
          if (!/^(?:скидк|знижк)/iu.test(label)) continue;
          const value = compact(row.cells.at(-1)?.value || row.cells.at(-1)?.text || '', 260);
          if (!value) continue;
          const numeric = money(value);
          const raw = compact(row.text || `${label} ${value}`, 700);
          entries.push({ label, value, raw });
          if (/%/u.test(label) && Number.isFinite(numeric)) percent = numeric;
          if (/грн/iu.test(label) && Number.isFinite(numeric)) adjustmentUAH = numeric;
        }
        if (!entries.length) return null;
        return {
          ...(Number.isFinite(percent) ? { percent } : {}),
          ...(Number.isFinite(adjustmentUAH) ? {
            amountUAH: Math.abs(adjustmentUAH),
            adjustmentUAH
          } : {}),
          entries
        };
      };
      const rowValueFromIndex = (index, patterns) => {
        for (const [label, value] of index) {
          if (patterns.some(pattern => pattern.test(label))) return value;
        }
        return '';
      };
      const readAuthorization = root => {
        const row = root?.querySelector?.(`${authSelector} tbody tr`);
        if (!row) return {};
        const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
        const title = compact(row.querySelector('img[title]')?.getAttribute('title') || '', 180);
        return {
          title,
          authorized: /авторизован/i.test(title) && !/не\s+авторизован/i.test(title),
          accessAllowed: /доступ\s+разреш/i.test(title),
          lastActivity: compact(cells[2]?.textContent || '', 80),
          billingId: compact(cells[3]?.textContent || '', 80),
          login: compact(cells[4]?.textContent || '', 80).toLowerCase(),
          ip: compact(cells[5]?.textContent || '', 80)
        };
      };
      const temporaryPaymentText = root => {
        const candidates = root?.querySelectorAll?.('.modified, .alert, .warning, font[color], b, strong') || [];
        let best = '';
        for (const node of candidates) {
          const value = compact(node.textContent || '', 260);
          if (value.length > 240 || value.length < 8) continue;
          if (!/временн(?:ый|ого)\s+плат[её]ж/i.test(value)) continue;
          if (!best || value.length < best.length) best = value;
        }
        return best;
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
        const mainForm = root?.querySelector?.(mainFormSelector);
        const summaryTable = root?.querySelector?.(summarySelector);
        if (!mainForm || !summaryTable) return null;

        // One a=user read produces one rich Billing main-page snapshot.
        // We parse the known data blocks completely, but never expand large
        // select catalogs: only each selected option enters the snapshot.
        const mainRows = readRows(mainForm);
        const summaryRows = readRows(summaryTable);
        const pageRows = readRows(root); // compatibility fallback for rare legacy rows outside known blocks
        const mainIndex = indexRows(mainRows);
        const summaryIndex = indexRows(summaryRows);
        const pageIndex = indexRows(pageRows);
        const rowFrom = (primary, fallback, patterns) =>
          rowValueFromIndex(primary, patterns) || rowValueFromIndex(fallback, patterns);

        const discount = discountFromRows(summaryRows) || discountFromRows(mainRows);
        if (discount) discount.appliesTo = 'internet_tariff';

        const tariffDisplay = rowValueFromIndex(summaryIndex, [/^тарифи\s+на\s+інтернет/i, /^тарифы\s+на\s+интернет/i]);
        const tariffMatch = tariffDisplay.match(/^\[(\d+)\]\s*(.+)$/);
        const currentTariffOption = selectedOption(root, 'paket');
        const nextTariffOption = selectedOption(root, 'next_paket');
        const groupOption = selectedOption(root, 'grp');
        const accessOption = selectedOption(root, 'state');
        const serviceStateOption = selectedOption(root, 'cstate');
        const tvTariffOption = selectedOption(root, 'paket3');
        const nextTvTariffOption = selectedOption(root, 'next_paket3');
        const discountRemoveOption = selectedOption(root, 'discount_remove');
        // The selected paket control is the configured/current internet package.
        // Access/service state (blocked, paused, etc.) is a separate fact and must
        // never replace the tariff name. The summary row is display/fallback only.
        const configuredTariff = compact(currentTariffOption?.label || '', 260);
        const summaryTariff = compact(tariffMatch?.[2] || tariffDisplay || '', 260);
        const currentTariff = configuredTariff || summaryTariff;
        const tariffId = compact(currentTariffOption?.value || tariffMatch?.[1] || '', 40);
        const auth = readAuthorization(root);
        const temporaryText = temporaryPaymentText(root);

        const finance = {
          priceSemantics: 'internet_tariff_price_from_main_summary_table',
          totalDueSemantics: 'current_total_due_from_main_summary_table_not_future_charge',
          accountBalanceSemantics: 'billing_displayed_balance_may_include_temporary_payment',
          temporaryPaymentSemantics: 'billing_temporary_credit_not_customer_money'
        };
        const observedMoney = [
          ['accountBalance', rowFrom(mainIndex, pageIndex, [/^на\s+счету,?\s*грн/i, /^на\s+рахунку,?\s*грн/i])],
          ['price', rowValueFromIndex(summaryIndex, [/^ціна,?\s*грн/i, /^цена,?\s*грн/i])],
          ['displayedPlanCost', rowValueFromIndex(summaryIndex, [
            /^підсумкова\s+вартість\s+тарифного\s+плану/i,
            /^итоговая\s+стоимость\s+тарифного\s+плана/i
          ])],
          ['totalDue', rowValueFromIndex(summaryIndex, [/^разом\s+до\s+сплати/i, /^итого\s+к\s+оплате/i])],
          ['balanceAfterTariff', rowValueFromIndex(summaryIndex, [
            /на\s+счете\s+с\s+учетом\s+стоимости\s+тарифного\s+плана/i,
            /на\s+рахунку\s+з\s+урахуванням\s+вартості\s+тарифного\s+плану/i
          ])],
          ['balanceWithoutTemporary', rowFrom(mainIndex, pageIndex, [
            /на\s+счете\s+без\s+учета\s+временных\s+платежей/i,
            /на\s+рахунку\s+без\s+урахування\s+тимчасових\s+платежів/i
          ])],
          ['temporaryPayment', temporaryText]
        ];
        for (const [key, raw] of observedMoney) {
          const value = money(raw);
          if (Number.isFinite(value)) finance[key] = value;
        }
        if (temporaryText) finance.temporaryPaymentText = temporaryText;
        if (discount) finance.discount = discount;

        return {
          identity: {
            billingId: String(targetBillingId || auth.billingId || ''),
            contract: input(root, 'contract'),
            login: compact(input(root, 'name') || auth.login || '', 80).toLowerCase(),
            fullName: input(root, 'fio'),
            contractDate: input(root, 'contract_date'),
            ppk: rowValueFromIndex(mainIndex, [/^ппк$/i])
          },
          service: {
            group: groupOption?.label ?? '',
            groupId: groupOption?.value ?? '',
            currentTariff,
            configuredTariff,
            currentTariffSource: configuredTariff ? 'select[name="paket"]' : 'summary_tariff_row_fallback',
            currentTariffSelectedId: currentTariffOption?.value ?? '',
            currentTariffSelectedLabel: currentTariffOption?.label ?? '',
            tariffId,
            tariffDisplay,
            summaryTariff,
            nextTariff: nextTariffOption?.label ?? null,
            nextTariffId: nextTariffOption?.value ?? '',
            nextTariffDelay: selected(root, 'next_paket_delay'),
            tvTariff: tvTariffOption?.label ?? '',
            tvTariffId: tvTariffOption?.value ?? '',
            nextTvTariff: nextTvTariffOption?.label ?? null,
            nextTvTariffId: nextTvTariffOption?.value ?? '',
            nextTvTariffDelay: selected(root, 'next_paket3_delay'),
            accessState: accessOption?.label ?? '',
            accessStateCode: accessOption?.value ?? '',
            serviceState: serviceStateOption?.label ?? '',
            serviceStateCode: serviceStateOption?.value ?? '',
            startDay: input(root, 'start_day'),
            limit: rowValueFromIndex(mainIndex, [/^лимит$/i]),
            activeServices: readActiveServices(root),
            discountAutoRemove: discountRemoveOption?.label ?? '',
            discountAutoRemoveCode: discountRemoveOption?.value ?? '',
            comment: input(root, 'comment')
          },
          finance,
          payments: readPayments(root),
          network: {
            ip: compact(input(root, 'ip') || auth.ip || '', 80),
            authorization: auth,
            trafficIncomingBytes: rowValueFromIndex(summaryIndex, [/^інтернет\s+входящий,?\s*байт/i, /^интернет\s+входящий,?\s*байт/i]),
            trafficOutgoingBytes: rowValueFromIndex(summaryIndex, [/^інтернет\s+исходящий,?\s*байт/i, /^интернет\s+исходящий,?\s*байт/i]),
            uaixIncomingBytes: rowValueFromIndex(summaryIndex, [/^ua-ix\s+входящий,?\s*байт/i]),
            uaixOutgoingBytes: rowValueFromIndex(summaryIndex, [/^ua-ix\s+исходящий,?\s*байт/i]),
            internetAccountingMb: rowValueFromIndex(summaryIndex, [/^оплата\s+інтернет,?\s*мб:\s*загалом/i, /^оплата\s+интернет,?\s*мб:\s*всего/i]),
            uaixAccountingMb: rowValueFromIndex(summaryIndex, [/^оплата\s+ua-ix,?\s*мб:\s*загалом/i, /^оплата\s+ua-ix,?\s*мб:\s*всего/i]),
            direction3AccountingMb: rowValueFromIndex(summaryIndex, [/^оплата\s+['"]?направление\s+3['"]?,?\s*мб:\s*загалом/i]),
            direction4AccountingMb: rowValueFromIndex(summaryIndex, [/^оплата\s+['"]?направление\s+4['"]?,?\s*мб:\s*загалом/i])
          },
          parseMeta: {
            blocks: {
              mainForm: { selector: mainFormSelector, rows: mainRows.length },
              authorization: { selector: authSelector, observed: Object.keys(auth).length > 0 },
              summary: { selector: summarySelector, rows: summaryRows.length },
              recentEvents: { selector: paymentsSelector, observed: Boolean(root.querySelector(paymentsSelector)) }
            },
            ignored: ['password', 'old_*', 'session_tokens', 'unselected_select_options']
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
                blocks: data.parseMeta?.blocks || {},
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
            blocks: data.parseMeta?.blocks || {},
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

export const BILLING_MAIN_FORM_SELECTOR = MAIN_FORM_SELECTOR;
export const BILLING_MAIN_SUMMARY_SELECTOR = SUMMARY_SELECTOR;
