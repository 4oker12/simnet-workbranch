// Internal Workbench AI configuration. This module must stay service-worker safe:
// no top-level await. Secrets are loaded asynchronously from chrome.storage.local
// and are never exported/logged.
const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const DEFAULT_PROVIDER = 'groq';
const PROVIDERS = Object.freeze({
  groq: Object.freeze({
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'qwen/qwen3.8-27b',
    models: Object.freeze([
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b'
    ])
  }),
  deepseek: Object.freeze({
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    models: Object.freeze([
      'deepseek-flash',
      'deepseek-v4-pro'
    ])
  })
});
const RETIRED_MODELS = new Set(['qwen/qwen3.6-27b']);

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? provider : DEFAULT_PROVIDER;
}

function providerDefinition(provider) {
  return PROVIDERS[normalizeProvider(provider)];
}

function normalizeModel(value, provider = DEFAULT_PROVIDER) {
  const definition = providerDefinition(provider);
  const model = String(value || '').trim();
  if (!model || RETIRED_MODELS.has(model) || !definition.models.includes(model)) return definition.defaultModel;
  return model;
}

function keyForProvider(raw = {}, provider = DEFAULT_PROVIDER) {
  const normalized = normalizeProvider(provider);
  if (normalized === 'deepseek') return String(raw.deepseekApiKey || '').trim();
  return String(raw.groqApiKey || '').trim();
}

export const AI_CONFIG = {
  provider: DEFAULT_PROVIDER,
  baseUrl: PROVIDERS[DEFAULT_PROVIDER].baseUrl,
  model: PROVIDERS[DEFAULT_PROVIDER].defaultModel,
  temperature: 0.2,
  maxTokens: 1200,
  timeoutMs: 45000,
  apiKey: ''
};

function applyRuntime(raw = {}) {
  const next = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const provider = normalizeProvider(next.provider);
  const definition = providerDefinition(provider);
  AI_CONFIG.provider = provider;
  AI_CONFIG.baseUrl = definition.baseUrl;
  AI_CONFIG.apiKey = keyForProvider(next, provider);
  AI_CONFIG.model = normalizeModel(next.chatModel || next.model, provider);
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
    const provider = normalizeProvider(raw.provider);
    const apiKey = keyForProvider(raw, provider);
    return {
      ...raw,
      provider,
      apiKey,
      // Compatibility alias: existing reasoning modules still read groqApiKey.
      // It intentionally points to the ACTIVE provider key and never gets persisted.
      groqApiKey: apiKey,
      chatModel: normalizeModel(raw.chatModel || raw.model, provider),
      baseUrl: providerDefinition(provider).baseUrl
    };
  } catch {
    return {
      provider: AI_CONFIG.provider,
      apiKey: String(AI_CONFIG.apiKey || '').trim(),
      groqApiKey: String(AI_CONFIG.apiKey || '').trim(),
      chatModel: normalizeModel(AI_CONFIG.model, AI_CONFIG.provider),
      baseUrl: AI_CONFIG.baseUrl
    };
  }
}

export function aiProviderDefinition(provider = DEFAULT_PROVIDER) {
  const normalized = normalizeProvider(provider);
  const definition = providerDefinition(normalized);
  return {
    provider: normalized,
    baseUrl: definition.baseUrl,
    defaultModel: definition.defaultModel,
    models: [...definition.models]
  };
}

export const AI_PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));
export const AI_RUNTIME_CONFIG_STORAGE_KEY = AI_RUNTIME_CONFIG_KEY;
