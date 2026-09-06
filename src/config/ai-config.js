// Internal Workbench AI configuration. This file is background-only.
// Secrets are loaded from chrome.storage.local and are never exported/logged.
const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';

let runtime = {};
try {
  runtime = (await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY))?.[AI_RUNTIME_CONFIG_KEY] || {};
} catch {}

export const AI_CONFIG = {
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: String(runtime.chatModel || runtime.model || 'qwen/qwen3.6-27b'),
  temperature: 0.2,
  maxTokens: 1200,
  timeoutMs: 45000,
  apiKey: String(runtime.groqApiKey || '').trim()
};

try {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[AI_RUNTIME_CONFIG_KEY]) return;
    const next = changes[AI_RUNTIME_CONFIG_KEY].newValue || {};
    AI_CONFIG.apiKey = String(next.groqApiKey || '').trim();
    AI_CONFIG.model = String(next.chatModel || next.model || 'qwen/qwen3.6-27b');
  });
} catch {}

export const AI_RUNTIME_CONFIG_STORAGE_KEY = AI_RUNTIME_CONFIG_KEY;
