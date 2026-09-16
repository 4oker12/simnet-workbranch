import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  executeInformationNeeds,
  evidenceFallbackReply,
  groundSubscriberReply
} from '../src/features/ai-operator/semantic-tool-broker.js';

test('explicit login bootstraps subscriber lookup even when LLM requested no data', async () => {
  const seen = [];
  const result = await executeInformationNeeds({
    needs: [],
    transcript: [{ role: 'customer', text: 'abon234797' }],
    analysis: { probe: { whatUserWants: 'Продолжить проверку подключения' } },
    labState: {},
    execute: async ({ tool }) => {
      seen.push(tool);
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: '2026-09-16T20:00:00.000Z',
        data: { candidate: { contract: '234797', login: 'abon234797' }, source: 'billing-live-read-only' },
        warnings: [],
        statePatch: { confirmedCaseId: 'billing-live:234797', confirmedSubscriber: { contract: '234797', login: 'abon234797' } }
      };
    }
  });

  assert.deepEqual(seen, ['customer.lookup']);
  assert.equal(result.labState.confirmedCaseId, 'billing-live:234797');
  assert.equal(result.trace[0].ok, true);
});

test('degraded answer after successful tools is rebuilt from evidence, not stale pre-tool draft', async () => {
  const toolTrace = [
    {
      tool: 'customer.snapshot',
      ok: true,
      code: 'OK',
      source: 'billing-live-read-only',
      data: {
        identity: { contract: '234797' },
        service: { accessState: 'Разрешен', serviceState: 'Все ОК' },
        network: { connectionFamily: 'EPON' }
      }
    },
    {
      tool: 'pon.onu',
      ok: false,
      code: 'USERSIDE_TAB_REQUIRED',
      source: 'userside-live-read-only',
      data: { message: 'live check unavailable' }
    }
  ];

  const result = await groundSubscriberReply({
    draft: {
      reply: 'Мне нужно проверить статус договора в Billing. Подтвердите, что договор активен.',
      subscriberDataNeeded: [{ system: 'Billing', field: 'статус договора', why: 'проверить доступ' }]
    },
    transcript: [{ role: 'customer', text: 'интернет не работает' }],
    analysis: { probe: { language: 'ru', whatUserWants: 'Понять, почему нет интернета' } },
    labState: { confirmedCaseId: 'billing-live:234797', confirmedSubscriber: { contract: '234797' } },
    execute: async () => { throw new Error('must not be called by injected coreGround'); },
    coreGround: async () => ({
      reply: 'Мне нужно проверить статус договора в Billing. Подтвердите, что договор активен.',
      toolTrace,
      toolEvidence: toolTrace.filter(item => item.ok),
      toolState: { confirmedCaseId: 'billing-live:234797', confirmedSubscriber: { contract: '234797' } },
      degraded: true,
      degradationReason: 'Groq HTTP 429 — rate limit'
    })
  });

  assert.match(result.reply, /Разрешен/i);
  assert.match(result.reply, /Все ОК/i);
  assert.match(result.reply, /EPON/i);
  assert.match(result.reply, /не удалось/i);
  assert.doesNotMatch(result.reply, /подтвердите.*договор активен|нужно проверить статус договора/i);
});

test('failed tool payload never becomes a confirmed negative fact', () => {
  const reply = evidenceFallbackReply(
    { probe: { language: 'ru', whatUserWants: 'Проверить состояние услуги' } },
    [
      { tool: 'customer.lookup', ok: true, code: 'OK', source: 'billing-live-read-only', data: { candidate: { contract: '234797' } } },
      { tool: 'billing.tariff', ok: false, code: 'DATA_NOT_AVAILABLE', source: 'billing-live-read-only', data: { accessState: 'Заблокирован', serviceState: 'Отключен' } }
    ]
  );
  assert.match(reply, /Договор 234797 найден/i);
  assert.doesNotMatch(reply, /Заблокирован|Отключен/i);
});

test('wrapper preserves evidence safety contract required by existing regression suite', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker.js', import.meta.url), 'utf8');
  assert.match(source, /source=userside-live-read-only/);
  assert.match(source, /source=billing-live-read-only/);
  assert.match(source, /Workbench\/Network fallback не выдавай за свежий/i);
  assert.match(source, /ok=false означает.*НЕ доказательство отрицательного факта/i);
  assert.match(source, /поле reply ОБЯЗАТЕЛЬНО должно быть непустым/i);
});
