'use strict';

import * as impl from './semantic-tool-broker-impl.js';

const BILLING_SUMMARY_ENDPOINT = '/cgi-bin/adm/adm.pl?a=user&id=<billingId>';
const BILLING_SUMMARY_EVIDENCE = 'Единый DOM-блок главной Billing-карточки table.tbg1.nav3.width100; один fresh GET даёт тариф, цену, сумму к оплате, баланс после тарифа и трафик. Повторные billing.balance/billing.tariff в коротком окне используют тот же cached summary snapshot.';

function updatedBillingTool(tool) {
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
  version: 4,
  instruction: `${String(previousPlanner.instruction || '')} billing.balance и billing.tariff читают один и тот же основной Billing DOM-блок table.tbg1.nav3.width100; если нужны оба набора фактов, считай это одним общим main-summary источником, а не двумя независимыми системами. При жалобе «нет интернета» после Billing-идентификации и проверки базового состояния услуги network.session является ранним рекомендуемым инструментом: он делает fresh-read агрегированной сессионной страницы Billing stat.pl a=252 и помогает быстро установить наличие/статус сессии, IP/MAC, время старта, последнее событие, ROUTER/VENDOR и VLAN.`,
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
export const extractIdentityHints = impl.extractIdentityHints;
export const ensureNonEmptyReply = impl.ensureNonEmptyReply;
export const mapInformationNeedsToTools = impl.mapInformationNeedsToTools;
export const executeInformationNeeds = impl.executeInformationNeeds;
export const evidenceFallbackReply = impl.evidenceFallbackReply;
export const groundSubscriberReply = impl.groundSubscriberReply;
