import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const settingsJs = fs.readFileSync(new URL('../src/ui/settings.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/ui/settings-accordion.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/ui/settings.css', import.meta.url), 'utf8');
const lightCss = fs.readFileSync(new URL('../src/ui/settings-light.css', import.meta.url), 'utf8');
const focusCss = fs.readFileSync(new URL('../src/ui/settings-focus.css', import.meta.url), 'utf8');
const lab = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
const labCss = fs.readFileSync(new URL('../src/ui/ai-operator-lab.css', import.meta.url), 'utf8');

assert.match(html, /data-accordion-group="settings"/, 'settings must use a top-level accordion group');
assert.match(html, /data-accordion-panel="lab"[^>]*data-accordion-default="true"[^>]*open/, 'AI lab must be the default open settings panel');
assert.match(html, /data-accordion-group="lab"/, 'lab must have its own nested accordion');
assert.match(html, /data-accordion-panel="manual"[^>]*data-accordion-default="true"[^>]*open/, 'Manual AI Lab must be the default open lab section');
assert.doesNotMatch(html, /data-accordion-panel="replay"[^>]*data-accordion-default="true"/, 'Replay should not steal initial focus from the live manual trace');
assert.match(html, /src="settings-accordion\.js"/, 'settings workspace behavior must be loaded');
assert.match(html, /src="ai-operator-lab-trace\.js"/, 'linear AI decision trace must be loaded explicitly');
assert.match(html, /href="settings-focus\.css"/, 'focused settings overrides must be loaded explicitly');
assert.match(html, /id="aiReplayExport"[^>]*>JSON</, 'full Replay JSON export must remain available');
assert.match(html, /id="aiReplayExportCsv"[^>]*>Таблица CSV</, 'Replay must expose a review-table export');
assert.match(html, /1 · Запуск/, 'Replay workspace must separate run controls');
assert.match(html, /2 · Текущий кейс/, 'Replay workspace must separate the current case');
assert.match(html, /3 · Разметка/, 'Replay workspace must separate manual review controls');

// Deliberately pruned UI: these were stale/duplicating settings surfaces.
assert.doesNotMatch(html, /data-accordion-panel="operator"/, 'autonomous-operator settings panel must stay out of the focused workspace');
assert.doesNotMatch(html, /data-accordion-panel="call-analysis"/, 'call-analysis settings panel must stay out of the focused workspace');
assert.doesNotMatch(html, /data-accordion-panel="profiles"/, 'analysis profiles panel must stay out of the focused workspace');
assert.doesNotMatch(html, /data-accordion-panel="decisions"/, 'legacy last-decisions/corrections panel must stay out of the Lab workspace');
assert.doesNotMatch(html, /id="aiOperatorEnabled"/, 'removed autonomous-operator controls must not remain hidden in markup');
assert.doesNotMatch(html, /id="modelAvailability"/, 'removed call-analysis availability block must not remain hidden in markup');

// Model selection remains intentionally available as a compact diagnostic/A-B control.
assert.match(html, /data-accordion-panel="chat-model"/);
assert.match(html, /settings-panel-compact-model/);
assert.match(html, /<h2>Модель AI<\/h2>/);
assert.match(html, /Для A\/B и диагностики различий Qwen \/ GPT-OSS/);
assert.match(settingsJs, /saveChatModelButton/);
assert.match(settingsJs, /chatModel:/);
assert.doesNotMatch(settingsJs, /querySelector\(`\[data-accordion-group="settings"\]/, 'settings JS must not hide removed panels after page load');
assert.match(focusCss, /\.settings-panel-compact-model/);
assert.match(focusCss, /grid-template-columns:auto minmax\(220px,420px\) auto/);

assert.match(workspace, /simnet_settings_accordion_v1/, 'open accordion state must persist');
assert.match(workspace, /sibling !== panel && sibling\.open/, 'opening one section must close peers in the same accordion');
assert.match(workspace, /AI_OPERATOR_REPLAY_RESULTS/, 'review export must use persisted Replay results');
assert.match(workspace, /simnet-ai-replay-review-/, 'review export must have a distinct filename');
assert.match(workspace, /'Моя оценка'/, 'review CSV must contain an editable human evaluation column');
assert.match(workspace, /'Тип ошибки'/, 'review CSV must contain an error-type column');
assert.match(workspace, /'Что исправить'/, 'review CSV must contain a correction column');
assert.match(workspace, /'Добавить в энциклопедию'/, 'review CSV must contain a knowledge-gap curation column');
assert.match(workspace, /knowledgeGaps/, 'review CSV must expose knowledge gaps detected by AI');
assert.match(workspace, /mustNotAssume/, 'review CSV must expose unsupported assumptions');
assert.match(workspace, /hypotheses/, 'review CSV must expose AI hypotheses for review');
assert.match(css, /\.settings-panel-summary/, 'accordion must have dedicated visual styling');
assert.match(css, /\.replay-workspace-block/, 'Replay run/current/review areas must have dedicated visual grouping');

assert.match(lab, /Без энциклопедии/, 'Manual Lab must expose KB OFF');
assert.match(lab, /A\/B сравнение/, 'Manual Lab must expose A/B comparison');
assert.match(lab, /Только ответ/, 'Manual Lab must expose answer-only view');
assert.match(lab, /Ответ \+ разбор/, 'Manual Lab must expose answer plus diagnostics view');
assert.match(lab, /Только разбор/, 'Manual Lab must expose analysis-only view');
for (const label of ['Naturalness', 'Depth', 'Initiative']) {
  assert.match(lab, new RegExp(label), `Manual Lab must expose ${label} behavior control`);
}
for (const removed of ['Решительность', 'Любопытство', 'Скепсис к фактам', 'Краткость', 'Макс. уточнений']) {
  assert.doesNotMatch(lab, new RegExp(removed), `removed behavior control ${removed} must not reappear`);
}
assert.match(lab, /range\.min = '1'/, 'behavior controls must start at level 1');
assert.match(lab, /range\.max = '5'/, 'behavior controls must stop at level 5');
assert.match(lab, /AI_OPERATOR_LAB_REPEAT/, 'Manual Lab must be able to repeat the same pre-turn state');
assert.match(lab, /AI_OPERATOR_LAB_SNAPSHOT/, 'Manual Lab must save experiment snapshots');
assert.match(lab, /Экспорт слепков/, 'Manual Lab must export experiment snapshots');
assert.match(lab, /BILLING: \$\{caps\.billing \? 'ON' : 'OFF'\}/, 'Manual Lab must render Billing capability from runtime state');
assert.match(lab, /USERSIDE: \$\{caps\.userside \? 'ON' : 'OFF'\}/, 'Manual Lab must render UserSide capability from runtime state');
assert.match(lab, /NETWORK: \$\{caps\.network \? 'ON' : 'OFF'\}/, 'Manual Lab must render network capability from runtime state');
assert.match(lab, /READ-tools/, 'Manual Lab diagnostics must expose executed read tools');
assert.match(lab, /Подтверждено tools/, 'Manual Lab diagnostics must expose verified tool evidence');
assert.match(lab, /Нужны live-данные/, 'Manual Lab diagnostics must separate subscriber data needs from KB gaps');
assert.match(lab, /Пересчитать последний ход/, 'Manual Lab must expose live retuning workflow');
assert.match(lab, /UserSide-контекст не выдаётся за свежий глобальный поиск/, 'Manual Lab must disclose UserSide freshness limitations');
assert.match(labCss, /\.ai-lab-sliders/, 'behavior controls must have dedicated layout');
assert.match(lightCss, /\.ai-lab-sliders\{display:grid!important/, 'behavior tuning scale must remain visible in the light Lab UI');
assert.match(lightCss, /\.ai-lab-experiment-head>div:first-child\{display:flex/, 'behavior tuning scale must keep its explanatory heading visible');
assert.match(labCss, /\.ai-lab-comparison-grid/, 'A/B answers must have dedicated comparison layout');
assert.match(labCss, /\.ai-lab-diagnostic-row/, 'live diagnostics must have dedicated visual rows');

console.log('ai_operator_settings_workspace_test: PASS');
