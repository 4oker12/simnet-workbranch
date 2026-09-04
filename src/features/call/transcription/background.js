import { MessageType } from '../../../shared/messages.js';

const PBX_ORIGIN = 'https://pbx.simnet.kiev.ua';
const PBX_RECORD_PATH = '/fop2/getrec.php';
const DEFAULT_TRANSCRIBER_URL = 'http://127.0.0.1:8000';
const CONFIG_KEY = 'simnet_workbench_transcriber_config_v1';
const TRANSCRIPT_STORE_KEY = 'simnet_workbench_transcripts_v1';
const TRANSCRIPT_STORE_SCHEMA = 1;
const TRANSCRIPT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TRANSCRIPTS = 120;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 100_000;
const HEALTH_TIMEOUT_MS = 7_000;
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

const HANDLED_TYPES = new Set([
  MessageType.CALL_TRANSCRIBER_HEALTH,
  MessageType.CALL_TRANSCRIBER_CONFIG_GET,
  MessageType.CALL_TRANSCRIBER_CONFIG_SET,
  MessageType.CALL_TRANSCRIBE_RECORD,
  MessageType.CALL_TRANSCRIPT_GET
]);

let transcriptWriteQueue = Promise.resolve();

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function internalSender(sender = {}) {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  const url = String(sender.url || sender.tab?.url || '');
  if (!url) return true;
  return /^(?:chrome-extension:\/\/|https:\/\/(?:userside\.simnet\.kiev\.ua|admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)\/)/i.test(url);
}

function cleanText(value, max = 240) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function recordIdFromUrl(url) {
  return String(url.searchParams.get('id') || '').match(/^\d{6,12}\.\d{1,12}$/)?.[0] || '';
}

function normalizeRecordUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('Некорректная ссылка записи PBX');
  }
  if (url.origin !== PBX_ORIGIN || url.pathname !== PBX_RECORD_PATH) {
    throw new Error('Workbench разрешает транскрипцию только штатного PBX getrec.php');
  }
  if (!recordIdFromUrl(url)) {
    throw new Error('В ссылке PBX отсутствует корректный record id');
  }
  url.hash = '';
  return url;
}

function normalizeTranscriberUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_TRANSCRIBER_URL));
  } catch {
    throw new Error('Некорректный URL транскрибера');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Транскрибер разрешён только через локальный SSH-туннель 127.0.0.1/localhost');
  }
  if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('URL транскрибера должен содержать только локальный host и port');
  }
  url.pathname = '/';
  return url.href.replace(/\/$/, '');
}

async function readConfig() {
  const raw = (await chrome.storage.local.get(CONFIG_KEY))?.[CONFIG_KEY] || {};
  let baseUrl = DEFAULT_TRANSCRIBER_URL;
  try {
    baseUrl = normalizeTranscriberUrl(raw.baseUrl || DEFAULT_TRANSCRIBER_URL);
  } catch {}
  return {
    schemaVersion: 1,
    baseUrl,
    profile: ['baseline', 'simnet'].includes(String(raw.profile || '').toLowerCase())
      ? String(raw.profile).toLowerCase()
      : 'simnet',
    language: ['auto', 'uk', 'ru'].includes(String(raw.language || '').toLowerCase())
      ? String(raw.language).toLowerCase()
      : 'auto'
  };
}

async function writeConfig(payload = {}) {
  const current = await readConfig();
  const next = {
    schemaVersion: 1,
    baseUrl: payload.baseUrl == null ? current.baseUrl : normalizeTranscriberUrl(payload.baseUrl),
    profile: payload.profile == null ? current.profile : String(payload.profile).toLowerCase(),
    language: payload.language == null ? current.language : String(payload.language).toLowerCase()
  };
  if (!['baseline', 'simnet'].includes(next.profile)) {
    throw new Error('profile должен быть baseline или simnet');
  }
  if (!['auto', 'uk', 'ru'].includes(next.language)) {
    throw new Error('language должен быть auto, uk или ru');
  }
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Таймаут запроса ${Math.round(timeoutMs / 1000)} сек.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function responseJson(response, label) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) {
    const detail = cleanText(data?.detail || data?.error || text || response.statusText, 500);
    throw new Error(`${label}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error(`${label}: сервер вернул не JSON`);
  }
  return data;
}

export async function transcriberHealth() {
  const config = await readConfig();
  const response = await fetchWithTimeout(`${config.baseUrl}/health`, {
    method: 'GET',
    cache: 'no-store'
  }, HEALTH_TIMEOUT_MS);
  const health = await responseJson(response, 'Transcriber health');
  return { config, health };
}

async function fetchPbxAudio(recordUrl) {
  const response = await fetchWithTimeout(recordUrl.href, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow'
  }, 30_000);

  if (!response.ok) {
    throw new Error(`PBX: HTTP ${response.status}`);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const blob = await response.blob();
  if (!blob.size) throw new Error('PBX вернул пустую запись');
  if (blob.size > MAX_AUDIO_BYTES) {
    throw new Error(`Запись PBX больше ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MiB`);
  }
  if (/text\/html|application\/json|text\/plain/.test(contentType)) {
    throw new Error('PBX вернул страницу/ошибку вместо аудио — проверь авторизацию PBX');
  }

  return {
    blob,
    contentType: contentType || 'audio/mpeg',
    size: blob.size
  };
}

function transcriptStoreShape(raw = {}) {
  return {
    schemaVersion: TRANSCRIPT_STORE_SCHEMA,
    updatedAt: String(raw.updatedAt || ''),
    entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
  };
}

function transcriptKey(payload = {}, recordId = '') {
  const callKey = String(payload.callKey || '').trim();
  if (/^(?:call|pbx):/.test(callKey)) return callKey;
  const usersideCallId = String(payload.usersideCallId || '').match(/^\d{1,12}$/)?.[0] || '';
  if (usersideCallId) return `call:${usersideCallId}`;
  return recordId ? `pbx:${recordId}` : '';
}

async function readTranscript(payload = {}) {
  const recordUrl = payload.recordUrl ? normalizeRecordUrl(payload.recordUrl) : null;
  const key = transcriptKey(payload, recordUrl ? recordIdFromUrl(recordUrl) : '');
  if (!key) return null;
  const raw = (await chrome.storage.local.get(TRANSCRIPT_STORE_KEY))?.[TRANSCRIPT_STORE_KEY] || {};
  const store = transcriptStoreShape(raw);
  return store.entries[key] || null;
}

async function saveTranscript(entry) {
  transcriptWriteQueue = transcriptWriteQueue.then(async () => {
    const raw = (await chrome.storage.local.get(TRANSCRIPT_STORE_KEY))?.[TRANSCRIPT_STORE_KEY] || {};
    const store = transcriptStoreShape(raw);
    const cutoff = Date.now() - TRANSCRIPT_RETENTION_MS;
    const entries = Object.values(store.entries)
      .filter(item => Number(item?.createdAtMs || 0) >= cutoff)
      .filter(item => item?.callKey && item.callKey !== entry.callKey);
    entries.push(entry);
    entries.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
    const trimmed = entries.slice(0, MAX_TRANSCRIPTS);
    store.entries = Object.fromEntries(trimmed.map(item => [item.callKey, item]));
    store.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [TRANSCRIPT_STORE_KEY]: store });
  });
  await transcriptWriteQueue;
  return entry;
}

function progress(onProgress, stage, details = {}) {
  if (typeof onProgress !== 'function') return Promise.resolve();
  try {
    return Promise.resolve(onProgress(stage, details));
  } catch {
    return Promise.resolve();
  }
}

export async function transcribeRecord(payload = {}, onProgress = null) {
  const recordUrl = normalizeRecordUrl(payload.recordUrl);
  const recordId = recordIdFromUrl(recordUrl);
  const callKey = transcriptKey(payload, recordId);
  if (!callKey) throw new Error('Не удалось определить callKey для транскрипта');

  if (payload.force !== true) {
    const cached = await readTranscript({ ...payload, callKey, recordUrl: recordUrl.href });
    if (cached?.pbxRecordId === recordId && cached?.text) {
      await progress(onProgress, 'TRANSCRIPT_READY', {
        cached: true,
        fileBytes: Number(cached.fileBytes || 0),
        processingSeconds: Number(cached.processingSeconds || 0)
      });
      return { ...cached, cached: true };
    }
  }

  const config = await readConfig();
  const language = ['auto', 'uk', 'ru'].includes(String(payload.language || '').toLowerCase())
    ? String(payload.language).toLowerCase()
    : config.language;
  const profile = ['baseline', 'simnet'].includes(String(payload.profile || '').toLowerCase())
    ? String(payload.profile).toLowerCase()
    : config.profile;

  await progress(onProgress, 'AUDIO_FETCHING', { recordId });
  const audio = await fetchPbxAudio(recordUrl);
  await progress(onProgress, 'AUDIO_READY', {
    recordId,
    fileBytes: audio.size,
    contentType: audio.contentType
  });

  const form = new FormData();
  form.append('file', audio.blob, `pbx-${recordId}.mp3`);
  form.append('language', language);
  form.append('profile', profile);

  await progress(onProgress, 'TRANSCRIBING', {
    recordId,
    baseUrl: config.baseUrl,
    fileBytes: audio.size
  });
  const response = await fetchWithTimeout(`${config.baseUrl}/transcribe`, {
    method: 'POST',
    body: form,
    cache: 'no-store'
  }, TRANSCRIBE_TIMEOUT_MS);
  const result = await responseJson(response, 'Transcriber');
  const text = String(result.text || '').trim();
  if (!result.ok || !text) {
    throw new Error('Транскрибер не вернул распознанный текст');
  }
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`Транскрипт превышает лимит ${MAX_TRANSCRIPT_CHARS} символов`);
  }

  const now = Date.now();
  const entry = {
    schemaVersion: 1,
    kind: 'CALL_TRANSCRIPT',
    callKey,
    usersideCallId: String(payload.usersideCallId || '').replace(/\D+/g, '').slice(0, 12),
    customerId: String(payload.customerId || '').replace(/\D+/g, '').slice(0, 12),
    pbxRecordId: recordId,
    source: 'pbx:getrec->simnet-transcriber',
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    cached: false,
    text,
    language: String(result.language || ''),
    languageProbability: Number(result.language_probability || 0),
    profile: String(result.profile || profile),
    durationSeconds: Number(result.duration_seconds || 0),
    processingSeconds: Number(result.processing_seconds || 0),
    realtimeFactor: Number(result.realtime_factor || 0),
    requestId: String(result.request_id || ''),
    audioSha256: String(result.audio_sha256 || ''),
    fileBytes: Number(result.file_bytes || audio.size),
    transcriptSchema: String(result.schema || ''),
    segments: Array.isArray(result.segments)
      ? result.segments.slice(0, 500).map(segment => ({
          id: Number(segment?.id || 0),
          start: Number(segment?.start || 0),
          end: Number(segment?.end || 0),
          text: String(segment?.text || '').slice(0, 2000)
        }))
      : [],
    analysis: null
  };

  const saved = await saveTranscript(entry);
  await progress(onProgress, 'TRANSCRIPT_READY', {
    cached: false,
    fileBytes: saved.fileBytes,
    processingSeconds: saved.processingSeconds,
    durationSeconds: saved.durationSeconds,
    language: saved.language,
    requestId: saved.requestId
  });
  return saved;
}

async function handle(type, payload = {}) {
  if (type === MessageType.CALL_TRANSCRIBER_HEALTH) return transcriberHealth();
  if (type === MessageType.CALL_TRANSCRIBER_CONFIG_GET) return readConfig();
  if (type === MessageType.CALL_TRANSCRIBER_CONFIG_SET) return writeConfig(payload);
  if (type === MessageType.CALL_TRANSCRIPT_GET) return readTranscript(payload);
  if (type === MessageType.CALL_TRANSCRIBE_RECORD) return transcribeRecord(payload);
  throw new Error(`Unsupported transcription message: ${type}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (!HANDLED_TYPES.has(type)) return false;

  if (!internalSender(sender)) {
    sendResponse({ success: false, error: 'Transcription request rejected: invalid sender' });
    return false;
  }

  void handle(type, message?.payload || {})
    .then(data => sendResponse({ success: true, data }))
    .catch(error => {
      console.error('[SIMNET WB][TRANSCRIPTION]', error);
      sendResponse({ success: false, error: errorMessage(error) });
    });
  return true;
});
