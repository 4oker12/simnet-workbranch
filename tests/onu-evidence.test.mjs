import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evidence = readFileSync(new URL("../extension/src/onu-evidence.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../extension/live-onu-route.js", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../extension/live-panel.html", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("ONU completion no longer scans arbitrary page text", () => {
  assert.match(evidence, /function strictLineEvidence\(\)/);
  assert.match(evidence, /RESULT_SELECTORS/);
  assert.match(evidence, /#dp-results/);
  assert.match(evidence, /div\.message/);
  assert.doesNotMatch(evidence, /document\.body\.innerText|documentText\(|pageText/);
});

test("ONU poll requires a structured multi-signal proof", () => {
  assert.match(evidence, /const opticalProof =/);
  assert.match(evidence, /const structuredProof =/);
  assert.match(evidence, /const explicitProof =/);
  assert.match(evidence, /hasRxDbm/);
  assert.match(evidence, /hasTxDbm/);
  assert.match(evidence, /hasEquipment && hasStatus/);
  assert.match(evidence, /onuPolled: line\.polled/);
});

test("unverified line evidence explicitly keeps the checkpoint open", () => {
  assert.match(evidence, /status: "unverified"/);
  assert.match(evidence, /polled: false/);
  assert.match(evidence, /Live-опрос ONU ещё не подтверждён/);
});

test("incomplete ONU step exposes a primary route action", () => {
  assert.match(route, /К опросу/);
  assert.match(route, /Маршрут OLT/);
  assert.match(route, /data-highlight=\\?"line/);
  assert.match(route, /onu-route-choice/);
  assert.match(route, /data-step-id=\\?"line/);
  assert.match(route, /task\?\.stepId !== "line"/);
});

test("strict ONU evidence loads after mentor evidence and before adapter", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const mentor = isolated.js.indexOf("src/mentor-evidence.js");
  const onu = isolated.js.indexOf("src/onu-evidence.js");
  const adapter = isolated.js.indexOf("src/core-sidepanel-adapter.js");
  assert.ok(onu > mentor);
  assert.ok(adapter > onu);
});

test("ONU route decorator loads after skip renderer", () => {
  const skip = panelHtml.indexOf('<script src="live-skip.js"></script>');
  const onuRoute = panelHtml.indexOf('<script src="live-onu-route.js"></script>');
  assert.ok(skip >= 0);
  assert.ok(onuRoute > skip);
  assert.match(panelHtml, /live-onu-route\.css/);
});
