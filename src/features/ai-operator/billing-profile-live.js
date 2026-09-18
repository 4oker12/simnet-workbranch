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
      url.searchParams.set('a', 'dopdata'); url.searchParams.set('parent_type', '0'); url.searchParams.set('id', String(targetBillingId)); url.searchParams.set('tmpl', '2');
      const response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = String(response.headers.get('content-type') || '');
      const declared = (contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'windows-1251').toLowerCase();
      let html = '';
      try { html = new TextDecoder(/1251/.test(declared) ? 'windows-1251' : 'utf-8').decode(bytes); }
      catch { html = new TextDecoder('windows-1251').decode(bytes); }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!response.ok) return { ok: false, code: 'BILLING_PROFILE_FETCH_FAILED', status: response.status };
      if (doc.querySelector('input[type="password"]')) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };
      const value = name => compact(doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '');
      const selected = name => {
        const node = doc.querySelector(`select[name="${CSS.escape(name)}"]`);
        return compact(node?.options?.[node.selectedIndex]?.textContent || node?.value || '');
      };
      const address = {
        street: selected('dopfield_5'),
        building: value('dopfield_6'),
        block: value('dopfield_11'),
        entrance: value('dopfield_12'),
        floor: value('dopfield_7'),
        apartment: value('dopfield_8')
      };
      address.full = [
        address.street,
        address.building ? `буд. ${address.building}` : '',
        address.block ? `блок ${address.block}` : '',
        address.entrance ? `під'їзд ${address.entrance}` : '',
        address.floor ? `поверх ${address.floor}` : '',
        address.apartment ? `кв. ${address.apartment}` : ''
      ].filter(Boolean).join(', ');
      return { ok: true, code: 'OK', data: {
        address,
        contacts: {
          phone: value('dopfield_9'),
          extraPhone: value('dopfield_22'),
          email: value('dopfield_14')
        },
        customer: {
          subscriberType: selected('dopfield_31'),
          contractedWith: selected('dopfield_32'),
          edrpou: value('dopfield_33'),
          manager: selected('dopfield_43'),
          connectedBy: selected('dopfield_25'),
          comment: compact(value('dopfield_10'), 600)
        },
        evidence: {
          source: 'billing-profile-live-read-only',
          endpoint: '/cgi-bin/adm/adm.pl?a=dopdata&parent_type=0&id=<billingId>&tmpl=2'
        }
      } };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_PROFILE_NO_RESULT' };
}

export async function readBillingProfileLive({ billingId, refresh = false, maxAgeMs = 1800000 } = {}) {
  const id = normalizedId(billingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED' };
  if (INFLIGHT.has(id)) return INFLIGHT.get(id);
  const cached = CACHE.get(id); const age = cached ? Date.now() - cached.at : Infinity;
  if (!refresh && cached?.result?.ok && age < Math.max(1000, Number(maxAgeMs) || 1800000)) return { ...cached.result, cache: 'hit' };
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
          const result = { ...outcome, billingId: id, tabId: tab.id, observedAt: new Date().toISOString(), source: 'billing-profile-live-read-only', cache: 'miss' };
          CACHE.set(id, { at: Date.now(), result }); return result;
        }
        if (!['BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID', 'BILLING_SESSION_REQUIRED'].includes(String(outcome?.code || ''))) break;
      } catch (error) { last = { ok: false, code: 'BILLING_PROFILE_EXECUTION_FAILED', message: String(error?.message || error) }; }
    }
    return { ...(last || { ok: false, code: 'BILLING_PROFILE_READ_FAILED' }), billingId: id, source: 'billing-profile-live-read-only' };
  })().finally(() => INFLIGHT.delete(id));
  INFLIGHT.set(id, task); return task;
}
