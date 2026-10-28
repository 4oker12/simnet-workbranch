'use strict';

import { buildTurnTrace, buildDecisionExport, decisionExportText, protectExport } from './trace-report.js';
import { buildTopicMap } from './topic-map.js';

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
  exportSessionJson: $('exportSessionJson'), includeSensitive: $('includeSensitive'),
  topicCards: $('topicCards'), topicTree: $('topicTree'), mapMode: $('mapMode'),
  progress: $('journalProgress'), inspector: $('inspector'), expand: $('expandInspector'),
  expandLabel: $('expandLabel'), buildId: $('buildId'), history: $('turnHistory'),
  historyCount: $('historyCount'), readTimeline: $('readTimeline'), readTurnTitle: $('readTurnTitle'),
  exportSessionTxt: $('exportSessionTxt'), exportCount: $('exportCount'),
  viewMap: $('viewMap'), viewHistory: $('viewHistory'), viewRead: $('viewRead'), viewExport: $('viewExport')
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
let activeTopic = '';
let activeEpisode = '';
let topicMapPending = false;
let selectedTurnId = '';
let journalTab = 'map';

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

function recordsForUi(state = {}) {
  const records = Array.isArray(state.turnRecords) ? [...state.turnRecords] : [];
  if (state.lastExperiment && !records.some(r => r.customerMessageId === state.lastExperiment.customerMessageId)) {
    records.push({ customerMessageId: state.lastExperiment.customerMessageId, experiment: state.lastExperiment, decision: state.lastDecision, at: state.lastExperiment.at, input: state.messages?.find(m=>m.id===state.lastExperiment.customerMessageId)?.text || '' });
  }
  return records;
}

function selectedRecord(state = {}) {
  const records = recordsForUi(state);
  return records.find(r => r.customerMessageId === selectedTurnId) || records.at(-1) || null;
}

function selectedTrace(state = {}) {
  const record = selectedRecord(state);
  return record ? buildTurnTrace(state, record) : (state.lastExperiment ? buildTurnTrace(state) : null);
}

function renderTurn(state) {
  els.turn.replaceChildren();
  if (!state?.lastExperiment) {
    els.turn.append(node('p', '', 'После первого ответа появятся смысл запроса, выбранные факты, READ, проверки и результат.'));
    els.details.textContent = '—';
    return;
  }

  const trace = selectedTrace(state);
  if (!trace) return;
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

  els.details.textContent = JSON.stringify(protectExport({
    understanding: trace.understanding,
    evidencePlan: trace.evidencePlan,
    reads: trace.reads,
    evidence: trace.evidence,
    answerControl: trace.answerControl,
    result: trace.result
  }, { includeSensitive: true }), null, 2);
}

const TOPIC_COLORS = Object.freeze({
  balance: 'balance', tariff: 'tariff', promotions: 'promotions',
  connection: 'connection', identity: 'identity', other: 'other'
});

function topicStatus(topic) {
  if (topic.status === 'error') return 'Есть ошибки READ';
  if (topic.status === 'read-ok') return 'READ выполнен';
  return 'Нет подтверждённых READ';
}

function renderTopicMap() {
  const topics = buildTopicMap(latest || {});
  els.topicCards.replaceChildren();
  els.topicTree.replaceChildren();
  els.mapMode.textContent = topicMapPending ? 'ВЫПОЛНЯЕТСЯ' : 'ПО ХОДАМ';

  if (!topics.length) {
    els.topicTree.append(node('div', 'map-empty', 'После первой реплики здесь появятся распознанные темы и наблюдаемые цепочки.'));
    return;
  }
  if (!topics.some(topic => topic.id === activeTopic)) activeTopic = topics[0].id;
  for (const topic of topics) {
    const button = node('button', 'topic-card topic-' + (TOPIC_COLORS[topic.id] || 'other') + (topic.id === activeTopic ? ' active' : ''));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(topic.id === activeTopic));
    button.setAttribute('title', topic.area);
    button.append(node('span', 'topic-card-icon', topic.icon));
    const heading = node('span', 'topic-card-text');
    heading.append(node('strong', '', topic.label), node('small', '', topic.episodes.length + ' ход(ов) · ' + topicStatus(topic)));
    button.append(heading);
    button.addEventListener('click', () => {
      activeTopic = topic.id;
      activeEpisode = '';
      renderTopicMap();
    });
    els.topicCards.append(button);
  }
  const topic = topics.find(value => value.id === activeTopic);
  if (!topic) return;
  const heading = node('div', 'topic-tree-heading');
  heading.append(node('strong', '', topic.label + ' · цепочка по диалогу'),
    node('span', 'map-source-count', topic.reads + ' вызов(ов) READ'));
  els.topicTree.append(heading);

  // Every episode is an actual Lab turn; no invented intermediate events.
  for (const episode of topic.episodes) {
    const episodeBox = node('section', 'topic-episode');
    const episodeTitle = node('button', 'topic-episode-button');
    const opened = activeEpisode === episode.id || (!activeEpisode && topic.episodes.at(-1)?.id === episode.id);
    episodeTitle.type = 'button';
    episodeTitle.setAttribute('aria-expanded', String(opened));
    episodeTitle.append(node('strong', '', 'Ход ' + episode.number),
      node('span', '', episode.input?.slice(0, 90) || 'Текст реплики отсутствует'),
      node('span', 'topic-expander', opened ? '▾' : '▸'));
    episodeTitle.addEventListener('click', () => {
      activeEpisode = opened ? '__closed__' : episode.id;
      renderTopicMap();
    });
    episodeBox.append(episodeTitle);
    if (opened) {
      const track = node('ol', 'topic-steps');
      for (const step of episode.steps) {
        const item = node('li', 'topic-step step-' + step.kind + ' state-' + step.status);
        const detail = node('details', 'topic-node');
        const summary = node('summary', 'topic-node-heading');
        summary.append(node('span', 'topic-node-name', step.label),
          node('span', 'topic-node-summary', step.summary || '—'));
        const info = node('pre', 'topic-node-details', JSON.stringify(step.detail || {}, null, 2));
        detail.append(summary, info);
        item.append(detail);
        track.append(item);
      }
      episodeBox.append(track);
    }
    els.topicTree.append(episodeBox);
  }
}

function showJournalTab(tabId) {
  journalTab = ['map','history','read','export'].includes(tabId) ? tabId : 'map';
  for (const tab of ['map','history','read','export']) {
    const button = document.getElementById('tab' + tab[0].toUpperCase() + tab.slice(1));
    const view = document.getElementById('view' + tab[0].toUpperCase() + tab.slice(1));
    if (button) button.setAttribute('aria-selected', String(tab === journalTab));
    if (view) view.hidden = tab !== journalTab;
  }
}

function renderHistory(state = {}) {
  els.history.replaceChildren();
  const records = recordsForUi(state);
  els.historyCount.textContent = records.length + ' ход(ов)';
  els.exportCount.textContent = 'В этом диалоге сохранено ' + records.length + ' завершённых ходов. История не обрезается до 24.';
  if (!records.length) {
    els.history.append(node('div', 'map-empty', 'Журнал пуст. После сообщения появится отдельная запись хода.'));
    return;
  }
  const selected = selectedRecord(state);
  const all = records.map((record, index) => ({ record, index })).reverse();
  for (const {record,index} of all) {
    const trace = buildTurnTrace(state, record);
    const failed = trace.reads.some(r => !r.ok);
    const cls = failed ? 'error' : trace.reads.length ? 'ok' : 'no-read';
    const button = node('button','turn-entry ' + cls + (selected?.customerMessageId === record.customerMessageId ? ' selected' : ''));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected?.customerMessageId === record.customerMessageId));
    button.append(node('strong', '', 'Ход #' + (index + 1) + ' · ' + (trace.at ? new Date(trace.at).toLocaleString('ru-RU') : 'время неизвестно')));
    button.append(node('span','turn-summary', trace.input || trace.understanding.intent || 'Сообщение отсутствует'));
    button.append(node('span','turn-metrics',trace.reads.length + ' инструмент(ов) · ' + (trace.result.elapsedMs ?? '—') + ' мс · ' + (failed ? 'есть ошибки' : trace.reads.length ? 'есть READ' : 'без READ')));
    button.addEventListener('click', () => {
      selectedTurnId = record.customerMessageId;
      renderHistory(latest);
      renderTurn(latest);
      renderRead(latest);
    });
    els.history.append(button);
  }
}

function renderRead(state = {}) {
  els.readTimeline.replaceChildren();
  const trace = selectedTrace(state);
  if (!trace) {
    els.readTimeline.append(node('div','map-empty','Пока не сохранено ни одного хода.'));
    return;
  }
  const records = recordsForUi(state);
  const nr = records.findIndex(r => r.customerMessageId === trace.turnId);
  els.readTurnTitle.textContent = 'Ход #' + (nr >= 0 ? nr+1 : '?');
  if (!trace.reads.length) {
    els.readTimeline.append(node('div','read-empty','В выбранном ходе зарегистрировано 0 вызовов инструментов. Это НЕ подтверждает дату списания, баланс или другие текущие факты. Смотри evidence предыдущих ходов.'));
    return;
  }
  for (const read of trace.reads) {
    const card = node('div','read-card ' + (read.ok ? 'ok' : 'error'));
    const heading = node('div','read-title');
    heading.append(node('span','',read.tool || 'Tool'),node('span','',read.ok ? 'OK' : (read.code || 'ERROR')));
    card.append(heading);
    card.append(node('div','read-subtitle','Источник: ' + (read.source || 'неизвестен') + ' · ' + (read.observedAt || 'время не указано')));
    const details = node('details');
    details.append(node('summary','','Аргументы, данные и evidence'));
    const information = protectExport({requestedBy:read.requestedBy,arguments:read.args,resultCode:read.code,result:read.data,warnings:read.warnings}, {includeSensitive:Boolean(els.includeSensitive?.checked)});
    details.append(node('pre','',JSON.stringify(information,null,2)));
    card.append(details);
    els.readTimeline.append(card);
  }
  els.readTimeline.append(node('div','hint','Число инструментов не равно числу HTTP GET. В этом журнале показываются реальные зарегистрированные tool calls; внутренние HTTP/DOM-запросы без телеметрии не выдумываются.'));
}

function render(state) {
  latest = state || {};
  renderChat(latest);
  renderTopicMap();
  renderHistory(latest);
  renderTurn(latest);
  renderRead(latest);
  showJournalTab(journalTab);
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
  topicMapPending = true;
  els.progress.hidden = false;
  renderTopicMap();
  feedback('AI анализирует обращение и выполняет необходимые READ-проверки…');
  els.input.value = '';
  // Optimistic customer bubble is not an evidence source and never persists.
  try {
    const state = await request('AI_OPERATOR_LAB_SEND', { text: message });
    selectedTurnId = '';
    render(state);
    feedback('Ход завершён. Результаты READ и используемые источники показаны справа.');
    await refreshSources();
  } catch (error) {
    els.input.value = message;
    await request('AI_OPERATOR_LAB_GET').then(render).catch(() => {});
    feedback(error.message || String(error), true);
  } finally {
    topicMapPending = false;
    els.progress.hidden = true;
    renderTopicMap();
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
    activeTopic = '';
    activeEpisode = '';
    selectedTurnId = '';
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
    turnId: mode === 'last' ? selectedRecord(latest)?.customerMessageId : undefined,
    includeSensitive: Boolean(els.includeSensitive.checked)
  });
  raw.topics = protectExport(buildTopicMap(latest).map(topic => ({
    id: topic.id, label: topic.label, status: topic.status,
    turnIds: topic.episodes.map(episode => episode.id)
  })), {includeSensitive: Boolean(els.includeSensitive.checked)});
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

document.querySelectorAll('[data-journal-tab]').forEach(button => button.addEventListener('click', () => showJournalTab(button.dataset.journalTab)));
els.expand.addEventListener('click', () => {
  const expanded = document.body.classList.toggle('inspector-expanded');
  els.expand.setAttribute('aria-pressed', String(expanded));
  els.expandLabel.textContent = expanded ? 'Обычный вид' : 'Развернуть';
  els.expand.title = expanded ? 'Вернуться к диалогу' : 'Развернуть журнал';
});
els.buildId.textContent = 'v' + chrome.runtime.getManifest().version;
els.exportSessionTxt.addEventListener('click', () => exportTrace('session', 'txt'));
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
