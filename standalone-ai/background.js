// Standalone entrypoint: deliberately does not import the Workbench background,
// content scripts, call registration, HelpCrunch automation, or action modules.
import '../src/ai/provider-router.js';
import '../src/ai/runtime-service.js';
import '../src/features/ai-operator/lab-background.js';

const CHAT_PAGE = chrome.runtime.getURL('standalone-ai/chat.html');

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === CHAT_PAGE);
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: CHAT_PAGE });
});
