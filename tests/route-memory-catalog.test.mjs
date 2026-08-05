import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const worker = read("extension/src/mentor-route-worker.js");
const controller = read("extension/src/mentor-route-controller.js");
const highlight = read("extension/src/highlight-lifecycle-fix.js");
const registry = read("extension/src/route-registry.js");
const catalog = read("extension/src/route-catalog-ui.js");
const manifest = JSON.parse(read("extension/manifest.json"));

test("mentor route persists confirmed evidence across reloads", () => {
  assert.match(worker, /simnet_wb_mentor_route_memory_v2/);
  assert.match(worker, /ROUTE_MEMORY_TTL_MS = 4 \* 60 \* 60 \* 1000/);
  assert.match(worker, /remembered\.onuPolled/);
  assert.match(worker, /memory\?\.status === "complete"/);
  assert.match(worker, /autoStartConsumed: true/);
  assert.match(worker, /remembered\?\.status === "complete"/);
  assert.match(worker, /shouldResume = remembered\?\.status === "active"/);
});

test("dismissed route highlights are acknowledged across reloads", () => {
  assert.match(controller, /simnet_wb_route_highlight_ack_v1/);
  assert.match(controller, /SIMNET_WB_HIGHLIGHT_CLEARED/);
  assert.match(controller, /acknowledgements\[signature\]/);
  assert.match(controller, /\["pointer", "escape"\]/);
  assert.match(controller, /routeSignature\(current\) !== signature/);
});

test("guided highlight is white and no longer expires after 6.8 seconds", () => {
  assert.match(highlight, /border-color:#fff!important/);
  assert.match(highlight, /background:rgba\(255,255,255,.34\)!important/);
  assert.match(highlight, /persistentHighlight/);
  assert.match(highlight, /Number\(delay\) === 6800/);
  assert.match(highlight, /SIMNET_WB_HIGHLIGHT_CLEARED/);
  assert.match(highlight, /finish\("pointer"\)/);
  assert.match(highlight, /finish\("escape"\)/);
});

test("route registry covers billing, Juniper, pollers, UserSide and logs", () => {
  for (const token of [
    "/adm.pl?a=user&id=<billing_id>",
    "/adm.pl?a=dopdata&parent_type=0",
    "juniper-status",
    "/adm.pl?a=313&<subscriber_params>",
    "/customer_list/ajax_search?search=<contract>",
    "/device/interface_mac_list?id=<oltId>",
    "/script/splunk_get.php",
    "simnet_wb_mentor_route_memory_v2"
  ]) assert.match(registry, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("route catalog renders two columns with persistent editable notes", () => {
  assert.match(catalog, /Точки маршрута \/ элемент \/ endpoint/);
  assert.match(catalog, /Мои правки/);
  assert.match(catalog, /<colgroup><col style="width:64%"><col style="width:36%"><\/colgroup>/);
  assert.match(catalog, /contenteditable="true"/);
  assert.match(catalog, /chrome\.storage\.local\.set/);
  assert.match(catalog, /CATALOG_WIDTH = 720/);
  assert.match(catalog, /data-route-catalog/);
  assert.match(catalog, /data-catalog-highlight/);
});

test("manifest loads lifecycle and catalog layers in dependency order", () => {
  const scripts = manifest.content_scripts.at(-1).js;
  const order = names => names.map(name => scripts.indexOf(name));
  const indexes = order([
    "src/core-sidepanel-adapter.js",
    "src/highlight-lifecycle-fix.js",
    "src/mentor-route-controller.js",
    "src/route-registry.js",
    "src/sidepanel-launcher.js",
    "src/route-catalog-ui.js"
  ]);
  assert.ok(indexes.every(index => index >= 0));
  assert.deepEqual(indexes, indexes.slice().sort((a, b) => a - b));
  assert.equal(manifest.version, "0.8.3");
});
