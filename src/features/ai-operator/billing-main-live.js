'use strict';

import { readBillingSummaryLive } from './billing-summary-live.js';

const INFLIGHT = new Map();
const RECENT = new Map();
const COALESCE_MS = 1500;

function normalizedId(value) {
  const id = String(value == null ? '' : value).replace(/\D+/g, '').slice(0, 12);
  return /^\d{1,12}$/.test(id) ? id : '';
}

export async function readBillingMainLive({ billingId, refresh = false, forceRefresh = false, maxAgeMs = 30000 } = {}) {
  const id = normalizedId(billingId);
  if (!id) return { ok: false, code: 'BILLING_ID_REQUIRED' };

  const pending = INFLIGHT.get(id);
  if (pending) return pending;

  const recent = RECENT.get(id);
  const recentAge = recent ? Date.now() - recent.at : Infinity;
  if (!forceRefresh && recent?.result?.ok && recentAge < Math.min(Math.max(1000, Number(maxAgeMs) || 30000), COALESCE_MS)) {
    return { ...recent.result, cache: 'coalesced' };
  }

  const task = readBillingSummaryLive({
    billingId: id,
    refresh: forceRefresh ? true : Boolean(refresh),
    maxAgeMs
  }).then(result => {
    if (result?.ok) RECENT.set(id, { at: Date.now(), result });
    return result;
  }).finally(() => {
    if (INFLIGHT.get(id) === task) INFLIGHT.delete(id);
  });

  INFLIGHT.set(id, task);
  return task;
}

export function clearBillingMainLiveCache(billingId = '') {
  const id = normalizedId(billingId);
  if (id) RECENT.delete(id);
  else RECENT.clear();
}
