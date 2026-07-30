import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const workerPath = new URL(
  "../extension/src/service-worker.js",
  import.meta.url
);
const source = await fs.readFile(workerPath, "utf8");
let installedListener = null;
let messageListener = null;
const fetchCalls = [];

const chrome = {
  runtime: {
    getManifest() {
      return {
        version: "0.5.0",
        manifest_version: 3
      };
    },
    onInstalled: {
      addListener(listener) {
        installedListener = listener;
      }
    },
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      }
    }
  }
};

const context = vm.createContext({
  AbortController,
  DOMException,
  Headers,
  Set,
  URL,
  chrome,
  clearTimeout,
  console,
  fetch: async (url, options) => {
    fetchCalls.push({
      url,
      options
    });
    if (url.includes("slow-request")) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(options.signal.reason);
        }, {
          once: true
        });
      });
    }
    return {
      status: 200,
      statusText: "OK",
      url,
      headers: new Headers({
        "content-type": "text/html"
      }),
      async text() {
        return "<html>ok</html>";
      }
    };
  },
  setTimeout
});

vm.runInContext(source, context, {
  filename: "service-worker.js"
});

assert.equal(typeof installedListener, "function");
assert.equal(typeof messageListener, "function");

function send(message, senderUrl = "https://userside.simnet.kiev.ua/abon") {
  return new Promise((resolve) => {
    const sender = {
      url: senderUrl,
      tab: {
        id: 7
      }
    };
    const keepChannel = messageListener(message, sender, resolve);
    if (!keepChannel && message.type === "UNKNOWN") {
      resolve(undefined);
    }
  });
}

const info = await send({
  type: "SIMNET_WB_GET_EXTENSION_INFO"
});
assert.equal(info.ok, true);
assert.equal(info.version, "0.5.0");
assert.equal(info.manifestVersion, 3);

const allowed = await send({
  type: "SIMNET_WB_FETCH",
  requestId: "allowed",
  method: "GET",
  url: "https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl",
  timeout: 15_000,
  headers: {
    "X-Requested-With": "XMLHttpRequest",
    Cookie: "must-not-pass"
  }
});
assert.equal(allowed.ok, true);
assert.equal(allowed.status, 200);
assert.equal(allowed.responseText, "<html>ok</html>");
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].options.method, "GET");
assert.equal(fetchCalls[0].options.credentials, "include");
assert.equal(fetchCalls[0].options.headers.get("x-requested-with"), "XMLHttpRequest");
assert.equal(fetchCalls[0].options.headers.has("cookie"), false);

const allowedLooknet = await send({
  type: "SIMNET_WB_FETCH",
  requestId: "allowed-looknet",
  method: "GET",
  url: "http://admin.looknet.kiev.ua/cgi-bin/adm/adm.pl"
});
assert.equal(allowedLooknet.ok, true);
assert.equal(fetchCalls.length, 2);

const allowedLooknetHttps = await send({
  type: "SIMNET_WB_FETCH",
  requestId: "allowed-looknet-https",
  method: "GET",
  url: "https://admin.looknet.kiev.ua/cgi-bin/adm/adm.pl"
});
assert.equal(allowedLooknetHttps.ok, true);
assert.equal(fetchCalls.length, 3);

const allowedLooknetSender = await send({
  type: "SIMNET_WB_FETCH",
  requestId: "allowed-looknet-sender",
  method: "GET",
  url: "https://userside.simnet.kiev.ua/customer/tab?tab=main&id=1"
}, "https://admin.looknet.kiev.ua/cgi-bin/adm/adm.pl");
assert.equal(allowedLooknetSender.ok, true);
assert.equal(fetchCalls.length, 4);

const slowRequest = send({
  type: "SIMNET_WB_FETCH",
  requestId: "controlled-abort",
  method: "GET",
  url: "https://userside.simnet.kiev.ua/slow-request"
});
await Promise.resolve();
const abortResult = await send({
  type: "SIMNET_WB_ABORT_FETCH",
  requestId: "controlled-abort"
});
assert.equal(abortResult.ok, true);
assert.equal(abortResult.aborted, true);
const controlledAbort = await slowRequest;
assert.equal(controlledAbort.ok, false);
assert.equal(controlledAbort.aborted, true);
assert.match(controlledAbort.error, /отменён вызывающей вкладкой/);
assert.equal(fetchCalls.length, 5);

const blockedOrigin = await send({
  type: "SIMNET_WB_FETCH",
  requestId: "blocked-origin",
  method: "GET",
  url: "https://example.com/"
});
assert.equal(blockedOrigin.ok, false);
assert.match(blockedOrigin.error, /Запрещённый origin/);

const blockedMethod = await send({
  type: "SIMNET_WB_FETCH",
  requestId: "blocked-method",
  method: "POST",
  url: "https://admin.simnet.kiev.ua/"
});
assert.equal(blockedMethod.ok, false);
assert.match(blockedMethod.error, /Метод POST запрещён/);

const blockedSender = await send({
  type: "SIMNET_WB_FETCH",
  requestId: "blocked-sender",
  method: "GET",
  url: "https://admin.simnet.kiev.ua/"
}, "https://example.com/");
assert.equal(blockedSender.ok, false);
assert.match(blockedSender.error, /разрешённого Workbench origin/);

assert.equal(fetchCalls.length, 5);

console.log("service-worker tests passed");
