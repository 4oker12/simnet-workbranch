import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../extension/manifest.json", import.meta.url);
const extensionUrl = new URL("../extension/", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("Manifest V3 references existing local scripts and only approved hosts", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
  const packageJson = JSON.parse(await fs.readFile(packageUrl, "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.version, manifest.version);
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["storage", "unlimitedStorage"]
  );

  const approvedHosts = [
    "http://admin.looknet.kiev.ua/*",
    "https://admin.looknet.kiev.ua/*",
    "https://admin.simnet.kiev.ua/*",
    "https://userside.simnet.kiev.ua/*"
  ];
  assert.deepEqual([...manifest.host_permissions].sort(), approvedHosts);

  const scripts = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((entry) => entry.js)
  ];

  for (const script of new Set(scripts)) {
    const stat = await fs.stat(new URL(script, extensionUrl));
    assert.ok(stat.isFile(), `manifest script is missing: ${script}`);
  }
});
