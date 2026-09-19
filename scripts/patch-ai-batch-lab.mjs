import fs from 'node:fs';

function replaceExact(source, before, after, expected, label) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} occurrence(s), found ${count}`);
  return source.split(before).join(after);
}

function patch(path, transform) {
  const original = fs.readFileSync(path, 'utf8');
  const next = transform(original);
  if (next === original) throw new Error(`${path}: patch produced no changes`);
  fs.writeFileSync(path, next);
}

patch('src/features/ai-operator/lab-background.js', source => {
  let next = source;
  next = replaceExact(
    next,
    "import { mergeBehaviorProfile, normalizeBehaviorProfile, toLegacyBehaviorCompatibility } from './behavior-profile.js';",
    "import { mergeBehaviorProfile, normalizeBehaviorProfile } from './behavior-profile.js';",
    1,
    'remove legacy behavior import'
  );
  next = replaceExact(
    next,
    "\nfunction runtimeBehavior(value = {}) {\n  return toLegacyBehaviorCompatibility(value);\n}\n",
    '\n',
    1,
    'remove legacy behavior adapter'
  );
  next = replaceExact(
    next,
    'behavior: runtimeBehavior(lab.behavior),',
    'behavior: lab.behavior,',
    2,
    'pass native behavior to runtime'
  );

  const isolated = `export async function runIsolatedLabCase({\n  text,\n  transcript = [],\n  knowledgeMode = 'auto',\n  behavior = {},\n  toolState = {},\n  scope = ''\n} = {}) {\n  const incoming = compact(text, 4000);\n  if (!incoming) throw new Error('Пустая реплика пакетного теста.');\n\n  const lab = emptyLab();\n  lab.id = compact(scope, 180) || id('batch_lab');\n  lab.knowledgeMode = normalizeKnowledgeMode(knowledgeMode);\n  lab.displayMode = 'answer_analysis';\n  lab.behavior = normalizeBehavior(behavior);\n  lab.toolState = normalizeToolState(toolState);\n\n  const baseMessages = (Array.isArray(transcript) ? transcript : [])\n    .map(normalizeMessage)\n    .slice(-MAX_MESSAGES);\n  const customer = normalizeMessage({ id: id('msg'), role: 'customer', text: incoming, at: nowIso() });\n\n  await executeExperiment(lab, baseMessages, customer);\n  return {\n    experiment: clone(lab.lastExperiment),\n    decision: clone(lab.lastDecision),\n    toolState: clone(lab.toolState),\n    events: clone(lab.events)\n  };\n}\n\n`;
  next = replaceExact(next, 'function recoveryAnalysis(customer = {}) {', `${isolated}function recoveryAnalysis(customer = {}) {`, 1, 'insert isolated Lab runner');
  return next;
});

patch('src/background-entry.js', source => replaceExact(
  source,
  "import './features/ai-operator/lab-background.js';\nimport './features/ai-operator/replay-background.js';",
  "import './features/ai-operator/lab-background.js';\nimport './features/ai-operator/lab-batch-background.js';\nimport './features/ai-operator/replay-background.js';",
  1,
  'wire batch background'
));

patch('src/ui/settings.html', source => {
  let next = source;
  next = replaceExact(
    next,
    '  <link rel="stylesheet" href="ai-operator-lab.css">\n  <link rel="stylesheet" href="settings-light.css">',
    '  <link rel="stylesheet" href="ai-operator-lab.css">\n  <link rel="stylesheet" href="ai-operator-batch.css">\n  <link rel="stylesheet" href="settings-light.css">',
    1,
    'load batch CSS'
  );

  const section = `        <details class="lab-section" data-accordion-group="lab" data-accordion-panel="batch">\n          <summary class="lab-section-summary">\n            <div>\n              <strong>Пакетный тест формулировок</strong>\n              <span>1 смысл → 10–20 фраз → один и тот же AI pipeline</span>\n            </div>\n            <span class="settings-chevron" aria-hidden="true"></span>\n          </summary>\n          <div class="lab-section-body">\n            <div class="section-head lab-section-head-flat">\n              <div>\n                <h3>Устойчивость к формулировкам</h3>\n                <p class="muted">DeepSeek или текущая выбранная модель создаёт равнозначные варианты реплики. Каждый вариант затем запускается отдельно через тот же UNDERSTANDING → KB → READ → ответ, из одинакового стартового состояния.</p>\n              </div>\n            </div>\n\n            <div class="ai-batch-grid">\n              <div>\n                <label class="field-label" for="aiBatchSeed">Исходная реплика</label>\n                <textarea id="aiBatchSeed" rows="2" placeholder="Например: Какая у меня скорость по тарифу?"></textarea>\n              </div>\n              <div>\n                <label class="field-label" for="aiBatchCount">Вариантов</label>\n                <input id="aiBatchCount" type="number" min="2" max="20" step="1" value="10">\n              </div>\n            </div>\n            <div class="ai-batch-actions">\n              <button id="aiBatchGenerate" type="button">Сгенерировать формулировки</button>\n              <button id="aiBatchRun" type="button">Запустить пакет</button>\n              <button id="aiBatchExport" class="secondary" type="button" disabled>Экспорт JSON</button>\n              <button id="aiBatchClear" class="secondary" type="button">Очистить результат</button>\n            </div>\n            <label class="field-label" for="aiBatchVariants">Формулировки · одна строка = один независимый прогон</label>\n            <textarea id="aiBatchVariants" class="ai-batch-variants" rows="10" placeholder="Можно сгенерировать автоматически или вставить свой список до 20 строк."></textarea>\n            <p class="note ai-batch-help">Нормальный Lab-диалог не изменяется. READ-инструменты остаются read-only; HelpCrunch SEND не используется.</p>\n            <div id="aiBatchStatus" class="status ai-batch-status">Готово к пакетному тесту.</div>\n            <div id="aiBatchSummary" class="ai-batch-summary">Результатов пока нет.</div>\n            <div id="aiBatchResults" class="ai-batch-results"><div class="ai-batch-empty">Сгенерируй или вставь формулировки и запусти пакетный тест.</div></div>\n          </div>\n        </details>\n\n`;
  next = replaceExact(
    next,
    '        <details class="lab-section" data-accordion-group="lab" data-accordion-panel="replay">',
    `${section}        <details class="lab-section" data-accordion-group="lab" data-accordion-panel="replay">`,
    1,
    'insert batch Lab section'
  );
  next = replaceExact(
    next,
    '  <script src="ai-operator-kb-curator.js"></script>\n  <script type="module" src="ai-operator-replay.js"></script>',
    '  <script src="ai-operator-kb-curator.js"></script>\n  <script src="ai-operator-batch.js"></script>\n  <script type="module" src="ai-operator-replay.js"></script>',
    1,
    'load batch UI'
  );
  return next;
});

console.log('AI Lab batch wiring patch applied exactly.');
