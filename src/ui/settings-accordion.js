(() => {
  const STORAGE_KEY = 'simnet_settings_accordion_v1';
  const panels = [...document.querySelectorAll('details[data-accordion-group][data-accordion-panel]')];

  if (panels.length) {
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      stored = {};
    }

    const save = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch {}
    };

    const groups = new Map();
    for (const panel of panels) {
      const group = String(panel.dataset.accordionGroup || 'settings');
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(panel);
    }

    let initializing = true;
    for (const [group, groupPanels] of groups) {
      const fallback = groupPanels.find(panel => panel.dataset.accordionDefault === 'true')?.dataset.accordionPanel || '';
      const wanted = Object.prototype.hasOwnProperty.call(stored, group) ? String(stored[group] || '') : fallback;
      for (const panel of groupPanels) {
        panel.open = Boolean(wanted) && panel.dataset.accordionPanel === wanted;
      }
    }
    initializing = false;

    for (const panel of panels) {
      panel.addEventListener('toggle', () => {
        if (initializing) return;
        const group = String(panel.dataset.accordionGroup || 'settings');
        const key = String(panel.dataset.accordionPanel || '');
        const groupPanels = groups.get(group) || [];

        if (panel.open) {
          for (const sibling of groupPanels) {
            if (sibling !== panel && sibling.open) sibling.open = false;
          }
          stored[group] = key;
        } else if (stored[group] === key) {
          stored[group] = '';
        }
        save();
      });
    }
  }

  const reviewExportButton = document.getElementById('aiReplayExportCsv');
  if (!reviewExportButton) return;

  const statusNode = document.getElementById('aiReplayStatus');

  function setStatus(text, kind = '') {
    if (!statusNode) return;
    statusNode.textContent = String(text || '');
    statusNode.className = `status ai-replay-status${kind ? ` ${kind}` : ''}`;
  }

  async function runtime(type) {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.success) throw new Error(response?.error || 'Replay runtime error');
    return response.data;
  }

  function toText(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(item => toText(item)).filter(Boolean).join(' | ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function listText(value, mapItem = item => item) {
    if (!Array.isArray(value)) return '';
    return value.map(item => toText(mapItem(item))).filter(Boolean).join(' | ');
  }

  function tokensForDecision(decision = {}) {
    const usage = decision?.usage && typeof decision.usage === 'object' ? decision.usage : {};
    return Number(usage.total_tokens ?? usage.totalTokens ?? 0)
      || ((Number(usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0) + (Number(usage.completion_tokens ?? usage.completionTokens ?? 0) || 0))
      || 0;
  }

  function csvCell(value) {
    const text = toText(value).replace(/\r\n?/g, '\n');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function reviewRow(item = {}) {
    const decision = item?.decision || {};
    const diagnostic = decision?.diagnostic || {};
    const understanding = diagnostic?.understanding && typeof diagnostic.understanding === 'object'
      ? diagnostic.understanding
      : diagnostic;
    const knowledge = diagnostic?.knowledge && typeof diagnostic.knowledge === 'object' ? diagnostic.knowledge : {};
    const gate = diagnostic?.knowledgeGate && typeof diagnostic.knowledgeGate === 'object' ? diagnostic.knowledgeGate : {};

    return [
      item?.batch?.caseNumber || '',
      item?.chatId || '',
      item?.caseId || '',
      item?.customerText || '',
      understanding?.whatUserWants || decision?.intent || '',
      understanding?.latestMessageMeans || '',
      understanding?.underlyingGoal || '',
      gate?.need || understanding?.knowledgeNeed || '',
      gate?.reason || understanding?.knowledgeReason || '',
      listText(knowledge?.usedArticles, article => article?.id || ''),
      listText(knowledge?.usedArticles, article => article?.why || ''),
      listText(knowledge?.knowledgeGaps),
      listText(knowledge?.mustNotAssume),
      listText(knowledge?.hypotheses, hypothesis => hypothesis?.text
        ? `${hypothesis.text}${hypothesis?.basis ? ` [основание: ${hypothesis.basis}]` : ''}`
        : hypothesis),
      listText(understanding?.ambiguities),
      decision?.action === 'ai_no_response' || diagnostic?.code
        ? `${diagnostic?.code || decision?.action || 'AI_ERROR'}${diagnostic?.message ? `: ${diagnostic.message}` : ''}`
        : '',
      decision?.model || '',
      tokensForDecision(decision),
      decision?.reply || '',
      item?.referenceReply || '',
      item?.verdict || '',
      item?.note || '',
      '',
      '',
      '',
      '',
      ''
    ];
  }

  function downloadCsv(results) {
    const headers = [
      'Кейс',
      'Chat ID',
      'Case ID',
      'Реплика клиента',
      'Что понял AI',
      'Смысл последней реплики',
      'Общая цель',
      'Нужна энциклопедия',
      'Почему нужна / не нужна',
      'Статьи SIMNET',
      'Почему выбраны статьи',
      'Пробелы базы знаний',
      'Что нельзя предполагать',
      'Гипотезы AI',
      'Неоднозначности',
      'Ошибка AI',
      'Модель',
      'Токены',
      'Разбор / ответ AI',
      'Реальный ответ оператора',
      'Текущий verdict',
      'Текущая заметка',
      'Моя оценка',
      'Тип ошибки',
      'Что исправить',
      'Добавить в энциклопедию',
      'Комментарий'
    ];

    const rows = [headers, ...results.map(reviewRow)];
    const content = `\uFEFF${rows.map(row => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `simnet-ai-replay-review-${stamp}.csv`;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  reviewExportButton.addEventListener('click', async () => {
    reviewExportButton.disabled = true;
    try {
      const raw = await runtime('AI_OPERATOR_REPLAY_RESULTS');
      const results = Array.isArray(raw) ? raw : [];
      if (!results.length) throw new Error('Сохранённых Replay-результатов пока нет.');
      downloadCsv(results);
      setStatus(`Таблица готова: ${results.length} кейсов. Пустые колонки справа оставлены для ручной разметки.`, 'ok');
    } catch (error) {
      setStatus(`Replay CSV: ${String(error?.message || error)}`, 'bad');
    } finally {
      reviewExportButton.disabled = false;
    }
  });
})();

void import('./ai-quota-dashboard.js').catch(error => console.warn('[AI QUOTA]', error));
void import('./ai-operator-scenario-replay.js').catch(error => console.warn('[AI SCENARIO REPLAY]', error));