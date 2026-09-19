const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const PROVIDERS = Object.freeze({
  groq: Object.freeze({
    label: 'Groq',
    keyField: 'groqApiKey',
    keyPlaceholder: 'gsk_…',
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    defaultModel: 'qwen/qwen3.8-27b',
    models: Object.freeze([
      ['qwen/qwen3.8-27b', 'Qwen 3.8 27B'],
      ['openai/gpt-oss-120b', 'GPT-OSS 120B'],
      ['openai/gpt-oss-20b', 'GPT-OSS 20B']
    ])
  }),
  deepseek: Object.freeze({
    label: 'DeepSeek',
    keyField: 'deepseekApiKey',
    keyPlaceholder: 'DeepSeek API key',
    modelsUrl: 'https://api.deepseek.com/models',
    defaultModel: 'deepseek-flash',
    models: Object.freeze([
      ['deepseek-flash', 'DeepSeek Flash'],
      ['deepseek-v4-pro', 'DeepSeek V4 Pro']
    ])
  })
});

const providerSelect = document.getElementById('aiProvider');
const keyInput = document.getElementById('groqApiKey');
const keyLabel = document.getElementById('apiKeyLabel');
const saveKeyButton = document.getElementById('saveKey');
const testKeyButton = document.getElementById('testKey');
const removeKeyButton = document.getElementById('removeKey');
const keyBadge = document.getElementById('keyBadge');
const keyStatus = document.getElementById('keyStatus');
const chatModel = document.getElementById('chatModel');
const saveChatModelButton = document.getElementById('saveChatModel');
const versionNode = document.getElementById('version');

if (versionNode) versionNode.textContent = `v${chrome.runtime.getManifest().version}`;

function short(value, max = 220) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? provider : 'groq';
}

function definition(provider) {
  return PROVIDERS[normalizeProvider(provider)];
}

function selectedProvider(config = {}) {
  return normalizeProvider(providerSelect?.value || config.provider);
}

function activeKey(config = {}, provider = selectedProvider(config)) {
  return String(config?.[definition(provider).keyField] || '').trim();
}

function normalizeModel(value, provider) {
  const spec = definition(provider);
  const model = String(value || '').trim();
  return spec.models.some(([id]) => id === model) ? model : spec.defaultModel;
}

async function readConfig() {
  const raw = (await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY))?.[AI_RUNTIME_CONFIG_KEY] || {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function writeConfig(patch = {}) {
  const current = await readConfig();
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  return next;
}

function renderModels(config, provider) {
  if (!chatModel) return;
  const spec = definition(provider);
  const selected = normalizeModel(config.chatModel || config.model, provider);
  chatModel.replaceChildren(...spec.models.map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  chatModel.value = selected;
}

function render(config = {}) {
  const provider = normalizeProvider(config.provider);
  const spec = definition(provider);
  const configured = Boolean(activeKey(config, provider));

  if (providerSelect) providerSelect.value = provider;
  if (keyLabel) keyLabel.textContent = `${spec.label} API key`;

  if (keyBadge && keyStatus && keyInput) {
    keyBadge.textContent = configured ? `${spec.label} настроен` : 'Не настроен';
    keyBadge.className = configured ? 'badge ok' : 'badge';
    keyStatus.textContent = configured
      ? `${spec.label} key сохранён локально. Можно проверить API без запуска AI.`
      : `${spec.label} key ещё не сохранён.`;
    keyStatus.className = configured ? 'status ok' : 'status';
    keyInput.value = '';
    keyInput.placeholder = configured ? `Новый ${spec.label} key для замены` : spec.keyPlaceholder;
  }

  renderModels(config, provider);
}

async function currentOrTypedKey(provider) {
  const typed = String(keyInput?.value || '').trim();
  if (typed) return typed;
  const current = await readConfig();
  return activeKey(current, provider);
}

async function testProviderKey(provider) {
  const spec = definition(provider);
  const apiKey = await currentOrTypedKey(provider);
  if (!apiKey) throw new Error(`Сначала вставь или сохрани ${spec.label} API key.`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(spec.modelsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const detail = short(data?.error?.message || text || response.statusText, 180);
      throw new Error(`${spec.label} HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }

    const ids = new Set(Array.isArray(data?.data) ? data.data.map(item => String(item?.id || '')).filter(Boolean) : []);
    return spec.models.map(([id]) => id).filter(model => ids.has(model));
  } finally {
    clearTimeout(timer);
  }
}

providerSelect?.addEventListener('change', async () => {
  const provider = normalizeProvider(providerSelect.value);
  const spec = definition(provider);
  const current = await readConfig();
  const next = await writeConfig({
    provider,
    chatModel: normalizeModel(current.chatModel || current.model, provider)
  });
  render(next);
  if (keyStatus) {
    keyStatus.textContent = `${spec.label} выбран как активный AI provider.`;
    keyStatus.className = 'status';
  }
});

saveKeyButton?.addEventListener('click', async () => {
  const provider = selectedProvider();
  const spec = definition(provider);
  const apiKey = String(keyInput?.value || '').trim();
  if (!apiKey) {
    keyStatus.textContent = `Вставь ${spec.label} API key.`;
    keyStatus.className = 'status bad';
    return;
  }
  if (apiKey.length < 20 || (provider === 'groq' && !apiKey.startsWith('gsk_'))) {
    keyStatus.textContent = provider === 'groq'
      ? 'Ключ не похож на Groq API key формата gsk_…'
      : 'DeepSeek API key выглядит слишком коротким.';
    keyStatus.className = 'status bad';
    return;
  }

  saveKeyButton.disabled = true;
  try {
    const next = await writeConfig({
      provider,
      [spec.keyField]: apiKey,
      chatModel: normalizeModel(chatModel?.value, provider)
    });
    render(next);
    keyStatus.textContent = `${spec.label} key сохранён локально. Теперь можно проверить API.`;
    keyStatus.className = 'status ok';
  } catch (error) {
    keyStatus.textContent = `Не удалось сохранить: ${short(error?.message || error)}`;
    keyStatus.className = 'status bad';
  } finally {
    saveKeyButton.disabled = false;
  }
});

testKeyButton?.addEventListener('click', async () => {
  const provider = selectedProvider();
  const spec = definition(provider);
  testKeyButton.disabled = true;
  keyStatus.textContent = `Проверяю ${spec.label} API…`;
  keyStatus.className = 'status';
  try {
    const available = await testProviderKey(provider);
    keyStatus.textContent = `${spec.label} API отвечает. Ключ рабочий${available.length ? ` · доступно выбранных моделей: ${available.length}` : ''}.`;
    keyStatus.className = 'status ok';
  } catch (error) {
    const message = error?.name === 'AbortError' ? `Таймаут проверки ${spec.label}.` : short(error?.message || error, 260);
    keyStatus.textContent = message;
    keyStatus.className = 'status bad';
  } finally {
    testKeyButton.disabled = false;
  }
});

removeKeyButton?.addEventListener('click', async () => {
  const provider = selectedProvider();
  const spec = definition(provider);
  if (!confirm(`Удалить локальный ${spec.label} API key из этого Chrome-профиля?`)) return;
  const current = await readConfig();
  const next = { ...current };
  delete next[spec.keyField];
  next.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  render(next);
});

saveChatModelButton?.addEventListener('click', async () => {
  const provider = selectedProvider();
  const selected = normalizeModel(chatModel?.value, provider);
  saveChatModelButton.disabled = true;
  try {
    await writeConfig({ provider, chatModel: selected });
    saveChatModelButton.textContent = 'Сохранено';
    window.setTimeout(() => { saveChatModelButton.textContent = 'Сохранить модель'; }, 1200);
  } finally {
    saveChatModelButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[AI_RUNTIME_CONFIG_KEY]) return;
  render(changes[AI_RUNTIME_CONFIG_KEY].newValue || {});
});

readConfig().then(render).catch(error => {
  if (!keyStatus) return;
  keyStatus.textContent = `Не удалось прочитать настройки: ${short(error?.message || error)}`;
  keyStatus.className = 'status bad';
});