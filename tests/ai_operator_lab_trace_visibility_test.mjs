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
    "step(index++, 'ПОНЯЛ'",
    "step(index++, 'КОНТЕКСТ'",
    "step(index++, 'НУЖНО УЗНАТЬ'",
    "step(index++, 'ПЛАН'",
    "step(index++, 'TOOL'",
    "step(index++, 'ФАКТЫ'",
    "step(index++, 'ПРОВЕРКА'",
    "step(index++, 'ВЫВОД'",
    "step(index++, 'ОТВЕТ'"
  ];
  let previous = -1;
  for (const stage of stages) {
    const index = traceJs.indexOf(stage);
    assert.ok(index > previous, `${stage} must appear after the previous pipeline stage`);
    previous = index;
  }

  assert.match(traceJs, /DECISION TRACE · ПОСЛЕДНИЙ ХОД/);
  assert.match(traceJs, /Сырой журнал событий ниже/);
  assert.match(traceJs, /AI_OPERATOR_LAB_GET/);
});

test('AI Lab highlights semantic-to-tool mismatches and important raw JSON fields', () => {
  assert.match(traceJs, /pon\\\.signal/);
  assert.match(traceJs, /billing\\\.tariff/);
  assert.match(traceJs, /НЕСООТВЕТСТВИЕ: запросил/);
  assert.match(traceJs, /ОЖИДАЛСЯ \$\{mismatch\.expected\} → ФАКТИЧЕСКИ \$\{mismatch\.actual\}/);

  for (const key of ['field', 'why', 'tool', 'ok', 'code', 'source', 'data', 'requestedBy']) {
    assert.match(traceJs, new RegExp(`['\"]${key}['\"]`), `raw JSON must specially handle ${key}`);
  }
  for (const className of ['key-intent', 'key-tool', 'key-status', 'key-source', 'key-data']) {
    assert.match(traceJs, new RegExp(className));
  }
});


test('AI Lab exposes a DevTools-style hover inspector for tool references and subscriber snapshot', () => {
  assert.match(traceJs, /TOOL_INSPECTOR_META/);
  assert.match(traceJs, /customer\.lookup/);
  assert.match(traceJs, /НАЙТИ \/ ПРОВЕРИТЬ \(LOOKUP \/ VERIFY\)/);
  assert.match(traceJs, /Что делает/);
  assert.match(traceJs, /SIMNET_AI_OPERATOR|simnet_ai_operator_billing_snapshots_v1/i);
  assert.match(traceJs, /chrome\.storage\.local\.get\(BILLING_SNAPSHOT_KEY\)/);
  assert.match(traceJs, /confirmedSubscriber/);
  assert.match(traceJs, /Subscriber Snapshot/);
  assert.match(traceJs, /bootstrapMeta/);
  assert.match(traceJs, /Полный снимок \(snapshot\)/);
  assert.match(traceJs, /mouseenter/);
  assert.match(traceJs, /inspectorPinned/);
  assert.match(traceJs, /event\.key === 'Escape'/);
});

test('tool references inside RAW JSON and trace chips are decorated as inspector targets', () => {
  assert.match(traceJs, /TOOL_REF_RE/);
  assert.match(traceJs, /appendDecoratedToolText\(span, line\)/);
  assert.match(traceJs, /toolRef\(toolName, toolName\)/);
  assert.match(traceJs, /toolRef\(sourceTool, item\.source\)/);
  assert.match(traceJs, /tool:.*customer\\\.lookup|customer\\\.lookup/);
});


test('AI Lab renders a Swagger-style runtime map with full subscriber snapshot, tool calls and model projection', () => {
  assert.match(traceJs, /КАРТА РАБОТЫ АГЕНТА \(AGENT RUNTIME MAP\)/);
  assert.match(traceJs, /СНИМОК АБОНЕНТА \(SUBSCRIBER SNAPSHOT\)|Снимок абонента \(Subscriber Snapshot\)/);
  assert.match(traceJs, /ВЫЗОВЫ ИНСТРУМЕНТОВ \(TOOL CALLS\)/);
  assert.match(traceJs, /MODEL \/ CANONICAL VIEW/);
  assert.match(traceJs, /ПОЛНЫЙ СНИМОК \(FULL SNAPSHOT\) · JSON/);
  assert.match(traceJs, /runtimeSnapshotStage/);
  assert.match(traceJs, /runtimeToolCallCard/);
  assert.match(traceJs, /INPUT \/ ARGS/);
  assert.match(traceJs, /OUTPUT \/ RESULT/);
  assert.match(traceJs, /endpoint/);
  assert.match(traceJs, /selector/);
  assert.match(traceJs, /TRACE PROJECTION/);
  assert.match(traceJs, /Это не полный скрытый prompt модели, а только видимая проекция данных/);
  assert.match(traceJs, /Технический RAW JSON/);
});

test('Lab runtime visualization uses blue/slate accents while red remains reserved for errors', () => {
  assert.match(traceJs, /ai-runtime-snapshot[^\n]*border-top:3px solid #2563eb/);
  assert.match(traceJs, /ai-runtime-tools-stage[^\n]*border-top:3px solid #0891b2/);
  assert.match(traceJs, /ai-runtime-model-stage[^\n]*border-top:3px solid #64748b/);
  assert.match(css, /--ai-accent:#2563eb/);
  assert.match(css, /--ai-plum:#2563eb/);
});


test('tool inspector exposes Swagger-style contract and failure diagnostics', () => {
  assert.match(traceJs, /Что читает/);
  assert.match(traceJs, /Что возвращает/);
  assert.match(traceJs, /Billing listuser → a=user → bootstrap: main \+ address \+ technical/);
  assert.match(traceJs, /этап ошибки/);
  assert.match(traceJs, /детали ошибки/);
});


test('runtime map shows how subscriber identity was resolved', () => {
  assert.match(traceJs, /стратегия поиска/);
  assert.match(traceJs, /вычисленный Billing ID/);
  assert.match(traceJs, /штатный запрос/);
  assert.match(traceJs, /транспорт/);
});


test('runtime UI is Russian-first and keeps technical English only as a secondary reference', () => {
  assert.match(traceJs, /НАЙТИ \/ ПРОВЕРИТЬ \(LOOKUP \/ VERIFY\)/);
  assert.match(traceJs, /ЧИТАТЬ \(READ \/ GET-like\)/);
  assert.match(traceJs, /СОХРАНИТЬ КОНТЕКСТ \(STORE \/ STATE\)/);
  assert.match(traceJs, /Класс действия/);
  assert.match(traceJs, /Технический класс/);
  assert.match(traceJs, /HTTP-аналог/);
  assert.match(traceJs, /Контракт инструмента \(tool contract\)/);
  assert.match(traceJs, /Последний вызов \(last call\)/);
  assert.match(traceJs, /Входные аргументы \(input args\)/);
  assert.match(traceJs, /Последний результат \(last result\)/);
  assert.doesNotMatch(traceJs, /Снимок абонента \(Снимок абонента/);
});
