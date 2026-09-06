'use strict';

const clean = (value, max = 240) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
const pbxRecordId = value => String(value || '').match(/^\d{9,12}\.\d{1,12}$/)?.[0] || '';
const nowIso = value => clean(value || new Date().toISOString(), 40);

const STEP_ORDER = Object.freeze(['pbx', 'audio', 'whisper', 'ai', 'userside']);
const TERMINAL_STATES = new Set(['done', 'cancelled']);
const ERROR_STATES = new Set(['failed', 'blocked', 'stale']);

function defaultProcessing() {
  return {
    state: 'idle',
    stage: '',
    attempts: 0,
    startedAt: '',
    updatedAt: '',
    heartbeatAt: '',
    error: '',
    attention: false,
    cancelledAt: '',
    lastSuccessfulStage: ''
  };
}

function defaultRegistration() {
  return {
    state: 'unknown',
    source: 'unknown',
    registeredAt: ''
  };
}

function defaultWriteback() {
  return {
    state: 'idle',
    taskId: '',
    updatedAt: '',
    error: ''
  };
}

export class CallRecord {
  constructor(raw = {}) {
    this.data = {
      ...raw,
      processing: { ...defaultProcessing(), ...(raw.processing || {}) },
      registration: { ...defaultRegistration(), ...(raw.registration || {}) },
      writeback: { ...defaultWriteback(), ...(raw.writeback || {}) },
      timeline: Array.isArray(raw.timeline) ? raw.timeline.slice(-80) : []
    };
  }

  static from(raw = {}) {
    return new CallRecord(raw);
  }

  get id() {
    return String(this.data.callKey || '');
  }

  get callKey() {
    return this.id;
  }

  get processing() {
    return this.data.processing;
  }

  attachPbx(recordId, at = new Date().toISOString()) {
    const id = pbxRecordId(recordId);
    if (!id) return this;
    this.data.pbxRecordId = id;
    this.data.legacyAliases = [...new Set([...(this.data.legacyAliases || []), `pbx:${id}`])];
    this.event('pbx_attached', { pbxRecordId: id }, at);
    return this;
  }

  bindSubscriber(identity = {}, at = new Date().toISOString()) {
    const customerId = digits(identity.customerId, 14);
    const billingId = digits(identity.billingId, 14);
    const contract = clean(identity.contract, 48);
    const caseId = clean(identity.caseId, 120);
    this.data.subscriber = {
      ...(this.data.subscriber || {}),
      ...(customerId ? { customerId } : {}),
      ...(billingId ? { billingId } : {}),
      ...(contract ? { contract } : {}),
      ...(caseId ? { caseId } : {})
    };
    if (customerId) this.data.customerId = customerId;
    this.event('subscriber_bound', { customerId, billingId, contract, caseId }, at);
    return this;
  }

  setRegistration(state, source = 'unknown', at = new Date().toISOString()) {
    const normalized = ['registered', 'unregistered', 'unknown', 'submitting', 'review_required'].includes(String(state))
      ? String(state)
      : 'unknown';
    this.data.registration = {
      state: normalized,
      source: clean(source || 'unknown', 40),
      registeredAt: normalized === 'registered'
        ? (this.data.registration?.registeredAt || nowIso(at))
        : String(this.data.registration?.registeredAt || '')
    };
    this.event('registration', { state: normalized, source }, at);
    return this;
  }

  startStage(stage, at = new Date().toISOString()) {
    const normalized = clean(stage, 32).toLowerCase();
    if (!STEP_ORDER.includes(normalized)) throw new Error(`Unknown call processing stage: ${normalized}`);
    const p = this.data.processing;
    p.state = 'running';
    p.stage = normalized;
    p.attempts = Number(p.attempts || 0) + 1;
    p.startedAt ||= nowIso(at);
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = '';
    p.attention = false;
    p.cancelledAt = '';
    this.event('stage_started', { stage: normalized, attempts: p.attempts }, at);
    return this;
  }

  heartbeat(at = new Date().toISOString()) {
    this.data.processing.heartbeatAt = nowIso(at);
    this.data.processing.updatedAt = nowIso(at);
    return this;
  }

  completeStage(stage, detail = {}, at = new Date().toISOString()) {
    const normalized = clean(stage, 32).toLowerCase();
    const p = this.data.processing;
    p.lastSuccessfulStage = normalized;
    p.stage = normalized;
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = '';
    p.attention = false;
    if (normalized === 'userside') p.state = 'done';
    else p.state = 'waiting';
    this.event('stage_completed', { stage: normalized, ...detail }, at);
    return this;
  }

  wait(stage, detail = '', at = new Date().toISOString(), attention = false) {
    const p = this.data.processing;
    p.state = 'waiting';
    p.stage = clean(stage, 32).toLowerCase();
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = clean(detail, 500);
    p.attention = Boolean(attention);
    this.event('stage_waiting', { stage: p.stage, detail: p.error, attention: p.attention }, at);
    return this;
  }

  fail(stage, error, at = new Date().toISOString()) {
    const p = this.data.processing;
    p.state = 'failed';
    p.stage = clean(stage, 32).toLowerCase();
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = clean(error?.message || error, 500);
    p.attention = true;
    this.event('stage_failed', { stage: p.stage, error: p.error }, at);
    return this;
  }

  cancel(at = new Date().toISOString()) {
    const p = this.data.processing;
    p.state = 'cancelled';
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.cancelledAt = nowIso(at);
    p.error = '';
    p.attention = false;
    this.event('cancelled', { stage: p.stage }, at);
    return this;
  }

  markStale(detail = 'Фоновая операция не обновлялась', at = new Date().toISOString()) {
    const p = this.data.processing;
    p.state = 'stale';
    p.updatedAt = nowIso(at);
    p.error = clean(detail, 500);
    p.attention = true;
    this.event('stale', { stage: p.stage, detail: p.error }, at);
    return this;
  }

  canRetry() {
    const p = this.data.processing || {};
    return ERROR_STATES.has(String(p.state || '')) || ['waiting', 'cancelled'].includes(String(p.state || ''));
  }

  canCancel() {
    const p = this.data.processing || {};
    return !TERMINAL_STATES.has(String(p.state || '')) && ['running', 'waiting', 'stale', 'failed'].includes(String(p.state || ''));
  }

  needsAttention() {
    const p = this.data.processing || {};
    return Boolean(p.attention || ERROR_STATES.has(String(p.state || '')));
  }

  nextStage() {
    const p = this.data.processing || {};
    if (!this.data.pbxRecordId) return 'pbx';
    const completed = String(p.lastSuccessfulStage || '');
    const index = STEP_ORDER.indexOf(completed);
    if (index < 0) return 'audio';
    return STEP_ORDER[index + 1] || '';
  }

  event(type, details = {}, at = new Date().toISOString()) {
    const row = {
      at: nowIso(at),
      type: clean(type, 48),
      details: details && typeof details === 'object' ? details : { value: clean(details, 240) }
    };
    this.data.timeline = [...(Array.isArray(this.data.timeline) ? this.data.timeline : []), row].slice(-80);
    return this;
  }

  toJSON() {
    return {
      ...this.data,
      processing: { ...this.data.processing },
      registration: { ...this.data.registration },
      writeback: { ...this.data.writeback },
      timeline: [...this.data.timeline]
    };
  }
}

export const CallProcessingStages = STEP_ORDER;
