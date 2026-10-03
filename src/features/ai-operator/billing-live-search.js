'use strict';

import { normalizeBillingTariffSnapshot } from './billing-tariff-normalizer.js';
import { normalizeHouseSuffix, normalizeStreetPart, streetVariants } from './building-snapshot-tool.js';
import { requestBillingCapture } from './billing-login-live.js';

const ADDRESS_READ_MESSAGE = 'SIMNET_AI_BILLING_ADDRESS_READ_V2';

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

export function normalizeContractIdentifier(value) {
  let candidate = clean(value, 120)
    .replace(/^\s*(?:договор|договір|contract)\s*(?:№|#|no\.?|номер)?\s*[:=\-]?\s*/i, '')
    .replace(/^\s*(?:номер|№|#)\s*(?:договора|договору|договору)?\s*[:=\-]?\s*/i, '')
    .replace(/\s+/g, '')
    .replace(/^["'`()\[\]{}<>:;,]+|["'`()\[\]{}<>:;,]+$/g, '');
  if (!candidate || candidate.length > 80) return '';
  if (!/^[0-9A-Za-zА-Яа-яІіЇїЄєҐґ._\/-]+$/.test(candidate)) return '';
  if (!/\d/.test(candidate)) return '';
  return candidate;
}

export function extractContractIdentifier(value) {
  const source = clean(value, 320);
  if (!source) return '';
  const patterns = [
    /(?:договор|договір|contract)\s*(?:№|#|no\.?|номер)?\s*[:=\-]?\s*([0-9A-Za-zА-Яа-яІіЇїЄєҐґ][0-9A-Za-zА-Яа-яІіЇїЄєҐґ._\/-]{0,79})/i,
    /(?:номер|№|#)\s*(?:договора|договору|договору)\s*[:=\-]?\s*([0-9A-Za-zА-Яа-яІіЇїЄєҐґ][0-9A-Za-zА-Яа-яІіЇїЄєҐґ._\/-]{0,79})/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const normalized = normalizeContractIdentifier(match?.[1] || '');
    if (normalized) return normalized;
  }
  return '';
}

function looksLikeStandaloneAlphanumericContract(value) {
  const compact = clean(value, 100).replace(/\s+/g, '');
  if (!/^[0-9A-Za-zА-Яа-яІіЇїЄєҐґ._\/-]{3,40}$/.test(compact)) return false;
  if (!/\d/.test(compact) || !/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(compact)) return false;
  // Avoid turning ordinary lowercase words containing a digit into contract lookup.
  return /[A-ZА-ЯІЇЄҐ]/.test(compact) || /[\/-]/.test(compact);
}

export function classifyBillingLookup(toolArgs = {}) {
  const explicitLogin = clean(toolArgs.login, 80).replace(/\s+/g, '').toLowerCase();
  const explicitContract = normalizeContractIdentifier(toolArgs.contract);
  const explicitIp = normalizeIp(toolArgs.ip);
  const address = clean(toolArgs.address, 320);
  const query = clean(toolArgs.query, 320);
  if (/^abon\d{3,12}$/i.test(explicitLogin)) return { mode: 'login', value: explicitLogin };
  if (explicitContract) return { mode: 'contract', value: explicitContract };
  if (explicitIp) return { mode: 'ip', value: explicitIp };
  if (address) return { mode: 'address', value: address };
  const compactQuery = query.replace(/\s+/g, '');
  if (/^abon\d{3,12}$/i.test(compactQuery)) return { mode: 'login', value: compactQuery.toLowerCase() };
  const phrasedContract = extractContractIdentifier(query);
  if (phrasedContract) return { mode: 'contract', value: phrasedContract };
  if (/^\d{3,12}$/.test(compactQuery)) return { mode: 'contract', value: compactQuery };
  if (looksLikeStandaloneAlphanumericContract(query)) return { mode: 'contract', value: normalizeContractIdentifier(compactQuery) };
  const queryIp = normalizeIp(query);
  if (queryIp) return { mode: 'ip', value: queryIp };
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

// Share the existing building tool's street/alias rules. Spelling tolerance is
// for lookup only; the canonical address remains the label returned by Billing.
function lookupStreetPart(value) {
  return normalizeStreetPart(value).replace(/^[-–—>\s]+/, '').replace(/[ії]/g, 'и').replace(/є/g, 'е');
}

function streetWordDistance(left, right) {
  if (left === right) return 0;
  // Numbers and short words cannot be repaired into a different street name.
  const limit = Math.min(left.length, right.length) >= 6 ? 2 : 1;
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > limit
      || !/^[\p{L}-]+$/u.test(left) || !/^[\p{L}-]+$/u.test(right)) return Infinity;
  let row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= right.length; j += 1) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(left[i - 1] !== right[j - 1]));
    }
    row = next;
  }
  return row[right.length] <= limit ? row[right.length] : Infinity;
}

function matchStreetForm(form, queryTokens) {
  const tokens = form.split(' ').filter(Boolean);
  if (!tokens.length) return null;
  let best = null;
  for (let start = 0; start <= queryTokens.length - tokens.length; start += 1) {
    const words = queryTokens.slice(start, start + tokens.length);
    const distances = tokens.map((token, i) => streetWordDistance(token, words[i]));
    const edits = distances.reduce((sum, distance) => sum + distance, 0);
    if (!Number.isFinite(edits) || edits > Math.max(1, Math.floor(tokens.join('').length / 4))) continue;
    if (edits && (tokens.length === 1 ? edits > 1 : !distances.includes(0))) continue;
    const score = (edits ? 100 - edits : 1000) + tokens.length;
    if (!best || score > best.score) best = { score, edits, form, queryForm: words.join(' ') };
  }
  return best;
}

function addressLocality(value = '') {
  return lookupStreetPart(value)
    .replace(/(?:^|\s)(?:сб|софиевская(?:\s+борщаговка)?|софіївська(?:\s+борщагівка)?)(?=\s|$)/gu, ' софиевская борщаговка ')
    .replace(/\s+/g, ' ').trim();
}

function isLocalityAlias(value = '') {
  return /^(?:сб|софиевская(?: борщаговка)?|софиивська(?: борщагивка)?|с\s|село\s|смт\s)/u.test(lookupStreetPart(value));
}

export function resolveAddressRequest(streets = [], value = '') {
  const normalize = lookupStreetPart;
  const queryTokens = normalize(value).split(' ').filter(Boolean);
  const usable = [...new Map(streets
    .filter(item => {
      const label = String(item.label || '').trim().replace(/^[-–—\s]+/, '');
      return item.value && label && !item.disabled && !/^(?:выбер[\p{L}]*|обер[\p{L}]*|select|choose)(?:\s|$)/iu.test(label);
    })
    .map(item => [item.value, item])).values()];
  if (!usable.length) return { ok: false, code: 'BILLING_STREET_DICTIONARY_UNAVAILABLE' };
  const options = usable
    .map(item => {
      const forms = streetVariants(item.label).filter((form, index) => index === 0 || !isLocalityAlias(form)).map(normalize);
      const matches = forms.map(form => matchStreetForm(form, queryTokens)).filter(Boolean).sort((a, b) => b.score - a.score);
      return { ...item, forms, match: matches[0] };
    })
    .filter(item => item.match)
    .sort((a, b) => b.match.score - a.match.score);
  if (!options.length) return { ok: false, code: 'ADDRESS_STREET_NOT_FOUND' };
  const best = options[0];
  // A unique exact name wins. Several plausible typo matches require an
  // explicit clarification, even if one happens to be one edit closer.
  let tied = options.filter(item => best.match.edits ? item.match.edits : item.match.score === best.match.score);
  if (tied.length > 1) {
    const contextScore = item => [...String(item.label).matchAll(/\(([^()]*)\)/g)]
      .map(match => addressLocality(match[1])).filter(form => form && ` ${addressLocality(value)} `.includes(` ${form} `)).length;
    const mostContext = Math.max(...tied.map(contextScore));
    if (mostContext) tied = tied.filter(item => contextScore(item) === mostContext);
  }
  if (tied.length > 1) return { ok: false, code: 'ADDRESS_STREET_AMBIGUOUS', streets: tied.slice(0, 8).map(item => item.label) };
  const selectedStreet = tied[0];
  const source = String(value || '');
  const apartment = source.match(/(?:^|[\s,;])(?:кв(?:артира)?|apartment)(?:\.\s*|\s+|[:#№-]\s*|(?=\d))[:#№-]?\s*([\p{L}\d/-]+)/iu)?.[1] || '';
  const explicitBuilding = source.match(/(?:^|[\s,;])(?:буд(?:инок)?|дом|д|house)\.?\s*[:#№-]?\s*(\d+(?:\s*[/\-]\s*[\p{L}\d]+)*(?:\s*[\p{L}])?)(?=$|[\s,;.!?"»])/iu);
  let building = explicitBuilding?.[1] || '';
  const block = source.match(/(?:^|[\s,;])(?:блок|корпус|корп|block|літера|литера)(?:\.\s*|\s+|[:#№-]\s*)[:#№-]?\s*([\p{L}\d]+)/iu)?.[1] || '';
  if (!building) {
    const beforeUnit = source.split(/(?:^|[\s,;])(?:кв(?:артира)?|apartment|блок|корпус|корп|block|літера|литера|під'?їзд|подъезд|поверх|этаж)\.?(?=[\s.:#№\d-])/iu)[0];
    // A later question can contain amounts and other numbers. Only a number
    // immediately after a matched street form is an unlabelled house.
    const streetForms = [selectedStreet.match.queryForm, ...selectedStreet.forms, normalize(selectedStreet.label)];
    for (const match of beforeUnit.matchAll(/(?:^|[,\s])(\d+(?:\s*[/\-]\s*[\p{L}\d]+)*(?:\s*[\p{L}])?)(?=$|[\s,;.!?"»])/gu)) {
      const prefix = normalize(beforeUnit.slice(0, match.index).replace(/\([^)]*\)/g, ' ')).replace(/(?:\s+)(?:сб|софиевская борщаговка|софиивська борщагивка)$/u, '').trim();
      if (streetForms.some(street => prefix === street || prefix.endsWith(` ${street}`))) {
        building = match[1];
        break;
      }
    }
  }
  building = building.replace(/\s+/g, '');
  if (!building) return { ok: false, code: 'ADDRESS_BUILDING_REQUIRED', street: selectedStreet.label };
  const compound = building.match(/^(\d+)[/\-]([\p{L}\d]+)$/u) || building.match(/^(\d+)([\p{L}])$/u);
  let alternate = null;
  if (!block && compound) {
    const normalized = normalizeHouseSuffix(compound[2]);
    const suffix = compound[2] === compound[2].toUpperCase() ? normalized.toUpperCase() : normalized;
    alternate = { building: compound[1], block: suffix };
  }
  return { ok: true, streetId: selectedStreet.value, street: selectedStreet.label, building, block, apartment, alternate,
    matchType: selectedStreet.match.edits ? 'source-name-typo' : 'normalized-source-name' };
}

function nativeAddressParams(address) {
  return {
    a: 'listuser', tmpl: '2', f: 'd',
    dopfield_5: address.streetId, dopfield_full_5: '1',
    dopfield_6: address.building, dopfield_full_6: '1',
    dopfield_11: address.block, dopfield_full_11: '1',
    dopfield_8: address.apartment, dopfield_full_8: '1'
  };
}

async function readRenderedStreetOptions(tabId) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      if (!/^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname)) return [];
      const select = document.querySelector('select[name="dopfield_5"]');
      if (!select) return [];
      const widget = select.selectize;
      if (widget?.options && Object.keys(widget.options).length) {
        const valueField = widget.settings?.valueField || 'value';
        const labelField = widget.settings?.labelField || 'text';
        return Object.entries(widget.options).map(([key, option]) => ({
          value: String(option[valueField] ?? key).trim(),
          label: String(option[labelField] || '').replace(/\s+/g, ' ').trim().slice(0, 500),
          disabled: Boolean(option.disabled)
        }));
      }
      return [...select.options].map(option => ({
        value: String(option.value || '').trim(), label: String(option.label || option.textContent || '').trim().slice(0, 500),
        disabled: Boolean(option.disabled)
      }));
    }
  });
  return Array.isArray(execution?.result) ? execution.result : [];
}

async function executeAddressSearch(tabId, request) {
  const prepared = await requestBillingCapture(tabId, { phase: 'streets' }, ADDRESS_READ_MESSAGE);
  if (!prepared?.ok) return prepared;
  let selection = resolveAddressRequest(prepared.streets || [], request.value);
  let diagnostics = { ...prepared.addressSearch, nativeOptionCount: prepared.streets?.length || 0, renderedOptionCount: 0 };
  if (['ADDRESS_STREET_NOT_FOUND', 'BILLING_STREET_DICTIONARY_UNAVAILABLE'].includes(selection.code)) {
    // Enhanced controls may keep only the selected option in native HTML. Read
    // the actual initialized widget once; never infer a dictionary from the user.
    let rendered = [];
    try { rendered = await readRenderedStreetOptions(tabId); } catch {}
    if (rendered.length) selection = resolveAddressRequest([...rendered, ...(prepared.streets || [])], request.value);
    diagnostics = { ...diagnostics, renderedOptionCount: rendered.length,
      dictionarySource: rendered.length ? 'native-address-form+rendered-street-widget' : diagnostics.dictionarySource };
  }
  if (!selection.ok) return { ...selection, addressSearch: { ...diagnostics, stage: 'street-selection',
    // Public street labels only; no subscriber records or session parameters.
    streetSamples: (prepared.streets || []).filter(item => item.value && item.label && !item.disabled).slice(0, 3).map(item => clean(item.label, 180))
  } };
  const { ok: _ok, streetId, alternate, matchType, ...literalAddress } = selection;
  let address = literalAddress;
  let formAttempts = 1;
  let searched = await requestBillingCapture(tabId, { phase: 'search', params: nativeAddressParams(selection) }, ADDRESS_READ_MESSAGE);
  if (searched?.ok && !searched.candidateRefs?.length && alternate) {
    formAttempts += 1;
    address = { ...literalAddress, ...alternate };
    searched = await requestBillingCapture(tabId, { phase: 'search', params: nativeAddressParams({ ...address, streetId }) }, ADDRESS_READ_MESSAGE);
  }
  diagnostics = { ...diagnostics, stage: 'address-submit', matchType, formAttempts, street: selection.street, building: address.building, block: address.block, apartment: address.apartment };
  if (!searched?.ok) return { ...searched, addressSearch: diagnostics };
  if (!searched.candidateRefs?.length) return { ok: true, code: 'NOT_FOUND', candidates: [], snapshots: {}, addressResolution: address, addressSearch: diagnostics };
  const outcome = await executeSearch(tabId, { ...request, addressSelection: { ...address, streetId }, candidateRefs: searched.candidateRefs });
  return { ...outcome, addressSearch: { ...diagnostics, stage: 'candidate-read' }, transport: 'native-form-submit-hidden-iframe' };
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
      const input = (doc, name) => compact(doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '', 240);
      const selected = (doc, name) => {
        const node = doc.querySelector(`select[name="${CSS.escape(name)}"]`);
        if (!node) return '';
        return compact(node.options?.[node.selectedIndex]?.textContent || node.value || '', 240);
      };
      const booleanSelect = (doc, name) => {
        const value = String(doc.querySelector(`select[name="${CSS.escape(name)}"]`)?.value ?? '').trim();
        if (value === '1') return true;
        if (value === '0') return false;
        return null;
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
      const temporaryPaymentText = doc => [...doc.querySelectorAll('.modified,td,span,p,div')]
        .map(node => compact(node.textContent || '', 260))
        .filter(value => value.length <= 240 && /временн(?:ый|ого)\s+плат[её]ж/i.test(value))
        .sort((a, b) => a.length - b.length)[0] || '';
      const readPayments = doc => {
        const table = doc.querySelector('#my_x_16');
        if (!table) return [];
        return [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].map(row => {
          const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
          return {
            date: compact(cells[0]?.textContent || '', 80),
            description: compact(cells[1]?.textContent || '', 220),
            amount: compact(cells[2]?.textContent || '', 100)
          };
        }).filter(item => item.date || item.description || item.amount).slice(0, 6);
      };
      const readAuthorization = doc => {
        const row = doc.querySelector('table.usrlist tbody tr');
        if (!row) return {};
        const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
        const title = compact(row.querySelector('img[title]')?.getAttribute('title') || '', 180);
        return {
          title,
          authorized: /авторизован/i.test(title) && !/не\s+авторизован/i.test(title),
          accessAllowed: /доступ\s+разреш/i.test(title),
          lastActivity: compact(cells[2]?.textContent || '', 80),
          billingId: compact(cells[3]?.textContent || '', 80),
          login: compact(cells[4]?.textContent || '', 80),
          ip: compact(cells[5]?.textContent || '', 80)
        };
      };
      const readActiveServices = doc => {
        if (!doc.querySelector('select[name="paket"]')) return [];
        return [...doc.querySelectorAll('input[type="checkbox"][name^="sr"]')].filter(c => c.checked).map(c => {
          const row = c.closest('tr') || c.closest('table')?.querySelector('tr');
          const cells = row ? [...row.querySelectorAll(':scope > td, :scope > th')] : [];
          const amountText = compact(cells.at(-1)?.textContent || '', 120);
          return {
            name: compact(cells[0]?.textContent || c.name, 220).replace(/^услуга\s*/i, ''),
            amount: money(amountText),
            amountText
          };
        }).slice(0, 20);
      };
      const readAddress = doc => {
        const address = {
          street: selected(doc, 'dopfield_5'),
          building: input(doc, 'dopfield_6'),
          block: input(doc, 'dopfield_11'),
          entrance: input(doc, 'dopfield_12'),
          floor: input(doc, 'dopfield_7'),
          apartment: input(doc, 'dopfield_8')
        };
        address.full = [
          address.street,
          address.building ? `буд. ${address.building}` : '',
          address.block ? `блок ${address.block}` : '',
          address.entrance ? `під'їзд ${address.entrance}` : '',
          address.floor ? `поверх ${address.floor}` : '',
          address.apartment ? `кв. ${address.apartment}` : ''
        ].filter(Boolean).join(', ');
        return {
          address,
          contacts: {
            phone: input(doc, 'dopfield_9'),
            extraPhone: input(doc, 'dopfield_22'),
            email: input(doc, 'dopfield_14')
          },
          customer: {
            subscriberType: selected(doc, 'dopfield_31'),
            contractedWith: selected(doc, 'dopfield_32'),
            edrpou: input(doc, 'dopfield_33'),
            manager: selected(doc, 'dopfield_43'),
            connectedBy: selected(doc, 'dopfield_25'),
            comment: compact(input(doc, 'dopfield_10'), 500)
          }
        };
      };
      const readTechnical = doc => {
        const olt = selected(doc, 'dopfield_29');
        const oltIp = olt.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '';
        const eponOnuMac = compact(input(doc, 'dopfield_19'), 100);
        const gponOntSerial = compact(input(doc, 'dopfield_38'), 120);
        let technologyHint = '';
        if (eponOnuMac && gponOntSerial) technologyHint = 'PON (EPON/GPON identifiers both present)';
        else if (gponOntSerial) technologyHint = 'GPON';
        else if (eponOnuMac) technologyHint = 'EPON';
        else if (/\bGPON\b/i.test(olt)) technologyHint = 'GPON';
        else if (/\bEPON\b/i.test(olt)) technologyHint = 'EPON';
        else if (/\bOLT\b|HUAWEI|BDCOM|GCOM/i.test(olt)) technologyHint = 'PON';
        return {
          technical: {
            subscriberMac: compact(input(doc, 'dopfield_4'), 100),
            eponOnuMac,
            gponOntSerial,
            technologyHint,
            olt,
            oltIp,
            staticIpConfigured: booleanSelect(doc, 'dopfield_44'),
            onuWithCableTv: booleanSelect(doc, 'dopfield_37'),
            comment: compact(input(doc, 'dopfield_34'), 500)
          }
        };
      };
      const readMain = (doc, billingId) => {
        const auth = readAuthorization(doc);
        const login = compact(input(doc, 'name') || auth.login || doc.body?.textContent?.match(/\babon\d{3,12}\b/i)?.[0] || '', 80).toLowerCase();
        const contract = compact(input(doc, 'contract'), 80);
        const activeServices = readActiveServices(doc);
        const activeAmounts = activeServices.map(item => item.amount).filter(Number.isFinite);
        const activeServicesTotal = activeServices.length === activeAmounts.length ? Math.round(activeAmounts.reduce((sum, value) => sum + value, 0) * 100) / 100 : null;
        const totalDue = money(rowValue(doc, [/^разом до сплати/i, /^итого к оплате/i]));
        const temporaryText = temporaryPaymentText(doc);
        return {
          identity: {
            billingId: String(billingId || auth.billingId || ''),
            contract,
            login,
            fullName: compact(input(doc, 'fio'), 240),
            contractDate: compact(input(doc, 'contract_date'), 80)
          },
          service: {
            group: selected(doc, 'grp'),
            currentTariff: selected(doc, 'paket'),
            nextTariff: doc.querySelector('select[name="next_paket"]') ? selected(doc, 'next_paket') : null,
            nextTariffDelay: selected(doc, 'next_paket_delay'),
            accessState: selected(doc, 'state'),
            serviceState: selected(doc, 'cstate'),
            startDay: input(doc, 'start_day'),
            limit: rowValue(doc, [/^лимит$/i]),
            activeServices,
            activeServicesTotal,
            derivedBaseTariffAmount: Number.isFinite(totalDue) && Number.isFinite(activeServicesTotal) ? Math.max(0, totalDue - activeServicesTotal) : null
          },
          finance: {
            accountBalance: money(rowValue(doc, [/^на счету,?\s*грн/i, /^на рахунку,?\s*грн/i])),
            price: money(rowValue(doc, [/^ціна,?\s*грн/i, /^цена,?\s*грн/i])),
            priceSemantics: 'generic_price_row_not_guaranteed_to_be_internet_tariff',
            totalDue,
            totalDueSemantics: 'current_billing_total_for_rendered_service_set_not_future_charge',
            balanceAfterTariff: money(rowValue(doc, [/на счете с учетом стоимости тарифного плана/i, /на рахунку з урахуванням вартості тарифного плану/i])),
            balanceWithoutTemporary: money(rowValue(doc, [/на счете без учета временных платежей/i, /на рахунку без урахування тимчасових платежів/i])),
            temporaryPayment: money(temporaryText),
            temporaryPaymentText: temporaryText
          },
          network: {
            ip: compact(input(doc, 'ip') || auth.ip, 80),
            authorization: auth,
            trafficIncomingBytes: compact(rowValue(doc, [/інтернет входящий, байт/i, /интернет входящий, байт/i]), 120),
            trafficOutgoingBytes: compact(rowValue(doc, [/інтернет исходящий, байт/i, /интернет исходящий, байт/i]), 120)
          },
          payments: readPayments(doc)
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
      const fetchDoc = async url => {
        const response = await fetch(url.href, { method: 'GET', credentials: 'include', cache: 'no-store' });
        const html = await decodeResponseHtml(response);
        return { ok: response.ok, status: response.status, url: new URL(response.url || url.href), doc: new DOMParser().parseFromString(html, 'text/html') };
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
      let addressResolution = null;
      const ids = new Map();
      const addCandidate = (id, rowText = '') => {
        const normalizedId = String(id || '').replace(/\D+/g, '').slice(0, 12);
        if (!normalizedId) return;
        if (!ids.has(normalizedId)) ids.set(normalizedId, compact(rowText, 800));
      };
      const collectCandidates = page => {
        if (String(page.url.searchParams.get('a') || '').toLowerCase() === 'user') addCandidate(page.url.searchParams.get('id') || '', page.doc.body?.textContent || '');
        for (const link of page.doc.querySelectorAll('a[href]')) {
          try {
            const target = new URL(link.getAttribute('href') || '', page.url);
            if (String(target.searchParams.get('a') || '').toLowerCase() !== 'user') continue;
            addCandidate(target.searchParams.get('id') || '', link.closest('tr')?.textContent || link.textContent || '');
          } catch {}
        }
      };
      if (lookupRequest.mode === 'address') {
        const { streetId: _streetId, ...address } = lookupRequest.addressSelection;
        addressResolution = address;
        for (const candidate of lookupRequest.candidateRefs || []) addCandidate(candidate.billingId, candidate.rowText);
      } else {
        const searchUrl = makeUrl({ ...baseParams, f: 'n', what_search: lookupRequest.mode, name: lookupRequest.value });
        const searchPage = await fetchDoc(searchUrl);
        if (!searchPage.ok) return { ok: false, code: 'BILLING_SEARCH_FAILED', status: searchPage.status };
        if (authPage(searchPage.doc)) return { ok: false, code: 'BILLING_AUTH_REQUIRED' };
        collectCandidates(searchPage);
      }
      const foundIds = [...ids.keys()].slice(0, 8);
      if (!foundIds.length) return { ok: true, code: 'NOT_FOUND', candidates: [], snapshots: {}, addressResolution };

      const candidates = [];
      const snapshots = {};
      for (const billingId of foundIds) {
        const mainUrl = makeUrl({ pp, ...(uu ? { uu } : {}), a: 'user', id: billingId });
        const mainPage = await fetchDoc(mainUrl);
        if (!mainPage.ok || authPage(mainPage.doc)) continue;
        let snapshot = readMain(mainPage.doc, billingId);
        try {
          const addressPage = await fetchDoc(makeUrl({ pp, ...(uu ? { uu } : {}), a: 'dopdata', parent_type: '0', id: billingId, tmpl: '2' }));
          if (addressPage.ok && !authPage(addressPage.doc)) snapshot = merge(snapshot, readAddress(addressPage.doc));
        } catch {}
        try {
          const technicalPage = await fetchDoc(makeUrl({ pp, ...(uu ? { uu } : {}), a: 'dopdata', parent_type: '0', id: billingId, tmpl: '1' }));
          if (technicalPage.ok && !authPage(technicalPage.doc)) snapshot = merge(snapshot, readTechnical(technicalPage.doc));
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
          connectionFamily: compact(snapshot.technical?.technologyHint || '', 80),
          resultText: ids.get(billingId) || ''
        });
      }
      return { ok: true, code: candidates.length ? 'OK' : 'NOT_FOUND', candidates, snapshots, addressResolution };
    }
  });
  return execution?.result || { ok: false, code: 'BILLING_SEARCH_NO_RESULT' };
}

function normalizeSearchSnapshots(snapshots = {}) {
  return Object.fromEntries(Object.entries(snapshots || {}).map(([id, snapshot]) => [
    id,
    normalizeBillingTariffSnapshot(snapshot, { now: new Date() })
  ]));
}

export async function searchBillingLive(toolArgs = {}) {
  const request = classifyBillingLookup(toolArgs);
  if (!request) return { ok: false, code: 'IDENTITY_QUERY_REQUIRED', candidates: [], snapshots: {} };
  if (!globalThis.chrome?.scripting?.executeScript || !globalThis.chrome?.tabs?.query) return { ok: false, code: 'BILLING_RUNTIME_UNAVAILABLE', candidates: [], snapshots: {} };
  const tabs = await billingTabs();
  if (!tabs.length) return { ok: false, code: 'BILLING_TAB_REQUIRED', candidates: [], snapshots: {} };
  let last = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id)) continue;
    try {
      const outcome = request.mode === 'address' ? await executeAddressSearch(tab.id, request) : await executeSearch(tab.id, request);
      last = outcome;
      if (outcome?.ok || !['BILLING_SESSION_REQUIRED', 'BILLING_AUTH_REQUIRED', 'BILLING_TAB_INVALID'].includes(String(outcome?.code || ''))) {
        return {
          ...outcome,
          snapshots: outcome?.snapshots ? normalizeSearchSnapshots(outcome.snapshots) : outcome?.snapshots,
          request,
          tabId: tab.id,
          source: 'billing-live-read-only'
        };
      }
    } catch (error) {
      last = { ok: false, code: 'BILLING_SEARCH_EXECUTION_FAILED', message: clean(error?.message || error, 500) };
    }
  }
  return { ...(last || { ok: false, code: 'BILLING_SESSION_REQUIRED' }), request, source: 'billing-live-read-only' };
}
