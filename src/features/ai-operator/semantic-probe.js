import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';

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

async function requestModel(messages, apiKey, model, meterContext = {}) {
  let reportedUsage = null;
  let reportedModel = model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(45_000, Number(AI_CONFIG.timeoutMs || 45_000)));
  try {
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages
      }),
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

Сейчас твоя ЕДИНСТВЕННАЯ задача — понять смысл обращения глазами человека: ЧТО АБОНЕНТ ХОЧЕТ прямо сейчас и к чему относится его последняя реплика.

Не отвечай абоненту. Не выбирай инструменты. Не проверяй Billing. Не применяй бизнес-правила. Не вычисляй суммы. Не пытайся уложить фразу в заранее заданную матрицу intent/entity. Не оценивай правильность ответа прошлого оператора.

Смотри на весь доступный диалог, особенно на непосредственно предыдущую реплику оператора. Короткие ответы вроде «да», «нет», «не знаю», «а сколько?», «почему?», «а следующий?» понимай только в контексте разговора. Опечатки, разговорные формулировки и смешение русского/украинского воспринимай как обычную речь.

Контекст: оператор работает у интернет-провайдера. Поэтому слова «скорость», «тариф», «роутер», «оплата», «интернет», «договор» прежде всего трактуй в контексте услуги связи, если сам диалог не указывает иначе.

Верни только JSON без markdown:
{
  "language":"ru|uk|mixed|other",
  "what_user_wants":"одним предложением",
  "latest_message_means":"как именно ты понял последнюю реплику",
  "refers_to":"к чему/какой предыдущей реплике она относится; пусто если ни к чему",
  "underlying_goal":"более широкая цель клиента, если она видна",
  "known_from_dialogue":["только явно известное из диалога"],
  "assumptions":["что ты вынужден предположить"],
  "ambiguities":["что реально можно понять по-разному"],
  "would_need_to_know":["какой информации не хватает, чтобы затем нормально помочь"],
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

function stringList(value, maxItems = 6, maxChars = 220) {
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
    knownFromDialogue: stringList(value.known_from_dialogue),
    assumptions: stringList(value.assumptions),
    ambiguities: stringList(value.ambiguities),
    wouldNeedToKnow: stringList(value.would_need_to_know),
    confidence: Math.max(0, Math.min(1, Number(value.confidence || 0) || 0))
  };
}

function readableProbe(probe) {
  return [
    probe.whatUserWants ? `Что хочет: ${probe.whatUserWants}` : '',
    probe.latestMessageMeans ? `Последняя реплика: ${probe.latestMessageMeans}` : '',
    probe.refersTo ? `Относится к: ${probe.refersTo}` : '',
    probe.underlyingGoal ? `Общая цель: ${probe.underlyingGoal}` : '',
    probe.ambiguities.length ? `Неясности: ${probe.ambiguities.join('; ')}` : '',
    probe.wouldNeedToKnow.length ? `Не хватает: ${probe.wouldNeedToKnow.join('; ')}` : ''
  ].filter(Boolean).join('\n');
}

export async function analyzeSubscriberIntent({ transcript = [], latestCustomer = {}, meterContext = {} } = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('Groq API key is not configured');

  const messages = buildSubscriberIntentProbeMessages({ transcript, latestCustomer });
  const failures = [];
  for (const model of modelsForRuntime(runtime).slice(0, 2)) {
    try {
      const response = await requestModel(messages, apiKey, model, meterContext);
      const probe = normalizeProbe(parseJsonObject(response.answer));
      return {
        probe,
        decision: {
          action: 'semantic_probe',
          domain: 'understanding',
          intent: probe.whatUserWants || 'unknown',
          tool: '',
          toolArgs: {},
          reply: readableProbe(probe),
          reason: 'Свободное понимание обращения без fact-runtime, fact-catalog и dialogue-state.',
          confidence: probe.confidence,
          language: probe.language,
          diagnostic: probe,
          model: response.model || model,
          usage: response.usage || {},
          rateLimit: response.rateLimit || {},
          promptChars: messages.reduce((sum, item) => sum + String(item.content || '').length, 0)
        }
      };
    } catch (error) {
      failures.push(error);
      if ([401, 403].includes(Number(error?.status || 0))) break;
    }
  }
  throw failures.at(-1) || new Error('Semantic probe failed');
}
