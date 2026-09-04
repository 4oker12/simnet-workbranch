(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callRegistration) return;
  let loadPromise = null;
  let forceNextLoad = false;
  let enabled = true;
  let destroyed = false;
  let routeIntentBusy = false;
  let lastRouteIntentKey = '';

  const factValue = value => (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) ? value.value : value;
  const normDigits = value => String(factValue(value) || '').replace(/\D+/g, '');
  const normText = value => String(factValue(value) || '').trim().toLowerCase();
  const errDetails = error => ({
    message: String(error?.message || error || 'unknown error').slice(0, 1200),
    stack: String(error?.stack || '').slice(0, 1800)
  });

  function caseSummary(caseData = null) {
    return {
      caseId: String(caseData?.id || ''),
      customerId: normDigits(caseData?.identity?.customerId),
      contract: normDigits(caseData?.identity?.contract || caseData?.identity?.login),
      login: String(factValue(caseData?.identity?.login) || '').slice(0, 120)
    };
  }

  function caseMatchesIntent(caseData = null, intent = {}) {
    if (!caseData?.id || !intent?.identity) return false;
    const left = {
      customerId: normDigits(caseData.identity?.customerId),
      billingId: normDigits(caseData.identity?.billingId),
      contract: normDigits(caseData.identity?.contract || caseData.identity?.login),
      login: normText(caseData.identity?.login)
    };
    const right = {
      customerId: normDigits(intent.identity?.customerId),
      billingId: normDigits(intent.identity?.billingId),
      contract: normDigits(intent.identity?.contract || intent.identity?.login),
      login: normText(intent.identity?.login)
    };
    return Boolean(
      (left.customerId && right.customerId && left.customerId === right.customerId)
      || (left.billingId && right.billingId && left.billingId === right.billingId)
      || (left.contract && right.contract && left.contract === right.contract)
      || (left.login && right.login && left.login === right.login)
    );
  }

  function routeIntentFromHash() {
    if (!/\/customer\/\d+/i.test(location.pathname || '')) return null;
    const hash = String(location.hash || '').replace(/^#/, '');
    if (!hash.startsWith('simnet-wb-call=')) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(hash.slice('simnet-wb-call='.length)));
      return parsed?.callKey && parsed?.identity ? parsed : null;
    } catch {
      return null;
    }
  }

  async function waitForTargetCase(intent, timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const active = WB.store?.activeCase?.() || null;
      if (caseMatchesIntent(active, intent)) return active;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Нужная карточка абонента открыта, но её identity не подтвердилась');
  }

  async function openRouteIntent(intent = {}) {
    const callKey = String(intent?.callKey || '');
    const identityKey = [intent?.identity?.customerId, intent?.identity?.billingId, intent?.identity?.contract, intent?.identity?.login].map(v => String(v || '')).join(':');
    const dedupeKey = `${callKey}|${identityKey}`;
    if (!callKey || !intent?.identity || routeIntentBusy || (dedupeKey && dedupeKey === lastRouteIntentKey)) return false;
    routeIntentBusy = true;
    WB.log?.info?.('CALL', 'Открытие регистрации по target-маршруту', { callKey, identityKey });
    try {
      const registration = await ensure();
      const active = await waitForTargetCase(intent);
      lastRouteIntentKey = dedupeKey;
      const result = await registration.open?.(active, { focusCallKey: callKey, routedIntent: intent });
      WB.log?.info?.('CALL', 'Окно регистрации открыто по target-маршруту', { callKey, ...caseSummary(active), result });
      return true;
    } catch (error) {
      WB.log?.error?.('CALL', 'Не удалось открыть регистрацию по target-маршруту', { callKey, ...errDetails(error) });
      throw error;
    } finally {
      routeIntentBusy = false;
    }
  }

  function onRuntimeMessage(message = {}) {
    if (destroyed || message?.type !== 'CALL_REGISTRATION_OPEN_TARGET') return false;
    void openRouteIntent(message.payload || {}).catch(error => {
      WB.log?.error?.('CALL', 'Routed registration did not open', errDetails(error));
    });
    return false;
  }

  function injectFeature(feature, force = false, timeoutMs = 6000) {
    WB.log?.info?.('CALL', 'Загрузка модуля регистрации', { feature, force: Boolean(force) });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(
        () => finish(reject, new Error('Call feature injection timed out')),
        timeoutMs
      );
      try {
        chrome.runtime.sendMessage(
          { type: 'INJECT_FEATURE_SCRIPTS', payload: { feature, force: Boolean(force) } },
          response => {
            const err = chrome.runtime.lastError;
            if (err) return finish(reject, new Error(err.message || String(err)));
            if (!response?.success) return finish(reject, new Error(response?.error || 'inject failed'));
            finish(resolve, response.data || {});
          }
        );
      } catch (e) { finish(reject, e); }
    });
  }

  function waitFor(timeoutMs = 8000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (WB.__callRegistrationLoaded && WB.callRegistration && !WB.callRegistration.__lazy) return resolve(WB.callRegistration);
        if (Date.now() - started > timeoutMs) return reject(new Error('Call registration did not register'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  function ensure() {
    if (!enabled || destroyed) return Promise.reject(new Error('CALL module is disabled'));
    if (WB.__callRegistrationLoaded && WB.callRegistration && !WB.callRegistration.__lazy) return Promise.resolve(WB.callRegistration);
    if (loadPromise) return loadPromise;
    const force = forceNextLoad;
    forceNextLoad = false;
    loadPromise = (async () => {
      await injectFeature('call', force);
      const registration = await waitFor();
      WB.log?.info?.('CALL', 'Модуль регистрации загружен', { force });
      return registration;
    })().catch(err => {
      loadPromise = null;
      forceNextLoad = true;
      WB.__callRegistrationLoaded = false;
      WB.log?.error?.('CALL', 'Модуль регистрации не загрузился', { force, ...errDetails(err) });
      throw err;
    });
    return loadPromise;
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  WB.callRegistration = Object.freeze({
    __lazy: true,
    ensure,
    enable() { if (destroyed) return false; enabled = true; return true; },
    disable() { enabled = false; WB.callRegistration?.close?.(); return true; },
    open: async (...args) => {
      const caseData = args[0] || WB.store?.activeCase?.() || null;
      const options = args[1] || {};
      if (!enabled || destroyed) {
        WB.log?.warn?.('CALL', 'Попытка открыть регистрацию при выключенном модуле', caseSummary(caseData));
        return { ok: false, reason: 'call-disabled' };
      }
      WB.log?.info?.('CALL', 'Запрошено окно регистрации звонка', {
        ...caseSummary(caseData),
        focusCallKey: String(options?.focusCallKey || '')
      });
      try {
        const registration = await ensure();
        const result = await registration.open?.(...args);
        const details = {
          ...caseSummary(caseData),
          focusCallKey: String(options?.focusCallKey || ''),
          result
        };
        if (result?.ok === false) WB.log?.warn?.('CALL', 'Окно регистрации вернуло ошибочный результат', details);
        else WB.log?.info?.('CALL', 'Окно регистрации отработало', details);
        return result;
      } catch (error) {
        WB.log?.error?.('CALL', 'Ошибка при открытии окна регистрации', {
          ...caseSummary(caseData),
          focusCallKey: String(options?.focusCallKey || ''),
          ...errDetails(error)
        });
        throw error;
      }
    },
    close: async (...args) => {
      if (!WB.__callRegistrationLoaded) return;
      try {
        return await (await ensure()).close?.(...args);
      } catch (error) {
        WB.log?.error?.('CALL', 'Ошибка закрытия окна регистрации', errDetails(error));
        throw error;
      }
    },
    destroy() {
      enabled = false;
      destroyed = true;
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      if (WB.__callRegistrationLoaded) void WB.callRegistration?.close?.();
    }
  });

  const hashIntent = routeIntentFromHash();
  if (hashIntent) {
    queueMicrotask(() => {
      void openRouteIntent(hashIntent).then(opened => {
        if (opened && location.hash.startsWith('#simnet-wb-call=')) history.replaceState(null, '', `${location.pathname}${location.search}`);
      }).catch(error => WB.log?.error?.('CALL', 'Hash registration did not open', errDetails(error)));
    });
  }
})();
