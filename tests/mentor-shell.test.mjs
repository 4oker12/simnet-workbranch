import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extension/src/mentor-shell.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("mentor shell keeps a right-pinned 48px rail and 280px anchor", () => {
  assert.match(source, /const RAIL_WIDTH = 48/);
  assert.match(source, /const ANCHOR_WIDTH = 280/);
  assert.match(source, /grid-template-columns:\$\{ANCHOR_WIDTH\}px \$\{RAIL_WIDTH\}px/);
  assert.match(source, /\.rail\{grid-column:2/);
  assert.match(source, /position:fixed/);
  assert.match(source, /right:0/);
});

test("quick diagnostics opens only to the left", () => {
  assert.match(source, /right:\$\{EXPANDED_WIDTH\}px/);
  assert.match(source, /transform:translateX\(18px\)/);
  assert.doesNotMatch(source, /left:100%/);
});

test("legacy Workbench stays hidden and only provides runtime", () => {
  assert.match(source, /class="legacy-runtime"/);
  assert.match(source, /left:-100000px/);
  assert.match(source, /clip-path:inset\(100%\)/);
  assert.doesNotMatch(source, /flyout-body"><slot name="workbench"/);
});

test("visible scope contains only mentor and quick diagnostics", () => {
  assert.match(source, /Помощник-наставник/);
  assert.match(source, /Быстрая диагностика/);
  assert.doesNotMatch(source, /data-action="history"/);
  assert.doesNotMatch(source, /data-action="more"/);
  assert.doesNotMatch(source, /История абонента/);
  assert.doesNotMatch(source, /500\s*м/);
});

test("quick diagnostics delegates execution to legacy core", () => {
  assert.match(source, /data-action="run-diagnostic"/);
  assert.match(source, /clickLegacy\("#dp-run"\)/);
  assert.match(source, /clickLegacy\("#dp-stop"\)/);
  assert.match(source, /function collectFacts\(\)/);
  assert.match(source, /function summaryFromFacts\(/);
  assert.match(source, /function stageFromStatus\(/);
});

test("shell reads page context and syncs the hidden input", () => {
  assert.match(source, /function pageContext\(\)/);
  assert.match(source, /function currentContext\(\)/);
  assert.match(source, /function syncLegacyInput\(/);
  assert.match(source, /data-copy="contract"/);
  assert.match(source, /data-copy="ip"/);
  assert.match(source, /data-copy="mac"/);
});

test("shell adds no transport duplication", () => {
  assert.match(source, /attachShadow\(\{ mode: "open" \}\)/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
});

test("manifest loads mentor shell after Workbench and mentor logic", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  assert.ok(isolated);
  const shellIndex = isolated.js.indexOf("src/mentor-shell.js");
  assert.ok(shellIndex > isolated.js.indexOf("src/workbench.js"));
  assert.ok(shellIndex > isolated.js.indexOf("src/training-mentor.js"));
});
