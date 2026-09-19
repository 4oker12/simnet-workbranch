(() => {
  'use strict';

  if (globalThis.__SIMNET_AI_PROVIDER_ROUTER__) return;
  const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  if (!nativeFetch) return;
  globalThis.__SIMNET_AI_PROVIDER_ROUTER__ = true;

  const CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
  const GROQ_BASE = 'https://api.groq.com/openai/v1';
  const DEEPSEEK_BASE = 'https://api.deepseek.com';
  const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';
  const PROMPT_GUARD_MODEL = 'meta-llama/llama-prompt-guard-2-86m';
  const JSON_REPAIR_TOKENS = 1400;

  let cachedConfig = null;

  function normalizeProvider(value) {
    return String(value || '').trim().toLowerCase() === 'deepseek' ? 'deepseek' : 'groq';
  }

  function normalizeDeepSeekModel(value) {
    const model = String(value || '').trim();
    return model === 'deepseek-v4-pro' || model === 'deepseek-flash' ? model : DEEPSEEK_DEFAULT_MODEL;
  }

  function safeJson(value) {
    try { return JSON.parse(value); } catch { return null; }
  }

  function parseJsonObject(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const direct = safeJson(text);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    const extracted = safeJson(text.slice(first, last + 1));
    return extracted && typeof extracted === 'object' && !Array.isArray(extracted) ? extracted : null;
  }

  function usageTotal(...items) {
    return items.reduce((total, item) => {
      const usage = item && typeof item === 'object' ? item : {};
      total.prompt_tokens += Number(usage.prompt_tokens || 0);
      total.completion_tokens += Number(usage.completion_tokens || 0);
      total.total_tokens += Number(usage.total_tokens || 0);
      return total;
    }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  }

  async function readConfig() {
    if (cachedConfig) return cachedConfig;
    try {
      const raw = (await chrome.storage.local.get(CONFIG_KEY))?.[CONFIG_KEY] || {};
      cachedConfig = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      cachedConfig = {};
    }
    return cachedConfig;
  }

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes?.[CONFIG_KEY]) return;
      const raw = changes[CONFIG_KEY].newValue || {};
      cachedConfig = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    });
  } catch {}

  function routeUrl(url) {
    if (!url.startsWith(GROQ_BASE)) return url;
    const suffix = url.slice(GROQ_BASE.length) || '';
    return `${DEEPSEEK_BASE}${suffix}`;
  }

  function rewriteDeepSeekBody(rawBody, config) {
    if (typeof rawBody !== 'string' || !rawBody) return { body: rawBody, payload: null, promptGuard: false };
    const payload = safeJson(rawBody);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { body: rawBody, payload: null, promptGuard: false };

    if (String(payload.model || '') === PROMPT_GUARD_MODEL) {
      return { body: rawBody, payload, promptGuard: true };
    }

    const next = { ...payload };
    next.model = normalizeDeepSeekModel(config.chatModel || config.model);

    // Groq-specific knobs must not leak into another provider. DeepSeek uses
    // OpenAI-compatible max_tokens and manages its own thinking/cache policy.
    if (next.max_completion_tokens != null && next.max_tokens == null) {
      next.max_tokens = next.max_completion_tokens;
    }
    delete next.max_completion_tokens;
    delete next.reasoning_format;
    delete next.reasoning_effort;
    delete next.disable_tool_validation;

    return { body: JSON.stringify(next), payload: next, promptGuard: false };
  }

  function syntheticPromptGuardSkip() {
    return new Response(JSON.stringify({
      model: 'simnet-local-prompt-guard-skip',
      choices: [{ finish_reason: 'stop', message: { content: 'safe' } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      simnet: { prompt_guard_skipped: true, reason: 'provider_capability_unavailable' }
    }), {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json',
        'x-simnet-prompt-guard-skipped': '1'
      }
    });
  }

  function expectsJsonObject(payload = {}) {
    return payload?.response_format?.type === 'json_object' && Array.isArray(payload?.messages);
  }

  function repairPayload(payload = {}, invalidContent = '') {
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    return {
      ...payload,
      temperature: 0,
      max_tokens: Math.max(Number(payload.max_tokens || 0), JSON_REPAIR_TOKENS),
      response_format: { type: 'json_object' },
      messages: [
        ...messages,
        { role: 'assistant', content: String(invalidContent || '').slice(0, 4000) },
        {
          role: 'user',
          content: 'Предыдущий ответ не является завершённым валидным JSON. Исправь только формат: верни один полный JSON-объект по исходной схеме, без markdown, пояснений и текста до/после JSON.'
        }
      ]
    };
  }

  async function repairDeepSeekJsonIfNeeded(response, { targetUrl, headers, payload, init }) {
    if (!response?.ok || !expectsJsonObject(payload)) return response;

    let firstEnvelope = null;
    try { firstEnvelope = safeJson(await response.clone().text()); } catch {}
    const invalidContent = firstEnvelope?.choices?.[0]?.message?.content;
    if (parseJsonObject(invalidContent)) return response;

    const repair = repairPayload(payload, invalidContent);
    const repairedResponse = await nativeFetch(targetUrl, {
      ...init,
      headers,
      body: JSON.stringify(repair)
    });
    if (!repairedResponse?.ok) return repairedResponse;

    let repairedEnvelope = null;
    try { repairedEnvelope = safeJson(await repairedResponse.clone().text()); } catch {}
    const repairedContent = repairedEnvelope?.choices?.[0]?.message?.content;
    if (!repairedEnvelope || !parseJsonObject(repairedContent)) return repairedResponse;

    repairedEnvelope.usage = usageTotal(firstEnvelope?.usage, repairedEnvelope?.usage);
    repairedEnvelope.simnet = {
      ...(repairedEnvelope.simnet && typeof repairedEnvelope.simnet === 'object' ? repairedEnvelope.simnet : {}),
      json_repaired: true
    };

    const responseHeaders = new Headers(repairedResponse.headers || {});
    responseHeaders.set('content-type', 'application/json');
    responseHeaders.set('x-simnet-json-repaired', '1');
    return new Response(JSON.stringify(repairedEnvelope), {
      status: repairedResponse.status,
      statusText: repairedResponse.statusText,
      headers: responseHeaders
    });
  }

  globalThis.fetch = async function simnetAiProviderFetch(input, init = {}) {
    const sourceUrl = typeof input === 'string' ? input : String(input?.url || '');
    const isGroqCompat = sourceUrl.startsWith(GROQ_BASE);
    const isDeepSeek = sourceUrl.startsWith(DEEPSEEK_BASE);
    if (!isGroqCompat && !isDeepSeek) return nativeFetch(input, init);

    const config = await readConfig();
    if (normalizeProvider(config.provider) !== 'deepseek') return nativeFetch(input, init);

    const apiKey = String(config.deepseekApiKey || '').trim();
    if (!apiKey) return nativeFetch(input, init);

    const targetUrl = routeUrl(sourceUrl);
    const rewritten = rewriteDeepSeekBody(init?.body, config);
    if (rewritten.promptGuard) return syntheticPromptGuardSkip();

    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${apiKey}`);
    if (typeof rewritten.body === 'string' && rewritten.body) headers.set('Content-Type', 'application/json');

    const response = await nativeFetch(targetUrl, {
      ...init,
      headers,
      ...(typeof rewritten.body === 'string' ? { body: rewritten.body } : {})
    });

    return repairDeepSeekJsonIfNeeded(response, {
      targetUrl,
      headers,
      payload: rewritten.payload,
      init
    });
  };
})();
