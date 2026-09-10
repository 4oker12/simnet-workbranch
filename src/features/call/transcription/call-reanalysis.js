'use strict';

import { MessageType } from '../../../shared/messages.js';
import { CallStateStore } from '../storage/call-state-store.js';
import { callExecutionRegistry } from '../runtime/call-execution-registry.js';
import { readTranscript } from './background.js';
import { normalizeAnalysisMode } from './ai-postprocessor.js';
import { writeTranscriptToUserSide } from './userside-writer.js';

const OWNER = 'reanalysis';
const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
const ALLOWED_HOSTS = new Set([
  'userside.simnet.kiev.ua',
  'admin.simnet.kiev.ua',
  'admin.looknet.kiev.ua'
]);

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 240) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function digits(value, max = 24) {
  return String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
}

function recordIdOf(call = {}) {
  return String(call.pbxRecordId || '').match(/^\d{9,12}\.\d{1,12}$/)?.[0] || '';
}

function senderAllowed(sender = {}) {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  try {
    const url = new URL(String(sender.url || sender.tab?.url || ''));
    if (url.protocol === 'chrome-extension:' && url.host === chrome.runtime.id) return true;
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function broadcast(callKey = '') {
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://userside.simnet.kiev.ua/*',
      'https://admin.simnet.kiev.ua/*',
      'https://admin.looknet.kiev.ua/*'
    ] });
    await Promise.allSettled((tabs || []).map(tab => tab?.id == null
      ? Promise.resolve()
      : chrome.tabs.sendMessage(tab.id, {
          type: MessageType.CALL_PROCESSING_CHANGED,
          payload: { callKey }
        })));
  } catch {}
}

async function updateCall(callKey, mutator) {
  const next = await CallStateStore.mutate(callKey, mutator);
  if (next) await broadcast(next.callKey || callKey);
  return next;
}

function writerPayload(call = {}, analysisMode = 'deep') {
  const recordId = recordIdOf(call);
  return {
    jobId: call.callKey,
    callKey: call.callKey,
    usersideCallId: digits(call.usersideCallId, 24),
    customerId: digits(call.subscriber?.customerId || call.customerId, 14),
    caseId: clean(call.subscriber?.caseId, 120),
    customerLabel: clean(call.fio || call.login || '', 160),
    phone: clean(call.callerMasked || call.callerId, 32),
    date: clean(call.date, 20),
    time: clean(call.time, 20),
    duration: clean(call.duration, 20),
    registeredAt: String(call.registration?.registeredAt || ''),
    pbxRecordId: recordId,
    recordUrl: recordId ? `${PBX_RECORD_BASE}${encodeURIComponent(recordId)}` : '',
    taskId: digits(call.writeback?.taskId, 14),
    analysisMode: normalizeAnalysisMode(analysisMode)
  };
}

function analysisDetail(mode, result = {}) {
  const label = normalizeAnalysisMode(mode) === 'deep' ? 'глубокий' : 'короткий';
  if (result.alreadyWritten) return `${label} разбор уже есть в UserSide`;
  const model = clean(result.ai?.model, 120);
  return model ? `${label} разбор · ${model}` : `${label} разбор готов`;
}

async function reanalyze(payload = {}) {
  const callKey = clean(payload.callKey, 160);
  if (!/^call:\d+$/.test(callKey)) throw new Error('CALL_REANALYZE: некорректный callKey');
  const analysisMode = normalizeAnalysisMode(payload.analysisMode || 'deep');

  const initial = await CallStateStore.read(callKey);
  if (!initial) throw new Error('CALL_REANALYZE: звонок не найден');
  if (initial.processing?.recordEnabled === false) throw new Error('CALL_REANALYZE: звонок зарегистрирован как NOREC');
  if (initial.registration?.state !== 'registered') throw new Error('CALL_REANALYZE: звонок ещё не зарегистрирован');
  if (!initial.transcript?.storageKey) throw new Error('CALL_REANALYZE: сохранённый транскрипт отсутствует');

  const active = callExecutionRegistry.get(callKey);
  if (active) throw new Error('CALL_REANALYZE: другая обработка этого звонка ещё выполняется');

  return callExecutionRegistry.run(callKey, OWNER, async signal => {
    const current = await CallStateStore.read(callKey);
    if (!current) throw new Error('CALL_REANALYZE: CallRecord исчез');

    const transcriptKey = clean(current.transcript?.storageKey || callKey, 160);
    const transcript = await readTranscript({ callKey: transcriptKey });
    if (!transcript?.text) {
      throw new Error('CALL_REANALYZE: сохранённый текст транскрипта не найден; Whisper повторно не запускается');
    }
    if (signal.aborted) return null;

    await updateCall(callKey, record => {
      record.processing.analysisMode = analysisMode;
      record.processing.reanalysisSource = 'saved-transcript';
      record.startStage('ai', nowIso(), { owner: OWNER });
      record.event('analysis_restarted', {
        mode: analysisMode,
        source: 'saved-transcript',
        whisperSkipped: true
      });
    });

    try {
      const fresh = await CallStateStore.read(callKey);
      const result = await writeTranscriptToUserSide(writerPayload(fresh || current, analysisMode), transcript);
      if (signal.aborted) return null;

      return updateCall(callKey, record => {
        record.processing.analysisMode = analysisMode;
        record.processing.reanalysisSource = 'saved-transcript';
        if (result.analysis) {
          record.setAi(result.analysis, {
            model: result.analysis.model,
            usage: result.analysis.usage,
            mode: result.analysis.mode
          });
        }
        record.completeStage('ai', { detail: analysisDetail(analysisMode, result) });
        record.startStage('userside', nowIso(), { owner: OWNER });
        record.setWriteback('done', { taskId: result.taskId });
        record.completeStage('userside', {
          detail: result.alreadyWritten
            ? `task #${digits(result.taskId, 14)} уже содержит ${analysisMode} AI-разбор`
            : `${analysisMode} AI-разбор добавлен в task #${digits(result.taskId, 14)}`
        });
        record.event('analysis_reused_transcript', {
          mode: analysisMode,
          taskId: digits(result.taskId, 14),
          whisperSkipped: true,
          aiCached: Boolean(result.ai?.cached),
          alreadyWritten: Boolean(result.alreadyWritten)
        });
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return null;
      const message = error instanceof Error ? error.message : String(error || 'unknown error');
      return updateCall(callKey, record => {
        record.processing.analysisMode = analysisMode;
        record.processing.reanalysisSource = 'saved-transcript';
        if (/^WAIT_TASK_ID:/i.test(message)) {
          const detail = message.replace(/^WAIT_TASK_ID:\s*/i, '');
          record.wait('userside', detail, nowIso(), true);
          record.setWriteback('waiting', { error: detail });
        } else if (/^USERSIDE_REVIEW:/i.test(message)) {
          const detail = message.replace(/^USERSIDE_REVIEW:\s*/i, '');
          record.wait('userside', detail, nowIso(), true);
          record.setWriteback('review', { error: detail });
        } else if (/^USERSIDE_WRITE:/i.test(message)) {
          record.fail('userside', message);
          record.setWriteback('error', { error: message });
        } else {
          record.fail('ai', message);
        }
      });
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MessageType.CALL_PROCESSING_REANALYZE) return false;
  if (!senderAllowed(sender)) {
    sendResponse({ success: false, error: 'CALL_REANALYZE: request rejected' });
    return false;
  }

  void reanalyze(message?.payload || {})
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: clean(error?.message || error || 'unknown error', 700) }));
  return true;
});

export const CallReanalysis = Object.freeze({ reanalyze });
