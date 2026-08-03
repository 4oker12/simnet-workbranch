"use strict";

(() => {
  const base = globalThis.__SIMNET_OPERATOR_CONNECTIVITY_STATE__;
  const store = globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__;
  if (!base || !store) return;

  function guardTechnology() {
    const context = store.current();
    const technology = context.technology || {};
    const equipment = context.sources?.equipment?.data || {};
    const livePon = context.sources?.pon;
    const explicitPon = Boolean(equipment.onuMac || equipment.onuSerial || equipment.olt);
    if (technology.id === "pon"
      && technology.source === "billing-technical-data"
      && !explicitPon
      && !livePon) {
      store.writeTechnology({
        id: "unknown",
        adapter: "",
        label: "Не определена",
        confidence: "low"
      }, { source: "guard:no-explicit-pon-evidence" });
    }
  }

  function stepForEntity(model, key) {
    return model.route?.steps?.find((step) => step.entityKeys?.includes(key)) || null;
  }

  function focusEntity(key, options = {}) {
    const model = base.read();
    const entity = model.entities?.[key];
    if (!entity) return { ok: false, reason: "unknown-entity" };

    if (["session", "pon"].includes(entity.sourceId)) {
      return base.focusEntity(key, options);
    }

    const result = base.focusEntity(key, { ...options, navigate: false });
    if (result?.ok || options.navigate === false) return result;
    const step = stepForEntity(model, key);
    if (step && base.openStep(step.id)) return { ok: false, navigating: true, step: step.id };
    return result;
  }

  function focusStep(stepId) {
    const model = base.read();
    const step = model.route?.steps?.find((item) => item.id === stepId);
    if (!step) return { ok: false, reason: "unknown-step" };
    return focusEntity(step.focusKey, { navigate: true });
  }

  guardTechnology();
  document.addEventListener("dp:operator-source-captured", guardTechnology);

  globalThis.__SIMNET_OPERATOR_CONNECTIVITY_STATE__ = Object.freeze({
    ...base,
    focusEntity,
    focusStep
  });
})();
