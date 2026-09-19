'use strict';

(() => {
  const seed = document.getElementById('aiBatchSeed');
  const count = document.getElementById('aiBatchCount');
  const variants = document.getElementById('aiBatchVariants');
  const generate = document.getElementById('aiBatchGenerate');
  const run = document.getElementById('aiBatchRun');
  const clear = document.getElementById('aiBatchClear');
  const exportButton = document.getElementById('aiBatchExport');
  const status = document.getElementById('aiBatchStatus');
  const summary = document.getElementById('aiBatchSummary');
  const results = document.getElementById('aiBatchResults');
  if (!seed || !count || !variants || !generate || !run || !clear || !exportButton || !status || !summary || !results) return;

  let busy = false;
  let lastBatch = null;

  function text(value, max = 5000) {
    const source = String(value == null ? '' : value).trim();
    return source.length > max ? `${source.slice(0, max - 1)}…` : source;
  }

  function create(tag, className = '', value = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }

  function setBusy(next, message = '') {
    busy = Boolean(next);
    generate.disabled = busy;
    run.disabled = busy;
    clear.disabled = busy;
    exportButton.disabled = busy || !lastBatch;
    seed.disabled = busy;
    count.disabled = busy;
    variants.disabled = busy;
    if (message) status.textContent = message;
  }

  async function runtime(type, payload) {
    const response = await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
    if (!response?.success) throw new Error(response?.error || 'Batch runtime did not return success');
    return response.data;
  }

  function parsedPhrases() {
    const seen = new Set();
    const output = [];
    for (const raw of String(variants.value || '').split(/\n+/)) {
      const phrase = raw.trim();
      if (!phrase) continue;
      const key = phrase.toLocaleLowerCase('ru-RU');
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(phrase);
      if (output.length >= 20) break;
    }
    return output;
  }

  function labelForResult(item = {}) {
    if (!item.ok) return 'ERROR';
    if (item.degraded) return 'DEGRADED';
    return 'OK';
  }

  function renderBatch(batch) {
    lastBatch = batch && typeof batch === 'object' ? batch : null;
    exportButton.disabled = busy || !lastBatch;
    results.replaceChildren();

    if (!lastBatch) {
      summary.textContent = 'Результатов пока нет.';
      results.append(create('div', 'ai-batch-empty', 'Сгенерируй или вставь формулировки и запусти пакетный тест.'));
      return;
    }

    const info = lastBatch.summary || {};
    summary.textContent = `${Number(info.total || 0)} прогонов · ${Number(info.completed || 0)} завершено · ${Number(info.errors || 0)} ошибок · ${Number(info.degraded || 0)} degraded · READ ${Number(info.toolCalls || 0)}`;

    const table = create('table', 'ai-batch-table');
    const head = create('thead');
    const headRow = create('tr');
    for (const title of ['#', 'Формулировка', 'Понял', 'KB', 'Live / READ', 'Статус', 'Ответ']) headRow.append(create('th', '', title));
    head.append(headRow);
    const body = create('tbody');

    for (const item of Array.isArray(lastBatch.results) ? lastBatch.results : []) {
      const row = create('tr', item.ok ? (item.degraded ? 'degraded' : 'ok') : 'error');
      row.append(create('td', 'ai-batch-index', item.index || ''));
      row.append(create('td', 'ai-batch-phrase', text(item.phrase, 800)));
      row.append(create('td', 'ai-batch-understood', text(item.whatUserWants || item.latestMessageMeans || item.error || '—', 900)));
      const kb = item.knowledgeUsed ? `USED · ${item.knowledgeNeed || '—'}` : (item.knowledgeNeed || 'none');
      row.append(create('td', 'ai-batch-kb', kb));
      const needs = (Array.isArray(item.evidenceNeeds) ? item.evidenceNeeds : [])
        .map(need => `${need?.system || ''}${need?.field ? ` → ${need.field}` : ''}`)
        .filter(Boolean);
      const tools = (Array.isArray(item.toolTrace) ? item.toolTrace : [])
        .map(call => `${call?.tool || 'tool'}:${call?.code || (call?.ok ? 'ok' : 'fail')}`);
      row.append(create('td', 'ai-batch-live', [...needs, ...tools].join(' · ') || '—'));
      row.append(create('td', 'ai-batch-result', labelForResult(item)));
      row.append(create('td', 'ai-batch-reply', text(item.reply || item.error || '—', 1600)));
      body.append(row);
    }
    table.append(head, body);
    results.append(table);
  }

  function downloadJson() {
    if (!lastBatch) return;
    const blob = new Blob([JSON.stringify(lastBatch, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `simnet-ai-batch-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function generateVariants() {
    if (busy) return;
    const source = text(seed.value, 1000);
    if (!source) {
      status.textContent = 'Введи исходную реплику.';
      seed.focus();
      return;
    }
    setBusy(true, 'DeepSeek/активная модель генерирует равнозначные формулировки…');
    try {
      const generated = await runtime('AI_OPERATOR_BATCH_GENERATE', { source, count: Number(count.value || 10) });
      variants.value = (generated?.variants || []).join('\n');
      status.textContent = `Сгенерировано ${generated?.variants?.length || 0} формулировок. Можно отредактировать список перед запуском.`;
    } catch (error) {
      status.textContent = text(error?.message || error, 900);
    } finally {
      setBusy(false);
    }
  }

  async function runBatch() {
    if (busy) return;
    const phrases = parsedPhrases();
    if (!phrases.length) {
      status.textContent = 'Нет формулировок для прогона.';
      variants.focus();
      return;
    }
    setBusy(true, `Запускаю ${phrases.length} изолированных прогонов через текущий AI Operator…`);
    try {
      const batch = await runtime('AI_OPERATOR_BATCH_RUN', { source: text(seed.value, 1000), phrases });
      renderBatch(batch);
      status.textContent = 'Пакетный прогон завершён. Каждая формулировка запускалась из одинакового стартового состояния.';
    } catch (error) {
      status.textContent = text(error?.message || error, 900);
    } finally {
      setBusy(false);
    }
  }

  async function clearBatch() {
    if (busy) return;
    setBusy(true, 'Очищаю результат пакетного теста…');
    try {
      await runtime('AI_OPERATOR_BATCH_CLEAR');
      lastBatch = null;
      renderBatch(null);
      status.textContent = 'Результат очищен. Список формулировок оставлен для повторного запуска.';
    } catch (error) {
      status.textContent = text(error?.message || error, 900);
    } finally {
      setBusy(false);
    }
  }

  generate.addEventListener('click', () => void generateVariants());
  run.addEventListener('click', () => void runBatch());
  clear.addEventListener('click', () => void clearBatch());
  exportButton.addEventListener('click', downloadJson);

  void runtime('AI_OPERATOR_BATCH_GET').then(batch => {
    renderBatch(batch);
    if (batch?.phrases?.length && !variants.value) variants.value = batch.phrases.join('\n');
    if (batch?.source && !seed.value) seed.value = batch.source;
  }).catch(error => {
    status.textContent = text(error?.message || error, 900);
    renderBatch(null);
  });
})();
