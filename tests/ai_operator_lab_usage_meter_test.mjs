import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const meter = fs.readFileSync(new URL('../src/ui/ai-operator-lab-usage.js', import.meta.url), 'utf8');

test('Manual Lab exposes per-turn and session token usage without making AI requests', () => {
  assert.match(html, /src="ai-operator-lab-usage\.js"/);
  assert.match(meter, /AI_OPERATOR_LAB_GET/);
  assert.match(meter, /turn\.total_tokens/);
  assert.match(meter, /turn\.input_tokens/);
  assert.match(meter, /turn\.output_tokens/);
  assert.match(meter, /session\.total_tokens/);
  assert.match(meter, /turn\.calls/);
  assert.match(meter, /session\.calls/);
  assert.match(meter, /by_model/);
  assert.match(meter, /Модели этого хода/);
  assert.doesNotMatch(meter, /chat\/completions|api\.groq\.com|fetch\s*\(/, 'usage meter must only render recorded usage and must never spend tokens itself');
});
