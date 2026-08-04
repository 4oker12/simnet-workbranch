import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../extension/src/sidepanel-launcher.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../extension/src/workbench-core-bridge.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../extension/src/core-sidepanel-adapter.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../extension/src/sidepanel-worker.js", import.meta.url), "utf8");
const livePanel = readFileSync(new URL("../extension/live-panel.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("launcher stays pinned to the right and reserves only 48px", () => {
  assert.match(launcher, /const RAIL_WIDTH = 48/);
  assert.match(launcher, /right:0/);
  assert.match(launcher, /padding-right/);
  assert.doesNotMatch(launcher, /ANCHOR_WIDTH|FLYOUT_WIDTH/);
});

test("launcher exposes only live assistant and quick facts", () => {
  assert.match(launcher, /data-mode="live"/);
  assert.match(launcher, /data-mode="quick"/);
  assert.doesNotMatch(launcher, /data-mode="mentor"/);
  assert.doesNotMatch(launcher, /Обучение|Live Call<\/span>/);
});

test("legacy workbench UI is kept off-screen as runtime only", () => {
  assert.match(launcher, /#dp-panel/);
  assert.match(launcher, /-100000px/);
  assert.match(launcher, /sidepanelRuntime = "hidden"/);
});

test("native live panel is opened from the launcher", () => {
  assert.match(launcher, /SIMNET_WB_OPEN_SIDE_PANEL/);
  assert.match(worker, /chrome\.sidePanel\.open/);
  assert.match(worker, /PANEL_PATH = "live-panel\.html"/);
  assert.equal(manifest.side_panel.default_path, "live-panel.html");
});

test("live panel consumes core state and sends diagnostic commands", () => {
  assert.match(adapter, /__SIMNET_WORKBENCH_CORE__/);
  assert.match(adapter, /core\.subscribe/);
  assert.match(adapter, /SIMNET_WB_CORE_STATE/);
  assert.match(livePanel, /SIMNET_WB_GET_ACTIVE_STATE/);
  assert.match(livePanel, /SIMNET_WB_CORE_COMMAND/);
  assert.match(livePanel, /Сопровождение|Live Assistant/);
});

test("core bridge owns context, status and diagnostic commands", () => {
  assert.match(bridge, /__SIMNET_WORKBENCH_CORE__/);
  assert.match(bridge, /function detectContext\(\)/);
  assert.match(bridge, /function runDiagnostic\(\)/);
  assert.match(bridge, /function stopDiagnostic\(\)/);
  assert.match(bridge, /function subscribe\(listener\)/);
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
