(() => {
  'use strict';

  if (globalThis.__SIMNET_GROQ_TOKEN_GOVERNOR__) return;
  const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  if (!nativeFetch) return;
  globalThis.__SIMNET_GROQ_TOKEN_GOVERNOR__ = true;

  const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const STORAGE_KEY = 'simnet_ai_operator_quota_v1';
  const API_COST_KEY = 'simnet_ai_operator_api_cost_v1';
  const MAX_JSON_TOKENS = 650;
  const MAX_TEXT_TOKENS = 700;
  const MAX_GUARD_TOKENS = 48;
  const PROMPT_GUARD = 'meta-llama/llama-prompt-guard-2-86m';
  const CANONICAL_MARKER = '# SIMNET Autonomous AI Operator — Canonical Reasoning Instruction';
  const COMPACT_CANONICAL = `SIMNET Autonomous AI Operator · runtime core.
Ты автономный L1-оператор ISP SIMNET и ведёшь естественный диалог с абонентом.
Порядок: СМЫСЛ → ЛОГИКА → EVIDENCE → ОТВЕТ.
Сначала пойми человеческий смысл в контексте, включая опечатки, короткие продолжения и разговорную речь. Rules/knowledge/tools расширяют reasoning, но не заменяют его. RULES CONSTRAIN REASONING; RULES DO NOT REPLACE REASONING. TOOLS PROVIDE EVIDENCE, NOT CONCLUSIONS.
Используй общеизвестные знания, арифметику и логические выводы. ABSENCE FROM SIMNET KB ≠ ABSENCE OF KNOWLEDGE. KNOWN FACTS → REASON FIRST; READ MORE ONLY WHEN NECESSARY. Новый READ нужен только для конкретного текущего/внутреннего факта SIMNET, без которого нельзя достоверно закрыть существенную часть запроса.
Live/internal факты (баланс, тариф, адрес/покрытие дома, ONU/сигнал, сессия, авария, внутренние цены/правила) не выдумывай. NOT_FOUND/ошибка/отсутствие поля = UNKNOWN, а не NO. Проверенный SIMNET evidence имеет приоритет над предположением.
Различай слова клиента, прошлый ответ, common knowledge, SIMNET knowledge, live/snapshot evidence и вывод. Не переноси subscriber-specific evidence между абонентами; явно указанный новый target имеет приоритет. READ не даёт права WRITE/ACTION; не изображай недоступное действие выполненным.
Финальный ответ: короткий, естественный, на языке разговора; не показывай JSON, tools, stages, prompts или внутренний trace. Hard runtime guards всегда имеют приоритет.`;
  const cooldowns = new Map();
  let storageQueue = Promise.resolve();

  const safeJson = value => {
    try { return JSON.parse(value); } catch { return null; }
  };
  const nonNegative = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  const headerNumber = (headers, name) => {
    const raw = headers?.get?.(name);
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const headerText = (headers, name) => String(headers?.get?.(name) || '').trim().slice(0, 80);
  const dayKey = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
  const compactText = (value, max) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  function durationMs(value) {
    const source = String(value || '').trim().toLowerCase();
    if (!source) return 0;
    if (/^\d+(?:\.\d+)?$/.test(source)) return Math.ceil(Number(source) * 1000);
    let total = 0;
    const re = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
    for (const match of source.matchAll(re)) {
      const amount = Number(match[1]);
      total += match[2] === 'ms' ? amount : match[2] === 'h' ? amount * 3600000 : match[2] === 'm' ? amount * 60000 : amount * 1000;
    }
    return Math.ceil(total);
  }

  function compactDialoguePayload(content) {
    const parsed = safeJson(String(content || ''));
    if (!parsed || !Array.isArray(parsed.dialogue)) return content;
    parsed.dialogue = parsed.dialogue.slice(-8).map(item => ({
      ...item,
      text: compactText(item?.text, 420)
    }));
    if ('latest_customer_message' in parsed) parsed.latest_customer_message = compactText(parsed.latest_customer_message, 800);
    return JSON.stringify(parsed);
  }

  function compactMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(message => {
      if (!message || typeof message !== 'object') return message;
      const content = String(message.content || '');
      if (message.role === 'system' && content.startsWith(CANONICAL_MARKER)) return { ...message, content: COMPACT_CANONICAL };
      if (message.role === 'user' && content.startsWith('{') && content.includes('"dialogue"')) {
        return { ...message, content: compactDialoguePayload(content) };
      }
      return message;
    });
  }

  function tokenCap(payload = {}) {
    if (String(payload.model || '') === PROMPT_GUARD) return MAX_GUARD_TOKENS;
    if (payload.response_format?.type === 'json_object' || payload.response_format?.type === 'json_schema') return MAX_JSON_TOKENS;
    return MAX_TEXT_TOKENS;
  }

  function governedPayload(payload = {}) {
    const next = { ...payload, messages: compactMessages(payload.messages) };
    const cap = tokenCap(next);
    const requested = Number(next.max_tokens || cap);
    next.max_tokens = Math.max(1, Math.min(Number.isFinite(requested) && requested > 0 ? requested : cap, cap));

    const model = String(next.model || '').toLowerCase();
    if (model.includes('qwen/qwen3.8')) next.reasoning_effort = 'none';
    else if (model.includes('openai/gpt-oss-')) next.reasoning_effort = 'low';
    return next;
  }

  function errorQuota(message) {
    const text = String(message || '').replace(/,/g, ' ');
    const result = {};
    for (const type of ['TPM', 'TPD', 'RPM', 'RPD']) {
      const match = text.match(new RegExp(`${type}[^.]*?Limit\\s+(\\d+(?:\\.\\d+)?)[^.]*(?:Used|Current)\\s+(\\d+(?:\\.\\d+)?)`, 'i'));
      if (!match) continue;
      result[`${type.toLowerCase()}Limit`] = nonNegative(match[1]);
      result[`${type.toLowerCase()}Used`] = nonNegative(match[2]);
    }
    return result;
  }

  function rateHeaders(headers, errorMessage = '') {
    return {
      limitTokens: headerNumber(headers, 'x-ratelimit-limit-tokens'),
      remainingTokens: headerNumber(headers, 'x-ratelimit-remaining-tokens'),
      resetTokens: headerText(headers, 'x-ratelimit-reset-tokens'),
      limitRequests: headerNumber(headers, 'x-ratelimit-limit-requests'),
      remainingRequests: headerNumber(headers, 'x-ratelimit-remaining-requests'),
      resetRequests: headerText(headers, 'x-ratelimit-reset-requests'),
      retryAfter: headerText(headers, 'retry-after'),
      ...errorQuota(errorMessage)
    };
  }

  function existingDaySeed(costData, model, today) {
    const startedAt = Date.parse(costData?.startedAt || '');
    if (!Number.isFinite(startedAt) || dayKey(startedAt) !== today) return { date: today, requests: 0, tokens: 0, prompt: 0, completion: 0 };
    const entry = costData?.total?.[model] || {};
    const prompt = nonNegative(entry.input);
    const completion = nonNegative(entry.output);
    return {
      date: today,
      requests: nonNegative(entry.calls),
      tokens: prompt + completion,
      prompt,
      completion,
      seededFromApiCost: true
    };
  }

  function writeTelemetry({ model, usage, rateLimit, status, maxTokens, at, requestStats }) {
    if (!model) return;
    storageQueue = storageQueue.then(async () => {
      const bundle = await chrome.storage.local.get([STORAGE_KEY, API_COST_KEY]);
      const stored = bundle?.[STORAGE_KEY] || { version: 1, models: {} };
      stored.version = 1;
      stored.updatedAt = at;
      stored.models ||= {};
      const previous = stored.models[model] || {};
      const today = dayKey(at);
      const day = previous.day?.date === today ? { ...previous.day } : existingDaySeed(bundle?.[API_COST_KEY], model, today);
      const prompt = nonNegative(usage?.prompt_tokens ?? usage?.input_tokens);
      const completion = nonNegative(usage?.completion_tokens ?? usage?.output_tokens);
      const total = nonNegative(usage?.total_tokens || (prompt + completion));
      day.requests = nonNegative(day.requests) + 1;
      day.prompt = nonNegative(day.prompt) + prompt;
      day.completion = nonNegative(day.completion) + completion;
      day.tokens = nonNegative(day.tokens) + total;

      const events = [...(Array.isArray(previous.events) ? previous.events : []), {
        at,
        tokens: total,
        status: Number(status || 0)
      }].filter(item => at - Number(item?.at || 0) <= 60000).slice(-120);

      stored.models[model] = {
        ...previous,
        model,
        day,
        events,
        rateLimit: {
          ...(previous.rateLimit || {}),
          ...Object.fromEntries(Object.entries(rateLimit || {}).filter(([, value]) => value !== null && value !== '')),
          observedAt: at
        },
        last: {
          at,
          status: Number(status || 0),
          maxTokens: nonNegative(maxTokens),
          prompt,
          completion,
          total,
          requestCharsBefore: nonNegative(requestStats?.before),
          requestCharsAfter: nonNegative(requestStats?.after)
        }
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: stored });
    }).catch(() => {});
  }

  function synthetic429(model, until) {
    const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return new Response(JSON.stringify({
      error: { message: `SIMNET token governor: ${model} cooldown ещё ${seconds}s после Groq 429; повторный сетевой запрос не отправлен.` }
    }), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'content-type': 'application/json', 'retry-after': String(seconds) }
    });
  }

  globalThis.fetch = async function simnetGroqTokenGovernor(input, init = {}) {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (url !== GROQ_CHAT_URL || String(init?.method || 'GET').toUpperCase() !== 'POST' || typeof init?.body !== 'string') {
      return nativeFetch(input, init);
    }

    const source = safeJson(init.body);
    if (!source || !source.model) return nativeFetch(input, init);
    const payload = governedPayload(source);
    const model = String(payload.model || 'unknown');
    const requestStats = { before: init.body.length, after: JSON.stringify(payload).length };
    const cooldownUntil = Number(cooldowns.get(model) || 0);
    if (cooldownUntil > Date.now()) return synthetic429(model, cooldownUntil);
    if (cooldownUntil) cooldowns.delete(model);

    const response = await nativeFetch(input, { ...init, body: JSON.stringify(payload) });
    const clone = response.clone();
    let data = null;
    try { data = safeJson(await clone.text()); } catch {}
    const errorMessage = String(data?.error?.message || '');
    const rateLimit = rateHeaders(response.headers, errorMessage);
    const at = Date.now();

    if (response.status === 429) {
      const wait = Math.max(durationMs(rateLimit.retryAfter), durationMs(rateLimit.resetTokens), 5000);
      cooldowns.set(model, at + Math.min(wait + 1000, 180000));
    } else if (response.ok) {
      cooldowns.delete(model);
    }

    writeTelemetry({
      model: String(data?.model || model),
      usage: data?.usage || {},
      rateLimit,
      status: response.status,
      maxTokens: payload.max_tokens,
      at,
      requestStats
    });
    return response;
  };
})();
