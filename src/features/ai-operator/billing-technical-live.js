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

async function executeRead(tabId, id) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId }, args: [id], func: async targetBillingId => {
      const compact = (value, max = 600) => {
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
      url.searchParams.set('a', 'dopdata'); url.searchParams.set('parent_type', '0'); url.searchParams.set('id', String(targetBillingId)); url.searchParams.set('tmpl', '1');
      const response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = String(response.headers.get('content-type') || '');
      const declared = (contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'windows-1251').toLowerCase();
      let html = '';
      try { html = new TextDecoder(/1251/.test(declared) ? 'windows-1251' : 'utf-8').decode(bytes); }
      catch { html = new TextDecoder('windows-1251').decode(bytes); }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!response.ok) return { ok: false, code: 'BILLING_TECHNICAL_FETCH_FAILED', status: response.status };
      if (doc.querySelector('input[type="password"]')) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };
      const value = name => compact(doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '');
      const selected = name => {
        const node = doc.querySelector(`select[name="${CSS.escape(name)}"]`);
        return compact(node?.options?.[node.selectedIndex]?.textContent || node?.value || '');
      };
      const boolSelect = name => {
        const raw = String(doc.querySelector(`select[name="${CSS.escape(name)}"]`)?.value ?? '').trim();
        return raw === '1' ? true : raw === '0' ? false : null;
      };
      const olt = selected('dopfield_29');
      const oltIp = olt.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '';
      const eponOnuMac = value('dopfield_19');
      const gponOntSerial = value('dopfield_38');
      const explicitTechnology = selected('dopfield_39');
      let inferredTechnology = '';
      if (gponOntSerial) inferredTechnology = 'GPON';
      else if (eponOnuMac) inferredTechnology = 'EPON';
      else if (/\bGPON\b/i.test(olt)) inferredTechnology = 'GPON';
      else if (/\bEPON\b/i.test(olt)) inferredTechnology = 'EPON';
      else if (/\bOLT\b|HUAWEI|BDCOM|GCOM/i.test(olt)) inferredTechnology = 'PON';
      const technology = explicitTechnology || inferredTechnology;

      return { ok: true, code: 'OK', data: {
        technical: {
          technology,
          technologySource: explicitTechnology ? 'billing.dopfield_39' : inferredTechnology ? 'billing.technical.inference' : '',
          explicitTechnology,
          inferredTechnology,
          subscriberMac: value('dopfield_4'),
          eponOnuMac,
          gponOntSerial,
          olt,
          oltIp,
          staticIpConfigured: boolSelect('dopfield_44'),
          onuWithCableTv: boolSelect('dopfield_37'),
          smtp25Open: boolSelect('dopfield_3'),
          comment: compact(value('dopfield_34'), 600)
        },
        evidence: {
          source: 'billing-technical-live-read-only',
          endpoint: '/cgi-bin/adm/adm.pl?a=dopdata&parent_type=0&id=<billingId>&tmpl=1',
          technologyField: 'dopfield_39'
        }
      } };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_TECHNICAL_NO_RESULT' };
}

export async function readBillingTechnicalLive({ billingId, refresh = false, maxAgeMs = 900000 } = {}) {
  const id = normalizedId(billingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED' };
  if (INFLIGHT.has(id)) return INFLIGHT.get(id);
  const cached = CACHE.get(id); const age = cached ? Date.now() - cached.at : Infinity;
  if (!refresh && cached?.result?.ok && age < Math.max(1000, Number(maxAgeMs) || 900000)) return { ...cached.result, cache: 'hit' };
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
          const result = { ...outcome, billingId: id, tabId: tab.id, observedAt: new Date().toISOString(), source: 'billing-technical-live-read-only', cache: 'miss' };
          CACHE.set(id, { at: Date.now(), result }); return result;
        }
        if (!['BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID', 'BILLING_SESSION_REQUIRED'].includes(String(outcome?.code || ''))) break;
      } catch (error) { last = { ok: false, code: 'BILLING_TECHNICAL_EXECUTION_FAILED', message: String(error?.message || error) }; }
    }
    return { ...(last || { ok: false, code: 'BILLING_TECHNICAL_READ_FAILED' }), billingId: id, source: 'billing-technical-live-read-only' };
  })().finally(() => INFLIGHT.delete(id));
  INFLIGHT.set(id, task); return task;
}
