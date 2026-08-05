"use strict";

(() => {
  const OPEN_DOCK = "SIMNET_WB_OPEN_DOCK";

  function makeDockPrimary() {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => {});
  }

  makeDockPrimary();
  chrome.runtime.onInstalled.addListener(makeDockPrimary);
  chrome.runtime.onStartup.addListener(makeDockPrimary);

  chrome.action.onClicked.addListener(tab => {
    if (!Number.isInteger(tab?.id)) return;
    chrome.tabs
      .sendMessage(tab.id, { type: OPEN_DOCK, module: "active" })
      .catch(() => {});
  });
})();
