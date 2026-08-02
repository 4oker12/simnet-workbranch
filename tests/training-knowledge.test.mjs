import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const knowledgePath = new URL(
  "../extension/src/training-knowledge.js",
  import.meta.url
);
const source = await fs.readFile(knowledgePath, "utf8");
const context = vm.createContext({});
context.globalThis = context;
vm.runInContext(source, context, {
  filename: "training-knowledge.js"
});

const api = context.__SIMNET_TRAINING_KNOWLEDGE__;
assert.ok(api, "training knowledge API was not exposed");
assert.ok(api.rules.length >= 10, "the first mentor rule pack is unexpectedly small");
assert.equal(new Set(api.rules.map((rule) => rule.id)).size, api.rules.length);

const unknownCustomer = api.classifyContext({
  hostname: "userside.simnet.kiev.ua",
  pathname: "/customer/42",
  provider: "looknet",
  pageText: "Договор ФИО Адрес Биллинг Looknet"
});
assert.equal(unknownCustomer.system, "userside");
assert.equal(unknownCustomer.pageType, "userside-customer");
assert.equal(unknownCustomer.technology, "unknown");
assert.equal(unknownCustomer.provider, "looknet");

const unknownRules = api.rulesForContext(unknownCustomer);
assert.ok(unknownRules.some((rule) => rule.id === "identify-subscriber"));
assert.ok(unknownRules.some((rule) => rule.id === "confirm-billing-provider"));
assert.ok(!unknownRules.some((rule) => rule.id === "check-onu-state"));
assert.ok(!unknownRules.some((rule) => rule.id === "check-ethernet-port"));

const ponContext = api.classifyContext({
  hostname: "userside.simnet.kiev.ua",
  pathname: "/customer/42",
  pageText: "GPON OLT ONU Rx -24 dBm"
});
assert.equal(ponContext.technology, "pon");
const ponRules = api.rulesForContext(ponContext);
assert.ok(ponRules.some((rule) => rule.id === "check-onu-state"));
assert.ok(ponRules.some((rule) => rule.id === "check-optical-levels"));
assert.ok(ponRules.some((rule) => rule.id === "check-router-link-mac"));

const ethernetContext = api.classifyContext({
  hostname: "userside.simnet.kiev.ua",
  pathname: "/customer/42",
  pageText: "Ethernet коммутатор витая пара"
});
assert.equal(ethernetContext.technology, "ethernet");
assert.ok(
  api.rulesForContext(ethernetContext).some((rule) => rule.id === "check-ethernet-port")
);

const billingContext = api.classifyContext({
  hostname: "admin.looknet.kiev.ua",
  pathname: "/cgi-bin/adm/adm.pl",
  search: "?pp=session&a=user&id=4988",
  provider: "looknet",
  pageText: "Тарифи на Інтернет На счете с учетом стоимости BDCOM EPON GPON GCOM HUAWEI OLT"
});
assert.equal(billingContext.system, "billing");
assert.equal(billingContext.pageType, "billing");
assert.equal(billingContext.billingSection, "account");
assert.equal(
  billingContext.technology,
  "unknown",
  "PON navigation links must not turn every account card into a PON context"
);
const billingRules = api.rulesForContext(billingContext);
assert.equal(billingRules.length, 6);
assert.equal(billingRules[0].id, "billing-account-identity");
assert.ok(billingRules.some((rule) => rule.id === "billing-account-finance"));
assert.ok(billingRules.some((rule) => rule.id === "billing-account-services"));
assert.ok(billingRules.some((rule) => rule.id === "billing-account-navigation"));
assert.ok(!billingRules.some((rule) => rule.id.startsWith("billing-juniper-")));
assert.ok(!billingRules.some((rule) => rule.id.startsWith("billing-onu-")));

const juniperBillingContext = api.classifyContext({
  hostname: "admin.looknet.kiev.ua",
  pathname: "/cgi-bin/adm/stat.pl",
  search: "?uu=operator&id=4988&a=252",
  provider: "looknet",
  pageText: "BRAS SIM-Juniper RADIUS2 subscriber_session Статус сессии online IP MAC ROUTER VLAN Disconnect"
});
assert.equal(juniperBillingContext.billingSection, "juniper");
const juniperBillingRules = api.rulesForContext(juniperBillingContext);
assert.equal(juniperBillingRules.length, 5);
assert.equal(juniperBillingRules[0].id, "billing-juniper-session");
assert.ok(juniperBillingRules.some((rule) => rule.id === "billing-juniper-actions"));
assert.ok(!juniperBillingRules.some((rule) => rule.id.startsWith("billing-account-")));
assert.equal(
  juniperBillingRules.find((rule) => rule.id === "billing-juniper-actions").caution,
  true
);

for (const action of ["310", "311", "312", "313"]) {
  const onuBillingContext = api.classifyContext({
    hostname: "admin.looknet.kiev.ua",
    pathname: "/cgi-bin/adm/stat.pl",
    search: `?id=4988&a=${action}`,
    provider: "looknet",
    pageText: "ONU OLT Rx Tx dBm MAC Абоненты порта"
  });
  assert.equal(onuBillingContext.billingSection, "onu");
  assert.equal(onuBillingContext.technology, "pon");
  const onuBillingRules = api.rulesForContext(onuBillingContext);
  assert.equal(onuBillingRules.length, 6);
  assert.equal(onuBillingRules[0].id, "billing-onu-target");
  assert.ok(onuBillingRules.some((rule) => rule.id === "billing-onu-status"));
  assert.ok(onuBillingRules.some((rule) => rule.id === "billing-onu-signals"));
  assert.ok(!onuBillingRules.some((rule) => rule.id.startsWith("billing-juniper-")));
}

const paymentsBillingContext = api.classifyContext({
  hostname: "admin.looknet.kiev.ua",
  pathname: "/cgi-bin/adm/adm.pl",
  search: "?mid=4988&a=payshow"
});
assert.equal(paymentsBillingContext.billingSection, "payments");
assert.deepEqual(
  Array.from(api.rulesForContext(paymentsBillingContext), (rule) => rule.id),
  ["billing-payments-balance", "billing-payments-events"]
);

const trafficBillingContext = api.classifyContext({
  hostname: "admin.looknet.kiev.ua",
  pathname: "/cgi-bin/adm/stat.pl",
  search: "?id=4988&a=111"
});
assert.equal(trafficBillingContext.billingSection, "traffic");
assert.deepEqual(
  Array.from(api.rulesForContext(trafficBillingContext), (rule) => rule.id),
  ["billing-traffic-period", "billing-traffic-interpretation"]
);

const technicalBillingContext = api.classifyContext({
  hostname: "admin.simnet.kiev.ua",
  pathname: "/cgi-bin/adm/adm.pl",
  search: "?a=dopdata&id=24907"
});
assert.equal(technicalBillingContext.billingSection, "technical");
assert.deepEqual(
  Array.from(api.rulesForContext(technicalBillingContext), (rule) => rule.id),
  [
    "billing-technical-technology",
    "billing-technical-identifiers",
    "billing-technical-olt-binding",
    "billing-technical-route",
    "billing-technical-mac-safety"
  ]
);

const ethernetTechnicalFields = api.evaluateBillingTechnicalFields(technicalBillingContext, {
  "Мак-адрес абонента": "cc:ba:bd:e5:71:03",
  "EPON ONU Мак-адрес": "",
  "GPON ONT Серийный ID": "",
  "OLT": "... Выбор",
  "Технология подключения абонента": "Ethernet",
  "Установлена ONU c TV (кабельное ТВ)": "Нет"
});
assert.equal(ethernetTechnicalFields.length, 6);
assert.equal(
  ethernetTechnicalFields.find((item) => item.id === "billing-technical-technology-result").status,
  "ok"
);
assert.equal(
  ethernetTechnicalFields.find((item) => item.id === "billing-technical-onu-identity-result").status,
  "inactive"
);
assert.equal(
  ethernetTechnicalFields.find((item) => item.id === "billing-technical-olt-result").value,
  "Не требуется для этой технологии"
);
assert.equal(
  ethernetTechnicalFields.find((item) => item.id === "billing-technical-next-step-result").value,
  "UserSide · коммутатор и порт"
);

const ponTechnicalFields = api.evaluateBillingTechnicalFields(technicalBillingContext, {
  "Мак-адрес абонента": "2c:a0:42:e3:91:60",
  "GPON ONT Серийный ID": "FGXP:15A2D0EB",
  "OLT": "Example BDCOM GPON",
  "Технология подключения абонента": "PON"
});
assert.equal(
  ponTechnicalFields.find((item) => item.id === "billing-technical-onu-identity-result").status,
  "ok"
);
assert.equal(
  ponTechnicalFields.find((item) => item.id === "billing-technical-next-step-result").value,
  "Опрос ONU · BDCOM GPON (2.5G)"
);

const conflictingTechnicalFields = api.evaluateBillingTechnicalFields(technicalBillingContext, {
  "Мак-адрес абонента": "cc:ba:bd:e5:71:03",
  "EPON ONU Мак-адрес": "fc:fa:f7:96:6d:78",
  "Технология подключения абонента": "Ethernet"
});
assert.equal(
  conflictingTechnicalFields.find((item) => item.id === "billing-technical-technology-result").status,
  "warning"
);
assert.equal(
  conflictingTechnicalFields.find((item) => item.id === "billing-technical-onu-identity-result").status,
  "warning"
);

const healthyBillingFields = api.evaluateBillingFields(billingContext, {
  "Доступ": "Разрешен",
  "Авторизация": "Выключена",
  "Состояние": "Все ОК",
  "День начала потребления услуг": "0",
  "На счете с учетом стоимости тарифного плана, грн.": "0.00"
});
assert.equal(healthyBillingFields.find((item) => item.id === "billing-field-access").status, "ok");
assert.equal(healthyBillingFields.find((item) => item.id === "billing-field-state").status, "ok");
assert.equal(
  healthyBillingFields.find((item) => item.id === "billing-field-service-start-day").status,
  "ok"
);
assert.equal(
  healthyBillingFields.find((item) => item.id === "billing-field-balance-after-tariff").status,
  "ok"
);
assert.equal(
  healthyBillingFields.some((item) => item.id === "billing-field-authorization"),
  false
);

const blockedBillingFields = api.evaluateBillingFields(billingContext, {
  "Группа": "Удаленные",
  "Пакет": "Заблокирован",
  "Доступ": "Запрещен",
  "Состояние": "ПАУЗА",
  "День начала потребления услуг": "-1",
  "На счете с учетом стоимости тарифного плана, грн.": "-12.50"
});
assert.equal(blockedBillingFields.length, 6);
assert.ok(blockedBillingFields.every((item) => item.status === "warning"));
assert.equal(
  blockedBillingFields.find((item) => item.id === "billing-field-subscriber-group").value,
  "Удаленные"
);
assert.equal(
  blockedBillingFields.find((item) => item.id === "billing-field-internet-package").value,
  "Заблокирован"
);
assert.equal(
  blockedBillingFields.find((item) => item.id === "billing-field-balance-after-tariff").serviceAvailability,
  "blocked"
);
assert.equal(
  blockedBillingFields.find((item) => item.id === "billing-field-service-start-day").serviceAvailability,
  undefined
);

const positiveBalance = api.evaluateBillingFields(billingContext, {
  "На счете с учетом стоимости тарифного плана, грн.": "25,75"
});
assert.equal(positiveBalance[0].status, "ok");

assert.deepEqual(
  Array.from(api.classifyBillingOlt({
    technology: "PON",
    olt: "PB-Borschagivska-28A-EPON_2 (172.16.6.100) BDCOM",
    eponMac: "fc:fa:f7:96:6d:78"
  }).menuTexts),
  ["BDCOM EPON (1G)"]
);
assert.deepEqual(
  Array.from(api.classifyBillingOlt({
    technology: "PON",
    olt: "Example-GPON BDCOM",
    gponSerial: "FGXP:00A4E987"
  }).menuTexts),
  ["BDCOM GPON (2.5G)"]
);
assert.deepEqual(
  Array.from(api.classifyBillingOlt({ technology: "PON", olt: "GCOM GPON" }).menuTexts),
  ["GCOM (2.5G)"]
);
assert.deepEqual(
  Array.from(api.classifyBillingOlt({ technology: "PON", olt: "HUAWEI GPON" }).menuTexts),
  ["HUAWEI OLT"]
);
assert.equal(api.classifyBillingOlt({ technology: "Ethernet", olt: "switch" }).isPon, false);

const onuLineContext = api.classifyContext({
  hostname: "admin.simnet.kiev.ua",
  pathname: "/cgi-bin/adm/stat.pl",
  search: "?id=41019&a=311"
});
assert.equal(api.classifyOnuOutputLine(onuLineContext, "VLAN 261" ).kind, "vlan");
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Operational state enabled (1)").status,
  "ok"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Operational state disabled (0)").status,
  "warning"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Run state : online").status,
  "ok"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "ONU epon0/1/5:9 is - offline").status,
  "warning"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "EPON0/3:24 fcfa.f796.6d78 auto-configured").kind,
  "state"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "178 186d.c7cd.8425 DYNAMIC epon0/3:24").kind,
  "mac"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "MAC : 505B-1D60-1738").kind,
  "mac"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Hardware state is Link-Up").status,
  "ok"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Hardware state is Link-Down").status,
  "warning"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Speed is 100Mbps Full-Duplex").kind,
  "ethernet-port"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "uni-port 1 up").kind,
  "ethernet-port"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "10/100/1000 BASE-T(1Gbps Full-Duplex)").kind,
  "ethernet-port"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "1000 full up").kind,
  "ethernet-port"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "RX power(dBm) -15.8 TX power(dBm) 2.3").kind,
  "optics"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "received power(dBm): -27.0").kind,
  "optics"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "01 2026-07-01 dying gasp").kind,
  "events"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "DownCause : ONT LOSi alarm").kind,
  "events"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "LastRegTime LastDeregTime LastDeregReason Alivetime").kind,
  "registration"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Online/Offline time : 3 day 4 hour").kind,
  "duration"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "IntfName SN Active Time Active Duration Distance(m)").kind,
  "registration"
);
assert.equal(
  api.classifyOnuOutputLine(
    onuLineContext,
    "GPON0/16:16 FGXP:15A2D0EB N/A 2026-08-02 18:28:48 0000d:00:03:17 2016.1"
  ).kind,
  "registration"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "display service-port port 0/1/0 ont 0").kind,
  "service-path"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "Неверно указан MAC ONU для абонента.").kind,
  "identity-conflict"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "show epon active-onu interface EPON0/1:1").kind,
  "registration"
);
assert.equal(
  api.classifyOnuOutputLine(
    onuLineContext,
    "IntfName MAC Address Status OAM Status Distance(m) RTT(TQ) LastRegTime LastDeregTime LastDeregReason Alivetime"
  ).kind,
  "registration"
);
assert.equal(
  api.classifyOnuOutputLine(
    onuLineContext,
    "EPON0/1:1 1cef.03aa.719c auto-configured ctc-oam-oper 197 122 2026-07-14 11:02:58 2026-07-14 11:02:30 wire-down 19.07:36:58"
  ).kind,
  "registration"
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "epon0/1:1 -20.9").kind,
  "optics"
);
assert.deepEqual(
  Array.from(api.analyzeOnuOutputLine(
    onuLineContext,
    "show gpon interface GPON0/16:16 onu port 1 state"
  )).map((item) => item.kind).sort(),
  ["ethernet-port", "state"]
);
assert.equal(
  api.classifyOnuOutputLine(onuLineContext, "2026-08-02 15:41 power-off 0 00:17:27").kind,
  "events"
);
assert.deepEqual(
  Array.from(api.analyzeOnuOutputLine(
    onuLineContext,
    "EPON0/3:24 fcfa.f796.6d78 auto-configured 2026-08-02 power-off 0 . 00:17:27"
  )).map((item) => item.kind).sort(),
  ["duration", "events", "mac", "registration"]
);
assert.equal(api.classifyOnuOutputLine(billingContext, "VLAN 261"), null);

const completed = new Set(billingRules.slice(0, 2).map((rule) => rule.id));
const progress = api.progressFor(billingRules, completed);
assert.equal(progress.done, 2);
assert.equal(progress.total, billingRules.length);
assert.ok(progress.percent > 0 && progress.percent < 100);
assert.ok(progress.next && !completed.has(progress.next.id));

console.log("training-knowledge tests passed");
