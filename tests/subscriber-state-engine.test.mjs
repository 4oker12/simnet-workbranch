import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../extension/src/subscriber-state-engine.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const scripts = manifest.content_scripts.at(-1).js;

test("subscriber state engine loads after the route and rollback guard", () => {
  const routeIndex = scripts.indexOf("src/basic-diagnostic-route.js");
  const guardIndex = scripts.indexOf("src/basic-route-state-guard.js");
  const engineIndex = scripts.indexOf("src/subscriber-state-engine.js");
  assert.ok(routeIndex >= 0);
  assert.ok(guardIndex > routeIndex);
  assert.ok(engineIndex > guardIndex);
});

test("stability control uses bounded T0 T1 T2 samples without an endless interval", () => {
  assert.match(source, /SAMPLE_DELAYS_MS\s*=\s*Object\.freeze\(\[0,\s*5_000,\s*60_000\]\)/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /delay === 0 \? "T0" : delay === 5_000 \? "T1" : "T2"/);
});

test("missing DOM evidence remains unknown instead of becoming a negative fact", () => {
  assert.match(source, /oltPresent:\s*null/);
  assert.match(source, /if \(oltControl\) \{/);
  assert.match(source, /if \(!meaningful\(value\)\) return previous \|\| null/);
});

test("decision engine distinguishes flapping recovery and actual faults", () => {
  assert.match(source, /code:\s*"flapping"/);
  assert.match(source, /code:\s*"temporarily-recovered"/);
  assert.match(source, /code:\s*"optical-los"/);
  assert.match(source, /code:\s*"cpe-link-down"/);
  assert.match(source, /code:\s*stable \? "line-stable" : "line-currently-ok"/);
});

test("operator action and subscriber wording are separate outputs", () => {
  assert.match(source, /operatorAction:/);
  assert.match(source, /subscriberMessage:/);
  assert.match(source, /Оператору:/);
  assert.match(source, /Абоненту:/);
});
