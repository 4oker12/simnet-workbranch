"use strict";

const CORE_STATE = "SIMNET_WB_CORE_STATE";
const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
const OPEN_PANEL = "SIMNET_WB_OPEN_SIDE_PANEL";
const GET_ACTIVE_STATE = "SIMNET_WB_GET_ACTIVE_STATE";
const SET_PANEL_MODE = "SIMNET_WB_SET_PANEL_MODE";
const PANEL_VISIBILITY = "SIMNET_WB_PANEL_VISIBILITY";
const PANEL_PORT_NAME = "SIMNET_WB_SIDE_PANEL_PORT";
const PANEL_PATH = "live-panel.html";

const snapshots = new Map();
const modes = new Map();
const normalizeMode = value => value === "quick" ? "quick" : "live";

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

  // Важно: open вызывается сразу в обработчике пользовательского клика.
  // Нельзя ставить await перед ним — Chrome может потерять user gesture.
  void configurePanel(tabId);
  const opening = chrome.sidePanel.open({ windowId });

  return opening.then(async () => {
    await setLauncherVisible(tabId, false);
    chrome.runtime.sendMessage({ type: "SIMNET_WB_PANEL_MODE_CHANGED", tabId, mode }).catch(() => {});
    return true;
  });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === CORE_STATE && Number.isInteger(sender?.tab?.id)) {
    snapshots.set(sender.tab.id, message.state || null);
    void configurePanel(sender.tab.id);
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
    void activeTab().then(tab => {
      const tabId = tab?.id;
      sendResponse({
        ok: true,
        tabId,
        mode: Number.isInteger(tabId) ? normalizeMode(modes.get(tabId)) : "live",
        state: Number.isInteger(tabId) ? (snapshots.get(tabId) || null) : null
      });
    }).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
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
