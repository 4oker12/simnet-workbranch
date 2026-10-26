'use strict';

// This page has its own extension ID/storage. The AI logic lives in the
// shared LAB service worker and is intentionally not copied into the UI.
const $ = id => document.getElementById(id);
const els = {
  transcript: $('transcript'), input: $('customerInput'), send: $('send'),
  feedback: $('feedback'), newChat: $('newChat'), apiState: $('apiState'),
  toggle: $('settingsToggle'), settings: $('settings'), apiKey: $('apiKey'),
  model: $('model'), save: $('saveConfig'), test: $('testConfig'),
  keyHint: $('keyHint'), sources: $('sources'), turn: $('turn'), details: $('details')
};
const LAB_KEY = 'simnet_ai_operator_lab_v1';
const CASE_KEYS = [
  LAB_KEY,
  'simnet_ai_operator_billing_snapshots_v1',
  'simnet_ai_operator_userside_snapshots_v1',
  'simnet_crm_building_snapshot_v1'
];
let busy = false;
let configured = false;
let latest = null;

async function request(type, payload) {
  const response = await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
  if (!response?.success) throw new Error(String(response?.error || 'Фоновый AI сервис недоступен.'));
  return response.data;
}

function feedback(text, error = false) {
  els.feedback.textContent = String(text || '');
  els.feedback.className = 'feedback' + (error ? ' error' : '');
}

function locked(value) {
  busy = value;
  els.send.disabled = value || !configured;
  els.newChat.disabled = value;
  els.save.disabled = value;
  els.test.disabled = value;
  els.input.disabled = value;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function renderChat(state) {
  els.transcript.replaceChildren();
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  if (!messages.length) {
    const empty = node('div', 'empty');
    empty.append(node('strong', '', 'Диалог ещё не начат'), node('span', '', 'Например: «Здравствуйте, у меня не работает интернет».'));
    els.transcript.append(empty);
    return;
  }
  for (const message of messages) {
    const role = message.role === 'agent' ? 'agent' : 'customer';
    const container = node('div', 'bubble ' + role);
    container.append(node('div', 'meta', role === 'agent' ? 'SIMNET AI Operator' : 'Абонент'));
    container.append(node('div', 'message', message.text || ''));
    els.transcript.append(container);
  }
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function safeTraces(state) {
  const experiment = state?.lastExperiment || {};
  const variants = Array.isArray(experiment.variants) ? experiment.variants : [];
  const active = variants.find(variant => variant.label === experiment.activeVariant) || variants[0] || {};
  return Array.isArray(active.toolTrace) ? active.toolTrace : [];
}

function renderTurn(state) {
  els.turn.replaceChildren();
  const decision = state?.lastDecision || {};
  const experiment = state?.lastExperiment || {};
  if (!state?.messages?.length || !state?.lastExperiment) {
    els.turn.append(node('p', '', 'После первого ответа появится цепочка инструментов и источников.'));
    els.details.textContent = '—';
    return;
  }
  const add = value => els.turn.append(node('div', '', value));
  add('Маршрут: семантика → факты → READ → проверенный ответ');
  add('Модель: ' + String(experiment.model || decision.model || 'нет данных'));
  add('Длительность: ' + String(experiment.elapsedMs ?? '—') + ' мс');
  add('Инструменты: ' + String(experiment.toolCalls ?? 0));
  const traces = safeTraces(state);
  if (!traces.length) add('В этом ходе live-инструменты не вызывались.');
  for (const item of traces) {
    const trace = node('div', 'trace');
    trace.append(node('strong', '', (item.ok ? '✓ ' : '× ') + (item.tool || 'READ tool') + ' · ' + (item.code || (item.ok ? 'OK' : 'UNKNOWN'))));
    trace.append(node('small', '', 'Источник: ' + (item.source || item.data?.source || 'не указан')));
    els.turn.append(trace);
  }
  const failure = String(decision?.diagnostic?.error || '').slice(0, 350);
  els.details.textContent = JSON.stringify({
    action: decision.action || '',
    intent: decision.intent || '',
    confidence: decision.confidence ?? null,
    evidenceChecks: traces.map(item => ({ tool: item.tool, ok: item.ok, code: item.code, source: item.source || item.data?.source || '' })),
    degraded: Boolean(decision?.diagnostic?.degraded),
    ...(failure ? { error: failure } : {})
  }, null, 2);
}

function render(state) {
  latest = state || {};
  renderChat(latest);
  renderTurn(latest);
}

async function refreshSources() {
  try {
    const tabs = await chrome.tabs.query({});
    const urls = tabs.map(tab => String(tab.url || ''));
    const list = [
      ['Billing', urls.some(url => /^https:\/\/admin\.(?:simnet|looknet)\.kiev\.ua\//.test(url))],
      ['UserSide', urls.some(url => url.startsWith('https://userside.simnet.kiev.ua/'))]
    ];
    els.sources.replaceChildren();
    for (const [label, present] of list) {
      const source = node('div', 'source');
      source.append(node('strong', '', label), node('span', '', present ? 'Вкладка открыта · авторизацию проверит READ' : 'Вкладка не открыта · live-READ недоступен'));
      els.sources.append(source);
    }
  } catch {
    els.sources.textContent = 'Статус вкладок получить не удалось.';
  }
}

async function refreshConfig() {
  const state = await request('AI_RUNTIME_GET');
  configured = state.provider === 'deepseek' && Boolean(state.configured);
  els.model.value = state.provider === 'deepseek' && state.chatModel === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash';
  els.apiState.textContent = configured ? 'DeepSeek · подключён' : 'DeepSeek · нужен API-ключ';
  els.apiState.className = 'status-chip' + (configured ? ' ok' : '');
  els.keyHint.textContent = configured
    ? 'Ключ сохранён в хранилище этого расширения (' + (state.keyHint || 'скрыт') + ').'
    : 'Введите собственный DeepSeek API-ключ и сохраните. Ключ Workbench сюда не копируется.';
  if (!busy) els.send.disabled = !configured;
}

async function send() {
  if (busy) return;
  const message = els.input.value.trim();
  if (!message) return;
  if (!configured) {
    feedback('Сначала настрой DeepSeek API.', true);
    els.settings.hidden = false;
    els.toggle.setAttribute('aria-expanded', 'true');
    els.apiKey.focus();
    return;
  }
  locked(true);
  feedback('AI анализирует обращение и выполняет необходимые READ-проверки…');
  els.input.value = '';
  // Optimistic customer bubble is not an evidence source and never persists.
  try {
    const state = await request('AI_OPERATOR_LAB_SEND', { text: message });
    render(state);
    feedback('Ход завершён. Результаты READ и используемые источники показаны справа.');
    await refreshSources();
  } catch (error) {
    els.input.value = message;
    await request('AI_OPERATOR_LAB_GET').then(render).catch(() => {});
    feedback(error.message || String(error), true);
  } finally {
    locked(false);
    els.input.focus();
  }
}

async function newChat() {
  if (busy) return;
  locked(true);
  try {
    // LAB_RESET checks that no AI turn is in flight. Removing its stored
    // state and cached source snapshots afterwards also discards identity
    // and old subscriber evidence from previous cases.
    await request('AI_OPERATOR_LAB_RESET');
    await chrome.storage.local.remove(CASE_KEYS);
    render(await request('AI_OPERATOR_LAB_GET'));
    feedback('Создан новый чистый диалог. Настройки API сохранены.');
  } catch (error) {
    feedback(error.message || String(error), true);
  } finally {
    locked(false);
  }
}

async function saveConfig() {
  if (busy) return;
  locked(true);
  try {
    const payload = { provider: 'deepseek', chatModel: els.model.value };
    if (els.apiKey.value.trim()) payload.apiKey = els.apiKey.value.trim();
    await request('AI_RUNTIME_SAVE', payload);
    els.apiKey.value = '';
    await refreshConfig();
    feedback(configured ? 'DeepSeek подключён. Можно начинать диалог.' : 'Модель сохранена. Для начала диалога необходим API-ключ.');
  } catch (error) {
    feedback(error.message || String(error), true);
  } finally {
    locked(false);
  }
}

async function testConfig() {
  if (busy) return;
  locked(true);
  try {
    const data = await request('AI_RUNTIME_TEST', { provider: 'deepseek', ...(els.apiKey.value.trim() ? { apiKey: els.apiKey.value.trim() } : {}) });
    feedback(data.ok ? 'DeepSeek API ответил успешно. Проверен ключ, не вся цепочка диалога.' : 'Проверка ключа не пройдена.', !data.ok);
  } catch (error) {
    feedback(error.message || String(error), true);
  } finally {
    locked(false);
  }
}

els.send.addEventListener('click', () => void send());
els.input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
});
els.newChat.addEventListener('click', () => void newChat());
els.save.addEventListener('click', () => void saveConfig());
els.test.addEventListener('click', () => void testConfig());
els.toggle.addEventListener('click', () => {
  els.settings.hidden = !els.settings.hidden;
  els.toggle.setAttribute('aria-expanded', String(!els.settings.hidden));
});
locked(true);
Promise.all([refreshConfig(), request('AI_OPERATOR_LAB_GET'), refreshSources()])
  .then(([, lab]) => {
    render(lab);
    feedback(configured ? 'Готово. Чат использует изолированное состояние.' : 'Для первого запуска укажи DeepSeek API-ключ.');
  })
  .catch(error => feedback(error.message || String(error), true))
  .finally(() => locked(false));
