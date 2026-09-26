'use strict';

const CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const LAB_KEY = 'simnet_ai_operator_lab_v1';
const API_COST_KEY = 'simnet_ai_operator_api_cost_v1';
const ROOT_ID = 'aiQuotaDashboard';
const STYLE_ID = 'aiQuotaDashboardStyle';

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const integer = value => Math.round(number(value)).toLocaleString('ru-RU');

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ai-quota-dashboard{margin:9px 0 12px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:9px;background:#f8fafc;color:#172033}
    .ai-quota-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.ai-quota-head strong{font-size:11px;color:#0f172a}.ai-quota-head span{font:800 8px ui-monospace,monospace;color:#2563eb}
    .ai-quota-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:7px}.ai-quota-metric{min-width:0;padding:6px 7px;border:1px dashed rgba(15,23,42,.28);border-radius:7px;background:#fff}
    .ai-quota-metric b{display:block;margin-bottom:2px;color:#64748b;font:800 8px ui-monospace,monospace}.ai-quota-metric span{display:block;color:#172033;font:800 9px/1.35 ui-monospace,monospace;word-break:break-word}
    .ai-quota-note{margin-top:6px;color:#64748b;font-size:8px;line-height:1.4}.ai-quota-note.warn{color:#92400e}
    @media(max-width:760px){.ai-quota-grid{grid-template-columns:1fr 1fr}}
  `;
  document.head.append(style);
}

function ensureRoot() {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'ai-quota-dashboard';
  }
  const anchor = document.getElementById('aiLabIdentity');
  if (anchor && root.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', root);
  return root;
}

function metric(label, value) {
  const node = document.createElement('div');
  node.className = 'ai-quota-metric';
  const key = document.createElement('b');
  key.textContent = label;
  const val = document.createElement('span');
  val.textContent = String(value || '—');
  node.append(key, val);
  return node;
}

function lastModelName(decision = {}, config = {}) {
  const chain = String(decision?.model || '').split('→').map(value => value.trim()).filter(Boolean);
  return chain.at(-1) || String(config.chatModel || config.model || 'deepseek-flash');
}

function localModelUsage(cost = {}, model = '') {
  const direct = cost?.total?.[model];
  if (direct) return direct;
  const entry = Object.entries(cost?.total || {}).find(([name]) => String(name).toLowerCase().includes('deepseek'));
  return entry?.[1] || {};
}

async function render() {
  ensureStyle();
  const stored = await chrome.storage.local.get([CONFIG_KEY, LAB_KEY, API_COST_KEY]);
  const config = stored?.[CONFIG_KEY] || {};
  const provider = String(config.provider || 'groq').toLowerCase();
  const existing = document.getElementById(ROOT_ID);

  if (provider !== 'deepseek') {
    existing?.remove();
    return;
  }

  const root = ensureRoot();
  const lab = stored?.[LAB_KEY] || {};
  const decision = lab?.lastDecision || {};
  const usage = decision?.usage || {};
  const rate = decision?.rateLimit || {};
  const model = lastModelName(decision, config);
  const totalUsage = localModelUsage(stored?.[API_COST_KEY] || {}, model);

  root.replaceChildren();
  const head = document.createElement('div');
  head.className = 'ai-quota-head';
  const title = document.createElement('strong');
  title.textContent = 'DeepSeek · лимиты / расход';
  const badge = document.createElement('span');
  badge.textContent = model;
  head.append(title, badge);
  root.append(head);

  const grid = document.createElement('div');
  grid.className = 'ai-quota-grid';
  const turnTotal = number(usage.total_tokens || (number(usage.prompt_tokens) + number(usage.completion_tokens)));
  const totalTokens = number(totalUsage.input) + number(totalUsage.output);
  const tokenLimit = number(rate.limitTokens);
  const tokenRemaining = number(rate.remainingTokens);
  const requestLimit = number(rate.limitRequests);
  const requestRemaining = number(rate.remainingRequests);

  grid.append(
    metric('Последний ход', `${integer(turnTotal)} ток. · in ${integer(usage.prompt_tokens)} / out ${integer(usage.completion_tokens)}`),
    metric('Учтено локально', `${integer(totalUsage.calls)} запросов · ${integer(totalTokens)} ток.`),
    metric('Лимит токенов API', tokenLimit ? `${integer(tokenRemaining)} осталось из ${integer(tokenLimit)}` : 'не передан провайдером'),
    metric('Лимит запросов API', requestLimit ? `${integer(requestRemaining)} осталось из ${integer(requestLimit)}` : requestRemaining ? `осталось ${integer(requestRemaining)}` : 'не передан провайдером')
  );
  root.append(grid);

  const reset = [rate.resetTokens && `tokens reset ${rate.resetTokens}`, rate.resetRequests && `requests reset ${rate.resetRequests}`, rate.retryAfter && `retry-after ${rate.retryAfter}`].filter(Boolean).join(' · ');
  const note = document.createElement('div');
  note.className = `ai-quota-note${tokenLimit || requestLimit ? '' : ' warn'}`;
  note.textContent = tokenLimit || requestLimit
    ? `Показываются реальные rate-limit headers DeepSeek.${reset ? ` ${reset}.` : ''}`
    : 'DeepSeek не вернул rate-limit headers в последнем ответе. Статические 0–100% лимиты не выдумываем; показываем только реально учтённый расход.';
  root.append(note);
}

void render();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes?.[CONFIG_KEY] || changes?.[LAB_KEY] || changes?.[API_COST_KEY]) void render();
});
