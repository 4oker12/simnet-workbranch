import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groundSubscriberReply,
  knowledgeConsultationFallbackReply
} from '../src/features/ai-operator/semantic-tool-broker.js';

const analysis = {
  probe: {
    language: 'ru',
    whatUserWants: 'Перейти на гигабит'
  },
  knowledge: {
    articleEvidence: [
      {
        id: 'billing.identification',
        title: 'Идентификация договора',
        text: 'Для работы с конкретным подключением нужен идентификатор договора. Уже сообщённый договор не следует спрашивать повторно.'
      },
      {
        id: 'tariff.upgrade',
        title: 'Повышение тарифа и переход на гигабит',
        text: 'Повысить тариф можно в любой день месяца.\n\nРазница в стоимости при повышении списывается сразу полностью. Перед фактическим переключением требуется явное согласие клиента.'
      },
      {
        id: 'technical.gigabit-equipment',
        title: 'Оборудование для гигабитной скорости',
        text: 'Для проводной скорости до 1 Гбит/с роутер должен иметь гигабитные WAN/LAN-порты. Кабель должен быть полноценным 8-жильным Ethernet-кабелем.'
      }
    ]
  }
};

test('KB consultation fallback answers known general rules even when generation degraded', () => {
  const reply = knowledgeConsultationFallbackReply(analysis, [
    { role: 'customer', text: 'Boxing договір\nхочу на гигабит' }
  ]);

  assert.match(reply, /Повысить тариф можно в любой день месяца/i);
  assert.match(reply, /гигабитные WAN\/LAN-порты/i);
  assert.doesNotMatch(reply, /нужен идентификатор договора/i);
});

test('degraded generation keeps KB consultation and still performs supplied contract lookup', async () => {
  const transcript = [{ role: 'customer', text: 'Boxing договір\nхочу на гигабит' }];
  const result = await groundSubscriberReply({
    draft: {
      reply: 'Сейчас не удалось получить подтверждённые данные.',
      subscriberDataNeeded: [],
      degraded: true,
      degradationReason: 'rate limit'
    },
    transcript,
    analysis,
    labState: {},
    execute: async ({ tool, toolArgs }) => {
      assert.equal(tool, 'customer.lookup');
      assert.deepEqual(toolArgs, { login: 'boxing' });
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: '2026-09-17T12:00:00.000Z',
        data: {
          source: 'billing-live-read-only',
          candidate: { billingId: '50845', contract: 'Boxing', login: 'boxing' }
        },
        warnings: [],
        statePatch: {
          confirmedCaseId: 'billing-live:50845',
          confirmedSubscriber: { billingId: '50845', contract: 'Boxing', login: 'boxing' }
        }
      };
    },
    coreGround: async ({ labState }) => ({
      reply: 'Договор Boxing найден.',
      toolTrace: [],
      toolEvidence: [],
      toolState: labState,
      degraded: true,
      degradationReason: 'rate limit'
    })
  });

  assert.equal(result.toolTrace[0].tool, 'customer.lookup');
  assert.equal(result.toolTrace[0].ok, true);
  assert.match(result.reply, /Повысить тариф можно в любой день месяца/i);
  assert.match(result.reply, /Договор Boxing найден/i);
  assert.doesNotMatch(result.reply, /повторите запрос/i);
});
