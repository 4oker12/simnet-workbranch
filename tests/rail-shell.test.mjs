import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const railSource = readFileSync(new URL("../extension/src/rail-shell.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("rail exposes exactly two primary diagnostic modes", () => {
  assert.match(railSource, /data-action="diagnostic"/);
  assert.match(railSource, /data-action="mentor"/);
  assert.match(railSource, /Быстрая диагностика/);
  assert.match(railSource, /Диагност-наставник/);
  assert.doesNotMatch(railSource, /data-action="results"/);
  assert.doesNotMatch(railSource, /data-action="journal"/);
});

test("rail keeps history as a secondary action", () => {
  assert.match(railSource, /data-action="history"/);
  assert.match(railSource, /История абонента/);
});

test("rail reuses the existing Workbench panel through a slot", () => {
  assert.match(railSource, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(railSource, /<slot name="workbench"><\/slot>/);
  assert.match(railSource, /panel\.slot = "workbench"/);
  assert.doesNotMatch(railSource, /fetch\s*\(/);
  assert.doesNotMatch(railSource, /XMLHttpRequest/);
});

test("rail is loaded after Workbench and mentor modules", () => {
  const isolatedScript = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  assert.ok(isolatedScript);
  const railIndex = isolatedScript.js.indexOf("src/rail-shell.js");
  assert.ok(railIndex > isolatedScript.js.indexOf("src/workbench.js"));
  assert.ok(railIndex > isolatedScript.js.indexOf("src/training-mentor.js"));
});
