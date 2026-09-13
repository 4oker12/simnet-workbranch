import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPerformanceSession,
  appendPerformanceSample,
  finalizePerformanceSession,
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
    ]
  };
}

test('an operator can stop early and still receive a beginning-to-end degradation report', () => {
  let session = createPerformanceSession({ nowMs: START, durationMs: 30 * 60_000, version: '1.2.3' });
  for (let index = 0; index < 12; index += 1) {
    session = appendPerformanceSample(session, sample(index, index >= 6), {
      nowMs: START + index * 60_000
    });
  }
  session = finalizePerformanceSession(session, { nowMs: START + 12 * 60_000, reason: 'operator' });

  assert.equal(session.status, 'completed');
  assert.equal(session.completionReason, 'operator');
  assert.equal(session.report.durationMs, 12 * 60_000);
  assert.equal(session.report.confidence, 'medium');
  assert.equal(session.report.verdict, 'degraded');
  assert.equal(session.report.sampleCount, 12);
  assert.equal(session.report.resourceRequestCount, 120);
  assert.equal(session.report.metrics.find(item => item.key === 'navigation.load')?.state, 'bad');
  assert.equal(session.report.metrics.find(item => item.key === 'memory.used')?.state, 'bad');
  assert.equal(session.report.operations[0]?.metric, 'call.registration_open');
  assert.ok(session.report.operations[0]?.deltaPercent > 200);
  assert.equal(session.report.pageRoutes[0]?.route, 'userside.simnet.kiev.ua/customer/:id');
  assert.ok(session.report.pageRoutes[0]?.deltaPercent > 200);
  assert.doesNotMatch(session.samples[0].page.route, /[?&]/);
  assert.doesNotMatch(session.samples[0].resources.routes[0].route, /[?&]/);
});

test('the planned deadline completes a session without blocking an earlier manual snapshot', () => {
  let session = createPerformanceSession({ nowMs: START, durationMs: 30 * 60_000 });
  const control = performanceSessionControl(session);
  assert.equal(control.status, 'active');
  assert.equal(new Date(control.plannedEndAt).getTime(), START + 30 * 60_000);

  session = appendPerformanceSample(session, sample(30, false), { nowMs: START + 30 * 60_000 });
  assert.equal(session.status, 'completed');
  assert.equal(session.completionReason, 'deadline');
  assert.equal(performanceSessionOverview(session, START + 31 * 60_000).remainingMs, 0);
});

test('duplicate content-script delivery does not duplicate a measurement point', () => {
  let session = createPerformanceSession({ nowMs: START });
  session = appendPerformanceSample(session, sample(0), { nowMs: START });
  session = appendPerformanceSample(session, sample(0), { nowMs: START + 1 });
  assert.equal(session.sampleCount, 1);
});
