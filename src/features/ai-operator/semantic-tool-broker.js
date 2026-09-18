'use strict';

import * as impl from './semantic-tool-broker-impl.js';
import { extractStandaloneSubscriberIdentity, identityToolArgs } from './subscriber-identity.js';
import { applyAnswerRelevanceGate } from './answer-relevance-gate.js';

const BILLING_SUMMARY_ENDPOINT = '/cgi-bin/adm/adm.pl?a=user&id=<billingId>';
const BILLING_SUMMARY_EVIDENCE = 'Единый DOM-блок главной Billing-карточки table.tbg1.nav3.width100; один fresh GET даёт тариф, цену, сумму к оплате, баланс после тарифа и трафик. Повторные billing.balance/billing.tariff в коротком окне используют тот же cached summary snapshot.';

function updatedBillingTool(tool) {
  if (tool.name === 'customer.lookup') {
    return Object.freeze({
      ...tool,
      establishes: `${String(tool.establishes || '')} Самостоятельная реплика с номером договора (например 33455), обычным login (например lacanister) или текстовым идентификатором, явно названным договором (например «Boxing договір»), считается идентификацией и сохраняет привязку для следующего вопроса. Новый явный идентификатор в последующей реплике означает попытку переключения active subscriber и требует нового Billing lookup до любых subscriber-specific READ-tools.`,
      recommendedWhen: [
        ...(Array.isArray(tool.recommendedWhen) ? tool.recommendedWhen : []),
        'Клиент может сначала отдельной репликой прислать договор/login, а следующим сообщением задать вопрос; после успешного Billing lookup последующий вопрос относится к уже подтверждённому кейсу.',
        'Если после уже подтверждённого кейса клиент явно сообщает другой договор/login/IP/адрес, сначала заново выполни customer.lookup и только после успеха переключай active subscriber.'
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

function compactPlannerTool(tool = {}) {
  return {
    name: String(tool.name || ''),
    system: String(tool.system || ''),
    establishes: String(tool.establishes || '').slice(0, 260),
    recommendedWhen: (Array.isArray(tool.recommendedWhen) ? tool.recommendedWhen : []).slice(0, 2).map(item => String(item).slice(0, 220))
  };
}

const previousPlanner = impl.AI_OPERATOR_SOFT_TOOL_CAPABILITIES.toolPlanner || {};
const TOOL_PLANNER = Object.freeze({
  ...previousPlanner,
  version: 10,
  semanticFrameRule: 'Первый semantic understanding текущего хода является authoritative semantic frame. Knowledge, Billing, UserSide, Network и PON могут только добавить/проверить факты для уже понятого запроса. Последующие стадии не должны заново переопределять, о чём спросил клиент, если новый пользовательский текст не создал реальную неоднозначность.',
  replyStyleRule: 'Отвечай как живой оператор человеку в чате: сначала прямой ответ на вопрос, обычно 1–3 коротких предложения. Источники, названия статей, внутренние стадии, формулировки «по внутренней/подтверждённой информации», пересказ справочника и канцелярит клиенту не показывай. Объяснение добавляй только если оно реально помогает ответу.',
  instruction: `${String(previousPlanner.instruction || '')} billing.balance и billing.tariff читают один и тот же основной Billing DOM-блок table.tbg1.nav3.width100; если нужны оба набора фактов, считай это одним общим main-summary источником, а не двумя независимыми системами. При жалобе «нет интернета» после Billing-идентификации и проверки базового состояния услуги network.session является ранним рекомендуемым инструментом: он делает fresh-read агрегированной сессионной страницы Billing stat.pl a=252 и помогает быстро установить наличие/статус сессии, IP/MAC, время старта, последнее событие, ROUTER/VENDOR и VLAN. Отдельная реплика, содержащая договор или login, включая явно подписанный текстовый идентификатор вроде «Boxing договір», является идентификацией: сначала привяжи кейс через Billing customer.lookup и сохраняй эту привязку для следующих реплик. Если в более поздней реплике клиент явно сообщает ДРУГОЙ договор/login/IP/адрес, это переключение абонента: старую active-привязку нельзя использовать для новых персональных данных; сначала заново выполни Billing customer.lookup, и только успешный lookup устанавливает новый active subscriber. Внутренняя энциклопедия и live-tools имеют разные роли: общие правила/условия из KB можно и нужно сообщать без идентификации; идентификация требуется только для персональных live-фактов. Перед фразой «не хватает данных», «не знаю» или повторным вопросом клиенту обязательно проверь, не отвечает ли уже использованная внутренняя статья на общую часть вопроса. Первый semantic understanding текущего хода — authoritative: KB/tools добавляют факты к этому смыслу, а не запускают повторное переосмысление вопроса. Финальный ответ — обычная человеческая реплика оператора, а не отчёт о том, что система проверила.`,
  tools: TOOL_CATALOG,
  toJSON() {
    return {
      version: this.version,
      identityPolicy: this.identityPolicy,
      semanticFrameRule: this.semanticFrameRule,
      replyStyleRule: this.replyStyleRule,
      successRule: this.successRule,
      planningRule: this.planningRule,
      tools: TOOL_CATALOG.map(compactPlannerTool)
    };
  }
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
function latestCustomerTurn(transcript = []) {
  const turns = (Array.isArray(transcript) ? transcript : []).filter(item => item?.role === 'customer' && String(item?.text || '').trim());
  return turns.length ? turns[turns.length - 1] : null;
}
function latestLiteralIdentity(transcript = []) {
  const latest = latestCustomerTurn(transcript);
  if (!latest) return {};
  const generic = identityToolArgs(extractStandaloneSubscriberIdentity([latest]));
  if (Object.keys(generic).length) return generic;
  const standard = impl.extractIdentityHints([latest], {});
  return standard && typeof standard === 'object' && !Array.isArray(standard) ? standard : {};
}
function normalizedContract(value) {
  const source = String(value == null ? '' : value).trim().replace(/\s+/g, '');
  const abon = source.match(/^abon(\d{3,12})$/i)?.[1] || '';
  return abon || (/^\d{3,12}$/.test(source) ? source : '');
}
function normalizedAddress(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[.,;:()№#]/g, ' ').replace(/\s+/g, ' ').trim();
}
function identityMatchesConfirmed(args = {}, state = {}) {
  const subscriber = state?.confirmedSubscriber && typeof state.confirmedSubscriber === 'object' && !Array.isArray(state.confirmedSubscriber) ? state.confirmedSubscriber : {};
  if (args.contract) {
    const currentContract = normalizedContract(subscriber.contract || subscriber.login);
    return Boolean(currentContract && currentContract === normalizedContract(args.contract));
  }
  if (args.login) {
    const requested = String(args.login || '').trim();
    const currentLogin = String(subscriber.login || '').trim();
    if (requested && currentLogin && requested.toLowerCase() === currentLogin.toLowerCase()) return true;
    const requestedContract = normalizedContract(requested);
    const currentContract = normalizedContract(subscriber.contract || currentLogin);
    return Boolean(requestedContract && currentContract && requestedContract === currentContract);
  }
  if (args.ip) {
    return Boolean(subscriber.ip && String(subscriber.ip).trim() === String(args.ip).trim());
  }
  if (args.address) {
    return Boolean(subscriber.address && normalizedAddress(subscriber.address) === normalizedAddress(args.address));
  }
  return false;
}
function resetSubscriberBinding(state = {}) {
  return {
    ...state,
    pendingCandidate: null,
    confirmedCaseId: '',
    confirmedSubscriber: null,
    invalidatedAt: Date.now(),
    facts: {},
    reads: {}
  };
}
function identityFromArgs(args = {}) {
  if (args.login) return { login: args.login };
  if (args.contract) return { contract: args.contract };
  if (args.ip) return { ip: args.ip };
  if (args.address) return { address: args.address };
  return {};
}
function traceFromResult(result = {}, identity = {}, isRebind = false) {
  return {
    tool: String(result?.tool || 'customer.lookup'),
    requestedBy: {
      system: 'identity',
      field: identity.contract ? 'contract' : identity.ip ? 'ip' : identity.address ? 'address' : 'login',
      why: isRebind
        ? 'Клиент явно передал новый идентификатор; старая active-привязка приостановлена, новый абонент должен быть заново подтверждён через Billing до персональных READ-tools.'
        : 'Клиент передал идентификатор; первичная привязка выполняется через Billing и сохраняется для следующих сообщений.'
    },
    args: identityToolArgs(identity).login || identityToolArgs(identity).contract ? identityToolArgs(identity) : identity,
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
  if (typeof execute !== 'function') return { trace: [], labState: state };

  const hasConfirmed = Boolean(String(state.confirmedCaseId || '').trim());
  const hasPending = Boolean(state.pendingCandidate);
  if (hasConfirmed || hasPending) {
    const latestArgs = latestLiteralIdentity(transcript);
    if (!Object.keys(latestArgs).length) return { trace: [], labState: state };
    if (hasConfirmed && identityMatchesConfirmed(latestArgs, state)) return { trace: [], labState: state };

    const lookupState = resetSubscriberBinding(state);
    const identity = identityFromArgs(latestArgs);
    let result;
    try {
      result = await execute({ tool: 'customer.lookup', toolArgs: latestArgs, labState: lookupState });
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
      trace: [traceFromResult(result, identity, true)],
      labState: mergeState(lookupState, result?.statePatch || {})
    };
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

function fallbackSemanticText(analysis = {}) {
  return [
    analysis?.probe?.whatUserWants,
    analysis?.probe?.latestMessageMeans,
    analysis?.probe?.underlyingGoal,
    ...(Array.isArray(analysis?.probe?.unresolvedRequests) ? analysis.probe.unresolvedRequests : []),
    ...(Array.isArray(analysis?.probe?.factsSaidByOperator) ? analysis.probe.factsSaidByOperator : [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function speedToMbps(value, unit) {
  const numeric = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  return /гбит|gbit|gbps/i.test(String(unit || '')) ? numeric * 1000 : numeric;
}

function formatSpeed(mbps) {
  if (!Number.isFinite(mbps)) return '';
  if (mbps >= 1000 && Number.isInteger(mbps / 1000)) return `${mbps / 1000} Гбит/с`;
  return `${Math.round(mbps)} Мбит/с`;
}

function knowledgeSpeedCeilingReply(analysis = {}, evidence = []) {
  const semantic = fallbackSemanticText(analysis);
  if (!/(?:скорост|швидк)/i.test(semantic) || !/(?:выше|больше|максим|выш[еє]|більш|бiльш|вищ)/i.test(semantic)) return '';

  const thresholdMatch = semantic.match(/(\d+(?:[.,]\d+)?)\s*(гбит(?:\/с)?|gbit(?:\/s)?|gbps|мбит(?:\/с)?|mbit(?:\/s)?|mbps)/i);
  const threshold = thresholdMatch ? speedToMbps(thresholdMatch[1], thresholdMatch[2]) : null;
  const values = [];
  const speedRe = /(\d+(?:[.,]\d+)?)\s*(гбит(?:\/с)?|gbit(?:\/s)?|gbps|мбит(?:\/с)?|mbit(?:\/s)?|mbps)/giu;
  for (const article of evidence) {
    const text = `${String(article?.title || '')}\n${String(article?.summary || '')}\n${String(article?.text || '')}`;
    for (const match of text.matchAll(speedRe)) {
      const mbps = speedToMbps(match[1], match[2]);
      if (Number.isFinite(mbps) && mbps > 0) values.push(mbps);
    }
  }
  if (!values.length) return '';
  const max = Math.max(...values);
  const uk = String(analysis?.probe?.language || '').toLowerCase() === 'uk';
  const maxText = formatSpeed(max);
  if (Number.isFinite(threshold) && max <= threshold) {
    return uk ? `Ні, зараз максимум — ${maxText}.` : `Нет, сейчас максимум — ${maxText}.`;
  }
  if (Number.isFinite(threshold) && max > threshold) {
    return uk ? `Так, є швидкість до ${maxText}.` : `Да, есть скорость до ${maxText}.`;
  }
  return uk ? `Зараз максимум — ${maxText}.` : `Сейчас максимум — ${maxText}.`;
}

export function knowledgeConsultationFallbackReply(analysis = {}, transcript = []) {
  const evidence = Array.isArray(analysis?.knowledge?.articleEvidence) ? analysis.knowledge.articleEvidence : [];
  if (!evidence.length) return '';

  const identityKnown = Object.keys(extractIdentityHints(transcript, analysis)).length > 0;
  const selected = evidence.filter(article => !(identityKnown && String(article?.id || '') === 'billing.identification')).slice(0, 4);
  if (!selected.length) return '';

  const speedAnswer = knowledgeSpeedCeilingReply(analysis, selected);
  if (speedAnswer) return speedAnswer;

  const relevant = (Array.isArray(analysis?.knowledge?.relevantInternalKnowledge) ? analysis.knowledge.relevantInternalKnowledge : [])
    .map(item => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 1);
  if (relevant.length) return relevant[0].slice(0, 600).trim();

  return '';
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

function mergeUsage(primary = {}, secondary = {}) {
  return {
    prompt_tokens: Number(primary?.prompt_tokens || 0) + Number(secondary?.prompt_tokens || 0),
    completion_tokens: Number(primary?.completion_tokens || 0) + Number(secondary?.completion_tokens || 0),
    total_tokens: Number(primary?.total_tokens || 0) + Number(secondary?.total_tokens || 0)
  };
}

function nonIdentityTrace(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : []).filter(item => !['customer.lookup', 'customer.confirm'].includes(String(item?.tool || '')));
}

function allRequestedLiveFactsConfirmed(toolTrace = []) {
  const requested = nonIdentityTrace(toolTrace);
  return requested.length > 0 && requested.every(item => item?.ok);
}

export async function groundSubscriberReply(options = {}) {
  const { transcript = [], analysis = {}, labState = {}, execute, draft = {} } = options;
  const pre = await bootstrapStandaloneIdentity({ transcript, analysis, labState, execute });
  const delegated = await impl.groundSubscriberReply({ ...options, labState: pre.labState });
  const toolTrace = mergeTrace(pre.trace, delegated?.toolTrace);
  const toolEvidence = mergeTrace(pre.trace.filter(item => item?.ok), delegated?.toolEvidence);
  const generationDegraded = Boolean(draft?.degraded || delegated?.degraded);
  const hasLiveToolActivity = toolTrace.length > 0;

  // KB reflection may help a purely knowledge-based degraded turn, but it must
  // never be auto-prepended once live READs are part of the turn. Tool evidence
  // and KB have different roles; internal reflection is not subscriber copy.
  const knowledgeReply = generationDegraded && !hasLiveToolActivity
    ? knowledgeConsultationFallbackReply(analysis, transcript)
    : '';
  const preliminaryReply = knowledgeReply || delegated?.reply;

  const relevance = await applyAnswerRelevanceGate({
    reply: preliminaryReply,
    analysis,
    toolTrace,
    latestCustomer: options.latestCustomer || {},
    transcript,
    useKnowledge: options.useKnowledge !== false,
    meterContext: options.meterContext || {}
  });

  const recoveredFromGenerationFailure = Boolean(
    generationDegraded
    && relevance?.gate?.reason === 'deterministic_confirmed_facts_recovery'
    && allRequestedLiveFactsConfirmed(toolTrace)
  );

  return {
    ...delegated,
    reply: relevance.reply || preliminaryReply,
    answerRelevance: relevance.answerRelevance || null,
    relevanceGate: relevance.gate || null,
    usage: mergeUsage(delegated?.usage || {}, relevance?.gate?.usage || {}),
    toolTrace,
    toolEvidence,
    degraded: recoveredFromGenerationFailure ? false : Boolean(delegated?.degraded || draft?.degraded),
    degradationReason: recoveredFromGenerationFailure ? '' : String(delegated?.degradationReason || draft?.degradationReason || ''),
    recoveredFromGenerationFailure,
    generationDegraded,
    generationDegradationReason: generationDegraded ? String(delegated?.degradationReason || draft?.degradationReason || '') : '',
    toolState: delegated?.toolState || pre.labState
  };
}