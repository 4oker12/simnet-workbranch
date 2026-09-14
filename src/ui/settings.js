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

const aiOperatorEnabled = document.getElementById('aiOperatorEnabled');
const learnFromCorrections = document.getElementById('learnFromCorrections');
const aiOperatorInboxIds = document.getElementById('aiOperatorInboxIds');
const aiOperatorChatAllowlist = document.getElementById('aiOperatorChatAllowlist');
const aiOperatorReplyStyle = document.getElementById('aiOperatorReplyStyle');
const aiOperatorMaxReplyChars = document.getElementById('aiOperatorMaxReplyChars');
const aiOperatorCustomInstructions = document.getElementById('aiOperatorCustomInstructions');
const saveAiOperatorButton = document.getElementById('saveAiOperator');
const pollAiOperatorButton = document.getElementById('pollAiOperator');
const refreshAiOperatorButton = document.getElementById('refreshAiOperator');
const clearAiCorrectionsButton = document.getElementById('clearAiCorrections');
const aiOperatorStatus = document.getElementById('aiOperatorStatus');
const aiOperatorCases = document.getElementById('aiOperatorCases');

versionNode.textContent = `v${chrome.runtime.getManifest().version}`;

function short(value, max = 220) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseIds(value) {
  return [...new Set(String(value || '')
    .split(/[\s,;]+/)
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item > 0))];
}

function setOperatorStatus(text, kind = '') {
  aiOperatorStatus.textContent = String(text || '');
  aiOperatorStatus.className = `status${kind ? ` ${kind}` : ''}`;
}

async function sendRuntimeMessage(type, payload = undefined) {
  const response = await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
  if (!response?.success) throw new Error(response?.error || 'Workbench runtime did not return success');
  return response.data;
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

function renderOperatorConfig(config = {}) {
  aiOperatorEnabled.checked = Boolean(config.enabled);
  learnFromCorrections.checked = config.learnFromCorrections !== false;
  aiOperatorInboxIds.value = Array.isArray(config.inboxIds) ? config.inboxIds.join(', ') : '1';
  aiOperatorChatAllowlist.value = Array.isArray(config.chatAllowlist) ? config.chatAllowlist.join(', ') : '';
  aiOperatorReplyStyle.value = ['compact', 'normal', 'detailed'].includes(String(config.replyStyle || ''))
    ? String(config.replyStyle)
    : 'compact';
  aiOperatorMaxReplyChars.value = Math.max(180, Math.min(1800, Number(config.maxReplyChars) || 700));
  aiOperatorCustomInstructions.value = String(config.customInstructions || '');
}

function createTextNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(text || '');
  return node;
}

function renderOperatorCases(cases = {}, feedback = []) {
  aiOperatorCases.replaceChildren();
  const feedbackCountByChat = new Map();
  for (const item of Array.isArray(feedback) ? feedback : []) {
    const id = Number(item?.chatId || 0);
    if (!id) continue;
    feedbackCountByChat.set(id, (feedbackCountByChat.get(id) || 0) + 1);
  }

  const items = Object.values(cases && typeof cases === 'object' ? cases : {})
    .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
    .slice(0, 12);

  if (!items.length) {
    aiOperatorCases.append(createTextNode('div', 'empty', 'Нет обработанных тестовых чатов.'));
    return;
  }

  for (const item of items) {
    const decision = item?.decision || {};
    const card = document.createElement('article');
    card.className = 'case-item';

    const head = document.createElement('div');
    head.className = 'case-head';
    const title = createTextNode('strong', '', `Chat #${Number(item.chatId || 0) || '?'}`);
    const meta = createTextNode(
      'span',
      'case-meta',
      `${String(decision.action || '—')} · ${String(item.domain || decision.domain || 'other')} · ${Math.round((Number(decision.confidence || 0) || 0) * 100)}%`
    );
    head.append(title, meta);
    card.append(head);

    if (item.error) card.append(createTextNode('div', 'case-error', `Ошибка: ${item.error}`));

    const clientLabel = createTextNode('div', 'mini-label', 'Клиент');
    const client = createTextNode('div', 'case-bubble customer', item.latestCustomerText || '—');
    card.append(clientLabel, client);

    const aiLabel = createTextNode('div', 'mini-label', 'AI решил');
    const aiSummary = createTextNode(
      'div',
      'case-summary',
      `${decision.tool ? `tool: ${decision.tool} · ` : ''}${decision.reason || 'без пояснения'}${decision.model ? ` · ${decision.model}` : ''}`
    );
    card.append(aiLabel, aiSummary);

    const replyLabel = createTextNode('label', 'mini-label', 'Исправь ответ');
    const correctedReply = document.createElement('textarea');
    correctedReply.rows = 4;
    correctedReply.value = String(decision.reply || '');
    correctedReply.placeholder = 'Как оператор должен был ответить клиенту';
    card.append(replyLabel, correctedReply);

    const noteLabel = createTextNode('label', 'mini-label', 'Или объясни правило');
    const note = document.createElement('textarea');
    note.rows = 2;
    note.placeholder = 'Например: не просить номер договора, если он уже есть в профиле';
    card.append(noteLabel, note);

    const footer = document.createElement('div');
    footer.className = 'case-footer';
    const savedCount = feedbackCountByChat.get(Number(item.chatId || 0)) || 0;
    const correctionBadge = createTextNode('span', 'correction-count', savedCount ? `Исправлений: ${savedCount}` : 'Исправлений нет');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'secondary compact-button';
    save.textContent = 'Запомнить исправление';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await sendRuntimeMessage('AI_OPERATOR_FEEDBACK_ADD', {
          chatId: Number(item.chatId || 0),
          customerText: String(item.latestCustomerText || ''),
          aiReply: String(decision.reply || ''),
          correctedReply: String(correctedReply.value || '').trim(),
          note: String(note.value || '').trim()
        });
        setOperatorStatus('Исправление сохранено. Оно будет добавляться в контекст следующих решений AI.', 'ok');
        await refreshOperatorState();
      } catch (error) {
        setOperatorStatus(short(error?.message || error, 320), 'bad');
      } finally {
        save.disabled = false;
      }
    });
    footer.append(correctionBadge, save);
    card.append(footer);
    aiOperatorCases.append(card);
  }
}

async function refreshOperatorState() {
  const data = await sendRuntimeMessage('AI_OPERATOR_GET');
  renderOperatorConfig(data?.config || {});
  renderOperatorCases(data?.cases || {}, data?.feedback || []);
  return data;
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

saveAiOperatorButton.addEventListener('click', async () => {
  saveAiOperatorButton.disabled = true;
  try {
    const chatAllowlist = parseIds(aiOperatorChatAllowlist.value);
    const inboxIds = parseIds(aiOperatorInboxIds.value);
    const config = await sendRuntimeMessage('AI_OPERATOR_SAVE', {
      enabled: aiOperatorEnabled.checked,
      learnFromCorrections: learnFromCorrections.checked,
      inboxIds: inboxIds.length ? inboxIds : [1],
      chatAllowlist,
      replyStyle: aiOperatorReplyStyle.value,
      maxReplyChars: Number(aiOperatorMaxReplyChars.value || 700),
      customInstructions: String(aiOperatorCustomInstructions.value || '').trim()
    });
    renderOperatorConfig(config || {});
    setOperatorStatus(
      chatAllowlist.length
        ? `Сохранено. Разрешено тестовых чатов: ${chatAllowlist.length}. SEND остаётся заблокирован.`
        : 'Сохранено, но список chat ID пуст — AI не возьмёт ни один чат.',
      chatAllowlist.length ? 'ok' : ''
    );
  } catch (error) {
    setOperatorStatus(short(error?.message || error, 320), 'bad');
  } finally {
    saveAiOperatorButton.disabled = false;
  }
});

pollAiOperatorButton.addEventListener('click', async () => {
  pollAiOperatorButton.disabled = true;
  setOperatorStatus('Читаю разрешённые HelpCrunch-чаты и вызываю Groq…');
  try {
    const result = await sendRuntimeMessage('AI_OPERATOR_POLL_ONCE');
    const processed = Array.isArray(result?.processed) ? result.processed : [];
    const summary = processed.length
      ? processed.map(item => `#${item.chatId}: ${item.state}`).join(' · ')
      : String(result?.state || 'ничего не обработано');
    setOperatorStatus(`Готово: ${summary}`, result?.state === 'polled' ? 'ok' : '');
    await refreshOperatorState();
  } catch (error) {
    setOperatorStatus(short(error?.message || error, 360), 'bad');
  } finally {
    pollAiOperatorButton.disabled = false;
  }
});

refreshAiOperatorButton.addEventListener('click', async () => {
  refreshAiOperatorButton.disabled = true;
  try {
    const data = await refreshOperatorState();
    const count = Object.keys(data?.cases || {}).length;
    setOperatorStatus(`Результаты обновлены. Кейсов: ${count}. Исправлений: ${(data?.feedback || []).length}.`, 'ok');
  } catch (error) {
    setOperatorStatus(short(error?.message || error, 320), 'bad');
  } finally {
    refreshAiOperatorButton.disabled = false;
  }
});

clearAiCorrectionsButton.addEventListener('click', async () => {
  if (!confirm('Очистить все сохранённые исправления поведения AI?')) return;
  clearAiCorrectionsButton.disabled = true;
  try {
    await sendRuntimeMessage('AI_OPERATOR_FEEDBACK_CLEAR');
    setOperatorStatus('Исправления очищены. Основные инструкции сохранены.', 'ok');
    await refreshOperatorState();
  } catch (error) {
    setOperatorStatus(short(error?.message || error, 320), 'bad');
  } finally {
    clearAiCorrectionsButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[AI_RUNTIME_CONFIG_KEY]) return;
  render(changes[AI_RUNTIME_CONFIG_KEY].newValue || {});
});

Promise.all([
  readConfig().then(render),
  refreshOperatorState().catch(error => setOperatorStatus(`AI operator: ${short(error?.message || error, 280)}`, 'bad'))
]).catch(error => {
  keyStatus.textContent = `Не удалось прочитать настройки: ${short(error?.message || error)}`;
  keyStatus.className = 'status bad';
});
