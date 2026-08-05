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
const livePanelHtml = readFileSync(new URL("../extension/live-panel.html", import.meta.url), "utf8");
const livePanelCss = readFileSync(new URL("../extension/live-panel.css", import.meta.url), "utf8");
const routeCss = readFileSync(new URL("../extension/live-route.css", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("launcher reserves 48px only on subscriber workspaces", () => {
  assert.match(launcher, /const RAIL_WIDTH = 48/);
  assert.match(launcher, /function isSubscriberWorkspace\(\)/);
  assert.match(launcher, /state\.layout === "full"/);
  assert.match(launcher, /padding-right/);
  assert.match(launcher, /data-layout="compact"/);
});

test("launcher exposes live assistant and quick facts", () => {
  assert.match(launcher, /data-mode="live"/);
  assert.match(launcher, /data-mode="quick"/);
  assert.doesNotMatch(launcher, /data-mode="mentor"/);
});

test("side panel opens before awaited work", () => {
  const openFunction = worker.slice(worker.indexOf("function openForSender"), worker.indexOf("function workflowKeyFromState"));
  assert.match(openFunction, /chrome\.sidePanel\.open\(\{ windowId \}\)/);
  assert.doesNotMatch(openFunction.split("chrome.sidePanel.open")[0], /await /);
  assert.match(openFunction, /void configurePanel\(tabId\)/);
});

test("native panel keeps workspace left and 48px rail right", () => {
  assert.match(livePanelHtml, /class="side-shell"/);
  assert.match(livePanelHtml, /class="workspace"/);
  assert.match(livePanelHtml, /class="dock-rail"/);
  assert.match(livePanelCss, /grid-template-columns:minmax\(0,1fr\) 48px/);
});

test("legacy workbench UI remains runtime-only", () => {
  assert.match(launcher, /#dp-panel/);
  assert.match(launcher, /-100000px/);
  assert.match(launcher, /sidepanelRuntime = "hidden"/);
  assert.match(launcher, /clip-path/);
});

test("core bridge owns subscriber and OLT context", () => {
  assert.match(bridge, /__SIMNET_WORKBENCH_CORE__/);
  assert.match(bridge, /function detectContext\(\)/);
  assert.match(bridge, /function billingOltInfo\(\)/);
  assert.match(bridge, /dopfield_29/);
  assert.match(bridge, /function usersideTmcInfo\(\)/);
  assert.match(bridge, /function billingRoutes\(billingId\)/);
});

test("mentor evidence adds checkpoints without network duplication", () => {
  assert.match(mentorEvidence, /const baseCore = globalThis\.__SIMNET_WORKBENCH_CORE__/);
  assert.match(mentorEvidence, /function enrichState\(input\)/);
  assert.match(mentorEvidence, /sessionResolved: session\.resolved/);
  assert.match(mentorEvidence, /onuPolled:/);
  assert.doesNotMatch(mentorEvidence, /fetch\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

test("ONU checkpoint requires structured live evidence", () => {
  assert.match(onuEvidence, /function strictLineEvidence\(\)/);
  assert.match(onuEvidence, /opticalProof/);
  assert.match(onuEvidence, /structuredProof/);
  assert.match(onuEvidence, /explicitProof/);
  assert.match(onuEvidence, /onuPolled: line\.polled/);
});

test("critical Billing warnings map to precise highlight targets", () => {
  assert.match(mentorEvidence, /billing-access/);
  assert.match(mentorEvidence, /billing-block/);
  assert.match(mentorEvidence, /billing-group/);
  assert.match(mentorEvidence, /billing-tariff/);
  assert.match(mentorEvidence, /billing-start-day/);
  assert.match(adapter, /kind === "billing-access"/);
  assert.match(adapter, /kind === "billing-start-day"/);
});

test("blocked pollers render as one bright grouped highlight", () => {
  assert.match(adapter, /function createBlockedGroup\(/);
  assert.match(adapter, /function boundsFor\(/);
  assert.match(adapter, /simnet-wb-blocked-group/);
  assert.match(adapter, /brightness\(1\.9\)/);
  assert.match(adapter, /createBlockedGroup\(blocked\.filter\(isVisible\), root\)/);
  assert.doesNotMatch(adapter, /block\.textContent = "Сначала определить OLT"/);
  assert.match(adapter, /BLOCKED_POLLER_REASON = "Сначала определить OLT"/);
});

test("canonical mentor model drives both focus and checklist", () => {
  assert.match(mentorModel, /function buildMentorModel\(\)/);
  assert.match(mentorModel, /buildSteps = function buildCanonicalSteps/);
  assert.match(mentorModel, /currentTask = function currentCanonicalTask/);
  assert.match(mentorModel, /const steps = buildStepsFromState/);
  assert.match(mentorModel, /focusCandidates/);
  assert.match(mentorModel, /stepId/);
});

test("canonical model maps alerts to their checklist steps", () => {
  assert.match(mentorModel, /alert\.id === "missing-olt"/);
  assert.match(mentorModel, /return "line"/);
  assert.match(mentorModel, /alert\.id === "session-absent"/);
  assert.match(mentorModel, /return "session"/);
  assert.match(mentorModel, /return "subscriber"/);
  assert.match(mentorModel, /line-problem/);
});

test("verified session and ONU evidence survive related navigation", () => {
  assert.match(mentorModel, /wb_live_verified_progress_v1/);
  assert.match(mentorModel, /EVIDENCE_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(mentorModel, /cachedSession/);
  assert.match(mentorModel, /cachedLine/);
  assert.match(mentorModel, /sessionResolved = Boolean\(rawCp\.sessionResolved \|\| cachedSession\)/);
  assert.match(mentorModel, /onuPolled = Boolean\(rawCp\.onuPolled \|\| cachedLine\)/);
});

test("completed checks with deviations cannot become all-clear focus", () => {
  assert.match(mentorModel, /ev\.line\?\.problem/);
  assert.match(mentorModel, /Live-опрос выявил отклонение/);
  assert.match(mentorModel, /ev\.session\?\.absent/);
  const alertBuild = mentorModel.indexOf("const focusCandidates = alerts.map");
  const completeBuild = mentorModel.indexOf("if (!focusCandidates.length)");
  assert.ok(alertBuild >= 0 && completeBuild > alertBuild);
});

test("Live Assistant reveals hints progressively", () => {
  assert.match(livePanel, /wb_live_hint_levels_v1/);
  assert.match(livePanel, /function advanceHint\(taskId/);
  assert.match(livePanel, /function missingOltHints\(context\)/);
  assert.match(livePanel, /data-hint-task/);
  assert.match(livePanel, /routeDataAllowed/);
});

test("OLT workflow persists across tabs", () => {
  assert.match(worker, /SIMNET_WB_WORKFLOW_COMMAND/);
  assert.match(worker, /simnet_wb_olt_workflows_v1/);
  assert.match(worker, /chrome\.storage\.session/);
  assert.match(worker, /chrome\.tabs\.onActivated/);
  assert.match(worker, /chrome\.tabs\.onCreated/);
  assert.match(worker, /openerTabId/);
});

test("route remains compact and operator-controlled", () => {
  assert.match(livePanelHtml, /id="oltRouteCard"/);
  assert.match(livePanel, /function routeDefinition\(\)/);
  assert.match(livePanel, /data-workflow-action/);
  assert.match(livePanel, /Workbench не сохраняет изменение автоматически/);
  assert.match(routeCss, /\.route-card/);
});

test("panel scripts load base model decorators in deterministic order", () => {
  const baseIndex = livePanelHtml.indexOf("live-panel.js");
  const modelIndex = livePanelHtml.indexOf("live-mentor-model.js");
  const skipIndex = livePanelHtml.indexOf("live-skip.js");
  const onuRouteIndex = livePanelHtml.indexOf("live-onu-route.js");
  assert.ok(baseIndex >= 0);
  assert.ok(modelIndex > baseIndex);
  assert.ok(skipIndex > modelIndex);
  assert.ok(onuRouteIndex > skipIndex);
});

test("manifest loads bridge evidence correction adapter and launcher in order", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const workbenchIndex = isolated.js.indexOf("src/workbench.js");
  const bridgeIndex = isolated.js.indexOf("src/workbench-core-bridge.js");
  const evidenceIndex = isolated.js.indexOf("src/mentor-evidence.js");
  const onuIndex = isolated.js.indexOf("src/onu-evidence.js");
  const adapterIndex = isolated.js.indexOf("src/core-sidepanel-adapter.js");
  const launcherIndex = isolated.js.indexOf("src/sidepanel-launcher.js");
  assert.ok(bridgeIndex > workbenchIndex);
  assert.ok(evidenceIndex > bridgeIndex);
  assert.ok(onuIndex > evidenceIndex);
  assert.ok(adapterIndex > onuIndex);
  assert.ok(launcherIndex > adapterIndex);
});
