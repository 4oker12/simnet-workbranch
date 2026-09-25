import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  isTariffStatusMarker,
  normalizeBillingTariffSnapshot
} from '../src/features/ai-operator/billing-tariff-normalizer.js';
import { mergeServiceSnapshot } from '../src/features/ai-operator/live-tool-runtime.js';

const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
const summary = fs.readFileSync(new URL('../src/features/ai-operator/billing-summary-live.js', import.meta.url), 'utf8');
const historyLive = fs.readFileSync(new URL('../src/features/ai-operator/billing-history-live.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');

test('blocked selector values are status markers, never canonical tariffs', () => {
  for (const marker of ['Заблокирован', 'Заблокировано', 'Заблокован', 'blocked']) {
    assert.equal(isTariffStatusMarker(marker), true, marker);
  }
  assert.equal(isTariffStatusMarker('Internet 100'), false);

  const normalized = normalizeBillingTariffSnapshot({
    service: {
      configuredTariff: 'Заблокирован',
      currentTariff: 'Заблокирован',
      currentTariffSelectedLabel: 'Заблокирован'
    }
  });
  assert.equal(normalized.service.currentTariffRaw, '');
  assert.equal(normalized.service.configuredTariff, '');
  assert.equal(normalized.service.tariffSelectorState, 'Заблокирован');
  assert.equal(normalized.service.tariffResolutionRequired, true);
});

test('main Billing reader forces payshow recovery when paket selector is blocked', () => {
  assert.match(summary, /const currentTariff = tariffSelectorState \? '' : \(configuredTariff \|\| summaryTariff\)/);
  assert.match(summary, /currentTariffSource:[\s\S]*history_required_from_payshow/);
  assert.match(summary, /tariffResolutionRequired: Boolean\(tariffSelectorState\)/);
});

test('payshow parser keeps broad local history and extracts package before block', () => {
  assert.match(capture, /SIMNET_AI_BILLING_HISTORY_READ_V1/);
  assert.match(capture, /function parsePayshowHistory/);
  assert.match(capture, /packageBeforeBlock/);
  assert.match(capture, /package_change/);
  assert.match(capture, /temporary_payment/);
  assert.match(capture, /first_activity/);
  assert.match(capture, /network_or_group_change/);
  assert.match(capture, /type_pays:\s*'50'/);
  assert.match(capture, /Показать\\s\+всю\\s\+историю|показать\\s\+всю\\s\+историю/i);
  assert.match(capture, /detailId/);
  assert.doesNotMatch(capture, /detailHref/);
  assert.match(capture, /source:\s*'billing-payshow-history'/);
});

test('fresh blocked main state cannot erase recovered historical tariff', () => {
  const merged = mergeServiceSnapshot({
    currentTariff: 'Fixture 100',
    configuredTariff: 'Fixture 100',
    currentTariffSource: 'payshow:last_package_before_block',
    tariffResolutionRequired: false,
    tariffHistorical: true,
    historicalTariffEvidence: { name: 'Fixture 100', changedTo: 'Заблокирован' }
  }, {
    currentTariff: '',
    configuredTariff: '',
    currentTariffSource: 'history_required_from_payshow',
    tariffSelectorState: 'Заблокирован',
    tariffResolutionRequired: true,
    accessState: 'Заблокировано'
  });

  assert.equal(merged.currentTariff, 'Fixture 100');
  assert.equal(merged.currentTariffSource, 'payshow:last_package_before_block');
  assert.equal(merged.tariffResolutionRequired, false);
  assert.equal(merged.tariffHistorical, true);
  assert.equal(merged.tariffSelectorState, 'Заблокирован');
  assert.equal(merged.accessState, 'Заблокировано');
});

test('billing.history is lazy and cached, while tariff recovery can call event history on demand', () => {
  assert.match(historyLive, /readBillingHistoryLive/);
  assert.match(historyLive, /SIMNET_AI_BILLING_HISTORY_READ_V1/);
  assert.match(runtime, /async function executeBillingHistoryTool/);
  assert.match(runtime, /tool === 'billing\.history'|name === 'billing\.history'/);
  assert.match(runtime, /scope:\s*'events'/);
  assert.match(runtime, /tariff-history-recovery/);
  assert.match(runtime, /payshow:last_package_before_block/);
});
