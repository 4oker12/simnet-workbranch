import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { behaviorPromptGuidance } from '../src/features/ai-operator/behavior-profile.js';

test('mandatory chat style stays concise, latest-question-first and non-repetitive', () => {
  const prompt = behaviorPromptGuidance({ humanLikeness: 5, depth: 5, initiative: 5 });

  assert.match(prompt, /СТИЛЬ ОТВЕТА В ЧАТЕ — ОБЯЗАТЕЛЬНО/);
  assert.match(prompt, /прямой ответ на ПОСЛЕДНИЙ вопрос/);
  assert.match(prompt, /Не повторяй уже сказанное в этом диалоге/);
  assert.match(prompt, /Простой факт \(баланс, да\/нет\) — обычно 1–3 предложения/);
  assert.match(prompt, /Сложный ответ — обычно до 5–7 предложений, без эссе/);
  assert.match(prompt, /максимум ОДИН следующий шаг ИЛИ ОДИН уточняющий вопрос/);
  assert.match(prompt, /не как справка, не как письмо и не как отчёт/);
  assert.match(prompt, /Не выгружай всю карточку дома, всю статью KB/);
  assert.match(prompt, /Без канцелярита и без роботизированных вступлений/);
});

test('answer synthesis receives central behavior/chat guidance', async () => {
  const source = await readFile(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  assert.match(source, /behaviorPromptGuidance\(profile\)/);
  assert.match(source, /ЭТАП: ANSWER SYNTHESIS/);
});
