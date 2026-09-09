import { AI_CONFIG } from '../../../config/ai-config.js';
import { readTranscript } from './background.js';

const MESSAGE = 'PBX_TRANSCRIPT_ASK';
const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
const MAX_QUESTION_CHARS = 600;
const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_ANSWER_TOKENS = 450;
const TIMEOUT_MS = 30_000;
const DEFAULT_MODELS = Object.freeze([
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b'
]);

function clean(value, max = 1200) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function recordIdOf(value) {
  return String(value || '').match(/^(\d{9,12}\.\d{1,12})$/)?.[1] || '';
}

function senderIsPbx(sender = {}) {
  try {
    const url = new URL(String(sender?.url || sender?.tab?.url || ''));
    return url.protocol === 'https:' && url.hostname === 'pbx.simnet.kiev.ua';
  } catch {
    return false;
  }
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

function transcriptSource(transcript = {}) {
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  if (segments.length) {
    const withTime = segments.map(segment => {
      const start = Number(segment?.start || 0).toFixed(1);
      const end = Number(segment?.end || 0).toFixed(1);
      const text = clean(segment?.text, 2400);
      return text ? `[${start}-${end}] ${text}` : '';
    }).filter(Boolean).join('\n');
    if (withTime) return withTime.slice(0, MAX_TRANSCRIPT_CHARS);
  }
  return String(transcript.text || '').trim().slice(0, MAX_TRANSCRIPT_CHARS);
}

async function runtimeConfig() {
  const raw = (await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY))?.[AI_RUNTIME_CONFIG_KEY] || {};
  const preferred = Array.isArray(raw.models) ? raw.models : [];
  const legacy = clean(raw.chatModel || raw.model, 120);
  const models = [];
  for (const value of [...preferred, legacy, ...DEFAULT_MODELS]) {
    const model = clean(value, 160);
    if (model && !models.includes(model)) models.push(model);
    if (models.length >= 8) break;
  }
  return {
    apiKey: String(raw.groqApiKey || '').trim(),
    models: models.length ? models : [...DEFAULT_MODELS]
  };
}

async function requestModel(messages, apiKey, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
        max_tokens: MAX_ANSWER_TOKENS,
        messages
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const error = new Error(`Groq HTTP ${response.status}${data?.error?.message ? ` — ${clean(data.error.message, 500)}` : ''}`);
      error.status = response.status;
      throw error;
    }
    const answer = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!answer) throw new Error('Groq вернул пустой ответ');
    return {
      answer: answer.slice(0, 5000),
      model: String(data?.model || model),
      usage: normalizeUsage(data?.usage || {})
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Таймаут ответа по разговору');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function ask(payload = {}) {
  const recordId = recordIdOf(payload.recordId);
  if (!recordId) throw new Error('Некорректный PBX recordId');
  const question = clean(payload.question, MAX_QUESTION_CHARS);
  if (!question) throw new Error('Введите вопрос по разговору');

  const transcript = await readTranscript({
    callKey: `pbx:${recordId}`,
    recordUrl: `${PBX_RECORD_BASE}${encodeURIComponent(recordId)}`
  });
  const source = transcriptSource(transcript || {});
  if (!source) throw new Error('Сохранённая расшифровка этого звонка не найдена');

  const runtime = await runtimeConfig();
  if (!runtime.apiKey) throw new Error('Groq API key не настроен локально в Workbench');

  const messages = [
    {
      role: 'system',
      content: 'Отвечай только по предоставленной расшифровке звонка. Не додумывай и не используй внешние знания. Если нужная информация не упоминалась или из текста это нельзя установить, скажи об этом прямо. Ответ должен быть коротким и конкретным. Если в расшифровке есть временные метки, укажи наиболее релевантное время фрагмента.'
    },
    {
      role: 'user',
      content: `Вопрос: ${question}\n\nРасшифровка звонка:\n${source}`
    }
  ];

  const failures = [];
  for (const model of runtime.models) {
    try {
      return await requestModel(messages, runtime.apiKey, model);
    } catch (error) {
      failures.push(`${model}: ${clean(error?.message || error, 240)}`);
      if ([401, 403].includes(Number(error?.status || 0))) break;
    }
  }
  throw new Error(`Не удалось получить ответ по разговору${failures.length ? ` — ${failures.join(' | ')}` : ''}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MESSAGE) return false;
  if (!senderIsPbx(sender)) {
    sendResponse({ success: false, error: 'PBX transcript question rejected' });
    return false;
  }
  void ask(message?.payload || {})
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: clean(error?.message || error || 'Не удалось ответить', 900) }));
  return true;
});

export const PbxTranscriptQuestion = Object.freeze({ ask });
