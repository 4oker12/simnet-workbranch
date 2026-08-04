import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../extension/src/sidepanel-launcher.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../extension/src/workbench-core-bridge.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../extension/src/core-sidepanel-adapter.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../extension/src/sidepanel-worker.js", import.meta.url), "utf8");
const sidepanel = readFileSync(new URL("../extension/sidepanel.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("launcher stays pinned to the right and reserves only 48px", () => {
  assert.match(launcher, /width:48px/);
  assert.match(launcher, /right:0/);
  assert.match(launcher, /padding-right/);
  assert.doesNotMatch(launcher, /ANCHOR_WIDTH|FLYOUT_WIDTH/);
});

test("native side panel is opened from the launcher", () => {
  assert.match(launcher, /SIMNET_WB_OPEN_SIDE_PANEL/);
  assert.match(worker, /chrome\.sidePanel\.open/);
  assert.match(worker, /chrome\.sidePanel\.setOptions/);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
});

test("side panel consumes core state through a message adapter", () => {
  assert.match(adapter, /__SIMNET_WORKBENCH_CORE__/);
  assert.match(adapter, /core\.subscribe/);
  assert.match(adapter, /SIMNET_WB_CORE_STATE/);
  assert.match(sidepanel, /SIMNET_WB_GET_ACTIVE_STATE/);
  assert.match(sidepanel, /SIMNET_WB_CORE_COMMAND/);
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
