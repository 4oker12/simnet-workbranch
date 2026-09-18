import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readBillingTechnicalLive } from '../src/features/ai-operator/billing-technical-live.js';

const source = fs.readFileSync(new URL('../src/features/ai-operator/billing-technical-live.js', import.meta.url), 'utf8');

test('Billing technical reader requires a Billing id before any live read', async () => {
  const result = await readBillingTechnicalLive({ billingId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BILLING_ID_REQUIRED');
});

test('explicit dopfield_39 is primary connection technology and inference is fallback only', () => {
  assert.match(source, /explicitTechnology\s*=\s*selected\('dopfield_39'\)/);
  assert.match(source, /technology\s*=\s*explicitTechnology\s*\|\|\s*inferredTechnology/);
  assert.match(source, /technologySource:\s*explicitTechnology\s*\?\s*'billing\.dopfield_39'/);
  assert.match(source, /tmpl['"],\s*'1'/);
});
