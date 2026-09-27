'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);

function clean(value, max = 1200) {
  const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function normalizeBillingId(value) {
  const normalized = String(value == null ? '' : value).replace(/\D+/g, '').slice(0, 12);
  return /^\d{1,12}$/.test(normalized) ? normalized : '';
}

function normalizeMac(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length === 12 ? hex.match(/.{2}/g).join(':') : clean(value, 80).toLowerCase();
}

function normalizeIp(value) {
  const candidate = String(value || '').match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '';
  if (!candidate) return '';
  return candidate.split('.').every(part => Number(part) >= 0 && Number(part) <= 255) ? candidate : '';
}

function labelValue(lines, pattern) {
  for (const original of lines) {
    const line = original.replace(/^\s*\d+\.\s*/, '').trim();
    if (!pattern.test(line)) continue;
    return clean(line.replace(pattern, '').replace(/^\s*[-:–—]\s*/, ''), 1200);
  }
  return '';
}

export function parseNetworkSessionText(rawText = '') {
  const lines = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(line => clean(line, 2400))
    .filter(Boolean);

  const headerLine = lines.find(line => /\b(?:\d{1,3}\.){3}\d{1,3}\b\s*\([^)]*(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}[^)]*\)/i.test(line)) || '';
  const headerIp = normalizeIp(headerLine);
  const headerMac = normalizeMac(headerLine.match(/\(((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})\)/i)?.[1] || '');

  const brasRaw = labelValue(lines, /^BRAS\b/i);
  const brasIp = normalizeIp(brasRaw);
  const brasName = clean(brasRaw.replace(/\s*\((?:\d{1,3}\.){3}\d{1,3}\)\s*$/, ''), 180);
  const sessionSource = labelValue(lines, /^(?:Джерело\s+сесії|Источник\s+сессии)\b/i);
  const sessionId = labelValue(lines, /^(?:Сесія|Сессия)\b/i);
  const status = labelValue(lines, /^(?:Статус\s+сесії|Статус\s+сессии)\b/i);
  const services = labelValue(lines, /^(?:Сервіси|Сервисы)\b/i);
  const username = labelValue(lines, /^USERNAME\b/i);
  const authorizationType = labelValue(lines, /^(?:Тип\s+авторизації(?:\s+Radius2)?|Тип\s+авторизации(?:\s+Radius2)?)\b/i);
  const startTime = labelValue(lines, /^(?:Час\s+старту|Время\s+старта)\b/i);
  const bytes = labelValue(lines, /^(?:Байти\s+прийнято\/передано|Байты\s+принято\/передано)\b/i);
  const speed = labelValue(lines, /^(?:Швидкість\s+прийом\/передача.*|Скорость\s+прием\/передача.*)\b/i);
  const lastEventTime = labelValue(lines, /^(?:Час\s+останньої\s+події|Время\s+последнего\s+события)\b/i);
  const lastEvent = labelValue(lines, /^(?:Остання\s+подія|Последнее\s+событие)\b/i);
  const router = labelValue(lines, /^ROUTER\b/i);
  const vendor = labelValue(lines, /^VENDOR\b/i);
  const vlan = labelValue(lines, /^VLAN\b/i);

  const subscriberMac = headerMac || normalizeMac(username);
  const subscriberIp = headerIp;
  const hasUsefulData = Boolean(subscriberIp || subscriberMac || brasRaw || sessionId || status || startTime || lastEventTime || router || vendor || vlan);

  return {
    hasUsefulData,
    subscriberIp,
    subscriberMac,
    bras: brasName,
    brasIp,
    sessionSource,
    sessionId,
    status,
    isOnline: /\bonline\b/i.test(status),
    isActive: /\bactive\b/i.test(status) && !/\binactive\b/i.test(status),
    services,
    username,
    authorizationType,
    startTime,
    bytes,
    speed,
    lastEventTime,
    lastEvent,
    router,
    vendor,
    vlan
  };
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

async function executeRead(tabId, billingId) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [billingId],
    func: async targetBillingId => {
      const allowedHost = /^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname);
      if (!allowedHost) return { ok: false, code: 'BILLING_TAB_INVALID' };

      const compact = (value, max = 1200) => {
        const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
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
        try { return new TextDecoder(charset).decode(bytes); }
        catch { return new TextDecoder('utf-8').decode(bytes); }
      };

      let pp = '';
      let uu = '';
      try {
        const current = new URL(location.href);
        pp = current.searchParams.get('pp') || '';
        uu = current.searchParams.get('uu') || '';
      } catch {}
      if (!pp) pp = compact(document.querySelector('input[name="pp"]')?.value || '', 220);
      if (!uu) uu = compact(document.querySelector('input[name="uu"]')?.value || '', 120);
      if (!pp) return { ok: false, code: 'BILLING_SESSION_REQUIRED' };

      const url = new URL('/cgi-bin/adm/stat.pl', location.origin);
      url.searchParams.set('pp', pp);
      if (uu) url.searchParams.set('uu', uu);
      url.searchParams.set('id', String(targetBillingId));
      url.searchParams.set('a', '252');

      const response = await fetch(url.href, { method: 'GET', credentials: 'include', cache: 'no-store' });
      const html = await decodeResponseHtml(response);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!response.ok) return { ok: false, code: 'NETWORK_SESSION_FETCH_FAILED', status: response.status };
      if (doc.querySelector('input[type="password"], form[action*="login" i]')) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };
      const bodyText = String(doc.body?.innerText || doc.body?.textContent || '');
      if (!bodyText.trim()) return { ok: false, code: 'NETWORK_SESSION_EMPTY' };
      return { ok: true, code: 'OK', bodyText, pagePath: `/cgi-bin/adm/stat.pl?id=${String(targetBillingId)}&a=252` };
    }
  });
  return execution?.result || { ok: false, code: 'NETWORK_SESSION_NO_RESULT' };
}

export async function readNetworkSessionLive({ billingId } = {}) {
  const id = normalizeBillingId(billingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED', data: {} };
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) {
    return { ok: false, code: 'NETWORK_RUNTIME_UNAVAILABLE', data: {} };
  }

  const tabs = await billingTabs();
  if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED', data: {} };

  let last = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    try {
      const outcome = await executeRead(tab.id, id);
      last = outcome;
      if (outcome?.ok) {
        const parsed = parseNetworkSessionText(outcome.bodyText || '');
        if (!parsed.hasUsefulData) return { ok: false, code: 'NETWORK_SESSION_PARSE_FAILED', data: { source: 'billing-stat-live-read-only', pagePath: outcome.pagePath || '' }, tabId: tab.id };
        return {
          ok: true,
          code: 'OK',
          observedAt: new Date().toISOString(),
          tabId: tab.id,
          data: {
            ...parsed,
            billingId: id,
            source: 'billing-stat-live-read-only',
            pagePath: outcome.pagePath || `/cgi-bin/adm/stat.pl?id=${id}&a=252`
          }
        };
      }
      if (!['BILLING_SESSION_REQUIRED', 'BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID'].includes(String(outcome?.code || ''))) break;
    } catch (error) {
      last = { ok: false, code: 'NETWORK_SESSION_EXECUTION_FAILED', message: clean(error?.message || error, 500) };
    }
  }

  return {
    ...(last || { ok: false, code: 'NETWORK_SESSION_FETCH_FAILED' }),
    data: { source: 'billing-stat-live-read-only', billingId: id }
  };
}
