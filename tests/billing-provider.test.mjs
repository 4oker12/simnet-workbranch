import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const providerPath = new URL(
  "../extension/src/billing-provider.js",
  import.meta.url
);
const source = await fs.readFile(providerPath, "utf8");
const context = vm.createContext({
  URLSearchParams
});
context.globalThis = context;
vm.runInContext(source, context, {
  filename: "billing-provider.js"
});

const api = context.__SIMNET_BILLING_PROVIDER__;
assert.ok(api, "provider API was not exposed");
assert.equal(api.normalizeMode("LOOKNET"), "looknet");
assert.equal(api.normalizeMode("unexpected"), "auto");
assert.equal(api.providerForHostname("admin.simnet.kiev.ua"), "simnet");
assert.equal(api.providerForHostname("admin.looknet.kiev.ua"), "looknet");
assert.equal(api.profileForProvider("looknet").base, "https://admin.looknet.kiev.ua");
assert.notEqual(
  api.profileForProvider("simnet").ppKey,
  api.profileForProvider("looknet").ppKey,
  "Billing session keys must be isolated"
);
assert.notEqual(
  api.profileForProvider("simnet").bridgePresenceKey,
  api.profileForProvider("looknet").bridgePresenceKey,
  "Billing bridge presence keys must be isolated"
);

function billingItem(value) {
  const label = {
    textContent: "Биллинг:"
  };
  const valueNode = {
    textContent: value
  };
  return {
    children: [label, valueNode],
    querySelector(selector) {
      return selector === ".left_data" ? label : null;
    }
  };
}

function documentWith({ items = [], iframeSrc = "" } = {}) {
  return {
    querySelectorAll(selector) {
      return selector === ".item" ? items : [];
    },
    querySelector(selector) {
      if (selector !== 'iframe[src*="juniper.php"]' || !iframeSrc) return null;
      return {
        getAttribute(name) {
          return name === "src" ? iframeSrc : "";
        }
      };
    }
  };
}

assert.deepEqual(
  { ...api.detectFromDocument(documentWith({ items: [billingItem("Looknet")] })) },
  {
    provider: "looknet",
    source: "userside.billing-label"
  }
);
assert.deepEqual(
  { ...api.detectFromDocument(documentWith({ items: [billingItem("Simnet")] })) },
  {
    provider: "simnet",
    source: "userside.billing-label"
  }
);
assert.deepEqual(
  {
    ...api.detectFromDocument(documentWith({
      iframeSrc: "/juniper.php?billing_id=2&billing_uid=42"
    }))
  },
  {
    provider: "looknet",
    source: "userside.juniper.billing_id"
  }
);
assert.deepEqual(
  {
    ...api.detectFromDocument(documentWith({
      iframeSrc: "/juniper.php?billing_id=1&billing_uid=42"
    }))
  },
  {
    provider: "simnet",
    source: "userside.juniper.billing_id"
  }
);

const menuOnlyDocument = documentWith();
menuOnlyDocument.querySelectorAll = (selector) => (
  selector === "a[href]"
    ? [{ textContent: "Billing Simnet" }, { textContent: "Billing Looknet" }]
    : []
);
assert.deepEqual(
  { ...api.detectFromDocument(menuOnlyDocument) },
  {
    provider: "",
    source: "none"
  },
  "generic menu links must not influence provider detection"
);

console.log("billing-provider tests passed");
