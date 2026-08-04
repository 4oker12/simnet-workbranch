import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../extension/src/sidepanel-launcher.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../extension/src/workbench-core-bridge.js", import.meta.url), "utf8");
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
  assert.match(bridge, /function subscribe\(listener\)/);
});

test("billing bridge detects the card from URL and visible login row", () => {
  assert.match(bridge, /function findLoginElement\(\)/);
  assert.match(bridge, /function billingRowData\(loginElement\)/);
  assert.match(bridge, /action === "user"/);
  assert.match(bridge, /rowData\.ip \|\| routeIp/);
  assert.match(bridge, /window\.setTimeout\(publish, 1400\)/);
});

test("authorization guidance includes billing access checks", () => {
  assert.match(bridge, /function billingAccessChecks\(\)/);
  assert.match(bridge, /select\[name='state'\]/);
  assert.match(bridge, /input\[name='start_day'\]/);
  assert.match(bridge, /Доступ/);
  assert.match(bridge, /Блокировка/);
  assert.match(bridge, /Группа/);
  assert.match(bridge, /Тариф/);
  assert.match(livePanel, /accessSummary/);
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
  assert.match(worker, /billingTabId/);
  assert.match(worker, /usersideTabId/);
  assert.match(worker, /userside_tmc_found/);
  assert.match(worker, /billing_fill_olt/);
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
  assert.match(routeCss, /\.route-actions/);
});

test("live panel consumes core state and sends diagnostic commands", () => {
  assert.match(adapter, /core\.subscribe/);
  assert.match(adapter, /SIMNET_WB_CORE_STATE/);
  assert.match(livePanel, /SIMNET_WB_GET_ACTIVE_STATE/);
  assert.match(livePanel, /SIMNET_WB_CORE_COMMAND/);
  assert.match(livePanel, /Live Assistant/);
});

test("manifest loads bridge, adapter and launcher in order", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const workbench = isolated.js.indexOf("src/workbench.js");
  const bridgeIndex = isolated.js.indexOf("src/workbench-core-bridge.js");
  const adapterIndex = isolated.js.indexOf("src/core-sidepanel-adapter.js");
  const launcherIndex = isolated.js.indexOf("src/sidepanel-launcher.js");
  assert.ok(bridgeIndex > workbench);
  assert.ok(adapterIndex > bridgeIndex);
  assert.ok(launcherIndex > adapterIndex);
  assert.equal(isolated.js.includes("src/mentor-shell.js"), false);
});
