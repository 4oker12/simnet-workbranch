'use strict';

import { CallRecord } from '../domain/call-record.js';
import { CallStateStore, WORKBENCH_STATE_KEY } from '../storage/call-state-store.js';

let repairQueued = false;
let repairing = false;

const clean = (value, max = 160) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
const factValue = value => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
  ? value.value
  : value;

function registrationState(binding = {}) {
  const raw = binding?.registrationStatus;
  return raw && typeof raw === 'object' ? String(raw.state || '') : String(raw || '');
}

async function repairRegisteredCallIdentity() {
  if (repairing) return 0;
  repairing = true;
  try {
    return await CallStateStore.mutateAll((store, state) => {
      const bindings = state?.callModule?.bindings?.bindings || {};
      let changed = 0;

      for (const [callKey, binding] of Object.entries(bindings)) {
        if (registrationState(binding) !== 'registered') continue;
        const raw = store.calls?.[callKey];
        if (!raw) continue;

        const caseId = clean(binding.caseId || binding.identity?.caseId, 120);
        const customerId = digits(
          binding.customerId
          || binding.identity?.customerId
          || factValue(state.cases?.[caseId]?.identity?.customerId)
          || raw.subscriber?.customerId
          || raw.customerId,
          14
        );
        if (!customerId) continue;

        const currentCustomerId = digits(raw.subscriber?.customerId || raw.customerId, 14);
        const currentCaseId = clean(raw.subscriber?.caseId, 120);
        if (currentCustomerId === customerId && (!caseId || currentCaseId === caseId)) continue;

        const record = CallRecord.from(raw);
        record.bindSubscriber({
          ...(binding.identity || {}),
          caseId,
          customerId
        }, binding.updatedAt || binding.registeredAt || new Date().toISOString());
        record.processing.linkage = {
          ...(record.processing.linkage || {}),
          customerId,
          usersideCallId: digits(raw.usersideCallId, 24),
          pbxRecordId: clean(raw.pbxRecordId, 80)
        };
        store.calls[callKey] = record.toJSON();
        changed += 1;
      }

      if (changed) console.info('[SIMNET WB][CALL] repaired registered call identity', { changed });
      return changed;
    });
  } finally {
    repairing = false;
  }
}

function queueRepair() {
  if (repairQueued || repairing) return;
  repairQueued = true;
  queueMicrotask(() => {
    repairQueued = false;
    void repairRegisteredCallIdentity().catch(error => {
      console.error('[SIMNET WB][CALL] identity repair failed', error);
    });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[WORKBENCH_STATE_KEY]?.newValue) return;
  queueRepair();
});

queueRepair();

export const CallIdentityRepair = Object.freeze({
  run: repairRegisteredCallIdentity
});
