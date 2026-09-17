import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('AI Lab visibly exposes KB hit/miss/skip, identity, tools and fallback while keeping raw JSON', () => {
  const js = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/ui/ai-operator-lab.css', import.meta.url), 'utf8');

  assert.match(js, /KB HIT/);
  assert.match(js, /KB MISS/);
  assert.match(js, /KB SKIP/);
  assert.match(js, /IDENTITY/);
  assert.match(js, /eventTone/);
  assert.match(js, /importantEventNote/);
  assert.match(js, /event\.type === 'semantic_analysis'/);
  assert.match(js, /event\.type === 'tool_execution'/);
  assert.match(js, /event\.type === 'experiment_result'/);
  assert.match(js, /event\.type === 'turn_degraded'/);
  assert.match(js, /json\(payload\)/);
  assert.match(js, /Энциклопедия была проверена, но релевантная подтверждённая статья не найдена/);

  for (const className of [
    'trace-kb-hit',
    'trace-kb-miss',
    'trace-kb-skip',
    'trace-tool-ok',
    'trace-tool-error',
    'trace-identity',
    'trace-warning',
    'trace-internal'
  ]) {
    assert.match(css, new RegExp(`\\.${className}\\b`));
  }
  assert.match(css, /\.ai-lab-event-note\{/);
  assert.match(css, /border-left:4px solid/);
});
