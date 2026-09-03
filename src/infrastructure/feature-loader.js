'use strict';

const FEATURE_SCRIPT_SETS = Object.freeze({
  companion: Object.freeze([
    'src/ui/operator-companion-content.js',
    'src/ui/operator-companion.js'
  ]),
  audit: Object.freeze(['src/audit/launcher.js']),
  call: Object.freeze(['src/ui/call-registration.js']),
  poll: Object.freeze(['src/ui/poll-terminal.js']),
  knowledge: Object.freeze(['src/ui/knowledge-base.js'])
});

export function createFeatureLoader({ chromeApi }) {
  if (!chromeApi) throw new Error('feature-loader requires chromeApi');
  const injectedByTab = new Map();

  async function inject(feature, sender, options = {}) {
    const key = String(feature || '').toLowerCase();
    const files = FEATURE_SCRIPT_SETS[key];
    if (!files?.length) throw new Error(`Unknown feature pack: ${key}`);
    const tabId = Number(sender?.tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('INJECT_FEATURE_SCRIPTS requires a content-script tab');
    if (typeof chromeApi.scripting?.executeScript !== 'function') throw new Error('chrome.scripting.executeScript unavailable');
    const force = Boolean(options?.force);
    const done = injectedByTab.get(tabId) || new Set();
    if (done.has(key) && !force) return { ok: true, feature: key, already: true, files: [...files] };
    await chromeApi.scripting.executeScript({ target: { tabId }, files: [...files], world: 'ISOLATED' });
    done.add(key);
    injectedByTab.set(tabId, done);
    return { ok: true, feature: key, already: false, forced: force, files: [...files] };
  }

  function disposeTab(tabId) {
    injectedByTab.delete(Number(tabId));
  }

  return Object.freeze({ inject, disposeTab, featureSets: FEATURE_SCRIPT_SETS });
}
