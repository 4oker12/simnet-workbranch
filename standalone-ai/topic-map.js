'use strict';

import { buildTurnTrace } from './trace-report.js';

// UI projection only. No additional LLM, policy engine, subscriber resolver,
// source of truth or independent state is created here.
const TOPICS = Object.freeze([
  { id: 'balance', label: 'Баланс', area: 'Финансы', icon: '₴', match: /(?:баланс|ден[еє]г|денеж|счет[еуё]?|рахун[оа]к|залишк|долг|борг|оплат|списан|пополн|плат[еі]|temporary.payment|finance|billing\.balance|billing\.payments)|accountbalance|subscriber\.finance/i, tools: ['billing.balance', 'billing.payments', 'billing.main_summary', 'customer.snapshot', 'billing.next_charge'] },
  { id: 'tariff', label: 'Тариф', area: 'Условия услуги', icon: '⇄', match: /тариф|варт[іо]ст|стоимост|цена|ціна|скорост|швидк[іо]ст|гиг[аі]бит|мбит|мбіт|tariff|billing\.tariff|subscriber\.tariff/i, tools: ['billing.tariff', 'billing.main_summary', 'customer.snapshot'] },
  { id: 'promotions', label: 'Акции', area: 'Предложения', icon: '◇', match: /акци|акці|зниж|скидк|промо|бонус|подар|спецпредлож|пропозиц|promotion|offer|promo|discount/i, tools: [] },
  { id: 'connection', label: 'Диагностика', area: 'Соединение', icon: '⌁', match: /(?:не работает|не працює).*интернет|интернет.*(?:не работает|пропада|отвали|нестабил)|не працює.*інтернет|відсутн.*інтернет|обрыв|обрив|связ|зв.?яз|сет[ьи]|мереж|роутер|маршрутизатор|вай.?фай|wi.?fi|wifi|pon|onu|olt|ethernet|br[a]?s|сесси|сесі|порт|сигнал|network\.|userside\.|subscriber\.access/i, tools: ['network.session', 'network.last_session', 'userside.snapshot', 'pon.onu', 'pon.signal'] },
  { id: 'identity', label: 'Абонент', area: 'Идентификация', icon: '#', match: /\babon\d{3,12}\b|договор|договір|логин|логін|адрес|адреса|subscriber\.login|customer\.lookup|subscriber\.contract/i, tools: ['customer.lookup', 'customer.confirm'] },
  { id: 'other', label: 'Другое', area: 'Не распределено', icon: '⋯', match: null, tools: [] }
]);

const isPositiveRead = read => read?.ok === true;
const hasFailure = read => read?.ok === false;
const stringList = value => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : JSON.stringify(v)) : [];

function identifyTopics(turn) {
  const p = turn.understanding?.probe || {};
  const semantic = [
    turn.understanding?.intent, p.whatUserWants, p.latestMessageMeans,
    p.underlyingGoal, ...(Array.isArray(p.unresolvedRequests) ? p.unresolvedRequests : []),
    ...stringList(turn.evidencePlan?.requiredFacts),
    ...stringList(turn.evidencePlan?.subscriberDataNeeded)
  ].filter(Boolean).join(' ');
  // User input is a *presentation fallback*, not authoritative evidence.
  const raw = String(turn.input || '');
  let matched = TOPICS.slice(0, -1).filter(topic => topic.match.test(semantic) || topic.match.test(raw));
  // Identity is a context dependency, not a competing top-level topic when the
  // same message actually asks about a service.
  if (matched.some(t => t.id !== 'identity')) matched = matched.filter(t => t.id !== 'identity');
  if (!matched.length) matched = [TOPICS.at(-1)];
  return matched;
}

function relevantReads(turn, topic) {
  const reads = Array.isArray(turn.reads) ? turn.reads : [];
  // customer.lookup is a shared prerequisite of subscriber-scoped requests.
  return reads.filter(read => topic.tools.includes(String(read.tool || '')) ||
    (topic.id !== 'other' && read.tool === 'customer.lookup' && topic.id !== 'identity'));
}

function turnSteps(turn, topic) {
  const reads = relevantReads(turn, topic);
  const topicReads = reads.filter(read => topic.tools.includes(String(read.tool || '')));
  const requirement = stringList(turn.evidencePlan?.requiredFacts)
    .concat(stringList(turn.evidencePlan?.subscriberDataNeeded));
  const decision = turn.result || {};
  const steps = [
    {
      kind: 'semantic', label: 'Понимание',
      summary: turn.understanding?.intent || 'Не указана интерпретация модели',
      detail: { input: turn.input, confidence: turn.understanding?.confidence, requestedTopic: topic.id, semanticProbe: turn.understanding?.probe || {} },
      status: 'observed'
    },
    {
      kind: 'identity', label: 'Нужные факты',
      summary: requirement.length ? requirement.slice(0, 3).join(' · ') : 'Факты явно не перечислены',
      detail: { requiredFacts: turn.evidencePlan?.requiredFacts || [], subscriberDataNeeded: turn.evidencePlan?.subscriberDataNeeded || [], verificationNeeded: turn.evidencePlan?.verificationNeeded || [] },
      status: 'planned'
    }
  ];
  if (!reads.length) {
    steps.push({ kind: 'read', label: 'READ / инструменты', summary: 'Для этого блока нет зарегистрированных вызовов', detail: { recordedToolCount: turn.reads?.length || 0 }, status: 'unknown' });
  } else {
    reads.forEach(read => steps.push({
      kind: 'read',
      label: read.tool || 'Инструмент',
      summary: (read.ok ? 'Успешно' : 'Неуспешно') + ' · ' + (read.code || 'UNKNOWN') + ' · ' + (read.source || 'unknown'),
      detail: { requestedBy: read.requestedBy, args: read.args, code: read.code, source: read.source, observedAt: read.observedAt, data: read.data, warnings: read.warnings },
      status: read.ok ? 'success' : 'failure'
    }));
  }
  steps.push({
    kind: 'evidence', label: 'Проверка доказательств',
    summary: reads.some(hasFailure) ? 'Есть неуспешные READ: данные требуют проверки'
      : topicReads.some(isPositiveRead) ? 'Есть успешный тематический READ; см. факты и ограничения'
        : reads.some(isPositiveRead) ? 'Идентификатор проверен; факты этой темы пока не подтверждены'
          : 'Подтверждённых READ для этой темы нет',
    detail: { evidence: turn.evidence, answerControl: turn.answerControl },
    status: reads.some(hasFailure) ? 'failure' : topicReads.some(isPositiveRead) ? 'success' : 'unknown'
  });
  steps.push({
    kind: 'decision', label: 'Ответ',
    summary: decision.reply || 'Нет сохранённого ответа',
    detail: { reply: decision.reply, model: decision.model, elapsedMs: decision.elapsedMs, action: decision.action, evidenceGate: turn.answerControl?.evidenceGate },
    status: 'observed'
  });
  return steps;
}

/**
 * Reconstruct across turns from saved Lab traces. One turn may link to several
 * topics, while a later follow-up extends an existing topic. Older pre-record
 * sessions still show the last turn without fabricating historical events.
 */
export function buildTopicMap(lab = {}) {
  const records = Array.isArray(lab.turnRecords) ? lab.turnRecords : [];
  const hasLatest = Boolean(lab.lastExperiment);
  const turns = records.length
    ? records.map(record => buildTurnTrace(lab, record))
    : (hasLatest ? [buildTurnTrace(lab)] : []);
  // If old records were imported while current last experiment is newer,
  // include the current experiment only when it is not yet recorded.
  if (hasLatest && records.length && !turns.some(turn => turn.turnId === lab.lastExperiment.customerMessageId)) {
    turns.push(buildTurnTrace(lab));
  }
  const groups = new Map();
  for (const [index, turn] of turns.entries()) {
    for (const topic of identifyTopics(turn)) {
      const group = groups.get(topic.id) || { id: topic.id, label: topic.label, area: topic.area, icon: topic.icon, episodes: [], reads: 0, failedReads: 0, successfulReads: 0 };
      const related = relevantReads(turn, topic);
      group.episodes.push({
        id: turn.turnId || 'turn-' + index,
        number: index + 1, at: turn.at, input: turn.input,
        steps: turnSteps(turn, topic),
        reply: turn.result?.reply || ''
      });
      group.reads += related.length;
      group.failedReads += related.filter(hasFailure).length;
      // A successful customer.lookup proves an identifier match, not a promotion
      // or financial fact. Do not call a topic checked solely from its shared precondition.
      group.successfulReads += related.filter(read => isPositiveRead(read) && topic.tools.includes(String(read.tool || ''))).length;
      groups.set(topic.id, group);
    }
  }
  return TOPICS.filter(topic => groups.has(topic.id)).map(topic => {
    const group = groups.get(topic.id);
    group.status = group.failedReads ? 'error'
      : group.successfulReads ? 'read-ok' : 'unverified';
    return group;
  });
}
