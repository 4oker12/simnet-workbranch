'use strict';

const BILLING_TAB_URLS = Object.freeze([
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
]);

function clean(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function normalizeIp(value) {
  const match = clean(value, 120).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (!match) return '';
  const parts = match[0].split('.').map(Number);
  return parts.every(part => part >= 0 && part <= 255) ? match[0] : '';
}

export function classifyBillingLookup(toolArgs = {}) {
  const explicitLogin = clean(toolArgs.login, 80).replace(/\s+/g, '').toLowerCase();
  const explicitContract = clean(toolArgs.contract, 80).replace(/\D/g, '');
  const explicitIp = normalizeIp(toolArgs.ip);
  const address = clean(toolArgs.address, 320);
  const query = clean(toolArgs.query, 320);

  if (/^abon\d{3,12}$/i.test(explicitLogin)) {
    return { mode: 'login', value: explicitLogin };
  }
  if (explicitContract) {
    return { mode: 'contract', value: explicitContract };
  }
  if (explicitIp) {
    return { mode: 'ip', value: explicitIp };
  }
  if (address) {
    return { mode: 'address', value: address };
  }

  const compactQuery = query.replace(/\s+/g, '');
  if (/^abon\d{3,12}$/i.test(compactQuery)) {
    return { mode: 'login', value: compactQuery.toLowerCase() };
  }
  if (/^\d{3,12}$/.test(compactQuery)) {
    return { mode: 'contract', value: compactQuery };
  }
  const queryIp = normalizeIp(query);
  if (queryIp) {
    return { mode: 'ip', value: queryIp };
  }
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

async function executeSearch(tabId, request) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [request],
    func: async lookupRequest => {
      const allowedHost = /^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname);
      if (!allowedHost) return { ok: false, code: 'BILLING_TAB_INVALID' };

      const compact = (value, max = 500) => {
        const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
      };
      const normalize = value => compact(value, 400)
        .toLowerCase()
        .replace(/[.,;:()№#'"`]/g, ' ')
        .replace(/\b(?:м\.?|місто|город|с\.?|село|вул\.?|улица|ул\.?|просп\.?|проспект|пров\.?|переулок|буд\.?|будинок|дом|д\.?|кв\.?|квартира)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const input = (doc, name) => compact(doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '', 240);
      const selected = (doc, name) => {
        const node = doc.querySelector(`select[name="${CSS.escape(name)}"]`);
        if (!node) return '';
        return compact(node.options?.[node.selectedIndex]?.textContent || node.value || '', 240);
      };
      const money = value => {
        const match = compact(value, 160).replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
      };
      const rowValue = (doc, patterns) => {
        for (const row of doc.querySelectorAll('tr')) {
          const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
          if (cells.length < 2) continue;
          const label = compact(cells[0]?.textContent || '', 220).toLowerCase();
          if (!patterns.some(pattern => pattern.test(label))) continue;
          const last = cells[cells.length - 1];
          const control = last.querySelector('select,input:not([type="hidden"]),textarea');
          if (control?.tagName === 'SELECT') return compact(control.options?.[control.selectedIndex]?.textContent || control.value || '');
          if (control) return compact(control.value || '');
          return compact(last.textContent || '');
        }
        return '';
      };
      const readAddress = doc => {
        const address = {
          street: selected(doc, 'dopfield_5'),
          building: input(doc, 'dopfield_6'),
          block: input(doc, 'dopfield_11'),
          apartment: input(doc, 'dopfield_8')
        };
        address.full = [
          address.street,
          address.building ? `буд. ${address.building}` : '',
          address.block ? `блок ${address.block}` : '',
          address.apartment ? `кв. ${address.apartment}` : ''
        ].filter(Boolean).join(', ');
        return address;
      };
      const readActiveServices = doc => {
        if (!doc.querySelector('select[name="paket"]')) return null;
        return [...doc.querySelectorAll('input[type="checkbox"][name^="sr"]')].filter(c => c.checked).map(c => {
          const row = c.closest('table')?.querySelector('tr') || c.closest('tr');
          const cells = row ? [...row.querySelectorAll(':scope > td, :scope > th')] : [];
          return { name: compact(cells[0]?.textContent || c.name, 220), amount: money(cells.at(-1)?.textContent || '') };
        });
      };
      const readMain = (doc, billingId) => {
        const login = compact(input(doc, 'name') || doc.body?.textContent?.match(/\babon\d{3,12}\b/i)?.[0] || '', 80).toLowerCase();
        const contract = compact(input(doc, 'contract'), 80);
        const activeServices = readActiveServices(doc);
        const activeServicesTotal = activeServices && activeServices.every(s => Number.isFinite(s.amount))
          ? Math.round(activeServices.reduce((sum, s) => sum + Math.round(s.amount * 100), 0)) / 100 : null;
        return {
          identity: {
            billingId: String(billingId || ''),
            contract,
            login,
            fullName: compact(input(doc, 'fio'), 240)
          },
          service: {
            group: selected(doc, 'grp'),
            currentTariff: selected(doc, 'paket'),
            nextTariff: doc.querySelector('select[name="next_paket"]') ? selected(doc, 'next_paket') : null,
            nextTariffDelay: selected(doc, 'next_paket_delay'),
            accessState: selected(doc, 'state'),
            serviceState: selected(doc, 'cstate'),
            startDay: input(doc, 'start_day'),
            activeServices, activeServicesTotal
          },
          finance: {
            accountBalance: money(rowValue(doc, [/^на счету,?\s*грн/i, /^на рахунку,?\s*грн/i])),
            price: money(rowValue(doc, [/^ціна,?\s*грн/i, /^цена,?\s*грн/i])),
            totalDue: money(rowValue(doc, [/^разом до сплати/i, /^итого к оплате/i])),
            balanceAfterTariff: money(rowValue(doc, [/на счете с учетом стоимости тарифного плана/i, /на рахунку з урахуванням вартості тарифного плану/i])),
            balanceWithoutTemporary: money(rowValue(doc, [/на счете без учета временных платежей/i, /на рахунку без урахування тимчасових платежів/i]))
          },
          network: {
            ip: compact(input(doc, 'ip'), 80)
          }
        };
      };
      const merge = (left, right) => {
        const output = left && typeof left === 'object' && !Array.isArray(left) ? { ...left } : {};
        for (const [key, value] of Object.entries(right || {})) {
          if (value && typeof value === 'object' && !Array.isArray(value)) output[key] = merge(output[key], value);
          else if (value !== undefined) output[key] = value;
        }
        return output;
      };
      const authPage = doc => Boolean(doc.querySelector('input[type="password"]'));
      const decodeResponseHtml = async response => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = String(response.headers.get('content-type') || '');
        const headerCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || '';
        const head = new TextDecoder('windows-1252').decode(bytes.slice(0, 8192));
        const metaCharset = head.match(/charset\s*=\s*["']?\s*([a-z0-9._-]+)/i)?.[1] || '';
        const declared = String(headerCharset || metaCharset || '').toLowerCase();
        const charset = /^(?:windows-1251|win-?1251|cp1251)$/i.test(declared)
          ? 'windows-1251'
          : /^(?:utf-?8)$/i.test(declared)
            ? 'utf-8'
            : declared || 'utf-8';

        let html = '';
        try {
          html = new TextDecoder(charset).decode(bytes);
        } catch {
          html = new TextDecoder('utf-8').decode(bytes);
        }

        if (html.includes('\uFFFD') && charset !== 'windows-1251') {
          const legacy = new TextDecoder('windows-1251').decode(bytes);
          const replacementCount = value => (String(value).match(/\uFFFD/g) || []).length;
          if (replacementCount(legacy) < replacementCount(html)) html = legacy;
        }
        return html;
      };
      const fetchDoc = async url => {
        const response = await fetch(url.href, { method: 'GET', credentials: 'include', cache: 'no-store' });
        const html = await decodeResponseHtml(response);
        return {
          ok: response.ok,
          status: response.status,
          url: new URL(response.url || url.href),
          doc: new DOMParser().parseFromString(html, 'text/html')
        };
      };
      const makeUrl = params => {
        const url = new URL('/cgi-bin/adm/adm.pl', location.origin);
        for (const [key, value] of Object.entries(params || {})) {
          if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
        }
        return url;
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

      const baseParams = { pp, ...(uu ? { uu } : {}), a: 'listuser' };
      let searchUrl = null;
      let addressResolution = null;

      if (lookupRequest.mode === 'address') {
        const listPage = await fetchDoc(makeUrl(baseParams));
        if (!listPage.ok || authPage(listPage.doc)) return { ok: false, code: authPage(listPage.doc) ? 'BILLING_AUTH_REQUIRED' : 'BILLING_SEARCH_FAILED', status: listPage.status };
        const streetSelect = listPage.doc.querySelector('select[name="dopfield_5"]');
        if (!streetSelect) return { ok: false, code: 'BILLING_ADDRESS_FORM_UNAVAILABLE' };

        const sought = normalize(lookupRequest.value);
        const options = [...streetSelect.options]
          .map(option => ({ value: String(option.value || '').trim(), label: compact(option.textContent || '', 180) }))
          .filter(item => item.value && item.label && !/выбер|оберіть|---/i.test(item.label))
          .map(item => {
            const full = normalize(item.label);
            const core = normalize(item.label.replace(/\([^)]*\)/g, ' '));
            const tokens = core.split(' ').filter(token => token.length >= 3);
            const matched = tokens.filter(token => sought.includes(token)).length;
            const ratio = tokens.length ? matched / tokens.length : 0;
            const direct = core && sought.includes(core) ? 100 : 0;
            return { ...item, score: direct + Math.round(ratio * 60), core };
          })
          .filter(item => item.score >= 35)
          .sort((a, b) => b.score - a.score);
        if (!options.length) return { ok: false, code: 'ADDRESS_STREET_NOT_FOUND' };
        const best = options[0];
        const tied = options.filter(item => item.score === best.score);
        if (tied.length > 1) {
          return {
            ok: false,
            code: 'ADDRESS_STREET_AMBIGUOUS',
            streets: tied.slice(0, 8).map(item => item.label)
          };
        }

        const source = String(lookupRequest.value || '');
        const apartment = source.match(/(?:кв(?:артира)?\.?|apartment)\s*[:#№-]?\s*([0-9A-Za-zА-Яа-яІіЇїЄєҐґ/-]+)/i)?.[1] || '';
        const explicitBuilding = source.match(/(?:буд(?:инок)?\.?|дом|д\.?|house)\s*[:#№-]?\s*(\d+)\s*([A-Za-zА-Яа-яІіЇїЄєҐґ]?)\b/i);
        let building = explicitBuilding?.[1] || '';
        let block = explicitBuilding?.[2] || '';
        if (!building) {
          const numericParts = source.split(',').map(part => part.trim()).filter(Boolean)
            .map(part => part.match(/^(\d+)\s*([A-Za-zА-Яа-яІіЇїЄєҐґ]?)$/))
            .filter(Boolean);
          if (numericParts.length) {
            building = numericParts[0][1] || '';
            block = numericParts[0][2] || '';
          }
        }
        if (!building) return { ok: false, code: 'ADDRESS_BUILDING_REQUIRED', street: best.label };

        addressResolution = { street: best.label, building, block, apartment };
        searchUrl = makeUrl({
          ...baseParams,
          tmpl: '2',
          f: 'd',
          dopfield_5: best.value,
          dopfield_full_5: '1',
          dopfield_6: building,
          dopfield_full_6: '1',
          dopfield_11: block,
          dopfield_full_11: '1',
          dopfield_8: apartment,
          dopfield_full_8: '1'
        });
      } else {
        searchUrl = makeUrl({
          ...baseParams,
          f: 'n',
          what_search: lookupRequest.mode,
          name: lookupRequest.value
        });
      }

      const searchPage = await fetchDoc(searchUrl);
      if (!searchPage.ok) return { ok: false, code: 'BILLING_SEARCH_FAILED', status: searchPage.status };
      if (authPage(searchPage.doc)) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };

      const ids = new Map();
      const addCandidate = (id, rowText = '') => {
        const normalizedId = String(id || '').replace(/\D+/g, '').slice(0, 12);
        if (!normalizedId) return;
        if (!ids.has(normalizedId)) ids.set(normalizedId, compact(rowText, 800));
      };

      if (String(searchPage.url.searchParams.get('a') || '').toLowerCase() === 'user') {
        addCandidate(searchPage.url.searchParams.get('id') || '', searchPage.doc.body?.textContent || '');
      }
      for (const link of searchPage.doc.querySelectorAll('a[href]')) {
        try {
          const target = new URL(link.getAttribute('href') || '', searchPage.url);
          if (String(target.searchParams.get('a') || '').toLowerCase() !== 'user') continue;
          addCandidate(target.searchParams.get('id') || '', link.closest('tr')?.textContent || link.textContent || '');
        } catch {}
      }

      const foundIds = [...ids.keys()].slice(0, 8);
      if (!foundIds.length) {
        return {
          ok: true,
          code: 'NOT_FOUND',
          candidates: [],
          snapshots: {},
          addressResolution
        };
      }

      const candidates = [];
      const snapshots = {};
      for (const billingId of foundIds) {
        const mainUrl = makeUrl({ pp, ...(uu ? { uu } : {}), a: 'user', id: billingId });
        const mainPage = await fetchDoc(mainUrl);
        if (!mainPage.ok || authPage(mainPage.doc)) continue;
        let snapshot = readMain(mainPage.doc, billingId);

        const addressUrl = makeUrl({ pp, ...(uu ? { uu } : {}), a: 'dopdata', parent_type: '0', id: billingId, tmpl: '2' });
        try {
          const addressPage = await fetchDoc(addressUrl);
          if (addressPage.ok && !authPage(addressPage.doc)) snapshot = merge(snapshot, { address: readAddress(addressPage.doc) });
        } catch {}

        snapshot.billingId = billingId;
        snapshot.observedAt = new Date().toISOString();
        if (snapshot.finance) snapshot.financeObservedAt = snapshot.observedAt;
        snapshot.source = 'billing-live-read-only';
        snapshots[billingId] = snapshot;
        candidates.push({
          billingId,
          contract: compact(snapshot.identity?.contract || '', 80),
          login: compact(snapshot.identity?.login || '', 80),
          fullName: compact(snapshot.identity?.fullName || '', 180),
          address: compact(snapshot.address?.full || '', 260),
          ip: compact(snapshot.network?.ip || '', 80),
          resultText: ids.get(billingId) || ''
        });
      }

      return {
        ok: true,
        code: candidates.length ? 'OK' : 'NOT_FOUND',
        candidates,
        snapshots,
        addressResolution
      };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_SEARCH_NO_RESULT' };
}

export async function searchBillingLive(toolArgs = {}) {
  const request = classifyBillingLookup(toolArgs);
  if (!request) {
    return { ok: false, code: 'IDENTITY_QUERY_REQUIRED', candidates: [], snapshots: {} };
  }
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) {
    return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE', candidates: [], snapshots: {} };
  }

  const tabs = await billingTabs();
  if (!tabs.length) {
    return { ok: false, code: 'BILLING_TAB_REQUIRED', candidates: [], snapshots: {} };
  }

  let last = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    try {
      const outcome = await executeSearch(tab.id, request);
      last = outcome;
      if (outcome?.ok || !['BILLING_SESSION_REQUIRED', 'BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID'].includes(String(outcome?.code || ''))) {
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
