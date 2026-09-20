import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { SIMNET_KNOWLEDGE_VERSION, knowledgeQueryFromUnderstanding, searchKnowledgeLibrary } from './knowledge/index.js';
import { autonomousOperatorSystemMessages } from './instructions/autonomous-operator-instruction.generated.js';
import { behaviorRuntimeHints } from './behavior-profile.js';
import { CANONICAL_FACT_PATHS, normalizeCanonicalFacts } from './canonical-fact-catalog.js';

const GENERATION_FALLBACK_MODELS = Object.freeze([
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
]);
const RETIRED_MODELS = new Set(['qwen/qwen3.6-27b']);
const PROMPT_GUARD_MODEL = 'meta-llama/llama-prompt-guard-2-86m';
const MODEL_COOLDOWNS = new Map();
const KNOWLEDGE_NEEDS = new Set(['none', 'maybe', 'needed']);
const LIVE_DATA_NEEDS = new Set(['none', 'needed']);
const KNOWLEDGE_MODES = new Set(['off', 'auto', 'on']);
const JSON_REPAIR_TOKENS = 1400;

function oneLine(value, max = 1000) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function block(value, max = 7000) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Semantic probe: model did not return JSON');
  try { return JSON.parse(text.slice(first, last + 1)); }
  catch { throw new Error('Semantic probe: model did not return valid JSON'); }
}

function numberHeader(headers, name) {
  const value = Number(headers?.get?.(name) || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function rateLimitFromHeaders(headers) {
  return {
    limitTokens: numberHeader(headers, 'x-ratelimit-limit-tokens'),
    remainingTokens: numberHeader(headers, 'x-ratelimit-remaining-tokens'),
    resetTokens: oneLine(headers?.get?.('x-ratelimit-reset-tokens') || '', 80),
    remainingRequests: numberHeader(headers, 'x-ratelimit-remaining-requests'),
    retryAfter: oneLine(headers?.get?.('retry-after') || '', 80)
  };
}

function durationMs(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return 0;
  if (/^\d+(?:\.\d+)?$/.test(source)) return Math.ceil(Number(source) * 1000);
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
  for (const match of source.matchAll(re)) {
    const amount = Number(match[1]);
    const unit = match[2];
    total += unit === 'ms' ? amount : unit === 'h' ? amount * 3600000 : unit === 'm' ? amount * 60000 : amount * 1000;
  }
  return Math.ceil(total);
}

function markRateLimited(model, rateLimit = {}) {
  const wait = Math.max(durationMs(rateLimit.retryAfter), durationMs(rateLimit.resetTokens), 5000);
  MODEL_COOLDOWNS.set(model, Date.now() + Math.min(wait + 1500, 180000));
}

function isCoolingDown(model) {
  const until = Number(MODEL_COOLDOWNS.get(model) || 0);
  if (!until) return false;
  if (until <= Date.now()) {
    MODEL_COOLDOWNS.delete(model);
    return false;
  }
  return true;
}

function modelsForRuntime(runtime = {}) {
  const preferred = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  const provider = String(runtime.provider || AI_CONFIG.provider || 'groq').trim().toLowerCase();
  if (provider !== 'groq') return preferred ? [preferred] : [];
  const all = [preferred, ...GENERATION_FALLBACK_MODELS]
    .filter((model, index, list) => model && !RETIRED_MODELS.has(model) && model !== PROMPT_GUARD_MODEL && list.indexOf(model) === index);
  const ready = all.filter(model => !isCoolingDown(model));
  return ready.length ? ready : all;
}

async function requestModel(messages, apiKey, model, meterContext = {}, {
  jsonMode = true,
  maxTokens = JSON_REPAIR_TOKENS,
  temperature = 0.15
} = {}) {
  let reportedUsage = null;
  let reportedModel = model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(45_000, Number(AI_CONFIG.timeoutMs || 45_000)));
  try {
    const body = { model, temperature, max_tokens: maxTokens, messages };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rateLimit = rateLimitFromHeaders(response.headers);
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    const promptGuardSkipped = response.headers?.get?.('x-simnet-prompt-guard-skipped') === '1'
      || data?.simnet?.prompt_guard_skipped === true;
    const promptGuardSkipReason = oneLine(data?.simnet?.reason || '', 120);
    reportedUsage = data?.usage || null;
    reportedModel = String(data?.model || model);
    if (!response.ok) {
      const error = new Error(`AI provider HTTP ${response.status} — ${oneLine(data?.error?.message || raw || response.statusText, 500)}`);
      error.status = response.status;
      error.rateLimit = rateLimit;
      if (Number(response.status) === 429) markRateLimited(model, rateLimit);
      throw error;
    }
    MODEL_COOLDOWNS.delete(model);
    const choice = data?.choices?.[0] || {};
    const answer = choice?.message?.content;
    if (!answer) throw new Error('Semantic probe: AI provider returned an empty response');
    return {
      answer: String(answer),
      model: reportedModel,
      usage: data?.usage || {},
      rateLimit,
      finishReason: oneLine(choice?.finish_reason || '', 80),
      promptGuardSkipped,
      promptGuardSkipReason
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Semantic probe: AI provider request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    await recordApiUsage({ ...meterContext, model: reportedModel, usage: reportedUsage });
  }
}

function invalidJsonError(response = {}, attempt = '') {
  const error = new Error('Semantic probe: model did not return JSON');
  error.code = 'INVALID_MODEL_JSON';
  error.model = oneLine(response?.model || '', 120);
  error.finishReason = oneLine(response?.finishReason || '', 80);
  error.rawExcerpt = block(response?.answer || '', 900);
  error.attempt = attempt;
  return error;
}

function validateJsonResponse(response, attempt = '') {
  try {
    return { ...response, parsed: parseJsonObject(response?.answer), attempt };
  } catch {
    throw invalidJsonError(response, attempt);
  }
}

function repairMessages(messages, response = {}) {
  return [
    ...messages,
    { role: 'assistant', content: block(response?.answer || '', 2200) },
    {
      role: 'user',
      content: 'Исправь только формат предыдущего ответа: верни один полный JSON-объект по исходной схеме, без markdown и пояснений.'
    }
  ];
}

async function requestJsonWithFallback(messages, runtime, meterContext = {}, requestOptions = {}) {
  const failures = [];
  const baseMaxTokens = Math.max(Number(requestOptions.maxTokens || 0), JSON_REPAIR_TOKENS);
  for (const model of modelsForRuntime(runtime)) {
    try {
      const firstResponse = await requestModel(messages, runtime.groqApiKey, model, meterContext, {
        jsonMode: true,
        ...requestOptions,
        maxTokens: baseMaxTokens
      });
      try {
        return validateJsonResponse(firstResponse, 'json');
      } catch (invalidError) {
        failures.push(invalidError);
        try {
          const repaired = await requestModel(repairMessages(messages, firstResponse), runtime.groqApiKey, model, {
            ...meterContext,
            stage: `${meterContext.stage || 'json'}_repair`
          }, { jsonMode: true, maxTokens: baseMaxTokens, temperature: 0 });
          return validateJsonResponse(repaired, 'repair');
        } catch (repairError) {
          failures.push(repairError);
        }
      }
    } catch (error) {
      failures.push(error);
      const status = Number(error?.status || 0);
      const generation400 = status === 400 && /generate json|validate json|failed_generation/i.test(String(error?.message || ''));
      if (generation400) {
        try {
          const plain = await requestModel(messages, runtime.groqApiKey, model, meterContext, {
            jsonMode: false,
            ...requestOptions,
            maxTokens: baseMaxTokens
          });
          return validateJsonResponse(plain, 'plain_json_fallback');
        } catch (retryError) {
          failures.push(retryError);
        }
      }
      if ([401, 403].includes(status)) break;
    }
  }
  const last = failures.at(-1) || new Error('Semantic probe failed');
  if (last?.code === 'INVALID_MODEL_JSON') {
    const suffix = [last.model && `model=${last.model}`, last.finishReason && `finish=${last.finishReason}`].filter(Boolean).join(', ');
    last.message = `Semantic probe: model did not return JSON${suffix ? ` (${suffix})` : ''}`;
  }
  throw last;
}

async function runPromptGuard(latestCustomer = {}, runtime = {}, meterContext = {}) {
  const text = block(latestCustomer?.text || '', 1600);
  if (!text) return { model: PROMPT_GUARD_MODEL, skipped: true, skipReason: 'empty_input', output: '', usage: {}, rateLimit: {} };
  try {
    const response = await requestModel(
      [{ role: 'user', content: text }],
      runtime.groqApiKey,
      PROMPT_GUARD_MODEL,
      { ...meterContext, stage: 'prompt_guard' },
      { jsonMode: false, maxTokens: 64, temperature: 0 }
    );
    if (response.promptGuardSkipped) {
      return {
        model: PROMPT_GUARD_MODEL,
        skipped: true,
        skipReason: response.promptGuardSkipReason || 'provider_capability_unavailable',
        output: '',
        usage: response.usage || {},
        rateLimit: response.rateLimit || {}
      };
    }
    return { model: response.model || PROMPT_GUARD_MODEL, skipped: false, skipReason: '', output: oneLine(response.answer, 500), usage: response.usage || {}, rateLimit: response.rateLimit || {} };
  } catch (error) {
    return { model: PROMPT_GUARD_MODEL, skipped: false, skipReason: '', output: '', error: oneLine(error?.message || error, 500), usage: {}, rateLimit: error?.rateLimit || {} };
  }
}

function transcriptForProbe(transcript = []) {
  return (Array.isArray(transcript) ? transcript : [])
    .slice(-24)
    .map(item => ({ role: item?.role === 'customer' ? 'customer' : 'operator', text: block(item?.text || '', 700) }))
    .filter(item => item.text);
}

export function buildSubscriberIntentProbeMessages({ transcript = [], latestCustomer = {} } = {}) {
  const dialogue = transcriptForProbe(transcript);
  const stageInstruction = `ЭТАП: UNDERSTANDING.

Выполни только semantic-разбор текущего хода. Не отвечай абоненту и не выбирай tools.
Определи смысл последней реплики в контексте диалога, её referent, активную просьбу, реальную неоднозначность и минимальные данные, без которых нельзя закрыть текущий запрос.

Если нужен текущий внутренний факт SIMNET, заполни required_facts точными путями из списка ниже и кратко опиши его в evidence_needs. Если такого факта не нужно, required_facts=[] и live_data_need=none.
Отдельно укажи, нужны ли внутренние знания SIMNET: knowledge_need=none|maybe|needed. maybe — только при конкретном сомнении, не «на всякий случай».

Разрешённые canonical facts:
${CANONICAL_FACT_PATHS.join('\n')}

Верни только JSON:
{
  "language":"ru|uk|mixed|other",
  "what_user_wants":"текущая цель одним предложением",
  "latest_message_means":"смысл последней реплики",
  "refers_to":"к чему она относится или пусто",
  "underlying_goal":"более широкая цель, если явно видна",
  "facts_said_by_user":["важные утверждения клиента для текущего контекста"],
  "facts_said_by_operator":["важные утверждения прошлого оператора для текущего контекста"],
  "unresolved_requests":["активные незакрытые просьбы"],
  "ambiguities":["только реальная неоднозначность"],
  "live_data_need":"none|needed",
  "evidence_needs":[{"system":"Billing|UserSide|Network","field":"нужный текущий факт","why":"зачем он нужен"}],
  "required_facts":["точный canonical path"],
  "knowledge_need":"none|maybe|needed",
  "knowledge_reason":"короткая причина",
  "confidence":0.0
}`;
  return [
    ...autonomousOperatorSystemMessages(stageInstruction),
    { role: 'user', content: JSON.stringify({ dialogue, latest_customer_message: block(latestCustomer?.text || '', 1200) }) }
  ];
}

function stringList(value, maxItems = 8, maxChars = 260) {
  return (Array.isArray(value) ? value : []).map(item => oneLine(item, maxChars)).filter(Boolean).slice(0, maxItems);
}

function normalizeKnowledgeNeed(value) {
  const normalized = oneLine(value || '', 20).toLowerCase();
  return KNOWLEDGE_NEEDS.has(normalized) ? normalized : 'maybe';
}

function normalizeLiveDataNeed(value) {
  const normalized = oneLine(value || '', 20).toLowerCase();
  return LIVE_DATA_NEEDS.has(normalized) ? normalized : 'none';
}

function normalizeEvidenceNeeds(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => ({
      system: oneLine(item?.system || '', 80),
      field: oneLine(item?.field || '', 180),
      why: oneLine(item?.why || '', 320)
    }))
    .filter(item => item.system || item.field || item.why)
    .filter(item => !/^[a-z]+(?:\.[a-z_]+)+\s*:?/i.test(item.field))
    .slice(0, 6);
}

function normalizeProbe(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const liveDataNeed = normalizeLiveDataNeed(value.live_data_need);
  const evidenceNeeds = normalizeEvidenceNeeds(value.evidence_needs);
  const requiredFacts = normalizeCanonicalFacts(value.required_facts);
  if (requiredFacts.length && !evidenceNeeds.length) {
    evidenceNeeds.push({
      system: 'Domain',
      field: 'канонические факты текущего запроса',
      why: 'Точные canonical paths перечислены в requiredFacts.'
    });
  }
  return {
    language: oneLine(value.language || 'other', 20).toLowerCase(),
    whatUserWants: oneLine(value.what_user_wants || '', 500),
    latestMessageMeans: oneLine(value.latest_message_means || '', 700),
    refersTo: oneLine(value.refers_to || '', 500),
    underlyingGoal: oneLine(value.underlying_goal || '', 500),
    factsSaidByUser: stringList(value.facts_said_by_user),
    factsSaidByOperator: stringList(value.facts_said_by_operator),
    unresolvedRequests: stringList(value.unresolved_requests, 8, 420),
    ambiguities: stringList(value.ambiguities, 6),
    liveDataNeed: evidenceNeeds.length ? 'needed' : liveDataNeed,
    evidenceNeeds,
    requiredFacts,
    knowledgeNeed: normalizeKnowledgeNeed(value.knowledge_need),
    knowledgeReason: oneLine(value.knowledge_reason || '', 420),
    confidence: Math.max(0, Math.min(1, Number(value.confidence || 0) || 0))
  };
}

export function shouldReadKnowledge(probe = {}) {
  return normalizeKnowledgeNeed(probe.knowledgeNeed || probe.knowledge_need) !== 'none';
}

function articlePayload(article) {
  return { id: article.id, title: article.title, summary: article.summary, text: block(article.text, 2400) };
}

export function buildKnowledgeReflectionMessages({ probe = {}, candidateArticles = [] } = {}) {
  const noCandidates = !candidateArticles.length;
  const stageInstruction = `ЭТАП: KNOWLEDGE REFLECTION.

Определи, какие из candidate_articles реально добавляют внутренние знания SIMNET к уже понятому запросу. Не отвечай абоненту и не выбирай tools.
Верни только JSON:
{
  "used_articles":[{"id":"article.id","why":"чем статья полезна"}],
  "relevant_internal_knowledge":["релевантное знание"],
  "how_it_applies":"как оно относится к запросу",
  "already_enough":["что уже достаточно для вывода"],
  "must_not_assume":["неподтверждённые внутренние/live факты"],
  "hypotheses":[{"text":"допустимое предположение","basis":"основание"}],
  "knowledge_gaps":["критически важный пробел внутреннего знания"]
}`;
  return [
    ...autonomousOperatorSystemMessages(stageInstruction),
    {
      role: 'user',
      content: JSON.stringify({
        understanding: { ...probe, unresolvedRequests: [] },
        knowledge_version: SIMNET_KNOWLEDGE_VERSION,
        retrieval_status: noCandidates ? 'no_candidate_articles_found' : 'candidate_articles_found',
        candidate_articles: candidateArticles.map(articlePayload)
      })
    }
  ];
}

function normalizeUsedArticles(value, candidateArticles) {
  const allowed = new Map(candidateArticles.map(article => [article.id, article.title]));
  return (Array.isArray(value) ? value : [])
    .map(item => ({ id: oneLine(item?.id || '', 100), why: oneLine(item?.why || '', 360) }))
    .filter(item => item.id && allowed.has(item.id)).slice(0, 6);
}

function selectedArticleEvidence(usedArticles = [], candidateArticles = []) {
  const selected = new Set((Array.isArray(usedArticles) ? usedArticles : []).map(item => item?.id).filter(Boolean));
  return (Array.isArray(candidateArticles) ? candidateArticles : [])
    .filter(article => selected.has(article?.id))
    .map(articlePayload);
}

function normalizeHypotheses(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => ({ text: oneLine(item?.text || '', 360), basis: oneLine(item?.basis || '', 420) }))
    .filter(item => item.text).slice(0, 4);
}

function normalizeKnowledgeReflection(raw = {}, candidateArticles = []) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const usedArticles = normalizeUsedArticles(value.used_articles, candidateArticles);
  return {
    skipped: false,
    skipReason: '',
    usedArticles,
    articleEvidence: selectedArticleEvidence(usedArticles, candidateArticles),
    relevantInternalKnowledge: stringList(value.relevant_internal_knowledge, 8, 420),
    howItApplies: oneLine(value.how_it_applies || '', 800),
    alreadyEnough: stringList(value.already_enough, 6, 320),
    mustNotAssume: stringList(value.must_not_assume, 8, 360),
    hypotheses: normalizeHypotheses(value.hypotheses),
    knowledgeGaps: stringList(value.knowledge_gaps, 6, 360)
  };
}

function skippedKnowledge(probe = {}, reason = 'semantic_gate_none') {
  return {
    skipped: true,
    skipReason: reason,
    usedArticles: [],
    articleEvidence: [],
    relevantInternalKnowledge: [],
    howItApplies: '',
    alreadyEnough: probe.whatUserWants ? [probe.whatUserWants] : [],
    mustNotAssume: [],
    hypotheses: [],
    knowledgeGaps: []
  };
}

function readableProbe(probe, knowledge) {
  const articleNames = knowledge.usedArticles.map(item => item.id).join(', ');
  const encyclopediaLine = knowledge.skipped
    ? `4. Энциклопедия: пропущена — ${knowledge.skipReason === 'knowledge_mode_off' ? 'режим OFF' : (probe.knowledgeReason || 'внутренние знания не нужны для понимания этой реплики')}.`
    : articleNames ? `4. Что посмотрел в энциклопедии: ${articleNames}` : '4. Энциклопедия: подтверждённая релевантная статья не выбрана.';
  return [
    probe.whatUserWants ? `1. Что хочет абонент: ${probe.whatUserWants}` : '',
    probe.latestMessageMeans ? `2. Смысл последней реплики: ${probe.latestMessageMeans}` : '',
    probe.refersTo ? `   Относится к: ${probe.refersTo}` : '',
    probe.underlyingGoal ? `   Общая цель: ${probe.underlyingGoal}` : '',
    probe.factsSaidByUser.length ? `3. Что сообщил клиент: ${probe.factsSaidByUser.join('; ')}` : '',
    probe.factsSaidByOperator.length ? `   Контекст от прошлого оператора: ${probe.factsSaidByOperator.join('; ')}` : '',
    probe.unresolvedRequests.length ? `   Незакрытые вопросы/просьбы: ${probe.unresolvedRequests.join('; ')}` : '',
    probe.liveDataNeed === 'needed' ? '   Нужны live-факты: да.' : '   Нужны live-факты: нет.',
    probe.evidenceNeeds.length ? `   Evidence needs: ${probe.evidenceNeeds.map(item => `${item.system} → ${item.field}`).join('; ')}` : '',
    encyclopediaLine,
    knowledge.relevantInternalKnowledge.length ? `   Полезное внутреннее знание: ${knowledge.relevantInternalKnowledge.join('; ')}` : '',
    knowledge.howItApplies ? `5. Как это относится к обращению: ${knowledge.howItApplies}` : '',
    knowledge.alreadyEnough.length ? `   Уже достаточно для reasoning: ${knowledge.alreadyEnough.join('; ')}` : '',
    knowledge.mustNotAssume.length ? `6. Нельзя считать фактом без проверки: ${knowledge.mustNotAssume.join('; ')}` : '',
    knowledge.hypotheses.length ? `7. Допустимые гипотезы: ${knowledge.hypotheses.map(item => `${item.text} (${item.basis})`).join('; ')}` : '',
    knowledge.knowledgeGaps.length ? `8. В энциклопедии пока нет критически важного знания: ${knowledge.knowledgeGaps.join('; ')}` : '',
    probe.ambiguities.length ? `9. Реальная неоднозначность смысла: ${probe.ambiguities.join('; ')}` : ''
  ].filter(Boolean).join('\n');
}

function usageTotal(...items) {
  return items.reduce((total, item) => ({
    prompt_tokens: total.prompt_tokens + Number(item?.usage?.prompt_tokens || 0),
    completion_tokens: total.completion_tokens + Number(item?.usage?.completion_tokens || 0),
    total_tokens: total.total_tokens + Number(item?.usage?.total_tokens || 0)
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

function normalizeKnowledgeMode(value) {
  const mode = oneLine(value || 'auto', 12).toLowerCase();
  return KNOWLEDGE_MODES.has(mode) ? mode : 'auto';
}

export async function analyzeSubscriberIntent({ transcript = [], latestCustomer = {}, meterContext = {}, knowledgeMode = 'auto' } = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('AI provider API key is not configured');
  const mode = normalizeKnowledgeMode(knowledgeMode);

  const guard = await runPromptGuard(latestCustomer, runtime, meterContext);
  const semanticMessages = buildSubscriberIntentProbeMessages({ transcript, latestCustomer });
  const semanticResponse = await requestJsonWithFallback(semanticMessages, runtime, { ...meterContext, stage: 'understanding' }, { maxTokens: JSON_REPAIR_TOKENS });
  const probe = normalizeProbe(semanticResponse.parsed || parseJsonObject(semanticResponse.answer));

  let candidateArticles = [];
  let knowledgeMessages = [];
  let knowledgeResponse = null;
  const readKnowledge = mode === 'on' || (mode === 'auto' && shouldReadKnowledge(probe));
  let knowledge = skippedKnowledge(probe, mode === 'off' ? 'knowledge_mode_off' : 'semantic_gate_none');

  if (readKnowledge) {
    const query = knowledgeQueryFromUnderstanding({ probe, latestCustomer });
    candidateArticles = searchKnowledgeLibrary(query, { limit: 4, minScore: 4 });
    if (candidateArticles.length) {
      knowledgeMessages = buildKnowledgeReflectionMessages({ probe, candidateArticles });
      knowledgeResponse = await requestJsonWithFallback(knowledgeMessages, runtime, { ...meterContext, stage: 'knowledge' }, { maxTokens: JSON_REPAIR_TOKENS });
      knowledge = normalizeKnowledgeReflection(knowledgeResponse.parsed || parseJsonObject(knowledgeResponse.answer), candidateArticles);
    } else {
      knowledge = skippedKnowledge(probe, 'no_relevant_articles');
    }
  }

  const totalUsage = usageTotal(guard, semanticResponse, knowledgeResponse);
  const promptChars = semanticMessages.reduce((sum, item) => sum + String(item.content || '').length, 0)
    + knowledgeMessages.reduce((sum, item) => sum + String(item.content || '').length, 0)
    + String(latestCustomer?.text || '').length;
  const usedKnowledge = !knowledge.skipped;

  return {
    probe,
    knowledge,
    knowledgeMode: mode,
    candidates: candidateArticles.map(({ id, title, summary, score }) => ({ id, title, summary, score })),
    decision: {
      action: 'knowledge_probe',
      domain: 'understanding',
      intent: probe.whatUserWants || 'unknown',
      tool: '', toolArgs: {},
      reply: readableProbe(probe, knowledge),
      reason: usedKnowledge
        ? `Свободное понимание обращения + чтение ${SIMNET_KNOWLEDGE_VERSION} (${mode}); fact-runtime/fact-catalog/dialogue-state не участвуют.`
        : `Свободное понимание обращения; энциклопедия пропущена (${mode}); fact-runtime/fact-catalog/dialogue-state не участвуют.`,
      confidence: probe.confidence,
      language: probe.language,
      diagnostic: {
        promptGuard: { model: guard.model, output: guard.output, error: guard.error || '', skipped: Boolean(guard.skipped), skipReason: guard.skipReason || '' },
        knowledgeGate: { mode, need: probe.knowledgeNeed, reason: probe.knowledgeReason, skipped: knowledge.skipped },
        evidencePlan: { liveDataNeed: probe.liveDataNeed, needs: probe.evidenceNeeds },
        understanding: probe,
        knowledge,
        candidates: candidateArticles.map(({ id, title, score }) => ({ id, title, score }))
      },
      model: [guard.skipped ? '' : guard.model, semanticResponse.model, knowledgeResponse?.model].filter(Boolean).join(' → '),
      usage: totalUsage,
      rateLimit: knowledgeResponse?.rateLimit || semanticResponse.rateLimit || guard.rateLimit || {},
      promptChars,
      semanticDiagnostics: {
        model: semanticResponse.model || '',
        finishReason: semanticResponse.finishReason || '',
        repaired: semanticResponse.attempt === 'repair'
      }
    }
  };
}

function behaviorProfile(value = {}) {
  return behaviorRuntimeHints(value);
}

function compactBehaviorGuidance(profile = {}) {
  return `Поведенческий профиль: человекоподобность=${profile.humanLikeness}/5, развернутость=${profile.depth}/5, инициативность=${profile.initiative}/5. Используй его только для тона, объёма и уместного следующего шага; правила AUTONOMOUS_OPERATOR имеют приоритет. Не задавай больше ${profile.maxFollowUpQuestions} уточняющих вопросов.`;
}

function normalizeDataNeeds(value) {
  return (Array.isArray(value) ? value : []).map(item => ({
    system: oneLine(item?.system || '', 80), field: oneLine(item?.field || '', 120), why: oneLine(item?.why || '', 320)
  })).filter(item => item.system || item.field || item.why).slice(0, 6);
}

function normalizeBehaviorEffects(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    naturalness: oneLine(source.naturalness || source.human_likeness || source.directness || '', 260),
    depth: oneLine(source.depth || source.brevity || source.clarification || '', 260),
    initiative: oneLine(source.initiative || '', 260)
  };
}

function normalizeRelevanceItems(value, maxItems = 12) {
  return (Array.isArray(value) ? value : []).map(item => ({
    fact: oneLine(item?.fact || item?.value || '', 420),
    source: oneLine(item?.source || '', 160),
    reason: oneLine(item?.reason || '', 420)
  })).filter(item => item.fact || item.reason).slice(0, maxItems);
}

function normalizeAnswerRelevance(value = {}, fallbackRequest = '') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const completeness = oneLine(source.completeness || 'unknown', 20).toLowerCase();
  return {
    request: oneLine(source.request || fallbackRequest || '', 500),
    kept: normalizeRelevanceItems(source.kept),
    dropped: normalizeRelevanceItems(source.dropped),
    completeness: ['complete', 'partial', 'unknown'].includes(completeness) ? completeness : 'unknown',
    conclusion: oneLine(source.conclusion || '', 700)
  };
}

function answerPayload(analysis = {}, useKnowledge = true) {
  const probe = analysis?.probe || {};
  const knowledge = useKnowledge ? (analysis?.knowledge || {}) : skippedKnowledge(probe, 'answer_variant_without_knowledge');
  return {
    understanding: probe,
    internal_knowledge: {
      enabled: Boolean(useKnowledge && !knowledge.skipped),
      used_articles: (knowledge.usedArticles || []).map(item => item.id),
      article_evidence: knowledge.articleEvidence || [],
      relevant: knowledge.relevantInternalKnowledge || [],
      how_it_applies: knowledge.howItApplies || '',
      already_enough: knowledge.alreadyEnough || [],
      must_not_assume: knowledge.mustNotAssume || [],
      knowledge_gaps: knowledge.knowledgeGaps || []
    }
  };
}

function replySchemaPrompt(profile, capabilities) {
  const style = compactBehaviorGuidance(profile);
  return `ЭТАП: FINAL ANSWER.

Сформируй ответ абоненту по правилам AUTONOMOUS_OPERATOR, используя dialogue и grounded_context. Это финальный ответ текущего хода, а не новый semantic-анализ и не отчёт о reasoning.
Если для ответа всё ещё реально не хватает конкретного subscriber-факта, укажи его в subscriber_data_needed; иначе оставь массив пустым.

${style}

Верни только JSON:
{
  "reply":"готовый ответ абоненту",
  "subscriber_data_needed":[{"system":"Billing|UserSide|Network","field":"нужный факт","why":"зачем он нужен"}],
  "clarification_questions":["вопросы, реально заданные в reply"],
  "verification_needed":["что всё ещё нельзя подтвердить"],
  "next_step_offered":"следующий шаг или пусто"
}`;
}

export async function generateSubscriberReply({
  transcript = [],
  latestCustomer = {},
  analysis = {},
  useKnowledge = true,
  behavior = {},
  capabilities = { billing: false, userside: false, network: false },
  meterContext = {}
} = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('AI provider API key is not configured');
  const profile = behaviorProfile(behavior);
  const dialogue = transcriptForProbe(transcript);
  const grounded = answerPayload(analysis, useKnowledge);
  const messages = [
    ...autonomousOperatorSystemMessages(replySchemaPrompt(profile, capabilities)),
    {
      role: 'user',
      content: JSON.stringify({
        dialogue,
        latest_customer_message: block(latestCustomer?.text || '', 1200),
        grounded_context: grounded,
        behavior_profile: profile,
        capabilities
      })
    }
  ];
  const response = await requestJsonWithFallback(messages, runtime, { ...meterContext, stage: useKnowledge ? 'reply_with_knowledge' : 'reply_without_knowledge' }, { maxTokens: 900, temperature: 0.2 });
  const raw = response.parsed || parseJsonObject(response.answer);
  const reply = block(raw?.reply || '', 2200);
  if (!reply) throw new Error('Semantic reply: model returned an empty reply');
  const fallbackRequest = analysis?.probe?.whatUserWants || analysis?.probe?.unresolvedRequests?.[0] || '';
  return {
    reply,
    subscriberDataNeeded: normalizeDataNeeds(raw?.subscriber_data_needed),
    unresolvedRequests: [],
    clarificationQuestions: stringList(raw?.clarification_questions, profile.maxFollowUpQuestions, 360),
    verificationNeeded: stringList(raw?.verification_needed, 8, 360),
    nextStepOffered: oneLine(raw?.next_step_offered || '', 500),
    basis: [],
    answerRelevance: normalizeAnswerRelevance({}, fallbackRequest),
    behaviorEffects: normalizeBehaviorEffects({}),
    behavior: profile,
    model: response.model,
    usage: response.usage || {},
    rateLimit: response.rateLimit || {},
    finishReason: response.finishReason || ''
  };
}

export async function generateGroundedSubscriberReply({
  transcript = [],
  latestCustomer = {},
  analysis = {},
  useKnowledge = true,
  behavior = {},
  canonicalFactEvidence = [],
  toolEvidence = [],
  meterContext = {}
} = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('AI provider API key is not configured');
  const profile = behaviorProfile(behavior);
  const dialogue = transcriptForProbe(transcript);
  const grounded = answerPayload(analysis, useKnowledge);
  const stageInstruction = `ЭТАП: FINAL ANSWER AFTER READ.

READ уже выполнен. Ответь абоненту по правилам AUTONOMOUS_OPERATOR, используя dialogue, grounded_context и переданный evidence. Не запускай новый semantic-разбор.
Для canonical_fact_evidence: status=known — значение подтверждено; status=absent — источник успешно наблюдал пустое поле; status=unknown — факт не подтверждён. Для tool_evidence учитывай только реально возвращённые поля.

${compactBehaviorGuidance(profile)}

Верни только JSON:
{
  "reply":"готовый ответ абоненту",
  "subscriber_data_needed":[{"system":"Billing|UserSide|Network","field":"факт, без которого ответ всё ещё нельзя закрыть","why":"зачем он нужен"}],
  "clarification_questions":["вопросы, реально заданные в reply"],
  "verification_needed":["что всё ещё нельзя подтвердить"],
  "next_step_offered":"следующий шаг или пусто"
}`;
  const messages = [
    ...autonomousOperatorSystemMessages(stageInstruction),
    {
      role: 'user',
      content: JSON.stringify({
        dialogue,
        latest_customer_message: block(latestCustomer?.text || '', 1200),
        grounded_context: grounded,
        canonical_fact_evidence: canonicalFactEvidence,
        tool_evidence: toolEvidence,
        behavior_profile: profile
      })
    }
  ];
  const response = await requestJsonWithFallback(messages, runtime, { ...meterContext, stage: 'tool_synthesis' }, { maxTokens: 900, temperature: 0.2 });
  const raw = response.parsed || parseJsonObject(response.answer);
  const reply = block(raw?.reply || '', 2200);
  if (!reply) throw new Error('Grounded semantic reply: model returned an empty reply');
  const fallbackRequest = analysis?.probe?.whatUserWants || analysis?.probe?.unresolvedRequests?.[0] || '';
  return {
    reply,
    subscriberDataNeeded: normalizeDataNeeds(raw?.subscriber_data_needed),
    unresolvedRequests: [],
    clarificationQuestions: stringList(raw?.clarification_questions, profile.maxFollowUpQuestions, 360),
    verificationNeeded: stringList(raw?.verification_needed, 8, 360),
    nextStepOffered: oneLine(raw?.next_step_offered || '', 500),
    basis: [],
    answerRelevance: normalizeAnswerRelevance({}, fallbackRequest),
    behaviorEffects: {},
    behavior: profile,
    model: response.model,
    usage: response.usage || {},
    rateLimit: response.rateLimit || {},
    finishReason: response.finishReason || ''
  };
}

export async function generateCleanModelReply({
  transcript = [],
  latestCustomer = {},
  behavior = {},
  meterContext = {}
} = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('AI provider API key is not configured');
  const profile = behaviorProfile(behavior);
  const dialogue = transcriptForProbe(transcript);
  const messages = [
    {
      role: 'system',
      content: `Ты оператор первой линии обычного интернет-провайдера. Ответь человеку по смыслу диалога и общеизвестным знаниям. У тебя нет внутренних данных SIMNET, Billing/UserSide/Network и нельзя изображать их наличие.\n\n${compactBehaviorGuidance(profile)}\n\nВерни только JSON: {"reply":"ответ человеку","clarification_questions":[],"verification_needed":[]}`
    },
    { role: 'user', content: JSON.stringify({ dialogue, latest_customer_message: block(latestCustomer?.text || '', 1200) }) }
  ];
  const response = await requestJsonWithFallback(messages, runtime, { ...meterContext, stage: 'clean_model_reply' }, { maxTokens: 800, temperature: 0.25 });
  const raw = response.parsed || parseJsonObject(response.answer);
  const reply = block(raw?.reply || '', 2200);
  if (!reply) throw new Error('Clean model reply: model returned an empty reply');
  return {
    reply,
    subscriberDataNeeded: [],
    unresolvedRequests: [],
    clarificationQuestions: stringList(raw?.clarification_questions, profile.maxFollowUpQuestions, 360),
    verificationNeeded: stringList(raw?.verification_needed, 8, 360),
    nextStepOffered: '',
    basis: ['dialogue', 'clean-model'],
    answerRelevance: normalizeAnswerRelevance({}, latestCustomer?.text || ''),
    behaviorEffects: {},
    behavior: profile,
    model: response.model,
    usage: response.usage || {},
    rateLimit: response.rateLimit || {},
    finishReason: response.finishReason || '',
    cleanModel: true
  };
}

export const AI_OPERATOR_GENERATION_MODEL_POOL = [...GENERATION_FALLBACK_MODELS];
export const AI_OPERATOR_PROMPT_GUARD_MODEL = PROMPT_GUARD_MODEL;
export const AI_OPERATOR_KNOWLEDGE_MODES = [...KNOWLEDGE_MODES];
