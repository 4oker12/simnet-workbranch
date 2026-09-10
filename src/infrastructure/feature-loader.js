'use strict';

const FEATURE_SCRIPT_SETS = Object.freeze({
  companion: Object.freeze([
    'src/ui/operator-companion-content.js',
    'src/ui/operator-companion.js'
  ]),
  call: Object.freeze(['src/ui/call-registration.js']),
  poll: Object.freeze(['src/ui/poll-terminal.js']),
  knowledge: Object.freeze(['src/ui/knowledge-base.js'])
});

export function createFeatureLoader({ chromeApi }) {
  if (!chromeApi) throw new Error('feature-loader requires chromeApi');
  const injectedByDocument = new Map();

  function documentKey(sender, tabId) {
    const documentId = String(sender?.documentId || '').trim();
    return documentId ? `${tabId}:${documentId}` : '';
  }

  function forgetOlderDocuments(tabId, keepKey = '') {
    const prefix = `${Number(tabId)}:`;
    for (const key of injectedByDocument.keys()) {
      if (key.startsWith(prefix) && key !== keepKey) injectedByDocument.delete(key);
    }
  }

  async function inject(feature, sender, options = {}) {
    const key = String(feature || '').toLowerCase();
    const files = FEATURE_SCRIPT_SETS[key];
    if (!files?.length) throw new Error(`Unknown feature pack: ${key}`);
    const tabId = Number(sender?.tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('INJECT_FEATURE_SCRIPTS requires a content-script tab');
    if (typeof chromeApi.scripting?.executeScript !== 'function') throw new Error('chrome.scripting.executeScript unavailable');

    const force = Boolean(options?.force);
    const docKey = documentKey(sender, tabId);
    if (docKey) forgetOlderDocuments(tabId, docKey);
    const done = docKey ? (injectedByDocument.get(docKey) || new Set()) : null;

    // Never dedupe only by tabId: a tab may navigate/reload while keeping the
    // same numeric id. sender.documentId identifies the actual document. On
    // older/partial senders without documentId we intentionally inject again;
    // every feature pack has its own in-document idempotency guard.
    if (done?.has(key) && !force) {
      return { ok: true, feature: key, already: true, files: [...files], documentId: String(sender?.documentId || '') };
    }

    await chromeApi.scripting.executeScript({ target: { tabId }, files: [...files], world: 'ISOLATED' });
    if (done) {
      done.add(key);
      injectedByDocument.set(docKey, done);
    }
    return {
      ok: true,
      feature: key,
      already: false,
      forced: force,
      files: [...files],
      documentId: String(sender?.documentId || '')
    };
  }

  function disposeTab(tabId) {
    forgetOlderDocuments(Number(tabId));
  }

  return Object.freeze({ inject, disposeTab, featureSets: FEATURE_SCRIPT_SETS });
}
