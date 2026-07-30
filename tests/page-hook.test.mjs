import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const hookPath = new URL(
  "../extension/src/page-hook.js",
  import.meta.url
);
const source = await fs.readFile(hookPath, "utf8");
const emitted = [];
const root = {
  dataset: {}
};

class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

class FakeXmlHttpRequest {
  open() {}

  send() {}
}

const document = {
  documentElement: root,
  addEventListener() {},
  dispatchEvent(event) {
    emitted.push(event);
    return true;
  }
};
const location = {
  hostname: "userside.simnet.kiev.ua",
  href: "https://userside.simnet.kiev.ua/map"
};
const originalFetch = async (url) => ({
  status: 200,
  ok: true,
  clone() {
    return {
      async text() {
        return JSON.stringify({
          found: true
        });
      }
    };
  },
  url
});

const context = vm.createContext({
  CustomEvent,
  JSON,
  URL,
  console,
  document,
  location,
  window: null
});
context.window = context;
context.fetch = originalFetch;
context.XMLHttpRequest = FakeXmlHttpRequest;

vm.runInContext(source, context, {
  filename: "page-hook.js"
});

assert.equal(context.__SIMNET_MAP_CAPTURE_PAGE_HOOK_V2__, true);
assert.equal(root.dataset.simnetMapCaptureHook, "1");
assert.notEqual(context.fetch, originalFetch);

await context.fetch("/map/ajax_find");
await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(emitted.length, 1);
assert.equal(emitted[0].type, "simnet-map-evidence-capture-v2");
const payload = JSON.parse(emitted[0].detail);
assert.equal(payload.transport, "fetch");
assert.equal(payload.method, "GET");
assert.equal(payload.status, 200);
assert.equal(payload.ok, true);
assert.match(payload.url, /\/map\/ajax_find$/);

console.log("page-hook tests passed");
