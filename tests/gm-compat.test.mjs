import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const compatPath = new URL(
  "../extension/src/gm-compat.js",
  import.meta.url
);
const source = await fs.readFile(compatPath, "utf8");
const storageData = {
  preload: {
    value: 1
  }
};
const storageListeners = [];
const runtimeMessages = [];
const fetchCalls = [];
const logMessages = [];

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

async function emitStorageChanges(changes) {
  for (const listener of storageListeners) {
    listener(changes, "local");
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const chrome = {
  storage: {
    local: {
      async get() {
        return clone(storageData);
      },
      async set(values) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = {
            oldValue: clone(storageData[key]),
            newValue: clone(value)
          };
          storageData[key] = clone(value);
        }
        await emitStorageChanges(changes);
      },
      async remove(key) {
        const oldValue = clone(storageData[key]);
        delete storageData[key];
        await emitStorageChanges({
          [key]: {
            oldValue,
            newValue: undefined
          }
        });
      }
    },
    onChanged: {
      addListener(listener) {
        storageListeners.push(listener);
      }
    }
  },
  runtime: {
    async sendMessage(message) {
      runtimeMessages.push(clone(message));
      if (message.type === "SIMNET_WB_GET_EXTENSION_INFO") {
        return {
          ok: true,
          version: "0.6.4"
        };
      }
      if (message.type === "SIMNET_WB_ABORT_FETCH") {
        return {
          ok: true,
          aborted: true
        };
      }
      if (message.type === "SIMNET_WB_FETCH") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          responseText: "background-response",
          responseHeaders: "content-type: text/plain",
          finalUrl: message.url
        };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    }
  }
};

function createElement(tagName) {
  return {
    tagName,
    dataset: {},
    style: {},
    value: "",
    textContent: "",
    setAttribute() {},
    select() {},
    remove() {}
  };
}

const context = vm.createContext({
  AbortController,
  DOMException,
  Headers,
  URL,
  chrome,
  clearTimeout,
  console: {
    log(...args) {
      logMessages.push(args);
    },
    warn(...args) {
      logMessages.push(args);
    },
    error(...args) {
      logMessages.push(args);
    }
  },
  crypto,
  document: {
    createElement,
    execCommand() {
      return true;
    },
    head: {
      append() {}
    },
    documentElement: {
      append() {}
    }
  },
  fetch: async (url, options) => {
    fetchCalls.push({
      url,
      options
    });
    return {
      status: 200,
      statusText: "OK",
      url,
      headers: new Headers({
        "content-type": "text/plain"
      }),
      async text() {
        return "same-origin-response";
      }
    };
  },
  location: {
    href: "https://userside.simnet.kiev.ua/abon",
    origin: "https://userside.simnet.kiev.ua"
  },
  navigator: {
    clipboard: {
      async writeText() {
        return true;
      }
    }
  },
  queueMicrotask,
  setTimeout,
  structuredClone
});
context.globalThis = context;
context.window = context;

vm.runInContext(source, context, {
  filename: "gm-compat.js"
});

const compat = context.__SIMNET_EXTENSION_COMPAT__;
assert.ok(compat, "compatibility layer was not exposed");
assert.equal(await compat.ready, true);
const api = compat.api;

assert.deepEqual(api.GM_getValue("preload", null), {
  value: 1
});
assert.equal(api.GM_getValue("missing", "fallback"), "fallback");

const valueEvents = [];
api.GM_addValueChangeListener("shared", (name, oldValue, newValue, remote) => {
  valueEvents.push({
    name,
    oldValue,
    newValue,
    remote
  });
});

assert.equal(await api.GM_setValue("shared", {
  value: 2
}), true);
assert.deepEqual(api.GM_getValue("shared", null), {
  value: 2
});
assert.equal(valueEvents.length, 1);
assert.equal(valueEvents[0].remote, false);

const remoteOldValue = clone(storageData.shared);
storageData.shared = {
  value: 3
};
await emitStorageChanges({
  shared: {
    oldValue: remoteOldValue,
    newValue: clone(storageData.shared)
  }
});
assert.deepEqual(api.GM_getValue("shared", null), {
  value: 3
});
assert.equal(valueEvents.length, 2);
assert.equal(valueEvents[1].remote, true);

assert.equal(await api.GM_deleteValue("shared"), true);
assert.equal(api.GM_getValue("shared", "deleted"), "deleted");
assert.equal(valueEvents.length, 3);
assert.equal(valueEvents[2].remote, false);

const sameOriginResponse = await new Promise((resolve, reject) => {
  api.GM_xmlhttpRequest({
    method: "GET",
    url: "https://userside.simnet.kiev.ua/test",
    onload: resolve,
    onerror: reject
  });
});
assert.equal(sameOriginResponse.status, 200);
assert.equal(sameOriginResponse.responseText, "same-origin-response");
assert.equal(fetchCalls.length, 1);

const crossOriginResponse = await new Promise((resolve, reject) => {
  api.GM_xmlhttpRequest({
    method: "GET",
    url: "https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl",
    onload: resolve,
    onerror: reject
  });
});
assert.equal(crossOriginResponse.status, 200);
assert.equal(crossOriginResponse.responseText, "background-response");
assert.ok(runtimeMessages.some((message) => message.type === "SIMNET_WB_FETCH"));

const looknetResponse = await new Promise((resolve, reject) => {
  api.GM_xmlhttpRequest({
    method: "GET",
    url: "https://admin.looknet.kiev.ua/cgi-bin/adm/adm.pl",
    onload: resolve,
    onerror: reject
  });
});
assert.equal(looknetResponse.status, 200);
assert.equal(looknetResponse.responseText, "background-response");
assert.ok(runtimeMessages.some(
  (message) => message.type === "SIMNET_WB_FETCH"
    && message.url.startsWith("https://admin.looknet.kiev.ua/")
));

const rejectedPost = await new Promise((resolve) => {
  api.GM_xmlhttpRequest({
    method: "POST",
    url: "https://userside.simnet.kiev.ua/test",
    onload() {
      resolve(false);
    },
    onerror(response) {
      resolve(response.statusText.includes("not allowed"));
    }
  });
});
assert.equal(rejectedPost, true);

const originalStorageSet = chrome.storage.local.set;
chrome.storage.local.set = async () => {
  throw new Error("Extension context invalidated.");
};
const errorsBeforeInvalidatedWrite = logMessages.filter(
  (args) => String(args[0]).includes("Storage write failed")
).length;
assert.equal(await api.GM_setValue("invalidated-write", 1), false);
const errorsAfterInvalidatedWrite = logMessages.filter(
  (args) => String(args[0]).includes("Storage write failed")
).length;
assert.equal(errorsAfterInvalidatedWrite, errorsBeforeInvalidatedWrite);
chrome.storage.local.set = originalStorageSet;

assert.ok(
  logMessages.some((args) => String(args[0]).includes("Storage compatibility cache ready"))
);

console.log("gm-compat tests passed");
