(() => {
  'use strict';

  if (globalThis.__SIMNET_COMPANION_GROQ_NATIVE_BRIDGE__) return;
  const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  if (!nativeFetch) return;
  globalThis.__SIMNET_COMPANION_GROQ_NATIVE_BRIDGE__ = true;

  const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';
  const CHAT_URLS = new Set([GROQ_CHAT_URL, DEEPSEEK_CHAT_URL]);
  const COMPANION_MARKER = 'AI-напарник оператора интернет-провайдера SIMNET';
  const FINAL_MARKER = 'Инструменты уже выполнены. Дай финальный видимый ответ';

  const NAME_TO_WORKBENCH = Object.freeze({
    customer_lookup: 'customer.lookup',
    customer_confirm: 'customer.confirm',
    customer_snapshot: 'customer.snapshot',
    billing_balance: 'billing.balance',
    billing_tariff: 'billing.tariff',
    billing_payments: 'billing.payments',
    billing_next_charge: 'billing.next_charge',
    network_session: 'network.session',
    network_last_session: 'network.last_session',
    pon_onu: 'pon.onu',
    pon_signal: 'pon.signal',
    outage_by_customer: 'outage.by_customer'
  });

  const objectSchema = properties => ({ type: 'object', properties, additionalProperties: false });
  const readOptions = objectSchema({
    refresh: { type: 'boolean', description: 'Запросить свежие данные, если источник это поддерживает.' },
    maxAgeMs: { type: 'integer', minimum: 0, maximum: 300000, description: 'Допустимый возраст кэша в миллисекундах.' }
  });

  const TOOL_DEFINITIONS = Object.freeze([
    ['customer_lookup', 'Найти абонента по договору, login, IP или адресу.', objectSchema({
      contract: { type: 'string' }, login: { type: 'string' }, ip: { type: 'string' }, address: { type: 'string' }, query: { type: 'string' }
    })],
    ['customer_confirm', 'Подтвердить ранее найденного неоднозначного кандидата.', objectSchema({ confirmed: { type: 'boolean' } })],
    ['customer_snapshot', 'Прочитать сводный снимок подтвержденного абонента.', readOptions],
    ['billing_balance', 'Прочитать баланс и финансовое состояние подтвержденного абонента.', readOptions],
    ['billing_tariff', 'Прочитать текущий тариф подтвержденного абонента.', readOptions],
    ['billing_payments', 'Прочитать доступную историю платежей подтвержденного абонента.', readOptions],
    ['billing_next_charge', 'Прочитать данные следующего списания подтвержденного абонента.', readOptions],
    ['network_session', 'Прочитать текущую сетевую сессию подтвержденного абонента.', readOptions],
    ['network_last_session', 'Прочитать последнюю сетевую сессию подтвержденного абонента.', readOptions],
    ['pon_onu', 'Прочитать состояние ONU/ONT подтвержденного PON-абонента.', readOptions],
    ['pon_signal', 'Прочитать оптические уровни сигнала подтвержденного PON-абонента.', readOptions],
    ['outage_by_customer', 'Проверить доступные признаки аварии по подтвержденному абоненту.', readOptions]
  ].map(([name, description, parameters]) => ({ type: 'function', function: { name, description, parameters } })));

  const safeJson = value => {
    try { return JSON.parse(value); } catch { return null; }
  };

  function modelReasoningEffort(model) {
    const name = String(model || '').toLowerCase();
    if (name.includes('qwen/qwen3.6')) return 'none';
    if (name.includes('qwen/qwen3.8')) return 'low';
    if (name.includes('openai/gpt-oss-')) return 'low';
    return '';
  }

  function applyReasoningCompatibility(payload) {
    const next = { ...payload };
    const effort = modelReasoningEffort(next.model);
    if (effort) next.reasoning_effort = effort;
    else delete next.reasoning_effort;
    return next;
  }

  function isCompanionPayload(payload) {
    return Array.isArray(payload?.messages) && payload.messages.some(item =>
      item?.role === 'system' && String(item?.content || '').includes(COMPANION_MARKER));
  }

  function isFinalPass(payload) {
    return Array.isArray(payload?.messages) && payload.messages.some(item =>
      item?.role === 'system' && String(item?.content || '').includes(FINAL_MARKER));
  }

  function firstPassPayload(payload, url) {
    const messages = Array.isArray(payload.messages) ? [...payload.messages] : [];
    const nativeInstruction = {
      role: 'system',
      content: 'API TOOL MODE: если нужны live-данные, вызывай предоставленные READ functions нативным function call. Не изображай function call обычным JSON. Для обычного разговора и общих вопросов functions не вызывай.'
    };
    const firstUser = messages.findIndex(item => item?.role === 'user');
    messages.splice(firstUser >= 0 ? firstUser : messages.length, 0, nativeInstruction);
    const next = {
      ...payload,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      parallel_tool_calls: true
    };
    // Groq-only extension. DeepSeek accepts standard OpenAI tool fields but
    // does not need Groq's tool-validation switch.
    if (url === GROQ_CHAT_URL) next.disable_tool_validation = false;
    else delete next.disable_tool_validation;
    return applyReasoningCompatibility(next);
  }

  function finalPassPayload(payload) {
    const messages = (Array.isArray(payload.messages) ? payload.messages : []).map(item => {
      if (item?.role !== 'system' || !String(item?.content || '').includes(COMPANION_MARKER)) return item;
      return {
        role: 'system',
        content: 'Ты AI-напарник оператора SIMNET. READ-проверки уже выполнены. Ответь оператору обычным коротким текстом только по TOOL EVIDENCE и контексту. Не вызывай functions и не выводи JSON/XML/служебные конструкции.'
      };
    });

    const next = {
      ...payload,
      messages,
      temperature: payload.temperature
    };

    // Critical: on the final synthesis pass do not send tools OR tool_choice.
    delete next.tools;
    delete next.tool_choice;
    delete next.parallel_tool_calls;
    delete next.disable_tool_validation;

    return applyReasoningCompatibility(next);
  }

  function normalizeToolCalls(json) {
    const message = json?.choices?.[0]?.message;
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (!calls.length) return json;
    const tools = calls.map(call => {
      const nativeName = String(call?.function?.name || '');
      const name = NAME_TO_WORKBENCH[nativeName];
      if (!name) return null;
      const args = safeJson(String(call?.function?.arguments || '{}')) || {};
      return { name, args: args && typeof args === 'object' && !Array.isArray(args) ? args : {} };
    }).filter(Boolean).slice(0, 4);
    if (!tools.length) return json;
    message.content = `<wb_tool_request>${JSON.stringify({ tools })}</wb_tool_request>`;
    delete message.tool_calls;
    return json;
  }

  function responseFrom(response, text) {
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  async function send(input, init, payload) {
    return nativeFetch(input, { ...init, body: JSON.stringify(payload) });
  }

  globalThis.fetch = async function simnetCompanionFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (!CHAT_URLS.has(url) || String(init?.method || 'GET').toUpperCase() !== 'POST' || typeof init?.body !== 'string') {
      return nativeFetch(input, init);
    }

    const source = safeJson(init.body);
    if (!source || !isCompanionPayload(source)) return nativeFetch(input, init);

    const finalPass = isFinalPass(source);
    const response = await send(input, init, finalPass ? finalPassPayload(source) : firstPassPayload(source, url));
    const text = await response.text();

    if (!response.ok) return responseFrom(response, text);
    const json = safeJson(text);
    if (!json) return responseFrom(response, text);
    if (!finalPass) normalizeToolCalls(json);
    return responseFrom(response, JSON.stringify(json));
  };
})();