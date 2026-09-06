'use strict';

import { WORKBENCH_STATE_KEY } from '../storage/call-state-store.js';
import { runtimeError, runtimeInfo, runtimeWarn } from '../../../infrastructure/runtime-log.js';

const STAGES = Object.freeze(['pbx', 'audio', 'whisper', 'ai', 'userside']);

function callsOf(state = {}) {
  const calls = state?.callModule?.calls?.calls;
  return calls && typeof calls === 'object' ? calls : {};
}

function processing(call = {}) {
  return call?.processing && typeof call.processing === 'object' ? call.processing : {};
}

function stageScope(stage = '') {
  if (stage === 'pbx' || stage === 'audio') return 'CALL PBX';
  if (stage === 'whisper') return 'CALL ASR';
  if (stage === 'ai') return 'CALL AI';
  if (stage === 'userside') return 'CALL SAVE';
  return 'CALL PIPELINE';
}

function stageName(stage = '') {
  return ({
    pbx: 'PBX lookup',
    audio: 'PBX audio',
    whisper: 'ASR / Whisper',
    ai: 'AI postprocess',
    userside: 'UserSide save'
  })[stage] || stage || 'pipeline';
}

function details(call = {}, extra = {}) {
  const p = processing(call);
  return {
    callKey: String(call.callKey || ''),
    usersideCallId: String(call.usersideCallId || ''),
    pbxRecordId: String(call.pbxRecordId || ''),
    state: String(p.state || ''),
    stage: String(p.stage || ''),
    attempts: Number(p.attempts || 0),
    ...extra
  };
}

function stepStatus(call = {}, stage = '') {
  return String(processing(call)?.steps?.[stage]?.status || '');
}

function traceCall(previous = {}, current = {}) {
  if (!current?.callKey) return;
  const prevP = processing(previous);
  const nextP = processing(current);
  const prevRegistration = String(previous?.registration?.state || '');
  const nextRegistration = String(current?.registration?.state || '');

  if (nextRegistration === 'registered' && prevRegistration !== 'registered') {
    runtimeInfo('CALL QUEUE', 'Звонок закреплён и принят в обработку', details(current));
  }

  for (const stage of STAGES) {
    const before = stepStatus(previous, stage);
    const after = stepStatus(current, stage);
    if (after === before) continue;
    if (after === 'running') {
      runtimeInfo(stageScope(stage), `${stageName(stage)} · START`, details(current));
    } else if (after === 'done') {
      runtimeInfo(stageScope(stage), `${stageName(stage)} · OK`, details(current, {
        detail: String(nextP?.steps?.[stage]?.detail || '')
      }));
    } else if (after === 'error') {
      runtimeError(stageScope(stage), `${stageName(stage)} · ERROR`, details(current, {
        error: String(nextP.error || nextP?.steps?.[stage]?.detail || '')
      }));
    }
  }

  const stateChanged = String(prevP.state || '') !== String(nextP.state || '');
  const stageChanged = String(prevP.stage || '') !== String(nextP.stage || '');
  const errorChanged = String(prevP.error || '') !== String(nextP.error || '');
  const attentionChanged = Boolean(prevP.attention) !== Boolean(nextP.attention);
  const scope = stageScope(String(nextP.stage || ''));

  if (nextP.state === 'failed' && (stateChanged || errorChanged || stageChanged)) {
    runtimeError(scope, 'Цепочка обработки остановлена', details(current, {
      error: String(nextP.error || 'unknown processing error')
    }));
  } else if (nextP.state === 'stale' && (stateChanged || errorChanged)) {
    runtimeError(scope, 'Цепочка обработки зависла / STALE', details(current, {
      error: String(nextP.error || '')
    }));
  } else if (nextP.state === 'waiting' && nextP.attention && (stateChanged || errorChanged || attentionChanged || stageChanged)) {
    runtimeWarn(scope, 'Обработка ждёт вмешательства', details(current, {
      error: String(nextP.error || '')
    }));
  }

  if (nextP.state === 'done' && prevP.state !== 'done') {
    runtimeInfo('CALL PIPELINE', 'Звонок полностью обработан', details(current));
  }
  if (nextP.state === 'cancelled' && prevP.state !== 'cancelled') {
    runtimeWarn('CALL PIPELINE', 'Обработка звонка отменена', details(current));
  }
}

function traceState(previousState = {}, currentState = {}) {
  const before = callsOf(previousState);
  const after = callsOf(currentState);
  for (const [callKey, current] of Object.entries(after)) {
    traceCall(before[callKey] || {}, current || {});
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[WORKBENCH_STATE_KEY]?.newValue) return;
  try {
    traceState(changes[WORKBENCH_STATE_KEY].oldValue || {}, changes[WORKBENCH_STATE_KEY].newValue || {});
  } catch (error) {
    runtimeError('CALL DIAG', 'Не удалось разобрать изменение состояния CALL', error);
  }
});

runtimeInfo('CALL DIAG', 'CALL pipeline diagnostics attached');

export const CallProcessingDiagnostics = Object.freeze({ traceState });
