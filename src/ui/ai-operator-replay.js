import { extractReplayCases } from '../features/ai-operator/replay-cases.js';

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

if (fileInput && evaluateButton && statusNode && metaNode && transcriptNode && referenceNode && aiNode && noteInput) {
  let cases = [];
  let index = 0;
  let currentEvaluation = null;
  let sourceStats = null;

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

  function setBusy(busy) {
    const value = Boolean(busy);
    evaluateButton.disabled = value || !currentCase();
    if (prevButton) prevButton.disabled = value || index <= 0;
    if (nextButton) nextButton.disabled = value || index >= cases.length - 1;
    if (passButton) passButton.disabled = value || !currentEvaluation;
    if (gapButton) gapButton.disabled = value || !currentEvaluation;
    if (skipButton) skipButton.disabled = value || !currentEvaluation;
    if (exportButton) exportButton.disabled = value;
    fileInput.disabled = value;
    noteInput.disabled = value;
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
    const lines = [
      `${decision.action || '—'}${decision.tool ? ` → ${decision.tool}` : ''}`,
      decision.reply || '',
      decision.reason ? `Причина: ${decision.reason}` : '',
      decision.model ? `Модель: ${decision.model}` : ''
    ].filter(Boolean);
    aiNode.textContent = lines.join('\n\n');
  }

  function renderCase() {
    const replayCase = currentCase();
    currentEvaluation = null;
    noteInput.value = '';
    if (!replayCase) {
      metaNode.textContent = 'Загрузите JSON-экспорт HelpCrunch.';
      transcriptNode.replaceChildren(create('div', 'ai-lab-empty', 'Replay-кейсы не загружены.'));
      referenceNode.textContent = '—';
      aiNode.textContent = '—';
      setBusy(false);
      return;
    }
    metaNode.textContent = `Кейс ${index + 1}/${cases.length} · chat ${replayCase.chatId} · ${replayCase.id}`;
    renderTranscript(replayCase);
    renderEvaluation();
    setStatus(`Готов к replay. Всего кейсов: ${cases.length}.`, 'ok');
    setBusy(false);
  }

  async function loadFile(file) {
    if (!file) return;
    setBusy(true);
    setStatus('Читаю HelpCrunch export…');
    try {
      const rawText = await file.text();
      const payload = JSON.parse(rawText);
      const extracted = extractReplayCases(payload, {
        maxChats: 5000,
        maxCases: 10000,
        transcriptLimit: 28,
        includeAutomation: false
      });
      cases = extracted.cases;
      sourceStats = extracted.stats;
      index = 0;
      currentEvaluation = null;
      if (!cases.length) {
        throw new Error('Не найдено ни одного перехода «клиент → живой оператор». Проверь формат экспорта.');
      }
      renderCase();
      setStatus(
        `Загружено: ${sourceStats.chats} чатов · ${sourceStats.cases} replay-кейсов · пропущено bot/automation: ${sourceStats.skippedAutomation}.`,
        'ok'
      );
    } catch (error) {
      cases = [];
      sourceStats = null;
      index = 0;
      currentEvaluation = null;
      renderCase();
      setStatus(`Replay import: ${short(error?.message || error, 700)}`, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function evaluateCurrent() {
    const replayCase = currentCase();
    if (!replayCase) return;
    setBusy(true);
    setStatus('Прогоняю текущую реплику через AI…');
    try {
      currentEvaluation = await runtime('AI_OPERATOR_REPLAY_EVALUATE', { case: replayCase });
      renderEvaluation();
      setStatus('Replay готов. Сравни решение AI с реальным ответом и поставь PASS / GAP / SKIP.', 'ok');
    } catch (error) {
      currentEvaluation = null;
      renderEvaluation();
      setStatus(`Replay: ${short(error?.message || error, 700)}`, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function record(verdict) {
    const replayCase = currentCase();
    const decision = currentEvaluation?.decision;
    if (!replayCase || !decision) return;
    const note = String(noteInput.value || '').trim();
    if (verdict === 'gap' && !note) {
      setStatus('Для GAP напиши коротко, какого правила/логики не хватает.', 'bad');
      noteInput.focus();
      return;
    }
    setBusy(true);
    try {
      await runtime('AI_OPERATOR_REPLAY_RECORD', {
        case: replayCase,
        decision,
        verdict,
        note
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
        setBusy(false);
      }
    } catch (error) {
      setStatus(`Replay verdict: ${short(error?.message || error, 700)}`, 'bad');
      setBusy(false);
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
        results
      }, null, 2)}\n`);
      setStatus(`Экспортировано результатов: ${Array.isArray(results) ? results.length : 0}.`, 'ok');
    } catch (error) {
      setStatus(`Replay export: ${short(error?.message || error, 700)}`, 'bad');
    }
  }

  fileInput.addEventListener('change', () => { void loadFile(fileInput.files?.[0] || null); });
  evaluateButton.addEventListener('click', () => { void evaluateCurrent(); });
  prevButton?.addEventListener('click', () => {
    if (index <= 0) return;
    index -= 1;
    renderCase();
  });
  nextButton?.addEventListener('click', () => {
    if (index >= cases.length - 1) return;
    index += 1;
    renderCase();
  });
  passButton?.addEventListener('click', () => { void record('pass'); });
  gapButton?.addEventListener('click', () => { void record('gap'); });
  skipButton?.addEventListener('click', () => { void record('skip'); });
  exportButton?.addEventListener('click', () => { void exportResults(); });

  renderCase();
}
