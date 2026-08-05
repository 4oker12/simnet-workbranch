import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../extension/src/mentor-route-worker.js", import.meta.url), "utf8");
const controller = readFileSync(new URL("../extension/src/mentor-route-controller.js", import.meta.url), "utf8");
const dockUi = readFileSync(new URL("../extension/src/dock-route-ui.js", import.meta.url), "utf8");
const panelSync = readFileSync(new URL("../extension/live-route-sync.js", import.meta.url), "utf8");
const entry = readFileSync(new URL("../extension/src/service-worker-entry.js", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../extension/live-panel.html", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("route state separates management action and UI state", () => {
  assert.match(worker, /management:\s*\{/);
  assert.match(worker, /action:\s*next/);
  assert.match(worker, /ui:\s*\{/);
  assert.match(worker, /currentPage/);
  assert.match(worker, /expectedPage/);
  assert.match(worker, /pageMatched/);
  assert.match(worker, /blockForeignHighlights:\s*true/);
});

test("missing PON OLT starts a route only from verified technical data", () => {
  assert.match(worker, /context\.kind === "billing_technical"/);
  assert.match(worker, /evidence\.pon\?\.isPon/);
  assert.match(worker, /context\.olt\?\.status === "missing"/);
  assert.match(worker, /startOltWorkflow\(tab\)/);
});

test("OLT route follows page-aware order", () => {
  assert.match(worker, /stage = "go-billing-main"/);
  assert.match(worker, /stage = "open-userside"/);
  assert.match(worker, /stage = "find-tmc"/);
  assert.match(worker, /stage = "return-billing"/);
  assert.match(worker, /stage = "open-technical"/);
  assert.match(worker, /stage = "fill-olt"/);
  assert.match(worker, /stage = "poll-onu"/);
  assert.match(worker, /stage = "wait-poll-result"/);
});

test("foreign pages receive navigation without a highlight target", () => {
  assert.match(worker, /"navigate",\s*"billing-main",\s*""/s);
  assert.match(worker, /"navigate",\s*"return-billing",\s*""/s);
  assert.match(worker, /if \(!route\.action\.pageMatched \|\| !route\.action\.target\)/);
  assert.match(worker, /Нужный элемент находится на другой странице/);
});

test("matching pages receive exact semantic highlight targets", () => {
  assert.match(worker, /"billing-olt-field"/);
  assert.match(worker, /"billing-technical"/);
  assert.match(worker, /"billing-userside"/);
  assert.match(worker, /"userside-tmc"/);
  assert.match(worker, /proof\.poller \|\| "line"/);
});

test("content controller auto-highlights only a matched route page", () => {
  assert.match(controller, /next\.ui\?\.autoHighlight/);
  assert.match(controller, /next\.action\?\.pageMatched/);
  assert.match(controller, /next\.action\?\.target/);
  assert.match(controller, /adapter\.highlight\(current\.action\.target\)/);
  assert.match(controller, /lastAutoHighlightSignature/);
});

test("dock and full panel consume the same canonical route", () => {
  assert.match(dockUi, /__SIMNET_MENTOR_ROUTE__/);
  assert.match(dockUi, /route\.management/);
  assert.match(dockUi, /route\.action/);
  assert.match(dockUi, /data-mentor-route-command/);
  assert.match(panelSync, /SIMNET_WB_MENTOR_ROUTE_GET/);
  assert.match(panelSync, /data-canonical-route-command/);
  assert.match(panelSync, /blockForeignHighlights/);
});

test("worker and content layers load in deterministic order", () => {
  assert.match(entry, /mentor-route-worker\.js/);
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const adapter = isolated.js.indexOf("src/core-sidepanel-adapter.js");
  const controllerIndex = isolated.js.indexOf("src/mentor-route-controller.js");
  const launcher = isolated.js.indexOf("src/sidepanel-launcher.js");
  const routeUi = isolated.js.indexOf("src/dock-route-ui.js");
  assert.ok(adapter >= 0 && controllerIndex > adapter && launcher > controllerIndex && routeUi > launcher);
  assert.match(panelHtml, /live-route-sync\.js/);
});

test("route worker contains no window-only APIs", () => {
  assert.doesNotMatch(worker, /\bwindow\./);
  assert.doesNotMatch(worker, /\bdocument\./);
});
