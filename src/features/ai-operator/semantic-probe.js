import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { SIMNET_KNOWLEDGE_VERSION, knowledgeQueryFromUnderstanding, searchKnowledgeLibrary } from './knowledge/index.js';

const GENERATION_FALLBACK_MODELS = Object.freeze([
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
]);
const PROMPT_GUARD_MODEL = 'meta-llama/llama-prompt-guard-2-86m';
const MODEL_COOLDOWNS = new Map();
const KNOWLEDGE_NEEDS = new Set(['none', 'maybe', 'needed']);
const KNOWLEDGE_MODES = new Set(['off', 'auto', 'on']);

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
  return JSON.parse(text.slice(first, last + 1));
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
    remainingRequests: numberHeader(headers?.get?.('x-ratelimit-remaining-requests')),
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
  const all = [preferred, ...GENERATION_FALLBACK_MODELS]
    .filter((model, index, list) => model && model !== PROMPT_GUARD_MODEL && list.indexOf(model) === index);
  const ready = all.filter(model => !isCoolingDown(model));
  return ready.length ? ready : all;
}

async function requestModel(messages, apiKey, model, meterContext = {}, {
  jsonMode = true,
  maxTokens = 900,
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
    reportedUsage = data?.usage || null;
    reportedModel = String(data?.model || model);
    if (!response.ok) {
      const error = new Error(`Groq HTTP ${response.status} — ${oneLine(data?.error?.message || raw || response.statusText, 500)}`);
      error.status = response.status;
      error.rateLimit = rateLimit;
      if (Number(response.status) === 429) markRateLimited(model, rateLimit);
      throw error;
    }
    MODEL_COOLDOWNS.delete(model);
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('Semantic probe: Groq returned an empty response');
    return { answer: String(answer), model: reportedModel, usage: data?.usage || {}, rateLimit };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Semantic probe: Groq request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    await recordApiUsage({ ...meterContext, model: reportedModel, usage: reportedUsage });
  }
}

async function requestJsonWithFallback(messages, runtime, meterContext = {}, requestOptions = {}) {
  const failures = [];
  for (const model of modelsForRuntime(runtime)) {
    try {
      return await requestModel(messages, runtime.groqApiKey, model, meterContext, { jsonMode: true, ...requestOptions });
    } catch (error) {
      failures.push(error);
      const status = Number(error?.status || 0);
      const generation400 = status === 400 && /generate json|validate json|failed_generation/i.test(String(error?.message || ''));
      if (generation400) {
        try {
          return await requestModel(messages, runtime.groqApiKey, model, meterContext, { jsonMode: false, ...requestOptions });
        } catch (retryError) {
          failures.push(retryError);
        }
      }
      if ([401, 403].includes(status)) break;
    }
  }
  throw failures.at(-1) || new Error('Semantic probe failed');
}

async function runPromptGuard(latestCustomer = {}, runtime = {}, meterContext = {}) {
  const text = block(latestCustomer?.text || '', 1600);
  if (!text) return { model: PROMPT_GUARD_MODEL, skipped: true, output: '', usage: {}, rateLimit: {} };
  try {
    const response = await requestModel(
      [{ role: 'user', content: text }],
      runtime.groqApiKey,
      PROMPT_GUARD_MODEL,
      { ...meterContext, stage: 'prompt_guard' },
      { jsonMode: false, maxTokens: 64, temperature: 0 }
    );
    return { model: response.model || PROMPT_GUARD_MODEL, skipped: false, output: oneLine(response.answer, 500), usage: response.usage || {}, rateLimit: response.rateLimit || {} };
  } catch (error) {
    return { model: PROMPT_GUARD_MODEL, skipped: false, output: '', error: oneLine(error?.message || error, 500), usage: {}, rateLimit: error?.rateLimit || {} };
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
  return [
    {
      role: 'system',
      content: `Ты анализируешь живой диалог абонента с оператором интернет-провайдера SIMNET.

Это общение с человеком, а не классификация заранее известных команд. Люди пишут неполно, с ошибками, эмоциями, намёками, сменой темы и короткими ответами. Нельзя заранее перечислить все возможные формулировки.

Твоя задача — свободно понять смысл разговора: чего человек хочет добиться, что является главным и второстепенным, к чему относится последняя реплика, какие факты он сам сообщил, какие вопросы/просьбы ещё не закрыты и что действительно остаётся неоднозначным.

Не отвечай абоненту. Не выбирай инструменты. Не проверяй Billing. Не применяй бизнес-правила. Не вычисляй суммы. Не пытайся уложить фразу в фиксированную матрицу intent/entity. Не оценивай правильность ответа прошлого оператора.

Смотри на весь доступный диалог, особенно на непосредственно предыдущую реплику оператора. Короткие ответы вроде «да», «нет», «не знаю», «а сколько?», «почему?», «а следующий?» понимай только в контексте разговора. Опечатки и смешение русского/украинского воспринимай как обычную речь. Служебные кнопки/пункты меню сами по себе не означают смену реальной темы, если последующий контекст этого не подтверждает.

Контекст: оператор работает у интернет-провайдера. Поэтому слова «скорость», «тариф», «роутер», «оплата», «интернет», «договор» прежде всего трактуй в контексте услуги связи, если сам диалог не указывает иначе.

Критически важно различать источник утверждения. То, что сказал клиент, является фактом о СЛОВАХ клиента, но не автоматически фактом о Billing, сети или правилах компании. То, что сказал прошлый оператор, также не считай внутренней истиной без отдельного подтверждения.

Также реши, даст ли внутренняя энциклопедия SIMNET реальную пользу именно на ЭТОМ ходе. Это не классификация темы и не keyword routing.
- knowledge_need=none: смысл реплики уже понятен и внутренние правила/знания компании ничего существенного не добавят. Обычно это приветствие/завершение, служебный выбор меню, предоставление запрошенного номера договора или адреса, простое подтверждение/отрицание, ожидание оператора и другие понятные из диалога реплики.
- knowledge_need=needed: вопрос реально зависит от внутренних знаний SIMNET — тарифов, цен, условий услуг, бизнес-правил, технических принципов, внутренних процессов или значения данных.
- knowledge_need=maybe: есть разумное сомнение, поможет ли справочник. Используй редко; не выбирай maybe просто «на всякий случай».
Не открывай энциклопедию только потому, что в реплике встретилось слово про интернет, договор, роутер или оплату.

Перед результатом мысленно проверь: «Я описываю то, что действительно следует из разговора, или то, что сам додумал?»

Верни только JSON без markdown:
{
  "language":"ru|uk|mixed|other",
  "what_user_wants":"одним предложением",
  "latest_message_means":"как именно ты понял последнюю реплику",
  "refers_to":"к чему/какой предыдущей реплике она относится; пусто если ни к чему",
  "underlying_goal":"более широкая цель клиента, если она видна",
  "facts_said_by_user":["только то, что клиент реально сообщил/утверждает"],
  "facts_said_by_operator":["важные утверждения прошлого оператора, если они влияют на контекст"],
  "unresolved_requests":["реальные незакрытые вопросы/просьбы клиента из текущего диалога"],
  "ambiguities":["только реальная неоднозначность смысла; не придумывай лишние варианты"],
  "knowledge_need":"none|maybe|needed",
  "knowledge_reason":"коротко: что именно энциклопедия может добавить или почему она не нужна",
  "confidence":0.0
}`
    },
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

function normalizeProbe(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
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
  return [
    {
      role: 'system',
      content: `Ты продолжаешь разбор обращения абонента SIMNET. Первый этап уже понял человеческий смысл разговора. Перед тобой КАНДИДАТНЫЕ статьи внутренней энциклопедии SIMNET. Иногда список может быть пустым: это означает только, что поиск не нашёл подходящей подтверждённой статьи.

Энциклопедия — справочник, а не сценарий и не приказ. Не подгоняй обращение под статью. Используй только ту информацию, которая действительно помогает понять конкретную ситуацию. Разрешено признать, что ни одна статья не нужна.

Не отвечай абоненту и не выбирай tools. Твоя задача — показать, что полезного внутренние знания добавляют к пониманию кейса.

Правила достоверности:
- не придумывай правил, цен, фактов Billing/сети или выполненных действий;
- утверждение клиента остаётся customer_claim, пока внутренний источник его не подтвердил;
- утверждение прошлого оператора не становится автоматически фактом энциклопедии;
- гипотеза допустима только если у неё есть конкретное основание в диалоге, прочитанной статье или технической причинно-следственной связи. Не добавляй «типичную практику отрасли», штрафы, сроки, документы и другие общие догадки, которых нет в источниках;
- не создавай искусственные «неясности» и не перечисляй всё, что вообще можно было бы проверить;
- отделяй главное от второстепенного: если для понимания простого вопроса достаточно одного понятия, не тащи соседние статьи и поля;
- если клиент спрашивает о конкретном внутреннем правиле/условии SIMNET, а среди статей нет подтверждения этого правила, запиши это в knowledge_gaps. Не превращай слова клиента или прошлого оператора в правило компании;
- knowledge_gaps — только пробел внутренней энциклопедии. Не записывай туда номер договора, адрес, модель роутера, баланс, текущий тариф конкретного договора и другие персональные/live-данные, которые должны прийти из Billing/UserSide/сети.

Верни только JSON:
{
  "used_articles":[{"id":"article.id","why":"чем статья реально полезна"}],
  "relevant_internal_knowledge":["только релевантные знания из прочитанных статей"],
  "how_it_applies":"как внутреннее знание уточняет понимание текущего обращения",
  "already_enough":["что уже понятно/достаточно на уровне смысла"],
  "must_not_assume":["что нельзя превращать в факт без проверки"],
  "hypotheses":[{"text":"допустимое предположение","basis":"конкретное основание из диалога/KB/технической логики"}],
  "knowledge_gaps":["какого внутреннего правила/знания SIMNET нет в энциклопедии, если это действительно важно"]
}`
    },
    {
      role: 'user',
      content: JSON.stringify({
        understanding: probe,
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
    encyclopediaLine,
    knowledge.relevantInternalKnowledge.length ? `   Полезное внутреннее знание: ${knowledge.relevantInternalKnowledge.join('; ')}` : '',
    knowledge.howItApplies ? `5. Как это относится к обращению: ${knowledge.howItApplies}` : '',
    knowledge.mustNotAssume.length ? `6. Нельзя считать фактом без проверки: ${knowledge.mustNotAssume.join('; ')}` : '',
    knowledge.hypotheses.length ? `7. Допустимые гипотезы: ${knowledge.hypotheses.map(item => `${item.text} (${item.basis})`).join('; ')}` : '',
    knowledge.knowledgeGaps.length ? `8. В энциклопедии пока нет подтверждённого знания: ${knowledge.knowledgeGaps.join('; ')}` : '',
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
  if (!apiKey) throw new Error('Groq API key is not configured');
  const mode = normalizeKnowledgeMode(knowledgeMode);

  const guard = await runPromptGuard(latestCustomer, runtime, meterContext);
  const semanticMessages = buildSubscriberIntentProbeMessages({ transcript, latestCustomer });
  const semanticResponse = await requestJsonWithFallback(semanticMessages, runtime, { ...meterContext, stage: 'understanding' });
  const probe = normalizeProbe(parseJsonObject(semanticResponse.answer));

  let candidateArticles = [];
  let knowledgeMessages = [];
  let knowledgeResponse = null;
  const readKnowledge = mode === 'on' || (mode === 'auto' && shouldReadKnowledge(probe));
  let knowledge = skippedKnowledge(probe, mode === 'off' ? 'knowledge_mode_off' : 'semantic_gate_none');

  if (readKnowledge) {
    const query = knowledgeQueryFromUnderstanding({ probe, transcript, latestCustomer });
    candidateArticles = searchKnowledgeLibrary(query, { limit: 6, minScore: 1 });
    knowledgeMessages = buildKnowledgeReflectionMessages({ probe, candidateArticles });
    knowledgeResponse = await requestJsonWithFallback(knowledgeMessages, runtime, { ...meterContext, stage: 'knowledge' });
    knowledge = normalizeKnowledgeReflection(parseJsonObject(knowledgeResponse.answer), candidateArticles);
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
        promptGuard: { model: guard.model, output: guard.output, error: guard.error || '', skipped: Boolean(guard.skipped) },
        knowledgeGate: { mode, need: probe.knowledgeNeed, reason: probe.knowledgeReason, skipped: knowledge.skipped },
        understanding: probe,
        knowledge,
        candidates: candidateArticles.map(({ id, title, score }) => ({ id, title, score }))
      },
      model: [guard.model, semanticResponse.model, knowledgeResponse?.model].filter(Boolean).join(' → '),
      usage: totalUsage,
      rateLimit: knowledgeResponse?.rateLimit || semanticResponse.rateLimit || guard.rateLimit || {},
      promptChars
    }
  };
}

function clampBehavior(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function behaviorProfile(value = {}) {
  return {
    confidenceStyle: clampBehavior(value.confidenceStyle, 45),
    curiosity: clampBehavior(value.curiosity, 55),
    initiative: clampBehavior(value.initiative, 50),
    skepticism: clampBehavior(value.skepticism, 75),
    brevity: clampBehavior(value.brevity, 65),
    maxFollowUpQuestions: Math.max(1, Math.min(3, Math.round(Number(value.maxFollowUpQuestions || 2))))
  };
}

function normalizeDataNeeds(value) {
  return (Array.isArray(value) ? value : []).map(item => ({
    system: oneLine(item?.system || '', 80), field: oneLine(item?.field || '', 120), why: oneLine(item?.why || '', 320)
  })).filter(item => item.system || item.field || item.why).slice(0, 6);
}

function normalizeBehaviorEffects(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    directness: oneLine(source.directness || '', 260),
    clarification: oneLine(source.clarification || '', 260),
    verification: oneLine(source.verification || '', 260),
    initiative: oneLine(source.initiative || '', 260),
    brevity: oneLine(source.brevity || '', 260)
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
      must_not_assume: knowledge.mustNotAssume || [],
      knowledge_gaps: knowledge.knowledgeGaps || []
    }
  };
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
  if (!apiKey) throw new Error('Groq API key is not configured');
  const profile = behaviorProfile(behavior);
  const dialogue = transcriptForProbe(transcript);
  const grounded = answerPayload(analysis, useKnowledge);
  const messages = [
    {
      role: 'system',
      content: `Ты формируешь ответ абоненту как оператор интернет-провайдера SIMNET. Это лабораторный режим: нужно показать, как будущий оператор ответил бы сейчас, но нельзя изображать выполненную проверку, которой не было.

Главное — естественный полезный ответ человеку на языке разговора. Не показывай внутренние JSON-поля, названия стадий AI, chain-of-thought или скрытые рассуждения.

НЕИЗМЕНЯЕМЫЕ правила достоверности, которые сильнее любых настроек поведения:
- не выдумывай баланс, текущий тариф конкретного договора, платежи, адрес, состояние сессии/OLT/ONU/BRAS, аварию или выполненную проверку;
- customer_claim и слова прошлого оператора не являются подтверждёнными фактами системы;
- внутреннее правило/цена SIMNET можно утверждать только если оно присутствует в переданном internal_knowledge;
- internal_knowledge.article_evidence содержит прямой текст выбранных статей энциклопедии и является подтверждённым внутренним источником. Если нужный факт есть там, используй его; не отвечай, что подтверждённых данных нет только потому, что поле internal_knowledge.relevant пустое или неполное;
- если internal_knowledge.enabled=false, не используй из памяти конкретные внутренние тарифы, цены, акции или процедуры SIMNET;
- если для точного ответа нужны live-данные конкретного абонента, явно не придумывай их. Сформулируй, что именно нужно проверить/уточнить. Если это блокирует полноценный ответ, допустимо кратко сказать, что в текущем лабораторном режиме live-данные не подключены;
- не добавляй «обычную практику отрасли» как замену отсутствующему правилу SIMNET;
- не теряй незакрытый вопрос клиента только потому, что в конце сообщения есть «спасибо», «уже работает» или другая социальная реплика.

Поведенческий профиль 0–100 влияет на МАНЕРУ и выбор полезного следующего шага, но никогда не ослабляет правила правдивости:
- Решительность ${profile.confidenceStyle}: чем выше, тем прямее формулируй рабочий вывод при достаточных основаниях; при низком значении чаще обозначай неопределённость.
- Любопытство ${profile.curiosity}: чем выше, тем активнее замечай реально мешающие пробелы контекста и задавай полезные уточнения. Не более ${profile.maxFollowUpQuestions} уточняющих вопросов за ход.
- Инициативность ${profile.initiative}: чем выше, тем охотнее предложи один разумный следующий шаг после прямого ответа.
- Скепсис ${profile.skepticism}: чем выше, тем внимательнее отделяй слова клиента от подтверждённых фактов и отмечай, что требует проверки.
- Краткость ${profile.brevity}: чем выше, тем короче ответ. Не жертвуй необходимой информацией ради краткости.

Capabilities сейчас: Billing=${capabilities.billing ? 'ON' : 'OFF'}, UserSide=${capabilities.userside ? 'ON' : 'OFF'}, Network=${capabilities.network ? 'ON' : 'OFF'}.

Верни только JSON без markdown. Поля diagnostics — короткое операционное резюме, НЕ chain-of-thought:
{
  "reply":"готовый ответ абоненту",
  "subscriber_data_needed":[{"system":"Billing|UserSide|Network","field":"что нужно прочитать","why":"зачем"}],
  "unresolved_requests":["что из просьб клиента ещё остаётся незакрытым после этого ответа"],
  "clarification_questions":["какие вопросы реально заданы в reply"],
  "verification_needed":["что требует проверки перед утверждением"],
  "next_step_offered":"какой следующий шаг предложен; пусто если нет",
  "basis":["dialogue","knowledge:article.id"],
  "behavior_effects":{
    "directness":"как профиль повлиял на прямоту ответа",
    "clarification":"почему задано/не задано уточнение",
    "verification":"как применён скепсис",
    "initiative":"почему предложен/не предложен следующий шаг",
    "brevity":"как выбран объём"
  }
}`
    },
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
  const response = await requestJsonWithFallback(messages, runtime, { ...meterContext, stage: useKnowledge ? 'reply_with_knowledge' : 'reply_without_knowledge' }, { maxTokens: 700, temperature: 0.2 });
  const raw = parseJsonObject(response.answer);
  const reply = block(raw?.reply || '', 2200);
  if (!reply) throw new Error('Semantic reply: model returned an empty reply');
  return {
    reply,
    subscriberDataNeeded: normalizeDataNeeds(raw?.subscriber_data_needed),
    unresolvedRequests: stringList(raw?.unresolved_requests, 8, 420),
    clarificationQuestions: stringList(raw?.clarification_questions, profile.maxFollowUpQuestions, 360),
    verificationNeeded: stringList(raw?.verification_needed, 8, 360),
    nextStepOffered: oneLine(raw?.next_step_offered || '', 500),
    basis: stringList(raw?.basis, 10, 160),
    behaviorEffects: normalizeBehaviorEffects(raw?.behavior_effects),
    behavior: profile,
    model: response.model,
    usage: response.usage || {},
    rateLimit: response.rateLimit || {}
  };
}

export const AI_OPERATOR_GENERATION_MODEL_POOL = [...GENERATION_FALLBACK_MODELS];
export const AI_OPERATOR_PROMPT_GUARD_MODEL = PROMPT_GUARD_MODEL;
export const AI_OPERATOR_KNOWLEDGE_MODES = [...KNOWLEDGE_MODES];