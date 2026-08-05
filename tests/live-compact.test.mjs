import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../extension/live-panel.html", import.meta.url), "utf8");
const compactCss = readFileSync(new URL("../extension/live-compact.css", import.meta.url), "utf8");
const sanitizer = readFileSync(new URL("../extension/src/context-sanitizer.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("live status strip is removed from visible layout", () => {
  assert.doesNotMatch(html, /<div class="status-strip">/);
  assert.match(html, /<aside class="status-strip" hidden/);
  assert.match(compactCss, /\.status-strip\{display:none!important\}/);
});

test("subscriber card keeps only compact identity and chips", () => {
  assert.match(html, /id="subscriberTitle"/);
  assert.match(html, /id="sourceBadge"/);
  assert.match(html, /id="chips"/);
  assert.match(html, /id="subscriberAvatar" hidden/);
  assert.match(html, /id="subscriberMeta" hidden/);
  assert.match(compactCss, /\.subscriber-card \.avatar\{display:none!important\}/);
  assert.match(compactCss, /\.subscriber-copy span\{display:none!important\}/);
});

test("subscriber identity sanitizer rejects billing container noise", () => {
  assert.match(sanitizer, /TECHNICAL_NOISE/);
  assert.match(sanitizer, /Autofind/);
  assert.match(sanitizer, /Reboot/);
  assert.match(sanitizer, /Запрос\\s\+OLT/);
  assert.match(sanitizer, /Администратор/);
  assert.match(sanitizer, /text\.length > 72/);
  assert.match(sanitizer, /fullName: sanitizeName/);
  assert.match(sanitizer, /address: sanitizeAddress/);
});

test("context sanitizer wraps the core before mentor evidence", () => {
  const isolated = manifest.content_scripts.find(entry => entry.world === "ISOLATED");
  const bridge = isolated.js.indexOf("src/workbench-core-bridge.js");
  const sanitizerIndex = isolated.js.indexOf("src/context-sanitizer.js");
  const evidence = isolated.js.indexOf("src/mentor-evidence.js");
  assert.ok(sanitizerIndex > bridge);
  assert.ok(evidence > sanitizerIndex);
});
