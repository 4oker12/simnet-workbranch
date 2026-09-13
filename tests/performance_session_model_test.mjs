import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPerformanceSession,
  appendPerformanceSample,
  createPerformanceSnapshot,
  ensureContinuousPerformanceSession,
  performanceSessionControl,
  performanceSessionOverview
} from '../src/features/performance/session-model.js';

const START = Date.parse('2026-09-13T09:00:00.000Z');
const MIB = 1024 * 1024;

function sample(index, slow = false) {
  const pageLoadMs = slow ? 1900 : 620;
  const requestMs = slow ? 520 : 130;
  return {
    id: `sample-${index}`,
    at: new Date(START + index * 60_000).toISOString(),
    reason: index ? 'interval' : 'page-entry',
    documentId: `doc-${Math.floor(index / 2)}`,
    page: {
      system: 'userside',
      route: 'userside.simnet.kiev.ua/customer/123456?customer_uuid=secret',
      visibility: 'visible'
    },
    navigation: {
      type: 'navigate',
      ttfbMs: slow ? 610 : 190,
      loadMs: pageLoadMs
    },
    resources: {
      windowMs: 60_000,
      count: 10,
      totalDurationMs: requestMs * 10,
      maxDurationMs: requestMs,
      routes: [{
        route: 'userside.simnet.kiev.ua/message/tab?section=call&customer_uuid=secret',
        count: 10,
        totalDurationMs: requestMs * 10,
        maxDurationMs: requestMs
      }]
    },
    longTasks: { count: slow ? 5 : 0, totalDurationMs: slow ? 850 : 0, maxDurationMs: slow ? 240 : 0 },
    eventLoopDelayMs: slow ? 55 : 4,
    domNodes: slow ? 3400 : 1300,
    storageBytes: (slow ? 8 : 2) * MIB,
    memory: { usedJsHeapBytes: (slow ? 170 : 65) * MIB },
    metrics: [
      { metric: 'runtime.workbench_ready', count: 1, totalDurationMs: pageLoadMs, maxDurationMs: pageLoadMs },
      { metric: 'call.registration_open', count: 1, totalDurationMs: slow ? 1500 : 430, maxDurationMs: slow ? 1500 : 430 }
    ],
    operations: [{
      at: new Date(START + index * 60_000 + 500).toISOString(),
      metric: 'call.registration_open',
      durationMs: slow ? 1500 : 430,
      status: 'ok',
      meta: {
        action: 'call-registration',
        customerId: 'must-not-be-exported',
        error: 'Форма относится к абоненту 123456',
        target: 'https://userside.simnet.kiev.ua/customer/123456?customer_uuid=secret'
      }
    }]
  };
}

test('an operator snapshot reports exact actions without stopping continuous collection', () => {
  let session = createPerformanceSession({ nowMs: START, version: '1.2.3' });
  for (let index = 0; index < 12; index += 1) {
    session = appendPerformanceSample(session, sample(index, index >= 6), {
      nowMs: START + index * 60_000
    });
  }
  const snapshot = createPerformanceSnapshot(session, { nowMs: START + 12 * 60_000 });

  assert.equal(session.status, 'active');
  assert.equal(snapshot.status, 'snapshot');
  assert.equal(snapshot.completionReason, 'operator-snapshot');
  assert.equal(snapshot.report.durationMs, 12 * 60_000);
  assert.equal(snapshot.report.confidence, 'medium');
  assert.equal(snapshot.report.verdict, 'degraded');
  assert.equal(snapshot.report.sampleCount, 12);
  assert.equal(snapshot.report.resourceRequestCount, 120);
  assert.equal(snapshot.report.metrics.find(item => item.key === 'navigation.load')?.state, 'bad');
  assert.equal(snapshot.report.metrics.find(item => item.key === 'memory.used')?.state, 'bad');
  assert.equal(snapshot.report.operations[0]?.metric, 'call.registration_open');
  assert.equal(snapshot.report.operations[0]?.count, 12);
  assert.ok(snapshot.report.operations[0]?.deltaPercent > 200);
  assert.equal(snapshot.report.operationTimeline.length, 12);
  assert.equal(snapshot.report.operationTimeline[0].meta.customerId, undefined, 'subscriber identifiers are stripped from action telemetry');
  assert.doesNotMatch(snapshot.report.operationTimeline[0].meta.error, /123456/);
  assert.doesNotMatch(snapshot.report.operationTimeline[0].meta.target, /123456|secret|[?&]/);
  assert.equal(snapshot.report.pageRoutes[0]?.route, 'userside.simnet.kiev.ua/customer/:id');
  assert.ok(snapshot.report.pageRoutes[0]?.deltaPercent > 200);
  assert.doesNotMatch(snapshot.samples[0].page.route, /[?&]/);
  assert.doesNotMatch(snapshot.samples[0].resources.routes[0].route, /[?&]/);
});

test('continuous collection has no deadline and remains active until a snapshot is requested', () => {
  let session = createPerformanceSession({ nowMs: START });
  const control = performanceSessionControl(session);
  assert.equal(control.status, 'active');
  assert.equal(control.mode, 'continuous');
  assert.equal(session.plannedEndAt, '');

  session = appendPerformanceSample(session, sample(30, false), { nowMs: START + 8 * 60 * 60_000 });
  assert.equal(session.status, 'active');
  assert.equal(performanceSessionOverview(session, START + 8 * 60 * 60_000).elapsedMs, 8 * 60 * 60_000);
});

test('an old active bounded session migrates in place to continuous mode', () => {
  const legacy = {
    ...createPerformanceSession({ nowMs: START }),
    schemaVersion: 1,
    mode: '',
    plannedEndAt: new Date(START + 30 * 60_000).toISOString(),
    targetDurationMs: 30 * 60_000
  };
  const migrated = ensureContinuousPerformanceSession(legacy, { nowMs: START + 45 * 60_000, version: '1.7.36.160' });
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.status, 'active');
  assert.equal(migrated.mode, 'continuous');
  assert.equal(migrated.plannedEndAt, '');
  assert.equal(migrated.targetDurationMs, null);
});

test('duplicate content-script delivery does not duplicate a measurement point', () => {
  let session = createPerformanceSession({ nowMs: START });
  session = appendPerformanceSample(session, sample(0), { nowMs: START });
  session = appendPerformanceSample(session, sample(0), { nowMs: START + 1 });
  assert.equal(session.sampleCount, 1);
});
