import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const meter = fs.readFileSync(new URL('../src/ui/ai-operator-lab-usage.js', import.meta.url), 'utf8');
const cost = fs.readFileSync(new URL('../src/features/ai-operator/api-cost.js', import.meta.url), 'utf8');

test('Manual Lab exposes real per-turn/session token usage and call stages without making AI requests', () => {
  assert.match(html, /src="ai-operator-lab-usage\.js"/);
  assert.match(meter, /AI_OPERATOR_LAB_GET/);
  assert.match(meter, /usage\.total_tokens/);
  assert.match(meter, /usage\.input_tokens/);
  assert.match(meter, /usage\.output_tokens/);
  assert.match(meter, /usage\.input/);
  assert.match(meter, /usage\.output/);
  assert.match(meter, /turn\.calls/);
  assert.match(meter, /session\.calls/);
  assert.match(meter, /by_model/);
  assert.match(meter, /by_stage/);
  assert.match(meter, /Модели этого хода/);
  assert.match(meter, /Этапы этого хода/);
  assert.match(meter, /без usage/);
  assert.match(cost, /input_tokens: summary\.input/);
  assert.match(cost, /total_tokens: summary\.input \+ summary\.output/);
  assert.match(cost, /stages\[stage\] = aggregateUsage/);
  assert.doesNotMatch(meter, /chat\/completions|api\.groq\.com|fetch\s*\(/, 'usage meter must only render recorded usage and must never spend tokens itself');
});
