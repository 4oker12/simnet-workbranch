const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const DEFAULT_MODELS = Object.freeze([
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b'
]);
const DEFAULT_CHAT_MODEL = DEFAULT_MODELS[0];
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

const keyInput = document.getElementById('groqApiKey');
const saveKeyButton = document.getElementById('saveKey');
const testKeyButton = document.getElementById('testKey');
const removeKeyButton = document.getElementById('removeKey');
const keyBadge = document.getElementById('keyBadge');
const keyStatus = document.getElementById('keyStatus');
const chatModel = document.getElementById('chatModel');
const saveChatModelButton = document.getElementById('saveChatModel');
const modelAvailability = document.getElementById('modelAvailability');
const versionNode = document.getElementById('version');

versionNode.textContent = `v${chrome.runtime.getManifest().version}`;

function short(value, max = 220) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
    models: Array.isArray(current.models) && current.models.length ? current.models : [...DEFAULT_MODELS],
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  return next;
}

function render(config = {}) {
  const configured = Boolean(String(config.groqApiKey || '').trim());
  keyBadge.textContent = configured ? 'Ключ настроен' : 'Не настроен';
  keyBadge.className = configured ? 'badge ok' : 'badge';
  keyStatus.textContent = configured
    ? 'Groq key сохранён локально. Можно проверить доступность API без запуска AI-разбора.'
    : 'Ключ ещё не сохранён. Транскрипция Whisper работает независимо; AI-разбор остановится на TXT.';
  keyStatus.className = configured ? 'status ok' : 'status';
  keyInput.value = '';
  keyInput.placeholder = configured ? 'Новый ключ для замены текущего' : 'gsk_…';

  const selected = String(config.chatModel || config.model || DEFAULT_CHAT_MODEL);
  if (DEFAULT_MODELS.includes(selected)) chatModel.value = selected;
  else chatModel.value = DEFAULT_CHAT_MODEL;
}

async function currentOrTypedKey() {
  const typed = String(keyInput.value || '').trim();
  if (typed) return typed;
  const current = await readConfig();
  return String(current.groqApiKey || '').trim();
}

async function testGroqKey() {
  const apiKey = await currentOrTypedKey();
  if (!apiKey) throw new Error('Сначала вставь или сохрани Groq API key.');

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
      const detail = short(data?.error?.message || text || response.statusText, 180);
      throw new Error(`Groq HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }

    const ids = new Set(Array.isArray(data?.data) ? data.data.map(item => String(item?.id || '')).filter(Boolean) : []);
    const available = DEFAULT_MODELS.filter(model => ids.has(model));
    modelAvailability.textContent = `Доступно ${available.length}/${DEFAULT_MODELS.length}: ${available.length ? available.join(' → ') : 'модели из fallback-цепочки не найдены в /models'}`;
    modelAvailability.className = available.length ? 'status compact ok' : 'status compact bad';
    return available;
  } finally {
    clearTimeout(timer);
  }
}

saveKeyButton.addEventListener('click', async () => {
  const apiKey = String(keyInput.value || '').trim();
  if (!apiKey) {
    keyStatus.textContent = 'Вставь Groq API key.';
    keyStatus.className = 'status bad';
    return;
  }
  if (!apiKey.startsWith('gsk_') || apiKey.length < 20) {
    keyStatus.textContent = 'Ключ не похож на Groq API key формата gsk_…';
    keyStatus.className = 'status bad';
    return;
  }

  saveKeyButton.disabled = true;
  try {
    const next = await writeConfig({ groqApiKey: apiKey });
    render(next);
    keyStatus.textContent = 'Groq key сохранён локально. Теперь нажми «Проверить ключ».';
    keyStatus.className = 'status ok';
  } catch (error) {
    keyStatus.textContent = `Не удалось сохранить: ${short(error?.message || error)}`;
    keyStatus.className = 'status bad';
  } finally {
    saveKeyButton.disabled = false;
  }
});

testKeyButton.addEventListener('click', async () => {
  testKeyButton.disabled = true;
  keyStatus.textContent = 'Проверяю Groq API…';
  keyStatus.className = 'status';
  try {
    const available = await testGroqKey();
    keyStatus.textContent = `Groq API отвечает. Ключ рабочий${available.length ? ` · fallback-моделей доступно ${available.length}/${DEFAULT_MODELS.length}` : ''}.`;
    keyStatus.className = 'status ok';
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'Таймаут проверки Groq.' : short(error?.message || error, 260);
    keyStatus.textContent = message;
    keyStatus.className = 'status bad';
    modelAvailability.textContent = 'Проверка доступности моделей не выполнена.';
    modelAvailability.className = 'status compact bad';
  } finally {
    testKeyButton.disabled = false;
  }
});

removeKeyButton.addEventListener('click', async () => {
  if (!confirm('Удалить локальный Groq API key из этого Chrome-профиля?')) return;
  const current = await readConfig();
  const next = { ...current };
  delete next.groqApiKey;
  next.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [AI_RUNTIME_CONFIG_KEY]: next });
  render(next);
  modelAvailability.textContent = 'Доступность моделей проверится вместе с ключом.';
  modelAvailability.className = 'status compact';
});

saveChatModelButton.addEventListener('click', async () => {
  const selected = String(chatModel.value || DEFAULT_CHAT_MODEL);
  if (!DEFAULT_MODELS.includes(selected)) return;
  saveChatModelButton.disabled = true;
  try {
    await writeConfig({ chatModel: selected });
    saveChatModelButton.textContent = 'Сохранено';
    setTimeout(() => { saveChatModelButton.textContent = 'Сохранить модель'; }, 1200);
  } finally {
    saveChatModelButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[AI_RUNTIME_CONFIG_KEY]) return;
  render(changes[AI_RUNTIME_CONFIG_KEY].newValue || {});
});

readConfig().then(render).catch(error => {
  keyStatus.textContent = `Не удалось прочитать настройки: ${short(error?.message || error)}`;
  keyStatus.className = 'status bad';
});
