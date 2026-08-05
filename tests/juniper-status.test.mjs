import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evidence = readFileSync(new URL("../extension/src/mentor-evidence.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../extension/src/core-sidepanel-adapter.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("../extension/live-panel.js", import.meta.url), "utf8");

test("Juniper exact status selector is the primary source", () => {
  assert.match(evidence, /JUNIPER_STATUS_SELECTOR/);
  assert.match(evidence, /#maindiv > table:nth-child\(2\).*li:nth-child\(4\)/);
  assert.match(evidence, /function exactJuniperStatus\(\)/);
  assert.match(evidence, /if \(exact\.status === "active" \|\| exact\.status === "absent"\)/);
});

test("online resolves the session checkpoint as active", () => {
  assert.match(evidence, /\\bonline\\b/i);
  assert.match(evidence, /status: exact\.status/);
  assert.match(evidence, /active: exact\.status === "active"/);
  assert.match(evidence, /resolved: true/);
  assert.match(evidence, /Juniper: статус online/);
});

test("offline resolves the check but emits a critical warning", () => {
  assert.match(evidence, /\\boffline\\b/i);
  assert.match(evidence, /absent: exact\.status === "absent"/);
  assert.match(evidence, /title: "Juniper: статус offline"/);
  assert.match(evidence, /severity: "critical"/);
  assert.match(evidence, /Причина ещё не установлена/);
  assert.match(evidence, /target: "session-status"/);
});

test("offline is rendered as attention rather than a green check", () => {
  assert.match(panel, /attention: session\.status === "absent"/);
  assert.match(panel, /const marker = step\.attention \? "!" : step\.complete \? "✓"/);
});

test("session status highlight uses the exact Juniper status node", () => {
  assert.match(adapter, /juniperStatus:/);
  assert.match(adapter, /kind === "session-status"/);
  assert.match(adapter, /exactOrFallback\(\s*"juniperStatus"/);
});
