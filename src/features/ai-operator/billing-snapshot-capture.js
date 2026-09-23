'use strict';

(() => {
  const STORE_KEY = 'simnet_ai_operator_billing_snapshots_v1';
  if (!/^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname)) return;

  const params = new URLSearchParams(location.search);
  const action = String(params.get('a') || '');
  if (!['user', 'dopdata'].includes(action)) return;

  function clean(value, max = 500) {
    const out = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
  }

  function selected(name) {
    const node = document.querySelector(`select[name="${CSS.escape(name)}"]`);
    if (!node) return '';
    const option = node.options?.[node.selectedIndex];
    return clean(option?.textContent || node.value || '');
  }

  function input(name) {
    const node = document.querySelector(`[name="${CSS.escape(name)}"]`);
    return clean(node?.value || '');
  }

  let _rowIndex = null;
  function rowIndex() {
    if (_rowIndex) return _rowIndex;
    const map = [];
    const tables = document.querySelectorAll('table');
    for (let t = 0; t < tables.length; t += 1) {
      const rows = tables[t].rows;
      if (!rows) continue;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const cells = row.cells;
        if (!cells || cells.length < 2) continue;
        const label = clean(cells[0].textContent || '', 220).toLowerCase();
        if (!label) continue;
        const last = cells[cells.length - 1];
        const control = last.querySelector('select,input:not([type="hidden"]),textarea');
        const hiddenValues = [...last.querySelectorAll('input[type="hidden"]')]
          .map(node => clean(node.value || ''))
          .filter(Boolean);
        let value = '';
        if (control?.tagName === 'SELECT') {
          value = clean(control.options?.[control.selectedIndex]?.textContent || control.value || '');
        } else if (control) {
          value = clean(control.value || '');
        } else {
          value = clean(last.textContent || '');
          if (!value && hiddenValues.length === 1) value = hiddenValues[0];
        }
        map.push([label, value]);
      }
    }
    _rowIndex = map;
    return map;
  }

  function rowValue(patterns) {
    const index = rowIndex();
    for (let i = 0; i < index.length; i += 1) {
      const [label, value] = index[i];
      if (patterns.some(pattern => pattern.test(label))) return value;
    }
    return '';
  }

  function money(value) {
    const match = clean(value).replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function booleanSelect(name) {
    const value = String(document.querySelector(`select[name="${CSS.escape(name)}"]`)?.value ?? '').trim();
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  }

  function billingId() {
    return clean(params.get('id') || document.querySelector('input[name="id"]')?.value || '', 80);
  }

  function loginFromPage() {
    const fromInput = input('name');
    if (fromInput) return fromInput.toLowerCase();
    const fromAuth = document.querySelector('table.usrlist tbody tr td:nth-child(5)');
    const authLogin = clean(fromAuth?.textContent || '', 80);
    if (authLogin) return authLogin.toLowerCase();
    return '';
  }

  function composeAddress(address = {}) {
    return [
      address.street,
      address.building ? `буд. ${address.building}` : '',
      address.block ? `блок ${address.block}` : '',
      address.entrance ? `під'їзд ${address.entrance}` : '',
      address.floor ? `поверх ${address.floor}` : '',
      address.apartment ? `кв. ${address.apartment}` : ''
    ].filter(Boolean).join(', ');
  }

  function temporaryPaymentText() {
    const candidates = document.querySelectorAll('.modified, .alert, .warning, font[color], b, strong');
    let best = '';
    for (let i = 0; i < candidates.length; i += 1) {
      const value = clean(candidates[i].textContent || '', 260);
      if (value.length > 240 || value.length < 8) continue;
      if (!/временн(?:ый|ого)\s+плат[её]ж/i.test(value)) continue;
      if (!best || value.length < best.length) best = value;
    }
    if (best) return best;
    const index = rowIndex();
    for (let i = 0; i < index.length; i += 1) {
      const value = index[i][1];
      if (value.length <= 240 && /временн(?:ый|ого)\s+плат[её]ж/i.test(value)) {
        if (!best || value.length < best.length) best = value;
      }
    }
    return best;
  }

  function readPayments() {
    const table = document.querySelector('#my_x_16');
    if (!table) return [];
    return [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].map(row => {
      const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
      return {
        date: clean(cells[0]?.textContent || '', 80),
        description: clean(cells[1]?.textContent || '', 220),
        amount: clean(cells[2]?.textContent || '', 100)
      };
    }).filter(item => item.date || item.description || item.amount).slice(0, 6);
  }

  function readActiveServices() {
    const services = [];
    for (const checkbox of document.querySelectorAll('input[type="checkbox"][name^="sr"]')) {
      if (!checkbox.checked) continue;
      const outerRow = checkbox.closest('tr');
      const innerRow = checkbox.closest('table')?.querySelector('tr') || outerRow;
      const cells = innerRow ? [...innerRow.querySelectorAll(':scope > td, :scope > th')] : [];
      const rawName = clean(cells[0]?.textContent || '', 220).replace(/^услуга\s*/i, '');
      const amountText = clean(cells[cells.length - 1]?.textContent || '', 120);
      services.push({
        name: rawName || clean(checkbox.name, 80),
        amount: money(amountText),
        amountText
      });
    }
    return services.slice(0, 20);
  }

  function readAuthorization() {
    const row = document.querySelector('table.usrlist tbody tr');
    if (!row) return {};
    const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
    const title = clean(row.querySelector('img[title]')?.getAttribute('title') || '', 180);
    return {
      title,
      authorized: /авторизован/i.test(title) && !/не\s+авторизован/i.test(title),
      accessAllowed: /доступ\s+разреш/i.test(title),
      lastActivity: clean(cells[2]?.textContent || '', 80),
      billingId: clean(cells[3]?.textContent || '', 80),
      login: clean(cells[4]?.textContent || '', 80),
      ip: clean(cells[5]?.textContent || '', 80)
    };
  }

  function readMain() {
    const login = loginFromPage();
    const contract = clean(input('contract'), 80);
    const temporaryText = temporaryPaymentText();
    const auth = readAuthorization();
    const activeServices = readActiveServices();
    const activeServiceAmounts = activeServices.map(item => item.amount).filter(Number.isFinite);
    const activeServicesComplete = activeServices.length === activeServiceAmounts.length;
    const activeServicesTotal = activeServicesComplete
      ? activeServiceAmounts.reduce((sum, value) => sum + value, 0)
      : null;
    const totalDue = money(rowValue([/^разом до сплати/i, /^итого к оплате/i]));
    const derivedBaseTariffAmount = Number.isFinite(totalDue) && Number.isFinite(activeServicesTotal)
      ? Math.max(0, totalDue - activeServicesTotal)
      : null;

    return {
      identity: {
        billingId: billingId() || auth.billingId,
        contract,
        login: login || auth.login,
        fullName: clean(input('fio'), 240),
        contractDate: clean(input('contract_date'), 80)
      },
      service: {
        group: selected('grp'),
        currentTariff: selected('paket'),
        nextTariff: document.querySelector('select[name="next_paket"]') ? selected('next_paket') : null,
        nextTariffDelay: selected('next_paket_delay'),
        accessState: selected('state'),
        serviceState: selected('cstate'),
        startDay: input('start_day'),
        limit: rowValue([/^лимит$/i]),
        activeServices,
        activeServicesTotal,
        derivedBaseTariffAmount
      },
      finance: {
        accountBalance: money(rowValue([/^на счету,?\s*грн/i, /^на рахунку,?\s*грн/i])),
        price: money(rowValue([/^ціна,?\s*грн/i, /^цена,?\s*грн/i])),
        priceSemantics: 'generic_price_row_not_guaranteed_to_be_internet_tariff',
        totalDue,
        totalDueSemantics: 'current_billing_total_for_rendered_service_set_not_future_charge',
        balanceAfterTariff: money(rowValue([/на счете с учетом стоимости тарифного плана/i, /на рахунку з урахуванням вартості тарифного плану/i])),
        balanceWithoutTemporary: money(rowValue([/на счете без учета временных платежей/i, /на рахунку без урахування тимчасових платежів/i])),
        temporaryPayment: money(temporaryText),
        temporaryPaymentText: temporaryText,
        discountText: rowValue([/^скидк/i, /^знижк/i, /^discount/i]) || '',
        discountSemantics: 'billing_observed_discount_field_raw_units_not_assumed'
      },
      network: {
        ip: clean(input('ip') || auth.ip, 80),
        authorization: auth,
        trafficIncomingBytes: clean(rowValue([/інтернет входящий, байт/i, /интернет входящий, байт/i]), 120),
        trafficOutgoingBytes: clean(rowValue([/інтернет исходящий, байт/i, /интернет исходящий, байт/i]), 120)
      },
      payments: readPayments()
    };
  }

  function readTechnical() {
    const olt = selected('dopfield_29');
    const oltIp = olt.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '';
    const eponOnuMac = clean(input('dopfield_19'), 100);
    const gponOntSerial = clean(input('dopfield_38'), 120);
    let technologyHint = '';
    if (eponOnuMac && gponOntSerial) technologyHint = 'PON (EPON/GPON identifiers both present)';
    else if (gponOntSerial) technologyHint = 'GPON';
    else if (eponOnuMac) technologyHint = 'EPON';
    else if (/\bGPON\b/i.test(olt)) technologyHint = 'GPON';
    else if (/\bEPON\b/i.test(olt)) technologyHint = 'EPON';
    else if (/\bOLT\b|HUAWEI|BDCOM|GCOM/i.test(olt)) technologyHint = 'PON';

    return {
      technical: {
        subscriberMac: clean(input('dopfield_4'), 100),
        eponOnuMac,
        gponOntSerial,
        technologyHint,
        olt,
        oltIp,
        staticIpConfigured: booleanSelect('dopfield_44'),
        onuWithCableTv: booleanSelect('dopfield_37'),
        comment: clean(input('dopfield_34'), 500)
      }
    };
  }

  function readAddress() {
    const address = {
      street: selected('dopfield_5'),
      building: input('dopfield_6'),
      block: input('dopfield_11'),
      entrance: input('dopfield_12'),
      floor: input('dopfield_7'),
      apartment: input('dopfield_8')
    };
    address.full = composeAddress(address);
    return {
      address,
      contacts: {
        phone: input('dopfield_9'),
        extraPhone: input('dopfield_22'),
        email: input('dopfield_14')
      },
      customer: {
        subscriberType: selected('dopfield_31'),
        contractedWith: selected('dopfield_32'),
        edrpou: input('dopfield_33'),
        manager: selected('dopfield_43'),
        connectedBy: selected('dopfield_25'),
        comment: clean(input('dopfield_10'), 500)
      }
    };
  }

  function deepMerge(target, patch) {
    const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === undefined) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = deepMerge(out[key], value);
      else out[key] = value;
    }
    return out;
  }

  async function capture() {
    _rowIndex = null;
    const id = billingId();
    if (!id) return;
    let patch = {};
    if (action === 'user') patch = readMain();
    if (action === 'dopdata') {
      const tmpl = String(params.get('tmpl') || document.querySelector('input[name="tmpl"]')?.value || '');
      if (tmpl === '1') patch = readTechnical();
      else if (tmpl === '2') patch = readAddress();
      else return;
      const login = loginFromPage();
      if (login) patch.identity = { ...(patch.identity || {}), billingId: id, login };
    }

    const stored = await chrome.storage.local.get(STORE_KEY);
    const all = stored?.[STORE_KEY] && typeof stored[STORE_KEY] === 'object' ? stored[STORE_KEY] : {};
    const current = all[id] && typeof all[id] === 'object' ? all[id] : {};
    const next = deepMerge(current, patch);
    next.billingId = id;
    next.observedAt = new Date().toISOString();
    if (action === 'user') next.financeObservedAt = next.observedAt;
    next.fieldObservedAt = { ...(current.fieldObservedAt || {}) };
    for (const section of ['finance', 'service']) {
      for (const field of Object.keys(current[section] || {})) {
        const key = `${section}.${field}`;
        if (!next.fieldObservedAt[key]) next.fieldObservedAt[key] = current.financeObservedAt || current.observedAt || '';
      }
      for (const field of Object.keys(patch[section] || {})) next.fieldObservedAt[`${section}.${field}`] = next.observedAt;
    }
    next.source = 'billing-dom-read-only';
    all[id] = next;

    const trimmed = Object.values(all)
      .sort((a, b) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0))
      .slice(0, 120);
    await chrome.storage.local.set({ [STORE_KEY]: Object.fromEntries(trimmed.map(item => [String(item.billingId), item])) });
  }

  void capture().catch(error => console.warn('[SIMNET AI operator] billing snapshot capture failed', error));
})();
