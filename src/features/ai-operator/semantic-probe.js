import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { SIMNET_KNOWLEDGE_VERSION, knowledgeQueryFromUnderstanding, searchKnowledgeLibrary } from './knowledge/index.js';
import { autonomousOperatorSystemMessages } from './instructions/autonomous-operator-instruction.generated.js';

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
    remainingRequests: numberHeader(headers?.get?.('x-ratelimit-remaining-requests') || '', 80),
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
    const choice = data?.choices?.[0] || {};
    const answer = choice?.message?.content;
    if (!answer) throw new Error('Semantic probe: Groq returned an empty response');
    return {
      answer: String(answer),
      model: reportedModel,
      usage: data?.usage || {},
      rateLimit,
      finishReason: oneLine(choice?.finish_reason || '', 80)
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Semantic probe: Groq request timeout');
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
      content: 'Предыдущий ответ не является завершённым валидным JSON. Исправь только формат: верни один полный JSON-объект по исходной схеме, без markdown, пояснений и текста до/после JSON.'
    }
  ];
}

async function requestJsonWithFallback(messages, runtime, meterContext = {}, requestOptions = {}) {
  const failures = [];
  const baseMaxTokens = Math.max(Number(requestOptions.maxTokens || 0), JSON_REPAIR_TOKENS);
  for (const model of modelsForRuntime(runtime)) {
    let firstResponse = null;
    try {
      firstResponse = await requestModel(messages, runtime.groqApiKey, model, meterContext, {
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
  const stageInstruction = `ЭТАП: UNDERSTANDING.

Это общение с человеком, а не классификация заранее известных команд. Не отвечай абоненту, не выбирай tools, не проверяй Billing и не применяй бизнес-правила. На этом этапе только пойми человеческий смысл разговора: чего человек хочет добиться, к чему относится последняя реплика, какие утверждения реально прозвучали, какие просьбы ещё не закрыты и где есть настоящая неоднозначность смысла.

Смотри на весь доступный диалог, особенно на непосредственно предыдущую реплику оператора. Короткие ответы понимай только в контексте разговора. Контекст — работа интернет-провайдера, если сам диалог не указывает иначе. Служебные кнопки/пункты меню сами по себе не означают смену реальной темы; служебный выбор меню также не является новой темой без подтверждения контекстом.

Различай источник утверждения: слова клиента и прошлого оператора являются контекстом, но не автоматически фактом Billing, сети или SIMNET. Перед результатом проверь: описываешь ли ты то, что действительно следует из разговора, а не то, что сам додумал.

Отдельно определи, зависит ли существенная часть ответа от ТЕКУЩЕГО факта конкретного абонента или системы, который нельзя честно получить из самого диалога/общеизвестного знания:
- live_data_need=none — текущий READ не нужен; например, вопрос общий, смысловой, арифметический по уже данным числам или ответ уже следует из подтверждённого контекста;
- live_data_need=needed — нужен свежий/подтверждённый факт Billing, UserSide или Network.
Если нужен live-факт, перечисли evidence_needs как факты, а НЕ tools и НЕ команды. Например: system=Billing, field="current balance" или field="current tariff". Не пиши названия функций вроде billing.balance. Не добавляй договор/login/адрес как отдельный evidence_need только потому, что они технически нужны для поиска: это идентификатор, а не факт ответа. Не перечисляй соседние данные «на всякий случай» — только то, без чего нельзя закрыть реальную просьбу.

Также оцени, даст ли внутренняя энциклопедия SIMNET реальную пользу именно на ЭТОМ ходе:
- knowledge_need=none: внутренние правила/знания ничего существенного не добавят;
- knowledge_need=needed: ответ реально зависит от внутренних знаний SIMNET;
- knowledge_need=maybe: есть конкретное разумное сомнение. Не выбирай maybe «на всякий случай».
Не открывай энциклопедию только потому, что встретилось общее слово про интернет, договор, роутер или оплату.

Не выполняй арифметику и не решай сам запрос на этой стадии: зафиксируй смысл так, чтобы следующая стадия могла рассуждать по уже известным фактам.

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
  "live_data_need":"none|needed",
  "evidence_needs":[{"system":"Billing|UserSide|Network","field":"какой текущий факт нужно подтвердить, без названия tool","why":"почему этот факт нужен для текущей просьбы"}],
  "knowledge_need":"none|maybe|needed",
  "knowledge_reason":"коротко: что именно энциклопедия может добавить или почему она не нужна",
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

Первый этап уже понял смысл разговора. Перед тобой кандидатные статьи внутренней энциклопедии SIMNET. Энциклопедия — справочник, а не сценарий: это источник подтверждённых внутренних знаний, не готовый ответ и не право отменять обычное reasoning.

Не отвечай абоненту и не выбирай tools. Определи только, что релевантного knowledge действительно добавляет к текущему запросу.

Критически важно:
- если уже известных фактов достаточно для обычного логического, арифметического, технического или семантического вывода, не создавай дополнительные blockers;
- не превращай гипотетическую скидку, редкое исключение, возможное особое условие или любой сценарий «а вдруг» в обязательный недостающий факт, если в текущем dialogue/evidence/article нет признака, что он реально применим;
- knowledge может ограничить вывод только конкретным подтверждённым условием, которое действительно относится к этому обращению;
- already_enough перечисляет то, чего уже достаточно для дальнейшего вывода;
- must_not_assume защищает от выдумывания live/internal фактов, но НЕ запрещает арифметику, сравнение, семантическую интерпретацию и логические следствия из уже известных фактов;
- customer_claim остаётся сообщением клиента, а не подтверждённым внутренним фактом;
- гипотеза допустима только если у неё есть конкретное основание. Сам факт, что нечто теоретически возможно, основанием не является;
- не добавляй «типичную практику отрасли», штрафы, сроки, документы и другие общие догадки, которых нет в источниках;
- отделяй главное от второстепенного и не перечисляй всё, что вообще можно было бы проверить;
- если клиент спрашивает о конкретном внутреннем правиле SIMNET, а подтверждения нет, не превращай слова клиента или прошлого оператора в правило компании;
- knowledge_gaps — только пробел внутренней энциклопедии, действительно важный для ответа. Не записывай туда номер договора, адрес, модель роутера, баланс, текущий тариф конкретного договора и другие персональные/live-данные; не создавай пробелы «на всякий случай».

Верни только JSON:
{
  "used_articles":[{"id":"article.id","why":"чем статья реально полезна"}],
  "relevant_internal_knowledge":["только релевантные знания из прочитанных статей"],
  "how_it_applies":"как внутреннее знание уточняет текущий запрос, не подменяя reasoning",
  "already_enough":["каких уже известных фактов достаточно для следующего вывода"],
  "must_not_assume":["только действительно непроверенные live/internal факты, которые нельзя выдумывать"],
  "hypotheses":[{"text":"допустимое предположение","basis":"конкретное основание из диалога/KB/технической логики"}],
  "knowledge_gaps":["только критически важное отсутствующее внутреннее знание SIMNET"]
}`;
  return [
    ...autonomousOperatorSystemMessages(stageInstruction),
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
  if (!apiKey) throw new Error('Groq API key is not configured');
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
    const query = knowledgeQueryFromUnderstanding({ probe, transcript, latestCustomer });
    candidateArticles = searchKnowledgeLibrary(query, { limit: 6, minScore: 1 });
    knowledgeMessages = buildKnowledgeReflectionMessages({ probe, candidateArticles });
    knowledgeResponse = await requestJsonWithFallback(knowledgeMessages, runtime, { ...meterContext, stage: 'knowledge' }, { maxTokens: JSON_REPAIR_TOKENS });
    knowledge = normalizeKnowledgeReflection(knowledgeResponse.parsed || parseJsonObject(knowledgeResponse.answer), candidateArticles);
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
        evidencePlan: { liveDataNeed: probe.liveDataNeed, needs: probe.evidenceNeeds },
        understanding: probe,
        knowledge,
        candidates: candidateArticles.map(({ id, title, score }) => ({ id, title, score }))
      },
      model: [guard.model, semanticResponse.model, knowledgeResponse?.model].filter(Boolean).join(' → '),
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
  return `ЭТАП: ANSWER SYNTHESIS.

Сформируй естественный полезный ответ абоненту на языке разговора. Это лабораторный режим: нельзя изображать выполненную проверку, которой не было.

Сначала проверь, достаточно ли уже переданных фактов для обычного логического, арифметического, технического или семантического вывода. Если достаточно — сделай вывод и ответь. Не добавляй subscriber_data_needed или уточняющий вопрос только из-за гипотетического исключения, скидки, особого условия, редкой неисправности или другого «а вдруг», если evidence не показывает, что оно реально применимо.

subscriber_data_needed допускается только для конкретного отсутствующего факта, без которого нельзя достоверно закрыть существенную часть запроса. Если основной ответ уже надёжен, дай его первым; второстепенную неопределённость не превращай в блокировку всего ответа.

НЕИЗМЕНЯЕМЫЕ правила достоверности:
- не выдумывай баланс, текущий тариф конкретного договора, платежи, адрес, состояние сессии/OLT/ONU/BRAS, аварию или выполненную проверку;
- customer_claim и слова прошлого оператора не являются подтверждёнными фактами системы;
- внутреннее правило/цена SIMNET можно утверждать только если оно присутствует в переданном internal_knowledge или уже подтверждено переданным live/snapshot evidence;
- internal_knowledge.article_evidence содержит прямой текст выбранных статей; используй его семантически, а не как готовый сценарий;
- internal_knowledge.already_enough специально показывает факты, которых уже достаточно для reasoning: не игнорируй их ради лишней проверки;
- internal_knowledge.must_not_assume запрещает выдумывать факты, но не запрещает арифметику, сравнение и логический вывод;
- если internal_knowledge.enabled=false, не используй из памяти конкретные внутренние тарифы, цены, акции или процедуры SIMNET;
- не добавляй «обычную практику отрасли» как замену отсутствующему правилу SIMNET;
- не теряй незакрытый вопрос клиента из-за социальной реплики.

ANSWER RELEVANCE GATE:
1. Возьми главный текущий unresolved request / what_user_wants.
2. Используй только факты, которые прямо помогают ответить на него.
3. Для сравнительного запроса применяй условие сравнения.
4. Если источник не гарантирует полный перечень вариантов, не делай абсолютный вывод об их отсутствии.
5. Не выгружай соседние данные только потому, что они доступны.

Поведенческий профиль влияет на манеру, но не отменяет central instruction и правила правдивости:
- Решительность ${profile.confidenceStyle};
- Любопытство ${profile.curiosity};
- Инициативность ${profile.initiative};
- Скепсис ${profile.skepticism};
- Краткость ${profile.brevity};
- не более ${profile.maxFollowUpQuestions} уточняющих вопросов за ход.

Capabilities: Billing=${capabilities.billing ? 'ON' : 'OFF'}, UserSide=${capabilities.userside ? 'ON' : 'OFF'}, Network=${capabilities.network ? 'ON' : 'OFF'}.

Верни только JSON без markdown. diagnostics — короткое операционное резюме, не chain-of-thought:
{
  "reply":"готовый ответ абоненту",
  "subscriber_data_needed":[{"system":"Billing|UserSide|Network","field":"конкретный действительно необходимый факт","why":"почему без него нельзя закрыть существенную часть запроса"}],
  "unresolved_requests":["что реально осталось незакрытым после ответа"],
  "clarification_questions":["какие вопросы реально заданы в reply"],
  "verification_needed":["что действительно нельзя утверждать без проверки"],
  "next_step_offered":"следующий шаг или пусто",
  "basis":["dialogue","knowledge:article.id"],
  "answer_relevance":{
    "request":"какой конкретно вопрос/просьбу сейчас закрываем",
    "kept":[{"fact":"релевантный факт","source":"dialogue|knowledge:...|tool:...","reason":"почему он отвечает на запрос"}],
    "dropped":[{"fact":"доступный, но неиспользованный факт","source":"...","reason":"почему он не относится к запросу"}],
    "completeness":"complete|partial|unknown",
    "conclusion":"короткий вывод"
  },
  "behavior_effects":{
    "directness":"как профиль повлиял на прямоту",
    "clarification":"почему задано/не задано уточнение",
    "verification":"как применён скепсис",
    "initiative":"почему предложен/не предложен следующий шаг",
    "brevity":"как выбран объём"
  }
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
  if (!apiKey) throw new Error('Groq API key is not configured');
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
  const response = await requestJsonWithFallback(messages, runtime, { ...meterContext, stage: useKnowledge ? 'reply_with_knowledge' : 'reply_without_knowledge' }, { maxTokens: 1000, temperature: 0.2 });
  const raw = response.parsed || parseJsonObject(response.answer);
  const reply = block(raw?.reply || '', 2200);
  if (!reply) throw new Error('Semantic reply: model returned an empty reply');
  const fallbackRequest = analysis?.probe?.unresolvedRequests?.[0] || analysis?.probe?.whatUserWants || '';
  return {
    reply,
    subscriberDataNeeded: normalizeDataNeeds(raw?.subscriber_data_needed),
    unresolvedRequests: stringList(raw?.unresolved_requests, 8, 420),
    clarificationQuestions: stringList(raw?.clarification_questions, profile.maxFollowUpQuestions, 360),
    verificationNeeded: stringList(raw?.verification_needed, 8, 360),
    nextStepOffered: oneLine(raw?.next_step_offered || '', 500),
    basis: stringList(raw?.basis, 10, 160),
    answerRelevance: normalizeAnswerRelevance(raw?.answer_relevance, fallbackRequest),
    behaviorEffects: normalizeBehaviorEffects(raw?.behavior_effects),
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
  if (!apiKey) throw new Error('Groq API key is not configured');
  const profile = behaviorProfile(behavior);
  const dialogue = transcriptForProbe(transcript);
  const messages = [
    {
      role: 'system',
      content: `Ты оператор первой линии обычного интернет-провайдера и отвечаешь человеку в живом чате. У тебя НЕТ внутренней базы SIMNET, НЕТ Billing/UserSide/сетевых tools, НЕТ списка тарифов, цен, внутренних процедур и специальных правил компании. Не притворяйся, что знаешь их.

Пойми реплику по смыслу и ответь естественно. Можно использовать сам диалог и устойчивые общеизвестные знания модели из любых областей, если они не требуют актуальной проверки. Нельзя выдавать такие знания за конкретный внутренний факт SIMNET, текущее состояние договора/абонента или другой live/current факт. Если вопрос требует конкретных внутренних или текущих данных, честно обозначь, чего именно не хватает, без выдумывания.

Не показывай внутренние рассуждения. Ответ обычно 1–3 коротких предложения. Краткость=${profile.brevity}, инициативность=${profile.initiative}, любопытство=${profile.curiosity}.

Верни только JSON:
{
  "reply":"ответ человеку",
  "unresolved_requests":["что осталось незакрыто"],
  "clarification_questions":["вопросы, реально заданные в reply"],
  "verification_needed":["какие внутренние данные потребовались бы"],
  "answer_relevance":{"request":"что спросили","kept":[{"fact":"что использовано из диалога или общеизвестного знания","source":"dialogue|common_knowledge","reason":"почему релевантно"}],"dropped":[],"completeness":"complete|partial|unknown","conclusion":"короткий вывод"}
}`
    },
    { role: 'user', content: JSON.stringify({ dialogue, latest_customer_message: block(latestCustomer?.text || '', 1200) }) }
  ];
  const response = await requestJsonWithFallback(messages, runtime, { ...meterContext, stage: 'clean_model_reply' }, { maxTokens: 900, temperature: 0.25 });
  const raw = response.parsed || parseJsonObject(response.answer);
  const reply = block(raw?.reply || '', 2200);
  if (!reply) throw new Error('Clean model reply: model returned an empty reply');
  return {
    reply,
    subscriberDataNeeded: [],
    unresolvedRequests: stringList(raw?.unresolved_requests, 8, 420),
    clarificationQuestions: stringList(raw?.clarification_questions, profile.maxFollowUpQuestions, 360),
    verificationNeeded: stringList(raw?.verification_needed, 8, 360),
    nextStepOffered: '',
    basis: ['dialogue', 'clean-model'],
    answerRelevance: normalizeAnswerRelevance(raw?.answer_relevance, latestCustomer?.text || ''),
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
