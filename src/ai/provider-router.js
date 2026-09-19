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
    if (typeof rawBody !== 'string' || !rawBody) return { body: rawBody, promptGuard: false };
    const payload = safeJson(rawBody);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { body: rawBody, promptGuard: false };

    if (String(payload.model || '') === PROMPT_GUARD_MODEL) {
      return { body: rawBody, promptGuard: true };
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

    return { body: JSON.stringify(next), promptGuard: false };
  }

  function syntheticPromptGuardSkip() {
    return new Response(JSON.stringify({
      error: {
        message: 'SIMNET provider router: Groq Prompt Guard is unavailable while DeepSeek is selected; guard request skipped locally.'
      }
    }), {
      status: 422,
      statusText: 'Provider capability unavailable',
      headers: { 'content-type': 'application/json' }
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

    return nativeFetch(targetUrl, {
      ...init,
      headers,
      ...(typeof rewritten.body === 'string' ? { body: rewritten.body } : {})
    });
  };
})();
