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
  provider: "looknet",
  pageText: "Статус Баланс Тариф Технические данные"
});
assert.equal(billingContext.system, "billing");
assert.equal(billingContext.pageType, "billing");
const billingRules = api.rulesForContext(billingContext);
assert.ok(billingRules.some((rule) => rule.id === "billing-account-state"));
assert.ok(billingRules.some((rule) => rule.id === "billing-sync-coa-safety"));
assert.ok(billingRules.some((rule) => rule.id === "billing-juniper-check"));
assert.ok(!billingRules.some((rule) => rule.id === "billing-pon-port-poll"));

const ponBillingContext = api.classifyContext({
  hostname: "admin.looknet.kiev.ua",
  pathname: "/cgi-bin/adm/adm.pl",
  provider: "looknet",
  pageText: "EPON OLT ONU PON port"
});
const ponBillingRules = api.rulesForContext(ponBillingContext);
assert.equal(ponBillingRules[0].id, "billing-pon-port-poll");
assert.equal(ponBillingRules[1].id, "billing-juniper-check");
assert.equal(ponBillingRules[0].caution, true);

const completed = new Set(billingRules.slice(0, 2).map((rule) => rule.id));
const progress = api.progressFor(billingRules, completed);
assert.equal(progress.done, 2);
assert.equal(progress.total, billingRules.length);
assert.ok(progress.percent > 0 && progress.percent < 100);
assert.ok(progress.next && !completed.has(progress.next.id));

console.log("training-knowledge tests passed");
