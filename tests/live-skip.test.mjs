import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const skip = readFileSync(new URL("../extension/live-skip.js", import.meta.url), "utf8");
const skipCss = readFileSync(new URL("../extension/live-skip.css", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../extension/live-panel.html", import.meta.url), "utf8");

test("focus card can skip the current mentor task", () => {
  assert.match(skip, /wb_live_skipped_tasks_v1/);
  assert.match(skip, /data-skip-task/);
  assert.match(skip, />Пропустить<\/button>/);
  assert.match(skip, /currentTask = function currentTaskWithSkip/);
  assert.match(skip, /candidates\.find\(task => !isSkipped\(task\)\)/);
});

test("skipping does not mark a checkpoint complete", () => {
  assert.match(skip, /step\.complete && isSkipped|!step\.complete && isSkipped/);
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

test("session and line skips are grouped to avoid loops", () => {
  assert.match(skip, /task\.id === "missing-olt" \|\| task\.id === "poll-onu"/);
  assert.match(skip, /return "line"/);
  assert.match(skip, /task\.id === "check-session"/);
  assert.match(skip, /return "session"/);
});

test("panel loads skip behavior after the base live panel", () => {
  const panelIndex = panelHtml.indexOf('<script src="live-panel.js"></script>');
  const skipIndex = panelHtml.indexOf('<script src="live-skip.js"></script>');
  assert.ok(panelIndex >= 0);
  assert.ok(skipIndex > panelIndex);
  assert.match(panelHtml, /live-skip\.css/);
});

test("paused summary stops focus card pulsing", () => {
  assert.match(skip, /classList\.toggle\("is-paused"/);
  assert.match(skipCss, /\.focus-card\.is-paused\{animation:none!important/);
  assert.match(skipCss, /\.step\.skipped/);
  assert.match(skipCss, /\.skipped-stack/);
});
