'use strict';

(() => {
  const API_COST_KEY = 'simnet_ai_operator_api_cost_v1';
  const LAB_KEY = 'simnet_ai_operator_lab_v1';
  const identityNode = document.getElementById('aiLabIdentity');
  if (!identityNode || !chrome?.storage?.local) return;

  const style = document.createElement('style');
  style.textContent = `
    .ai-lab-token-usage,
    .ai-lab-cost { display: none !important; }
    .ai-lab-request-meter {
      margin: 10px 0 14px;
      border: 1px solid rgba(15, 23, 42, .12);
      border-radius: 10px;
      background: rgba(255, 255, 255, .72);
      overflow: hidden;
    }
    .ai-lab-request-meter-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 12px;
      border-bottom: 1px solid rgba(15, 23, 42, .09);
    }
    .ai-lab-request-meter-head strong { font-size: 13px; }
    .ai-lab-request-meter-head span { font-size: 12px; opacity: .72; }
    .ai-lab-request-meter-empty { padding: 10px 12px; font-size: 12px; opacity: .68; }
    .ai-lab-request-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .ai-lab-request-table th,
    .ai-lab-request-table td { padding: 7px 9px; border-bottom: 1px solid rgba(15, 23, 42, .07); text-align: right; white-space: nowrap; }
    .ai-lab-request-table th { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; opacity: .58; }
    .ai-lab-request-table th:nth-child(2),
    .ai-lab-request-table td:nth-child(2),
    .ai-lab-request-table th:nth-child(3),
    .ai-lab-request-table td:nth-child(3) { text-align: left; }
    .ai-lab-request-table tbody tr:last-child td { border-bottom: 0; }
    .ai-lab-request-stage { font-weight: 650; }
    .ai-lab-request-variant { display: block; margin-top: 2px; font-size: 10px; font-weight: 400; opacity: .58; }
    .ai-lab-request-total { font-weight: 700; }
    .ai-lab-request-missing { opacity: .55; }
    @media (max-width: 760px) {
      .ai-lab-request-table th:nth-child(3), .ai-lab-request-table td:nth-child(3) { display: none; }
      .ai-lab-request-table th, .ai-lab-request-table td { padding: 7px 6px; }
    }
  `;
  document.head.append(style);

  const root = document.createElement('section');
  root.className = 'ai-lab-request-meter';
  root.id = 'aiLabRequestMeter';
  identityNode.insertAdjacentElement('afterend', root);

  const nf = value => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
  const safe = value => String(value == null ? '' : value);
  const stageLabel = value => {
    const stage = safe(value).toLowerCase();
    const labels = {
      prompt_guard: 'PROMPT GUARD',
      understanding: 'UNDERSTANDING',
      understanding_repair: 'UNDERSTANDING · repair',
      knowledge: 'KNOWLEDGE',
      knowledge_repair: 'KNOWLEDGE · repair',
      reply: 'FINAL ANSWER',
      reply_repair: 'FINAL ANSWER · repair',
      tool_synthesis: 'FINAL · READ',
      tool_synthesis_repair: 'FINAL · READ · repair',
      semantic_request: 'SEMANTIC',
      ai_request: 'AI REQUEST'
    };
    return labels[stage] || safe(value || 'AI REQUEST').replaceAll('_', ' ').toUpperCase();
  };

  function modelTotals(models = {}) {
    return Object.values(models || {}).reduce((sum, item) => {
      sum.calls += Number(item?.calls || 0);
      sum.input += Number(item?.input || 0);
      sum.output += Number(item?.output || 0);
      return sum;
    }, { calls: 0, input: 0, output: 0 });
  }

  function cell(text, className = '') {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function render(data = {}, lab = {}) {
    root.replaceChildren();
    const turnId = safe(lab?.lastMeterTurnId);
    const bucket = turnId ? data?.turns?.[turnId] : null;
    const calls = Array.isArray(bucket?.calls) ? bucket.calls : [];
    const totals = modelTotals(bucket?.models);

    const head = document.createElement('div');
    head.className = 'ai-lab-request-meter-head';
    const title = document.createElement('strong');
    title.textContent = 'Токены по AI-запросам';
    const summary = document.createElement('span');
    summary.textContent = calls.length
      ? `${nf(totals.input + totals.output)} ток. · ${nf(totals.calls)} запрос.`
      : 'текущий ход';
    head.append(title, summary);
    root.append(head);

    if (!calls.length) {
      const empty = document.createElement('div');
      empty.className = 'ai-lab-request-meter-empty';
      empty.textContent = turnId ? 'На этом ходе ещё нет записанных API-запросов.' : 'Отправь реплику — здесь будет расход каждого API-запроса отдельно.';
      root.append(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'ai-lab-request-table';
    const thead = document.createElement('thead');
    const header = document.createElement('tr');
    for (const label of ['#', 'Этап', 'Модель', 'Вход', 'Выход', 'Всего']) {
      const th = document.createElement('th'); th.textContent = label; header.append(th);
    }
    thead.append(header);
    const tbody = document.createElement('tbody');

    for (const [index, call] of calls.entries()) {
      const row = document.createElement('tr');
      if (call?.missingUsage) row.className = 'ai-lab-request-missing';
      row.append(cell(String(call?.sequence || index + 1)));

      const stage = cell('', 'ai-lab-request-stage');
      stage.textContent = stageLabel(call?.stage);
      if (call?.variant) {
        const variant = document.createElement('span');
        variant.className = 'ai-lab-request-variant';
        variant.textContent = safe(call.variant);
        stage.append(variant);
      }
      row.append(stage);
      row.append(cell(safe(call?.model || 'unknown')));
      row.append(cell(call?.missingUsage ? '—' : nf(call?.input)));
      row.append(cell(call?.missingUsage ? '—' : nf(call?.output)));
      row.append(cell(call?.missingUsage ? '—' : nf(call?.total), 'ai-lab-request-total'));
      tbody.append(row);
    }

    table.append(thead, tbody);
    root.append(table);
  }

  async function refresh() {
    try {
      const stored = await chrome.storage.local.get([API_COST_KEY, LAB_KEY]);
      render(stored?.[API_COST_KEY] || {}, stored?.[LAB_KEY] || {});
    } catch {
      render({}, {});
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[API_COST_KEY] || changes[LAB_KEY]) void refresh();
  });

  void refresh();
})();