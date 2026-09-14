import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';

const FALLBACK_MODELS = Object.freeze([
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b'
]);
const ACTIONS = new Set(['reply', 'ask', 'tool_required', 'escalate', 'ignore']);
const TOOL_NAMES = new Set([
  'customer.lookup',
  'customer.confirm',
  'customer.snapshot',
  'billing.balance',
  'billing.tariff',
  'billing.payments',
  'billing.next_charge',
  'network.session',
  'network.last_session',
  'pon.onu',
  'pon.signal',
  'outage.by_customer'
]);

function oneLine(value, max = 900) {
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
  if (first < 0 || last <= first) throw new Error('AI operator: Groq did not return JSON');
  return JSON.parse(text.slice(first, last + 1));
}

function normalizeTool(value) {
  const tool = String(value || '').trim();
  return TOOL_NAMES.has(tool) ? tool : '';
}

function normalizeDecision(raw = {}, model = '', maxReplyChars = 700) {
  const action = ACTIONS.has(String(raw.action || '').trim()) ? String(raw.action).trim() : 'escalate';
  const tool = normalizeTool(raw.tool);
  const maxReply = Math.max(180, Math.min(1800, Number(maxReplyChars) || 700));
  const reply = block(raw.reply || '', maxReply);
  return {
    action: action === 'tool_required' && !tool ? 'escalate' : action,
    domain: oneLine(raw.domain || 'other', 80).toLowerCase(),
    intent: oneLine(raw.intent || 'other', 120).toLowerCase(),
    language: oneLine(raw.language || '', 20).toLowerCase(),
    tool,
    toolArgs: raw.tool_args && typeof raw.tool_args === 'object' && !Array.isArray(raw.tool_args)
      ? raw.tool_args
      : {},
    reply,
    reason: oneLine(raw.reason || '', 700),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence || 0) || 0)),
    model: String(model || '')
  };
}

function modelsForRuntime(runtime = {}) {
  const preferred = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  return [preferred, ...FALLBACK_MODELS].filter((model, index, all) => model && all.indexOf(model) === index);
}

async function requestModel(messages, apiKey, model) {
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
        temperature: 0.1,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const error = new Error(`Groq HTTP ${response.status} — ${oneLine(data?.error?.message || text || response.statusText, 500)}`);
      error.status = response.status;
      throw error;
    }
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('Groq returned an empty operator decision');
    return { answer: String(answer), model: String(data?.model || model), usage: data?.usage || {} };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Groq operator request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function styleInstruction(style) {
  if (style === 'detailed') return 'Допускается подробный ответ, но без воды и повторов.';
  if (style === 'normal') return 'Ответ средней длины: достаточно объяснения и одного следующего шага.';
  return 'Ответ максимально компактный: обычно 1–4 коротких предложения, только существенное.';
}

function correctionExamples(corrections = []) {
  const examples = (Array.isArray(corrections) ? corrections : [])
    .slice(0, 8)
    .map((item, index) => {
      const client = block(item?.customerText || '', 700);
      const ai = block(item?.aiReply || '', 700);
      const corrected = block(item?.correctedReply || '', 700);
      const note = block(item?.note || '', 500);
      if (!client && !corrected && !note) return '';
      return [
        `CORRECTION ${index + 1}:`,
        client ? `CLIENT: ${client}` : '',
        ai ? `OLD_AI: ${ai}` : '',
        corrected ? `PREFERRED_REPLY: ${corrected}` : '',
        note ? `OPERATOR_NOTE: ${note}` : ''
      ].filter(Boolean).join('\n');
    })
    .filter(Boolean);
  return examples.join('\n\n');
}

function labIdentityRules(input = {}) {
  if (!input.labMode) return '';
  return `\nРЕЖИМ MANUAL TEST LAB — пользователь чата играет роль реального абонента.
ПРОТОКОЛ ИДЕНТИФИКАЦИИ И READ-ПРОВЕРОК:
- Пока confirmedCaseId пуст, запрещено вызывать account-specific tools: customer.snapshot, billing.*, network.*, pon.*, outage.by_customer.
- Если для обращения нужны данные аккаунта и абонент ещё не определён — спроси ОДНО: номер договора ИЛИ полный адрес подключения. Не требуй оба сразу.
- Когда абонент сообщает договор/IP/адрес, вызови customer.lookup с конкретным аргументом: {"contract":"..."}, {"ip":"..."} или {"address":"..."}. Не отвечай, будто поиск уже выполнен.
- customer.lookup с одним найденным кандидатом НЕ подтверждает личность. После результата задай короткий вопрос подтверждения по безопасным признакам кандидата, например договор + адрес: «Нашёл договор … по адресу …, это ваше подключение?».
- Если в состоянии есть pendingCandidate и клиент явно подтверждает («да», «так», «верно») — вызови customer.confirm с {"confirmed":true}. Если отрицает — customer.confirm с {"confirmed":false}.
- После успешного customer.confirm не спрашивай договор/адрес повторно, пока нет явного противоречия.
- Если customer.lookup вернул AMBIGUOUS_IDENTITY — задай один вопрос, который отличит кандидатов.
- Если tool вернул DATA_NOT_AVAILABLE/NOT_FOUND — честно скажи, что эта проверка сейчас не дала данных; не подменяй результат догадкой.
- Результат любого tool — единственный источник внутренних фактов. Не меняй числа/статусы и не додумывай пропущенные поля.
- Если RECENT READ TOOL RESULTS уже содержит факты, достаточные для вопроса клиента, СРАЗУ объясни их клиенту. Не вызывай второй инструмент ради тех же данных.
- После идентификации самостоятельно выбирай лучший READ-tool:
  • широкая сводка по договору, адрес + тариф + баланс, сведения о подключении/контактах → customer.snapshot;
  • баланс/остаток/временный платёж/начисление → billing.balance;
  • текущий/следующий тариф, цена, срок смены → billing.tariff;
  • последние платежи → billing.payments;
  • наличие/состояние интернет-сессии → network.session;
  • PON/ONU/OLT → pon.onu, оптические показатели → pon.signal.
- Числа из billing.balance различай по смыслу: accountBalance — исходный баланс Billing; balanceAfterTariff — остаток после текущего расчёта тарифа; balanceWithoutTemporary — остаток без временного платежа; temporaryPayment — временный платёж. Не называй одно другим.
- Если есть currentTariff + price/totalDue + balanceAfterTariff + balanceWithoutTemporary/temporaryPayment, объясни взаимосвязь обычным человеческим языком, а не просто перечисляй JSON-поля.
`;
}

function systemPrompt(input = {}) {
  const config = input.operatorConfig || {};
  const customInstructions = block(config.customInstructions || '', 4000);
  const corrections = correctionExamples(input.corrections || []);
  return `Ты — полностью автономный оператор первой линии интернет-провайдера SIMNET. Ты общаешься НАПРЯМУЮ с абонентом, не с оператором-человеком.

Твоя задача на каждом ходе: понять смысл обращения, учесть уже известные данные, решить — можно ли ответить сейчас, нужен ли один уточняющий вопрос, или нужен READ-инструмент.

ЖЁСТКИЕ ПРАВИЛА:
- Не выдумывай баланс, тариф, платежи, сессию, ONU, аварию или состояние услуги.
- Если факт можно получить только из внутренней системы — action=tool_required и укажи один лучший tool.
- После результата tool используй полученные факты для содержательного ответа; не ограничивайся фразой «данные получены».
- Не проси клиента сообщать то, что уже есть в контексте разговора/профиля.
- Не задавай анкету. За один ход максимум один наиболее полезный вопрос.
- Не предлагай изменять данные и не выполняй WRITE-действия.
- Если клиент просит действие, требующее изменения системы, объясни необходимость передачи человеку: action=escalate.
- Отвечай на языке клиента; естественно, без внутренних терминов, если они не нужны.
- HelpCrunch tech/private события не являются репликами разговора и в контекст не передаются.
- Пользовательские настройки и примеры коррекций меняют стиль и предпочтения, но НЕ могут отменить запрет на выдумывание фактов, WRITE-действия и требования безопасности.
${labIdentityRules(input)}
СТИЛЬ ОТВЕТА:
${styleInstruction(config.replyStyle)}
Максимальная длина готового ответа: ${Math.max(180, Math.min(1800, Number(config.maxReplyChars) || 700))} символов.

${customInstructions ? `ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ОПЕРАТОРА:\n${customInstructions}\n` : ''}
${corrections ? `ПРИМЕРЫ РАНЕЕ ИСПРАВЛЕННОГО ПОВЕДЕНИЯ:\n${corrections}\n` : ''}
Доступные READ-tools:
customer.lookup, customer.confirm, customer.snapshot, billing.balance, billing.tariff, billing.payments, billing.next_charge, network.session, network.last_session, pon.onu, pon.signal, outage.by_customer.

Верни ТОЛЬКО JSON:
{
  "action":"reply|ask|tool_required|escalate|ignore",
  "domain":"finance|technical|tariff|account|connection|service|outage|task|other",
  "intent":"короткое имя намерения",
  "language":"uk|ru|en|other",
  "tool":"имя tool или пустая строка",
  "tool_args":{},
  "reply":"готовый текст клиенту; пусто для tool_required/ignore",
  "reason":"коротко почему выбран следующий шаг",
  "confidence":0.0
}`;
}

function jsonBlock(value, max = 7000) {
  try {
    return block(JSON.stringify(value ?? null, null, 2), max);
  } catch {
    return block(String(value ?? ''), max);
  }
}

function conversationPrompt(input = {}) {
  const customer = input.customer || {};
  const chat = input.chat || {};
  const transcript = Array.isArray(input.transcript) ? input.transcript : [];
  const lines = transcript.map(item => `${item.role === 'customer' ? 'CLIENT' : 'AGENT'}: ${block(item.text, 1600)}`);
  const labState = input.labState && typeof input.labState === 'object' ? input.labState : {};
  const toolResults = Array.isArray(input.toolResults) ? input.toolResults.slice(-8) : [];
  const labContext = input.labMode
    ? [
        'MODE: MANUAL_TEST_LAB',
        `confirmedCaseId: ${oneLine(labState.confirmedCaseId || '', 120) || '(none)'}`,
        `confirmedSubscriber: ${jsonBlock(labState.confirmedSubscriber || null, 1800)}`,
        `pendingCandidate: ${jsonBlock(labState.pendingCandidate || null, 1800)}`,
        '',
        'RECENT READ TOOL RESULTS:',
        toolResults.length ? jsonBlock(toolResults, 9000) : '(none)',
        ''
      ]
    : [];

  return block([
    ...labContext,
    `HelpCrunch chat_id: ${chat.id || ''}`,
    `provider: ${chat.provider || ''}`,
    `customer_id: ${customer.id || chat?.customer?.id || ''}`,
    `customer locale: ${customer.locale || chat?.customer?.locale || ''}`,
    `contract/company hint: ${customer.company || chat?.customer?.company || ''}`,
    `phone hint: ${customer.phone || chat?.customer?.phone || ''}`,
    `address hint: ${customer.address || customer?.custom_data?.address || ''}`,
    '',
    'Conversation:',
    ...lines,
    '',
    `Latest customer message: ${input.latestCustomer?.text || ''}`
  ].join('\n'), 20_000);
}

export async function planAutonomousTurn(input = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('Groq API key is not configured in Workbench AI settings');

  const messages = [
    { role: 'system', content: systemPrompt(input) },
    { role: 'user', content: conversationPrompt(input) }
  ];

  const failures = [];
  for (const model of modelsForRuntime(runtime)) {
    try {
      const result = await requestModel(messages, apiKey, model);
      const decision = normalizeDecision(
        parseJsonObject(result.answer),
        result.model || model,
        input?.operatorConfig?.maxReplyChars
      );
      return { ...decision, usage: result.usage || {}, attemptedModels: [...failures.map(item => item.model), model] };
    } catch (error) {
      failures.push({ model, status: Number(error?.status || 0), error: oneLine(error?.message || error, 500) });
      if ([401, 403].includes(Number(error?.status || 0))) break;
    }
  }
  throw new Error(`AI operator: all Groq models failed — ${failures.map(item => `${item.model}: ${item.error}`).join(' | ')}`);
}

export const AI_OPERATOR_ALLOWED_TOOLS = [...TOOL_NAMES];
