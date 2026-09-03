import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const callIndex = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');
const globalAudit = fs.readFileSync(new URL('../src/features/call/export/global-audit.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../src/features/call/config.js', import.meta.url), 'utf8');

// One extension-global TEST session, not a per-case/per-tab object.
assert.match(ui, /SIM_CALL_STORAGE_KEY = 'simnet_wb_test_simulated_call_v1'/);
assert.match(ui, /chrome\.storage\.local\.get\(SIM_CALL_STORAGE_KEY\)/);
assert.match(ui, /chrome\.storage\.local\.set\(\{ \[SIM_CALL_STORAGE_KEY\]: this\.simCall \}\)/);
assert.doesNotMatch(ui, /chrome\.storage\.session/);
assert.match(ui, /Global TEST session always wins/);
assert.match(ui, /hasCompletedSim/);
assert.match(ui, /modeChoice = 'sim'/);
assert.match(ui, /await this\.runTestReplay\(\)/);

// CALL entry point is globally reachable; it must not reject because no active case.
assert.doesNotMatch(rail, /Сначала открой текущего абонента/);
assert.match(rail, /TEST-call is global/);
assert.match(ui, /globalTestAvailable: true/);

// Completed TEST session remains usable and exportable after STOP.
assert.match(ui, /startedAtMs: now/);
assert.match(ui, /active: false/);
assert.match(ui, /endedAtMs/);
assert.match(ui, /Последний TEST-звонок/);
assert.match(ui, /simulatedCall: this\.simCall \? \{ \.\.\.\(this\.simCall \|\| \{\}\) \} : null/);

// Evidence is a single global callModule ledger; replay filters that ledger by START..END.
assert.match(callIndex, /state\.callModule \|\|= createCallModuleState\(\)/);
assert.match(callIndex, /evidence: createEvidenceState\(\)/);
assert.match(callIndex, /evidenceInWindow\(enriched\.evidence, startAtMs, endAtMs\)/);
assert.match(globalAudit, /callEvidenceBuffer: events/);
assert.match(config, /EVIDENCE_RETENTION_MS = 48 \* 60 \* 60 \* 1000/);

// Recorder scope stays semantic, not raw click/mouse telemetry.
for (const type of ['IDENTIFIED_BY_SEARCH','HANDOFF','ATTENTION_INTERVAL','TECH_ACTION']) {
  assert.match(config, new RegExp(`${type}: '${type}'`));
}
assert.doesNotMatch(config, /MOUSE|POINTER|mousemove|CLICK_ALL/i);

console.log('PASS call_global_simulated_session_contract_test');
