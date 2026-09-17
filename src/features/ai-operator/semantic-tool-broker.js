'use strict';

import * as impl from './semantic-tool-broker-impl.js';
import { extractStandaloneSubscriberIdentity, identityToolArgs } from './subscriber-identity.js';

const BILLING_SUMMARY_ENDPOINT = '/cgi-bin/adm/adm.pl?a=user&id=<billingId>';
const BILLING_SUMMARY_EVIDENCE = 'Единый DOM-блок главной Billing-карточки table.tbg1.nav3.width100; один fresh GET даёт тариф, цену, сумму к оплате, баланс после тарифа и трафик. Повторные billing.balance/billing.tariff в коротком окне используют тот же cached summary snapshot.';

function updatedBillingTool(tool) {
  if (tool.name === 'customer.lookup') {
    return Object.freeze({
      ...tool,
      establishes: `${String(tool.establishes || '')} Самостоятельная реплика с номером договора (например 33455), обычным login (например lacanister) или текстовым идентификатором, явно названным договором (например «Boxing договір»), считается идентификацией и сохраняет привязку для следующего вопроса.`,
      recommendedWhen: [
        ...(Array.isArray(tool.recommendedWhen) ? tool.recommendedWhen : []),
        'Клиент может сначала отдельной репликой прислать договор/login, а следующим сообщением задать вопрос; после успешного Billing lookup последующий вопрос относится к уже подтверждённому кейсу.'
      ]
    });
  }
  if (tool.name === 'billing.balance') {
    return Object.freeze({
      ...tool,
      mode: 'billing-main-summary-live-read-only + billing-snapshot-fallback',
      endpoint: BILLING_SUMMARY_ENDPOINT,
      evidenceSource: BILLING_SUMMARY_EVIDENCE,
      establishes: 'Устанавливает финансовые поля абонента из единого основного Billing-блока table.tbg1.nav3.width100: цену тарифа, текущую сумму к оплате, баланс после стоимости тарифа, доступные варианты баланса и сопутствующий трафик; accountBalance используется только если реально присутствует в подтверждённом Billing snapshot/строке.',
      recommendedWhen: [
        'Клиент спрашивает баланс, долг, оплату, состояние счёта или доступ после финансовой операции.',
        'Если вместе нужны баланс и тариф, этот tool и billing.tariff используют один общий Billing main-summary snapshot, а не независимые походы.'
      ],
      returns: [...new Set([...(tool.returns || []), 'trafficIncomingBytes', 'trafficOutgoingBytes', 'evidence.selector'])],
      limitations: [
        ...(tool.limitations || []),
        'Строка «На счете с учетом стоимости тарифного плана» — balanceAfterTariff, а не автоматически текущий accountBalance.'
      ]
    });
  }
  if (tool.name === 'billing.tariff') {
    return Object.freeze({
      ...tool,
      mode: 'billing-main-summary-live-read-only + billing-snapshot-fallback',
      endpoint: BILLING_SUMMARY_ENDPOINT,
      evidenceSource: BILLING_SUMMARY_EVIDENCE,
      establishes: 'Устанавливает отображаемый текущий интернет-тариф из единственного основного Billing-блока table.tbg1.nav3.width100 вместе с ценой, суммой к оплате, балансом после тарифа и трафиком; остальные статусные поля дополняются уже привязанным Billing snapshot.',
      recommendedWhen: [
        'Вопросы о текущем тарифе, скорости по тарифу, смене тарифа или состоянии услуги, связанном с тарифом.',
        'Если одновременно нужны тариф и финансы, используй общий main-summary snapshot: отдельный HTTP-запрос для каждого поля не нужен.'
      ],
      returns: [...new Set([...(tool.returns || []), 'tariffId', 'tariffDisplay', 'balanceAfterTariff', 'trafficIncomingBytes', 'trafficOutgoingBytes', 'evidence.selector'])]
    });
  }
  return tool;
}

const UPDATED_NETWORK_SESSION = Object.freeze({
  name: 'network.session',
  system: 'Network',
  capability: 'network',
  implementation: 'implemented',
  mode: 'billing-stat-live-read-only + workbench-fallback',
  endpoint: '/cgi-bin/adm/stat.pl?id=<billingId>&a=252',
  evidenceSource: 'Billing stat.pl a=252 HTML/DOM через текущую авторизованную Billing-сессию; pp/uu берутся из вкладки и не сохраняются.',
  establishes: 'Устанавливает свежую доступную сетевую сессию абонента по агрегированной странице Billing stat.pl a=252: IP/MAC, BRAS, источник и ID сессии, статус, сервисы, тип авторизации, время старта, последнее событие, ROUTER/VENDOR и VLAN. Если fresh-read недоступен, допускается только явно помеченный Workbench fallback.',
  answers: [
    'Есть ли у абонента доступная текущая/последняя сессия и каков её статус?',
    'Какой IP и MAC сейчас показывает сессионная статистика?',
    'Какой BRAS, источник сессии и тип авторизации указаны?',
    'Когда сессия стартовала и когда было последнее событие?',
    'Какой ROUTER/VENDOR/VLAN и какие сервисы/скорости показывает Billing?'
  ],
  recommendedWhen: [
    'При «нет интернета» сразу после идентификации абонента через Billing и базовой проверки состояния услуги.',
    'Нужно быстро понять, есть ли сессия/авторизация и отсеять часть причин до глубокой диагностики.',
    'Нужно проверить IP, MAC, время старта сессии, последнее событие, ROUTER/VENDOR, VLAN или сервисы.'
  ],
  returns: [
    'subscriberIp', 'subscriberMac', 'bras', 'brasIp', 'sessionSource', 'sessionId', 'status', 'isOnline', 'isActive',
    'services', 'username', 'authorizationType', 'startTime', 'bytes', 'speed', 'lastEventTime', 'lastEvent', 'router', 'vendor', 'vlan', 'observedAt/source'
  ],
  requires: [
    'Подтверждённый subscriber case с Billing ID.',
    'Для fresh-read нужна открытая авторизованная Billing-вкладка; endpoint вызывается в её браузерной сессии.'
  ],
  limitations: [
    'Это агрегированная операторская статистика Billing, а не низкоуровневый прямой доступ к конфигурации Juniper.',
    'Показывать и интерпретировать только реально возвращённые поля; отсутствие поля не является отрицательным фактом.',
    'Если fresh stat.pl read недоступен и используется Workbench fallback, это должно быть явно отмечено как fallback.'
  ]
});

const TOOL_CATALOG = Object.freeze(
  impl.AI_OPERATOR_SOFT_TOOL_CATALOG.map(tool => {
    if (tool.name === 'network.session') return UPDATED_NETWORK_SESSION;
    return updatedBillingTool(tool);
  })
);

const previousPlanner = impl.AI_OPERATOR_SOFT_TOOL_CAPABILITIES.toolPlanner || {};
const TOOL_PLANNER = Object.freeze({
  ...previousPlanner,
  version: 6,
  instruction: `${String(previousPlanner.instruction || '')} billing.balance и billing.tariff читают один и тот же основной Billing DOM-блок table.tbg1.nav3.width100; если нужны оба набора фактов, считай это одним общим main-summary источником, а не двумя независимыми системами. При жалобе «нет интернета» после Billing-идентификации и проверки базового состояния услуги network.session является ранним рекомендуемым инструментом: он делает fresh-read агрегированной сессионной страницы Billing stat.pl a=252 и помогает быстро установить наличие/статус сессии, IP/MAC, время старта, последнее событие, ROUTER/VENDOR и VLAN. Отдельная реплика, содержащая договор или login, включая явно подписанный текстовый идентификатор вроде «Boxing договір», является идентификацией: сначала привяжи кейс через Billing customer.lookup и сохраняй эту привязку для следующих реплик. Внутренняя энциклопедия и live-tools имеют разные роли: общие правила/условия из KB можно и нужно сообщать без идентификации; идентификация требуется только для персональных live-фактов. Перед фразой «не хватает данных», «не знаю» или повторным вопросом клиенту обязательно проверь, не отвечает ли уже использованная внутренняя статья на общую часть вопроса.`,
  tools: TOOL_CATALOG
});

export const AI_OPERATOR_SOFT_TOOL_CAPABILITIES = Object.freeze({
  ...impl.AI_OPERATOR_SOFT_TOOL_CAPABILITIES,
  network: true,
  toolPlanner: TOOL_PLANNER
});

export const AI_OPERATOR_TOOL_CAPABILITY_DETAILS = Object.freeze({
  ...impl.AI_OPERATOR_TOOL_CAPABILITY_DETAILS,
  billing: 'billing-main-summary-live-read-only + billing-live-read-only',
  network: 'billing-stat-live-read-only + workbench-fallback',
  toolManifestVersion: TOOL_PLANNER.version,
  toolCount: TOOL_CATALOG.length
});

export const AI_OPERATOR_SOFT_TOOL_CATALOG = TOOL_CATALOG;

function mergeState(state = {}, patch = {}) {
  return {
    ...(state && typeof state === 'object' && !Array.isArray(state) ? state : {}),
    ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {})
  };
}
function traceFromResult(result = {}, identity = {}) {
  return {
    tool: String(result?.tool || 'customer.lookup'),
    requestedBy: {
      system: 'identity',
      field: identity.contract ? 'contract' : 'login',
      why: 'Клиент передал идентификатор; первичная привязка выполняется через Billing и сохраняется для следующих сообщений.'
    },
    args: identityToolArgs(identity),
    ok: Boolean(result?.ok),
    code: String(result?.code || (result?.ok ? 'OK' : 'ERROR')),
    observedAt: String(result?.observedAt || ''),
    source: String(result?.data?.source || result?.tool || ''),
    data: result?.data || {},
    warnings: Array.isArray(result?.warnings) ? result.warnings : []
  };
}
async function bootstrapStandaloneIdentity({ transcript = [], analysis = {}, labState = {}, execute } = {}) {
  const state = mergeState({}, labState);
  if (typeof execute !== 'function' || String(state.confirmedCaseId || '').trim() || state.pendingCandidate) {
    return { trace: [], labState: state };
  }
  const standard = impl.extractIdentityHints(transcript, analysis);
  if (standard && Object.keys(standard).length) return { trace: [], labState: state };

  const identity = extractStandaloneSubscriberIdentity(transcript);
  const args = identityToolArgs(identity);
  if (!Object.keys(args).length) return { trace: [], labState: state };

  let result;
  try {
    result = await execute({ tool: 'customer.lookup', toolArgs: args, labState: state });
  } catch (error) {
    result = {
      ok: false,
      tool: 'customer.lookup',
      code: 'TOOL_EXECUTION_ERROR',
      observedAt: new Date().toISOString(),
      data: { message: String(error?.message || error) },
      warnings: [],
      statePatch: {}
    };
  }
  return {
    trace: [traceFromResult(result, identity)],
    labState: mergeState(state, result?.statePatch || {})
  };
}
function mergeTrace(first = [], second = []) {
  return [...(Array.isArray(first) ? first : []), ...(Array.isArray(second) ? second : [])];
}

function knowledgeParagraphs(textValue) {
  return String(textValue || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function knowledgeConsultationFallbackReply(analysis = {}, transcript = []) {
  const evidence = Array.isArray(analysis?.knowledge?.articleEvidence) ? analysis.knowledge.articleEvidence : [];
  if (!evidence.length) return '';

  const identityKnown = Object.keys(extractIdentityHints(transcript, analysis)).length > 0;
  const selected = evidence
    .filter(article => !(identityKnown && String(article?.id || '') === 'billing.identification'))
    .slice(0, 3);
  const parts = [];
  for (const article of selected) {
    for (const paragraph of knowledgeParagraphs(article?.text).slice(0, 2)) {
      const compact = paragraph.length > 430 ? `${paragraph.slice(0, 429)}…` : paragraph;
      if (compact && !parts.includes(compact)) parts.push(compact);
      if (parts.length >= 5) break;
    }
    if (parts.length >= 5) break;
  }
  if (!parts.length) return '';
  return `По внутренней информации SIMNET: ${parts.join(' ')}`.slice(0, 1800).trim();
}

export function extractIdentityHints(transcript = [], analysis = {}) {
  const standard = impl.extractIdentityHints(transcript, analysis);
  if (standard && Object.keys(standard).length) return standard;
  return identityToolArgs(extractStandaloneSubscriberIdentity(transcript));
}
export const ensureNonEmptyReply = impl.ensureNonEmptyReply;
export const mapInformationNeedsToTools = impl.mapInformationNeedsToTools;

export async function executeInformationNeeds(options = {}) {
  const { transcript = [], analysis = {}, labState = {}, execute } = options;
  const pre = await bootstrapStandaloneIdentity({ transcript, analysis, labState, execute });
  if (pre.trace.length && !String(pre.labState.confirmedCaseId || '').trim()) {
    return {
      planned: impl.mapInformationNeedsToTools(options.needs || []),
      trace: pre.trace,
      labState: pre.labState
    };
  }
  const delegated = await impl.executeInformationNeeds({ ...options, labState: pre.labState });
  return {
    ...delegated,
    trace: mergeTrace(pre.trace, delegated?.trace),
    labState: delegated?.labState || pre.labState
  };
}

export const evidenceFallbackReply = impl.evidenceFallbackReply;

export async function groundSubscriberReply(options = {}) {
  const { transcript = [], analysis = {}, labState = {}, execute, draft = {} } = options;
  const pre = await bootstrapStandaloneIdentity({ transcript, analysis, labState, execute });
  const delegated = await impl.groundSubscriberReply({ ...options, labState: pre.labState });
  const toolTrace = mergeTrace(pre.trace, delegated?.toolTrace);
  const toolEvidence = mergeTrace(pre.trace.filter(item => item?.ok), delegated?.toolEvidence);
  const degraded = Boolean(draft?.degraded || delegated?.degraded);
  const knowledgeReply = degraded ? knowledgeConsultationFallbackReply(analysis, transcript) : '';
  const reply = knowledgeReply
    ? (toolEvidence.length && String(delegated?.reply || '').trim()
      ? `${knowledgeReply}\n\n${String(delegated.reply).trim()}`
      : knowledgeReply)
    : delegated?.reply;
  return {
    ...delegated,
    reply,
    toolTrace,
    toolEvidence,
    toolState: delegated?.toolState || pre.labState
  };
}
