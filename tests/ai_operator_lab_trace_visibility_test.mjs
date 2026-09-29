import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const labJs = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
const traceJs = fs.readFileSync(new URL('../src/ui/ai-operator-lab-trace.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/ui/ai-operator-lab.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');

test('AI Lab visibly exposes KB hit/miss/skip, identity, tools and fallback while keeping raw JSON', () => {
  assert.match(labJs, /KB HIT/);
  assert.match(labJs, /KB MISS/);
  assert.match(labJs, /KB SKIP/);
  assert.match(labJs, /IDENTITY/);
  assert.match(labJs, /eventTone/);
  assert.match(labJs, /importantEventNote/);
  assert.match(labJs, /event\.type === 'semantic_analysis'/);
  assert.match(labJs, /event\.type === 'tool_execution'/);
  assert.match(labJs, /event\.type === 'experiment_result'/);
  assert.match(labJs, /event\.type === 'turn_degraded'/);
  assert.match(labJs, /json\(payload\)/);
  assert.match(labJs, /Энциклопедия была проверена, но релевантная подтверждённая статья не найдена/);

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

test('AI Lab renders the latest decision as one ordered human-readable pipeline', () => {
  assert.match(html, /src="ai-operator-lab-trace\.js"/);
  assert.doesNotThrow(() => new Function(traceJs));

  const stages = [
    "'ЧТО ПОНЯЛ'",
    "'ЧТО УЖЕ ЗНАЕМ'",
    "'ЧЕГО НЕ ХВАТАЕТ'",
    "'ЧТО РЕШИЛ ПРОВЕРИТЬ'",
    "'ЧТО ПРОВЕРИЛ'",
    "'ЧТО ПОДТВЕРДИЛОСЬ'",
    "'ЧТО ЕЩЁ НЕЯСНО'",
    "'РЕШЕНИЕ'",
    "'ОТВЕТ КЛИЕНТУ'"
  ];
  let previous = -1;
  for (const stage of stages) {
    const index = traceJs.indexOf(stage);
    assert.ok(index > previous, `${stage} must appear after the previous pipeline stage`);
    previous = index;
  }

  assert.match(traceJs, /КАК AI ПРИШЁЛ К ОТВЕТУ/);
  assert.match(traceJs, /Технический журнал ниже — только если нужна детализация/);
  assert.match(traceJs, /AI_OPERATOR_LAB_GET/);
});

test('AI Lab highlights semantic-to-tool mismatches and important raw JSON fields', () => {
  assert.match(traceJs, /pon\\\.signal/);
  assert.match(traceJs, /billing\\\.tariff/);
  assert.match(traceJs, /План не совпал с проверкой/);
  assert.match(traceJs, /План: \$\{mismatch\.expected\} → фактически: \$\{mismatch\.actual\}/);

  for (const key of ['field', 'why', 'tool', 'ok', 'code', 'source', 'data', 'requestedBy']) {
    assert.match(traceJs, new RegExp(`['\"]${key}['\"]`), `raw JSON must specially handle ${key}`);
  }
  assert.match(traceJs, /discountText/, 'discount evidence must be surfaced in the compact fact trace');
  for (const className of ['key-intent', 'key-tool', 'key-status', 'key-source', 'key-data']) {
    assert.match(traceJs, new RegExp(className));
  }
});
