import { extractReplayCases, selectReplayBatchCases } from '../features/ai-operator/replay-cases.js';

const fileInput = document.getElementById('aiReplayFile');
const evaluateButton = document.getElementById('aiReplayEvaluate');
const prevButton = document.getElementById('aiReplayPrev');
const nextButton = document.getElementById('aiReplayNext');
const passButton = document.getElementById('aiReplayPass');
const gapButton = document.getElementById('aiReplayGap');
const skipButton = document.getElementById('aiReplaySkip');
const exportButton = document.getElementById('aiReplayExport');
const statusNode = document.getElementById('aiReplayStatus');
const metaNode = document.getElementById('aiReplayMeta');
const transcriptNode = document.getElementById('aiReplayTranscript');
const referenceNode = document.getElementById('aiReplayReference');
const aiNode = document.getElementById('aiReplayAi');
const noteInput = document.getElementById('aiReplayNote');

const SETTINGS_KEY = 'simnet_ai_replay_batch_settings_v1';
const RESUME_KEY = 'simnet_ai_replay_resume_v1';
const DEFAULT_SETTINGS = Object.freeze({ startCase: 1, maxChats: 50, maxTurns: 100, tokenBudget: 80000, delayMs: 2500 });
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_WAIT_MS = 65_000;
const MAX_RATE_LIMIT_WAIT_MS = 180_000;

if (fileInput && evaluateButton && statusNode && metaNode && transcriptNode && referenceNode && aiNode && noteInput) {
  let cases = [];
  let index = 0;
  let currentEvaluation = null;
  let sourceStats = null;
  let batchRunning = false;
  let stopRequested = false;
  let lastBatch = null;
  let currentFileSignature = '';
  const evaluations = new Map();

  function short(value, max = 500) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function create(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(text == null ? '' : text);
    return node;
  }

  function numberControl(id, label, value, min, max, step = 1) {
    const wrap = create('div');
    const caption = create('label', 'field-label', label);
    caption.htmlFor = id;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'text-input';
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    wrap.append(caption, input);
    return { wrap, input };
  }

  function readStoredSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function readResumeCheckpoint() {
    try {
      const raw = JSON.parse(localStorage.getItem(RESUME_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  const stored = readStoredSettings();
  const startCaseControl = numberControl('aiReplayStartCase', 'Начать с кейса №', stored.startCase, 1, 20000);
  const maxChatsControl = numberControl('aiReplayMaxChats', 'Чатов в прогоне', stored.maxChats, 1, 5000);
  const maxTurnsControl = numberControl('aiReplayMaxTurns', 'Макс. AI-ходов', stored.maxTurns, 1, 20000);
  const tokenBudgetControl = numberControl('aiReplayTokenBudget', 'Лимит токенов на запуск', stored.tokenBudget, 1000, 5000000, 1000);
  const delayControl = numberControl('aiReplayDelayMs', 'Пауза между запросами, мс', stored.delayMs, 0, 60000, 100);
  const settingsGrid = create('div', 'form-grid two ai-replay-batch-settings');
  settingsGrid.append(startCaseControl.wrap, maxChatsControl.wrap, maxTurnsControl.wrap, tokenBudgetControl.wrap, delayControl.wrap);

  const batchActions = create('div', 'actions ai-replay-batch-actions');
  const startButton = create('button', '', 'Старт прогона');
  startButton.id = 'aiReplayStart';
  startButton.type = 'button';
  const stopButton = create('button', 'danger', 'Стоп');
  stopButton.id = 'aiReplayStop';
  stopButton.type = 'button';
  stopButton.disabled = true;
  batchActions.append(startButton, stopButton);

  const progressNode = create('div', 'status compact ai-replay-progress', 'Пакетный прогон не запускался.');
  progressNode.id = 'aiReplayProgress';
  const batchNote = create('p', 'note ai-replay-note');
  batchNote.innerHTML = '<b>Пакетный режим:</b> можно начать с любого replay-кейса. Каждый чат идёт по хронологии доступной истории; состояние сохраняется внутри чата и сбрасывается при переходе к следующему. При Groq 429 Workbench сам ждёт сброса лимита и продолжает с того же кейса. Загрузка JSON токены не расходует.';
  statusNode.before(settingsGrid, batchActions, progressNode, batchNote);

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
  }

  function batchSettings() {
    const maxStartCase = Math.max(1, cases.length || 20000);
    const settings = {
      startCase: clamp(startCaseControl.input.value, 1, maxStartCase, DEFAULT_SETTINGS.startCase),
      maxChats: clamp(maxChatsControl.input.value, 1, 5000, DEFAULT_SETTINGS.maxChats),
      maxTurns: clamp(maxTurnsControl.input.value, 1, 20000, DEFAULT_SETTINGS.maxTurns),
      tokenBudget: clamp(tokenBudgetControl.input.value, 1000, 5000000, DEFAULT_SETTINGS.tokenBudget),
      delayMs: clamp(delayControl.input.value, 0, 60000, DEFAULT_SETTINGS.delayMs)
    };
    startCaseControl.input.value = String(settings.startCase);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  function saveResumeCheckpoint(nextCaseNumber, extra = {}) {
    if (!cases.length) return;
    const next = clamp(nextCaseNumber, 1, cases.length, 1);
    const checkpoint = {
      fileSignature: currentFileSignature,
      nextCaseNumber: next,
      savedAt: new Date().toISOString(),
      ...extra
    };
    localStorage.setItem(RESUME_KEY, JSON.stringify(checkpoint));
  }

  function setStatus(message, kind = '') {
    statusNode.textContent = String(message || '');
    statusNode.className = `status ai-replay-status${kind ? ` ${kind}` : ''}`;
  }

  async function runtime(type, payload = undefined) {
    const request = payload === undefined ? { type } : { type, payload };
    const response = await chrome.runtime.sendMessage(request);
    if (!response?.success) throw new Error(response?.error || 'Replay runtime error');
    return response.data;
  }

  function currentCase() {
    return cases[index] || null;
  }

  function setControls() {
    const replayCase = currentCase();
    evaluateButton.disabled = batchRunning || !replayCase;
    if (prevButton) prevButton.disabled = batchRunning || index <= 0;
    if (nextButton) nextButton.disabled = batchRunning || index >= cases.length - 1;
    if (passButton) passButton.disabled = batchRunning || !currentEvaluation;
    if (gapButton) gapButton.disabled = batchRunning || !currentEvaluation;
    if (skipButton) skipButton.disabled = batchRunning || !currentEvaluation;
    if (exportButton) exportButton.disabled = batchRunning;
    fileInput.disabled = batchRunning;
    noteInput.disabled = batchRunning;
    startButton.disabled = batchRunning || !cases.length;
    stopButton.disabled = !batchRunning;
    for (const input of [startCaseControl.input, maxChatsControl.input, maxTurnsControl.input, tokenBudgetControl.input, delayControl.input]) {
      input.disabled = batchRunning;
    }
  }

  function renderTranscript(replayCase) {
    transcriptNode.replaceChildren();
    const transcript = Array.isArray(replayCase?.transcript) ? replayCase.transcript : [];
    if (!transcript.length) {
      transcriptNode.append(create('div', 'ai-lab-empty', 'Нет диалога для replay.'));
      return;
    }
    for (const message of transcript) {
      const role = message?.role === 'customer' ? 'customer' : 'agent';
      const row = create('div', `ai-lab-message ${role}`);
      row.append(
        create('div', 'ai-lab-message-label', role === 'customer' ? 'Клиент' : 'Оператор'),
        create('div', 'ai-lab-message-bubble', message?.text || '')
      );
      transcriptNode.append(row);
    }
    transcriptNode.scrollTop = transcriptNode.scrollHeight;
  }

  function renderEvaluation() {
    const replayCase = currentCase();
    referenceNode.textContent = replayCase?.referenceReply || '—';
    if (!currentEvaluation?.decision) {
      aiNode.textContent = 'Кейс ещё не прогнан.';
      return;
    }
    const decision = currentEvaluation.decision;
    const usage = tokensForDecision(decision);
    const lines = [
      `${decision.action || '—'}${decision.tool ? ` → ${decision.tool}` : ''}`,
      decision.reply || '',
      decision.reason ? `Причина: ${decision.reason}` : '',
      decision.model ? `Модель: ${decision.model}` : '',
      usage.tokens ? `Токены: ${usage.tokens}${usage.estimated ? ' (оценка)' : ''}` : ''
    ].filter(Boolean);
    aiNode.textContent = lines.join('\n\n');
  }

  function renderCase() {
    const replayCase = currentCase();
    currentEvaluation = replayCase ? evaluations.get(replayCase.id) || null : null;
    noteInput.value = '';
    if (!replayCase) {
      metaNode.textContent = 'Загрузите JSON-экспорт HelpCrunch.';
      transcriptNode.replaceChildren(create('div', 'ai-lab-empty', 'Replay-кейсы не загружены.'));
      referenceNode.textContent = '—';
      aiNode.textContent = '—';
      setControls();
      return;
    }
    const turn = replayCase.chatTurnIndex && replayCase.chatTurnCount
      ? ` · ход ${replayCase.chatTurnIndex}/${replayCase.chatTurnCount}`
      : '';
    metaNode.textContent = `Кейс ${index + 1}/${cases.length} · chat ${replayCase.chatId}${turn} · ${replayCase.id}`;
    renderTranscript(replayCase);
    renderEvaluation();
    setControls();
  }

  async function loadFile(file) {
    if (!file) return;
    batchRunning = false;
    stopRequested = false;
    setControls();
    setStatus('Читаю HelpCrunch export…');
    try {
      const rawText = await file.text();
      const payload = JSON.parse(rawText);
      const extracted = extractReplayCases(payload, {
        maxChats: 5000,
        maxCases: 20000,
        transcriptLimit: 120,
        includeAutomation: false
      });
      cases = extracted.cases;
      sourceStats = extracted.stats;
      index = 0;
      currentEvaluation = null;
      evaluations.clear();
      lastBatch = null;
      currentFileSignature = `${file.name}:${file.size}:${file.lastModified}`;
      startCaseControl.input.max = String(Math.max(1, cases.length));
      const checkpoint = readResumeCheckpoint();
      const storedStart = clamp(startCaseControl.input.value, 1, Math.max(1, cases.length), 1);
      if (checkpoint.fileSignature === currentFileSignature && Number(checkpoint.nextCaseNumber) > 1 && storedStart === 1) {
        startCaseControl.input.value = String(clamp(checkpoint.nextCaseNumber, 1, cases.length, 1));
      } else {
        startCaseControl.input.value = String(storedStart);
      }
      batchSettings();
      progressNode.textContent = 'Пакетный прогон не запускался.';
      if (!cases.length) {
        throw new Error('Не найдено ни одного перехода «клиент → живой оператор». Проверь формат экспорта.');
      }
      renderCase();
      const resumeAt = Number(startCaseControl.input.value) || 1;
      setStatus(
        `Загружено локально: ${sourceStats.chats} чатов · ${sourceStats.cases} replay-ходов · пропущено bot/automation: ${sourceStats.skippedAutomation}. Старт: кейс ${resumeAt}. Токены ещё не расходовались.`,
        'ok'
      );
    } catch (error) {
      cases = [];
      sourceStats = null;
      index = 0;
      currentEvaluation = null;
      evaluations.clear();
      currentFileSignature = '';
      renderCase();
      setStatus(`Replay import: ${short(error?.message || error, 700)}`, 'bad');
    }
  }

  function tokensForDecision(decision = {}) {
    const usage = decision?.usage && typeof decision.usage === 'object' ? decision.usage : {};
    const total = Number(usage.total_tokens ?? usage.totalTokens ?? 0) || 0;
    if (total > 0) return { tokens: Math.ceil(total), estimated: false };
    const prompt = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0;
    const completion = Number(usage.completion_tokens ?? usage.completionTokens ?? 0) || 0;
    if (prompt + completion > 0) return { tokens: Math.ceil(prompt + completion), estimated: false };
    const promptChars = Number(decision?.promptChars || 0) || 0;
    return { tokens: promptChars > 0 ? Math.ceil(promptChars / 4) : 0, estimated: promptChars > 0 };
  }

  function isRateLimitDecision(decision = {}) {
    const diagnosticStatus = Number(decision?.diagnostic?.status || 0) || 0;
    if (diagnosticStatus === 429) return true;
    const reason = `${decision?.reason || ''} ${decision?.diagnostic?.message || ''}`;
    return /\b429\b|rate.?limit/i.test(reason);
  }

  function fatalStatus(decision = {}) {
    const diagnosticStatus = Number(decision?.diagnostic?.status || 0) || 0;
    if ([401, 403].includes(diagnosticStatus)) return `Groq HTTP ${diagnosticStatus}: ключ/доступ. Прогон остановлен.`;
    return '';
  }

  function durationMs(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 0;
    if (/^\d+(?:\.\d+)?$/.test(text)) return Math.ceil(Number(text) * 1000);
    let total = 0;
    const pattern = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
    let match;
    while ((match = pattern.exec(text))) {
      const amount = Number(match[1]);
      const unit = match[2];
      total += unit === 'h' ? amount * 3_600_000
        : unit === 'm' ? amount * 60_000
          : unit === 's' ? amount * 1000
            : amount;
    }
    return Math.ceil(total);
  }

  function rateLimitWaitMs(decision = {}) {
    const rateLimit = decision?.diagnostic?.rateLimit && typeof decision.diagnostic.rateLimit === 'object'
      ? decision.diagnostic.rateLimit
      : decision?.rateLimit && typeof decision.rateLimit === 'object'
        ? decision.rateLimit
        : {};
    const headerWait = durationMs(rateLimit.retryAfter) || durationMs(rateLimit.resetTokens);
    const wait = headerWait > 0 ? headerWait + 1500 : DEFAULT_RATE_LIMIT_WAIT_MS;
    return Math.max(5000, Math.min(MAX_RATE_LIMIT_WAIT_MS, wait));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  async function waitForRateLimit(ms, caseNumber, retryNumber) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (stopRequested) return false;
      const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
      const message = `Groq 429 · кейс ${caseNumber}. Жду ${seconds} сек и продолжу автоматически · попытка ${retryNumber}/${MAX_RATE_LIMIT_RETRIES}`;
      setStatus(message);
      progressNode.textContent = message;
      await sleep(Math.min(1000, Math.max(1, until - Date.now())));
    }
    return !stopRequested;
  }

  async function evaluateCurrent() {
    const replayCase = currentCase();
    if (!replayCase || batchRunning) return;
    setStatus('Прогоняю текущую реплику через AI…');
    evaluateButton.disabled = true;
    try {
      currentEvaluation = await runtime('AI_OPERATOR_REPLAY_EVALUATE', { case: replayCase, state: {} });
      evaluations.set(replayCase.id, currentEvaluation);
      renderEvaluation();
      setStatus('Replay готов. Сравни решение AI с реальным ответом и поставь PASS / GAP / SKIP.', 'ok');
    } catch (error) {
      currentEvaluation = null;
      evaluations.delete(replayCase.id);
      renderEvaluation();
      setStatus(`Replay: ${short(error?.message || error, 700)}`, 'bad');
    } finally {
      setControls();
    }
  }

  async function runBatch() {
    if (batchRunning || !cases.length) return;
    const settings = batchSettings();
    const startIndex = Math.max(0, settings.startCase - 1);
    const selected = selectReplayBatchCases(cases.slice(startIndex), { maxChats: settings.maxChats, maxCases: settings.maxTurns });
    if (!selected.cases.length) {
      setStatus(`Нет replay-ходов начиная с кейса ${settings.startCase}.`, 'bad');
      return;
    }

    batchRunning = true;
    stopRequested = false;
    setControls();
    const startedAt = new Date().toISOString();
    let activeChatId = 0;
    let chatState = {};
    let chatsStarted = 0;
    let turnsDone = 0;
    let tokensUsed = 0;
    let estimatedTokens = false;
    let stopReason = '';
    let nextCaseNumber = settings.startCase;

    try {
      replayLoop:
      for (const replayCase of selected.cases) {
        if (stopRequested) { stopReason = 'Остановлено вручную.'; break; }
        if (tokensUsed >= settings.tokenBudget) { stopReason = `Достигнут лимит ${settings.tokenBudget} токенов.`; break; }

        if (replayCase.chatId !== activeChatId) {
          activeChatId = replayCase.chatId;
          chatState = {};
          chatsStarted += 1;
        }

        const globalIndex = cases.findIndex(item => item.id === replayCase.id);
        const caseNumber = globalIndex >= 0 ? globalIndex + 1 : nextCaseNumber;
        if (globalIndex >= 0) index = globalIndex;
        nextCaseNumber = caseNumber;
        renderCase();

        let evaluation = null;
        let rateLimitRetry = 0;
        while (!stopRequested) {
          setStatus(`Replay: кейс ${caseNumber} · chat ${replayCase.chatId}, ход ${replayCase.chatTurnIndex || 1}…`);
          try {
            evaluation = await runtime('AI_OPERATOR_REPLAY_EVALUATE', { case: replayCase, state: chatState });
          } catch (error) {
            const message = short(error?.message || error, 500);
            if (/\b429\b|rate.?limit/i.test(message) && rateLimitRetry < MAX_RATE_LIMIT_RETRIES) {
              rateLimitRetry += 1;
              const waited = await waitForRateLimit(DEFAULT_RATE_LIMIT_WAIT_MS, caseNumber, rateLimitRetry);
              if (!waited) { stopReason = 'Остановлено вручную во время ожидания rate limit.'; break replayLoop; }
              continue;
            }
            stopReason = `Ошибка runtime на кейсе ${caseNumber}: ${message}`;
            break replayLoop;
          }

          if (isRateLimitDecision(evaluation?.decision)) {
            if (rateLimitRetry >= MAX_RATE_LIMIT_RETRIES) {
              stopReason = `Groq 429 повторился ${MAX_RATE_LIMIT_RETRIES} раза на кейсе ${caseNumber}. Прогон остановлен на этом кейсе.`;
              break replayLoop;
            }
            rateLimitRetry += 1;
            currentEvaluation = evaluation;
            renderEvaluation();
            const waited = await waitForRateLimit(rateLimitWaitMs(evaluation.decision), caseNumber, rateLimitRetry);
            if (!waited) { stopReason = 'Остановлено вручную во время ожидания rate limit.'; break replayLoop; }
            continue;
          }
          break;
        }

        if (stopRequested) { stopReason = stopReason || 'Остановлено вручную.'; break; }
        if (!evaluation) { stopReason = stopReason || `Нет результата для кейса ${caseNumber}.`; break; }

        const fatal = fatalStatus(evaluation.decision);
        if (fatal) { stopReason = fatal; break; }

        chatState = evaluation?.state && typeof evaluation.state === 'object' ? evaluation.state : chatState;
        evaluations.set(replayCase.id, evaluation);
        currentEvaluation = evaluation;
        const usage = tokensForDecision(evaluation.decision);
        tokensUsed += usage.tokens;
        estimatedTokens ||= usage.estimated;
        turnsDone += 1;
        nextCaseNumber = Math.min(cases.length, caseNumber + 1);
        saveResumeCheckpoint(nextCaseNumber, { lastCompletedCaseNumber: caseNumber, chatId: replayCase.chatId });

        await runtime('AI_OPERATOR_REPLAY_RECORD', {
          case: replayCase,
          decision: evaluation.decision,
          verdict: 'unreviewed',
          note: '',
          batch: {
            startedAt,
            startCase: settings.startCase,
            chatsLimit: settings.maxChats,
            turnsLimit: settings.maxTurns,
            tokenBudget: settings.tokenBudget,
            turnNumber: turnsDone,
            caseNumber,
            tokensUsed
          }
        });

        renderEvaluation();
        progressNode.textContent = `Идёт с кейса ${settings.startCase}: сейчас ${caseNumber}/${cases.length} · ${chatsStarted}/${selected.chatIds.length} чатов · ${turnsDone}/${selected.cases.length} AI-ходов · ${tokensUsed}${estimatedTokens ? '≈' : ''}/${settings.tokenBudget} токенов`;

        if (tokensUsed >= settings.tokenBudget) { stopReason = `Достигнут лимит ${settings.tokenBudget} токенов.`; break; }
        if (turnsDone < selected.cases.length && settings.delayMs > 0) await sleep(settings.delayMs);
      }
    } finally {
      batchRunning = false;
      startCaseControl.input.value = String(clamp(nextCaseNumber, 1, Math.max(1, cases.length), 1));
      batchSettings();
      lastBatch = {
        startedAt,
        finishedAt: new Date().toISOString(),
        settings,
        selectedChats: selected.chatIds.length,
        selectedTurns: selected.cases.length,
        chatsStarted,
        turnsDone,
        tokensUsed,
        estimatedTokens,
        nextCaseNumber,
        stopReason: stopReason || 'Готово.'
      };
      progressNode.textContent = `${lastBatch.stopReason} Пройдено: ${turnsDone}/${selected.cases.length} AI-ходов · ${tokensUsed}${estimatedTokens ? '≈' : ''} токенов. Следующий старт: кейс ${nextCaseNumber}.`;
      setStatus(
        stopReason
          ? `${stopReason} Продолжить можно с кейса ${nextCaseNumber}.`
          : `Пакетный replay завершён. Следующий старт: кейс ${nextCaseNumber}.`,
        stopReason ? 'bad' : 'ok'
      );
      renderCase();
      setControls();
    }
  }

  async function record(verdict) {
    const replayCase = currentCase();
    const decision = currentEvaluation?.decision;
    if (!replayCase || !decision || batchRunning) return;
    const note = String(noteInput.value || '').trim();
    if (verdict === 'gap' && !note) {
      setStatus('Для GAP напиши коротко, какого правила/логики не хватает.', 'bad');
      noteInput.focus();
      return;
    }
    try {
      await runtime('AI_OPERATOR_REPLAY_RECORD', {
        case: replayCase,
        decision,
        verdict,
        note,
        batch: lastBatch
      });
      if (verdict === 'gap') {
        await runtime('AI_OPERATOR_FEEDBACK_ADD', {
          chatId: replayCase.chatId,
          customerText: replayCase.customerText,
          aiReply: decision.reply || '',
          correctedReply: '',
          note
        });
      }
      const label = verdict.toUpperCase();
      if (index < cases.length - 1) {
        index += 1;
        renderCase();
        setStatus(`${label} сохранён. Следующий кейс готов.`, 'ok');
      } else {
        setStatus(`${label} сохранён. Это последний кейс в выборке.`, 'ok');
      }
    } catch (error) {
      setStatus(`Replay verdict: ${short(error?.message || error, 700)}`, 'bad');
    } finally {
      setControls();
    }
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportResults() {
    try {
      const results = await runtime('AI_OPERATOR_REPLAY_RESULTS');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      download(`simnet-ai-replay-results-${stamp}.json`, `${JSON.stringify({
        exportedAt: new Date().toISOString(),
        sourceStats,
        lastBatch,
        results
      }, null, 2)}\n`);
      setStatus(`Экспортировано результатов: ${Array.isArray(results) ? results.length : 0}.`, 'ok');
    } catch (error) {
      setStatus(`Replay export: ${short(error?.message || error, 700)}`, 'bad');
    }
  }

  fileInput.addEventListener('change', () => { void loadFile(fileInput.files?.[0] || null); });
  evaluateButton.addEventListener('click', () => { void evaluateCurrent(); });
  startButton.addEventListener('click', () => { void runBatch(); });
  stopButton.addEventListener('click', () => {
    stopRequested = true;
    stopButton.disabled = true;
    setStatus('Останавливаю после текущего запроса/ожидания…');
  });
  prevButton?.addEventListener('click', () => {
    if (batchRunning || index <= 0) return;
    index -= 1;
    renderCase();
  });
  nextButton?.addEventListener('click', () => {
    if (batchRunning || index >= cases.length - 1) return;
    index += 1;
    renderCase();
  });
  passButton?.addEventListener('click', () => { void record('pass'); });
  gapButton?.addEventListener('click', () => { void record('gap'); });
  skipButton?.addEventListener('click', () => { void record('skip'); });
  exportButton?.addEventListener('click', () => { void exportResults(); });

  for (const input of [startCaseControl.input, maxChatsControl.input, maxTurnsControl.input, tokenBudgetControl.input, delayControl.input]) {
    input.addEventListener('change', batchSettings);
  }

  renderCase();
}