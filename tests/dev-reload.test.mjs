import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const hookUrl = new URL("../extension/src/dev-reload-page-hook.js", import.meta.url);
const workbenchUrl = new URL("../extension/src/workbench.js", import.meta.url);

test("Development reload hook refreshes the page after the cross-world event", async () => {
  const source = await fs.readFile(hookUrl, "utf8");
  const listeners = new Map();
  let reloadCount = 0;
  const window = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    setTimeout(callback) {
      callback();
    },
    location: {
      reload() {
        reloadCount += 1;
      }
    }
  };

  vm.runInNewContext(source, { window });
  assert.equal(
    typeof listeners.get("simnet-workbench:dev-reload-page"),
    "function"
  );
  listeners.get("simnet-workbench:dev-reload-page")();
  assert.equal(reloadCount, 1);
});

test("Workbench exposes a one-click unpacked extension reload control", async () => {
  const source = await fs.readFile(workbenchUrl, "utf8");
  assert.ok(source.includes('id="dp-reload-extension"'));
  assert.ok(source.includes("chrome?.runtime?.getManifest"));
  assert.ok(source.includes("chrome?.runtime?.sendMessage"));
  assert.ok(source.includes("SIMNET_WB_DEV_RELOAD"));
  assert.ok(source.includes("simnet-workbench:dev-reload-page"));
});
