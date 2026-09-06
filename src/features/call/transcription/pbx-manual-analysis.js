'use strict';

import { MessageType } from '../../../shared/messages.js';
import { CallRecord } from '../domain/call-record.js';
import { CallStateStore } from '../storage/call-state-store.js';
import { callExecutionRegistry } from '../runtime/call-execution-registry.js';
import { readTranscript, transcribeRecord } from './background.js';
import { postprocessTranscript } from './ai-postprocessor.js';

const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
const OWNER = 'pbx-manual';

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 500) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function recordIdOf(value) {
  return String(value || '').match(/(?:getrec\.php\?id=|^pbx:)?(\d{9,12}\.\d{1,12})/i)?.[1] || '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length >= 6 && digits.length <= 15 ? digits : '';
}

function normalizeCall(raw = {}) {
  const recordId = recordIdOf(raw.recordId || raw.recordUrl || raw.callId);
  if (!recordId) throw new Error('PBX manual analysis: recordId не найден');
  return {
    recordId,
    callKey: `pbx:${recordId}`,
    recordUrl: `${PBX_RECORD_BASE}${encodeURIComponent(recordId)}`,
    source: 'pbx:history',
    rowNumber: clean(raw.rowNumber, 24),
    date: clean(raw.date, 24),
    time: clean(raw.time, 24),
    callerId: normalizePhone(raw.callerId),
    providerCode: clean(raw.providerCode, 20),
    contract: clean(raw.contract, 80),
    fio: clean(raw.fio, 180),
    address: clean(raw.address, 300),
    duration: clean(raw.duration, 32),
    queue: clean(raw.queue, 40),
    agent: clean(raw.agent, 180),
    createdAtMs: Number(raw.createdAtMs || 0) || Date.now()
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

async function broadcast(recordId = '', callKey = '') {
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://pbx.simnet.kiev.ua/*',
      'https://userside.simnet.kiev.ua/*',
      'https://admin.simnet.kiev.ua/*',
      'https://admin.looknet.kiev.ua/*'
    ] });
    await Promise.allSettled((tabs || []).map(tab => tab?.id == null
      ? Promise.resolve()
      : chrome.tabs.sendMessage(tab.id, {
          type: MessageType.CALL_PROCESSING_CHANGED,
          payload: { recordId, callKey }
        })));
  } catch {}
}

async function updateCall(callKey, recordId, mutator) {
  const next = await CallStateStore.mutate(callKey, mutator);
  if (next) await broadcast(recordId || next.pbxRecordId || '', next.callKey || callKey);
  return next;
}

function manualStatus(call = {}) {
  const p = call.processing || {};
  const state = String(p.state || 'idle');
  const stage = String(p.stage || '');
  if (state === 'cancelled') return 'cancelled';
  if (state === 'stale') return 'interrupted';
  if (state === 'running') {
    if (stage === 'audio') return 'downloading';
    if (stage === 'whisper') return 'transcribing';
    if (stage === 'ai') return 'analyzing';
    return 'queued';
  }
  if (state === 'failed') {
    if (stage === 'ai' && call.transcript) return 'transcribed';
    return 'error';
  }
  if (call.ai?.analysis) return 'ready';
  if (call.transcript) return 'transcribed';
  if (state === 'waiting') return stage === 'ai' ? 'analyzing' : 'queued';
  return 'idle';
}

async function manualView(call = {}) {
  const recordId = recordIdOf(call.pbxRecordId || call.callKey);
  if (!recordId) return null;
  const transcript = await readTranscript({
    callKey: call.transcript?.storageKey || call.callKey,
    recordUrl: `${PBX_RECORD_BASE}${encodeURIComponent(recordId)}`
  }).catch(() => null);
  const status = manualStatus(call);
  const p = call.processing || {};
  const aiError = status === 'transcribed' && p.stage === 'ai' && p.state === 'failed' ? p.error : '';
  return {
    schemaVersion: 2,
    recordId,
    callKey: call.callKey,
    status,
    call: {
      recordId,
      date: call.date || '',
      time: call.time || '',
      callerId: call.callerId || '',
      contract: call.contract || call.subscriber?.contract || '',
      fio: call.fio || '',
      address: call.address || '',
      duration: call.duration || '',
      agent: call.agent || ''
    },
    transcript: transcript?.text ? {
      text: String(transcript.text || ''),
      language: transcript.language || call.transcript?.language || '',
      languageProbability: Number(transcript.languageProbability || 0),
      durationSeconds: Number(transcript.durationSeconds || call.transcript?.durationSeconds || 0),
      processingSeconds: Number(transcript.processingSeconds || call.transcript?.processingSeconds || 0),
      requestId: transcript.requestId || call.transcript?.requestId || '',
      cached: Boolean(transcript.cached || call.transcript?.cached)
    } : (call.transcript ? { ...call.transcript } : null),
    transcriptMeta: call.transcript ? { ...call.transcript } : null,
    analysis: call.ai?.analysis || null,
    aiError,
    error: status === 'error' || status === 'interrupted' ? String(p.error || '') : '',
    createdAt: call.firstObservedAt || call.observedAt || '',
    createdAtMs: Number(call.startedAtMs || 0),
    updatedAt: call.updatedAt || p.updatedAt || '',
    completedAt: stateCompletedAt(call)
  };
}

function stateCompletedAt(call = {}) {
  const p = call.processing || {};
  return ['done', 'cancelled', 'failed', 'stale'].includes(String(p.state || '')) ? String(p.updatedAt || '') : '';
}

async function ensureCall(call) {
  const stored = await CallStateStore.ensurePbx({
    recordId: call.recordId,
    pbxRecordId: call.recordId,
    source: call.source,
    date: call.date,
    time: call.time,
    callerId: call.callerId,
    contract: call.contract,
    fio: call.fio,
    address: call.address,
    duration: call.duration,
    agent: call.agent,
    createdAtMs: call.createdAtMs
  });
  if (!stored) throw new Error('Не удалось создать CallRecord для PBX-звонка');
  if (stored.processing?.steps?.pbx?.status !== 'done') {
    return updateCall(stored.callKey, call.recordId, record => record.attachPbx(call.recordId));
  }
  return stored;
}

async function processManual(call, options = {}) {
  let stored = await ensureCall(call);
  const callKey = stored.callKey;

  const active = callExecutionRegistry.get(callKey);
  if (active && active.owner !== OWNER) {
    try { await active.promise; } catch {}
    stored = await CallStateStore.read(callKey) || stored;
  }
  if (callExecutionRegistry.has(callKey)) return manualView(await CallStateStore.read(callKey));

  return callExecutionRegistry.run(callKey, OWNER, async signal => {
    try {
      const transcript = await transcribeRecord({
        callKey,
        recordUrl: call.recordUrl,
        profile: 'simnet',
        language: 'auto',
        force: Boolean(options.forceTranscribe)
      }, async (stage, details = {}) => {
        if (signal.aborted) return;
        const at = nowIso();
        if (stage === 'AUDIO_FETCHING') {
          await updateCall(callKey, call.recordId, record => record.startStage('audio', at, { owner: OWNER }));
        } else if (stage === 'AUDIO_READY') {
          await updateCall(callKey, call.recordId, record => record.completeStage('audio', { detail: `${Number(details.fileBytes || 0)} B` }, at));
        } else if (stage === 'TRANSCRIBING') {
          await updateCall(callKey, call.recordId, record => record.startStage('whisper', at, { owner: OWNER }));
        } else if (stage === 'TRANSCRIPT_READY') {
          await updateCall(callKey, call.recordId, record => {
            record.setTranscript({
              callKey,
              requestId: details.requestId,
              language: details.language,
              durationSeconds: details.durationSeconds,
              processingSeconds: details.processingSeconds,
              fileBytes: details.fileBytes,
              cached: details.cached,
              createdAt: at
            }, at);
            record.completeStage('whisper', {
              detail: details.cached ? 'из кеша' : `${Number(details.processingSeconds || 0).toFixed(2)} сек.`
            }, at);
          });
        }
      }, signal);

      if (signal.aborted) return manualView(await CallStateStore.read(callKey));
      await updateCall(callKey, call.recordId, record => {
        record.setTranscript({
          callKey: transcript.callKey,
          requestId: transcript.requestId,
          language: transcript.language,
          durationSeconds: transcript.durationSeconds,
          processingSeconds: transcript.processingSeconds,
          fileBytes: transcript.fileBytes,
          audioSha256: transcript.audioSha256,
          cached: transcript.cached,
          createdAt: transcript.createdAt
        });
        if (record.processing.steps?.whisper?.status !== 'done') {
          record.completeStage('whisper', { detail: transcript.cached ? 'из кеша' : `${Number(transcript.processingSeconds || 0).toFixed(2)} сек.` });
        }
        record.startStage('ai', nowIso(), { owner: OWNER });
      });

      try {
        const analysis = await postprocessTranscript({
          callKey,
          pbxRecordId: call.recordId,
          manualPbx: true,
          forceAnalysis: Boolean(options.forceAnalysis)
        }, transcript, signal);
        if (signal.aborted) return manualView(await CallStateStore.read(callKey));
        await updateCall(callKey, call.recordId, record => {
          record.setAi(analysis, {
            model: analysis?.model,
            usage: analysis?.usage,
            mode: analysis?.mode
          });
          record.completeStage('ai', { detail: analysis?.model ? `модель ${analysis.model}` : 'разбор готов' });
          if (!record.toJSON().usersideCallId) record.finish(nowIso(), 'PBX manual analysis complete');
        });
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') return manualView(await CallStateStore.read(callKey));
        await updateCall(callKey, call.recordId, record => record.fail('ai', error));
      }
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return manualView(await CallStateStore.read(callKey));
      const message = clean(error?.message || error || 'PBX manual analysis failed', 700);
      const current = await CallStateStore.read(callKey);
      const stage = current?.processing?.stage === 'audio' ? 'audio' : 'whisper';
      await updateCall(callKey, call.recordId, record => record.fail(stage, message));
    }
    return manualView(await CallStateStore.read(callKey));
  });
}

async function start(payload = {}) {
  const call = normalizeCall(payload.call || {});
  const stored = await ensureCall(call);
  const existing = await manualView(stored);
  const force = Boolean(payload.force);
  if (existing && !force && ['ready', 'transcribed'].includes(existing.status)) return existing;

  await updateCall(stored.callKey, call.recordId, record => {
    record.processing.attention = false;
    record.processing.attentionDismissedAt = '';
    if (['cancelled', 'stale', 'failed'].includes(String(record.processing.state || ''))) {
      record.processing.state = 'waiting';
      record.processing.error = '';
    }
  });

  return processManual(call, {
    forceTranscribe: Boolean(payload.forceTranscribe),
    forceAnalysis: Boolean(payload.forceAnalysis)
  });
}

async function cancel(payload = {}) {
  const recordId = recordIdOf(payload.recordId);
  if (!recordId) throw new Error('PBX manual analysis cancel: recordId не найден');
  const call = (await CallStateStore.list()).find(row => row.pbxRecordId === recordId || row.callKey === `pbx:${recordId}`) || null;
  if (!call) return null;
  callExecutionRegistry.cancel(call.callKey, OWNER);
  const next = await updateCall(call.callKey, recordId, record => record.cancel());
  return manualView(next || call);
}

async function status(payload = {}) {
  const recordId = recordIdOf(payload.recordId);
  const calls = await CallStateStore.list();
  if (recordId) {
    const call = calls.find(row => row.pbxRecordId === recordId || row.callKey === `pbx:${recordId}`) || null;
    return call ? manualView(call) : null;
  }

  const relevant = calls.filter(call => call.pbxRecordId && (
    call.source === 'pbx:history'
    || call.processing?.owner === OWNER
    || call.ai?.analysis
    || call.callKey.startsWith('pbx:')
  ));
  const views = await Promise.all(relevant.slice(0, 120).map(manualView));
  return Object.fromEntries(views.filter(Boolean).map(view => [view.recordId, view]));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (![
    MessageType.PBX_MANUAL_ANALYSIS_START,
    MessageType.PBX_MANUAL_ANALYSIS_CANCEL,
    MessageType.PBX_MANUAL_ANALYSIS_STATUS
  ].includes(type)) return false;

  if (!senderIsPbx(sender)) {
    sendResponse({ success: false, error: 'PBX manual analysis request rejected: invalid sender' });
    return false;
  }

  const action = type === MessageType.PBX_MANUAL_ANALYSIS_START
    ? start(message?.payload || {})
    : type === MessageType.PBX_MANUAL_ANALYSIS_CANCEL
      ? cancel(message?.payload || {})
      : status(message?.payload || {});

  void action
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: clean(error?.message || error || 'unknown error', 700) }));
  return true;
});

export const PBXManualAnalysis = Object.freeze({ start, cancel, status });
