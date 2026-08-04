import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const railSource = readFileSync(new URL("../extension/src/rail-shell.js", import.meta.url), "utf8");
const contextSource = readFileSync(new URL("../extension/src/auto-context.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("side rail is a fixed full-height right column, not a floating card", () => {
  assert.match(railSource, /position:fixed/);
  assert.match(railSource, /top:0/);
  assert.match(railSource, /right:0/);
  assert.match(railSource, /bottom:0/);
  assert.match(railSource, /height:100vh/);
  assert.match(railSource, /const EXPANDED_WIDTH = 352/);
  assert.match(railSource, /const COLLAPSED_WIDTH = 52/);
  assert.doesNotMatch(railSource, /data-action="side"/);
});

test("side rail reserves page space and supports collapse", () => {
  assert.match(railSource, /applyPageReserve/);
  assert.match(railSource, /padding-right/);
  assert.match(railSource, /data-action="collapse"/);
  assert.match(railSource, /data-expanded="false"/);
});

test("rail exposes exactly two primary diagnostic modes", () => {
  assert.match(railSource, /data-action="diagnostic"/);
  assert.match(railSource, /data-action="mentor"/);
  assert.match(railSource, /Быстрая диагностика/);
  assert.match(railSource, /Диагност-наставник/);
  assert.doesNotMatch(railSource, /data-action="results"/);
  assert.doesNotMatch(railSource, /data-action="journal"/);
});

test("legacy search controls are hidden and result details become compact accordions", () => {
  assert.match(railSource, /#dp-input,/);
  assert.match(railSource, /#dp-run,/);
  assert.match(railSource, /#dp-random-toggle \{ display:none !important; \}/);
  assert.match(railSource, /details > summary/);
  assert.match(railSource, /border-radius:6px/);
});

test("auto-context detects subscriber data and starts existing diagnostics without own transport", () => {
  assert.match(contextSource, /contractFromPageText/);
  assert.match(contextSource, /validIp/);
  assert.match(contextSource, /run\.click\(\)/);
  assert.match(contextSource, /simnet-workbench-context/);
  assert.doesNotMatch(contextSource, /fetch\s*\(/);
  assert.doesNotMatch(contextSource, /XMLHttpRequest/);
  assert.doesNotMatch(contextSource, /GM_xmlhttpRequest/);
});

test("side rail reuses the existing Workbench panel through a slot", () => {
  assert.match(railSource, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(railSource, /<slot name="workbench"><\/slot>/);
  assert.match(railSource, /panel\.slot = "workbench"/);
  assert.doesNotMatch(railSource, /fetch\s*\(/);
  assert.doesNotMatch(railSource, /XMLHttpRequest/);
});

test("manifest loads auto-context after Workbench and before the visual rail", () => {
  const isolatedScript = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  assert.ok(isolatedScript);
  const workbenchIndex = isolatedScript.js.indexOf("src/workbench.js");
  const contextIndex = isolatedScript.js.indexOf("src/auto-context.js");
  const railIndex = isolatedScript.js.indexOf("src/rail-shell.js");
  assert.ok(contextIndex > workbenchIndex);
  assert.ok(railIndex > contextIndex);
});
