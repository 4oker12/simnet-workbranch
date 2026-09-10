import { MessageType } from '../../../shared/messages.js';

const PBX_ORIGIN = 'https://pbx.simnet.kiev.ua';
const PBX_RECORD_PATH = '/fop2/getrec.php';
const MAX_PROBE_BYTES = 64 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 30_000;

function internalSender(sender = {}) {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  const url = String(sender.url || sender.tab?.url || '');
  if (!url) return true;
  return /^(?:chrome-extension:\/\/|https:\/\/(?:userside\.simnet\.kiev\.ua|admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)\/)/i.test(url);
}

function normalizeRecordUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('Некорректная ссылка записи PBX');
  }
  if (url.origin !== PBX_ORIGIN || url.pathname !== PBX_RECORD_PATH) {
    throw new Error('Диагностика разрешена только для штатного PBX getrec.php');
  }
  const recordId = String(url.searchParams.get('id') || '').match(/^\d{6,12}\.\d{1,12}$/)?.[0] || '';
  if (!recordId) throw new Error('В ссылке PBX отсутствует корректный record id');
  url.hash = '';
  return { url, recordId };
}

function bytesHex(bytes, max = 16) {
  return Array.from(bytes.slice(0, max), byte => byte.toString(16).padStart(2, '0')).join(' ');
}

function audioSignature(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'ID3/MP3';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'MPEG audio frame';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE') return 'RIFF/WAVE';
  if (bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === 'OggS') return 'Ogg';
  return '';
}

function textPreview(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.slice(0, 512))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  } catch {
    return '';
  }
}

function parseContentRange(value) {
  const match = String(value || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3])
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`PBX probe timeout after ${PROBE_TIMEOUT_MS / 1000}s`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function inspectAttempt(recordUrl, mode) {
  const headers = mode === 'range' ? { Range: 'bytes=0-65535' } : undefined;
  const startedAt = performance.now();

  try {
    const response = await fetchWithTimeout(recordUrl.href, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      ...(headers ? { headers } : {})
    });

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_PROBE_BYTES) {
      return {
        mode,
        ok: false,
        status: response.status,
        statusText: response.statusText,
        error: `Content-Length exceeds ${Math.round(MAX_PROBE_BYTES / 1024 / 1024)} MiB`
      };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PROBE_BYTES) {
      return {
        mode,
        ok: false,
        status: response.status,
        statusText: response.statusText,
        error: `Response exceeds ${Math.round(MAX_PROBE_BYTES / 1024 / 1024)} MiB`
      };
    }

    const bytes = new Uint8Array(buffer);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const contentRange = String(response.headers.get('content-range') || '');
    const parsedRange = parseContentRange(contentRange);
    const signature = audioSignature(bytes);
    const looksLikeAudio = Boolean(signature || /^audio\//i.test(contentType));
    const suspiciousText = /text\/html|application\/json|text\/plain/i.test(contentType);
    const wholeFileLikely = response.status === 200 || Boolean(
      response.status === 206
      && parsedRange
      && parsedRange.start === 0
      && parsedRange.total != null
      && parsedRange.end + 1 >= parsedRange.total
    );

    return {
      mode,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      redirected: response.redirected,
      contentType,
      contentLengthHeader: declaredLength || null,
      acceptRanges: String(response.headers.get('accept-ranges') || ''),
      contentRange,
      bytesReceived: buffer.byteLength,
      firstBytesHex: bytesHex(bytes),
      signature,
      looksLikeAudio,
      wholeFileLikely,
      bodyPreview: suspiciousText || !looksLikeAudio ? textPreview(bytes) : '',
      elapsedMs: Math.round(performance.now() - startedAt)
    };
  } catch (error) {
    return {
      mode,
      ok: false,
      status: 0,
      statusText: '',
      error: error instanceof Error ? error.message : String(error || 'unknown error'),
      elapsedMs: Math.round(performance.now() - startedAt)
    };
  }
}

async function probePbxRecord(payload = {}) {
  const { url, recordId } = normalizeRecordUrl(payload.recordUrl);
  const direct = await inspectAttempt(url, 'direct');
  const attempts = [direct];

  if (direct.ok && direct.looksLikeAudio && direct.wholeFileLikely) {
    return {
      schemaVersion: 1,
      recordId,
      verdict: 'DIRECT_AUDIO',
      downloadableForTranscription: true,
      attempts
    };
  }

  const range = await inspectAttempt(url, 'range');
  attempts.push(range);
  const rangeAudio = Boolean(range.ok && range.looksLikeAudio);

  return {
    schemaVersion: 1,
    recordId,
    verdict: rangeAudio ? 'RANGE_AUDIO_ONLY' : 'NOT_AUDIO',
    downloadableForTranscription: Boolean(direct.ok && direct.looksLikeAudio && direct.wholeFileLikely),
    attempts
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MessageType.CALL_PBX_RECORD_PROBE) return false;

  if (!internalSender(sender)) {
    sendResponse({ success: false, error: 'PBX probe rejected: invalid sender' });
    return false;
  }

  void probePbxRecord(message?.payload || {})
    .then(data => sendResponse({ success: true, data }))
    .catch(error => {
      console.error('[SIMNET WB][PBX PROBE]', error);
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});
