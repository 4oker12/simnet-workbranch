import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Billing page snapshot captures nested discount percent and UAH rows separately', () => {
  const source = readFileSync(
    new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /function readDiscount\(\)/);
  assert.match(source, /querySelectorAll\('tr'\)/);
  assert.match(source, /cells\.length < 2/);
  assert.match(source, /\^\(\?:скидк\|знижк\)/u);
  assert.match(source, /%\/u\.test\(label\).*percent = numeric/s);
  assert.match(source, /грн\/iu\.test\(label\).*adjustmentUAH = numeric/s);
  assert.match(source, /amountUAH:\s*Math\.abs\(adjustmentUAH\)/);
  assert.match(source, /discount:\s*readDiscount\(\)/);
});

test('local subscriber snapshot preserves captured discount for canonical fallback', () => {
  const source = readFileSync(
    new URL('../src/features/ai-operator/tool-runtime.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /discount:\s*finance\.discount.*compactObject\(finance\.discount\)/s);
});
