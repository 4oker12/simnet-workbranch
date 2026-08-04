"use strict";

const CORE_STATE = "SIMNET_WB_CORE_STATE";
const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
const OPEN_PANEL = "SIMNET_WB_OPEN_SIDE_PANEL";
const GET_ACTIVE_STATE = "SIMNET_WB_GET_ACTIVE_STATE";
const SET_PANEL_MODE = "SIMNET_WB_SET_PANEL_MODE";
const PANEL_VISIBILITY = "SIMNET_WB_PANEL_VISIBILITY";
const PANEL_PORT_NAME = "SIMNET_WB_SIDE_PANEL_PORT";
const PANEL_PATH = "live-panel.html";
const WORKFLOW_COMMAND = "SIMNET_WB_WORKFLOW_COMMAND";
const WORKFLOW_STATE = "SIMNET_WB_WORKFLOW_STATE";
const ACTIVE_TAB_CHANGED = "SIMNET_WB_ACTIVE_TAB_CHANGED";
const WORKFLOW_STORAGE_KEY = "simnet_wb_olt_workflows_v1";

const snapshots = new Map();
const modes = new Map();
let workflows = {};
let workflowsLoaded = false;
const normalizeMode = value => value === "quick" ? "quick" : "live";

const workflowReady = chrome.storage.session.get({ [WORKFLOW_STORAGE_KEY]: {} })
  .then(result => {
    workflows = result?.[WORKFLOW_STORAGE_KEY] || {};
    workflowsLoaded = true;
  })
  .catch(() => {
    workflows = {};
    workflowsLoaded = true;
  });

function enableActionOpening() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

enableActionOpening();
chrome.runtime.onInstalled.addListener(enableActionOpening);
chrome.runtime.onStartup.addListener(enableActionOpening);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function setLauncherVisible(tabId, visible) {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.tabs.sendMessage(tabId, { type: PANEL_VISIBILITY, visible: Boolean(visible) });
    return true;
  } catch (_) {
    return false;
  }
}

function configurePanel(tabId) {
  if (!Number.isInteger(tabId)) return Promise.resolve(false);
  return chrome.sidePanel
    .setOptions({ tabId, path: PANEL_PATH, enabled: true })
    .then(() => true)
    .catch(() => false);
}

function openForSender(sender, requestedMode = "live") {
  const tabId = sender?.tab?.id;
  const windowId = sender?.tab?.windowId;
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return Promise.reject(new Error("Не удалось определить вкладку браузера"));
  }

  const mode = normalizeMode(requestedMode);
  modes.set(tabId, mode);
  void configurePanel(tabId);
  const opening = chrome.sidePanel.open({ windowId });

  return opening.then(async () => {
    await setLauncherVisible(tabId, false);
    chrome.runtime.sendMessage({ type: "SIMNET_WB_PANEL_MODE_CHANGED", tabId, mode }).catch(() => {});
    return true;
  });
}

function workflowKeyFromState(state) {
  const context = state?.context || {};
  if (context.contract) return `contract:${context.contract}`;
  if (context.billingId) {
    const match = Object.values(workflows).find(item => item.billingId === context.billingId);
    if (match) return match.key;
  }
  return "";
}

function workflowFor(state, tabId = null) {
  const key = workflowKeyFromState(state);
  if (key && workflows[key]) return workflows[key];
  if (Number.isInteger(tabId)) {
    return Object.values(workflows).find(item => item.billingTabId === tabId || item.usersideTabId === tabId) || null;
  }
  return null;
}

async function persistWorkflows() {
  try {
    await chrome.storage.session.set({ [WORKFLOW_STORAGE_KEY]: workflows });
  } catch (_) {}
}

function publicWorkflow(workflow) {
  if (!workflow) return null;
  return JSON.parse(JSON.stringify(workflow));
}

function broadcastWorkflow(workflow, tabId = null) {
  chrome.runtime.sendMessage({
    type: WORKFLOW_STATE,
    tabId,
    workflow: publicWorkflow(workflow)
  }).catch(() => {});
}

function stageForContext(workflow, context) {
  if (!workflow || !context) return workflow?.stage || "idle";
  if (context.kind === "billing_technical") {
    if (context.olt?.present) return "billing_olt_ready";
    if (workflow.tmc?.found) return "billing_fill_olt";
    return "billing_olt_missing";
  }
  if (context.kind === "billing_user") return "billing_main";
  if (context.kind === "userside_customer") {
    return context.tmc?.found ? "userside_tmc_found" : "userside_tmc";
  }
  return workflow.stage || "idle";
}

async function reconcileWorkflow(tabId, windowId, state) {
  await workflowReady;
  const context = state?.context || {};
  const workflow = workflowFor(state, tabId);
  if (!workflow) return null;

  workflow.windowId = Number.isInteger(windowId) ? windowId : workflow.windowId;
  workflow.updatedAt = Date.now();
  workflow.stage = stageForContext(workflow, context);

  if (context.system === "billing") {
    workflow.billingTabId = tabId;
    workflow.billingId = context.billingId || workflow.billingId;
    workflow.contract = context.contract || workflow.contract;
    workflow.login = context.login || workflow.login;
    workflow.routes = {
      main: context.routes?.main || workflow.routes?.main || "",
      technical: context.routes?.technical || workflow.routes?.technical || "",
      userside: context.routes?.userside || workflow.routes?.userside || ""
    };
    workflow.billingOlt = context.olt || workflow.billingOlt || null;
  }

  if (context.system === "userside") {
    workflow.usersideTabId = tabId;
    workflow.customerId = context.customerId || workflow.customerId;
    if (context.tmc?.found) workflow.tmc = context.tmc;
  }

  workflows[workflow.key] = workflow;
  await persistWorkflows();
  broadcastWorkflow(workflow, tabId);
  return workflow;
}

async function startOltWorkflow(tab) {
  await workflowReady;
  const state = snapshots.get(tab.id) || null;
  const context = state?.context || {};
  if (!context.contract && !context.billingId) {
    throw new Error("Сначала открой карточку абонента Billing или UserSide");
  }

  const existing = workflowFor(state, tab.id);
  const key = existing?.key || `contract:${context.contract || `billing-${context.billingId}`}`;
  const workflow = {
    ...(existing || {}),
    key,
    type: "olt-discovery",
    active: true,
    contract: context.contract || existing?.contract || "",
    login: context.login || existing?.login || "",
    billingId: context.billingId || existing?.billingId || "",
    billingTabId: context.system === "billing" ? tab.id : existing?.billingTabId || null,
    usersideTabId: context.system === "userside" ? tab.id : existing?.usersideTabId || null,
    windowId: tab.windowId,
    routes: {
      main: context.routes?.main || existing?.routes?.main || "",
      technical: context.routes?.technical || existing?.routes?.technical || "",
      userside: context.routes?.userside || existing?.routes?.userside || ""
    },
    billingOlt: context.olt || existing?.billingOlt || null,
    tmc: context.tmc?.found ? context.tmc : existing?.tmc || null,
    stage: stageForContext(existing || { stage: "idle" }, context),
    startedAt: existing?.startedAt || Date.now(),
    updatedAt: Date.now()
  };

  workflows[key] = workflow;
  await persistWorkflows();
  broadcastWorkflow(workflow, tab.id);
  return workflow;
}

async function activateAndNavigate(tabId, windowId, url) {
  if (!Number.isInteger(tabId)) throw new Error("Исходная вкладка Billing не найдена");
  if (Number.isInteger(windowId)) {
    try { await chrome.windows.update(windowId, { focused: true }); } catch (_) {}
  }
  const update = { active: true };
  if (url) update.url = url;
  await chrome.tabs.update(tabId, update);
}

async function handleWorkflowCommand(message) {
  const tab = await activeTab();
  if (!Number.isInteger(tab?.id)) throw new Error("Активная вкладка не найдена");
  await workflowReady;

  if (message.action === "start-olt") {
    return { ok: true, workflow: publicWorkflow(await startOltWorkflow(tab)) };
  }

  const state = snapshots.get(tab.id) || null;
  const workflow = workflowFor(state, tab.id);
  if (!workflow) throw new Error("Маршрут определения OLT ещё не запущен");

  if (message.action === "billing-main") {
    workflow.stage = "opening_billing_main";
    workflows[workflow.key] = workflow;
    await persistWorkflows();
    broadcastWorkflow(workflow, tab.id);
    await activateAndNavigate(workflow.billingTabId, workflow.windowId, workflow.routes?.main || "");
    return { ok: true, workflow: publicWorkflow(workflow) };
  }

  if (message.action === "billing-technical") {
    workflow.stage = "opening_billing_technical";
    workflows[workflow.key] = workflow;
    await persistWorkflows();
    broadcastWorkflow(workflow, tab.id);
    await activateAndNavigate(workflow.billingTabId, workflow.windowId, workflow.routes?.technical || "");
    return { ok: true, workflow: publicWorkflow(workflow) };
  }

  if (message.action === "return-billing") {
    workflow.stage = workflow.tmc?.found ? "returning_billing_with_tmc" : "returning_billing";
    workflows[workflow.key] = workflow;
    await persistWorkflows();
    broadcastWorkflow(workflow, tab.id);
    await activateAndNavigate(workflow.billingTabId, workflow.windowId, workflow.routes?.main || "");
    return { ok: true, workflow: publicWorkflow(workflow) };
  }

  if (message.action === "cancel") {
    delete workflows[workflow.key];
    await persistWorkflows();
    broadcastWorkflow(null, tab.id);
    return { ok: true, workflow: null };
  }

  throw new Error("Неизвестная команда маршрута");
}

async function activePayload(tab = null) {
  const resolved = tab || await activeTab();
  const tabId = resolved?.id;
  const state = Number.isInteger(tabId) ? (snapshots.get(tabId) || null) : null;
  return {
    ok: true,
    tabId,
    mode: Number.isInteger(tabId) ? normalizeMode(modes.get(tabId)) : "live",
    state,
    workflow: publicWorkflow(workflowFor(state, tabId))
  };
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== PANEL_PORT_NAME) return;
  let connectedTabId = null;
  void activeTab().then(tab => {
    connectedTabId = Number.isInteger(tab?.id) ? tab.id : null;
    return setLauncherVisible(connectedTabId, false);
  });
  port.onDisconnect.addListener(() => {
    void setLauncherVisible(connectedTabId, true);
  });
});

chrome.tabs.onActivated.addListener(activeInfo => {
  void workflowReady.then(async () => {
    const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
    const payload = await activePayload(tab);
    chrome.runtime.sendMessage({ type: ACTIVE_TAB_CHANGED, ...payload }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === CORE_STATE && Number.isInteger(sender?.tab?.id)) {
    snapshots.set(sender.tab.id, message.state || null);
    void configurePanel(sender.tab.id);
    void reconcileWorkflow(sender.tab.id, sender.tab.windowId, message.state || null);
    chrome.runtime.sendMessage({ type: CORE_STATE, tabId: sender.tab.id, state: message.state || null }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === OPEN_PANEL) {
    openForSender(sender, message.mode)
      .then(ok => sendResponse({ ok }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === GET_ACTIVE_STATE) {
    void workflowReady
      .then(() => activePayload())
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === SET_PANEL_MODE) {
    void activeTab().then(tab => {
      if (!Number.isInteger(tab?.id)) throw new Error("Активная вкладка не найдена");
      const mode = normalizeMode(message.mode);
      modes.set(tab.id, mode);
      sendResponse({ ok: true, tabId: tab.id, mode });
    }).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === WORKFLOW_COMMAND) {
    void handleWorkflowCommand(message)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === CORE_COMMAND) {
    void activeTab().then(tab => {
      if (!Number.isInteger(tab?.id)) throw new Error("Активная вкладка не найдена");
      return chrome.tabs.sendMessage(tab.id, message);
    }).then(result => sendResponse(result || { ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  return false;
});
