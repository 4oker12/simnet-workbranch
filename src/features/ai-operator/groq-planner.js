import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { OPERATOR_ASSISTANT_REASONING_CORE } from './operator-assistant-prompt.js';

const FALLBACK_MODELS = Object.freeze([
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b'
]);

const ACTIONS = new Set(['reply', 'ask', 'tool_required', 'escalate', 'ignore']);

// Compatibility tools stay accepted during migration, but are intentionally not advertised to the model.
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

const VISIBLE_TOOLS = Object.freeze([
  'customer.lookup — найти абонента',
  'customer.confirm — подтвердить найденного абонента',
  'customer.snapshot — получить общую карточку: тариф, финансы, статус, адрес, сеть',
  'billing.payments — история платежей/списаний',
  'network.session — текущая интернет-сессия',
  'network.last_session — последняя сессия',
  'pon.onu — ONU/OLT',
  'pon.signal — оптические уровни',
  'outage.by_customer — авария по абоненту'
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

function normalizeSemantic(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    entity: oneLine(value.entity || '', 80).toLowerCase(),
    relation: oneLine(value.relation || '', 120).toLowerCase(),
    time: oneLine(value.time || '', 80).toLowerCase(),
    action: oneLine(value.action || '', 80).toLowerCase(),
    character: oneLine(value.character || '', 80).toLowerCase()
  };
}

function normalizeDecision(raw = {}, model = '', maxReplyChars = 700) {
  const action = ACTIONS.has(String(raw.action || '').trim()) ? String(raw.action).trim() : 'escalate';
  const tool = normalizeTool(raw.tool);
  const maxReply = Math.max(180, Math.min(1800, Number(maxReplyChars) || 700));
  return {
    action: action === 'tool_required' && !tool ? 'escalate' : action,
    domain: oneLine(raw.domain || 'other', 80).toLowerCase(),
    intent: oneLine(raw.intent || 'other', 120).toLowerCase(),
    semantic: normalizeSemantic(raw.semantic || {}),
    language: oneLine(raw.language || '', 20).toLowerCase(),
    tool,
    toolArgs: raw.tool_args && typeof raw.tool_args === 'object' && !Array.isArray(raw.tool_args)
      ? raw.tool_args
      : {},
    reply: block(raw.reply || '', maxReply),
    reason: oneLine(raw.reason || '', 420),
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
        max_tokens: 600,
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
  if (style === 'detailed') return 'Можно объяснить подробнее, но без повторов.';
  if (style === 'normal') return 'Прямой ответ + короткое полезное объяснение.';
  return 'Коротко и по делу; не обрезай важный смысл.';
}

function correctionExamples(corrections = []) {
  return (Array.isArray(corrections) ? corrections : [])
    .slice(0, 2)
    .map(item => {
      const client = oneLine(item?.customerText || '', 220);
      const corrected = oneLine(item?.correctedReply || item?.note || '', 260);
      return client && corrected ? `CLIENT: ${client}\nPREFERRED: ${corrected}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function labIdentityRules(input = {}) {
  if (!input.labMode) return '';
  return `TEST LAB:
- Пока confirmedCaseId пуст, account-specific READ запрещены.
- Для поиска используй customer.lookup; один кандидат требует подтверждения.
- Явное «да/верно/правильно» при pendingCandidate → customer.confirm(true), отрицание → false.
- После подтверждения не спрашивай договор/адрес повторно.
- RECENT FACTS сохраняются между репликами текущего кейса: используй их, не вызывай повторно источник без причины.`;
}

function systemPrompt(input = {}) {
  const config = input.operatorConfig || {};
  const customInstructions = block(config.customInstructions || '', 700);
  const corrections = correctionExamples(input.corrections || []);
  return block(`Ты — автономный оператор первой линии SIMNET и говоришь напрямую с абонентом.

${OPERATOR_ASSISTANT_REASONING_CORE}

БЕЗОПАСНОСТЬ:
- Не выдумывай CRM/сетевые факты, суммы, даты, ONU, аварии.
- WRITE-действия не выполняй; если без них нельзя — escalate.
- Один ход = максимум один новый READ-source. Если фактов достаточно — reply.
- DATA_NOT_AVAILABLE/NOT_FOUND не заменяй догадкой.
- Отвечай на языке клиента и учитывай весь переданный контекст разговора.

${labIdentityRules(input)}
СТИЛЬ: ${styleInstruction(config.replyStyle)} Максимум ответа: ${Math.max(180, Math.min(1800, Number(config.maxReplyChars) || 700))} символов.
${customInstructions ? `CUSTOM: ${customInstructions}` : ''}
${corrections ? `CORRECTIONS:\n${corrections}` : ''}

Доступные источники:
${VISIBLE_TOOLS.map(item => `- ${item}`).join('\n')}

Верни только JSON:
{"action":"reply|ask|tool_required|escalate|ignore","domain":"finance|technical|tariff|account|connection|service|outage|task|other","intent":"коротко","semantic":{"entity":"","relation":"","time":"","action":"","character":""},"language":"uk|ru|en|other","tool":"","tool_args":{},"reply":"","reason":"коротко","confidence":0.0}`, 5600);
}

function jsonBlock(value, max = 2400) {
  try { return block(JSON.stringify(value ?? null), max); }
  catch { return block(String(value ?? ''), max); }
}

function transcriptWindow(transcript = []) {
  const source = Array.isArray(transcript) ? transcript : [];
  if (!source.length) return [];
  const tail = source.slice(-10);
  const firstCustomer = source.find(item => item?.role === 'customer');
  const selected = firstCustomer && !tail.some(item => item?.id === firstCustomer.id)
    ? [firstCustomer, ...tail]
    : tail;
  return selected.map(item => ({
    role: item?.role === 'customer' ? 'customer' : 'agent',
    text: block(item?.text || '', 420)
  }));
}

function compactToolResults(toolResults = []) {
  return (Array.isArray(toolResults) ? toolResults : [])
    .slice(-5)
    .map(item => ({
      tool: oneLine(item?.tool || '', 80),
      ok: Boolean(item?.ok),
      code: oneLine(item?.code || '', 80),
      observedAt: oneLine(item?.observedAt || '', 60),
      data: item?.data ?? {},
      warnings: Array.isArray(item?.warnings) ? item.warnings.slice(0, 2) : []
    }));
}

function conversationPrompt(input = {}) {
  const customer = input.customer || {};
  const chat = input.chat || {};
  const labState = input.labState && typeof input.labState === 'object' ? input.labState : {};
  const transcript = transcriptWindow(input.transcript || []);
  const toolResults = compactToolResults(input.toolResults || []);
  const lines = transcript.map(item => `${item.role === 'customer' ? 'C' : 'A'}: ${item.text}`);

  return block([
    input.labMode ? 'MODE=TEST_LAB' : 'MODE=LIVE_SHADOW',
    labState.confirmedCaseId ? `case=${oneLine(labState.confirmedCaseId, 100)}` : '',
    labState.confirmedSubscriber ? `subscriber=${jsonBlock(labState.confirmedSubscriber, 650)}` : '',
    labState.pendingCandidate ? `pending=${jsonBlock(labState.pendingCandidate, 500)}` : '',
    toolResults.length ? `RECENT_FACTS=${jsonBlock(toolResults, 1900)}` : '',
    customer?.id ? `customer_id=${customer.id}` : '',
    customer?.address ? `address_hint=${oneLine(customer.address, 180)}` : '',
    chat?.id ? `chat_id=${chat.id}` : '',
    'DIALOGUE:',
    ...lines,
    `LATEST: ${block(input.latestCustomer?.text || '', 520)}`
  ].filter(Boolean).join('\n'), 4300);
}

export function buildAutonomousPromptMessages(input = {}) {
  return [
    { role: 'system', content: systemPrompt(input) },
    { role: 'user', content: conversationPrompt(input) }
  ];
}

export async function planAutonomousTurn(input = {}) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.groqApiKey || '').trim();
  if (!apiKey) throw new Error('Groq API key is not configured in Workbench AI settings');

  const messages = buildAutonomousPromptMessages(input);
  const failures = [];
  for (const model of modelsForRuntime(runtime)) {
    try {
      const result = await requestModel(messages, apiKey, model);
      const decision = normalizeDecision(
        parseJsonObject(result.answer),
        result.model || model,
        input?.operatorConfig?.maxReplyChars
      );
      return {
        ...decision,
        usage: result.usage || {},
        promptChars: messages.reduce((sum, item) => sum + String(item.content || '').length, 0),
        attemptedModels: [...failures.map(item => item.model), model]
      };
    } catch (error) {
      failures.push({ model, status: Number(error?.status || 0), error: oneLine(error?.message || error, 500) });
      if ([401, 403].includes(Number(error?.status || 0))) break;
    }
  }
  throw new Error(`AI operator: all Groq models failed — ${failures.map(item => `${item.model}: ${item.error}`).join(' | ')}`);
}

export const AI_OPERATOR_ALLOWED_TOOLS = [...TOOL_NAMES];
