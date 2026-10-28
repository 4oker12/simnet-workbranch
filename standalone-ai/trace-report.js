'use strict';

/**
 * Export a reproducible, observable decision trace. This is NOT a dump of the
 * model's private chain-of-thought. Only emitted semantic fields, tool calls,
 * read evidence, guards, outcomes and usage are recorded.
 */
export const TRACE_SCHEMA = 'simnet.ai-operator.observed-trace/v1';

const SECRET_KEYS = /^(?:api[_-]?key|groqApiKey|deepseekApiKey|authorization|cookie|set-cookie|token|secret|password|passwd|csrf|pp|uu|sessionId|jsessionid)$/i;
const PRIVATE_KEYS = /^(?:login|contract|contractNumber|billingId|customerId|fullName|email|phone|extraPhone|mac|serial|address|ip)$/i;

function redactString(value, includeSensitive = false) {
  let text = String(value);
  if (!includeSensitive) text = text
    .replace(/\b(abon)\d{3,12}\b/gi, '$1[скрыто]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP скрыт]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email скрыт]')
    .replace(/(?:\+?380|0)\d{9}\b/g, '[телефон скрыт]')
    .replace(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi, '[MAC скрыт]')
  return text
    .replace(/\b(?:Bearer\s+)[a-z0-9._~-]+/gi, 'Bearer [скрыто]')
    .replace(/((?:[?&]|\b)(?:pp|uu|token|key|session)=)[^\s&#]+/gi, '$1[скрыто]');
}

export function protectExport(value, { includeSensitive = false } = {}) {
  const seen = new WeakSet();
  function walk(item, key = '', depth = 0) {
    if (SECRET_KEYS.test(key)) return '[секрет скрыт]';
    if (!includeSensitive && PRIVATE_KEYS.test(key)) return '[персональные данные скрыты]';
    if (typeof item === 'string') return redactString(item, includeSensitive);
    if (item == null || typeof item !== 'object') return item;
    if (depth >= 20) return '[глубина ограничена]';
    if (seen.has(item)) return '[циклическая ссылка]';
    seen.add(item);
    if (Array.isArray(item)) {
      const output = item.map(value => walk(value, '', depth + 1));
      seen.delete(item);
      return output;
    }
    const output = {};
    for (const [field, entry] of Object.entries(item)) {
      // Raw authorization data is NEVER exported, even with includeSensitive.
      output[field] = walk(entry, field, depth + 1);
    }
    seen.delete(item);
    return output;
  }
  return walk(value);
}

function activeVariant(experiment = {}) {
  const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
  return variants.find(item => item.label === experiment.activeVariant) || variants[0] || {};
}

function traceTools(experiment = {}) {
  const variant = activeVariant(experiment);
  return (Array.isArray(variant?.toolTrace) ? variant.toolTrace : []).map((item, index) => ({
    number: index + 1,
    tool: item.tool || '',
    requestedBy: item.requestedBy || null,
    args: item.args || {},
    code: item.code || '',
    ok: item.ok === true,
    source: item.source || item.data?.source || 'unknown',
    observedAt: item.observedAt || null,
    data: item.data || {},
    warnings: item.warnings || [],
    requestedFacts: item.requestedFacts || [],
    cache: item.cache || ''
  }));
}

export function buildTurnTrace(lab = {}, record = null) {
  const experiment = record?.experiment || lab.lastExperiment || {};
  const decision = record?.decision || lab.lastDecision || {};
  const stateEvents = Array.isArray(record?.events) ? record.events : (lab.events || []);
  const turnId = experiment.customerMessageId || record?.customerMessageId || '';
  const messages = Array.isArray(lab.messages) ? lab.messages : [];
  const userMessage = record?.input || messages.find(item => item.id === turnId)?.text || '';
  const variant = activeVariant(experiment);
  const analysis = experiment.analysis || {};
  const tools = traceTools(experiment);
  const matchedEvents = stateEvents.filter(item => !turnId || item?.customerMessageId === turnId || item?.messageId === turnId);
  return {
    turnId,
    at: experiment.at || record?.at || null,
    input: userMessage,
    understanding: {
      intent: decision.intent || analysis.probe?.whatUserWants || '',
      confidence: decision.confidence ?? analysis.probe?.confidence ?? null,
      language: decision.language || analysis.probe?.language || '',
      probe: analysis.probe || {},
      semanticDiagnostics: analysis.semanticDiagnostics || {}
    },
    knowledge: analysis.knowledge || {},
    evidencePlan: {
      requiredFacts: analysis.probe?.requiredFacts || [],
      subscriberDataNeeded: variant.subscriberDataNeeded || [],
      verificationNeeded: variant.verificationNeeded || [],
      unresolvedRequests: variant.unresolvedRequests || []
    },
    reads: tools,
    evidence: {
      factEvidence: variant.factEvidence || [],
      toolEvidence: variant.toolEvidence || [],
      factDiagnostics: variant.factDiagnostics || {},
      basis: variant.basis || []
    },
    answerControl: {
      answerRelevance: variant.answerRelevance || null,
      relevanceGate: variant.relevanceGate || null,
      dialoguePolice: variant.dialoguePolice || null,
      evidenceGate: variant.evidenceGate || null,
      degraded: Boolean(variant.degraded),
      degradationReason: variant.degradationReason || ''
    },
    result: {
      reply: decision.reply || variant.reply || '',
      action: decision.action || '',
      model: experiment.model || decision.model || '',
      elapsedMs: experiment.elapsedMs ?? null,
      usage: experiment.usage || {},
      toolCalls: tools.length
    },
    events: matchedEvents
  };
}

export function buildDecisionExport(lab = {}, { mode = 'last', turnId = '', includeSensitive = false } = {}) {
  const records = Array.isArray(lab.turnRecords) ? lab.turnRecords : [];
  const stored = records.map(record => buildTurnTrace(lab, record));
  if (lab.lastExperiment && !stored.some(turn => turn.turnId === lab.lastExperiment.customerMessageId)) {
    stored.push(buildTurnTrace(lab));
  }
  const selected = turnId ? stored.find(turn => turn.turnId === turnId) : null;
  const turns = mode === 'session' ? stored : (selected ? [selected] : stored.slice(-1));
  const report = {
    schema: TRACE_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: mode === 'session' ? 'session' : 'last-turn',
    disclosure: 'Наблюдаемые решения, evidence и операции. Скрытые внутренние рассуждения LLM не доступны.',
    privacy: includeSensitive ? 'Возможны персональные данные. Секреты и авторизационные токены всегда скрываются.' : 'Поля идентификаторов и типовые совпадения обезличены. Свободный текст требует ручной проверки.',
    session: { id: lab.id || '', createdAt: lab.createdAt || '', updatedAt: lab.updatedAt || '', knowledgeMode: lab.knowledgeMode || '', displayMode: lab.displayMode || '', turnsRecorded: stored.length },
    transcript: mode === 'session' ? (lab.messages || []).map(item => ({ role: item.role, at: item.at, text: item.text })) : undefined,
    transcriptNote: mode === 'session' ? 'Текущий chat transcript может содержать только последние 60 сообщений; полные завершённые ходы сохранены в turns[] с вводом и ответом.' : undefined,
    turns,
    sourceStatus: 'Состояние вкладок на момент экспорта не доказывает выполнение live-запросов; см. reads[].code/source.',
    usage: lab.apiCost || {}
  };
  return protectExport(report, { includeSensitive });
}

export function decisionExportText(report) {
  const rows = [
    'SIMNET Autonomous AI Operator — наблюдаемый ход решения',
    'Формат: ' + report.schema,
    'Создан: ' + report.generatedAt,
    'Режим: ' + report.mode,
    report.disclosure,
    report.privacy,
    ''
  ];
  for (const [i, turn] of (report.turns || []).entries()) {
    rows.push('=== ХОД ' + (i + 1) + ' ===');
    rows.push('Ввод: ' + (turn.input || '—'));
    rows.push('1. СМЫСЛ: ' + (turn.understanding?.intent || 'не определён'));
    rows.push('   Уверенность: ' + String(turn.understanding?.confidence ?? '—'));
    rows.push('   Запрошенные факты: ' + JSON.stringify(turn.evidencePlan?.requiredFacts || []));
    rows.push('2. KNOWLEDGE: ' + JSON.stringify(turn.knowledge || {}));
    rows.push('3. READ: ' + (turn.reads?.length || 0) + ' вызов(ов)');
    for (const read of turn.reads || []) {
      rows.push('   #' + read.number + ' ' + read.tool + ' — ' + read.code + ' | ok=' + read.ok + ' | source=' + read.source);
      rows.push('      Причина: ' + JSON.stringify(read.requestedBy || {}));
      rows.push('      Аргументы: ' + JSON.stringify(read.args || {}));
      rows.push('      Данные: ' + JSON.stringify(read.data || {}));
      if (read.warnings?.length) rows.push('      Предупреждения: ' + read.warnings.join('; '));
    }
    rows.push('4. EVIDENCE: ' + JSON.stringify(turn.evidence || {}));
    rows.push('5. ПРОВЕРКА ОТВЕТА: ' + JSON.stringify(turn.answerControl || {}));
    rows.push('6. ОТВЕТ: ' + (turn.result?.reply || '—'));
    rows.push('   Модель: ' + (turn.result?.model || '—') + ' · время: ' + String(turn.result?.elapsedMs ?? '—') + ' мс');
    rows.push('');
  }
  return rows.join('\n') + '\n';
}
