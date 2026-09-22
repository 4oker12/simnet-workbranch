'use strict';

const SUBJECT_STORAGE_KEY = 'simnet_ai_scenario_subject_v1';
const TYPE = Object.freeze({
  LIST: 'AI_OPERATOR_SCENARIO_LIST', RUN: 'AI_OPERATOR_SCENARIO_RUN', RUN_ALL: 'AI_OPERATOR_SCENARIO_RUN_ALL',
  STOP: 'AI_OPERATOR_SCENARIO_STOP', RESULTS: 'AI_OPERATOR_SCENARIO_RESULTS', RERUN_FAILED: 'AI_OPERATOR_SCENARIO_RERUN_FAILED',
  COMPARE: 'AI_OPERATOR_SCENARIO_COMPARE', EXPORT: 'AI_OPERATOR_SCENARIO_EXPORT', CLEAR: 'AI_OPERATOR_SCENARIO_CLEAR'
});

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const short = (value, max = 180) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
async function call(type, payload) {
  const response = await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
  if (!response?.success) throw new Error(response?.error || 'Scenario Replay runtime error');
  return response.data;
}
function download(name, data) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mount() {
  const body = document.querySelector('[data-accordion-panel="lab"] .settings-lab-body');
  if (!body || document.getElementById('aiScenarioReplay')) return null;
  const oldReplay = body.querySelector('[data-accordion-panel="replay"]');
  const panel = el('details', 'lab-section');
  panel.id = 'aiScenarioReplay';
  panel.dataset.accordionGroup = 'lab';
  panel.dataset.accordionPanel = 'scenario-replay';
  panel.innerHTML = `
    <summary class="lab-section-summary">
      <div><strong>Scenario Replay</strong><span>реальный абонент · 10 диалогов · память · tools · Dialogue Police</span></div>
      <span class="settings-chevron" aria-hidden="true"></span>
    </summary>
    <div class="lab-section-body">
      <div class="section-head lab-section-head-flat"><div>
        <h3>Автопрогон диалога по реальному абоненту</h3>
        <p class="muted">Сначала укажи договор/login. Workbench делает реальный customer.lookup и только после успешной привязки запускает вопросы сценария вокруг этого абонента.</p>
      </div></div>
      <div class="ai-scenario-subject">
        <label class="field-label" for="aiScenarioSubject">Объект теста · номер договора или Billing login</label>
        <input id="aiScenarioSubject" type="text" autocomplete="off" spellcheck="false" placeholder="Например: 408980 или giv1984">
        <div class="note">Identity bootstrap не считается ходом сценария и не подменяет данные fixture-значениями.</div>
      </div>
      <div class="ai-scenario-toolbar">
        <select id="aiScenarioSelect"></select>
        <button id="aiScenarioRun" type="button">Run scenario</button>
        <button id="aiScenarioRunAll" type="button">Run all</button>
        <button id="aiScenarioStop" class="danger" type="button">Stop</button>
        <button id="aiScenarioRerun" class="secondary" type="button">Rerun failed</button>
        <button id="aiScenarioCompare" class="secondary" type="button">Compare last 2</button>
        <button id="aiScenarioExport" class="secondary" type="button">Export JSON</button>
      </div>
      <div id="aiScenarioStatus" class="status">Укажи договор/login реального абонента.</div>
      <div id="aiScenarioSubjectInfo" class="ai-batch-summary"></div>
      <div id="aiScenarioSummary" class="ai-batch-summary"></div>
      <div id="aiScenarioResults" class="ai-batch-results"></div>
    </div>`;
  body.insertBefore(panel, oldReplay || null);

  const style = el('style');
  style.textContent = `
    .ai-scenario-subject{margin:12px 0}.ai-scenario-subject input{width:min(440px,100%)}
    .ai-scenario-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
    .ai-scenario-toolbar select{min-width:280px;max-width:100%}
    .ai-scenario-run{border:1px solid var(--border,#ddd);border-radius:10px;padding:10px;margin:8px 0}
    .ai-scenario-turn{display:grid;grid-template-columns:44px 90px 1fr;gap:8px;padding:6px 0;border-top:1px solid rgba(128,128,128,.2)}
    .ai-scenario-turn pre{white-space:pre-wrap;margin:0;font:inherit}.ai-scenario-bad{font-weight:700}.ai-scenario-meta{font-size:12px;opacity:.75}`;
  document.head.append(style);
  return panel;
}

const panel = mount();
if (panel) {
  const select = document.getElementById('aiScenarioSelect');
  const subjectInput = document.getElementById('aiScenarioSubject');
  const subjectInfo = document.getElementById('aiScenarioSubjectInfo');
  const status = document.getElementById('aiScenarioStatus');
  const summary = document.getElementById('aiScenarioSummary');
  const results = document.getElementById('aiScenarioResults');
  const buttons = {
    run: document.getElementById('aiScenarioRun'), all: document.getElementById('aiScenarioRunAll'),
    stop: document.getElementById('aiScenarioStop'), rerun: document.getElementById('aiScenarioRerun'),
    compare: document.getElementById('aiScenarioCompare'), export: document.getElementById('aiScenarioExport')
  };
  let state = { cases: [], runs: [], active: null };
  let latest = null;

  try { subjectInput.value = localStorage.getItem(SUBJECT_STORAGE_KEY) || ''; } catch {}
  subjectInput.addEventListener('change', () => {
    try { localStorage.setItem(SUBJECT_STORAGE_KEY, subjectInput.value.trim()); } catch {}
  });

  const setStatus = (text, bad = false) => {
    status.textContent = text;
    status.className = `status${bad ? ' bad' : ' ok'}`;
  };
  const setBusy = value => {
    buttons.run.disabled = value;
    buttons.all.disabled = value;
    buttons.rerun.disabled = value;
    buttons.compare.disabled = value;
    buttons.export.disabled = value;
    subjectInput.disabled = value;
    select.disabled = value;
    buttons.stop.disabled = !value;
  };
  const subjectPayload = () => {
    const value = subjectInput.value.trim();
    if (!value) throw new Error('Сначала укажи номер договора или Billing login реального абонента.');
    try { localStorage.setItem(SUBJECT_STORAGE_KEY, value); } catch {}
    return value;
  };

  function renderCases() {
    const chosen = select.value;
    select.replaceChildren();
    for (const item of state.cases || []) {
      const option = el('option', '', `${item.title} · ${item.turns} ходов`);
      option.value = item.id;
      select.append(option);
    }
    if (chosen && [...select.options].some(option => option.value === chosen)) select.value = chosen;
  }

  function render(run) {
    latest = run || latest;
    results.replaceChildren();
    if (!latest) {
      subjectInfo.textContent = '';
      results.append(el('div', 'ai-batch-empty', 'Прогонов пока нет.'));
      return;
    }
    const subject = latest.subject || {};
    subjectInfo.textContent = subject.caseId
      ? `Объект: ${subject.contract || subject.login || subject.input || subject.caseId}${subject.fullName ? ` · ${subject.fullName}` : ''}${subject.address ? ` · ${subject.address}` : ''}`
      : 'Объект теста не сохранён.';
    const s = latest.summary || {};
    summary.textContent = `${latest.scenarioTitle || latest.scenarioId} · ${latest.status} · complete ${s.complete || 0} / incomplete ${s.incomplete || 0} / failed ${s.failed || 0} · tools ${s.toolCalls || 0} · tokens ${s.totalTokens || 0} · avg ${s.averageLatencyMs || 0} ms`;
    const box = el('div', 'ai-scenario-run');
    for (const turn of latest.turns || []) {
      const row = el('div', `ai-scenario-turn ${turn.status === 'complete' ? '' : 'ai-scenario-bad'}`);
      const text = `CLIENT: ${turn.user}\nAI: ${turn.reply || '—'}\n${(turn.dialoguePolice?.violations || []).length ? `POLICE: ${turn.dialoguePolice.violations.join(', ')}\n` : ''}${turn.unknownFacts?.length ? `UNKNOWN: ${turn.unknownFacts.join(', ')}\n` : ''}ACT: ${turn.semantic?.discourseAct || '—'}`;
      row.append(el('span', '', `#${Number(turn.index) + 1}`), el('span', '', turn.status), el('pre', '', text));
      box.append(row);
    }
    results.append(box);
  }

  async function refresh() {
    state = await call(TYPE.LIST);
    renderCases();
    const id = state.runs?.[0]?.id;
    if (id) render((await call(TYPE.EXPORT, { runId: id })).run);
    else render(null);
    buttons.stop.disabled = !state.active;
  }

  async function run(type, payload) {
    setBusy(true);
    setStatus(type === TYPE.RUN_ALL ? 'Идентифицирую абонента и прогоняю все сценарии…' : 'Идентифицирую абонента и запускаю сценарий…');
    try {
      const out = await call(type, payload);
      if (type === TYPE.RUN_ALL) {
        state = out.state || await call(TYPE.LIST);
        const id = out.runs?.at(-1)?.id || state.runs?.[0]?.id;
        if (id) render((await call(TYPE.EXPORT, { runId: id })).run);
      } else render(out);
      setStatus('Прогон завершён.');
    } catch (error) {
      setStatus(short(error?.message || error, 600), true);
    } finally {
      setBusy(false);
      await refresh().catch(() => {});
    }
  }

  buttons.run.addEventListener('click', () => {
    try { void run(TYPE.RUN, { scenarioId: select.value, subjectIdentity: subjectPayload() }); }
    catch (error) { setStatus(short(error?.message || error), true); }
  });
  buttons.all.addEventListener('click', () => {
    try { void run(TYPE.RUN_ALL, { subjectIdentity: subjectPayload() }); }
    catch (error) { setStatus(short(error?.message || error), true); }
  });
  buttons.stop.addEventListener('click', async () => {
    try { const out = await call(TYPE.STOP); setStatus(out.stopped ? 'Stop принят: следующий ход не запустится.' : 'Активного прогона нет.'); }
    catch (error) { setStatus(short(error?.message || error), true); }
  });
  buttons.rerun.addEventListener('click', () => latest && void run(TYPE.RERUN_FAILED, { runId: latest.id }));
  buttons.export.addEventListener('click', async () => {
    if (!latest) return;
    try { download(`simnet-scenario-${latest.scenarioId}-${Date.now()}.json`, await call(TYPE.EXPORT, { runId: latest.id })); }
    catch (error) { setStatus(short(error?.message || error), true); }
  });
  buttons.compare.addEventListener('click', async () => {
    try {
      const runs = state.runs || [];
      if (runs.length < 2) throw new Error('Нужно минимум два run.');
      const comparison = await call(TYPE.COMPARE, { leftRunId: runs[1].id, rightRunId: runs[0].id });
      setStatus(`Compare: изменено ходов ${comparison.changedTurns}/${comparison.turns.length}.`);
      results.prepend(el('pre', 'ai-scenario-meta', JSON.stringify(comparison, null, 2)));
    } catch (error) { setStatus(short(error?.message || error), true); }
  });

  setBusy(false);
  void refresh().catch(error => setStatus(short(error?.message || error), true));
}
