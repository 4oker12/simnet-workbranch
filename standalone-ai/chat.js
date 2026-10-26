'use strict';

import { buildTurnTrace, buildDecisionExport, decisionExportText } from './trace-report.js';

// This page has its own extension ID/storage. The AI logic lives in the
// shared LAB service worker and is intentionally not copied into the UI.
const $ = id => document.getElementById(id);
const els = {
  transcript: $('transcript'), input: $('customerInput'), send: $('send'),
  feedback: $('feedback'), newChat: $('newChat'), apiState: $('apiState'),
  toggle: $('settingsToggle'), settings: $('settings'), apiKey: $('apiKey'),
  model: $('model'), save: $('saveConfig'), test: $('testConfig'),
  keyHint: $('keyHint'), sources: $('sources'), turn: $('turn'), details: $('details'),
  refreshSources: $('refreshSources'), openBilling: $('openBilling'), openUserside: $('openUserside'),
  exportTurnJson: $('exportTurnJson'), exportTurnTxt: $('exportTurnTxt'),
  exportSessionJson: $('exportSessionJson'), includeSensitive: $('includeSensitive')
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

function addDecisionStep(title, body, metadata = '') {
  const card = node('div', 'step');
  const heading = node('div', 'step-title', title);
  card.append(heading, node('div', 'step-body', body || 'Нет подтверждённых данных.'));
  if (metadata) card.append(node('div', 'step-meta', metadata));
  els.turn.append(card);
}

function renderTurn(state) {
  els.turn.replaceChildren();
  if (!state?.lastExperiment) {
    els.turn.append(node('p', '', 'После первого ответа появятся смысл запроса, выбранные факты, READ, проверки и результат.'));
    els.details.textContent = '—';
    return;
  }

  const trace = buildTurnTrace(state);
  const probe = trace.understanding.probe || {};
  const required = trace.evidencePlan.requiredFacts || [];
  const requested = trace.evidencePlan.subscriberDataNeeded || [];
  const confidence = trace.understanding.confidence;
  addDecisionStep('1 · Понимание запроса', trace.understanding.intent || 'Не определено',
    'Уверенность разбора: ' + (Number.isFinite(Number(confidence)) ? Math.round(Number(confidence) * 100) + '%' : 'неизвестно'));
  const facts = required.length ? required : requested;
  addDecisionStep('2 · Какие данные нужны',
    facts.length ? facts.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') : 'Дополнительные факты явно не запрошены.',
    'Выбор фактов — план, а не подтверждение их наличия.');
  const knowledge = trace.knowledge || {};
  const articles = Array.isArray(knowledge.usedArticles) ? knowledge.usedArticles : [];
  addDecisionStep('3 · База знаний',
    articles.length ? articles.map(article => typeof article === 'string' ? article : String(article?.title || article?.id || 'статья')).join('\n') : (knowledge.skipped ? 'Не применялась.' : 'Нет использованных статей.'),
    'Справочная информация ≠ актуальное состояние абонента.');

  const reads = trace.reads || [];
  const readCard = node('div', 'step');
  readCard.append(node('div', 'step-title', '4 · Проверки READ · ' + reads.length));
  if (!reads.length) readCard.append(node('div', 'step-body', 'READ не выполнялся: данные могли не требоваться или инструмент не был вызван.'));
  for (const item of reads) {
    const el = node('div', 'trace' + (item.ok ? '' : ' failed'));
    el.append(node('strong', '', (item.ok ? 'УСПЕХ · ' : 'ОШИБКА · ') + item.tool + ' · ' + item.code));
    el.append(node('small', '', 'Источник: ' + item.source + ' · ' + (item.observedAt || 'время не указано')));
    if (item.requestedBy?.why) el.append(node('small', '', 'Зачем: ' + item.requestedBy.why));
    if (item.args && Object.keys(item.args).length) el.append(node('small', '', 'Параметры: ' + JSON.stringify(item.args)));
    if (item.warnings?.length) el.append(node('small', '', 'Примечания: ' + item.warnings.join('; ')));
    readCard.append(el);
  }
  els.turn.append(readCard);

  const failures = reads.filter(item => !item.ok);
  const successes = reads.filter(item => item.ok);
  const gate = trace.answerControl.evidenceGate;
  addDecisionStep('5 · Проверка доказательств',
    gate?.applied
      ? 'Сработало правило: ' + String(gate.reason || 'ограничение доказательств')
      : (failures.length ? failures.length + ' инструмент(ов) завершились ошибкой. Нельзя считать отсутствующие данные отрицательным фактом.' : 'Успешных READ: ' + successes.length),
    'Канонические факты и проверки релевантности доступны в экспорте.');
  addDecisionStep('6 · Финальный ответ',
    trace.result.reply || 'Ответ не сформирован.',
    'Модель: ' + trace.result.model + ' · ' + (trace.result.elapsedMs ?? '—') + ' мс · ' + reads.length + ' READ');

  els.details.textContent = JSON.stringify({
    understanding: trace.understanding,
    evidencePlan: trace.evidencePlan,
    reads: trace.reads,
    evidence: trace.evidence,
    answerControl: trace.answerControl,
    result: trace.result
  }, null, 2);
}

function render(state) {
  latest = state || {};
  renderChat(latest);
  renderTurn(latest);
}

async function refreshSources() {
  const hosts = [
    { name: 'Billing', url: 'https://admin.simnet.kiev.ua/*', alternate: 'https://admin.looknet.kiev.ua/*' },
    { name: 'UserSide', url: 'https://userside.simnet.kiev.ua/*' }
  ];
  try {
    const billingTabs = await chrome.tabs.query({ url: [hosts[0].url, hosts[0].alternate] });
    const usersideTabs = await chrome.tabs.query({ url: hosts[1].url });
    const list = [billingTabs, usersideTabs];
    els.sources.replaceChildren();
    hosts.forEach((source, i) => {
      const found = list[i] || [];
      const ready = found.length > 0;
      const card = node('div', 'source ' + (ready ? 'ready' : 'unavailable'));
      card.append(node('strong', '', source.name + ' · ' + (ready ? 'вкладка найдена' : 'нет доступной вкладки')));
      card.append(node('span', '', ready
        ? 'Обнаружено вкладок: ' + found.length + '. Вход и доступ к данным подтвердит только READ.'
        : 'Live READ не запустится. Открой ' + source.name + ' и авторизуйся в том же профиле Chrome.'));
      els.sources.append(card);
    });
  } catch (error) {
    els.sources.replaceChildren(node('div', 'source unavailable', 'Не удалось прочитать вкладки: ' + String(error?.message || error)));
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

function downloadLocalFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTrace(mode, format) {
  if (!latest?.lastExperiment) {
    feedback('Для экспорта сначала выполни хотя бы один ход.', true);
    return;
  }
  const raw = buildDecisionExport(latest, {
    mode,
    includeSensitive: Boolean(els.includeSensitive.checked)
  });
  const text = format === 'txt' ? decisionExportText(raw) : JSON.stringify(raw, null, 2) + '\n';
  const file = 'simnet-ai-' + (mode === 'session' ? 'session' : 'turn') + '-trace-' +
    new Date().toISOString().replace(/[:.]/g, '-') + '.' + (format === 'txt' ? 'txt' : 'json');
  downloadLocalFile(text, file, format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8');
  feedback('Экспорт создан локально. Перед отправкой проверь персональные данные.');
}

async function openSource(url) {
  try {
    await chrome.tabs.create({ url });
    await refreshSources();
    feedback('Открыта вкладка источника. Выполни обычную авторизацию и обнови статус.');
  } catch (error) { feedback(String(error?.message || error), true); }
}

els.exportTurnJson.addEventListener('click', () => exportTrace('last', 'json'));
els.exportTurnTxt.addEventListener('click', () => exportTrace('last', 'txt'));
els.exportSessionJson.addEventListener('click', () => exportTrace('session', 'json'));
els.refreshSources.addEventListener('click', () => void refreshSources());
els.openBilling.addEventListener('click', () => void openSource('https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl'));
els.openUserside.addEventListener('click', () => void openSource('https://userside.simnet.kiev.ua/'));

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
