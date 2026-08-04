import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../extension/src/sidepanel-launcher.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../extension/src/workbench-core-bridge.js", import.meta.url), "utf8");
const mentorEvidence = readFileSync(new URL("../extension/src/mentor-evidence.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../extension/src/core-sidepanel-adapter.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../extension/src/sidepanel-worker.js", import.meta.url), "utf8");
const livePanel = readFileSync(new URL("../extension/live-panel.js", import.meta.url), "utf8");
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
  assert.match(launcher, /USERSIDE_HEADER_HEIGHT = 48/);
});

test("launcher exposes only live assistant and quick facts", () => {
  assert.match(launcher, /data-mode="live"/);
  assert.match(launcher, /data-mode="quick"/);
  assert.doesNotMatch(launcher, /data-mode="mentor"/);
  assert.doesNotMatch(launcher, /Обучение|Live Call<\/span>/);
});

test("launcher click gives visible opening and error states", () => {
  assert.match(launcher, /classList\.add\("opening"\)/);
  assert.match(launcher, /showError\(/);
  assert.match(launcher, /response\?\.ok/);
  assert.match(launcher, /event\.preventDefault\(\)/);
  assert.match(launcher, /event\.stopPropagation\(\)/);
});

test("side panel open happens before any awaited work", () => {
  const openFunction = worker.slice(worker.indexOf("function openForSender"), worker.indexOf("function workflowKeyFromState"));
  assert.match(openFunction, /chrome\.sidePanel\.open\(\{ windowId \}\)/);
  assert.doesNotMatch(openFunction.split("chrome.sidePanel.open")[0], /await /);
  assert.match(openFunction, /void configurePanel\(tabId\)/);
});

test("native panel keeps the rail at the far right and workspace to its left", () => {
  assert.match(livePanelHtml, /class="side-shell"/);
  assert.match(livePanelHtml, /class="workspace"/);
  assert.match(livePanelHtml, /class="dock-rail"/);
  assert.match(livePanelCss, /grid-template-columns:minmax\(0,1fr\) 48px/);
  assert.match(livePanelCss, /\.workspace\{grid-column:1/);
  assert.match(livePanelCss, /\.dock-rail\{grid-column:2/);
  assert.match(livePanelCss, /@keyframes slide-left/);
});

test("external launcher hides while native side panel owns the right edge", () => {
  assert.match(worker, /SIMNET_WB_SIDE_PANEL_PORT/);
  assert.match(worker, /SIMNET_WB_PANEL_VISIBILITY/);
  assert.match(worker, /setLauncherVisible\(connectedTabId, false\)/);
  assert.match(worker, /setLauncherVisible\(connectedTabId, true\)/);
  assert.match(launcher, /setRailVisible\(message\.visible\)/);
});

test("legacy workbench UI is kept off-screen as runtime only", () => {
  assert.match(launcher, /#dp-panel/);
  assert.match(launcher, /-100000px/);
  assert.match(launcher, /sidepanelRuntime = "hidden"/);
  assert.match(launcher, /clip-path/);
  assert.match(launcher, /pointer-events/);
});

test("native live panel is opened from the launcher", () => {
  assert.match(launcher, /SIMNET_WB_OPEN_SIDE_PANEL/);
  assert.match(worker, /chrome\.sidePanel\.open/);
  assert.match(worker, /PANEL_PATH = "live-panel\.html"/);
  assert.equal(manifest.side_panel.default_path, "live-panel.html");
});

test("core bridge owns subscriber context and OLT evidence", () => {
  assert.match(bridge, /__SIMNET_WORKBENCH_CORE__/);
  assert.match(bridge, /function detectContext\(\)/);
  assert.match(bridge, /function billingOltInfo\(\)/);
  assert.match(bridge, /dopfield_29/);
  assert.match(bridge, /dopfield_39/);
  assert.match(bridge, /function usersideTmcInfo\(\)/);
  assert.match(bridge, /Найдено\\s\+на\\s\+OLT/);
  assert.match(bridge, /function billingRoutes\(billingId\)/);
  assert.match(bridge, /function runDiagnostic\(\)/);
  assert.match(bridge, /function stopDiagnostic\(\)/);
});

test("mentor evidence wraps core without duplicating diagnostic requests", () => {
  assert.match(mentorEvidence, /const baseCore = globalThis\.__SIMNET_WORKBENCH_CORE__/);
  assert.match(mentorEvidence, /function enrichState\(input\)/);
  assert.match(mentorEvidence, /getState\(\)/);
  assert.match(mentorEvidence, /baseCore\.subscribe/);
  assert.doesNotMatch(mentorEvidence, /fetch\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

test("mentor evidence detects Juniper checkpoint from loaded content", () => {
  assert.match(mentorEvidence, /function sessionEvidence\(\)/);
  assert.match(mentorEvidence, /iframe\[src\*='juniper' i\]/);
  assert.match(mentorEvidence, /status === "active" \|\| status === "absent"/);
  assert.match(mentorEvidence, /juniperOpened: session\.opened/);
  assert.match(mentorEvidence, /sessionResolved: session\.resolved/);
  assert.match(mentorEvidence, /sessionActive: session\.active/);
});

test("mentor evidence emits automatic OLT TMC and ONU checkpoints", () => {
  assert.match(mentorEvidence, /technicalDataOpened:/);
  assert.match(mentorEvidence, /oltFieldChecked:/);
  assert.match(mentorEvidence, /tmcOpened:/);
  assert.match(mentorEvidence, /tmcOltFound:/);
  assert.match(mentorEvidence, /oltKnown:/);
  assert.match(mentorEvidence, /onuPolled:/);
});

test("critical Billing warnings map to exact highlight targets", () => {
  assert.match(mentorEvidence, /severity: "critical"/);
  assert.match(mentorEvidence, /billing-access/);
  assert.match(mentorEvidence, /billing-block/);
  assert.match(mentorEvidence, /billing-group/);
  assert.match(mentorEvidence, /billing-tariff/);
  assert.match(mentorEvidence, /billing-start-day/);
  assert.match(adapter, /kind === "billing-access"/);
  assert.match(adapter, /kind === "billing-start-day"/);
});

test("missing PON OLT becomes a mentor warning", () => {
  assert.match(mentorEvidence, /evidence\.pon\.isPon && context\?\.olt\?\.status === "missing"/);
  assert.match(mentorEvidence, /Для PON не указана OLT/);
  assert.match(mentorEvidence, /severity: "warning"/);
});

test("OLT highlighting blocks pollers until Billing OLT is known", () => {
  assert.match(adapter, /function createBlockedOverlay\(/);
  assert.match(adapter, /Сначала определить OLT/);
  assert.match(adapter, /context\.olt\?\.present/);
  assert.match(adapter, /billing-olt-field/);
  assert.match(adapter, /billing-userside/);
  assert.match(adapter, /userside-tmc/);
  assert.match(adapter, /poller-huawei/);
  assert.match(adapter, /poller-gpon/);
});

test("service worker persists and reconciles OLT workflow across tabs", () => {
  assert.match(worker, /SIMNET_WB_WORKFLOW_COMMAND/);
  assert.match(worker, /SIMNET_WB_WORKFLOW_STATE/);
  assert.match(worker, /simnet_wb_olt_workflows_v1/);
  assert.match(worker, /chrome\.storage\.session/);
  assert.match(worker, /chrome\.tabs\.onActivated/);
  assert.match(worker, /chrome\.tabs\.onCreated/);
  assert.match(worker, /openerTabId/);
  assert.match(worker, /billingTabId/);
  assert.match(worker, /usersideTabId/);
});

test("Live Assistant reveals hints progressively instead of exposing answers", () => {
  assert.match(livePanel, /wb_live_hint_levels_v1/);
  assert.match(livePanel, /function advanceHint\(taskId/);
  assert.match(livePanel, /function missingOltHints\(context\)/);
  assert.match(livePanel, /function sessionHints\(\)/);
  assert.match(livePanel, /data-hint-task/);
  assert.match(livePanel, /готовое значение в панели скрыто до последней подсказки/i);
  assert.match(livePanel, /routeDataAllowed/);
});

test("Live Assistant uses automatic checkpoints and removes manual yes no", () => {
  assert.match(livePanel, /function checkpoints\(\)/);
  assert.match(livePanel, /cp\.sessionResolved/);
  assert.match(livePanel, /cp\.onuPolled/);
  assert.match(livePanel, /Сессия подтверждена автоматически/);
  assert.doesNotMatch(livePanel, /data-answer=/);
});

test("Live Assistant renders one compact OLT route step at a time", () => {
  assert.match(livePanelHtml, /id="oltRouteCard"/);
  assert.match(livePanelHtml, /id="oltRouteActions"/);
  assert.match(livePanelHtml, /live-route\.css/);
  assert.match(livePanel, /function routeDefinition\(\)/);
  assert.match(livePanel, /data-workflow-action/);
  assert.match(livePanel, /Вернуться в Billing/);
  assert.match(livePanel, /Подсветить ТМЦ/);
  assert.match(livePanel, /Подсветить поле OLT/);
  assert.match(routeCss, /\.route-card/);
  assert.match(routeCss, /severity-critical/);
  assert.match(routeCss, /severity-warning/);
});

test("live panel keeps full technical values in quick facts", () => {
  assert.match(livePanel, /function renderFacts\(\)/);
  assert.match(livePanel, /OLT Billing:/);
  assert.match(livePanel, /OLT ТМЦ:/);
  assert.match(livePanel, /Juniper:/);
});

test("manifest loads bridge evidence adapter and launcher in order", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const workbench = isolated.js.indexOf("src/workbench.js");
  const bridgeIndex = isolated.js.indexOf("src/workbench-core-bridge.js");
  const evidenceIndex = isolated.js.indexOf("src/mentor-evidence.js");
  const adapterIndex = isolated.js.indexOf("src/core-sidepanel-adapter.js");
  const launcherIndex = isolated.js.indexOf("src/sidepanel-launcher.js");
  assert.ok(bridgeIndex > workbench);
  assert.ok(evidenceIndex > bridgeIndex);
  assert.ok(adapterIndex > evidenceIndex);
  assert.ok(launcherIndex > adapterIndex);
  assert.equal(isolated.js.includes("src/mentor-shell.js"), false);
});
