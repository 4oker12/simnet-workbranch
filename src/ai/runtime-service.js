import { readAiUsageTotals } from './usage-ledger.js';

const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const PROVIDERS = Object.freeze({
  groq: Object.freeze({
    id: 'groq',
    label: 'Groq',
    keyField: 'groqApiKey',
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    defaultModel: 'qwen/qwen3.8-27b',
    models: Object.freeze(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  }),
  deepseek: Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    keyField: 'deepseekApiKey',
    modelsUrl: 'https://api.deepseek.com/models',
    defaultModel: 'deepseek-flash',
    models: Object.freeze(['deepseek-flash', 'deepseek-v4-pro'])
  })
});

const TYPES = Object.freeze({
  GET: 'AI_RUNTIME_GET',
  SAVE: 'AI_RUNTIME_SAVE',
  TEST: 'AI_RUNTIME_TEST',
  DELETE_KEY: 'AI_RUNTIME_DELETE_KEY',
  OPEN_SETTINGS: 'AI_RUNTIME_OPEN_SETTINGS'
});

function clean(value, max = 280) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? provider : 'groq';
}

function providerDefinition(value) {
  return PROVIDERS[normalizeProvider(value)];
}

function normalizeModel(value, provider) {
  const definition = providerDefinition(provider);
  const model = String(value || '').trim();
  return definition.models.includes(model) ? model : definition.defaultModel;
}

function keyFor(raw = {}, provider = 'groq') {
  const definition = providerDefinition(provider);
  return String(raw?.[definition.keyField] || '').trim();
}

function validateKey(provider, key) {
  const value = String(key || '').trim();
  if (!value || value.length < 20) throw new Error(`${providerDefinition(provider).label} API key выглядит слишком коротким`);
  if (provider === 'groq' && !value.startsWith('gsk_')) throw new Error('Ключ не похож на Groq API key формата gsk_…');
  return value;
}

async function readConfig() {
  const raw = (await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY))?.[AI_RUNTIME_CONFIG_KEY] || {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function publicConfig(raw = {}) {
  const provider = normalizeProvider(raw.provider);
  const definition = providerDefinition(provider);
  const key = keyFor(raw, provider);
  return {
    provider,
    providerLabel: definition.label,
    configured: Boolean(key),
    chatModel: normalizeModel(raw.chatModel || raw.model, provider),
    models: [...definition.models],
    updatedAt: String(raw.updatedAt || ''),
    keyHint: key ? `${key.slice(0, 4)}••••${key.slice(-4)}` : ''
  };
}

async function getPublicConfig() {
  const [raw, usage] = await Promise.all([
    readConfig(),
    readAiUsageTotals().catch(() => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      bySource: {}
    }))
  ]);
  return { ...publicConfig(raw), usage };
}

async function saveConfig(payload = {}) {
  const current = await readConfig();
  const next = { ...current };
  const provider = normalizeProvider(payload.provider || current.provider);
  const definition = providerDefinition(provider);
  next.provider = provider;

  const genericKeySupplied = Object.prototype.hasOwnProperty.call(payload, 'apiKey');
  const providerKeySupplied = Object.prototype.hasOwnProperty.call(payload, definition.keyField);
  if (genericKeySupplied || providerKeySupplied) {
    const key = validateKey(provider, genericKeySupplied ? payload.apiKey : payload[definition.keyField]);
    next[definition.keyField] = key;
  }

  if (payload.chatModel || normalizeProvider(current.provider) !== provider) {
    next.chatModel = normalizeModel(payload.chatModel, provider);
  } else {
    next.chatModel = normalizeModel(next.chatModel || next.model, provider);
  }

  next.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  return publicConfig(next);
}

async function deleteKey(payload = {}) {
  const current = await readConfig();
  const provider = normalizeProvider(payload.provider || current.provider);
  const next = { ...current };
  delete next[providerDefinition(provider).keyField];
  next.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  return publicConfig(next);
}

async function testKey(payload = {}) {
  const current = await readConfig();
  const provider = normalizeProvider(payload.provider || current.provider);
  const definition = providerDefinition(provider);
  const supplied = Object.prototype.hasOwnProperty.call(payload, 'apiKey') ? payload.apiKey : payload[definition.keyField];
  const apiKey = String(supplied || keyFor(current, provider) || '').trim();
  if (!apiKey) throw new Error(`${definition.label} API key не настроен`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(definition.modelsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const detail = clean(data?.error?.message || text || response.statusText, 220);
      const error = new Error(`${definition.label} HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
      error.status = response.status;
      throw error;
    }
    const ids = new Set(Array.isArray(data?.data) ? data.data.map(item => String(item?.id || '')).filter(Boolean) : []);
    const availableModels = definition.models.filter(model => ids.has(model));
    return {
      ok: true,
      provider,
      availableModels,
      availableCount: availableModels.length,
      expectedCount: definition.models.length
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Таймаут проверки ${definition.label}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function openSettings() {
  await chrome.runtime.openOptionsPage();
  return { opened: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(TYPES).includes(type)) return false;

  const payload = message?.payload || {};
  const action = type === TYPES.GET
    ? getPublicConfig()
    : type === TYPES.SAVE
      ? saveConfig(payload)
      : type === TYPES.TEST
        ? testKey(payload)
        : type === TYPES.OPEN_SETTINGS
          ? openSettings()
          : deleteKey(payload);

  void action
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: clean(error?.message || error || 'AI runtime error', 500) }));
  return true;
});

export const AI_RUNTIME_MESSAGE_TYPES = TYPES;
