import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/ui/settings-accordion.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/ui/settings.css', import.meta.url), 'utf8');
const lab = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
const labCss = fs.readFileSync(new URL('../src/ui/ai-operator-lab.css', import.meta.url), 'utf8');

assert.match(html, /data-accordion-group="settings"/, 'settings must use a top-level accordion group');
assert.match(html, /data-accordion-panel="lab"[^>]*data-accordion-default="true"[^>]*open/, 'AI lab must be the default open settings panel');
assert.match(html, /data-accordion-group="lab"/, 'lab must have its own nested accordion');
assert.match(html, /data-accordion-panel="replay"[^>]*data-accordion-default="true"[^>]*open/, 'Replay must be the default open lab section');
assert.match(html, /src="settings-accordion\.js"/, 'settings workspace behavior must be loaded');
assert.match(html, /id="aiReplayExport"[^>]*>JSON</, 'full Replay JSON export must remain available');
assert.match(html, /id="aiReplayExportCsv"[^>]*>Таблица CSV</, 'Replay must expose a review-table export');
assert.match(html, /1 · Запуск/, 'Replay workspace must separate run controls');
assert.match(html, /2 · Текущий кейс/, 'Replay workspace must separate the current case');
assert.match(html, /3 · Разметка/, 'Replay workspace must separate manual review controls');

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
for (const label of ['Решительность', 'Любопытство', 'Инициативность', 'Скепсис к фактам', 'Краткость']) {
  assert.match(lab, new RegExp(label), `Manual Lab must expose ${label} behavior control`);
}
assert.match(lab, /AI_OPERATOR_LAB_REPEAT/, 'Manual Lab must be able to repeat the same pre-turn state');
assert.match(lab, /AI_OPERATOR_LAB_SNAPSHOT/, 'Manual Lab must save experiment snapshots');
assert.match(lab, /Экспорт слепков/, 'Manual Lab must export experiment snapshots');
assert.match(lab, /BILLING: OFF/, 'Manual Lab must make unavailable live Billing explicit');
assert.match(lab, /USERSIDE: OFF/, 'Manual Lab must make unavailable UserSide explicit');
assert.match(lab, /NETWORK: OFF/, 'Manual Lab must make unavailable network tools explicit');
assert.match(lab, /Нужны live-данные/, 'Manual Lab diagnostics must separate subscriber data needs from KB gaps');
assert.match(lab, /Пересчитать последний ход/, 'Manual Lab must expose live retuning workflow');
assert.match(labCss, /\.ai-lab-sliders/, 'behavior controls must have dedicated layout');
assert.match(labCss, /\.ai-lab-comparison-grid/, 'A/B answers must have dedicated comparison layout');
assert.match(labCss, /\.ai-lab-diagnostic-row/, 'live diagnostics must have dedicated visual rows');

console.log('ai_operator_settings_workspace_test: PASS');