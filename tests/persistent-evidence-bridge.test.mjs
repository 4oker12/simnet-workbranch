import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/src/persistent-evidence-bridge.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const scripts = manifest.content_scripts.at(-1).js;
const STORAGE_KEY = "simnet_wb_verified_evidence_v2";

const clone = value => structuredClone(value);
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));

function stateWith(session, line = { polled: false }, kind = "billing_juniper") {
  return {
    context: {
      hostname: "admin.simnet.kiev.ua",
      billingId: "11051",
      contract: "abon110510",
      kind
    },
    evidence: { session, line },
    checkpoints: {
      juniperOpened: Boolean(session?.opened),
      sessionResolved: Boolean(session?.resolved),
      sessionActive: session?.status === "active",
      onuPolled: Boolean(line?.polled)
    },
    alerts: []
  };
}

const activeSession = {
  status: "active",
  opened: true,
  loaded: true,
  resolved: true,
  active: true,
  absent: false,
  ip: "10.7.18.56",
  mac: "C0:25:2F:CC:D7:C9",
  source: "Juniper NEW: точное поле статуса",
  summary: "Juniper: статус online"
};

const unopenedSession = {
  status: "unopened",
  opened: false,
  loaded: false,
  resolved: false,
  active: false,
  absent: false,
  source: "",
  summary: "Juniper ещё не открыт"
};

const absentSession = {
  status: "absent",
  opened: true,
  loaded: true,
  resolved: true,
  active: false,
  absent: true,
  source: "Juniper NEW: точное поле статуса",
  summary: "Juniper: статус offline"
};

async function boot(initialState, backing = {}) {
  let rawState = clone(initialState);
  let baseListener = null;
  const storageListeners = [];

  const storageArea = {
    async get(defaults) {
      const result = {};
      for (const [key, fallback] of Object.entries(defaults || {})) {
        result[key] = Object.prototype.hasOwnProperty.call(backing, key)
          ? clone(backing[key])
          : clone(fallback);
      }
      return result;
    },
    async set(values) {
      for (const [key, value] of Object.entries(values || {})) {
        const oldValue = Object.prototype.hasOwnProperty.call(backing, key) ? clone(backing[key]) : undefined;
        backing[key] = clone(value);
        const change = { [key]: { oldValue, newValue: clone(value) } };
        for (const listener of storageListeners) listener(change, "session");
      }
    }
  };

  const context = {
    console,
    Date,
    JSON,
    Math,
    Promise,
    structuredClone,
    setTimeout,
    clearTimeout,
    location: { hostname: "admin.simnet.kiev.ua" },
    chrome: {
      storage: {
        session: storageArea,
        local: storageArea,
        onChanged: { addListener(listener) { storageListeners.push(listener); } }
      }
    },
    __SIMNET_WORKBENCH_CORE__: {
      version: "test",
      getState() { return clone(rawState); },
      subscribe(listener) {
        baseListener = listener;
        listener(clone(rawState));
        return () => { baseListener = null; };
      }
    }
  };
  context.window = context;
  context.globalThis = context;
  context.window.top = context;
  context.window.self = context;
  context.window.addEventListener = () => {};

  vm.createContext(context);
  vm.runInContext(source, context, { filename: "persistent-evidence-bridge.js" });
  await sleep(10);

  return {
    core: context.__SIMNET_WORKBENCH_CORE__,
    bridge: context.__SIMNET_PERSISTENT_EVIDENCE_BRIDGE__,
    backing,
    setRaw(nextState) {
      rawState = clone(nextState);
      baseListener?.(clone(rawState));
    }
  };
}

test("persistent evidence wraps the core before Dock and side-panel adapters", () => {
  const onuIndex = scripts.indexOf("src/onu-evidence.js");
  const persistentIndex = scripts.indexOf("src/persistent-evidence-bridge.js");
  const adapterIndex = scripts.indexOf("src/core-sidepanel-adapter.js");
  const launcherIndex = scripts.indexOf("src/sidepanel-launcher.js");
  assert.ok(onuIndex >= 0);
  assert.ok(persistentIndex > onuIndex);
  assert.ok(adapterIndex > persistentIndex);
  assert.ok(launcherIndex > persistentIndex);
});

test("ONU poll cannot replace a verified Juniper status with unopened", async () => {
  const environment = await boot(stateWith(activeSession));
  assert.equal(environment.core.getState().evidence.session.status, "active");

  environment.setRaw(stateWith(unopenedSession, { polled: true, problem: false }, "billing_onu"));
  const merged = environment.core.getState();

  assert.equal(merged.evidence.session.status, "active");
  assert.equal(merged.evidence.session.cached, true);
  assert.equal(merged.checkpoints.sessionResolved, true);
  assert.equal(merged.checkpoints.sessionActive, true);
  assert.equal(merged.checkpoints.onuPolled, true);
});

test("a new exact Juniper offline result overrides the saved online result", async () => {
  const environment = await boot(stateWith(activeSession));
  environment.setRaw(stateWith(absentSession));
  const merged = environment.core.getState();

  assert.equal(merged.evidence.session.status, "absent");
  assert.notEqual(merged.evidence.session.cached, true);
  assert.equal(merged.checkpoints.sessionResolved, true);
  assert.equal(merged.checkpoints.sessionActive, false);
  assert.ok(merged.alerts.some(alert => alert.id === "session-absent"));
});

test("verified Juniper evidence survives a content-script reload", async () => {
  const backing = {};
  const firstPage = await boot(stateWith(activeSession), backing);
  firstPage.core.getState();
  await sleep(120);
  assert.ok(backing[STORAGE_KEY]);

  const secondPage = await boot(
    stateWith(unopenedSession, { polled: true, problem: false }, "billing_onu"),
    backing
  );
  const merged = secondPage.core.getState();

  assert.equal(merged.evidence.session.status, "active");
  assert.equal(merged.evidence.session.cached, true);
});

test("async storage loading cannot overwrite a freshly parsed Juniper result", async () => {
  const staleRecord = {
    version: 1,
    aliases: ["contract:abon110510", "billing:admin.simnet.kiev.ua:11051"],
    session: { evidence: absentSession, observedAt: Date.now(), sourcePage: "billing_juniper" }
  };
  const backing = {
    [STORAGE_KEY]: {
      "contract:abon110510": staleRecord,
      "billing:admin.simnet.kiev.ua:11051": staleRecord
    }
  };

  const environment = await boot(stateWith(activeSession), backing);
  await sleep(20);
  const merged = environment.core.getState();

  assert.equal(merged.evidence.session.status, "active");
  assert.notEqual(merged.evidence.session.cached, true);
});
