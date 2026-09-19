const QUOTA_KEY = 'simnet_ai_operator_quota_v1';

const LIMITS = Object.freeze({
  'qwen/qwen3.8-27b': { label: 'Qwen 3.8 27B', tpm: 8000, tpd: 200000, rpm: 30, rpd: 1000 },
  'openai/gpt-oss-120b': { label: 'GPT-OSS 120B', tpm: 8000, tpd: 200000, rpm: 30, rpd: 1000 },
  'openai/gpt-oss-20b': { label: 'GPT-OSS 20B', tpm: 8000, tpd: 200000, rpm: 30, rpd: 1000 },
  'meta-llama/llama-prompt-guard-2-86m': { label: 'Prompt Guard 86M', tpm: 15000, tpd: 500000, rpm: 30, rpd: 14400 }
});

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const integer = value => Math.round(number(value)).toLocaleString('ru-RU');
const percent = (used, limit) => limit > 0 ? Math.max(0, Math.min(100, used / limit * 100)) : 0;
const shortReset = value => String(value || '').trim() || '—';

function ensureStyle() {
  if (document.getElementById('aiQuotaDashboardStyle')) return;
  const style = document.createElement('style');
  style.id = 'aiQuotaDashboardStyle';
  style.textContent = `
    .ai-quota-dashboard{margin:10px 0 14px;padding:12px;border:1px solid rgba(92,40,70,.18);border-radius:12px;background:rgba(255,255,255,.72)}
    .ai-quota-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
    .ai-quota-head strong{display:block;font-size:14px}.ai-quota-head span{font-size:11px;opacity:.7;text-align:right}
    .ai-quota-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:9px}
    .ai-quota-card{padding:10px;border:1px solid rgba(92,40,70,.14);border-radius:10px;background:rgba(255,255,255,.82)}
    .ai-quota-card-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}.ai-quota-model{font-weight:700;font-size:12px}.ai-quota-last{font-size:10px;opacity:.62}
    .ai-quota-row{margin-top:7px}.ai-quota-label{display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:3px}.ai-quota-label b{font-variant-numeric:tabular-nums}.ai-quota-meta{font-size:9px;opacity:.62;margin-top:2px}
    .ai-quota-track{height:8px;border-radius:999px;background:rgba(80,40,60,.10);overflow:hidden}.ai-quota-fill{height:100%;width:0;border-radius:inherit;background:#a50046;transition:width .15s ease}.ai-quota-fill.warn{background:#b56a00}.ai-quota-fill.danger{background:#b42318}
    .ai-quota-empty{font-size:11px;opacity:.65;padding:6px 0}.ai-quota-saving{margin-top:10px;padding-top:8px;border-top:1px solid rgba(92,40,70,.10);font-size:10px;opacity:.72}
    .ai-quota-shrink{margin-top:8px;padding:6px 8px;border-radius:7px;background:rgba(165,0,70,.06);font-size:10px;font-variant-numeric:tabular-nums}
  `;
  document.head.append(style);
}

function metricRow(name, used, limit, meta = '') {
  const row = document.createElement('div');
  row.className = 'ai-quota-row';
  const pct = percent(used, limit);
  const label = document.createElement('div');
  label.className = 'ai-quota-label';
  const left = document.createElement('span');
  left.textContent = name;
  const right = document.createElement('b');
  right.textContent = `${integer(used)} / ${integer(limit)} · ${pct.toFixed(1)}%`;
  label.append(left, right);
  const track = document.createElement('div');
  track.className = 'ai-quota-track';
  const fill = document.createElement('div');
  fill.className = `ai-quota-fill${pct >= 85 ? ' danger' : pct >= 70 ? ' warn' : ''}`;
  fill.style.width = `${pct}%`;
  track.append(fill);
  row.append(label, track);
  if (meta) {
    const note = document.createElement('div');
    note.className = 'ai-quota-meta';
    note.textContent = meta;
    row.append(note);
  }
  return row;
}

function providerMetric(rate, type, fallbackUsed, fallbackLimit) {
  const limitKey = `${type}Limit`;
  const usedKey = `${type}Used`;
  if (rate?.[limitKey] != null && rate?.[usedKey] != null) {
    return { used: number(rate[usedKey]), limit: number(rate[limitKey]) || fallbackLimit, exact: true };
  }
  return { used: fallbackUsed, limit: fallbackLimit, exact: false };
}

function modelCard(model, limits, telemetry = {}) {
  const card = document.createElement('div');
  card.className = 'ai-quota-card';
  const head = document.createElement('div');
  head.className = 'ai-quota-card-head';
  const title = document.createElement('div');
  title.className = 'ai-quota-model';
  title.textContent = limits.label;
  title.title = model;
  const last = document.createElement('div');
  last.className = 'ai-quota-last';
  last.textContent = telemetry.last?.at ? new Date(telemetry.last.at).toLocaleTimeString('ru-RU', { hour12: false }) : 'ещё не использовалась';
  head.append(title, last);
  card.append(head);

  const events = Array.isArray(telemetry.events) ? telemetry.events : [];
  const minuteSince = Date.now() - 60000;
  const minute = events.filter(item => number(item?.at) >= minuteSince);
  const localMinuteTokens = minute.reduce((sum, item) => sum + number(item?.tokens), 0);
  const localMinuteRequests = minute.length;
  const localDayTokens = number(telemetry.day?.tokens);
  const localDayRequests = number(telemetry.day?.requests);
  const rate = telemetry.rateLimit || {};

  const providerTpmHeader = rate.limitTokens != null && rate.remainingTokens != null;
  const headerTpmLimit = number(rate.limitTokens) || limits.tpm;
  const headerTpmUsed = providerTpmHeader ? Math.max(0, headerTpmLimit - number(rate.remainingTokens)) : localMinuteTokens;
  const tpm = providerMetric(rate, 'tpm', headerTpmUsed, headerTpmLimit);

  const tpd = providerMetric(rate, 'tpd', localDayTokens, limits.tpd);
  const rpm = providerMetric(rate, 'rpm', localMinuteRequests, limits.rpm);

  const providerRpdHeader = rate.limitRequests != null && rate.remainingRequests != null;
  const headerRpdLimit = number(rate.limitRequests) || limits.rpd;
  const headerRpdUsed = providerRpdHeader ? Math.max(0, headerRpdLimit - number(rate.remainingRequests)) : localDayRequests;
  const rpd = providerMetric(rate, 'rpd', headerRpdUsed, headerRpdLimit);

  card.append(
    metricRow('TPM · токены/мин', tpm.used, tpm.limit, tpm.exact ? 'точно из Groq 429' : providerTpmHeader ? `Groq header · reset ${shortReset(rate.resetTokens)}` : 'локальный rolling 60s'),
    metricRow('TPD · токены/день', tpd.used, tpd.limit, tpd.exact ? 'точно из Groq 429' : telemetry.day?.seededFromApiCost ? 'с учётом прежнего счётчика Workbench за сегодня' : 'локально в этом Chrome-профиле'),
    metricRow('RPM · запросы/мин', rpm.used, rpm.limit, rpm.exact ? 'точно из Groq 429' : 'локальный rolling 60s'),
    metricRow('RPD · запросы/день', rpd.used, rpd.limit, rpd.exact ? 'точно из Groq 429' : providerRpdHeader ? `Groq header · reset ${shortReset(rate.resetRequests)}` : 'локально в этом Chrome-профиле')
  );

  const before = number(telemetry.last?.requestCharsBefore);
  const after = number(telemetry.last?.requestCharsAfter);
  if (before) {
    const shrink = document.createElement('div');
    shrink.className = 'ai-quota-shrink';
    const saved = Math.max(0, before - after);
    shrink.textContent = `Последний payload: ${integer(before)} → ${integer(after)} символов · срезано ${integer(saved)} (${percent(saved, before).toFixed(1)}%)`;
    card.append(shrink);
  }
  return card;
}

function ensureRoot() {
  let root = document.getElementById('aiQuotaDashboard');
  if (!root) {
    root = document.createElement('section');
    root.id = 'aiQuotaDashboard';
    root.className = 'ai-quota-dashboard';
  }
  const cost = document.querySelector('.ai-lab-cost');
  const usage = document.getElementById('aiLabUsage');
  const anchor = cost || usage || document.getElementById('aiLabIdentity');
  if (anchor && root.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', root);
  return root;
}

async function render() {
  ensureStyle();
  const root = ensureRoot();
  if (!root) return;
  const stored = (await chrome.storage.local.get(QUOTA_KEY))?.[QUOTA_KEY] || { models: {} };
  root.replaceChildren();

  const head = document.createElement('div');
  head.className = 'ai-quota-head';
  const left = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Лимиты AI · 0–100%';
  const subtitle = document.createElement('div');
  subtitle.className = 'ai-quota-empty';
  subtitle.textContent = 'TPM/RPD берутся из Groq headers; TPD/RPM — локально, а при 429 заменяются точными Used/Limit провайдера.';
  left.append(title, subtitle);
  const stamp = document.createElement('span');
  stamp.textContent = stored.updatedAt ? `обновлено ${new Date(stored.updatedAt).toLocaleTimeString('ru-RU', { hour12: false })}` : 'ожидаю первый API-вызов';
  head.append(left, stamp);
  root.append(head);

  const grid = document.createElement('div');
  grid.className = 'ai-quota-grid';
  for (const [model, limits] of Object.entries(LIMITS)) grid.append(modelCard(model, limits, stored.models?.[model] || {}));
  root.append(grid);

  const saving = document.createElement('div');
  saving.className = 'ai-quota-saving';
  saving.textContent = 'TOKEN GOVERNOR: canonical runtime сжат · semantic transcript ≤ 8 реплик · JSON ≤ 650 · ответ ≤ 700 · Prompt Guard ≤ 48 · Qwen reasoning=none · GPT-OSS reasoning=low · 429 cooldown блокирует повторный сетевой запрос.';
  root.append(saving);
}

void render();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes?.[QUOTA_KEY]) void render();
});
