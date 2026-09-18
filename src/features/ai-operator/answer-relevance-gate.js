import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { AI_OPERATOR_GENERATION_MODEL_POOL } from './semantic-probe.js';
import { autonomousOperatorSystemMessages } from './instructions/autonomous-operator-instruction.generated.js';

function oneLine(value, max = 600) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function block(value, max = 2600) {
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
  if (first < 0 || last <= first) throw new Error('Answer relevance gate: model did not return JSON');
  return JSON.parse(text.slice(first, last + 1));
}

function compactObject(input, maxDepth = 4, depth = 0) {
  if (depth >= maxDepth) return oneLine(input, 240);
  if (Array.isArray(input)) return input.slice(0, 10).map(item => compactObject(item, maxDepth, depth + 1));
  if (!input || typeof input !== 'object') return input;
  const output = {};
  for (const [key, value] of Object.entries(input).slice(0, 50)) {
    if (/^(?:pp|password|passwd|pass|token|secret|csrf|authorization)$/i.test(key)) continue;
    output[key] = compactObject(value, maxDepth, depth + 1);
  }
  return output;
}

function modelCandidates(runtime = {}) {
  const preferred = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  return [preferred, ...AI_OPERATOR_GENERATION_MODEL_POOL].filter((model, index, list) => model && list.indexOf(model) === index);
}

async function requestOnce(messages, runtime, model, meterContext, { jsonMode = true, temperature = 0.1 } = {}) {
  let usage = null;
  let reportedModel = model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(45_000, Number(AI_CONFIG.timeoutMs || 45_000)));
  try {
    const body = { model, temperature, max_tokens: 1100, messages };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.groqApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    usage = data?.usage || null;
    reportedModel = String(data?.model || model);
    if (!response.ok) {
      const error = new Error(`Answer relevance gate HTTP ${response.status} — ${oneLine(data?.error?.message || raw || response.statusText, 500)}`);
      error.status = response.status;
      throw error;
    }
    const choice = data?.choices?.[0] || {};
    const answer = String(choice?.message?.content || '');
    if (!answer.trim()) throw new Error('Answer relevance gate: empty response');
    return { answer, parsed: parseJsonObject(answer), model: reportedModel, usage: data?.usage || {}, finishReason: oneLine(choice?.finish_reason || '', 80) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Answer relevance gate: request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    await recordApiUsage({ ...meterContext, model: reportedModel, usage });
  }
}

async function requestGate(messages, meterContext = {}) {
  const runtime = await readAiRuntimeConfig();
  if (!String(runtime.groqApiKey || '').trim()) throw new Error('Groq API key is not configured');
  const failures = [];
  for (const model of modelCandidates(runtime)) {
    try {
      return await requestOnce(messages, runtime, model, meterContext, { jsonMode: true });
    } catch (error) {
      failures.push(error);
      const status = Number(error?.status || 0);
      if (status === 400 && /json|failed_generation|validate/i.test(String(error?.message || ''))) {
        try { return await requestOnce(messages, runtime, model, meterContext, { jsonMode: false }); }
        catch (plainError) { failures.push(plainError); }
      }
      if ([401, 403].includes(status)) break;
    }
  }
  throw failures.at(-1) || new Error('Answer relevance gate failed');
}

function normalizeItems(value, maxItems = 16) {
  return (Array.isArray(value) ? value : []).map(item => ({
    fact: oneLine(item?.fact || '', 420),
    source: oneLine(item?.source || '', 180),
    reason: oneLine(item?.reason || '', 420)
  })).filter(item => item.fact || item.reason).slice(0, maxItems);
}

function normalizeGate(raw = {}, fallbackReply = '', fallbackRequest = '') {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const completeness = oneLine(source.completeness || 'unknown', 20).toLowerCase();
  return {
    reply: block(source.reply || fallbackReply, 2200),
    answerRelevance: {
      request: oneLine(source.request || fallbackRequest, 500),
      kept: normalizeItems(source.kept),
      dropped: normalizeItems(source.dropped),
      completeness: ['complete', 'partial', 'unknown'].includes(completeness) ? completeness : 'unknown',
      conclusion: oneLine(source.conclusion || '', 700)
    }
  };
}

function evidencePayload(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : []).slice(0, 8).map(item => ({
    tool: oneLine(item?.tool || '', 100),
    ok: Boolean(item?.ok),
    code: oneLine(item?.code || '', 100),
    source: oneLine(item?.source || '', 180),
    requested_by: compactObject(item?.requestedBy || {}, 3),
    data: item?.ok ? compactObject(item?.data || {}, 4) : {},
    warnings: (Array.isArray(item?.warnings) ? item.warnings : []).slice(0, 4).map(value => oneLine(value, 240))
  }));
}

function looksLikeDegradedFallback(reply = '') {
  const text = oneLine(reply, 2200).toLowerCase();
  if (!text) return true;
  return /(?:не удалось (?:получить подтвержд[её]нные данные|сформировать|корректно сформировать)|попробуйте(?:, пожалуйста,)? (?:отправить запрос|повторить)|не буду придумывать ответ)/iu.test(text);
}

function neutralGenerationFailure(probe = {}) {
  return String(probe?.language || '').toLowerCase() === 'uk'
    ? 'Зараз не вдалося сформувати відповідь. Спробуйте, будь ласка, повторити запит.'
    : 'Сейчас не удалось сформировать ответ. Попробуйте, пожалуйста, повторить запрос.';
}

function gateReason({ degradedFallback = false, toolTrace = [], probe = {}, knowledge = {}, request = '' } = {}) {
  if (degradedFallback) return 'degraded_reply';
  if ((Array.isArray(toolTrace) ? toolTrace : []).some(item => item && !item.ok)) return 'tool_failure';
  if (Array.isArray(probe?.ambiguities) && probe.ambiguities.length) return 'semantic_ambiguity';
  if (!knowledge?.skipped && Array.isArray(knowledge?.knowledgeGaps) && knowledge.knowledgeGaps.length) return 'knowledge_gap';

  const semanticText = [
    request,
    probe?.whatUserWants,
    probe?.latestMessageMeans,
    ...(Array.isArray(probe?.unresolvedRequests) ? probe.unresolvedRequests : [])
  ].map(value => oneLine(value, 500)).join(' ').toLowerCase();

  // These are cases where a final verification pass still pays for itself:
  // debt/payment semantics, period attribution and comparative/absolute conclusions.
  if (/долж|долг|задолж|борг|к\s+оплат|списал|списан|проплачен|оплачен|за\s+какой\s+месяц|за\s+який\s+місяц|хватает\s+ли|вистачає\s+чи|до\s+конца|до\s+кінця|следующ(?:ий|его)\s+месяц|наступн(?:ий|ого)\s+місяц/iu.test(semanticText)) return 'finance_semantics';
  if (/дешев|дороже|дорожче|быстр|швидш|меньше|менше|больше|більше|раньше|раніше|позже|пізніше|лучше|краще|вариантов\s+нет|варіантів\s+немає/iu.test(semanticText)) return 'comparison_or_absolute_claim';
  return '';
}

export async function applyAnswerRelevanceGate({
  reply = '',
  analysis = {},
  toolTrace = [],
  latestCustomer = {},
  transcript = [],
  useKnowledge = true,
  meterContext = {}
} = {}) {
  const probe = analysis?.probe || {};
  const unresolved = Array.isArray(probe?.unresolvedRequests) ? probe.unresolvedRequests : [];
  const request = unresolved[0] || probe?.whatUserWants || latestCustomer?.text || '';
  const knowledge = useKnowledge ? (analysis?.knowledge || {}) : { skipped: true };
  const recentDialogue = (Array.isArray(transcript) ? transcript : []).slice(-10).map(item => ({
    role: item?.role === 'customer' ? 'customer' : 'operator',
    text: block(item?.text || '', 600)
  }));
  const toolEvidence = evidencePayload(toolTrace);
  const degradedFallback = looksLikeDegradedFallback(reply);

  if (!request || (!toolEvidence.length && knowledge?.skipped && !degradedFallback)) {
    return {
      reply: block(reply, 2200),
      answerRelevance: {
        request: oneLine(request, 500),
        kept: [],
        dropped: [],
        completeness: 'unknown',
        conclusion: ''
      },
      gate: { skipped: true, reason: 'no_grounded_candidates' }
    };
  }

  const reason = gateReason({ degradedFallback, toolTrace, probe, knowledge, request });
  if (!reason) {
    return {
      reply: block(reply, 2200),
      answerRelevance: {
        request: oneLine(request, 500),
        kept: [],
        dropped: [],
        completeness: 'complete',
        conclusion: 'Healthy synthesis accepted without an extra LLM relevance pass.'
      },
      gate: { skipped: true, reason: 'healthy_synthesis_fast_path' }
    };
  }

  const stageInstruction = `ЭТАП: ANSWER RELEVANCE + DEGRADED RECOVERY.

Ты выполняешь последний фильтр ответа Autonomous AI Operator. Главная задача — сохранить прямой ответ на текущий вопрос и убрать действительно нерелевантное. Ты не переопределяешь фундаментальные правила знания из canonical instruction.

КРИТИЧЕСКАЯ ГРАНИЦА:
- Общеизвестные знания модели разрешены. Отсутствие статьи в SIMNET KB, tool-result или snapshot НЕ означает отсутствие знания и НЕ является причиной удалять общеизвестное объяснение.
- Common knowledge может относиться к любой области, а не только к сетям: технической, математической, логической, бытовой, языковой, физической, географической и т.д.
- Проверенное evidence обязательно для конкретных внутренних/live/SIMNET-фактов: текущего баланса/тарифа/сессии/ONU/покрытия конкретного адреса, актуальных цен/акций, внутренних правил или выполненных действий.
- Не выдавай общую отраслевую практику за правило SIMNET. Но не превращай отсутствие правила SIMNET в запрет на независимый общеизвестный ответ.
- Если draft_reply является аварийной заглушкой вида «не удалось получить подтверждённые данные / попробуйте повторить», а сам текущий вопрос можно достоверно закрыть общеизвестным знанием без SIMNET/live-фактов, исправь ложный отказ и дай нормальный короткий ответ из common knowledge.
- Если вопрос действительно требует неизвестного SIMNET/live-факта, не придумывай его: сохрани честную границу UNKNOWN или необходимость проверки.

ANSWER RELEVANCE:
- Сначала зафиксируй request: какой конкретно вопрос/просьбу клиента сейчас нужно закрыть.
- Каждый доступный факт либо kept, либо dropped. Источник kept может быть dialogue, common_knowledge, reasoning, knowledge:... или tool:....
- kept — только если элемент прямо нужен для ответа. dropped — если он просто оказался рядом и не помогает ответить.
- Наличие факта в Billing/KB НЕ означает, что его надо сообщить.
- Не добавляй в reply нерелевантные dropped-факты.
- При сравнении соблюдай условие запроса. Если клиент просит БОЛЕЕ ДЕШЁВЫЙ вариант, более дорогие или равные по цене варианты не являются ответом. Аналогично для «быстрее», «меньше», «раньше» и других сравнений.
- Не подменяй вопрос соседним.
- Если подтверждённые внутренние источники не гарантируют исчерпывающий список, не говори категорично «вариантов нет». Граница должна быть видна: отсутствие внутреннего варианта не запрещает независимый общеизвестный ответ, а неизвестный SIMNET-факт остаётся UNKNOWN.
- Не выдумывай live-факты, цены, тарифы, результаты tools или внутренние правила SIMNET.
- Сохрани естественный человеческий ответ, обычно 1–3 предложения.
- Не показывай клиенту названия tools, KB, JSON или внутреннюю механику.
- Не копируй названия полей и интерфейсные ярлыки Billing/UserSide в ответ. Переводи системные значения в обычный человеческий смысл и упоминай только то, что отвечает на вопрос.

Верни только JSON:
{
  "reply":"финальный ответ клиенту после фильтра/восстановления",
  "request":"что именно клиент спрашивает сейчас",
  "kept":[{"fact":"использованный факт или общеизвестное знание","source":"dialogue|common_knowledge|reasoning|knowledge:...|tool:...","reason":"почему он нужен для ответа"}],
  "dropped":[{"fact":"доступный, но отброшенный элемент","source":"...","reason":"почему он не отвечает на запрос"}],
  "completeness":"complete|partial|unknown",
  "conclusion":"короткий операционный вывод после фильтра"
}`;

  const messages = [
    ...autonomousOperatorSystemMessages(stageInstruction),
    {
      role: 'user',
      content: JSON.stringify({
        trigger_reason: reason,
        request,
        understanding: compactObject(probe, 4),
        recent_dialogue: recentDialogue,
        internal_knowledge: useKnowledge ? compactObject({
          used_articles: knowledge?.usedArticles || [],
          article_evidence: knowledge?.articleEvidence || [],
          relevant: knowledge?.relevantInternalKnowledge || [],
          gaps: knowledge?.knowledgeGaps || []
        }, 5) : { skipped: true },
        tool_evidence: toolEvidence,
        degraded_fallback: degradedFallback,
        draft_reply: block(reply, 1800)
      })
    }
  ];

  try {
    const response = await requestGate(messages, { ...meterContext, stage: 'answer_relevance_gate' });
    const normalized = normalizeGate(response.parsed, reply, request);
    return {
      ...normalized,
      gate: { skipped: false, reason, model: response.model || '', usage: response.usage || {}, finishReason: response.finishReason || '', degraded: false }
    };
  } catch (error) {
    return {
      reply: degradedFallback ? neutralGenerationFailure(probe) : block(reply, 2200),
      answerRelevance: {
        request: oneLine(request, 500),
        kept: [],
        dropped: [],
        completeness: 'unknown',
        conclusion: ''
      },
      gate: { skipped: false, reason, degraded: true, error: oneLine(error?.message || error, 500) }
    };
  }
}
