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

test("all visible modules open only to the left of the right rail", () => {
  assert.match(source, /right:\$\{EXPANDED_WIDTH\}px/);
  assert.match(source, /transform:translateX\(18px\)/);
  assert.doesNotMatch(source, /left:100%/);
});

test("legacy Workbench stays hidden and is not rendered in the flyout", () => {
  assert.match(source, /class="legacy-runtime"/);
  assert.match(source, /left:-100000px/);
  assert.match(source, /clip-path:inset\(100%\)/);
  assert.doesNotMatch(source, /flyout-body"><slot name="workbench"/);
});

test("quick diagnostics uses a new compact view and delegates execution to legacy core", () => {
  assert.match(source, /function quickMarkup\(\)/);
  assert.match(source, /data-action="run-diagnostic"/);
  assert.match(source, /clickLegacy\("#dp-run"\)/);
  assert.match(source, /Старая белая панель больше не показывается/);
});

test("mentor is the primary surface", () => {
  assert.match(source, /Помощник-наставник/);
  assert.match(source, /Что важно сейчас/);
  assert.match(source, /Следующая проверка/);
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
