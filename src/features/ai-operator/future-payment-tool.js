import { calculateFuturePayment, futurePaymentHorizonFromText } from './future-payment-calculator.js';

const BILLING_SNAPSHOT_KEY = 'simnet_ai_operator_billing_snapshots_v1';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function result(ok, code, data = {}, warnings = []) {
  return {
    ok: Boolean(ok),
    tool: 'billing.future_payment',
    code: String(code || (ok ? 'OK' : 'ERROR')),
    observedAt: nowIso(),
    data: clone(data),
    warnings: Array.isArray(warnings) ? [...warnings] : [],
    statePatch: {}
  };
}

function snapshotForConfirmedSubscriber(snapshots = {}, labState = {}) {
  const confirmed = labState?.confirmedSubscriber && typeof labState.confirmedSubscriber === 'object'
    ? labState.confirmedSubscriber
    : {};
  const billingId = String(confirmed.billingId || '').trim();
  if (billingId && snapshots[billingId]) return snapshots[billingId];

  const contract = String(confirmed.contract || '').replace(/\D/g, '');
  const login = String(confirmed.login || '').trim().toLowerCase();
  return Object.values(snapshots).find(snapshot => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const snapshotContract = String(snapshot?.identity?.contract || '').replace(/\D/g, '');
    const snapshotLogin = String(snapshot?.identity?.login || '').trim().toLowerCase();
    return Boolean(
      (contract && snapshotContract === contract)
      || (login && snapshotLogin === login)
    );
  }) || null;
}

export async function executeFuturePaymentTool({ toolArgs = {}, labState = {} } = {}) {
  if (!String(labState?.confirmedCaseId || '').trim()) {
    return result(false, 'IDENTITY_REQUIRED', {
      message: 'Абонент ещё не идентифицирован и не подтверждён.'
    });
  }

  const stored = await chrome.storage.local.get(BILLING_SNAPSHOT_KEY);
  const snapshots = stored?.[BILLING_SNAPSHOT_KEY] && typeof stored[BILLING_SNAPSHOT_KEY] === 'object'
    ? stored[BILLING_SNAPSHOT_KEY]
    : {};
  const snapshot = snapshotForConfirmedSubscriber(snapshots, labState);
  if (!snapshot) {
    return result(false, 'DATA_NOT_AVAILABLE', {
      message: 'Для подтверждённого абонента ещё нет Billing snapshot.'
    });
  }

  const horizon = toolArgs?.horizon && typeof toolArgs.horizon === 'object'
    ? toolArgs.horizon
    : futurePaymentHorizonFromText(toolArgs?.query || '');
  const calculation = calculateFuturePayment({
    service: snapshot.service || {},
    finance: snapshot.finance || {},
    horizon: horizon || {}
  });

  if (!calculation.ok) {
    return result(false, calculation.code, calculation, [calculation.message].filter(Boolean));
  }
  return result(true, 'OK', {
    ...calculation,
    source: BILLING_SNAPSHOT_KEY,
    snapshotObservedAt: String(snapshot.observedAt || '')
  });
}
