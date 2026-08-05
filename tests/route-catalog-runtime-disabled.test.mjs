import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const scripts = manifest.content_scripts.flatMap(entry => entry.js || []);

test("route catalog is not injected into Billing or UserSide runtime", () => {
  assert.equal(scripts.includes("src/route-catalog-ui.js"), false);
  assert.equal(scripts.includes("src/route-registry.js"), false);
});

test("core mentor route remains enabled", () => {
  assert.equal(scripts.includes("src/mentor-route-controller.js"), true);
  assert.equal(scripts.includes("src/dock-route-ui.js"), true);
});
