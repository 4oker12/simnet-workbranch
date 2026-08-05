import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../extension/src/sidepanel-launcher.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../extension/src/workbench-core-bridge.js", import.meta.url), "utf8");
const mentorEvidence = readFileSync(new URL("../extension/src/mentor-evidence.js", import.meta.url), "utf8");
const onuEvidence = readFileSync(new URL("../extension/src/onu-evidence.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../extension/src/core-sidepanel-adapter.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../extension/src/sidepanel-worker.js", import.meta.url), "utf8");
const livePanel = readFileSync(new URL("../extension/live-panel.js", import.meta.url), "utf8");
const mentorModel = readFileSync(new URL("../extension/live-mentor-model.js", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../extension/live-panel.html", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("launcher exposes the native Live and Facts rail", () => {
  assert.match(launcher, /const RAIL_WIDTH = 48/);
  assert.match(launcher, /data-mode="live"/);
  assert.match(launcher, /data-mode="quick"/);
  assert.match(launcher, /SIMNET_WB_OPEN_SIDE_PANEL/);
  assert.doesNotMatch(launcher, /data-mode="mentor"/);
});

test("side panel opens before awaited work", () => {
  const source = worker.slice(worker.indexOf("function openForSender"), worker.indexOf("function workflowKeyFromState"));
  assert.match(source, /chrome\.sidePanel\.open\(\{ windowId \}\)/);
  assert.doesNotMatch(source.split("chrome.sidePanel.open")[0], /await /);
});

test("bridge and evidence layers remain deterministic", () => {
  assert.match(bridge, /function detectContext\(\)/);
  assert.match(bridge, /function billingOltInfo\(\)/);
  assert.match(bridge, /function usersideTmcInfo\(\)/);
  assert.match(mentorEvidence, /function enrichState\(input\)/);
  assert.match(mentorEvidence, /sessionResolved: session\.resolved/);
  assert.doesNotMatch(mentorEvidence, /fetch\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

test("ONU completion requires structured result evidence", () => {
  assert.match(onuEvidence, /function strictLineEvidence\(\)/);
  assert.match(onuEvidence, /opticalProof/);
  assert.match(onuEvidence, /structuredProof/);
  assert.match(onuEvidence, /explicitProof/);
  assert.match(onuEvidence, /onuPolled: line\.polled/);
});

test("exact Billing and Juniper elements remain addressable", () => {
  assert.match(adapter, /const EXACT_SELECTORS = Object\.freeze/);
  assert.match(adapter, /juniperNew:/);
  assert.match(adapter, /juniperStatus:/);
  assert.match(adapter, /billingTechnical:/);
  assert.match(adapter, /billingOltField:/);
  assert.match(adapter, /pollerEpon:/);
  assert.match(adapter, /pollerHuawei:/);
});

test("blocked pollers use one bright grouped region", () => {
  assert.match(adapter, /function boundsFor\(/);
  assert.match(adapter, /function createBlockedGroup\(/);
  assert.match(adapter, /simnet-wb-blocked-group/);
  assert.match(adapter, /brightness\(1\.9\)/);
  assert.match(adapter, /createBlockedGroup\(blocked\.filter\(isVisible\), root\)/);
  assert.doesNotMatch(adapter, /block\.textContent = "Сначала определить OLT"/);
});

test("focus and checklist derive from one canonical model", () => {
  assert.match(mentorModel, /function buildMentorModel\(\)/);
  assert.match(mentorModel, /const steps = buildStepsFromState/);
  assert.match(mentorModel, /const focusCandidates = alerts\.map/);
  assert.match(mentorModel, /buildSteps = function buildCanonicalSteps/);
  assert.match(mentorModel, /currentTask = function currentCanonicalTask/);
  assert.match(mentorModel, /stepId/);
});

test("alerts map to the same subscriber session and line steps", () => {
  assert.match(mentorModel, /alert\.id === "missing-olt"/);
  assert.match(mentorModel, /alert\.id === "line-problem"/);
  assert.match(mentorModel, /alert\.id === "session-absent"/);
  assert.match(mentorModel, /return "line"/);
  assert.match(mentorModel, /return "session"/);
  assert.match(mentorModel, /return "subscriber"/);
});

test("verified session and ONU evidence survive related navigation", () => {
  assert.match(mentorModel, /wb_live_verified_progress_v1/);
  assert.match(mentorModel, /EVIDENCE_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(mentorModel, /cachedSession/);
  assert.match(mentorModel, /cachedLine/);
  assert.match(mentorModel, /sessionResolved = Boolean\(rawCp\.sessionResolved \|\| cachedSession\)/);
  assert.match(mentorModel, /onuPolled = Boolean\(rawCp\.onuPolled \|\| cachedLine\)/);
});

test("deviations are prioritized before all-clear", () => {
  assert.match(mentorModel, /Live-опрос выявил отклонение/);
  assert.match(mentorModel, /Juniper: статус offline/);
  const alertsIndex = mentorModel.indexOf("const focusCandidates = alerts.map");
  const completeIndex = mentorModel.indexOf("if (!focusCandidates.length)");
  assert.ok(alertsIndex >= 0 && completeIndex > alertsIndex);
});

test("hint progression and route use the canonical line id", () => {
  assert.match(livePanel, /wb_live_hint_levels_v1/);
  assert.match(livePanel, /function advanceHint\(taskId/);
  assert.match(mentorModel, /hintLevel\("line"\) >= 4/);
  assert.match(mentorModel, /routeDataAllowed = function canonicalRouteDataAllowed/);
});

test("panel decorators load in deterministic order", () => {
  const base = panelHtml.indexOf("live-panel.js");
  const model = panelHtml.indexOf("live-mentor-model.js");
  const skip = panelHtml.indexOf("live-skip.js");
  const route = panelHtml.indexOf("live-onu-route.js");
  assert.ok(base >= 0 && model > base && skip > model && route > skip);
});

test("content layers load bridge evidence ONU adapter launcher in order", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const bridgeIndex = isolated.js.indexOf("src/workbench-core-bridge.js");
  const evidenceIndex = isolated.js.indexOf("src/mentor-evidence.js");
  const onuIndex = isolated.js.indexOf("src/onu-evidence.js");
  const adapterIndex = isolated.js.indexOf("src/core-sidepanel-adapter.js");
  const launcherIndex = isolated.js.indexOf("src/sidepanel-launcher.js");
  assert.ok(evidenceIndex > bridgeIndex);
  assert.ok(onuIndex > evidenceIndex);
  assert.ok(adapterIndex > onuIndex);
  assert.ok(launcherIndex > adapterIndex);
});
