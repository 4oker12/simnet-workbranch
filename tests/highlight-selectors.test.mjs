import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adapter = readFileSync(new URL("../extension/src/core-sidepanel-adapter.js", import.meta.url), "utf8");

test("Billing navigation and pollers prefer exact CSS selectors", () => {
  assert.match(adapter, /const EXACT_SELECTORS = Object\.freeze/);
  assert.match(adapter, /juniperNew:/);
  assert.match(adapter, /div:nth-child\(9\) > a/);
  assert.match(adapter, /billingTechnical:/);
  assert.match(adapter, /div\.nav3 > a:nth-child\(3\)/);
  assert.match(adapter, /billingOltField:/);
  assert.match(adapter, /tr:nth-child\(6\) > td:nth-child\(2\) > div/);
  assert.match(adapter, /pollerEpon:/);
  assert.match(adapter, /div:nth-child\(4\) > a/);
  assert.match(adapter, /pollerGpon:/);
  assert.match(adapter, /div:nth-child\(5\) > a/);
  assert.match(adapter, /pollerGcom:/);
  assert.match(adapter, /div:nth-child\(6\) > a/);
  assert.match(adapter, /pollerHuawei:/);
  assert.match(adapter, /div:nth-child\(7\) > a/);
  assert.match(adapter, /function exactOrFallback\(/);
});

test("highlight frame pulses and the selected region stays bright", () => {
  assert.match(adapter, /@keyframes simnetWbPulse/);
  assert.match(adapter, /@keyframes simnetWbGroupPulse/);
  assert.match(adapter, /animation: `simnetWbPulse/);
  assert.match(adapter, /background: "rgba\(244,255,226,\.14\)"/);
  assert.match(adapter, /background: "rgba\(244,255,226,\.24\)"/);
  assert.match(adapter, /backdropFilter: "brightness\(1\.9\)/);
  assert.match(adapter, /backdropFilter: "brightness\(\.76\) saturate\(\.82\)"/);
  assert.match(adapter, /findByText/);
});
