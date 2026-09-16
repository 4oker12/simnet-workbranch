import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/ui/settings-accordion.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/ui/settings.css', import.meta.url), 'utf8');

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

console.log('ai_operator_settings_workspace_test: PASS');