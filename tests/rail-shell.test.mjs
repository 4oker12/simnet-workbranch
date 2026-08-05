import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const railSource = readFileSync(new URL("../extension/src/rail-shell.js", import.meta.url), "utf8");
const contextSource = readFileSync(new URL("../extension/src/auto-context.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("compact anchor is fixed at the right edge", () => {
  assert.match(railSource, /const MAIN_WIDTH = 280;/);
  assert.match(railSource, /const COLLAPSED_WIDTH = 48;/);
  assert.match(railSource, /position:fixed;/);
  assert.match(railSource, /right:0;/);
  assert.match(railSource, /height:100vh;/);
  assert.match(railSource, /padding-right.*MAIN_WIDTH|applyPageReserve/);
});

test("heavy modules use a flyout to the left of the anchor", () => {
  assert.match(railSource, /const FLYOUT_WIDTH = 540;/);
  assert.match(railSource, /class="flyout"/);
  assert.match(railSource, /right:\$\{MAIN_WIDTH\}px;/);
  assert.match(railSource, /data-action="close-flyout"/);
  assert.match(railSource, /data-action="details"/);
  assert.match(railSource, /data-action="mentor"/);
  assert.match(railSource, /data-action="history"/);
});

test("anchor uses skeletons, chips and icon-only actions", () => {
  assert.match(railSource, /skeleton-line/);
  assert.match(railSource, /skeleton-inline/);
  assert.match(railSource, /data-chip="contract"/);
  assert.match(railSource, /data-chip="ip"/);
  assert.match(railSource, /data-chip="mac"/);
  assert.match(railSource, /data-copy-key/);
  assert.match(railSource, /data-action="stop"/);
  assert.match(railSource, /class="quick-actions"/);
});

test("rail keeps only diagnostic, mentor and history navigation", () => {
  assert.doesNotMatch(railSource, /data-action="results"/);
  assert.doesNotMatch(railSource, /data-action="journal"/);
  assert.match(railSource, /Подробная диагностика/);
  assert.match(railSource, /Диагност-наставник/);
  assert.match(railSource, /История абонента/);
});

test("legacy panel remains slotted and transport-free", () => {
  assert.match(railSource, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(railSource, /<slot name="workbench"><\/slot>/);
  assert.match(railSource, /panel\.slot = "workbench"/);
  assert.doesNotMatch(railSource, /fetch\s*\(/);
  assert.doesNotMatch(railSource, /XMLHttpRequest/);
});

test("auto-context extracts compact identity values without transport", () => {
  assert.match(contextSource, /function nameFromRows\(\)/);
  assert.match(contextSource, /function addressFromRows\(\)/);
  assert.match(contextSource, /function macFromRows\(\)/);
  assert.match(contextSource, /name: nameFromRows\(\)/);
  assert.match(contextSource, /address: addressFromRows\(\)/);
  assert.match(contextSource, /mac,/);
  assert.doesNotMatch(contextSource, /fetch\s*\(/);
  assert.doesNotMatch(contextSource, /XMLHttpRequest/);
});

test("modules load after the existing Workbench core", () => {
  const isolatedScript = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  assert.ok(isolatedScript);
  const workbenchIndex = isolatedScript.js.indexOf("src/workbench.js");
  const contextIndex = isolatedScript.js.indexOf("src/auto-context.js");
  const railIndex = isolatedScript.js.indexOf("src/rail-shell.js");
  assert.ok(contextIndex > workbenchIndex);
  assert.ok(railIndex > contextIndex);
});
