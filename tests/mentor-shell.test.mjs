import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extension/src/mentor-shell.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("mentor shell keeps a 48px rail and 280px anchor", () => {
  assert.match(source, /const RAIL_WIDTH = 48/);
  assert.match(source, /const ANCHOR_WIDTH = 280/);
  assert.match(source, /height:100vh/);
  assert.match(source, /position:fixed/);
  assert.match(source, /right:0/);
});

test("mentor is the primary surface and diagnostics open in a left flyout", () => {
  assert.match(source, /Помощник-наставник/);
  assert.match(source, /Что важно сейчас/);
  assert.match(source, /Следующая проверка/);
  assert.match(source, /right:100%/);
  assert.match(source, /Быстрая диагностика/);
});

test("existing Workbench is reused through a slot without transport duplication", () => {
  assert.match(source, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(source, /<slot name="workbench"><\/slot>/);
  assert.match(source, /panel\.slot = "workbench"/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
});

test("stage one does not add automatic diagnostic start", () => {
  assert.doesNotMatch(source, /#dp-run/);
  assert.doesNotMatch(source, /\.click\(\).*run/i);
  assert.doesNotMatch(source, /auto-context/i);
});

test("manifest loads mentor shell after Workbench and mentor logic", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  assert.ok(isolated);
  const shellIndex = isolated.js.indexOf("src/mentor-shell.js");
  assert.ok(shellIndex > isolated.js.indexOf("src/workbench.js"));
  assert.ok(shellIndex > isolated.js.indexOf("src/training-mentor.js"));
});
