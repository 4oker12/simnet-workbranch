(() => {
  'use strict';

  if (globalThis.__SIMNET_GROQ_TOKEN_GOVERNOR__) return;
  const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  if (!nativeFetch) return;
  globalThis.__SIMNET_GROQ_TOKEN_GOVERNOR__ = true;

  const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const STORAGE_KEY = 'simnet_ai_operator_quota_v1';
  const MAX_JSON_TOKENS = 650;
  const MAX_TEXT_TOKENS = 700;
  const MAX_GUARD_TOKENS = 48;
  const PROMPT_GUARD = 'meta-llama/llama-prompt-guard-2-86m';
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

  function tokenCap(payload = {}) {
    if (String(payload.model || '') === PROMPT_GUARD) return MAX_GUARD_TOKENS;
    if (payload.response_format?.type === 'json_object' || payload.response_format?.type === 'json_schema') return MAX_JSON_TOKENS;
    return MAX_TEXT_TOKENS;
  }

  function governedPayload(payload = {}) {
    const next = { ...payload };
    const cap = tokenCap(next);
    const requested = Number(next.max_tokens || cap);
    next.max_tokens = Math.max(1, Math.min(Number.isFinite(requested) && requested > 0 ? requested : cap, cap));

    const model = String(next.model || '').toLowerCase();
    if (model.includes('qwen/qwen3.8')) next.reasoning_effort = 'none';
    else if (model.includes('openai/gpt-oss-')) next.reasoning_effort = 'low';
    return next;
  }

  function rateHeaders(headers) {
    return {
      limitTokens: headerNumber(headers, 'x-ratelimit-limit-tokens'),
      remainingTokens: headerNumber(headers, 'x-ratelimit-remaining-tokens'),
      resetTokens: headerText(headers, 'x-ratelimit-reset-tokens'),
      limitRequests: headerNumber(headers, 'x-ratelimit-limit-requests'),
      remainingRequests: headerNumber(headers, 'x-ratelimit-remaining-requests'),
      resetRequests: headerText(headers, 'x-ratelimit-reset-requests'),
      retryAfter: headerText(headers, 'retry-after')
    };
  }

  function writeTelemetry({ model, usage, rateLimit, status, maxTokens, at }) {
    if (!model) return;
    storageQueue = storageQueue.then(async () => {
      const stored = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] || { version: 1, models: {} };
      stored.version = 1;
      stored.updatedAt = at;
      stored.models ||= {};
      const previous = stored.models[model] || {};
      const today = dayKey(at);
      const day = previous.day?.date === today ? { ...previous.day } : { date: today, requests: 0, tokens: 0, prompt: 0, completion: 0 };
      day.requests = nonNegative(day.requests) + 1;
      day.prompt = nonNegative(day.prompt) + nonNegative(usage?.prompt_tokens ?? usage?.input_tokens);
      day.completion = nonNegative(day.completion) + nonNegative(usage?.completion_tokens ?? usage?.output_tokens);
      day.tokens = nonNegative(day.tokens) + nonNegative(usage?.total_tokens || (nonNegative(usage?.prompt_tokens ?? usage?.input_tokens) + nonNegative(usage?.completion_tokens ?? usage?.output_tokens)));

      const events = [...(Array.isArray(previous.events) ? previous.events : []), {
        at,
        tokens: nonNegative(usage?.total_tokens || (nonNegative(usage?.prompt_tokens ?? usage?.input_tokens) + nonNegative(usage?.completion_tokens ?? usage?.output_tokens))),
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
          prompt: nonNegative(usage?.prompt_tokens ?? usage?.input_tokens),
          completion: nonNegative(usage?.completion_tokens ?? usage?.output_tokens),
          total: nonNegative(usage?.total_tokens)
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
    const cooldownUntil = Number(cooldowns.get(model) || 0);
    if (cooldownUntil > Date.now()) return synthetic429(model, cooldownUntil);
    if (cooldownUntil) cooldowns.delete(model);

    const response = await nativeFetch(input, { ...init, body: JSON.stringify(payload) });
    const clone = response.clone();
    let data = null;
    try { data = safeJson(await clone.text()); } catch {}
    const rateLimit = rateHeaders(response.headers);
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
      at
    });
    return response;
  };
})();
