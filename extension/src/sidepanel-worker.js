"use strict";

const CORE_STATE = "SIMNET_WB_CORE_STATE";
const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
const OPEN_PANEL = "SIMNET_WB_OPEN_SIDE_PANEL";
const GET_ACTIVE_STATE = "SIMNET_WB_GET_ACTIVE_STATE";
const SET_PANEL_MODE = "SIMNET_WB_SET_PANEL_MODE";

const snapshots = new Map();
const modes = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function openForSender(sender, mode = "mentor") {
  const tabId = sender?.tab?.id;
  const windowId = sender?.tab?.windowId;
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) return false;
  modes.set(tabId, mode);
  await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
  await chrome.sidePanel.open({ windowId });
  chrome.runtime.sendMessage({ type: "SIMNET_WB_PANEL_MODE_CHANGED", tabId, mode }).catch(() => {});
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === CORE_STATE && Number.isInteger(sender?.tab?.id)) {
    snapshots.set(sender.tab.id, message.state || null);
    chrome.runtime.sendMessage({
      type: CORE_STATE,
      tabId: sender.tab.id,
      state: message.state || null
    }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === OPEN_PANEL) {
    void openForSender(sender, message.mode || "mentor")
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
        mode: Number.isInteger(tabId) ? (modes.get(tabId) || "mentor") : "mentor",
        state: Number.isInteger(tabId) ? (snapshots.get(tabId) || null) : null
      });
    }).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === SET_PANEL_MODE) {
    void activeTab().then(tab => {
      if (!Number.isInteger(tab?.id)) throw new Error("Активная вкладка не найдена");
      modes.set(tab.id, message.mode || "mentor");
      sendResponse({ ok: true, tabId: tab.id });
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
