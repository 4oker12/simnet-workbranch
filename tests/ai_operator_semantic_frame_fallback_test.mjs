import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeConsultationFallbackReply } from '../src/features/ai-operator/semantic-tool-broker.js';

test('knowledge fallback answers the already-understood higher-speed question instead of dumping encyclopedia text', () => {
  const analysis = {
    probe: {
      language: 'ru',
      whatUserWants: 'Узнать, существуют ли тарифы со скоростью выше 1 Гбит/с.',
      latestMessageMeans: 'Клиент спрашивает, есть ли в линейке провайдера скорости выше текущего (1 Гбит/с).',
      underlyingGoal: 'Оценить возможность получения максимальной доступной скорости интернета.',
      factsSaidByOperator: ['У клиента уже подключен тариф 1 Гбит/с'],
      unresolvedRequests: ['Нужна информация о наличии тарифов со скоростью выше 1 Гбит/с']
    },
    knowledge: {
      articleEvidence: [
        {
          id: 'tariff.residential',
          title: 'Домашние тарифы: многоквартирный сектор',
          summary: 'Подтверждённые скорости и месячная стоимость стандартных домашних тарифов.',
          text: 'Для стандартного домашнего подключения подтверждены следующие тарифные уровни:\n- 100 Мбит/с — 250 грн/месяц;\n- 500 Мбит/с — 300 грн/месяц;\n- 1 Гбит/с — 350 грн/месяц.'
        },
        {
          id: 'tariff.private-sector',
          title: 'Домашние тарифы: частный сектор',
          summary: 'Подтверждённые скорости и стоимость для частного сектора.',
          text: 'Для частного сектора подтверждены:\n- 100 Мбит/с — 300 грн/месяц;\n- 1 Гбит/с — 400 грн/месяц.'
        }
      ],
      relevantInternalKnowledge: []
    }
  };

  const reply = knowledgeConsultationFallbackReply(analysis, []);
  assert.match(reply, /максимальная.*1 Гбит\/с/i);
  assert.match(reply, /выше этого уровня.*нет/i);
  assert.doesNotMatch(reply, /По внутренней информации SIMNET/i);
  assert.doesNotMatch(reply, /100 Мбит\/с.*500 Мбит\/с.*350 грн/i);
  assert.ok(reply.length < 320, `fallback must stay subscriber-facing and concise: ${reply.length}`);
});
