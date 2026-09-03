import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/ui/call-registration-loader.js', import.meta.url), 'utf8');

// A compact global board exists independently from the modal registration host.
assert.match(ui, /LIVE_HOST_ID = 'simnet-workbench-call-live-host'/);
assert.match(ui, /TEST CALL · LIVE EVIDENCE/);
assert.match(ui, /showLiveMonitor\(\)/);
assert.match(ui, /hideLiveMonitor\(\)/);
assert.match(ui, /syncLiveMonitor\(\)/);
assert.match(ui, /data-live-action="stop"/);

// The board is driven by semantic CALL evidence only.
for (const type of ['SEARCH_SUBMIT','SEARCH_RESOLVED','SEARCH_RESULT_OPEN','SUBSCRIBER_VISIT','NAVIGATION_INTENT','HANDOFF']) {
  assert.match(ui, new RegExp(type));
}
assert.match(ui, /Открыл Billing-карточку/);
assert.match(ui, /Вернулся в Billing/);
assert.match(ui, /Billing → UserSide/);
assert.match(ui, /Handoff подтверждён/);
assert.match(ui, /Поиск → INFO/);
assert.match(ui, /SEARCH→INFO/);
assert.match(ui, /HO 1/);
assert.match(ui, /Тех\. раздел Billing/);
assert.doesNotMatch(ui, /replay\.candidates\.slice\(0,\s*3\)/, 'LIVE board must show every observed candidate, not top-3 only');

// Re-score from the one global ledger whenever canonical state changes; no polling interval.
assert.match(ui, /STATE_STORAGE_KEY = 'simnet_workbench_state_v5'/);
assert.match(ui, /chrome\.storage\.onChanged\.addListener\(this\.boundStorageChanged\)/);
assert.match(ui, /CALL_FROZEN_REPLAY_MESSAGE/);
assert.doesNotMatch(ui, /setInterval\s*\(/);

// New supported tabs auto-attach to the same active global TEST-call.
assert.match(loader, /SIM_CALL_STORAGE_KEY = 'simnet_wb_test_simulated_call_v1'/);
assert.match(loader, /syncGlobalTestMonitor/);
assert.match(loader, /module\?\.showLiveMonitor\?\.\(\)/);
assert.match(loader, /chrome\.storage\.onChanged\.addListener\(onStorageChanged\)/);
assert.match(loader, /visibilitychange/);
assert.match(loader, /pageshow/);
assert.match(loader, /document\.visibilityState !== 'hidden'/);

// Frozen replay is now truly global and does not require a current case.
assert.match(ui, /caseId: this\.caseSnapshot\?\.caseId \|\| ''/);

console.log('PASS call_live_evidence_board_contract_test');
