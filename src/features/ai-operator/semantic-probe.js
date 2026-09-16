import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { SIMNET_KNOWLEDGE_VERSION, knowledgeQueryFromUnderstanding, searchKnowledgeLibrary } from './knowledge/index.js';

const FALLBACK_MODELS = Object.freeze([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
]);

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
    remainingRequests: numberHeader(headers, 'x-ratelimit-remaining-requests'),
    retryAfter: oneLine(headers?.get?.('retry-after') || '', 80)
  };
}

function modelsForRuntime(runtime = {}) {
  const preferred = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  return [preferred, ...FALLBACK_MODELS].filter((model, index, all) => model && all.indexOf(model) === index);
}

async function requestModel(messages, apiKey, model, meterContext = {}, { jsonMode = true } = {}) {
  let reportedUsage = null;
  let reportedModel = model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(45_000, Number(AI_CONFIG.timeoutMs || 45_000)));
  try {
    const body = {
      model,
      temperature: 0.15,
      max_tokens: 900,
      messages
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
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
      throw error;
    }
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

async function requestJsonWithFallback(messages, runtime, meterContext = {}) {
  const failures = [];
  for (const model of modelsForRuntime(runtime).slice(0, 2)) {
    try {
      return await requestModel(messages, runtime.groqApiKey, model, meterContext, { jsonMode: true });
    } catch (error) {
      failures.push(error);
      const generation400 = Number(error?.status || 0) === 400 && /generate json|validate json|failed_generation/i.test(String(error?.message || ''));
      if (generation400) {
        try {
          return await requestModel(messages, runtime.groqApiKey, model, meterContext, { jsonMode: false });
        } catch (retryError) {
          failures.push(retryError);
        }
      }
      if ([401, 403].includes(Number(error?.status || 0))) break;
    }
  }
  throw failures.at(-1) || new Error('Semantic probe failed');
}

function transcriptForProbe(transcript = []) {
  return (Array.isArray(transcript) ? transcript : [])
    .slice(-24)
    .map(item => ({
      role: item?.role === 'customer' ? 'customer' : 'operator',
      text: block(item?.text || '', 700)
    }))
    .filter(item => item.text);
}

export function buildSubscriberIntentProbeMessages({ transcript = [], latestCustomer = {} } = {}) {
  const dialogue = transcriptForProbe(transcript);
  return [
    {
      role: 'system',
      content: `Ты анализируешь живой диалог абонента с оператором интернет-провайдера SIMNET.

Это общение с человеком, а не классификация заранее известных команд. Люди пишут неполно, с ошибками, эмоциями, намёками, сменой темы и короткими ответами. Нельзя заранее перечислить все возможные формулировки.

Твоя задача — свободно понять смысл разговора: чего человек хочет добиться, что является главным и второстепенным, к чему относится последняя реплика, какие факты он сам сообщил и что действительно остаётся неоднозначным.

Не отвечай абоненту. Не выбирай инструменты. Не проверяй Billing. Не применяй бизнес-правила. Не вычисляй суммы. Не пытайся уложить фразу в фиксированную матрицу intent/entity. Не оценивай правильность ответа прошлого оператора.

Смотри на весь доступный диалог, особенно на непосредственно предыдущую реплику оператора. Короткие ответы вроде «да», «нет», «не знаю», «а сколько?», «почему?», «а следующий?» понимай только в контексте разговора. Опечатки и смешение русского/украинского воспринимай как обычную речь.

Контекст: оператор работает у интернет-провайдера. Поэтому слова «скорость», «тариф», «роутер», «оплата», «интернет», «договор» прежде всего трактуй в контексте услуги связи, если сам диалог не указывает иначе.

Критически важно различать источник утверждения. То, что сказал клиент, является фактом о СЛОВАХ клиента, но не автоматически фактом о Billing, сети или правилах компании. То, что сказал прошлый оператор, также не считай внутренней истиной без отдельного подтверждения.

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
  "ambiguities":["только реальная неоднозначность смысла; не придумывай лишние варианты"],
  "confidence":0.0
}`
    },
    {
      role: 'user',
      content: JSON.stringify({
        dialogue,
        latest_customer_message: block(latestCustomer?.text || '', 1200)
      })
    }
  ];
}

function stringList(value, maxItems = 8, maxChars = 260) {
  return (Array.isArray(value) ? value : [])
    .map(item => oneLine(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
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
    ambiguities: stringList(value.ambiguities, 6),
    confidence: Math.max(0, Math.min(1, Number(value.confidence || 0) || 0))
  };
}

function articlePayload(article) {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    text: block(article.text, 2400)
  };
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
- гипотезы допустимы, но явно помечай их как hypothesis и объясняй, на чём они основаны;
- не создавай искусственные «неясности» и не перечисляй всё, что вообще можно было бы проверить;
- отделяй главное от второстепенного: если для понимания простого вопроса достаточно одного понятия, не тащи соседние статьи и поля;
- если клиент спрашивает о конкретном внутреннем правиле/условии SIMNET, а среди статей нет подтверждения этого правила, запиши это в knowledge_gaps. Не превращай слова клиента или прошлого оператора в правило компании;
- knowledge_gaps — только пробел внутренней энциклопедии. Не записывай туда номер договора, адрес, модель роутера, баланс и другие персональные данные, которые просто понадобятся позже из tools.

Верни только JSON:
{
  "used_articles":[{"id":"article.id","why":"чем статья реально полезна"}],
  "relevant_internal_knowledge":["только релевантные знания из прочитанных статей"],
  "how_it_applies":"как внутреннее знание уточняет понимание текущего обращения",
  "already_enough":["что уже понятно/достаточно на уровне смысла"],
  "must_not_assume":["что нельзя превращать в факт без проверки"],
  "hypotheses":[{"text":"допустимое предположение","basis":"на чём оно основано"}],
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
    .filter(item => item.id && allowed.has(item.id))
    .slice(0, 6);
}

function normalizeHypotheses(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => ({ text: oneLine(item?.text || '', 360), basis: oneLine(item?.basis || '', 420) }))
    .filter(item => item.text)
    .slice(0, 4);
}

function normalizeKnowledgeReflection(raw = {}, candidateArticles = []) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    usedArticles: normalizeUsedArticles(value.used_articles, candidateArticles),
    relevantInternalKnowledge: stringList(value.relevant_internal_knowledge, 8, 420),
    howItApplies: oneLine(value.how_it_applies || '', 800),
    alreadyEnough: stringList(value.already_enough, 6, 320),
    mustNotAssume: stringList(value.must_not_assume, 8, 360),
    hypotheses: normalizeHypotheses(value.hypotheses),
    knowledgeGaps: stringList(value.knowledge_gaps, 6, 360)
  };
}

function readableProbe(probe, knowledge) {
  const articleNames = knowledge.usedArticles.map(item => item.id).join(', ');
  return [
    probe.whatUserWants ? `1. Что хочет абонент: ${probe.whatUserWants}` : '',
    probe.latestMessageMeans ? `2. Смысл последней реплики: ${probe.latestMessageMeans}` : '',
    probe.refersTo ? `   Относится к: ${probe.refersTo}` : '',
    probe.underlyingGoal ? `   Общая цель: ${probe.underlyingGoal}` : '',
    probe.factsSaidByUser.length ? `3. Что сообщил клиент: ${probe.factsSaidByUser.join('; ')}` : '',
    probe.factsSaidByOperator.length ? `   Контекст от прошлого оператора: ${probe.factsSaidByOperator.join('; ')}` : '',
    articleNames ? `4. Что посмотрел в энциклопедии: ${articleNames}` : '4. Энциклопедия: подтверждённая релевантная статья не выбрана.',
    knowledge.relevantInternalKnowledge.length ? `   Полезное внутреннее знание: ${knowledge.relevantInternalKnowledge.join('; ')}` : '',
    knowledge.howItApplies ? `5. Как это относится к обращению: ${knowledge.howItApplies}` : '',
    knowledge.mustNotAssume.length ? `6. Нельзя считать фактом без проверки: ${knowledge.mustNotAssume.join('; ')}` : '',
    knowledge.hypotheses.length ? `7. Допустимые гипотезы: ${knowledge.hypotheses.map(item => `${item.text} (${item.basis})`).join('; ')}` : '',
    knowledge.knowledgeGaps.length ? `8. В энциклопедии пока нет подтверждённого знания: ${knowledge.knowledgeGaps.join('; ')}` : '',
    probe.ambiguities.length ? `9. Реальная неоднозначность смысла: ${probe.ambiguities.join('; ')}` : ''
  ].filter(Boolean).join('\n');
}

export async function analyzeSubscriberIntent({ transcript = [], latestCustomer = {}, meterContext = {} } = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('Groq API key is not configured');

  const semanticMessages = buildSubscriberIntentProbeMessages({ transcript, latestCustomer });
  const semanticResponse = await requestJsonWithFallback(semanticMessages, runtime, { ...meterContext, stage: 'understanding' });
  const probe = normalizeProbe(parseJsonObject(semanticResponse.answer));

  const query = knowledgeQueryFromUnderstanding({ probe, transcript, latestCustomer });
  const candidateArticles = searchKnowledgeLibrary(query, { limit: 6, minScore: 1 });
  const knowledgeMessages = buildKnowledgeReflectionMessages({ probe, candidateArticles });
  const knowledgeResponse = await requestJsonWithFallback(knowledgeMessages, runtime, { ...meterContext, stage: 'knowledge' });
  const knowledge = normalizeKnowledgeReflection(parseJsonObject(knowledgeResponse.answer), candidateArticles);

  const totalUsage = {
    prompt_tokens: Number(semanticResponse.usage?.prompt_tokens || 0) + Number(knowledgeResponse.usage?.prompt_tokens || 0),
    completion_tokens: Number(semanticResponse.usage?.completion_tokens || 0) + Number(knowledgeResponse.usage?.completion_tokens || 0),
    total_tokens: Number(semanticResponse.usage?.total_tokens || 0) + Number(knowledgeResponse.usage?.total_tokens || 0)
  };
  const promptChars = semanticMessages.reduce((sum, item) => sum + String(item.content || '').length, 0)
    + knowledgeMessages.reduce((sum, item) => sum + String(item.content || '').length, 0);

  return {
    probe,
    knowledge,
    candidates: candidateArticles.map(({ id, title, summary, score }) => ({ id, title, summary, score })),
    decision: {
      action: 'knowledge_probe',
      domain: 'understanding',
      intent: probe.whatUserWants || 'unknown',
      tool: '',
      toolArgs: {},
      reply: readableProbe(probe, knowledge),
      reason: `Свободное понимание обращения + мягкое чтение ${SIMNET_KNOWLEDGE_VERSION}; fact-runtime/fact-catalog/dialogue-state не участвуют.`,
      confidence: probe.confidence,
      language: probe.language,
      diagnostic: { understanding: probe, knowledge, candidates: candidateArticles.map(({ id, title, score }) => ({ id, title, score })) },
      model: [semanticResponse.model, knowledgeResponse.model].filter(Boolean).join(' → '),
      usage: totalUsage,
      rateLimit: knowledgeResponse.rateLimit || semanticResponse.rateLimit || {},
      promptChars
    }
  };
}
