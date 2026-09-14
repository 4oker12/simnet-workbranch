(() => {
  'use strict';

  const MESSAGE_TYPE = 'AI_OPERATOR_HC_READ';
  const ALLOWED_PATHS = [
    /^\/new-api\/agent\/chat-search\?(?:[^#]*)$/,
    /^\/new-api\/agent\/inbox(?:\/\d+)?\/unread-chats$/,
    /^\/new-api\/agent\/chat\/\d+\/messages\?(?:[^#]*)$/,
    /^\/api\/v4\/customer\/\d+\/information$/,
    /^\/new-api\/agent\/chat\/customer\/\d+\/chats\/count$/
  ];

  function allowedPath(value) {
    const path = String(value || '').trim();
    return path.startsWith('/') && ALLOWED_PATHS.some(pattern => pattern.test(path));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return false;
    const path = String(message?.path || '').trim();
    if (!allowedPath(path)) {
      sendResponse({ success: false, error: 'HelpCrunch bridge: endpoint is not allowlisted' });
      return false;
    }

    void fetch(path, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    }).then(async response => {
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) {
        throw new Error(`HelpCrunch HTTP ${response.status}${text ? ` — ${text.slice(0, 300)}` : ''}`);
      }
      sendResponse({ success: true, data, status: response.status });
    }).catch(error => {
      sendResponse({ success: false, error: String(error?.message || error || 'HelpCrunch read failed') });
    });
    return true;
  });
})();
