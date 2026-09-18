// USD / 1M tokens, checked 2026-09-16 against https://console.groq.com/docs/models
// Cached GPT-OSS prices: https://console.groq.com/docs/model/openai/gpt-oss-120b
// and https://console.groq.com/docs/model/openai/gpt-oss-20b . Unknown cache prices use regular input (estimate).
export const DEFAULT_API_PRICES = Object.freeze({
  'qwen/qwen3.6-27b': { input: 0.60, output: 3.00, cached: null },
  'qwen/qwen3.8-27b': { input: 0.80, output: 4.00, cached: null },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.60, cached: 0.075 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.30, cached: 0.037 }
});
export const API_COST_KEY = 'simnet_ai_operator_api_cost_v1';
export const API_PRICES_KEY = 'simnet_ai_operator_api_prices_v1';
let queue = Promise.resolve();
let storageError = false;
const valid = n => n !== null && n !== '' && n !== undefined && Number.isFinite(Number(n)) && Number(n) >= 0;
const tokens = n => valid(n) ? Math.floor(Number(n)) : 0;
export function aggregateUsage(current = {}, request = {}) {
  const next = structuredClone(current);
  const candidate = String(request.model || 'unknown');
  const model = ['__proto__','constructor','prototype'].includes(candidate) ? 'unknown' : candidate;
  const entry = next[model] || { calls: 0, input: 0, output: 0, cached: 0, missingUsage: 0 };
  const usage = request.usage || {};
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  entry.calls++;
  if (!valid(input) || !valid(output)) entry.missingUsage++;
  entry.input += tokens(input);
  entry.output += tokens(output);
  entry.cached += Math.min(tokens(input), tokens(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens));
  next[model] = entry;
  return next;
}
export function estimateCost(models = {}, prices = DEFAULT_API_PRICES) {
  const total = { usd: 0, calls: 0, input: 0, output: 0, missingUsage: 0, unpricedCalls: 0, cacheAtRegularRate: false };
  for (const [model, usage] of Object.entries(models)) {
    for (const field of ['calls', 'input', 'output', 'missingUsage']) total[field] += tokens(usage[field]);
    const rate = prices[model];
    if (!rate || !valid(rate.input) || !valid(rate.output)) { total.unpricedCalls += tokens(usage.calls); continue; }
    const cached = Math.min(tokens(usage.input), tokens(usage.cached));
    if (cached && !valid(rate.cached)) total.cacheAtRegularRate = true;
    total.usd += ((tokens(usage.input) - cached) * Number(rate.input) + cached * Number(valid(rate.cached) ? rate.cached : rate.input) + tokens(usage.output) * Number(rate.output)) / 1e6;
  }
  return total;
}
function modelBreakdown(models = {}, prices = DEFAULT_API_PRICES) {
  const result = {};
  for (const [model, usage] of Object.entries(models || {})) {
    const summary = estimateCost({ [model]: usage }, prices);
    result[model] = {
      ...summary,
      input_tokens: summary.input,
      output_tokens: summary.output,
      total_tokens: summary.input + summary.output
    };
  }
  return result;
}
function usageSummary(models = {}, prices = DEFAULT_API_PRICES, stages = {}) {
  const summary = estimateCost(models || {}, prices);
  const byStage = {};
  for (const [stage, stageModels] of Object.entries(stages || {})) {
    const stageSummary = estimateCost(stageModels || {}, prices);
    byStage[stage] = {
      ...stageSummary,
      input_tokens: stageSummary.input,
      output_tokens: stageSummary.output,
      total_tokens: stageSummary.input + stageSummary.output,
      by_model: modelBreakdown(stageModels || {}, prices)
    };
  }
  return {
    ...summary,
    input_tokens: summary.input,
    output_tokens: summary.output,
    total_tokens: summary.input + summary.output,
    by_model: modelBreakdown(models || {}, prices),
    by_stage: byStage
  };
}
export async function recordApiUsage(request) {
  const operation = queue.then(async () => {
    const data = (await chrome.storage.local.get(API_COST_KEY))?.[API_COST_KEY] || { startedAt: new Date().toISOString(), total: {}, scopes: {}, turns: {} };
    data.total = aggregateUsage(data.total, request);
    const scope = String(request.scope || 'operator-other').slice(0, 150);
    const turn = String(request.turnId || 'unscoped').slice(0, 150);
    const stage = String(request.stage || 'unspecified').slice(0, 100);
    data.scopes ||= {}; data.turns ||= {};

    const scopeEntry = data.scopes[scope] || { models: {}, stages: {}, at: 0 };
    scopeEntry.models = aggregateUsage(scopeEntry.models, request);
    scopeEntry.stages ||= {};
    scopeEntry.stages[stage] = aggregateUsage(scopeEntry.stages[stage], request);
    scopeEntry.at = Date.now();
    data.scopes[scope] = scopeEntry;

    const turnEntry = data.turns[turn] || { models: {}, stages: {}, at: 0 };
    turnEntry.models = aggregateUsage(turnEntry.models, request);
    turnEntry.stages ||= {};
    turnEntry.stages[stage] = aggregateUsage(turnEntry.stages[stage], request);
    turnEntry.at = Date.now();
    data.turns[turn] = turnEntry;

    for (const key of ['scopes', 'turns']) data[key] = Object.fromEntries(Object.entries(data[key]).sort((a,b) => b[1].at - a[1].at).slice(0, key === 'scopes' ? 100 : 200));
    await chrome.storage.local.set({ [API_COST_KEY]: data });
  });
  queue = operation.catch(() => { storageError = true; });
  await queue; // Meter persistence must never trigger another paid model attempt.
}
export async function apiCostSummary(scope, turnId) {
  await queue;
  const stored = await chrome.storage.local.get([API_COST_KEY, API_PRICES_KEY]);
  const data = stored?.[API_COST_KEY] || {};
  const prices = { ...DEFAULT_API_PRICES, ...(stored?.[API_PRICES_KEY] || {}) };
  const scopeEntry = data.scopes?.[scope] || {};
  const turnEntry = data.turns?.[turnId] || {};
  return {
    total: usageSummary(data.total, prices),
    session: usageSummary(scopeEntry.models, prices, scopeEntry.stages),
    turn: usageSummary(turnEntry.models, prices, turnEntry.stages),
    prices,
    models: Object.keys(data.total || {}),
    startedAt: data.startedAt || null,
    storageError
  };
}
export async function saveApiPrice({ model, input, output, cached } = {}) {
  if (typeof model !== 'string' || !model.trim() || model.length > 150 || ['__proto__','constructor','prototype'].includes(model)) throw Error('Укажите модель.');
  if (!valid(input) || !valid(output) || (cached !== '' && cached != null && !valid(cached))) throw Error('Цена должна быть неотрицательным числом в USD за 1 млн токенов.');
  const stored = (await chrome.storage.local.get(API_PRICES_KEY))?.[API_PRICES_KEY] || {};
  await chrome.storage.local.set({ [API_PRICES_KEY]: { ...stored, [model]: { input: Number(input), output: Number(output), cached: valid(cached) ? Number(cached) : null } } });
}
