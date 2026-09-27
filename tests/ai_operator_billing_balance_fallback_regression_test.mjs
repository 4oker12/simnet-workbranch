import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  mergePresent,
  missingBillingMainFacts
} from '../src/features/ai-operator/live-tool-runtime.js';

const ACCOUNT_BALANCE = 'subscriber.finance.balance.account';

test('null accountBalance is missing evidence and must trigger broad Billing fallback', () => {
  const data = {
    finance: {
      accountBalance: null,
      balanceWithoutTemporary: 584.2,
      balanceAfterTariff: 384.2,
      totalDue: 300
    }
  };

  assert.deepEqual(missingBillingMainFacts([ACCOUNT_BALANCE], data), [ACCOUNT_BALANCE]);
});

test('a neighbouring finance value can never satisfy current account balance', () => {
  const data = {
    finance: {
      balanceWithoutTemporary: 584.2,
      balanceAfterTariff: 384.2,
      totalDue: 300
    }
  };

  assert.deepEqual(missingBillingMainFacts([ACCOUNT_BALANCE], data), [ACCOUNT_BALANCE]);
});

test('zero account balance is real observed evidence and does not trigger fallback', () => {
  const data = { finance: { accountBalance: 0 } };
  assert.deepEqual(missingBillingMainFacts([ACCOUNT_BALANCE], data), []);
});

test('null dedicated value cannot erase exact account balance recovered by fallback', () => {
  const broad = {
    accountBalance: 584.2,
    balanceWithoutTemporary: 584.2
  };
  const dedicated = {
    accountBalance: null,
    balanceAfterTariff: 384.2
  };

  assert.deepEqual(mergePresent(broad, dedicated), {
    accountBalance: 584.2,
    balanceWithoutTemporary: 584.2,
    balanceAfterTariff: 384.2
  });
});

test('dedicated Billing parser prefers the main form for На счету and keeps whole-page fallback', () => {
  const source = readFileSync(
    new URL('../src/features/ai-operator/billing-summary-live.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /const mainRows = readRows\(mainForm\)/);
  assert.match(source, /const mainIndex = indexRows\(mainRows\)/);
  assert.match(source, /let pageRows = null/);
  assert.match(source, /if \(!pageRows\) pageRows = readRows\(root\)/);
  assert.match(source, /if \(!pageIndex\) pageIndex = indexRows\(fallbackRows\(\)\)/);
  assert.match(
    source,
    /\['accountBalance',\s*rowFrom\(mainIndex,\s*\[\/\^на\\s\+сч\[её\]т\(\?:е\|у\)/su
  );
  assert.match(source, /if \(Number\.isFinite\(value\)\) finance\[key\] = value/);
});

test('billing.main_summary forces a fresh broad fallback after a live failure or missing canonical facts', () => {
  const source = readFileSync(
    new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /forceFresh = false/);
  assert.match(source, /refresh: forceFresh \|\| Boolean\(toolArgs\.refresh\)/);
  assert.match(source, /maxAgeMs: 1/);
  assert.match(source, /baseRead\(\{ forceFresh: true \}\)/);
});


test('billing.main_summary broad fallback is normalized by the same tariff semantic authority', () => {
  const source = readFileSync(
    new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /normalizeBillingTariffSnapshot/);
  assert.match(source, /normalizedFallbackData = name === 'billing\.main_summary'/);
  assert.match(source, /normalizeBillingTariffSnapshot\(base\.data \|\| \{\}/);
  assert.match(source, /tool: name/);
});
