import { readAiUsageTotals } from './usage-ledger.js';

const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const DEFAULT_MODELS = Object.freeze([
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b'
]);
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

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

function normalizeModels(value) {
  const source = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of source) {
    const model = String(item || '').trim();
    if (!model || result.includes(model)) continue;
    result.push(model);
    if (result.length >= 8) break;
  }
  return result.length ? result : [...DEFAULT_MODELS];
}

async function readConfig() {
  const raw = (await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY))?.[AI_RUNTIME_CONFIG_KEY] || {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function publicConfig(raw = {}) {
  const key = String(raw.groqApiKey || '').trim();
  return {
    configured: Boolean(key),
    chatModel: String(raw.chatModel || raw.model || DEFAULT_MODELS[0]),
    models: normalizeModels(raw.models),
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
  if (Object.prototype.hasOwnProperty.call(payload, 'groqApiKey')) {
    const key = String(payload.groqApiKey || '').trim();
    if (!key.startsWith('gsk_') || key.length < 20) {
      throw new Error('Ключ не похож на Groq API key формата gsk_…');
    }
    next.groqApiKey = key;
  }
  if (payload.chatModel) {
    const model = String(payload.chatModel || '').trim();
    if (!DEFAULT_MODELS.includes(model)) throw new Error('Неизвестная модель AI-помощника');
    next.chatModel = model;
  }
  next.models = normalizeModels(next.models);
  next.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  return publicConfig(next);
}

async function deleteKey() {
  const current = await readConfig();
  const next = { ...current };
  delete next.groqApiKey;
  next.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  return publicConfig(next);
}

async function testKey(payload = {}) {
  const current = await readConfig();
  const apiKey = String(payload.groqApiKey || current.groqApiKey || '').trim();
  if (!apiKey) throw new Error('Groq API key не настроен');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(GROQ_MODELS_URL, {
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
      const error = new Error(`Groq HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
      error.status = response.status;
      throw error;
    }
    const ids = new Set(Array.isArray(data?.data) ? data.data.map(item => String(item?.id || '')).filter(Boolean) : []);
    const availableModels = DEFAULT_MODELS.filter(model => ids.has(model));
    return {
      ok: true,
      availableModels,
      availableCount: availableModels.length,
      expectedCount: DEFAULT_MODELS.length
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Таймаут проверки Groq');
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
          : deleteKey();

  void action
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: clean(error?.message || error || 'AI runtime error', 500) }));
  return true;
});

export const AI_RUNTIME_MESSAGE_TYPES = TYPES;
