import { AI_CONFIG } from '../../../config/ai-config.js';

const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const AI_ANALYSIS_STORE_KEY = 'simnet_workbench_call_ai_analysis_v1';
const AI_ANALYSIS_SCHEMA = 3;
const AI_TIMEOUT_MS = 45_000;
const MAX_INPUT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 100_000;
const MAX_ANALYSES = 120;
const ANALYSIS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_MODELS = Object.freeze([
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b'
]);
const MAX_COMPLETION_TOKENS = 1800;

function block(value, max = MAX_OUTPUT_CHARS) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function oneLine(value, max = 1200) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function abortError(message = 'AI_POSTPROCESS: отменено оператором') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function stableHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['uk', 'ua', 'ukrainian', 'українська', 'украинский'].includes(raw)) return 'uk';
  if (['ru', 'russian', 'русский', 'російська'].includes(raw)) return 'ru';
  if (['mixed', 'mix', 'ru/uk', 'uk/ru', 'mixed_ru_uk', 'смешанный', 'змішана'].includes(raw)) return 'mixed';
  return 'mixed';
}

function normalizeModels(value) {
  const source = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of source) {
    const model = String(item || '').trim();
    if (!model || result.includes(model)) continue;
    result.push(model);
    if (result.length >= 8) break;
  }
  return result.length ? result : [...DEFAULT_MODELS];
}

function normalizeUsage(raw = {}) {
  const promptTokens = Math.max(0, Number(raw?.prompt_tokens ?? raw?.promptTokens ?? 0) || 0);
  const completionTokens = Math.max(0, Number(raw?.completion_tokens ?? raw?.completionTokens ?? 0) || 0);
  const reportedTotal = Math.max(0, Number(raw?.total_tokens ?? raw?.totalTokens ?? 0) || 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: reportedTotal || promptTokens + completionTokens
  };
}

function sumUsage(attempts = []) {
  return attempts.reduce((sum, attempt) => {
    const usage = normalizeUsage(attempt);
    sum.promptTokens += usage.promptTokens;
    sum.completionTokens += usage.completionTokens;
    sum.totalTokens += usage.totalTokens;
    return sum;
  }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

function analysisStoreShape(raw = {}) {
  return {
    schemaVersion: AI_ANALYSIS_SCHEMA,
    updatedAt: String(raw.updatedAt || ''),
    entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
  };
}

async function readRuntimeConfig() {
  const raw = (await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY))?.[AI_RUNTIME_CONFIG_KEY] || {};
  const legacyModel = String(raw.model || '').trim();
  const configuredModels = Array.isArray(raw.models) && raw.models.length
    ? raw.models
    : legacyModel
      ? [legacyModel, ...DEFAULT_MODELS.filter(model => model !== legacyModel)]
      : DEFAULT_MODELS;
  return {
    apiKey: String(raw.groqApiKey || '').trim(),
    models: normalizeModels(configuredModels)
  };
}

async function readCached(callKey, sourceHash, mode) {
  const raw = (await chrome.storage.local.get(AI_ANALYSIS_STORE_KEY))?.[AI_ANALYSIS_STORE_KEY] || {};
  const store = analysisStoreShape(raw);
  const entry = store.entries[String(callKey || '')];
  if (!entry) return null;
  if (entry.sourceHash !== sourceHash || String(entry.mode || 'standard') !== mode || !entry.analysis?.cleanText) return null;
  return { ...entry.analysis, cached: true };
}

async function saveCached(callKey, sourceHash, mode, analysis) {
  const raw = (await chrome.storage.local.get(AI_ANALYSIS_STORE_KEY))?.[AI_ANALYSIS_STORE_KEY] || {};
  const store = analysisStoreShape(raw);
  const now = Date.now();
  const cutoff = now - ANALYSIS_RETENTION_MS;
  const entries = Object.values(store.entries)
    .filter(item => Number(item?.createdAtMs || 0) >= cutoff)
    .filter(item => item?.callKey && item.callKey !== callKey);
  entries.push({
    schemaVersion: AI_ANALYSIS_SCHEMA,
    callKey,
    sourceHash,
    mode,
    model: String(analysis?.model || ''),
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    analysis
  });
  entries.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  const trimmed = entries.slice(0, MAX_ANALYSES);
  store.entries = Object.fromEntries(trimmed.map(item => [item.callKey, item]));
  store.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [AI_ANALYSIS_STORE_KEY]: store });
}

function sourceText(transcript = {}) {
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  if (segments.length) {
    const segmented = segments.map(segment => {
      const start = Number(segment?.start || 0).toFixed(1);
      const end = Number(segment?.end || 0).toFixed(1);
      return `[${start}-${end}] ${block(segment?.text, 2400)}`;
    }).join('\n');
    if (segmented.trim()) return segmented.slice(0, MAX_INPUT_CHARS);
  }
  return block(transcript.text, MAX_INPUT_CHARS);
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  try {
    return JSON.parse(text);
  } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('AI_POSTPROCESS: модель не вернула JSON');
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    throw new Error('AI_POSTPROCESS: не удалось разобрать JSON ответа модели');
  }
}

function normalizeAnalysis(raw = {}, meta = {}) {
  const cleanText = block(raw.clean_text ?? raw.cleanText);
  if (!cleanText) throw new Error('AI_POSTPROCESS: AI не вернул очищенный текст');
  return {
    schemaVersion: 3,
    language: normalizeLanguage(raw.language),
    cleanText,
    issue: oneLine(raw.issue || raw.reason || raw.topic || '', 1600),
    actions: oneLine(raw.actions || raw.operator_actions || raw.operatorActions || '', 2000),
    result: oneLine(raw.result || raw.outcome || '', 1600),
    nextStep: oneLine(raw.next_step || raw.nextStep || '', 1600),
    summary: oneLine(raw.summary || '', 2000),
    model: String(meta.model || ''),
    attemptedModels: Array.isArray(meta.attemptedModels) ? meta.attemptedModels.slice(0, 8) : [],
    usage: normalizeUsage(meta.usage),
    usageAttempts: Array.isArray(meta.usageAttempts)
      ? meta.usageAttempts.slice(0, 8).map(item => ({ model: String(item.model || ''), ...normalizeUsage(item) }))
      : [],
    mode: String(meta.mode || 'standard'),
    processedAt: new Date().toISOString(),
    cached: false
  };
}

function modelFailure(error, model) {
  const status = Number(error?.status || 0);
  const retryAfter = Number(error?.retryAfter || 0);
  const detail = oneLine(error?.message || error || 'unknown error', 500);
  return { model, status, retryAfter, detail };
}

async function requestGroqModel(messages, apiKey, model, externalSignal = null) {
  throwIfAborted(externalSignal);
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort('external-cancel');
  if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort('timeout');
  }, AI_TIMEOUT_MS);
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
        max_tokens: MAX_COMPLETION_TOKENS,
        messages
      }),
      signal: controller.signal
    });
    throwIfAborted(externalSignal);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const detail = oneLine(data?.error?.message || text || response.statusText, 700);
      const error = new Error(`Groq HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
      error.status = response.status;
      error.retryAfter = Number(response.headers.get('retry-after') || 0) || 0;
      throw error;
    }
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) {
      const error = new Error('Groq вернул пустой ответ');
      error.status = response.status;
      throw error;
    }
    return {
      answer: String(answer),
      usage: normalizeUsage(data?.usage || {}),
      model: String(data?.model || model)
    };
  } catch (error) {
    if (externalSignal?.aborted) throw abortError();
    if (controller.signal.aborted && timedOut) {
      const timeout = new Error('таймаут Groq');
      timeout.status = 0;
      throw timeout;
    }
    if (controller.signal.aborted) throw abortError();
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

function shouldStopFallback(error) {
  const status = Number(error?.status || 0);
  return error?.name === 'AbortError' || status === 401 || status === 403;
}

async function requestWithFallback(messages, apiKey, models, mode, signal = null) {
  const failures = [];
  const usageAttempts = [];
  for (const model of models) {
    throwIfAborted(signal);
    try {
      const response = await requestGroqModel(messages, apiKey, model, signal);
      throwIfAborted(signal);
      const usage = normalizeUsage(response.usage);
      if (usage.totalTokens || usage.promptTokens || usage.completionTokens) {
        usageAttempts.push({ model: response.model || model, ...usage });
      }
      const parsed = parseJsonObject(response.answer);
      const analysis = normalizeAnalysis(parsed, {
        model: response.model || model,
        attemptedModels: [...failures.map(item => item.model), model],
        usage: sumUsage(usageAttempts),
        usageAttempts,
        mode
      });
      return analysis;
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
      failures.push(modelFailure(error, model));
      if (shouldStopFallback(error)) break;
    }
  }

  const detail = failures.map(item => {
    const code = item.status ? `HTTP ${item.status}` : 'network';
    const retry = item.retryAfter ? ` retry-after=${item.retryAfter}s` : '';
    return `${item.model}: ${code}${retry}`;
  }).join(' | ');
  const error = new Error(`AI_POSTPROCESS: все Groq-маршруты недоступны${detail ? ` — ${detail}` : ''}`);
  error.failures = failures;
  error.usage = sumUsage(usageAttempts);
  error.usageAttempts = usageAttempts;
  throw error;
}

function standardSystemPrompt() {
  return `Ты — постпроцессор транскриптов звонков техподдержки интернет-провайдера SIMNET.\n\nТвоя задача — исправить ошибки ASR и сделать текст пригодным для CRM, не меняя факты разговора.\n\nКРИТИЧЕСКИЕ ПРАВИЛА:\n1. НЕ ПЕРЕВОДИ речь. Украинские фразы оставляй украинскими, русские — русскими. Если разговор смешанный RU/UK или суржик — сохрани это естественно.\n2. language = "uk", "ru" или "mixed". При заметном переключении между украинским и русским ставь "mixed".\n3. Исправляй только очевидные ошибки распознавания: пунктуацию, регистр, слитые/разорванные слова и технические термины, когда контекст однозначен.\n4. Не выдумывай адреса, имена, номера, оборудование, диагностику, обещания или результат. Если факт не прозвучал — не добавляй его.\n5. Сохраняй смысл и последовательность разговора. Можно убрать только явные ASR-повторы и бессодержательные слова-паразиты, если это не меняет смысл.\n6. Термины ISP пиши корректно, если они действительно распознаны по контексту: SIMNET, Wi-Fi, Ethernet, ONU, ONT, OLT, GPON, EPON, VLAN, DHCP, PPPoE, NAT, IPv4, IPv6, MikroTik, TP-Link, Cudy, Juniper, BRAS.\n7. summary/issue/actions/result/next_step должны содержать ТОЛЬКО факты из разговора. Если данных нет — пустая строка.\n8. Не оценивай личность, интеллект или профессиональную пригодность оператора. В стандартном режиме только фиксируй наблюдаемые действия и результат.\n9. Ответь ТОЛЬКО JSON-объектом без markdown и комментариев.\n\nФормат:\n{"language":"uk|ru|mixed","clean_text":"полный очищенный транскрипт","summary":"краткая суть звонка","issue":"причина обращения","actions":"что было проверено/сделано оператором","result":"чем закончился звонок","next_step":"что явно договорились сделать дальше"}`;
}

export async function postprocessTranscript(job = {}, transcript = {}, signal = null) {
  throwIfAborted(signal);
  const rawText = block(transcript.text, MAX_INPUT_CHARS);
  if (!rawText) throw new Error('AI_POSTPROCESS: отсутствует сырой транскрипт');

  const runtime = await readRuntimeConfig();
  throwIfAborted(signal);
  if (!runtime.apiKey) {
    throw new Error('AI_POSTPROCESS: Groq API key не настроен локально в Workbench');
  }

  const mode = String(job.analysisMode || 'standard');
  const callKey = String(job.callKey || transcript.callKey || '').trim();
  const source = sourceText(transcript);
  const sourceHash = stableHash(`${mode}\n${rawText}\n${source}`);
  const cached = callKey && job.forceAnalysis !== true
    ? await readCached(callKey, sourceHash, mode)
    : null;
  throwIfAborted(signal);
  if (cached) return cached;

  const whisperLanguage = oneLine(transcript.language || '', 24);
  const whisperProbability = Number(transcript.languageProbability || 0);
  const user = `CALL: ${String(job.usersideCallId || transcript.usersideCallId || '')}\nWhisper language hint: ${whisperLanguage || 'unknown'} (${Number.isFinite(whisperProbability) ? whisperProbability.toFixed(3) : '0.000'})\n\nТранскрипт по сегментам:\n${source}`;

  const analysis = await requestWithFallback([
    { role: 'system', content: standardSystemPrompt() },
    { role: 'user', content: user }
  ], runtime.apiKey, runtime.models, mode, signal);

  throwIfAborted(signal);
  if (callKey) await saveCached(callKey, sourceHash, mode, analysis);
  return analysis;
}

export const AI_POSTPROCESS_RUNTIME_KEY = AI_RUNTIME_CONFIG_KEY;
export const AI_POSTPROCESS_DEFAULT_MODELS = DEFAULT_MODELS;
