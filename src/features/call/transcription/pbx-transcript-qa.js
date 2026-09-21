import { readAiRuntimeConfig, aiProviderDefinition } from '../../../config/ai-config.js';
import { recordAiUsage } from '../../../ai/usage-ledger.js';
import { readTranscript } from './background.js';

const MESSAGE = 'PBX_TRANSCRIPT_ASK';
const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
const MAX_QUESTION_CHARS = 600;
const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_ANSWER_TOKENS = 450;
const TIMEOUT_MS = 30_000;

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

function formatTimecode(value) {
  const total = Math.max(0, Math.floor(Number(value || 0) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return hours
    ? `${hours}:${mm}:${ss}`
    : `${mm}:${ss}`;
}

function transcriptSource(transcript = {}) {
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  if (segments.length) {
    const withTime = segments.map(segment => {
      const start = formatTimecode(segment?.start);
      const end = formatTimecode(segment?.end);
      const text = clean(segment?.text, 2400);
      return text ? `[${start}–${end}] ${text}` : '';
    }).filter(Boolean).join('\n');
    if (withTime) return withTime.slice(0, MAX_TRANSCRIPT_CHARS);
  }
  return String(transcript.text || '').trim().slice(0, MAX_TRANSCRIPT_CHARS);
}

function finalAnswer(value) {
  let text = String(value || '').trim();
  if (!text) return '';

  const marked = [...text.matchAll(/(?:^|\n)\s*(?:ОТВЕТ|ANSWER)\s*:\s*/gi)];
  if (marked.length) {
    const last = marked[marked.length - 1];
    text = text.slice((last.index || 0) + last[0].length).trim();
  } else {
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (/<think>/i.test(text)) return '';
  }

  text = text
    .replace(/<\/?think>/gi, '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^\s*(?:ОТВЕТ|ANSWER)\s*:\s*/i, '')
    .trim();

  if (!text || /^(?:here'?s? (?:a )?thinking process|analy[sz]e user input|scan transcript)/i.test(text)) return '';
  return text.slice(0, 1400);
}

function providerLabel(provider) {
  return String(provider || '').toLowerCase() === 'deepseek' ? 'DeepSeek' : 'Groq';
}

async function runtimeConfig() {
  const raw = await readAiRuntimeConfig();
  const definition = aiProviderDefinition(raw.provider);
  const allowed = new Set(definition.models);
  const preferred = Array.isArray(raw.models) ? raw.models : [];
  const selected = clean(raw.chatModel || raw.model, 160);
  const models = [];

  for (const value of [selected, ...preferred, definition.defaultModel, ...definition.models]) {
    const model = clean(value, 160);
    if (!model || !allowed.has(model) || models.includes(model)) continue;
    models.push(model);
    if (models.length >= 8) break;
  }

  return {
    provider: definition.provider,
    baseUrl: String(raw.baseUrl || definition.baseUrl).replace(/\/$/, ''),
    apiKey: String(raw.apiKey || '').trim(),
    models: models.length ? models : [...definition.models]
  };
}

async function requestModel(messages, runtime, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const label = providerLabel(runtime.provider);
  try {
    const body = {
      model,
      temperature: 0.1,
      max_tokens: MAX_ANSWER_TOKENS,
      messages
    };
    if (runtime.provider === 'deepseek') {
      body.thinking = { type: 'disabled' };
    }

    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const detail = clean(data?.error?.message || text || response.statusText, 500);
      const error = new Error(`${label} HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
      error.status = response.status;
      throw error;
    }
    const usage = normalizeUsage(data?.usage || {});
    if (usage.totalTokens || usage.promptTokens || usage.completionTokens) {
      await recordAiUsage('transcript-qa', usage).catch(() => {});
    }
    const rawAnswer = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!rawAnswer) throw new Error(`${label} вернул пустой финальный ответ`);
    const answer = finalAnswer(rawAnswer);
    if (!answer) throw new Error('Модель вернула служебное рассуждение без краткого ответа');
    return {
      answer,
      model: String(data?.model || model),
      usage
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
  if (!runtime.apiKey) throw new Error(`${providerLabel(runtime.provider)} API key не настроен локально в Workbench`);

  const messages = [
    {
      role: 'system',
      content: 'Отвечай только по предоставленной расшифровке звонка. Не додумывай и не используй внешние знания. Если нужная информация не упоминалась или из текста это нельзя установить, скажи об этом прямо. Отвечай только на русском языке. Не показывай рассуждения, анализ, внутренние инструкции, теги <think>, служебный текст или сам prompt. Не пересказывай расшифровку целиком. Дай только итог: 1–3 коротких предложения по сути вопроса. Если временная метка действительно помогает, укажи её в том же формате [MM:SS–MM:SS]. Не изменяй и не придумывай время. Финальный ответ начни с маркера ОТВЕТ:.'
    },
    {
      role: 'user',
      content: `Вопрос: ${question}\n\nРасшифровка звонка:\n${source}`
    }
  ];

  const failures = [];
  for (const model of runtime.models) {
    try {
      return await requestModel(messages, runtime, model);
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
