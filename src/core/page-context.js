(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const compact = (value, max = 300) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const normalizeMac = value => {
    const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
  };

  const validIp = value => {
    const text = String(value || '').trim();
    const match = text.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
    if (!match) return '';
    const parts = match[1].split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255) ? match[1] : '';
  };

  const safeUrl = raw => {
    try {
      const url = new URL(raw || location.href, location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (
          /^(pp|salt|token|password|passwd|session|sid|rand_login|csrf)$/i.test(key)
          || /^uu\d+$/i.test(key)
          || /^pp\d+$/i.test(key)
        ) {
          url.searchParams.set(key, '[redacted]');
        }
      }
      return url.toString();
    } catch {
      return `${location.origin}${location.pathname}`;
    }
  };

  const controlValue = element => {
    if (!element) return '';
    const type = String(element.type || '').toLowerCase();
    const name = String(element.getAttribute?.('name') || '');
    if (
      type === 'password'
      || /(?:csrf|token|salt|session|passwd|password|^pp$|^pp\d+$|^uu\d+$)/i.test(name)
    ) {
      return '[protected]';
    }
    if (element.tagName === 'SELECT') {
      const option = element.options?.[element.selectedIndex] || null;
      return compact(option?.textContent || element.value || '', 220);
    }
    if (type === 'checkbox' || type === 'radio') {
      return element.checked ? 'включено' : 'выключено';
    }
    return compact(element.value || '', 220);
  };

  const traceFactValue = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
  const traceNonEmpty = input => Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== '' && value != null && value !== false)
  );
  const traceFacts = facts => ({
    identity: traceNonEmpty({
      login: traceFactValue(facts?.identity?.login),
      contract: traceFactValue(facts?.identity?.contract),
      billingId: traceFactValue(facts?.identity?.billingId),
      customerId: traceFactValue(facts?.identity?.customerId)
    }),
    network: traceNonEmpty({
      ip: traceFactValue(facts?.network?.ip),
      mac: traceFactValue(facts?.network?.mac),
      connectionFamily: traceFactValue(facts?.network?.connectionFamily),
      accessDeviceId: traceFactValue(facts?.network?.accessDeviceId)
    }),
    pon: traceNonEmpty({
      oltName: traceFactValue(facts?.pon?.oltName),
      oltIp: traceFactValue(facts?.pon?.oltIp),
      onuMac: traceFactValue(facts?.pon?.onuMac),
      onuSerial: traceFactValue(facts?.pon?.onuSerial),
      pollType: traceFactValue(facts?.pon?.pollType),
      pollAction: traceFactValue(facts?.pon?.pollAction),
      status: traceFactValue(facts?.pon?.status),
      locatedInterface: traceFactValue(facts?.pon?.locatedInterface)
    })
  });
  const traceObservations = meta => (Array.isArray(meta?.locatorObservations) ? meta.locatorObservations : [])
    .slice(0, 8)
    .map(item => traceNonEmpty({
      type: String(item?.type || ''),
      result: String(item?.result || ''),
      method: String(item?.method || ''),
      summary: compact(item?.summary || '', 120),
      source: String(item?.source || ''),
      technology: String(item?.details?.technology || ''),
      pollAction: String(item?.details?.pollAction || ''),
      oltName: String(item?.details?.oltName || ''),
      oltIp: String(item?.details?.oltIp || '')
    }));

  function detectSystem() {
    if (location.hostname === 'userside.simnet.kiev.ua') return 'userside';
    if (location.hostname === 'admin.simnet.kiev.ua') return 'billing';
    if (location.hostname === 'admin.looknet.kiev.ua') return 'looknet-billing';
    return 'unknown';
  }

  function isBillingAuthDom() {
    // Highest priority: DOM login/password evidence overrides URL route
    // (a=dopdata / a=user / a=252 etc. must not mask a session-expired login form).
    try {
      if (WB.billingNavigation?.isBillingAuthPage) {
        return Boolean(WB.billingNavigation.isBillingAuthPage(document));
      }
      const password = document.querySelector?.('input[type="password"]');
      if (!password) return false;
      const bodyText = String(document.body?.innerText || '').slice(0, 2000).toLowerCase();
      if (/парол|login|password|войти|вход|авториз/i.test(bodyText)) return true;
      if (password.offsetParent !== null) return true;
    } catch {}
    return false;
  }

  function detectPageKind(system) {
    const path = location.pathname;
    const params = new URLSearchParams(location.search);

    if (system === 'billing' || system === 'looknet-billing') {
      if (isBillingAuthDom() || params.get('a') === 'enter') {
        return { kind: 'billing_login', entityId: '', subview: '' };
      }
    }

    if (system === 'userside') {
      let match;
      if ((match = path.match(/^\/customer\/(\d+)/i))) {
        return { kind: 'userside_customer', entityId: match[1], subview: '' };
      }
      if (path === '/customer_list' || path.startsWith('/customer_list/')) {
        return { kind: 'userside_customer_list', entityId: '', subview: '' };
      }
      if ((match = path.match(/^\/task\/(\d+)/i))) {
        return { kind: 'userside_task', entityId: match[1], subview: '' };
      }
      if (/^\/task\/dialog_(?:add|edit)/i.test(path)) {
        return { kind: 'userside_task_form', entityId: params.get('id') || '', subview: '' };
      }
      if (/^\/device\/device_onu_list/i.test(path)) {
        return { kind: 'olt_pon_port_onu_list', entityId: params.get('id') || '', subview: '' };
      }
      if (/^\/device\/error_iface_list/i.test(path)) {
        return {
          kind: 'device_interface_errors',
          entityId: params.get('device_id') || '',
          subview: 'errors'
        };
      }
      if ((match = path.match(/^\/device\/(\d+)\/device_iface_list/i))) {
        return { kind: 'device_interface_list', entityId: match[1], subview: 'interfaces' };
      }
      if ((match = path.match(/^\/device\/(\d+)\/device_poller_data/i))) {
        return {
          kind: params.get('data_type') === 'onu_list' ? 'olt_onu_list' : 'device_poller',
          entityId: match[1],
          subview: params.get('data_type') || ''
        };
      }
      if (/^\/device\/interface_mac_list/i.test(path)) {
        return { kind: 'interface_mac_list', entityId: params.get('id') || '', subview: '' };
      }
      if ((match = path.match(/^\/device\/(\d+)\/interface_mac_list/i))) {
        return { kind: 'interface_mac_list', entityId: match[1], subview: '' };
      }
      if ((match = path.match(/^\/device\/(\d+)/i))) {
        return { kind: 'userside_device', entityId: match[1], subview: '' };
      }
      return { kind: 'userside_other', entityId: params.get('id') || '', subview: '' };
    }

    if (system === 'billing' || system === 'looknet-billing') {
      const action = params.get('a') || '';

      if (/\/stat\.pl$/i.test(path) && action === '252') {
        return {
          kind: 'billing_juniper',
          entityId: params.get('id') || '',
          subview: params.get('act') || ''
        };
      }
      if (/\/stat\.pl$/i.test(path) && ['310', '311', '312', '313'].includes(action)) {
        return {
          kind: 'billing_onu_poll',
          entityId: params.get('id') || '',
          subview: `a${action}`
        };
      }
      if (action === 'user') {
        return { kind: 'billing_user', entityId: params.get('id') || '', subview: '' };
      }
      if (action === 'listuser') {
        return { kind: 'billing_user_list', entityId: '', subview: '' };
      }
      if (action === 'dopdata') {
        return {
          kind: 'billing_technical',
          entityId: params.get('id') || '',
          subview: params.get('act') === 'revisions' ? 'revisions' : 'technical'
        };
      }
      if (action === 'enter') {
        return { kind: 'billing_login', entityId: '', subview: '' };
      }
      return { kind: 'billing_other', entityId: params.get('id') || '', subview: '' };
    }

    return { kind: 'unknown', entityId: '', subview: '' };
  }

  function trustedSubscriberPage(pageInfo) {
    return [
      'billing_user',
      'billing_technical',
      'billing_onu_poll',
      'billing_juniper',
      'userside_customer'
    ].includes(pageInfo.kind);
  }

  function collectLabelMap() {
    const map = new Map();

    const put = (key, value) => {
      const normalizedKey = compact(key, 100)
        .toLowerCase()
        .replace(/[:：]\s*$/, '');
      const normalizedValue = compact(value, 320);
      if (
        normalizedKey
        && normalizedValue
        && normalizedKey !== normalizedValue.toLowerCase()
        && !map.has(normalizedKey)
      ) {
        map.set(normalizedKey, normalizedValue);
      }
    };

    for (const row of document.querySelectorAll('tr')) {
      const cells = row.querySelectorAll(':scope > th, :scope > td');
      if (cells.length < 2) continue;
      const control = cells[cells.length - 1].querySelector('input,select,textarea');
      put(
        cells[0].innerText || cells[0].textContent,
        control ? controlValue(control) : (cells[cells.length - 1].innerText || cells[cells.length - 1].textContent)
      );
    }

    for (const dt of document.querySelectorAll('dt')) {
      const dd = dt.nextElementSibling;
      if (dd?.tagName === 'DD') {
        put(dt.innerText || dt.textContent, dd.innerText || dd.textContent);
      }
    }

    for (const label of document.querySelectorAll('label')) {
      const forId = label.getAttribute('for');
      const control = forId
        ? document.getElementById(forId)
        : label.querySelector('input,select,textarea');
      if (control) put(label.innerText || label.textContent, controlValue(control));
    }

    return map;
  }

  function findLabel(map, patterns) {
    for (const [key, value] of map) {
      if (patterns.some(pattern => pattern.test(key))) return value;
    }
    return '';
  }

  function bodyText() {
    const root = document.body || document.documentElement;
    return compact(root?.innerText || root?.textContent || '', 70000);
  }

  function fact(value, source, confidence) {
    return value == null || value === ''
      ? null
      : {
          value,
          source,
          confidence,
          observedAt: new Date().toISOString()
        };
  }

  function extractGeneric(system, pageInfo, map, text) {
    if (!trustedSubscriberPage(pageInfo)) {
      return {
        identity: {},
        network: {},
        pon: {},
        profile: {}
      };
    }

    const params = new URLSearchParams(location.search);
    const loginMatch = text.match(/\b(abon\d{3,12})\b/i);
    const login = loginMatch ? loginMatch[1].toLowerCase() : '';

    const explicitContract = findLabel(map, [
      /^договор$/i,
      /^договір$/i,
      /номер договор/i,
      /номер договору/i,
      /agreement/i,
      /лицев.*счет/i,
      /особов.*рах/i
    ]);

    const contractMatch =
      String(explicitContract || '').match(/\b(\d{5,12})\b/)
      || String(params.get('search') || params.get('name') || '').match(/\b(\d{5,12})\b/);

    const contract = login
      ? login.replace(/^abon/i, '')
      : (contractMatch?.[1] || '');

    const billingId =
      system.includes('billing') && pageInfo.entityId
        ? pageInfo.entityId
        : (contract.length >= 2 ? contract.slice(0, -1) : '');

    const customerId =
      system === 'userside' && pageInfo.kind === 'userside_customer'
        ? pageInfo.entityId
        : (params.get('customer_id') || '');

    // Страница штатного ONU-опроса содержит меню, тариф и множество IP.
    // На ней generic-парсер собирает только идентификацию.
    if (pageInfo.kind === 'billing_onu_poll' || pageInfo.kind === 'billing_juniper') {
      return {
        identity: {
          login: fact(login, login ? 'dom:login-regex' : '', login ? 0.72 : 0),
          contract: fact(
            contract,
            login ? 'derived:login' : 'dom:labeled-contract',
            login ? 0.76 : 0.7
          ),
          billingId: fact(
            billingId,
            system.includes('billing') && pageInfo.entityId
              ? 'url:id'
              : 'derived:contract-minus-last-digit',
            system.includes('billing') && pageInfo.entityId ? 0.98 : 0.62
          ),
          customerId: fact(
            customerId,
            customerId
              ? (pageInfo.kind === 'userside_customer' ? 'url:path' : 'url:query')
              : '',
            customerId ? 0.98 : 0
          )
        },
        network: {},
        pon: {},
        profile: {}
      };
    }

    const ipLabel = findLabel(map, [
      /^ip$/i,
      /^ip адрес/i,
      /^ip-адрес/i,
      /^ip address/i
    ]);
    const ip = validIp(ipLabel || '');

    const subscriberMacLabel = findLabel(map, [
      /мак-?адрес абонента/i,
      /mac-?адрес абонента/i,
      /mac.*роут/i,
      /router.*mac/i
    ]);

    const address = findLabel(map, [
      /^адрес$/i,
      /^адреса$/i,
      /место подключения/i,
      /місце підключення/i
    ]);
    const fullName = findLabel(map, [
      /^фио$/i,
      /^піб$/i,
      /^абонент$/i,
      /^клиент$/i,
      /^клієнт$/i
    ]);
    const tariff = findLabel(map, [/тариф/i]);
    const balance = findLabel(map, [/баланс/i, /сальдо/i]);

    return {
      identity: {
        login: fact(login, login ? 'dom:login-regex' : '', login ? 0.72 : 0),
        contract: fact(
          contract,
          login ? 'derived:login' : 'dom:labeled-contract',
          login ? 0.76 : 0.7
        ),
        billingId: fact(
          billingId,
          system.includes('billing') && pageInfo.entityId
            ? 'url:id'
            : 'derived:contract-minus-last-digit',
          system.includes('billing') && pageInfo.entityId ? 0.98 : 0.62
        ),
        customerId: fact(
          customerId,
          customerId
            ? (pageInfo.kind === 'userside_customer' ? 'url:path' : 'url:query')
            : '',
          customerId ? 0.98 : 0
        )
      },
      network: {
        ip: fact(ip, 'dom:labeled-ip', ip ? 0.8 : 0),
        mac: fact(normalizeMac(subscriberMacLabel), 'dom:labeled-subscriber-mac', subscriberMacLabel ? 0.78 : 0)
      },
      profile: {
        address: fact(address, 'dom:labeled-address', address ? 0.76 : 0),
        fullName: fact(fullName, 'dom:labeled-name', fullName ? 0.72 : 0),
        tariff: fact(tariff, 'dom:labeled-tariff', tariff ? 0.74 : 0),
        balance: fact(balance, 'dom:labeled-balance', balance ? 0.72 : 0)
      },
      pon: {}
    };
  }

  function removeEmptyFacts(group) {
    const result = {};
    for (const [key, value] of Object.entries(group || {})) {
      if (value?.value !== '' && value?.value != null) result[key] = value;
    }
    return result;
  }

  function detect() {
    const system = detectSystem();
    const pageInfo = detectPageKind(system);

    // billing_login is a protective page state: do not scrape subscriber facts
    // and do not let login DOM contaminate the active Case.
    if (pageInfo.kind === 'billing_login') {
      const context = {
        key: [system, 'billing_login', '', '', ''].join('|'),
        system,
        pageKind: 'billing_login',
        entityId: '',
        subview: '',
        url: safeUrl(),
        title: document.title || '',
        identity: {},
        network: {},
        pon: {},
        profile: {},
        meta: {
          documentId: WB.runtime.documentId || '',
          pageInstanceId: WB.runtime.pageInstanceId || '',
          pageInstanceStartedAt: Number(WB.runtime.pageInstanceStartedAt || 0),
          authPage: true
        },
        quality: { authPage: true },
        observedAt: new Date().toISOString()
      };
      WB.runtime.lastContext = context;
      try {
        const session = WB.actionLifecycle?.current?.();
        if (session && !['COMPLETED', 'FAILED', 'TIMEOUT', 'REJECTED', 'DISMISSED', 'INTERRUPTED'].includes(session.status)) {
          WB.actionLifecycle?.fail?.(session, 'billing-auth-page', {
            code: 'BILLING_AUTH_PAGE_REACHED',
            message: 'Billing вернул страницу авторизации',
            actualResult: 'billing_login'
          });
        }
      } catch {}
      return context;
    }

    const map = collectLabelMap();
    const text = bodyText();
    const generic = extractGeneric(system, pageInfo, map, text);
    const reader = system === 'userside'
      ? WB.readers?.userside
      : WB.readers?.billing;
    const readerScope = system === 'userside' ? 'USERSIDE-READER' : 'BILLING-READER';

    let readerResult = {};
    try {
      readerResult = reader?.read
        ? reader.read({
            system,
            pageInfo,
            map,
            text,
            fact,
            normalizeMac,
            validIp,
            compact,
            controlValue,
            safeUrl,
            activeCase: WB.store?.activeCase?.() || null
          })
        : {};
    } catch (error) {
      WB.log?.error?.(readerScope, 'Ошибка чтения native DOM', {
        from: system === 'userside' ? 'UserSide DOM' : 'Billing DOM',
        to: 'PageContext',
        pageKind: pageInfo.kind,
        entityId: pageInfo.entityId || '',
        error: String(error?.message || error || 'unknown-reader-error')
      });
      throw error;
    }

    const readerFacts = readerResult?.facts || readerResult || {};
    const merged = {
      identity: { ...generic.identity, ...(readerFacts.identity || {}) },
      network: { ...generic.network, ...(readerFacts.network || {}) },
      pon: { ...generic.pon, ...(readerFacts.pon || {}) },
      profile: { ...generic.profile, ...(readerFacts.profile || {}) }
    };

    const identityKey =
      merged.identity.login?.value
      || merged.identity.contract?.value
      || merged.identity.billingId?.value
      || merged.identity.customerId?.value
      || '';

    const context = {
      key: [
        system,
        pageInfo.kind,
        pageInfo.entityId,
        pageInfo.subview || '',
        identityKey
      ].join('|'),
      system,
      pageKind: pageInfo.kind,
      entityId: pageInfo.entityId,
      subview: pageInfo.subview || '',
      url: safeUrl(),
      title: document.title || '',
      identity: removeEmptyFacts(merged.identity),
      network: removeEmptyFacts(merged.network),
      pon: removeEmptyFacts(merged.pon),
      profile: removeEmptyFacts(merged.profile),
      meta: {
        documentId: WB.runtime.documentId || '',
        pageInstanceId: WB.runtime.pageInstanceId || '',
        pageInstanceStartedAt: Number(WB.runtime.pageInstanceStartedAt || 0),
        ...(readerResult?.meta || {})
      },
      quality: readerResult?.quality || {},
      observedAt: new Date().toISOString()
    };

    WB.runtime.lastContext = context;
    return context;
  }

  WB.utils.compact = compact;
  WB.utils.normalizeMac = normalizeMac;
  WB.utils.validIp = validIp;
  WB.utils.safeUrl = safeUrl;
  WB.utils.controlValue = controlValue;

  WB.pageContext = {
    detect,
    detectSystem,
    detectPageKind,
    collectLabelMap
  };
})();
