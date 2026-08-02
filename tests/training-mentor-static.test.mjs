import assert from "node:assert/strict";
import fs from "node:fs/promises";

const mentorPath = new URL(
  "../extension/src/training-mentor.js",
  import.meta.url
);
const source = await fs.readFile(mentorPath, "utf8");
const workbenchPath = new URL(
  "../extension/src/workbench.js",
  import.meta.url
);
const workbenchSource = await fs.readFile(workbenchPath, "utf8");

assert.ok(source.includes('id="dp-mentor-focus"'));
assert.ok(source.includes('id="dp-mentor-refresh"'));
assert.ok(source.includes("Learning Mode · Наставник"));
assert.ok(!source.includes("dp-mentor-manual-hint"));
assert.ok(source.includes("function waitForPanel(attempt = 0)"));
assert.ok(source.includes("attempt >= 120"));
assert.ok(source.includes("search: location.search"));
assert.ok(source.includes("billingSection"));
assert.ok(source.includes("completedByContext"));
assert.ok(source.includes('PROGRESS_KEY = "dp_mentor_progress_v1"'));
assert.ok(source.includes("saveCompletedByContext()"));
assert.ok(source.includes("Шаг ${escapeHtml(meta.step)} / ${escapeHtml(meta.total)}"));
assert.ok(source.includes('class="dp-mentor-rule-instruction"'));
assert.ok(!source.includes("dp-mentor-step-intro"));
assert.ok(source.includes("location.href === runtime.pageUrl"));
assert.ok(source.includes('id="dp-mentor-inspections"'));
assert.ok(source.includes("function renderFieldInspections(context)"));
assert.ok(source.includes("function onuPollHeaderExpectations()"));
assert.ok(source.includes("expectedRouterMac"));
assert.ok(
  source.indexOf("await compat.ready") < source.indexOf("const onuAnalysis = globalThis.__SIMNET_ONU_ANALYSIS__"),
  "ONU analyzer must be resolved only after the shared compatibility bootstrap"
);
assert.ok(
  source.indexOf("await compat.ready") < source.indexOf("const tmcAnalysis = globalThis.__SIMNET_TMC_ANALYSIS__"),
  "TMC analyzer must be resolved only after the shared compatibility bootstrap"
);
assert.ok(source.includes("knowledge.evaluateBillingFields"));
assert.ok(source.includes("knowledge.classifyOnuOutputLine"));
assert.ok(source.includes("knowledge.analyzeOnuOutputLine"));
assert.ok(source.includes("highlightedElements"));
assert.ok(source.includes("MAC, VLAN и PON-порт"));
assert.ok(source.includes("Стабильность: Online Duration и история"));
assert.ok(source.includes("MAC ONU и абонента на EPON-порту"));
assert.ok(source.includes("Текущая регистрация и предыдущий обрыв"));
assert.ok(source.includes("onuAnalysis.analyzeOnuPollResult"));
assert.ok(source.includes("onuAnalysis.isolateOnuPollTranscript"));
assert.ok(source.includes("onuAnalysis.thresholds"));
assert.ok(source.includes("span[data-dp-mentor-inspection-line]"));
assert.ok(!source.includes("billing-session-authorization"));
assert.ok(!source.includes("authorizedIcon"));
assert.ok(source.includes("billing-check-userside-ethernet"));
assert.ok(source.includes("billing-check-pon-group-hint"));
assert.ok(source.includes("function billingGroupTechnologyHint()"));
assert.ok(source.includes("function technicalProfileFromHtml(html)"));
assert.ok(source.includes("function technicalFieldInspections(context)"));
assert.ok(source.includes("knowledge.evaluateBillingTechnicalFields"));
assert.ok(source.includes('inspectionGroupHtml("technology", "Тип подключения"'));
assert.ok(source.includes('inspectionGroupHtml("identifiers", "Идентификаторы оборудования"'));
assert.ok(source.includes('inspectionGroupHtml("binding", "Привязка оборудования"'));
assert.ok(source.includes('inspectionGroupHtml("next-step", "Следующий шаг"'));
assert.ok(source.includes("function ensureTechnicalProfile(context)"));
assert.ok(source.includes('JUNIPER_REVIEWS_KEY = "dp_mentor_juniper_reviews_v1"'));
assert.ok(source.includes("function subscriberIdentity()"));
assert.ok(source.includes('/\\/customer\\/(\\d+)/i'));
assert.ok(source.includes("subscriberIdentity()\n    ].join(\"|\")"));
assert.ok(source.includes("function accountStatusProfileFromHtml(html)"));
assert.ok(source.includes("function ensureJuniperAccountStatus(context)"));
assert.ok(source.includes("function juniperFieldInspections(context)"));
assert.ok(source.includes("billing-juniper-session-result"));
assert.ok(source.includes("billing-juniper-session-status-result"));
assert.ok(source.includes("billing-service-availability-summary"));
assert.ok(source.includes('inspectionGroupHtml("availability", "Интернет сейчас"'));
assert.ok(source.includes('serviceAvailability === "blocked"'));
assert.ok(source.includes("Есть активная Juniper-сессия"));
assert.ok(source.includes("Услуга заблокирована"));
assert.ok(source.includes('label: "Статус сессии"'));
assert.ok(source.includes("online\\s*\\/\\s*active"));
assert.ok(source.includes("inactiveStatus"));
assert.ok(source.includes("hasPreviousSessionTrace"));
assert.ok(source.includes('status = "history"'));
assert.ok(source.includes('account?.inactive ? "inactive" : "warning"'));
assert.ok(source.includes("Активной сессии нет · ранее была"));
assert.ok(source.includes("Сессия и следы отсутствуют · ожидаемо"));
assert.ok(source.includes("Сессия активна"));
assert.ok(source.includes("BRAS и источник сессии"));
assert.ok(source.includes("IP — выданный адрес сессии"));
assert.ok(source.includes("Время и последнее событие"));
assert.ok(source.includes("ROUTER и VENDOR"));
assert.ok(source.includes("След предыдущей сессии"));
assert.ok(source.includes("зелёный — активна сейчас · жёлтый — была ранее"));
assert.ok(source.includes("Проверено${checkedAt"));
assert.ok(source.includes("const tmcAnalysis = globalThis.__SIMNET_TMC_ANALYSIS__"));
assert.ok(source.includes("function usersideCustomerUrl()"));
assert.ok(source.includes("function ensureTmcProfile(context, profile"));
assert.ok(source.includes('"310": "BDCOM EPON (1G)"'));
assert.ok(source.includes('"311": "BDCOM GPON (2.5G)"'));
assert.ok(source.includes('"312": "GCOM (2.5G)"'));
assert.ok(source.includes('"313": "HUAWEI OLT"'));
assert.ok(source.includes("billing-check-onu-tmc"));
assert.ok(source.includes("Читаю ТМЦ UserSide"));
assert.ok(source.includes("наставник не будет выбирать раздел наугад"));
assert.ok(source.includes("GM_xmlhttpRequest"));
assert.ok(source.includes("Доступ и ограничения"));
assert.ok(source.includes("Состояние услуги"));
assert.ok(source.includes('inspectionGroupHtml("finance", "Финансы"'));
assert.ok(source.includes('inspection.id === "billing-field-balance-after-tariff"'));
assert.ok(source.includes('"billing-field-subscriber-group"'));
assert.ok(source.includes('"billing-field-internet-package"'));
assert.ok(source.includes("Техническая проверка"));
assert.ok(source.includes("billing-check-onu"));
assert.ok(source.includes("billing-check-juniper"));
assert.ok(source.includes("billing-onu-conclusion-summary"));
assert.ok(source.includes("Интерпретация опроса"));
assert.ok(source.includes("reviewedInspectionIds"));
assert.ok(source.includes('showButton.textContent = "Подсветить снова"'));
assert.ok(source.includes("async function expandCollapsedAncestors(anchor)"));
assert.ok(source.includes("show_x(${legacy[1]})"));
assert.ok(source.includes("await expandCollapsedAncestors(anchor)"));
assert.ok(source.includes("function anchorIsVisible(anchor)"));
assert.ok(source.includes('event.key === "Escape"'));
assert.ok(!source.includes("dp-mentor-target-marker"));
assert.ok(!source.includes("dp-mentor-spotlight"));
assert.ok(!source.includes("dp-mentor-spotlight-shade"));
assert.ok(source.includes("outline:3px solid #fdb022"));
assert.ok(source.includes('data-mentor-inspection-group="access"'));
assert.ok(source.includes('data-mentor-inspection-group="availability"'));
assert.ok(source.includes("expandedInspectionGroup"));
assert.ok(source.includes('context.billingSection === "technical" ? "technology" : "availability"'));
assert.ok(source.includes('<details class="dp-mentor-inspection-group"'));
assert.ok(source.includes(".dp-mentor-inspection-group > summary"));
assert.ok(source.includes("group.open = open"));
assert.ok(source.includes("item.open = false"));
assert.ok(source.includes('.dp-mentor-inspection.ok'));
assert.ok(source.includes('.dp-mentor-inspection.warning'));
assert.ok(source.includes('.dp-mentor-inspection.info'));
assert.ok(source.includes('.dp-mentor-inspection.history'));
assert.ok(source.includes('.dp-mentor-inspection.inactive'));
assert.ok(source.includes('--dp-mentor-surface:#ffffff'));
assert.ok(source.includes('class="dp-mentor-inspection-status-dot"'));
assert.ok(source.includes('class="dp-mentor-inspection-more"'));
assert.ok(source.includes('class="dp-operation-mode-switch"'));
assert.ok(source.includes('data-mentor-inspection-note'));
assert.ok(source.includes('class="dp-mentor-inspection-note'));
assert.ok(source.includes('Показать на странице'));
assert.ok(source.includes('Изучено: ${progress.done} / ${progress.total}'));
assert.ok(source.includes('data-mentor-warning-count'));
assert.ok(source.includes("function hasPonPriority(inspections)"));
assert.ok(source.includes('inspectionGroupHtml("technical", "1 · PON: опрос ONU и порта"'));
assert.ok(source.includes('inspectionGroupHtml("availability", "2 · Juniper и интернет сейчас"'));
assert.ok(
  source.indexOf('inspectionGroupHtml("technical", "1 · PON: опрос ONU и порта"')
    < source.indexOf('inspectionGroupHtml("availability", "2 · Juniper и интернет сейчас"'),
  "PON polling must be rendered before the Juniper check"
);
assert.ok(source.includes("PON-маршрут: 1) опроси ONU и PON-порт; 2) проверь Juniper-сессию и трафик"));
assert.ok(!source.includes('background:#111821'));
assert.ok(workbenchSource.includes("globalThis.__SIMNET_ONU_ANALYSIS__"));
assert.ok(workbenchSource.includes("analyzeOnuPollResult,"));
assert.ok(workbenchSource.includes("isolateOnuPollTranscript,"));
assert.ok(workbenchSource.includes("pollAdapterFromAction,"));
assert.ok(workbenchSource.includes("thresholds: ONU_ANALYSIS_THRESHOLDS"));
assert.ok(workbenchSource.includes("function analyzeUserSideTmcHtml(html)"));
assert.ok(workbenchSource.includes("globalThis.__SIMNET_TMC_ANALYSIS__"));
assert.ok(workbenchSource.includes("billingTechnologyActionFromEvidence,"));
assert.ok(workbenchSource.includes("huawei|smartax|\\bma\\d{3,5}\\b"));
assert.ok(workbenchSource.includes("const huaweiCause"));
assert.ok(workbenchSource.includes("display\\s+ont\\s+optical-info"));
assert.ok(workbenchSource.includes("function extractBdcomGponRegistration(raw)"));
assert.ok(workbenchSource.includes("function extractBdcomEponRegistration(raw)"));

assert.ok(!source.includes("MutationObserver"));
assert.ok(!source.includes('document.addEventListener("click"'));
assert.ok(!source.includes("dp-mentor-callout"));
assert.ok(!source.includes("dp_mentor_auto_hints_v1"));
assert.match(
  source,
  /#dp-panel\[data-operation-mode="mentor"\][\s\S]*#dp-billing-provider,[\s\S]*display:none/
);

assert.match(
  source,
  /#dp-panel\[data-operation-mode="mentor"\][\s\S]*#dp-form[\s\S]*display:none/
);

console.log("training-mentor static tests passed");
