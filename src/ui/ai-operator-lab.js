'use strict';

(() => {
  const transcriptNode = document.getElementById('aiLabTranscript');
  const eventsNode = document.getElementById('aiLabEvents');
  const identityNode = document.getElementById('aiLabIdentity');
  const input = document.getElementById('aiLabInput');
  const sendButton = document.getElementById('aiLabSend');
  const resetButton = document.getElementById('aiLabReset');
  const downloadTxtButton = document.getElementById('aiLabDownloadTxt');
  const downloadJsonButton = document.getElementById('aiLabDownloadJson');
  const statusNode = document.getElementById('aiLabStatus');
  const quickButtons = Array.from(document.querySelectorAll('[data-ai-lab-prompt]'));
  if (!transcriptNode || !eventsNode || !identityNode || !input || !sendButton || !resetButton || !statusNode) return;

  let latestState = null;
  let busy = false;
  let controls = null;

  const KNOWLEDGE_LABELS = {
    off: 'Без энциклопедии',
    auto: 'Авто',
    on: 'С энциклопедией',
    ab: 'A/B сравнение',
    clean: 'CLEAN MODEL'
  };
  const DISPLAY_LABELS = {
    answer: 'Только ответ',
    answer_analysis: 'Ответ + разбор',
    analysis: 'Только разбор'
  };
  const SLIDERS = [
    ['confidenceStyle', 'Решительность', 'Насколько прямо формулировать рабочий вывод при достаточных основаниях.'],
    ['curiosity', 'Любопытство', 'Насколько активно замечать реально мешающие пробелы и задавать уточнения.'],
    ['initiative', 'Инициативность', 'Насколько охотно предлагать следующий разумный шаг после прямого ответа.'],
    ['skepticism', 'Скепсис к фактам', 'Насколько строго отделять слова клиента от подтверждённых данных.'],
    ['brevity', 'Краткость', 'Насколько сжимать ответ, не теряя необходимое.']
  ];

  function short(value, max = 300) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  function create(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function json(value) { try { return JSON.stringify(value ?? null, null, 2); } catch { return String(value ?? ''); } }
  function number(value) { const parsed = Number(value || 0); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
  function localTime(value) {
    const date = new Date(value || 0);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { hour12: false }) : String(value || '');
  }
  function fileStamp(value = Date.now()) {
    const date = new Date(value); const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1,)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }
  function setStatus(message, kind = '') {
    statusNode.textContent = String(message || '');
    statusNode.className = `status ai-lab-status${kind ? ` ${kind}` : ''}`;
  }
  async function runtime(type, payload = undefined) {
    const response = await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
    if (!response?.success) throw new Error(response?.error || 'Test Lab runtime did not return success');
    return response.data;
  }

  function segmented(title, values, attr) {
    const wrap = create('div', 'ai-lab-mode-row');
    wrap.append(create('div', 'ai-lab-mode-title', title));
    const group = create('div', 'ai-lab-segmented');
    for (const [value, label] of Object.entries(values)) {
      const button = create('button', 'ai-lab-segment', label);
      button.type = 'button'; button.dataset[attr] = value; group.append(button);
    }
    wrap.append(group); return wrap;
  }

  function ensureControls() {
    if (controls?.root?.isConnected) return controls;
    const root = create('section', 'ai-lab-experiment'); root.id = 'aiLabExperiment';
    const head = create('div', 'ai-lab-experiment-head');
    const titleWrap = create('div');
    titleWrap.append(create('strong', '', 'Эксперимент в реальном времени'), create('span', '', 'Меняй профиль → повторяй тот же ход → сравнивай смысл, tools и ответ.'));
    const capability = create('div', 'ai-lab-capabilities');
    head.append(titleWrap, capability);

    const modes = create('div', 'ai-lab-modes');
    const knowledge = segmented('Источник знаний', KNOWLEDGE_LABELS, 'knowledgeMode');
    const display = segmented('Показывать', DISPLAY_LABELS, 'displayMode');
    modes.append(knowledge, display);

    const sliders = create('div', 'ai-lab-sliders');
    const sliderInputs = {}; const sliderValues = {};
    for (const [key, labelText, help] of SLIDERS) {
      const row = create('label', 'ai-lab-slider'); row.title = help;
      const label = create('span', 'ai-lab-slider-label');
      label.append(create('b', '', labelText), create('small', '', help));
      const range = create('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5'; range.dataset.behaviorKey = key;
      const out = create('output', 'ai-lab-slider-value', '—');
      row.append(label, range, out); sliders.append(row); sliderInputs[key] = range; sliderValues[key] = out;
    }
    const followRow = create('label', 'ai-lab-followups'); followRow.append(create('span', '', 'Макс. уточнений за ход'));
    const followSelect = create('select');
    for (const value of [1, 2, 3]) { const option = create('option', '', String(value)); option.value = String(value); followSelect.append(option); }
    followRow.append(followSelect); sliders.append(followRow);

    const actions = create('div', 'actions ai-lab-experiment-actions');
    const repeat = create('button', 'secondary', '↻ Пересчитать последний ход'); repeat.type = 'button';
    const snapshot = create('button', 'secondary', 'Снять слепок'); snapshot.type = 'button';
    const exportSnapshots = create('button', 'secondary', 'Экспорт слепков'); exportSnapshots.type = 'button';
    const snapshotState = create('span', 'ai-lab-snapshot-state', 'Слепков: 0');
    actions.append(repeat, snapshot, exportSnapshots, snapshotState);

    const comparison = create('div', 'ai-lab-comparison'); comparison.hidden = true;
    const diagnostics = create('details', 'ai-lab-diagnostics'); diagnostics.open = true;
    diagnostics.append(create('summary', '', 'Разбор текущего хода'), create('div', 'ai-lab-diagnostics-body'));
    root.append(head, modes, sliders, actions, comparison, diagnostics);
    identityNode.insertAdjacentElement('beforebegin', root);

    controls = { root, capability, sliderInputs, sliderValues, followSelect, repeat, snapshot, exportSnapshots, snapshotState, comparison, diagnostics, diagnosticsBody: diagnostics.querySelector('.ai-lab-diagnostics-body') };
    root.querySelectorAll('[data-knowledge-mode]').forEach(button => button.addEventListener('click', () => void saveConfig({ knowledgeMode: button.dataset.knowledgeMode })));
    root.querySelectorAll('[data-display-mode]').forEach(button => button.addEventListener('click', () => void saveConfig({ displayMode: button.dataset.displayMode })));
    Object.values(sliderInputs).forEach(range => {
      range.addEventListener('input', () => { sliderValues[range.dataset.behaviorKey].textContent = range.value; });
      range.addEventListener('change', () => void saveBehavior());
    });
    followSelect.addEventListener('change', () => void saveBehavior());
    repeat.addEventListener('click', () => void repeatLast());
    snapshot.addEventListener('click', () => void takeSnapshot());
    exportSnapshots.addEventListener('click', () => exportSnapshotFile());
    return controls;
  }

  async function saveConfig(patch) {
    if (busy) return;
    try {
      const state = await runtime('AI_OPERATOR_LAB_CONFIG', patch); render(state);
      setStatus('Профиль изменён. Нажми «Пересчитать последний ход», чтобы сравнить тот же контекст.', 'ok');
    } catch (error) { setStatus(short(error?.message || error, 600), 'bad'); }
  }
  async function saveBehavior() {
    const ui = ensureControls(); const behavior = {};
    for (const [key, range] of Object.entries(ui.sliderInputs)) behavior[key] = Number(range.value);
    behavior.maxFollowUpQuestions = Number(ui.followSelect.value); await saveConfig({ behavior });
  }

  function renderControlState(state = {}) {
    const ui = ensureControls(); const mode = state.knowledgeMode || 'auto';
    ui.root.querySelectorAll('[data-knowledge-mode]').forEach(button => button.classList.toggle('active', button.dataset.knowledgeMode === mode));
    ui.root.querySelectorAll('[data-display-mode]').forEach(button => button.classList.toggle('active', button.dataset.displayMode === (state.displayMode || 'answer_analysis')));
    for (const [key, range] of Object.entries(ui.sliderInputs)) {
      const value = Number(state.behavior?.[key] ?? 50); range.value = String(value); ui.sliderValues[key].textContent = String(value);
    }
    ui.followSelect.value = String(state.behavior?.maxFollowUpQuestions || 2);
    ui.capability.replaceChildren();
    const clean = mode === 'clean';
    const caps = clean ? { billing: false, userside: false, network: false } : (state.capabilities || {});
    const badges = [
      [clean ? 'MODEL: CLEAN' : `KB: ${String(mode).toUpperCase()}`, clean ? 'off' : (mode === 'off' ? 'off' : 'on')],
      [`BILLING: ${caps.billing ? 'ON' : 'OFF'}`, caps.billing ? 'on' : 'off'],
      [`USERSIDE: ${caps.userside ? 'ON' : 'OFF'}`, caps.userside ? 'on' : 'off'],
      [`NETWORK: ${caps.network ? 'ON' : 'OFF'}`, caps.network ? 'on' : 'off']
    ];
    for (const [text, status] of badges) ui.capability.append(create('span', `ai-lab-capability ${status}`, text));
    const snapshots = Array.isArray(state.snapshots) ? state.snapshots : [];
    ui.snapshotState.textContent = snapshots.length ? `Слепков: ${snapshots.length} · последний ${localTime(snapshots.at(-1)?.at)}` : 'Слепков: 0';
    ui.repeat.disabled = busy || !state.lastTurnBase; ui.snapshot.disabled = busy || !state.lastExperiment; ui.exportSnapshots.disabled = busy || !snapshots.length;
  }

  function activeVariant(experiment = {}) {
    const variants = Array.isArray(experiment.variants) ? experiment.variants : [];
    return variants.find(item => item.label === experiment.activeVariant) || variants[0] || null;
  }
  function diagnosticRow(label, value, className = '') {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
    const row = create('div', `ai-lab-diagnostic-row ${className}`.trim());
    row.append(create('b', '', label), create('span', '', Array.isArray(value) ? value.join(' · ') : value)); return row;
  }

  function renderExperiment(state = {}) {
    const ui = ensureControls(); const exp = state.lastExperiment;
    ui.comparison.replaceChildren(); ui.comparison.hidden = true; ui.diagnosticsBody.replaceChildren();
    if (!exp) {
      ui.diagnosticsBody.append(create('div', 'ai-lab-log-empty', 'Отправь реплику — здесь появятся понимание, знания, запросы к READ-tools, результаты проверок и итоговый ответ.'));
      return;
    }
    const variants = Array.isArray(exp.variants) ? exp.variants : [];
    if (variants.length > 1) {
      ui.comparison.hidden = false; ui.comparison.append(create('div', 'ai-lab-comparison-title', 'Одна реплика · один контекст · два ответа'));
      const grid = create('div', 'ai-lab-comparison-grid');
      for (const variant of variants) {
        const card = create('div', `ai-lab-variant ${variant.useKnowledge ? 'with-kb' : 'without-kb'}`);
        const heading = create('div', 'ai-lab-variant-head');
        heading.append(create('strong', '', variant.useKnowledge ? 'С энциклопедией' : 'Без энциклопедии'), create('span', '', `tools ${number(variant.toolTrace?.length)} · ${short(variant.model, 80)}`));
        card.append(heading, create('div', 'ai-lab-variant-reply', variant.reply || '—')); grid.append(card);
      }
      ui.comparison.append(grid);
    }

    const probe = exp.analysis?.probe || {}; const knowledge = exp.analysis?.knowledge || {}; const variant = activeVariant(exp);
    const toolTrace = Array.isArray(variant?.toolTrace) ? variant.toolTrace : [];
    const relevance = variant?.answerRelevance || {};
    const rows = [
      diagnosticRow('Понял', probe.whatUserWants),
      diagnosticRow('Последняя реплика', probe.latestMessageMeans),
      diagnosticRow('Общая цель', probe.underlyingGoal),
      diagnosticRow('Незакрыто', probe.unresolvedRequests, 'warn'),
      diagnosticRow('Уверенность понимания', `${Math.round(number(probe.confidence) * 100)}%`),
      diagnosticRow('Knowledge gate', `${probe.knowledgeNeed || '—'}${probe.knowledgeReason ? ` · ${probe.knowledgeReason}` : ''}`),
      diagnosticRow('Статьи SIMNET', (knowledge.usedArticles || []).map(item => item.id)),
      diagnosticRow('Нельзя считать фактом', knowledge.mustNotAssume, 'warn'),
      diagnosticRow('Пробел KB', knowledge.knowledgeGaps, 'warn'),
      diagnosticRow('Нужны live-данные', (variant?.subscriberDataNeeded || []).map(item => `${item.system}${item.field ? ` → ${item.field}` : ''}${item.why ? `: ${item.why}` : ''}`), 'live'),
      diagnosticRow('READ-tools', toolTrace.map(item => `${item.tool} → ${item.code}${item.source ? ` [${item.source}]` : ''}`), 'live'),
      diagnosticRow('Подтверждено tools', toolTrace.filter(item => item.ok).map(item => item.tool), 'live'),
      diagnosticRow('Фильтр ответа · запрос', relevance.request),
      diagnosticRow('Фильтр ответа · использовано', (relevance.kept || []).map(item => `${item.fact}${item.reason ? ` — ${item.reason}` : ''}`), 'live'),
      diagnosticRow('Фильтр ответа · отброшено', (relevance.dropped || []).map(item => `${item.fact}${item.reason ? ` — ${item.reason}` : ''}`), 'warn'),
      diagnosticRow('Фильтр ответа · вывод', relevance.conclusion),
      diagnosticRow('Проверить перед утверждением', variant?.verificationNeeded, 'warn'),
      diagnosticRow('Уточнения', variant?.clarificationQuestions),
      diagnosticRow('Следующий шаг', variant?.nextStepOffered),
      diagnosticRow('Degraded fallback', variant?.degraded ? (variant.degradationReason || 'да') : '', 'warn'),
      diagnosticRow('Модель', exp.model),
      diagnosticRow('Время', `${number(exp.elapsedMs)} мс`)
    ].filter(Boolean);
    for (const row of rows) ui.diagnosticsBody.append(row);

    if (toolTrace.length) {
      const details = create('details', 'ai-lab-behavior-effects');
      details.append(create('summary', '', `Данные READ-tools (${toolTrace.length})`), create('pre', '', json(toolTrace)));
      ui.diagnosticsBody.append(details);
    }
    if (variant?.answerRelevance) {
      const details = create('details', 'ai-lab-behavior-effects');
      details.append(create('summary', '', 'Answer relevance gate'), create('pre', '', json({ answerRelevance: variant.answerRelevance, gate: variant.relevanceGate || null })));
      ui.diagnosticsBody.append(details);
    }
    const effects = variant?.behaviorEffects || {};
    const effectValues = [effects.directness, effects.clarification, effects.verification, effects.initiative, effects.brevity].filter(Boolean);
    if (effectValues.length) {
      const details = create('details', 'ai-lab-behavior-effects'); details.append(create('summary', '', 'Как профиль повлиял на этот ответ'));
      const list = create('div'); for (const value of effectValues) list.append(create('div', '', value)); details.append(list); ui.diagnosticsBody.append(details);
    }
    ui.diagnostics.hidden = state.displayMode === 'answer';
  }

  function renderCapabilities(state = {}) {
    identityNode.replaceChildren(); identityNode.className = 'ai-lab-identity experiment';
    if (state.knowledgeMode === 'clean') {
      identityNode.append(
        create('strong', '', 'CLEAN MODEL · без внутреннего контекста SIMNET'),
        create('span', '', 'Только диалог + базовая роль оператора ISP. Энциклопедия, Billing/UserSide/Network tools, tool manifest и специальные правила SIMNET не передаются модели.')
      );
      return;
    }
    const details = state.capabilityDetails || {};
    identityNode.append(
      create('strong', '', 'Сейчас тестируем разговор + знания + READ-tools'),
      create('span', '', `Энциклопедия: ${KNOWLEDGE_LABELS[state.knowledgeMode] || state.knowledgeMode}. Billing: ${details.billing || '—'}; UserSide: ${details.userside || '—'}; Network: ${details.network || '—'}. UserSide-контекст не выдаётся за свежий глобальный поиск.`)
    );
  }

  function renderMessages(messages = []) {
    transcriptNode.replaceChildren();
    if (!Array.isArray(messages) || !messages.length) {
      const empty = create('div', 'ai-lab-empty');
      empty.append(create('strong', '', 'Начни как абонент'), create('span', '', 'Например: «Какой у меня баланс?» → затем дай договор. В разборе будет видно, какой READ-tool выбрал агент.'));
      transcriptNode.append(empty); return;
    }
    for (const message of messages) {
      const role = message?.role === 'agent' ? 'agent' : 'customer'; const row = create('div', `ai-lab-message ${role}`);
      const variant = message?.variant === 'with_knowledge' ? ' · KB'
        : message?.variant === 'without_knowledge' ? ' · без KB'
          : message?.variant === 'clean_model' ? ' · CLEAN'
            : message?.variant === 'degraded' ? ' · fallback' : '';
      row.append(create('div', 'ai-lab-message-label', role === 'agent' ? `AI оператор${variant}` : 'Ты · абонент'), create('div', 'ai-lab-message-bubble', message?.text || ''));
      transcriptNode.append(row);
    }
    transcriptNode.scrollTop = transcriptNode.scrollHeight;
  }

  function toolActionLabel(tool = '') {
    const name = String(tool || '').toLowerCase();
    if (name === 'customer.lookup') return 'НАЙТИ / ПРОВЕРИТЬ (LOOKUP / VERIFY)';
    if (name === 'customer.confirm') return 'СОХРАНИТЬ КОНТЕКСТ (STORE / STATE)';
    if (/^(?:billing|userside|building|network|pon)\./.test(name) || name === 'customer.snapshot') return 'ЧИТАТЬ (READ / GET-like)';
    return 'ИНСТРУМЕНТ (TOOL)';
  }

  function humanMode(value = '') {
    const mode = String(value || 'auto').toLowerCase();
    return mode === 'auto' ? 'Авто (auto)'
      : mode === 'clean' ? 'Чистая модель (clean)'
        : mode === 'ab' ? 'A/B сравнение'
          : mode === 'on' ? 'С базой знаний'
            : mode === 'off' ? 'Без базы знаний'
              : mode;
  }

  function experimentResultBody(event = {}) {
    const variants = Array.isArray(event.variants) ? event.variants : [];
    const variant = variants.find(item => item?.label === event.activeVariant) || variants[0] || {};
    const degraded = variants.some(item => item?.degraded);
    const toolCalls = number(event.toolCalls ?? variant.toolCalls);
    const evidenceFirst = variants.length
      ? variants.every(item => item?.evidenceFirst !== false)
      : Boolean(event.evidenceFirst);

    const wrap = create('div', 'ai-lab-result-card');
    const head = create('div', 'ai-lab-result-head');
    head.append(
      create('strong', '', degraded ? 'ИТОГ ХОДА · ЧАСТИЧНО / FALLBACK' : 'ИТОГ ХОДА · УСПЕШНО'),
      create('span', degraded ? 'warn' : 'ok', degraded ? 'Нужна проверка' : 'Штатный ход')
    );
    wrap.append(head);

    const facts = create('div', 'ai-lab-result-grid');
    const fields = [
      ['Режим', humanMode(event.mode)],
      ['Модель', short(variant.model || event.model || '—', 100)],
      ['Инструментов', String(toolCalls)],
      ['Время', `${number(event.elapsedMs)} мс`],
      ['Evidence-first', evidenceFirst ? 'Да' : 'Не подтверждено']
    ];
    for (const [label,value] of fields) {
      facts.append(create('b','',label), create('span','',value));
    }
    wrap.append(facts);

    const flow = create('div', 'ai-lab-result-flow');
    const steps = [
      ['1', 'Понял запрос', 'Семантика и намерение определены'],
      ['2', toolCalls ? `Вызвал инструменты: ${toolCalls}` : 'Инструменты не понадобились', toolCalls ? 'Подробности находятся в TOOL / Runtime Map' : 'Ответ не требовал live READ'],
      ['3', 'Проверил подтверждённые данные', evidenceFirst ? 'Evidence-first включён' : 'Нет подтверждения evidence-first'],
      ['4', degraded ? 'Сформировал fallback-ответ' : 'Сформировал итоговый ответ', degraded ? 'Ход завершён частично' : 'Ход завершён штатно']
    ];
    for (const [num,title,detail] of steps) {
      const row = create('div','ai-lab-result-step');
      row.append(create('span','ai-lab-result-step-num',num));
      const text = create('div');
      text.append(create('b','',title),create('small','',detail));
      row.append(text);
      flow.append(row);
    }
    wrap.append(flow);

    const technical = create('details','ai-lab-result-technical');
    const safeVariants = variants.map(item => ({
      label: item?.label || '',
      model: item?.model || '',
      toolCalls: number(item?.toolCalls),
      degraded: Boolean(item?.degraded),
      evidenceFirst: Boolean(item?.evidenceFirst)
    }));
    technical.append(
      create('summary','', 'Технические поля RESULT'),
      create('pre','', json({
        mode: event.mode || 'auto',
        variants: safeVariants,
        toolCalls,
        elapsedMs: number(event.elapsedMs)
      }))
    );
    wrap.append(technical);
    return wrap;
  }

  function knowledgeTraceState(event = {}) {
    if (event.type !== 'semantic_analysis') return '';
    if (event.cleanModel) return 'CLEAN MODEL';
    if (!event.knowledgeUsed) return 'KB SKIP';
    const articles = Array.isArray(event.articles) ? event.articles.filter(Boolean) : [];
    return articles.length ? `KB HIT · ${articles.join(', ')}` : 'KB MISS';
  }
  function eventTone(event = {}) {
    if (event.type === 'semantic_analysis') {
      if (event.cleanModel) return 'trace-kb-skip';
      if (!event.knowledgeUsed) return 'trace-kb-skip';
      return Array.isArray(event.articles) && event.articles.length ? 'trace-kb-hit' : 'trace-kb-miss';
    }
    if (event.type === 'answer_relevance') return 'trace-internal';
    if (event.type === 'tool_execution') {
      if (event.tool === 'customer.lookup' && event.requestedBy?.system === 'identity') return event.ok ? 'trace-identity' : 'trace-tool-error';
      return event.ok ? 'trace-tool-ok' : 'trace-tool-error';
    }
    if (event.type === 'experiment_result') {
      return (Array.isArray(event.variants) ? event.variants : []).some(item => item?.degraded) ? 'trace-warning' : 'trace-internal';
    }
    if (event.type === 'turn_degraded') return 'trace-warning';
    return 'trace-internal';
  }
  function importantEventNote(event = {}) {
    if (event.type === 'semantic_analysis') {
      if (event.cleanModel) return 'CLEAN MODEL: внутренняя энциклопедия и READ-tools не передавались.';
      const articles = Array.isArray(event.articles) ? event.articles.filter(Boolean) : [];
      if (!event.knowledgeUsed) return 'Энциклопедия не открывалась на этом ходе.';
      if (!articles.length) return 'Энциклопедия была проверена, но релевантная подтверждённая статья не найдена.';
      return `Энциклопедия использована: ${articles.join(', ')}.`;
    }
    if (event.type === 'answer_relevance') {
      const kept = Array.isArray(event.answerRelevance?.kept) ? event.answerRelevance.kept.length : 0;
      const dropped = Array.isArray(event.answerRelevance?.dropped) ? event.answerRelevance.dropped.length : 0;
      return `Финальный relevance-фильтр: использовано ${kept}, отброшено ${dropped}.`;
    }
    if (event.type === 'tool_execution') {
      const identity = event.tool === 'customer.lookup' && event.requestedBy?.system === 'identity';
      if (identity) return event.ok ? 'Абонент успешно найден и привязан через Billing.' : `Не удалось привязать абонента: ${event.code || 'ошибка'}.`;
      return event.ok ? `Инструмент ${event.tool || '—'} вернул подтверждённые данные.` : `Инструмент ${event.tool || '—'} завершился ошибкой ${event.code || 'unknown'}.`;
    }
    if (event.type === 'experiment_result' && (Array.isArray(event.variants) ? event.variants : []).some(item => item?.degraded)) {
      return 'Ход завершился через fallback/degraded-ветку. Раскрой JSON для деталей.';
    }
    if (event.type === 'turn_degraded') return 'Сработал аварийный fallback. Техническая причина находится в JSON ниже.';
    return '';
  }
  function eventSummary(event = {}) {
    if (event.type === 'semantic_analysis') return `СЕМАНТИКА (SEMANTIC) · ${Math.round(number(event.confidence) * 100)}% · ${knowledgeTraceState(event)}`;
    if (event.type === 'answer_relevance') {
      const kept = Array.isArray(event.answerRelevance?.kept) ? event.answerRelevance.kept.length : 0;
      const dropped = Array.isArray(event.answerRelevance?.dropped) ? event.answerRelevance.dropped.length : 0;
      return `ФИЛЬТР ОТВЕТА (RELEVANCE) · использовано ${kept} · отброшено ${dropped}`;
    }
    if (event.type === 'tool_execution') {
      const identity = event.tool === 'customer.lookup' && event.requestedBy?.system === 'identity';
      return `${toolActionLabel(event.tool)} · ${event.tool || '—'} · ${event.ok ? 'УСПЕХ (OK) ✓' : `ОШИБКА (ERROR) · ${event.code || 'unknown'}`}`;
    }
    if (event.type === 'experiment_result') {
      const degraded = (Array.isArray(event.variants) ? event.variants : []).some(item => item?.degraded);
      return `${degraded ? 'ИТОГ · FALLBACK' : 'ИТОГ ХОДА · УСПЕШНО'} · ${humanMode(event.mode)} · инструментов ${number(event.toolCalls)} · ${number(event.elapsedMs)} мс`;
    }
    if (event.type === 'turn_degraded') return 'FALLBACK · DEGRADED';
    if (event.type === 'profile_change') return 'PROFILE CHANGED';
    if (event.type === 'repeat_turn') return 'REPEAT LAST TURN';
    if (event.type === 'snapshot') return 'SNAPSHOT';
    if (event.type === 'customer_message') return 'CLIENT MESSAGE';
    return String(event.type || 'event').toUpperCase();
  }
  function renderEvents(events = []) {
    eventsNode.replaceChildren();
    const useful = (Array.isArray(events) ? events : []).filter(event => event?.type !== 'customer_message').slice(-50).reverse();
    if (!useful.length) { eventsNode.append(create('div', 'ai-lab-log-empty', 'Событий эксперимента пока нет.')); return; }
    for (const event of useful) {
      const item = document.createElement('details'); item.className = `ai-lab-event ${event.type || ''} ${eventTone(event)}`;
      const summary = document.createElement('summary'); summary.textContent = eventSummary(event);
      item.append(summary);
      const note = importantEventNote(event);
      if (note) item.append(create('div', 'ai-lab-event-note', note));
      if (event.type === 'experiment_result') {
        item.append(experimentResultBody(event));
      } else {
        const payload = { ...event }; delete payload.id; delete payload.type;
        item.append(create('pre', '', json(payload)));
      }
      eventsNode.append(item);
    }
  }

  function render(state = {}) {
    latestState = state && typeof state === 'object' ? state : {};
    renderControlState(latestState); renderCapabilities(latestState); renderMessages(latestState.messages || []); renderExperiment(latestState); renderEvents(latestState.events || []);
    const last = latestState.lastDecision || {};
    setStatus(last.action ? `Последний ход: ${last.action} · MODE ${String(latestState.knowledgeMode || 'auto').toUpperCase()} · tools ${number(latestState.lastExperiment?.toolCalls)}${last.model ? ` · ${short(last.model, 110)}` : ''}` : 'Готово. Пиши как абонент и наблюдай, что AI понял, какие данные запросил и чем подтвердил ответ.', last.action ? 'ok' : '');
  }
  function setBusy(value) {
    busy = Boolean(value); sendButton.disabled = busy; resetButton.disabled = busy; input.disabled = busy;
    if (downloadTxtButton) downloadTxtButton.disabled = busy; if (downloadJsonButton) downloadJsonButton.disabled = busy;
    quickButtons.forEach(button => { button.disabled = busy; }); if (controls) renderControlState(latestState || {});
  }
  async function refresh() { const state = await runtime('AI_OPERATOR_LAB_GET'); render(state || {}); return state; }
  async function send() {
    const message = String(input.value || '').trim(); if (!message) return;
    setBusy(true);
    const clean = latestState?.knowledgeMode === 'clean';
    setStatus(clean ? 'CLEAN MODEL отвечает только по диалогу и общим знаниям ISP — без SIMNET KB/tools…' : 'AI разбирает контекст; при необходимости читает Billing/UserSide/Network и формирует ответ…');
    input.value = '';
    try { render(await runtime('AI_OPERATOR_LAB_SEND', { text: message })); }
    catch (error) { input.value = message; setStatus(short(error?.message || error, 600), 'bad'); }
    finally { setBusy(false); input.focus(); }
  }
  async function repeatLast() {
    setBusy(true); setStatus(latestState?.knowledgeMode === 'clean' ? 'Повторяю тот же ход в CLEAN MODEL…' : 'Пересчитываю тот же ход и повторяю READ-проверки при необходимости…');
    try { render(await runtime('AI_OPERATOR_LAB_REPEAT')); setStatus('Последний ход пересчитан на том же pre-turn контексте.', 'ok'); }
    catch (error) { setStatus(short(error?.message || error, 600), 'bad'); }
    finally { setBusy(false); }
  }
  async function takeSnapshot() {
    setBusy(true);
    try { render(await runtime('AI_OPERATOR_LAB_SNAPSHOT')); setStatus('Слепок понимания, tools и ответа сохранён.', 'ok'); }
    catch (error) { setStatus(short(error?.message || error, 600), 'bad'); }
    finally { setBusy(false); }
  }
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.style.display = 'none'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportSnapshotFile() {
    const snapshots = latestState?.snapshots || []; if (!snapshots.length) return;
    downloadFile(`simnet-ai-lab-snapshots-${fileStamp()}.json`, `${JSON.stringify({ exportedAt: new Date().toISOString(), snapshots }, null, 2)}\n`, 'application/json;charset=utf-8');
    setStatus(`Экспортировано слепков: ${snapshots.length}.`, 'ok');
  }
  function txtExport(state = {}) {
    const lines = [
      'SIMNET Workbench · AI Behavior Lab', `Lab: ${state.id || 'unknown'}`, `Knowledge mode: ${state.knowledgeMode || 'auto'}`,
      `Display mode: ${state.displayMode || 'answer_analysis'}`, `Behavior: ${json(state.behavior || {})}`,
      `Capabilities: ${json(state.capabilities || {})}`, `Capability details: ${json(state.capabilityDetails || {})}`, '', '=== DIALOG ==='
    ];
    for (const message of state.messages || []) lines.push(`[${localTime(message.at)}] ${message.role === 'agent' ? 'AI' : 'CLIENT'}: ${message.text || ''}`);
    lines.push('', '=== LAST EXPERIMENT ===', json(state.lastExperiment || {})); return `${lines.join('\n')}\n`;
  }
  async function download(format) {
    try {
      const state = latestState || await refresh(); const stamp = fileStamp();
      if (format === 'json') downloadFile(`simnet-ai-operator-lab-${stamp}.json`, `${JSON.stringify(state || {}, null, 2)}\n`, 'application/json;charset=utf-8');
      else downloadFile(`simnet-ai-operator-lab-${stamp}.txt`, txtExport(state || {}), 'text/plain;charset=utf-8');
      setStatus(`Лог ${format.toUpperCase()} сохранён.`, 'ok');
    } catch (error) { setStatus(`Экспорт: ${short(error?.message || error, 500)}`, 'bad'); }
  }

  sendButton.addEventListener('click', () => void send());
  input.addEventListener('keydown', event => { if (event.key !== 'Enter' || event.shiftKey) return; event.preventDefault(); void send(); });
  resetButton.addEventListener('click', async () => {
    setBusy(true);
    try { render(await runtime('AI_OPERATOR_LAB_RESET')); setStatus('Новый диалог создан. Профиль и слепки сохранены; привязка абонента сброшена.', 'ok'); }
    catch (error) { setStatus(short(error?.message || error, 500), 'bad'); }
    finally { setBusy(false); input.focus(); }
  });
  downloadTxtButton?.addEventListener('click', () => void download('txt'));
  downloadJsonButton?.addEventListener('click', () => void download('json'));
  for (const button of quickButtons) button.addEventListener('click', () => { input.value = String(button.dataset.aiLabPrompt || ''); input.focus(); });

  ensureControls();
  void refresh().catch(error => setStatus(`Test Lab: ${short(error?.message || error, 500)}`, 'bad'));
})();

void import('./ai-quota-dashboard.js').catch(error => console.warn('[AI PROVIDER LIMITS]', error));
