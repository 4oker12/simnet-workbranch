'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);
const INFLIGHT = new Map();
const CACHE = new Map();
const COALESCE_MS = 1500;

function clean(value, max = 700) {
  const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function normalizedId(value) {
  const id = String(value == null ? '' : value).replace(/\D+/g, '').slice(0, 12);
  return /^\d{1,12}$/.test(id) ? id : '';
}
function rankTabs(tabs = []) {
  return [...tabs].sort((a, b) => {
    const activeDelta = Number(Boolean(b?.active)) - Number(Boolean(a?.active));
    return activeDelta || Number(b?.lastAccessed || 0) - Number(a?.lastAccessed || 0);
  });
}
async function billingTabs() {
  if (!globalThis.chrome?.tabs?.query) return [];
  return rankTabs(await chrome.tabs.query({ url: [...BILLING_TAB_URLS] }));
}

async function executeRead(tabId, id) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [id],
    func: async targetBillingId => {
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
      const selected = (doc, name) => {
        const node = doc.querySelector(`select[name="${CSS.escape(name)}"]`);
        if (!node) return '';
        return compact(node.options?.[node.selectedIndex]?.textContent || node.value || '', 300);
      };
      const input = (doc, name) => compact(doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '', 300);
      const rowValue = (root, patterns) => {
        for (const row of root?.querySelectorAll?.('tr') || []) {
          const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
          if (cells.length < 2) continue;
          const label = compact(cells[0]?.textContent || '', 260).toLowerCase();
          if (!patterns.some(pattern => pattern.test(label))) continue;
          const last = cells[cells.length - 1];
          const control = last.querySelector('select,input:not([type="hidden"]),textarea');
          if (control?.tagName === 'SELECT') return compact(control.options?.[control.selectedIndex]?.textContent || control.value || '', 500);
          if (control) return compact(control.value || '', 500);
          return compact(last.textContent || '', 500);
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
        const charset = /^(?:windows-1251|win-?1251|cp1251)$/i.test(declared) ? 'windows-1251' : /^(?:utf-?8)$/i.test(declared) ? 'utf-8' : declared || 'utf-8';
        try { return new TextDecoder(charset).decode(bytes); }
        catch { return new TextDecoder('utf-8').decode(bytes); }
      };
      const activeServices = doc => [...doc.querySelectorAll('input[type="checkbox"][name^="sr"]:checked')].map(checkbox => {
        const row = checkbox.closest('table')?.querySelector('tr') || checkbox.closest('tr');
        const cells = row ? [...row.querySelectorAll(':scope > td, :scope > th')] : [];
        const name = compact(cells[0]?.textContent || checkbox.name, 220).replace(/^услуга\s*/i, '');
        const amountText = compact(cells[cells.length - 1]?.textContent || '', 120);
        return { name, amount: money(amountText), amountText };
      }).filter(item => item.name).slice(0, 20);
      const recentOperations = doc => {
        const table = doc.querySelector('#my_x_16');
        if (!table) return [];
        return [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].map(row => {
          const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
          return {
            date: compact(cells[0]?.textContent || '', 80),
            description: compact(cells[1]?.textContent || '', 240),
            amount: compact(cells[2]?.textContent || '', 120)
          };
        }).filter(item => item.date || item.description || item.amount).slice(0, 6);
      };

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
      if (!response.ok) return { ok: false, code: 'BILLING_MAIN_FETCH_FAILED', status: response.status };
      if (doc.querySelector('input[type="password"]')) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };
      const form = doc.querySelector('#formedit');
      const summary = doc.querySelector('table.tbg1.nav3.width100');
      if (!form && !summary) return { ok: false, code: 'BILLING_MAIN_NOT_FOUND' };

      const services = activeServices(doc);
      const amounts = services.map(item => item.amount).filter(Number.isFinite);
      const activeServicesTotal = services.length === amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
      const temporaryPaymentText = [...doc.querySelectorAll('.modified,td,span,p,div')]
        .map(node => compact(node.textContent || '', 260))
        .filter(value => value.length <= 240 && /временн(?:ый|ого)\s+плат[её]ж/i.test(value))
        .sort((a, b) => a.length - b.length)[0] || '';
      const summaryTariff = summary ? rowValue(summary, [/^тарифи\s+на\s+інтернет/i, /^тарифы\s+на\s+интернет/i]) : '';
      const currentTariff = selected(doc, 'paket') || summaryTariff;
      const price = summary ? money(rowValue(summary, [/^ціна,?\s*грн/i, /^цена,?\s*грн/i])) : null;
      const totalDue = summary ? money(rowValue(summary, [/^разом\s+до\s+сплати/i, /^итого\s+к\s+оплате/i])) : null;
      const accountBalance = money(rowValue(doc, [/^на\s+счету,?\s*грн/i, /^на\s+рахунку,?\s*грн/i]));
      const balanceAfterTariff = summary ? money(rowValue(summary, [
        /на\s+счете\s+с\s+учетом\s+стоимости\s+тарифного\s+плана/i,
        /на\s+рахунку\s+з\s+урахуванням\s+вартості\s+тарифного\s+плану/i
      ])) : null;
      const balanceWithoutTemporary = money(rowValue(doc, [
        /на\s+счете\s+без\s+учета\s+временных\s+платежей/i,
        /на\s+рахунку\s+без\s+урахування\s+тимчасових\s+платежів/i
      ]));
      const authRow = doc.querySelector('table.usrlist tbody tr');
      const authTitle = compact(authRow?.querySelector('img[title]')?.getAttribute('title') || '', 180);
      const authCells = authRow ? [...authRow.querySelectorAll(':scope > td, :scope > th')] : [];

      return {
        ok: true,
        code: 'OK',
        data: {
          identity: {
            billingId: String(targetBillingId),
            login: compact(input(doc, 'name') || authCells[4]?.textContent || '', 80).toLowerCase(),
            contract: compact(input(doc, 'contract'), 80),
            fullName: compact(input(doc, 'fio'), 240),
            contractDate: compact(input(doc, 'contract_date'), 80)
          },
          service: {
            group: selected(doc, 'grp'),
            currentTariff: compact(currentTariff, 300),
            nextTariff: doc.querySelector('select[name="next_paket"]') ? selected(doc, 'next_paket') : null,
            nextTariffDelay: selected(doc, 'next_paket_delay'),
            accessState: selected(doc, 'state'),
            serviceState: selected(doc, 'cstate'),
            startDay: input(doc, 'start_day'),
            limit: rowValue(doc, [/^лимит$/i]),
            activeServices: services,
            activeServicesTotal
          },
          finance: {
            accountBalance,
            price,
            totalDue,
            balanceAfterTariff,
            balanceWithoutTemporary,
            temporaryPayment: money(temporaryPaymentText),
            temporaryPaymentText,
            priceSemantics: 'internet_tariff_price_from_main_summary_table',
            totalDueSemantics: 'current_billing_total_for_rendered_service_set_not_future_charge'
          },
          network: {
            ip: compact(input(doc, 'ip') || authCells[5]?.textContent || '', 80),
            authorization: {
              title: authTitle,
              authorized: /авторизован/i.test(authTitle) && !/не\s+авторизован/i.test(authTitle),
              accessAllowed: /доступ\s+разреш/i.test(authTitle),
              lastActivity: compact(authCells[2]?.textContent || '', 80)
            },
            trafficIncomingBytes: summary ? rowValue(summary, [/^інтернет\s+входящий,?\s*байт/i, /^интернет\s+входящий,?\s*байт/i]) : '',
            trafficOutgoingBytes: summary ? rowValue(summary, [/^інтернет\s+исходящий,?\s*байт/i, /^интернет\s+исходящий,?\s*байт/i]) : ''
          },
          payments: recentOperations(doc),
          evidence: {
            source: 'billing-main-live-read-only',
            endpoint: '/cgi-bin/adm/adm.pl?a=user&id=<billingId>',
            selectors: ['#formedit', 'table.tbg1.nav3.width100', '#my_x_16']
          }
        }
      };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_MAIN_NO_RESULT' };
}

async function performRead(id) {
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE' };
  const tabs = await billingTabs();
  if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED' };
  let last = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    try {
      const outcome = await executeRead(tab.id, id);
      last = outcome;
      if (outcome?.ok) {
        return { ...outcome, billingId: id, tabId: tab.id, observedAt: new Date().toISOString(), source: 'billing-main-live-read-only', cache: 'miss' };
      }
      if (!['BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID', 'BILLING_SESSION_REQUIRED'].includes(String(outcome?.code || ''))) break;
    } catch (error) {
      last = { ok: false, code: 'BILLING_MAIN_EXECUTION_FAILED', message: clean(error?.message || error, 500) };
    }
  }
  return { ...(last || { ok: false, code: 'BILLING_MAIN_READ_FAILED' }), billingId: id, source: 'billing-main-live-read-only' };
}

export async function readBillingMainLive({ billingId, refresh = false, forceRefresh = false, maxAgeMs = 30000 } = {}) {
  const id = normalizedId(billingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED' };
  const pending = INFLIGHT.get(id);
  if (pending) return pending;

  const cached = CACHE.get(id);
  const age = cached ? Date.now() - cached.at : Infinity;
  const ttl = Math.max(1000, Number(maxAgeMs) || 30000);
  if (!forceRefresh && cached?.result?.ok && ((!refresh && age < ttl) || age < COALESCE_MS)) {
    return { ...cached.result, cache: age < COALESCE_MS ? 'coalesced' : 'hit' };
  }

  const task = performRead(id).then(outcome => {
    if (outcome?.ok) CACHE.set(id, { at: Date.now(), result: outcome });
    return outcome;
  }).finally(() => {
    if (INFLIGHT.get(id) === task) INFLIGHT.delete(id);
  });
  INFLIGHT.set(id, task);
  return task;
}

export function clearBillingMainLiveCache(billingId = '') {
  const id = normalizedId(billingId);
  if (id) CACHE.delete(id);
  else CACHE.clear();
}
