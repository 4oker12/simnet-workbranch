import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL(
  "../extension/src/userside-task-staff-ui.js",
  import.meta.url
);

test("Integrated Userside task staff module keeps consistent source metadata", async () => {
  const source = await fs.readFile(scriptUrl, "utf8");
  const header = source.slice(0, source.indexOf("// ==/UserScript==") + 21);
  const metadataVersion = header.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
  const runtimeVersion = source.match(
    /const VERSION = ['"]([^'"]+)['"];/
  )?.[1];

  assert.equal(metadataVersion, "5.9.9-validation-layout-fix");
  assert.equal(runtimeVersion, metadataVersion);
  assert.match(header, /^\/\/ @match\s+https:\/\/userside\.simnet\.kiev\.ua\/\*$/m);
  assert.match(header, /^\/\/ @grant\s+none$/m);
  assert.ok(!header.includes("@require"));
  assert.ok(!header.includes("@connect"));
});
