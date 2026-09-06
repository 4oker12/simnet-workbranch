// Internal Workbench AI configuration. This module must stay service-worker safe:
// no top-level await. Secrets are loaded asynchronously from chrome.storage.local
// and are never exported/logged.
const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const DEFAULT_MODEL = 'qwen/qwen3.6-27b';

export const AI_CONFIG = {
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: DEFAULT_MODEL,
  temperature: 0.2,
  maxTokens: 1200,
  timeoutMs: 45000,
  apiKey: ''
};

function applyRuntime(raw = {}) {
  const next = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  AI_CONFIG.apiKey = String(next.groqApiKey || '').trim();
  AI_CONFIG.model = String(next.chatModel || next.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return AI_CONFIG;
}

export const AI_CONFIG_READY = (() => {
  try {
    return chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY)
      .then(stored => applyRuntime(stored?.[AI_RUNTIME_CONFIG_KEY] || {}))
      .catch(() => AI_CONFIG);
  } catch {
    return Promise.resolve(AI_CONFIG);
  }
})();

try {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[AI_RUNTIME_CONFIG_KEY]) return;
    applyRuntime(changes[AI_RUNTIME_CONFIG_KEY].newValue || {});
  });
} catch {}

export async function readAiRuntimeConfig() {
  try {
    const stored = await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY);
    const raw = stored?.[AI_RUNTIME_CONFIG_KEY] || {};
    applyRuntime(raw);
    return {
      ...raw,
      groqApiKey: String(raw.groqApiKey || '').trim(),
      chatModel: String(raw.chatModel || raw.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
    };
  } catch {
    return {
      groqApiKey: String(AI_CONFIG.apiKey || '').trim(),
      chatModel: String(AI_CONFIG.model || DEFAULT_MODEL)
    };
  }
}

export const AI_RUNTIME_CONFIG_STORAGE_KEY = AI_RUNTIME_CONFIG_KEY;
