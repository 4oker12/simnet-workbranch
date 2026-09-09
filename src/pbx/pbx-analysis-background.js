import { AI_CONFIG } from '../config/ai-config.js';

const JOBS_KEY = 'simnet_pbx_manual_analysis_jobs_v1';
const CONFIG_KEY = 'simnet_pbx_manual_analysis_config_v1';
const JOB_SCHEMA = 'simnet-pbx-manual-analysis-job-v1';
const MAX_JOBS = 120;
const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
const STALE_PROCESSING_MS = 90 * 1000;

const MessageType = Object.freeze({
  START: 'PBX_MANUAL_ANALYSIS_START',
  STATUS: 'PBX_MANUAL_ANALYSIS_STATUS',
  CONFIG_GET: 'PBX_MANUAL_ANALYSIS_CONFIG_GET',
  CONFIG_SET: 'PBX_MANUAL_ANALYSIS_CONFIG_SET'
});

const DEFAULT_CONFIG = Object.freeze({
  transcriberBaseUrl: 'http://127.0.0.1:8090',
  language: 'auto',
  profile: 'simnet',
  aiEnabled: true
});

const PROCESSING_STATES = new Set([
  'queued',
  'downloading',
  'transcribing',
  'analyzing'
]);

const running = new Map();

function nowIso() {
  return new Date().toISOString();
}

function compact(value, max = 500) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeArray(value, max = 12) {
  return Array.isArray(value)
    ? value.map(item => compact(item, 500)).filter(Boolean).slice(0, max)
    : [];
}

function recordIdOf(value) {
  const text = String(value || '').trim();
  const match = text.match(/(?:getrec\.php\?id=)?(\d{9,12}\.\d{1,12})/i);
  return match ? match[1] : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length >= 6 && digits.length <= 15 ? digits : '';
}

function normalizeCall(raw = {}) {
  const recordId = recordIdOf(raw.recordId || raw.recordUrl || raw.callId || raw.callKey);
  if (!recordId) throw new Error('PBX analysis: recordId не найден');

  const recordUrl = `https://pbx.simnet.kiev.ua/fop2/getrec.php?id=${encodeURIComponent(recordId)}`;
  return {
    recordId,
    callKey: `pbx:${recordId}`,
    recordUrl,
    rowNumber: compact(raw.rowNumber, 24),
    date: compact(raw.date, 24),
    time: compact(raw.time, 24),
    callerId: normalizePhone(raw.callerId),
    providerCode: compact(raw.providerCode, 20),
    contract: compact(raw.contract, 80),
    fio: compact(raw.fio, 180),
    address: compact(raw.address, 300),
    duration: compact(raw.duration, 32),
    agent: compact(raw.agent, 180),
    queue: compact(raw.queue, 40)
  };
}

function senderIsPbx(sender = {}) {
  try {
    const url = new URL(String(sender?.url || sender?.tab?.url || ''));
    return url.protocol === 'https:' && url.hostname === 'pbx.simnet.kiev.ua';
  } catch {
    return false;
  }
}

async function storageGet(key) {
  return chrome.storage.local.get(key);
}

async function storageSet(value) {
  await chrome.storage.local.set(value);
}

async function readJobs() {
  const stored = await storageGet(JOBS_KEY);
  const value = stored?.[JOBS_KEY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pruneJobs(jobs) {
  const entries = Object.entries(jobs || {})
    .filter(([, job]) => job && typeof job === 'object' && recordIdOf(job.recordId))
    .sort(([, left], [, right]) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  return Object.fromEntries(entries.slice(0, MAX_JOBS));
}

async function writeJob(recordId, patch = {}) {
  const jobs = await readJobs();
  const previous = jobs[recordId] || {};
  const next = {
    schema: JOB_SCHEMA,
    ...previous,
    ...patch,
    recordId,
    updatedAt: nowIso()
  };
  jobs[recordId] = next;
  await storageSet({ [JOBS_KEY]: pruneJobs(jobs) });
  return next;
}

async function readConfig() {
  const stored = await storageGet(CONFIG_KEY);
  const raw = stored?.[CONFIG_KEY];
  return {
    ...DEFAULT_CONFIG,
    ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})
  };
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_CONFIG.transcriberBaseUrl));
  } catch {
    throw new Error('PBX analysis: некорректный URL транскрибера');
  }
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local))) {
    throw new Error('PBX analysis: транскрибер разрешён только через HTTPS или локальный HTTP tunnel');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function setConfig(raw = {}) {
  const previous = await readConfig();
  const next = {
    ...previous,
    transcriberBaseUrl: normalizeBaseUrl(raw.transcriberBaseUrl ?? previous.transcriberBaseUrl),
    language: ['auto', 'uk', 'ru'].includes(String(raw.language || previous.language).toLowerCase())
      ? String(raw.language || previous.language).toLowerCase()
      : 'auto',
    profile: compact(raw.profile ?? previous.profile, 40) || 'simnet',
    aiEnabled: raw.aiEnabled == null ? Boolean(previous.aiEnabled) : Boolean(raw.aiEnabled)
  };
  await storageSet({ [CONFIG_KEY]: next });
  return next;
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function firstBytesLookHtml(buffer) {
  try {
    const sample = new TextDecoder().decode(buffer.slice(0, 512)).trim().toLowerCase();
    return sample.startsWith('<!doctype html') || sample.startsWith('<html') || sample.includes('<body');
  } catch {
    return false;
  }
}

async function fetchRecording(call) {
  const timer = timeoutSignal(45000);
  try {
    const response = await fetch(call.recordUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal: timer.signal
    });
    if (!response.ok) throw new Error(`PBX запись: HTTP ${response.status}`);

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error('PBX запись: получен пустой файл');
    if (buffer.byteLength > MAX_RECORDING_BYTES) throw new Error('PBX запись слишком большая для ручного разбора');
    if (contentType.includes('text/html') || firstBytesLookHtml(buffer)) {
      throw new Error('PBX вместо аудио вернул HTML. Проверь авторизацию в pbx.simnet.kiev.ua');
    }

    return {
      blob: new Blob([buffer], { type: contentType || 'audio/mpeg' }),
      bytes: buffer.byteLength,
      contentType: contentType || 'audio/mpeg'
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('PBX запись: тайм-аут загрузки');
    throw error;
  } finally {
    timer.clear();
  }
}

async function transcribeRecording(recording, call, config) {
  const baseUrl = normalizeBaseUrl(config.transcriberBaseUrl);
  const form = new FormData();
  form.append('file', recording.blob, `${call.recordId}.mp3`);
  form.append('language', config.language || 'auto');
  if (config.profile) form.append('profile', config.profile);

  const timer = timeoutSignal(4 * 60 * 1000);
  try {
    const response = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST',
      body: form,
      cache: 'no-store',
      signal: timer.signal
    });
    const raw = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw || '{}'); } catch {}
    if (!response.ok) {
      const detail = parsed?.detail || raw || `HTTP ${response.status}`;
      throw new Error(`Transcriber ${response.status}: ${compact(detail, 700)}`);
    }
    const text = compact(parsed?.text, 200000);
    if (!text) throw new Error('Transcriber вернул пустой текст');
    return {
      ok: true,
      text,
      language: compact(parsed?.language, 16),
      profile: compact(parsed?.profile, 40),
      durationSeconds: Number(parsed?.duration_seconds || 0) || 0,
      processingSeconds: Number(parsed?.processing_seconds || 0) || 0,
      realtimeFactor: Number(parsed?.realtime_factor || 0) || 0,
      segments: Array.isArray(parsed?.segments)
        ? parsed.segments.slice(0, 2000).map(segment => ({
            id: Number(segment?.id || 0),
            start: Number(segment?.start || 0),
            end: Number(segment?.end || 0),
            text: compact(segment?.text, 3000)
          }))
        : []
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Transcriber: тайм-аут обработки');
    throw error;
  } finally {
    timer.clear();
  }
}

function analysisPrompt(transcript, call) {
  const meta = [
    call.date && `Дата: ${call.date}`,
    call.time && `Время: ${call.time}`,
    call.duration && `Длительность: ${call.duration}`,
    call.agent && `Оператор: ${call.agent}`
  ].filter(Boolean).join('\n');

  return `Разбери запись разговора оператора интернет-провайдера SIMNET по транскрипту ниже.\n\n${meta}\n\nТРАНСКРИПТ:\n${transcript.text}\n\nВерни только JSON без markdown со структурой:\n{\n  "topic": "краткая тема",\n  "customer_problem": "что сообщил/хотел абонент",\n  "facts": ["только факты, прозвучавшие в звонке"],\n  "operator_actions": ["что реально сделал/проверил/предложил оператор"],\n  "diagnosis": "вывод; отделяй гипотезу от подтверждённого факта",\n  "recommendations": ["что логично проверить/сделать дальше, если осталось нерешённое"],\n  "unresolved": ["что осталось неизвестно или не подтверждено"],\n  "summary": "2-4 предложения для быстрого просмотра"\n}\nНе выдумывай сетевые проверки, результаты и действия, которых нет в разговоре. Если качество транскрипта не позволяет сделать вывод — укажи это.`;
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {}
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeAnalysis(parsed, rawAnswer, model) {
  const source = parsed || {};
  return {
    topic: compact(source.topic, 240),
    customerProblem: compact(source.customer_problem ?? source.customerProblem, 1200),
    facts: safeArray(source.facts, 16),
    operatorActions: safeArray(source.operator_actions ?? source.operatorActions, 16),
    diagnosis: compact(source.diagnosis, 1600),
    recommendations: safeArray(source.recommendations, 16),
    unresolved: safeArray(source.unresolved, 16),
    summary: compact(source.summary || rawAnswer, 2200),
    model: compact(model || AI_CONFIG.model, 120),
    parsed: Boolean(parsed),
    generatedAt: nowIso()
  };
}

async function analyzeTranscript(transcript, call) {
  const apiKey = String(AI_CONFIG.apiKey || '').trim();
  if (!apiKey) {
    return {
      available: false,
      reason: 'Groq API key не настроен в локальной конфигурации Workbench'
    };
  }

  const timer = timeoutSignal(Math.max(10000, Number(AI_CONFIG.timeoutMs || 45000)));
  try {
    const response = await fetch(`${String(AI_CONFIG.baseUrl || '').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        temperature: 0.1,
        max_completion_tokens: Math.max(700, Math.min(1800, Number(AI_CONFIG.maxTokens || 1200))),
        reasoning_format: 'hidden',
        reasoning_effort: 'default',
        messages: [
          {
            role: 'system',
            content: 'Ты анализируешь звонки техподдержки интернет-провайдера. Не выдумывай факты. Разделяй факты, действия оператора, гипотезы и следующие проверки.'
          },
          { role: 'user', content: analysisPrompt(transcript, call) }
        ]
      }),
      signal: timer.signal
    });

    const raw = await response.text();
    let envelope = null;
    try { envelope = JSON.parse(raw || '{}'); } catch {}
    if (!response.ok) {
      const detail = envelope?.error?.message || envelope?.error?.code || raw || `HTTP ${response.status}`;
      throw new Error(`AI API ${response.status}: ${compact(detail, 700)}`);
    }
    const answer = String(envelope?.choices?.[0]?.message?.content || '').trim();
    if (!answer) throw new Error('AI API вернул пустой ответ');
    return {
      available: true,
      analysis: normalizeAnalysis(parseJsonObject(answer), answer, envelope?.model),
      usage: envelope?.usage ? {
        promptTokens: Number(envelope.usage.prompt_tokens || 0),
        completionTokens: Number(envelope.usage.completion_tokens || 0),
        totalTokens: Number(envelope.usage.total_tokens || 0)
      } : null
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('AI анализ: тайм-аут запроса');
    throw error;
  } finally {
    timer.clear();
  }
}

async function failJob(recordId, stage, error) {
  return writeJob(recordId, {
    status: 'error',
    stage,
    error: {
      stage,
      message: compact(error?.message || error || 'unknown error', 1400),
      at: nowIso()
    }
  });
}

async function processCall(call, options = {}) {
  const config = await readConfig();
  const existingJobs = await readJobs();
  const existing = existingJobs[call.recordId] || null;
  let transcript = existing?.transcript?.text ? existing.transcript : null;

  try {
    if (!transcript || options.forceTranscribe) {
      await writeJob(call.recordId, {
        status: 'downloading',
        stage: 'recording',
        call,
        error: null
      });
      const recording = await fetchRecording(call);
      await writeJob(call.recordId, {
        status: 'transcribing',
        stage: 'transcription',
        recording: {
          bytes: recording.bytes,
          contentType: recording.contentType,
          downloadedAt: nowIso()
        },
        error: null
      });
      transcript = await transcribeRecording(recording, call, config);
      await writeJob(call.recordId, {
        status: config.aiEnabled ? 'analyzing' : 'transcribed',
        stage: config.aiEnabled ? 'ai' : 'done',
        transcript,
        transcribedAt: nowIso(),
        error: null
      });
    }

    if (!config.aiEnabled) {
      return writeJob(call.recordId, {
        status: 'transcribed',
        stage: 'done',
        transcript,
        ai: { available: false, reason: 'AI отключён в конфигурации' },
        completedAt: nowIso(),
        error: null
      });
    }

    await writeJob(call.recordId, {
      status: 'analyzing',
      stage: 'ai',
      transcript,
      error: null
    });

    const ai = await analyzeTranscript(transcript, call);
    if (!ai.available) {
      return writeJob(call.recordId, {
        status: 'transcribed',
        stage: 'ai-unavailable',
        transcript,
        ai,
        completedAt: nowIso(),
        error: null
      });
    }

    return writeJob(call.recordId, {
      status: 'ready',
      stage: 'done',
      transcript,
      analysis: ai.analysis,
      ai: {
        available: true,
        usage: ai.usage,
        model: ai.analysis?.model || ''
      },
      completedAt: nowIso(),
      error: null
    });
  } catch (error) {
    const jobs = await readJobs();
    const stage = jobs?.[call.recordId]?.stage || 'unknown';
    return failJob(call.recordId, stage, error);
  }
}

async function startAnalysis(payload = {}, sender = {}) {
  if (!senderIsPbx(sender)) throw new Error('PBX analysis start rejected: invalid sender');
  const call = normalizeCall(payload.call || payload);
  const force = Boolean(payload.force);
  const forceTranscribe = Boolean(payload.forceTranscribe);

  const jobs = await readJobs();
  const existing = jobs[call.recordId] || null;
  if (!force && existing?.status === 'ready') return existing;

  if (running.has(call.recordId)) return running.get(call.recordId);

  if (!force && existing && PROCESSING_STATES.has(existing.status)) {
    const age = Date.now() - Date.parse(existing.updatedAt || 0);
    if (Number.isFinite(age) && age >= 0 && age < STALE_PROCESSING_MS) return existing;
  }

  await writeJob(call.recordId, {
    schema: JOB_SCHEMA,
    call,
    status: existing?.transcript?.text && !forceTranscribe ? 'analyzing' : 'queued',
    stage: existing?.transcript?.text && !forceTranscribe ? 'ai' : 'queue',
    createdAt: existing?.createdAt || nowIso(),
    requestedAt: nowIso(),
    error: null
  });

  const promise = processCall(call, { forceTranscribe })
    .finally(() => running.delete(call.recordId));
  running.set(call.recordId, promise);
  return promise;
}

async function status(payload = {}) {
  const jobs = await readJobs();
  const ids = Array.isArray(payload.recordIds)
    ? payload.recordIds.map(recordIdOf).filter(Boolean)
    : [];
  if (!ids.length) return { jobs };
  const selected = {};
  for (const id of ids) if (jobs[id]) selected[id] = jobs[id];
  return { jobs: selected };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(MessageType).includes(type)) return false;

  const respond = promise => Promise.resolve(promise).then(
    data => sendResponse({ success: true, data }),
    error => sendResponse({ success: false, error: compact(error?.message || error, 1600) })
  );

  if (type === MessageType.START) {
    respond(startAnalysis(message?.payload || {}, sender));
    return true;
  }
  if (type === MessageType.STATUS) {
    respond(status(message?.payload || {}));
    return true;
  }
  if (type === MessageType.CONFIG_GET) {
    respond(readConfig());
    return true;
  }
  if (type === MessageType.CONFIG_SET) {
    respond(setConfig(message?.payload || {}));
    return true;
  }
  return false;
});

export const __PBX_MANUAL_ANALYSIS_TEST_API__ = Object.freeze({
  recordIdOf,
  normalizeCall,
  normalizeBaseUrl,
  parseJsonObject,
  normalizeAnalysis
});
