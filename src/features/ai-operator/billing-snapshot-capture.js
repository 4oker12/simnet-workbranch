'use strict';

(() => {
  const BRIDGE_STATE_KEY = '__SIMNET_AI_BILLING_SNAPSHOT_CAPTURE_BRIDGE_V4__';
  const previousBridge = globalThis[BRIDGE_STATE_KEY] && typeof globalThis[BRIDGE_STATE_KEY] === 'object'
    ? globalThis[BRIDGE_STATE_KEY]
    : null;
  if (previousBridge?.listener && chrome?.runtime?.onMessage?.removeListener) {
    try { chrome.runtime.onMessage.removeListener(previousBridge.listener); } catch {}
  }
  const bridgeState = {
    revision: 4,
    listener: null,
    captureStarted: Boolean(previousBridge?.captureStarted),
    requestSeq: Number(previousBridge?.requestSeq || 0)
  };
  globalThis[BRIDGE_STATE_KEY] = bridgeState;

  const STORE_KEY = 'simnet_ai_operator_billing_snapshots_v1';
  const MAIN_FORM_SELECTOR = 'form#formedit > table.tbg1.width100';
  const AUTH_SELECTOR = 'table.usrlist.width100';
  const SUMMARY_SELECTOR = 'table.tbg1.nav3.width100';
  const PAYMENTS_SELECTOR = '#my_x_16';
  const EXACT_LOOKUP_MESSAGE = 'SIMNET_AI_BILLING_EXACT_LOOKUP_V3';
  if (!/^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname)) return;

  const params = new URLSearchParams(location.search);
  const action = String(params.get('a') || '');

  function clean(value, max = 500) {
    const out = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
  }

  function selectedOption(name) {
    const node = document.querySelector(`select[name="${CSS.escape(name)}"]`);
    if (!node) return null;
    const option = node.options?.[node.selectedIndex];
    return {
      value: clean(option?.value ?? node.value ?? '', 80),
      label: clean(option?.textContent || node.value || '', 260)
    };
  }

  function selected(name) {
    return selectedOption(name)?.label || '';
  }

  function input(name) {
    const node = document.querySelector(`[name="${CSS.escape(name)}"]`);
    return clean(node?.value || '');
  }

  let _rowIndex = null;
  function rowIndex() {
    if (_rowIndex) return _rowIndex;
    const map = [];
    const roots = action === 'user'
      ? [document.querySelector(MAIN_FORM_SELECTOR), document.querySelector(SUMMARY_SELECTOR)].filter(Boolean)
      : [document];
    for (const root of roots) {
      const rows = root.querySelectorAll('tr');
      for (const row of rows) {
        const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
        if (cells.length < 2) continue;
        const label = clean(cells[0].textContent || '', 220).toLowerCase();
        if (!label) continue;
        const last = cells[cells.length - 1];
        const control = last.querySelector('select,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea');
        let value = '';
        if (control?.tagName === 'SELECT') {
          value = clean(control.options?.[control.selectedIndex]?.textContent || control.value || '');
        } else if (control) {
          value = clean(control.value || '');
        } else {
          value = clean(last.textContent || '');
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

  function readDiscount() {
    const entries = [];
    let percent = null;
    let adjustmentUAH = null;
    const roots = [document.querySelector(SUMMARY_SELECTOR), document.querySelector(MAIN_FORM_SELECTOR)].filter(Boolean);
    const rows = roots.flatMap(root => [...root.querySelectorAll('tr')]);
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const cells = [...row.querySelectorAll(':scope > td, :scope > th')].map(cell => {
        const control = cell.querySelector('select,input:not([type="hidden"]),textarea');
        let value = '';
        if (control?.tagName === 'SELECT') {
          value = clean(control.options?.[control.selectedIndex]?.textContent || control.value || '', 260);
        } else if (control) {
          value = clean(control.value || '', 260);
        }
        return { text: clean(cell.textContent || '', 260), value };
      }).filter(cell => cell.text || cell.value);
      // Ignore wrapper rows around nested tables. A discount row itself has a
      // direct label cell and a direct value cell.
      if (cells.length < 2) continue;
      const label = clean(cells[0]?.text || '', 260);
      if (!/^(?:скидк|знижк)/iu.test(label)) continue;
      const value = clean(cells.at(-1)?.value || cells.at(-1)?.text || '', 260);
      if (!value) continue;
      const numeric = money(value);
      const raw = clean(row.textContent || `${label} ${value}`, 700);
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
      appliesTo: 'internet_tariff',
      entries
    };
  }

  function readPayments() {
    const table = document.querySelector(PAYMENTS_SELECTOR);
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
    const row = document.querySelector(`${AUTH_SELECTOR} tbody tr`);
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
    const groupOption = selectedOption('grp');
    const currentTariffOption = selectedOption('paket');
    const nextTariffOption = selectedOption('next_paket');
    const tvTariffOption = selectedOption('paket3');
    const nextTvTariffOption = selectedOption('next_paket3');
    const accessOption = selectedOption('state');
    const serviceStateOption = selectedOption('cstate');
    const discountRemoveOption = selectedOption('discount_remove');
    const discount = readDiscount();

    return {
      identity: {
        billingId: billingId() || auth.billingId,
        contract,
        login: login || auth.login,
        fullName: clean(input('fio'), 240),
        contractDate: clean(input('contract_date'), 80),
        ppk: rowValue([/^ппк$/i])
      },
      service: {
        group: groupOption?.label || '',
        groupId: groupOption?.value || '',
        currentTariff: currentTariffOption?.label || '',
        currentTariffSelectedId: currentTariffOption?.value || '',
        currentTariffSelectedLabel: currentTariffOption?.label || '',
        nextTariff: nextTariffOption?.label ?? null,
        nextTariffId: nextTariffOption?.value || '',
        nextTariffDelay: selected('next_paket_delay'),
        tvTariff: tvTariffOption?.label || '',
        tvTariffId: tvTariffOption?.value || '',
        nextTvTariff: nextTvTariffOption?.label ?? null,
        nextTvTariffId: nextTvTariffOption?.value || '',
        nextTvTariffDelay: selected('next_paket3_delay'),
        accessState: accessOption?.label || '',
        accessStateCode: accessOption?.value || '',
        serviceState: serviceStateOption?.label || '',
        serviceStateCode: serviceStateOption?.value || '',
        startDay: input('start_day'),
        limit: rowValue([/^лимит$/i]),
        activeServices,
        activeServicesTotal,
        derivedBaseTariffAmount,
        discountAutoRemove: discountRemoveOption?.label || '',
        discountAutoRemoveCode: discountRemoveOption?.value || '',
        comment: input('comment')
      },
      finance: {
        accountBalance: money(rowValue([/^на счету,?\s*грн/i, /^на рахунку,?\s*грн/i])),
        accountBalanceSemantics: 'billing_displayed_balance_may_include_temporary_payment',
        price: money(rowValue([/^ціна,?\s*грн/i, /^цена,?\s*грн/i])),
        priceSemantics: 'generic_price_row_not_guaranteed_to_be_internet_tariff',
        displayedPlanCost: money(rowValue([
          /^підсумкова\s+вартість\s+тарифного\s+плану/i,
          /^итоговая\s+стоимость\s+тарифного\s+плана/i
        ])),
        totalDue,
        totalDueSemantics: 'current_billing_total_for_rendered_service_set_not_future_charge',
        balanceAfterTariff: money(rowValue([/на счете с учетом стоимости тарифного плана/i, /на рахунку з урахуванням вартості тарифного плану/i])),
        balanceWithoutTemporary: money(rowValue([/на счете без учета временных платежей/i, /на рахунку без урахування тимчасових платежів/i])),
        temporaryPayment: money(temporaryText),
        temporaryPaymentText: temporaryText,
        temporaryPaymentSemantics: 'billing_temporary_credit_not_customer_money',
        discount
      },
      network: {
        ip: clean(input('ip') || auth.ip, 80),
        authorization: auth,
        trafficIncomingBytes: clean(rowValue([/інтернет входящий, байт/i, /интернет входящий, байт/i]), 120),
        trafficOutgoingBytes: clean(rowValue([/інтернет исходящий, байт/i, /интернет исходящий, байт/i]), 120),
        uaixIncomingBytes: clean(rowValue([/^ua-ix\s+входящий,?\s*байт/i]), 120),
        uaixOutgoingBytes: clean(rowValue([/^ua-ix\s+исходящий,?\s*байт/i]), 120),
        internetAccountingMb: clean(rowValue([/^оплата\s+інтернет,?\s*мб:\s*загалом/i, /^оплата\s+интернет,?\s*мб:\s*всего/i]), 120),
        uaixAccountingMb: clean(rowValue([/^оплата\s+ua-ix,?\s*мб:\s*загалом/i, /^оплата\s+ua-ix,?\s*мб:\s*всего/i]), 120),
        direction3AccountingMb: clean(rowValue([/^оплата\s+['"]?направление\s+3['"]?,?\s*мб:\s*загалом/i]), 120),
        direction4AccountingMb: clean(rowValue([/^оплата\s+['"]?направление\s+4['"]?,?\s*мб:\s*загалом/i]), 120)
      },
      payments: readPayments(),
      parseMeta: {
        blocks: {
          mainForm: { selector: MAIN_FORM_SELECTOR, observed: Boolean(document.querySelector(MAIN_FORM_SELECTOR)) },
          authorization: { selector: AUTH_SELECTOR, observed: Boolean(document.querySelector(AUTH_SELECTOR)) },
          summary: { selector: SUMMARY_SELECTOR, observed: Boolean(document.querySelector(SUMMARY_SELECTOR)) },
          recentEvents: { selector: PAYMENTS_SELECTOR, observed: Boolean(document.querySelector(PAYMENTS_SELECTOR)) }
        },
        ignored: ['password', 'old_*', 'session_tokens', 'unselected_select_options']
      }
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

  async function exactIdentityLookup(request = {}) {
    const mode = String(request?.mode || '');
    const rawValue = clean(request?.value || '', 80).replace(/\s+/g, '');
    if (!['login', 'contract'].includes(mode) || !rawValue) {
      return { ok: false, code: 'IDENTITY_QUERY_REQUIRED', candidates: [] };
    }

    const current = new URL(location.href);
    let pp = clean(current.searchParams.get('pp') || '', 200);
    if (!pp) pp = clean(document.querySelector('input[name="pp"]')?.value || '', 200);
    if (!pp) return { ok: false, code: 'BILLING_SESSION_REQUIRED', candidates: [] };

    // Reproduce the native Billing form exactly. Preserve the literal value
    // first. For abonNNN, the numeric part is only a second native-search alias.
    const abonDigits = mode === 'login' ? (rawValue.match(/^abon(\d{3,12})$/i)?.[1] || '') : '';
    const nativeQueries = [...new Set([rawValue, abonDigits].filter(Boolean))];

    const authPage = doc => Boolean(doc.querySelector('input[type="password"]'));

    const submitBillingForm = async (paramsObject = {}, phase = 'billing-form-submit') => new Promise((resolve, reject) => {
      const seq = ++bridgeState.requestSeq;
      const targetName = `simnet_billing_read_${seq}`;
      const iframe = document.createElement('iframe');
      iframe.name = targetName;
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.display = 'none';

      const form = document.createElement('form');
      form.method = 'get';
      form.action = new URL('/cgi-bin/adm/adm.pl', location.origin).href;
      form.target = targetName;
      form.hidden = true;
      form.style.display = 'none';

      for (const [key, value] of Object.entries(paramsObject || {})) {
        if (value === null || value === undefined || value === '') continue;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = String(key);
        input.value = String(value);
        form.append(input);
      }
      const submitButton = document.createElement('input');
      submitButton.type = 'submit';
      submitButton.value = 'Найти';
      form.append(submitButton);

      let settled = false;
      const cleanup = () => {
        iframe.removeEventListener('load', onLoad);
        window.clearTimeout(timer);
        form.remove();
        iframe.remove();
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanup();
        const wrapped = new Error(clean(error?.message || error, 360) || 'Billing form submit failed');
        wrapped.simnetPhase = phase;
        reject(wrapped);
      };
      const onLoad = () => {
        if (settled) return;
        try {
          const href = String(iframe.contentWindow?.location?.href || '');
          if (!href || href === 'about:blank') return;
          const loadedUrl = new URL(href, location.origin);
          if (loadedUrl.origin !== location.origin) {
            throw new Error(`Billing form redirected outside origin: ${loadedUrl.origin}`);
          }
          const liveDoc = iframe.contentDocument;
          const html = liveDoc?.documentElement?.outerHTML || '';
          if (!html) throw new Error('Billing form result DOM is empty');
          const doc = new DOMParser().parseFromString(html, 'text/html');
          settled = true;
          cleanup();
          resolve({
            ok: true,
            status: 200,
            url: loadedUrl,
            doc,
            transport: 'native-form-submit-hidden-iframe'
          });
        } catch (error) {
          fail(error);
        }
      };

      iframe.addEventListener('load', onLoad);
      document.documentElement.append(iframe, form);
      const timer = window.setTimeout(() => fail(new Error('Billing form submit timed out')), 15000);

      try {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(submitButton);
        else HTMLFormElement.prototype.submit.call(form);
      } catch (error) {
        fail(error);
      }
    });

    const ids = new Map();
    const addCandidate = (id, rowText = '') => {
      const normalizedId = String(id || '').replace(/\D+/g, '').slice(0, 12);
      if (!normalizedId || ids.has(normalizedId)) return;
      ids.set(normalizedId, clean(rowText, 800));
    };
    let matchedQuery = '';
    let lastStatus = 0;
    for (const nativeQuery of nativeQueries) {
      // Native Billing form: GET adm.pl?pp=<session>&f=n&a=listuser&name=<query>
      const searchPage = await submitBillingForm({
        pp,
        f: 'n',
        a: 'listuser',
        name: nativeQuery
      }, 'native-listuser-submit');
      lastStatus = searchPage.status;
      if (!searchPage.ok) continue;
      if (authPage(searchPage.doc)) return { ok: false, code: 'BILLING_AUTH_REQUIRED', candidates: [] };

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
      if (ids.size) {
        matchedQuery = nativeQuery;
        break;
      }
    }
    if (!ids.size) {
      if (lastStatus >= 400) return { ok: false, code: 'BILLING_SEARCH_FAILED', status: lastStatus, candidates: [] };
      return { ok: true, code: 'NOT_FOUND', candidates: [], attemptedQueries: nativeQueries };
    }

    const candidates = [];
    const snapshots = {};
    const candidateErrors = [];
    for (const id of [...ids.keys()].slice(0, 8)) {
      try {
        const page = await submitBillingForm({ pp, a: 'user', id }, 'main-card-submit');
        if (!page.ok || authPage(page.doc)) continue;
        const field = name => clean(page.doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '', 240);
        const candidate = {
          billingId: id,
          contract: field('contract'),
          login: field('name'),
          fullName: field('fio'),
          address: '',
          ip: field('ip'),
          connectionFamily: '',
          resultText: ids.get(id) || ''
        };

        if (mode === 'login') {
          const actual = String(candidate.login || '').toLowerCase();
          if (actual && actual !== rawValue.toLowerCase()) continue;
        } else {
          const actual = String(candidate.contract || '').replace(/\D+/g, '');
          const expected = rawValue.replace(/\D+/g, '');
          if (actual && expected && actual !== expected) continue;
        }

        const bootstrapStartedAt = new Date().toISOString();
        const snapshot = {
          billingId: id,
          identity: {
            billingId: id,
            contract: candidate.contract,
            login: candidate.login,
            fullName: candidate.fullName,
            contractDate: field('contract_date')
          },
          network: {
            ip: candidate.ip
          },
          observedAt: bootstrapStartedAt,
          source: 'billing-bootstrap-read-only',
          bootstrapMeta: {
            status: 'partial',
            startedAt: bootstrapStartedAt,
            sources: {
              main: { ok: true, source: 'billing-main-card-identity-read' },
              address: { ok: false, code: 'NOT_READ' },
              technical: { ok: false, code: 'NOT_READ' }
            }
          }
        };

        // Address and technical data are bootstrap context, not identity proof.
        // Failure of either source must not invalidate an already confirmed identity.
        try {
          const addressPage = await submitBillingForm({
            pp,
            a: 'dopdata',
            parent_type: '0',
            id,
            tmpl: '2'
          }, 'address-submit');
          if (addressPage.ok && !authPage(addressPage.doc)) {
            const addressInput = name => clean(addressPage.doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '', 240);
            const addressSelected = name => {
              const select = addressPage.doc.querySelector(`select[name="${CSS.escape(name)}"]`);
              const option = select?.options?.[select.selectedIndex];
              return clean(option?.textContent || select?.value || '', 240);
            };
            const address = {
              street: addressSelected('dopfield_5'),
              building: addressInput('dopfield_6'),
              block: addressInput('dopfield_11'),
              entrance: addressInput('dopfield_12'),
              floor: addressInput('dopfield_7'),
              apartment: addressInput('dopfield_8')
            };
            address.full = composeAddress(address);
            snapshot.address = address;
            snapshot.contacts = {
              phone: addressInput('dopfield_9'),
              extraPhone: addressInput('dopfield_22'),
              email: addressInput('dopfield_14')
            };
            snapshot.customer = {
              subscriberType: addressSelected('dopfield_31'),
              contractedWith: addressSelected('dopfield_32'),
              edrpou: addressInput('dopfield_33'),
              manager: addressSelected('dopfield_43'),
              connectedBy: addressSelected('dopfield_25'),
              comment: addressInput('dopfield_10')
            };
            candidate.address = address.full;
            snapshot.bootstrapMeta.sources.address = {
              ok: true,
              source: 'billing-dopdata-address',
              endpoint: '/cgi-bin/adm/adm.pl?a=dopdata&tmpl=2'
            };
          } else {
            snapshot.bootstrapMeta.sources.address = {
              ok: false,
              code: authPage(addressPage.doc) ? 'BILLING_AUTH_REQUIRED' : `HTTP_${addressPage.status || 0}`
            };
          }
        } catch (error) {
          snapshot.bootstrapMeta.sources.address = {
            ok: false,
            code: 'ADDRESS_READ_FAILED',
            message: clean(error?.message || error, 240)
          };
        }

        try {
          const technicalPage = await submitBillingForm({
            pp,
            a: 'dopdata',
            parent_type: '0',
            id,
            tmpl: '1'
          }, 'technical-submit');
          if (technicalPage.ok && !authPage(technicalPage.doc)) {
            const technicalInput = name => clean(technicalPage.doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '', 240);
            const technicalSelected = name => {
              const select = technicalPage.doc.querySelector(`select[name="${CSS.escape(name)}"]`);
              const option = select?.options?.[select.selectedIndex];
              return clean(option?.textContent || select?.value || '', 240);
            };
            const booleanFromSelect = name => {
              const value = String(technicalPage.doc.querySelector(`select[name="${CSS.escape(name)}"]`)?.value ?? '').trim();
              if (value === '1') return true;
              if (value === '0') return false;
              return null;
            };
            const olt = technicalSelected('dopfield_29');
            const eponOnuMac = technicalInput('dopfield_19');
            const gponOntSerial = technicalInput('dopfield_38');
            let technologyHint = '';
            if (eponOnuMac && gponOntSerial) technologyHint = 'PON (EPON/GPON identifiers both present)';
            else if (gponOntSerial) technologyHint = 'GPON';
            else if (eponOnuMac) technologyHint = 'EPON';
            else if (/\bGPON\b/i.test(olt)) technologyHint = 'GPON';
            else if (/\bEPON\b/i.test(olt)) technologyHint = 'EPON';
            else if (/\bOLT\b|HUAWEI|BDCOM|GCOM/i.test(olt)) technologyHint = 'PON';

            snapshot.technical = {
              subscriberMac: technicalInput('dopfield_4'),
              eponOnuMac,
              gponOntSerial,
              technologyHint,
              olt,
              oltIp: olt.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '',
              staticIpConfigured: booleanFromSelect('dopfield_44'),
              onuWithCableTv: booleanFromSelect('dopfield_37'),
              comment: technicalInput('dopfield_34')
            };
            if (technologyHint) candidate.connectionFamily = technologyHint;
            snapshot.bootstrapMeta.sources.technical = {
              ok: true,
              source: 'billing-dopdata-technical',
              endpoint: '/cgi-bin/adm/adm.pl?a=dopdata&tmpl=1'
            };
          } else {
            snapshot.bootstrapMeta.sources.technical = {
              ok: false,
              code: authPage(technicalPage.doc) ? 'BILLING_AUTH_REQUIRED' : `HTTP_${technicalPage.status || 0}`
            };
          }
        } catch (error) {
          snapshot.bootstrapMeta.sources.technical = {
            ok: false,
            code: 'TECHNICAL_READ_FAILED',
            message: clean(error?.message || error, 240)
          };
        }

        snapshot.bootstrapMeta.completedAt = new Date().toISOString();
        snapshot.observedAt = snapshot.bootstrapMeta.completedAt;
        snapshot.bootstrapMeta.status = (
          snapshot.bootstrapMeta.sources.address.ok
          && snapshot.bootstrapMeta.sources.technical.ok
        ) ? 'context-ready' : 'partial';
        snapshots[id] = snapshot;
        candidates.push(candidate);
      } catch (error) {
        candidateErrors.push({
          billingId: id,
          phase: clean(error?.simnetPhase || 'main-card-parse', 80),
          message: clean(error?.message || error, 360)
        });
      }
    }

    if (!candidates.length && candidateErrors.length) {
      return {
        ok: false,
        code: 'BILLING_CARD_READ_FAILED',
        failurePhase: candidateErrors[0]?.phase || 'main-card-read',
        message: candidateErrors[0]?.message || 'Billing subscriber card read failed',
        candidateErrors,
        candidates: [],
        snapshots: {},
        transport: 'native-form-submit-hidden-iframe',
        nativeQuery: matchedQuery,
        attemptedQueries: nativeQueries
      };
    }

    return {
      ok: true,
      code: candidates.length ? 'OK' : 'NOT_FOUND',
      candidates,
      snapshots,
      transport: 'native-form-submit-hidden-iframe',
      nativeQuery: matchedQuery,
      attemptedQueries: nativeQueries
    };
  }

  const exactLookupListener = (message, _sender, sendResponse) => {
    if (String(message?.type || '') !== EXACT_LOOKUP_MESSAGE) return false;
    void exactIdentityLookup(message?.request || {}).then(
      result => sendResponse(result),
      error => sendResponse({
        ok: false,
        code: 'BILLING_SEARCH_EXECUTION_FAILED',
        failurePhase: clean(error?.simnetPhase || 'exact-lookup-runtime', 80),
        message: clean(error?.message || error, 500),
        candidates: []
      })
    );
    return true;
  };
  bridgeState.listener = exactLookupListener;
  chrome.runtime.onMessage.addListener(exactLookupListener);

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

  if (['user', 'dopdata'].includes(action) && !bridgeState.captureStarted) {
    bridgeState.captureStarted = true;
    void capture().catch(error => console.warn('[SIMNET AI operator] billing snapshot capture failed', error));
  }
})();
