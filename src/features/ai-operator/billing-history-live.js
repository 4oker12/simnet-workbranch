'use strict';

const BILLING_TAB_URLS = Object.freeze(['https://admin.simnet.kiev.ua/*', 'https://admin.looknet.kiev.ua/*']);
const CACHE = new Map();
const INFLIGHT = new Map();

function normalizedId(value) {
  const id = String(value == null ? '' : value).replace(/\D+/g, '').slice(0, 12);
  return /^\d{1,12}$/.test(id) ? id : '';
}
function rankTabs(tabs = []) {
  return [...tabs].sort((a, b) => Number(Boolean(b?.active)) - Number(Boolean(a?.active)) || Number(b?.lastAccessed || 0) - Number(a?.lastAccessed || 0));
}

export function classifyBillingHistoryEvent(value = '') {
  const text = String(value || '').toLowerCase();
  if (/снят|списан|списання|знято|за\s+услуг|абонплат|subscription|charge/.test(text)) return 'charge';
  if (/wayforpay|попол|плат[её]ж|оплат|надходжен|зачисл|приход/.test(text)) return 'payment';
  if (/тариф|пакет/.test(text) && /смен|змін|измен|встанов|перех/.test(text)) return 'tariff_change';
  if (/\bip\b|ip[- ]?адрес/.test(text) && /смен|змін|измен|встанов/.test(text)) return 'ip_change';
  if (/блок|заблок|разблок|доступ.*(?:запр|разреш)|стан|состояни/.test(text)) return 'state_change';
  if (/активац|первая\s+актив|перша\s+актив|подключен|підключен/.test(text)) return 'activation';
  if (/администратор|оператор|изменил|змінив|редакт/.test(text)) return 'admin_event';
  return 'other';
}

export function historyPaymentsView(history = {}) {
  const events = Array.isArray(history?.events) ? history.events : [];
  return events
    .filter(event => event?.kind === 'payment' || event?.kind === 'charge')
    .map(event => ({
      date: String(event.date || ''),
      description: String(event.description || event.text || ''),
      amount: event.amountText || (Number.isFinite(event.amount) ? String(event.amount) : '')
    }));
}

async function executeRead(tabId, id) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId }, args: [id], func: async targetBillingId => {
      const compact = (value, max = 900) => {
        const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
      };
      if (!/^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname)) return { ok: false, code: 'BILLING_TAB_INVALID' };
      let pp = '';
      let uu = '';
      try { const current = new URL(location.href); pp = current.searchParams.get('pp') || ''; uu = current.searchParams.get('uu') || ''; } catch {}
      if (!pp) pp = compact(document.querySelector('input[name="pp"]')?.value || '', 200);
      if (!uu) uu = compact(document.querySelector('input[name="uu"]')?.value || '', 80);
      if (!pp) return { ok: false, code: 'BILLING_SESSION_REQUIRED' };

      const url = new URL('/cgi-bin/adm/adm.pl', location.origin);
      url.searchParams.set('pp', pp); if (uu) url.searchParams.set('uu', uu);
      url.searchParams.set('mid', String(targetBillingId)); url.searchParams.set('a', 'payshow');
      const response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = String(response.headers.get('content-type') || '');
      const declared = (contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'windows-1251').toLowerCase();
      let html = '';
      try { html = new TextDecoder(/1251/.test(declared) ? 'windows-1251' : 'utf-8').decode(bytes); }
      catch { html = new TextDecoder('windows-1251').decode(bytes); }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!response.ok) return { ok: false, code: 'BILLING_HISTORY_FETCH_FAILED', status: response.status };
      if (doc.querySelector('input[type="password"]')) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };

      const classify = value => {
        const source = String(value || '').toLowerCase();
        if (/снят|списан|списання|знято|за\s+услуг|абонплат|subscription|charge/.test(source)) return 'charge';
        if (/wayforpay|попол|плат[её]ж|оплат|надходжен|зачисл|приход/.test(source)) return 'payment';
        if (/тариф|пакет/.test(source) && /смен|змін|измен|встанов|перех/.test(source)) return 'tariff_change';
        if (/\bip\b|ip[- ]?адрес/.test(source) && /смен|змін|измен|встанов/.test(source)) return 'ip_change';
        if (/блок|заблок|разблок|доступ.*(?:запр|разреш)|стан|состояни/.test(source)) return 'state_change';
        if (/активац|первая\s+актив|перша\s+актив|подключен|підключен/.test(source)) return 'activation';
        if (/администратор|оператор|изменил|змінив|редакт/.test(source)) return 'admin_event';
        return 'other';
      };
      const datePattern = /\b(?:\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/;
      const amountPattern = /(^|\s)([-+]?\d+(?:[.,]\d{1,2})?)\s*(?:грн|uah)?(?:\s|$)/i;
      const rows = [...doc.querySelectorAll('tr')];
      const events = [];
      for (const row of rows) {
        const cells = [...row.querySelectorAll(':scope > td, :scope > th')].map(cell => compact(cell.textContent || '', 700)).filter(Boolean);
        if (cells.length < 2) continue;
        const rowText = compact(cells.join(' | '), 1600);
        if (!rowText || /(?:дата|сумма|сума|комментар|описание).*(?:дата|сумма|сума|комментар|описание)/i.test(rowText)) continue;
        const date = cells.map(cell => cell.match(datePattern)?.[0] || '').find(Boolean) || '';
        const amountCell = cells.find(cell => /грн|uah/i.test(cell) && /[-+]?\d/.test(cell)) || cells.find(cell => amountPattern.test(cell)) || '';
        const amountMatch = amountCell.replace(/\s+/g, ' ').match(/[-+]?\d+(?:[.,]\d{1,2})?/);
        const amount = amountMatch ? Number(amountMatch[0].replace(',', '.')) : null;
        const description = compact(cells.filter(cell => cell !== date && cell !== amountCell).join(' · '), 900);
        const kind = classify(`${description} ${amountCell}`);
        // payshow also contains navigation/layout tables. Keep only rows that carry a date,
        // a classified account event, or a parseable monetary value.
        if (!date && kind === 'other' && !Number.isFinite(amount)) continue;
        events.push({ date, kind, amount: Number.isFinite(amount) ? amount : null, amountText: compact(amountCell, 120), description, text: rowText });
      }
      const deduped = events.filter((event, index, list) => list.findIndex(item => item.text === event.text) === index).slice(0, 160);
      return { ok: true, code: 'OK', data: {
        events: deduped,
        count: deduped.length,
        evidence: {
          source: 'billing-history-live-read-only',
          endpoint: '/cgi-bin/adm/adm.pl?mid=<billingId>&a=payshow'
        }
      } };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_HISTORY_NO_RESULT' };
}

export async function readBillingHistoryLive({ billingId, refresh = false, maxAgeMs = 120000 } = {}) {
  const id = normalizedId(billingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED' };
  if (INFLIGHT.has(id)) return INFLIGHT.get(id);
  const cached = CACHE.get(id); const age = cached ? Date.now() - cached.at : Infinity;
  if (!refresh && cached?.result?.ok && age < Math.max(1000, Number(maxAgeMs) || 120000)) return { ...cached.result, cache: 'hit' };
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE' };

  const task = (async () => {
    const tabs = rankTabs(await chrome.tabs.query({ url: [...BILLING_TAB_URLS] }));
    if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED' };
    let last = null;
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      try {
        const outcome = await executeRead(tab.id, id); last = outcome;
        if (outcome?.ok) {
          const result = { ...outcome, billingId: id, tabId: tab.id, observedAt: new Date().toISOString(), source: 'billing-history-live-read-only', cache: 'miss' };
          CACHE.set(id, { at: Date.now(), result }); return result;
        }
        if (!['BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID', 'BILLING_SESSION_REQUIRED'].includes(String(outcome?.code || ''))) break;
      } catch (error) { last = { ok: false, code: 'BILLING_HISTORY_EXECUTION_FAILED', message: String(error?.message || error) }; }
    }
    return { ...(last || { ok: false, code: 'BILLING_HISTORY_READ_FAILED' }), billingId: id, source: 'billing-history-live-read-only' };
  })().finally(() => INFLIGHT.delete(id));
  INFLIGHT.set(id, task); return task;
}
