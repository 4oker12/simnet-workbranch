import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerEntry = readFileSync(new URL("../extension/src/service-worker-entry.js", import.meta.url), "utf8");
const dockWorker = readFileSync(new URL("../extension/src/dock-primary-worker.js", import.meta.url), "utf8");
const layoutFix = readFileSync(new URL("../extension/src/dock-layout-fix.js", import.meta.url), "utf8");
const compactCss = readFileSync(new URL("../extension/live-compact.css", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("Dock is the default action UI and native side panel is explicit", () => {
  assert.match(workerEntry, /dock-primary-worker\.js/);
  assert.match(dockWorker, /openPanelOnActionClick: false/);
  assert.match(dockWorker, /chrome\.action\.onClicked/);
  assert.match(dockWorker, /SIMNET_WB_OPEN_DOCK/);
});

test("layout fix keeps rail visible when native panel reports visibility changes", () => {
  assert.match(layoutFix, /SIMNET_WB_PANEL_VISIBILITY/);
  assert.match(layoutFix, /message\.visible === false/);
  assert.match(layoutFix, /setRailVisible\?\.\(true\)/);
});

test("NoDeny body and maindiv both receive reserved geometry", () => {
  assert.match(layoutFix, /html\.simnet-wb-dock-reserved body/);
  assert.match(layoutFix, /width: calc\(100vw - var\(--simnet-wb-dock-reserve/);
  assert.match(layoutFix, /margin-right: var\(--simnet-wb-dock-reserve/);
  assert.match(layoutFix, /html\.simnet-wb-dock-reserved #maindiv/);
  assert.match(layoutFix, /overflow-x: auto/);
});

test("Dock density is compact and constrained to 100vh", () => {
  assert.match(layoutFix, /width: min\(280px, calc\(100vw - 48px\)\)/);
  assert.match(layoutFix, /grid-template-rows: 36px minmax\(0, 1fr\) 30px/);
  assert.match(layoutFix, /\.active-task/);
  assert.match(layoutFix, /min-height: 76px/);
  assert.match(layoutFix, /\.mini-step/);
  assert.match(layoutFix, /min-height: 22px/);
});

test("full native panel no longer shows oversized diagnostic controls", () => {
  assert.match(compactCss, /\.command-bar\{display:none!important\}/);
  assert.match(compactCss, /\.focus-card p\{display:none!important\}/);
  assert.match(compactCss, /\.workspace\{gap:5px!important;padding:6px!important\}/);
});

test("dock layout fixer loads after the launcher", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const launcher = isolated.js.indexOf("src/sidepanel-launcher.js");
  const fix = isolated.js.indexOf("src/dock-layout-fix.js");
  assert.ok(launcher >= 0);
  assert.ok(fix > launcher);
});
