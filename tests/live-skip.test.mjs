import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const skip = readFileSync(new URL("../extension/live-skip.js", import.meta.url), "utf8");
const skipCss = readFileSync(new URL("../extension/live-skip.css", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../extension/live-panel.html", import.meta.url), "utf8");

test("focus card can skip the current canonical mentor task", () => {
  assert.match(skip, /wb_live_skipped_tasks_v1/);
  assert.match(skip, /__SIMNET_LIVE_MENTOR_MODEL__/);
  assert.match(skip, /data-skip-task/);
  assert.match(skip, />Пропустить<\/button>/);
  assert.match(skip, /currentTask = function currentTaskWithSkip/);
  assert.match(skip, /candidates\.find\(task => !isSkipped\(task\)\)/);
});

test("skipping does not mark a checkpoint complete", () => {
  assert.match(skip, /const skipped = isSkipped\(step\.id\) && \(step\.attention \|\| !step\.complete\)/);
  assert.match(skip, /progress\.textContent = `\$\{steps\.filter\(step => step\.complete\)\.length\} \/ \$\{steps\.length\}`/);
  assert.doesNotMatch(skip, /complete:\s*true.*skip/s);
});

test("skipped checks remain restorable", () => {
  assert.match(skip, /data-restore-skip/);
  assert.match(skip, /data-restore-all-skips/);
  assert.match(skip, /Вернуть пропущенные/);
  assert.match(skip, /async function restoreSkipped/);
  assert.match(skip, /async function restoreAllSkipped/);
});

test("skip identity uses the same subscriber session and line step ids", () => {
  assert.match(skip, /return task\?\.stepId \|\| task\?\.id/);
  assert.match(skip, /data-step-id/);
  assert.match(skip, /data-issue-id/);
});

test("panel loads canonical model before skip and route decorators", () => {
  const panelIndex = panelHtml.indexOf('<script src="live-panel.js"></script>');
  const modelIndex = panelHtml.indexOf('<script src="live-mentor-model.js"></script>');
  const skipIndex = panelHtml.indexOf('<script src="live-skip.js"></script>');
  const routeIndex = panelHtml.indexOf('<script src="live-onu-route.js"></script>');
  assert.ok(panelIndex >= 0);
  assert.ok(modelIndex > panelIndex);
  assert.ok(skipIndex > modelIndex);
  assert.ok(routeIndex > skipIndex);
  assert.match(panelHtml, /live-skip\.css/);
});

test("paused summary stops focus card pulsing", () => {
  assert.match(skip, /classList\.toggle\("is-paused"/);
  assert.match(skipCss, /\.focus-card\.is-paused\{animation:none!important/);
  assert.match(skipCss, /\.step\.skipped/);
  assert.match(skipCss, /\.skipped-stack/);
});
