import assert from "node:assert/strict";
import fs from "node:fs/promises";

const mentorPath = new URL(
  "../extension/src/training-mentor.js",
  import.meta.url
);
const source = await fs.readFile(mentorPath, "utf8");

assert.ok(source.includes('id="dp-mentor-focus"'));
assert.ok(source.includes('id="dp-mentor-refresh"'));
assert.ok(source.includes('marker.id = "dp-mentor-target-marker"'));
assert.ok(source.includes("pointer-events:none"));
assert.ok(source.includes("function waitForPanel(attempt = 0)"));
assert.ok(source.includes("attempt >= 120"));

assert.ok(!source.includes("MutationObserver"));
assert.ok(!source.includes('document.addEventListener("click"'));
assert.ok(!source.includes("dp-mentor-callout"));
assert.ok(!source.includes("position:fixed !important"));

assert.match(
  source,
  /#dp-panel\[data-operation-mode="mentor"\][\s\S]*#dp-form[\s\S]*display:none/
);

console.log("training-mentor static tests passed");
