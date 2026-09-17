import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('AI Lab visually distinguishes semantic KB activity, tools, results and fallback', () => {
  const js = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/ui/ai-operator-lab.css', import.meta.url), 'utf8');

  assert.match(js, /event\.type === 'semantic_analysis'/);
  assert.match(js, /event\.type === 'tool_execution'/);
  assert.match(js, /event\.type === 'experiment_result'/);
  assert.match(js, /event\.type === 'turn_degraded'/);
  assert.match(js, /JSON\.stringify|json\(payload\)/);

  assert.match(css, /\.ai-lab-event\.semantic_analysis\{/);
  assert.match(css, /content:'KB \/ AI'/);
  assert.match(css, /\.ai-lab-event\.tool_execution\{/);
  assert.match(css, /content:'TOOL'/);
  assert.match(css, /\.ai-lab-event\.experiment_result\{/);
  assert.match(css, /content:'RESULT'/);
  assert.match(css, /\.ai-lab-event\.turn_degraded\{/);
  assert.match(css, /content:'FALLBACK'/);
  assert.match(css, /border-left:4px solid/);
});
