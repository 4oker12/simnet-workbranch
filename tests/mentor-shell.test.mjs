import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../extension/src/mentor-shell.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../extension/src/workbench-core-bridge.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("mentor shell stays pinned to the right and opens modules left", () => {
  assert.match(shell, /const RAIL_WIDTH = 48/);
  assert.match(shell, /const ANCHOR_WIDTH = 280/);
  assert.match(shell, /right:\$\{EXPANDED_WIDTH\}px/);
});

test("mentor shell is a pure client of the core bridge", () => {
  assert.match(shell, /const core = globalThis\.__SIMNET_WORKBENCH_CORE__/);
  assert.match(shell, /core\.subscribe/);
  assert.match(shell, /core\.runDiagnostic\(\)/);
  assert.match(shell, /core\.stopDiagnostic\(\)/);
  assert.doesNotMatch(shell, /querySelectorAll\("tr,\.item/);
  assert.doesNotMatch(shell, /extractLogins|extractIps|normalizeMac/);
});

test("core bridge owns context, status and diagnostic commands", () => {
  assert.match(bridge, /__SIMNET_WORKBENCH_CORE__/);
  assert.match(bridge, /function detectContext\(\)/);
  assert.match(bridge, /function runDiagnostic\(\)/);
  assert.match(bridge, /function stopDiagnostic\(\)/);
  assert.match(bridge, /function subscribe\(listener\)/);
});

test("legacy panel remains hidden runtime", () => {
  assert.match(shell, /class="legacy-runtime"/);
  assert.match(shell, /left:-100000px/);
});

test("manifest loads bridge between workbench and shell", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const workbench = isolated.js.indexOf("src/workbench.js");
  const bridgeIndex = isolated.js.indexOf("src/workbench-core-bridge.js");
  const shellIndex = isolated.js.indexOf("src/mentor-shell.js");
  assert.ok(bridgeIndex > workbench);
  assert.ok(shellIndex > bridgeIndex);
});
