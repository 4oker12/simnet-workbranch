'use strict';

const clean = (value, max = 240) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
const pbxRecordId = value => String(value || '').match(/^\d{9,12}\.\d{1,12}$/)?.[0] || '';
const nowIso = value => clean(value || new Date().toISOString(), 40);

const STEP_ORDER = Object.freeze(['pbx', 'audio', 'whisper', 'ai', 'userside']);
const TERMINAL_STATES = new Set(['done', 'cancelled']);
const ERROR_STATES = new Set(['failed', 'blocked', 'stale']);

function processingStep(status = 'pending', at = '', detail = '') {
  return { status, at: clean(at, 40), detail: clean(detail, 500) };
}

function defaultSteps() {
  return {
    pbx: processingStep(),
    audio: processingStep(),
    whisper: processingStep(),
    ai: processingStep(),
    userside: processingStep()
  };
}

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
    attentionDismissedAt: '',
    cancelledAt: '',
    lastSuccessfulStage: '',
    owner: '',
    steps: defaultSteps()
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

function normalizeSteps(raw = {}) {
  const out = defaultSteps();
  for (const key of STEP_ORDER) {
    if (raw?.[key] && typeof raw[key] === 'object') out[key] = { ...out[key], ...raw[key] };
  }
  return out;
}

export class CallRecord {
  constructor(raw = {}) {
    const processing = { ...defaultProcessing(), ...(raw.processing || {}) };
    processing.steps = normalizeSteps(raw.processing?.steps || {});
    this.data = {
      ...raw,
      schema: 'simnet-call-record-v2',
      processing,
      registration: { ...defaultRegistration(), ...(raw.registration || {}) },
      writeback: { ...defaultWriteback(), ...(raw.writeback || {}) },
      transcript: raw.transcript || null,
      ai: raw.ai || null,
      subscriber: raw.subscriber || null,
      timeline: Array.isArray(raw.timeline) ? raw.timeline.slice(-120) : []
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
    const changed = this.data.pbxRecordId !== id;
    this.data.pbxRecordId = id;
    this.data.legacyAliases = [...new Set([...(this.data.legacyAliases || []), `pbx:${id}`])];
    if (changed) this.event('pbx_attached', { pbxRecordId: id }, at);
    this.setStep('pbx', 'done', `PBX ${id}`, at);
    return this;
  }

  bindSubscriber(identity = {}, at = new Date().toISOString()) {
    const customerId = digits(identity.customerId, 14);
    const billingId = digits(identity.billingId, 14);
    const contract = clean(identity.contract, 48);
    const caseId = clean(identity.caseId, 120);
    const previous = JSON.stringify(this.data.subscriber || {});
    this.data.subscriber = {
      ...(this.data.subscriber || {}),
      ...(customerId ? { customerId } : {}),
      ...(billingId ? { billingId } : {}),
      ...(contract ? { contract } : {}),
      ...(caseId ? { caseId } : {})
    };
    if (customerId) this.data.customerId = customerId;
    if (previous !== JSON.stringify(this.data.subscriber || {})) {
      this.event('subscriber_bound', { customerId, billingId, contract, caseId }, at);
    }
    return this;
  }

  setRegistration(state, source = 'unknown', at = new Date().toISOString()) {
    const normalized = ['registered', 'unregistered', 'unknown', 'submitting', 'review_required'].includes(String(state))
      ? String(state)
      : 'unknown';
    const previous = String(this.data.registration?.state || 'unknown');
    this.data.registration = {
      state: normalized,
      source: clean(source || 'unknown', 40),
      registeredAt: normalized === 'registered'
        ? (this.data.registration?.registeredAt || nowIso(at))
        : String(this.data.registration?.registeredAt || '')
    };
    if (previous !== normalized) this.event('registration', { state: normalized, source }, at);
    return this;
  }

  setStep(stage, status = 'pending', detail = '', at = new Date().toISOString()) {
    const normalized = clean(stage, 32).toLowerCase();
    if (!STEP_ORDER.includes(normalized)) return this;
    this.data.processing.steps ||= defaultSteps();
    this.data.processing.steps[normalized] = processingStep(status, status === 'pending' ? '' : at, detail);
    return this;
  }

  startStage(stage, at = new Date().toISOString(), { owner = '' } = {}) {
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
    p.attentionDismissedAt = '';
    p.cancelledAt = '';
    p.owner = clean(owner || p.owner, 40);
    this.setStep(normalized, 'running', '', at);
    this.event('stage_started', { stage: normalized, attempts: p.attempts, owner: p.owner }, at);
    return this;
  }

  heartbeat(at = new Date().toISOString()) {
    this.data.processing.heartbeatAt = nowIso(at);
    this.data.processing.updatedAt = nowIso(at);
    return this;
  }

  completeStage(stage, detail = {}, at = new Date().toISOString()) {
    const normalized = clean(stage, 32).toLowerCase();
    if (!STEP_ORDER.includes(normalized)) return this;
    const p = this.data.processing;
    p.lastSuccessfulStage = normalized;
    p.stage = normalized;
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = '';
    p.attention = false;
    p.attentionDismissedAt = '';
    const detailText = typeof detail === 'string'
      ? detail
      : clean(detail?.detail || detail?.message || '', 500);
    this.setStep(normalized, 'done', detailText, at);
    if (normalized === 'userside') p.state = 'done';
    else p.state = 'waiting';
    this.event('stage_completed', { stage: normalized, ...(detail && typeof detail === 'object' ? detail : {}) }, at);
    return this;
  }

  wait(stage, detail = '', at = new Date().toISOString(), attention = false) {
    const normalized = clean(stage, 32).toLowerCase();
    const p = this.data.processing;
    p.state = 'waiting';
    p.stage = normalized;
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = clean(detail, 500);
    p.attention = Boolean(attention);
    if (attention) p.attentionDismissedAt = '';
    if (STEP_ORDER.includes(normalized)) this.setStep(normalized, 'waiting', p.error, at);
    this.event('stage_waiting', { stage: normalized, detail: p.error, attention: p.attention }, at);
    return this;
  }

  fail(stage, error, at = new Date().toISOString()) {
    const normalized = clean(stage, 32).toLowerCase();
    const p = this.data.processing;
    p.state = 'failed';
    p.stage = normalized;
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = clean(error?.message || error, 500);
    p.attention = true;
    p.attentionDismissedAt = '';
    if (STEP_ORDER.includes(normalized)) this.setStep(normalized, 'error', p.error, at);
    this.event('stage_failed', { stage: normalized, error: p.error }, at);
    return this;
  }

  cancel(at = new Date().toISOString()) {
    const p = this.data.processing;
    const stage = p.stage;
    p.state = 'cancelled';
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.cancelledAt = nowIso(at);
    p.error = '';
    p.attention = false;
    p.attentionDismissedAt = '';
    if (STEP_ORDER.includes(stage) && p.steps?.[stage]?.status === 'running') {
      this.setStep(stage, 'waiting', 'остановлено оператором', at);
    }
    this.event('cancelled', { stage }, at);
    return this;
  }

  finish(at = new Date().toISOString(), detail = '') {
    const p = this.data.processing;
    p.state = 'done';
    p.updatedAt = nowIso(at);
    p.heartbeatAt = nowIso(at);
    p.error = '';
    p.attention = false;
    p.attentionDismissedAt = '';
    this.event('processing_done', { stage: p.stage, detail: clean(detail, 300) }, at);
    return this;
  }

  markStale(detail = 'Фоновая операция не обновлялась', at = new Date().toISOString()) {
    const p = this.data.processing;
    p.state = 'stale';
    p.updatedAt = nowIso(at);
    p.error = clean(detail, 500);
    p.attention = true;
    p.attentionDismissedAt = '';
    if (STEP_ORDER.includes(p.stage) && p.steps?.[p.stage]?.status === 'running') {
      this.setStep(p.stage, 'error', p.error, at);
    }
    this.event('stale', { stage: p.stage, detail: p.error }, at);
    return this;
  }

  dismissAttention(at = new Date().toISOString()) {
    const p = this.data.processing;
    p.attention = false;
    p.attentionDismissedAt = nowIso(at);
    this.event('attention_dismissed', { stage: p.stage, state: p.state }, at);
    return this;
  }

  setTranscript(meta = {}, at = new Date().toISOString()) {
    this.data.transcript = {
      ...(this.data.transcript || {}),
      storageKey: clean(meta.storageKey || meta.callKey || this.callKey, 160),
      requestId: clean(meta.requestId, 120),
      language: clean(meta.language, 24),
      durationSeconds: Number(meta.durationSeconds || 0),
      processingSeconds: Number(meta.processingSeconds || 0),
      fileBytes: Number(meta.fileBytes || 0),
      audioSha256: clean(meta.audioSha256, 160),
      cached: Boolean(meta.cached),
      createdAt: clean(meta.createdAt || at, 40),
      updatedAt: nowIso(at)
    };
    return this;
  }

  setAi(analysis = null, meta = {}, at = new Date().toISOString()) {
    this.data.ai = analysis == null ? null : {
      analysis,
      model: clean(meta.model || analysis?.model, 120),
      usage: meta.usage && typeof meta.usage === 'object' ? { ...meta.usage } : (analysis?.usage || null),
      mode: clean(meta.mode || analysis?.mode, 80),
      updatedAt: nowIso(at)
    };
    return this;
  }

  setWriteback(state = 'idle', details = {}, at = new Date().toISOString()) {
    this.data.writeback = {
      ...(this.data.writeback || defaultWriteback()),
      state: clean(state, 40),
      taskId: digits(details.taskId || this.data.writeback?.taskId, 14),
      updatedAt: nowIso(at),
      error: clean(details.error, 500)
    };
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
    if (p.attentionDismissedAt && !p.attention) return false;
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
    this.data.timeline = [...(Array.isArray(this.data.timeline) ? this.data.timeline : []), row].slice(-120);
    return this;
  }

  toJSON() {
    return {
      ...this.data,
      processing: {
        ...this.data.processing,
        steps: Object.fromEntries(Object.entries(this.data.processing.steps || {}).map(([key, value]) => [key, { ...value }]))
      },
      registration: { ...this.data.registration },
      writeback: { ...this.data.writeback },
      transcript: this.data.transcript ? { ...this.data.transcript } : null,
      ai: this.data.ai ? { ...this.data.ai } : null,
      subscriber: this.data.subscriber ? { ...this.data.subscriber } : null,
      timeline: [...this.data.timeline]
    };
  }
}

export const CallProcessingStages = STEP_ORDER;
