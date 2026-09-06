import test from 'node:test';
import assert from 'node:assert/strict';
import { CallExecutionRegistry } from '../src/features/call/runtime/call-execution-registry.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('different calls execute strictly one at a time in FIFO order', async () => {
  const registry = new CallExecutionRegistry();
  const events = [];

  const run = (key, ms) => registry.run(key, 'test', async () => {
    events.push(`start:${key}`);
    await delay(ms);
    events.push(`end:${key}`);
    return key;
  });

  const first = run('call:1', 30);
  const second = run('call:2', 5);
  const third = run('call:3', 1);

  assert.deepEqual(registry.snapshot().map(row => row.callKey), ['call:1', 'call:2', 'call:3']);
  assert.deepEqual(await Promise.all([first, second, third]), ['call:1', 'call:2', 'call:3']);
  assert.deepEqual(events, [
    'start:call:1', 'end:call:1',
    'start:call:2', 'end:call:2',
    'start:call:3', 'end:call:3'
  ]);
  assert.deepEqual(registry.snapshot(), []);
});

test('duplicate callKey shares the same execution instead of entering twice', async () => {
  const registry = new CallExecutionRegistry();
  let executions = 0;

  const first = registry.run('call:7', 'test', async () => {
    executions += 1;
    await delay(5);
    return 'done';
  });
  const duplicate = registry.run('call:7', 'test', async () => {
    executions += 1;
    return 'wrong';
  });

  assert.strictEqual(first, duplicate);
  assert.equal(await duplicate, 'done');
  assert.equal(executions, 1);
});

test('a queued call can be cancelled without blocking the next call', async () => {
  const registry = new CallExecutionRegistry();
  const events = [];

  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const first = registry.run('call:1', 'test', async () => {
    events.push('start:1');
    await firstGate;
    events.push('end:1');
  });
  const second = registry.run('call:2', 'test', async () => {
    events.push('start:2');
  });
  const third = registry.run('call:3', 'test', async () => {
    events.push('start:3');
  });

  assert.equal(registry.cancel('call:2', 'test'), true);
  assert.equal(await second, null);
  releaseFirst();
  await Promise.all([first, third]);

  assert.deepEqual(events, ['start:1', 'end:1', 'start:3']);
  assert.deepEqual(registry.snapshot(), []);
});
