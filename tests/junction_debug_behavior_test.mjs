import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/core/junction-debug.js', import.meta.url), 'utf8');
const listeners = new Map();
const WB = {
  bus: {
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    emit() {}
  },
  caseView: {
    decision(caseData) { return caseData.__decision || { action: 'wait_context' }; }
  }
};
const sandbox = { console, SIMNET_WB: WB };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.window.top = sandbox.window;
sandbox.window.self = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'junction-debug.js' });

const dbg = sandbox.SIMNET_WB.junctionDebug;
assert.ok(dbg, 'junction debugger should be installed');
assert.equal(dbg.serialEquivalent('HWTC:D1A3523D', '48575443D1A3523D'), true, 'Huawei ASCII prefix and hex prefix must be equivalent');

const historicalCase = {
  id: 'login:abon471328',
  diagnostic: { ponWorkflowDetails: { conflicts: [], prefillFields: [] } },
  conflicts: [
    { at: '2026-08-23T11:47:56.510Z', field: 'pon.oltIp', oldValue: '172.16.9.180', newValue: '172.16.1.50', oldSource: 'billing:olt-selected-option-ip', newSource: 'billing:olt-selected-option-ip', count: 1 },
    { at: '2026-08-23T11:47:56.510Z', field: 'pon.oltId', oldValue: '65', newValue: '87', oldSource: 'billing:olt-select-value', newSource: 'billing:olt-select-value', count: 1 },
    { at: '2026-08-23T11:47:56.510Z', field: 'pon.oltName', oldValue: 'Aleksandrovskaya_GPON BDCOM', newValue: 'Sim36-OLT-Huawei Huawei', oldSource: 'billing:olt-selected-option', newSource: 'billing:olt-selected-option', count: 1 },
    { at: '2026-08-23T11:45:03.971Z', field: 'pon.onuSerial', oldValue: 'HWTC:D1A3523D', newValue: '48575443D1A3523D', oldSource: 'billing:onu-serial', newSource: 'billing:onu-serial', count: 1 }
  ]
};
const historyReport = dbg.analyze(historicalCase);
assert.equal(historyReport.metrics.active, 0);
assert.equal(historyReport.metrics.equivalent, 1, 'equivalent serial formatting must not be active conflict');
assert.ok(historyReport.history.some(item => item.kind === 'binding_change' && item.fields.length === 3), 'three OLT fields from one update must collapse into one binding change');

const activeCase = {
  id: 'login:test',
  diagnostic: {
    ponWorkflowDetails: {
      conflicts: [{ field: 'olt', billing: 'OLT-A · 10.0.0.1', tmc: 'OLT-B · 10.0.0.2', blocking: false }],
      prefillFields: [],
      billingTechnicalComplete: true
    }
  },
  conflicts: []
};
const activeReport = dbg.analyze(activeCase);
assert.equal(activeReport.metrics.active, 1);
assert.equal(activeReport.active[0].joint, 'TMC ↔ Billing');
assert.equal(activeReport.active[0].status, 'active');

const stateMismatchCase = {
  id: 'login:state',
  diagnostic: { ponWorkflowDetails: { conflicts: [], prefillFields: [], billingTechnicalComplete: true } },
  progress: { tmcChecked: { done: true } },
  __decision: { action: 'check_tmc', completionKey: 'tmcChecked' }
};
const stateReport = dbg.analyze(stateMismatchCase);
assert.ok(stateReport.active.some(item => item.kind === 'state_mismatch'), 'state/UI contradiction should be visible as a junction');

console.log('junction_debug_behavior_test: ok');
