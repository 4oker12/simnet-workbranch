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
assert.match(html, /Провайдер можно менять для A\/B/, 'model/provider A/B control should remain available');
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

// Manual Lab MVP: keep the real runtime and diagnostics, but remove low-signal tuning/telemetry UI.
assert.doesNotMatch(html, /src="ai-operator-token-meter\.js"/, 'per-request token meter must stay out of the normal Lab UI');
assert.doesNotMatch(html, /src="ai-operator-behavior-v2\.js"/, 'behavior sliders must stay out of the normal Lab UI');
assert.doesNotMatch(html, /src="ai-operator-kb-curator\.js"/, 'KB curation form must stay out of the normal Lab UI');
assert.doesNotMatch(workspace, /ai-quota-dashboard\.js/, 'quota dashboard must not be injected into the normal Lab UI');
assert.match(html, /class="ai-lab-compose-actions"/, 'chat actions must live next to the message composer');
assert.ok(
  html.indexOf('id="aiLabReset"') > html.indexOf('id="aiLabInput"'),
  'new-dialog/reset must be placed by the chat composer rather than in the page header'
);
assert.match(html, />Как AI пришёл к ответу</, 'decision trace must be described in operator language');
assert.match(lightCss, /--ai-accent:#2563eb/, 'normal Lab accent must use calm blue instead of burgundy');
assert.doesNotMatch(lightCss, /#94003f/i, 'legacy burgundy accent must not remain in the light Lab theme');
assert.match(lightCss, /\.ai-lab-sliders,[\s\S]*?display:none!important/, 'behavior tuning must be hidden in the MVP UI');

// Runtime support is deliberately retained behind the simplified UI.
assert.match(lab, /AI_OPERATOR_LAB_REPEAT/, 'same-turn replay runtime must remain available');
assert.match(lab, /AI_OPERATOR_LAB_SNAPSHOT/, 'experiment snapshot runtime must remain available');
assert.match(lab, /BILLING: \$\{caps\.billing \? 'ON' : 'OFF'\}/, 'Manual Lab must keep Billing capability evidence');
assert.match(lab, /USERSIDE: \$\{caps\.userside \? 'ON' : 'OFF'\}/, 'Manual Lab must keep UserSide capability evidence');
assert.match(lab, /NETWORK: \$\{caps\.network \? 'ON' : 'OFF'\}/, 'Manual Lab must keep network capability evidence');
assert.match(lab, /READ-tools/, 'Manual Lab runtime diagnostics must retain executed read tools');
assert.match(labCss, /\.ai-lab-comparison-grid/, 'A/B runtime layout may remain available for diagnostics');
assert.match(labCss, /\.ai-lab-diagnostic-row/, 'diagnostic row styles must remain available');

console.log('ai_operator_settings_workspace_test: PASS');
