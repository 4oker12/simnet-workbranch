"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_CONTEXT_SANITIZER__) return;

  const baseCore = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!baseCore?.getState || !baseCore?.subscribe) return;

  const compact = (value, max = 180) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const TECHNICAL_NOISE = /(?:Источник|Полный|Autofind|Reboot|Запрос\s+OLT|Опрос|профиль\s+пользователя|Администратор|id\s*=|порт\s*(?:GPON|EPON)|аРахунок|Клієнт\s*:\s*abon|abon\d+\s*\(|(?:\d{1,3}\.){3}\d{1,3})/i;
  const ADDRESS_MARKER = /(?:\bвул\.?|\bул\.?|улиц|просп|пр-т|пров\.?|пер\.?|шосе|шоссе|буд\.?|дом\b|кв\.?|квартира|\b\d+[а-яa-z]?(?:\s*[/,-]\s*\d+)?\b)/i;

  function sanitizeName(value, login = "") {
    const text = compact(value, 160);
    if (!text || text.length > 72) return "";
    if (TECHNICAL_NOISE.test(text) || /\d/.test(text)) return "";
    if (login && text.toLowerCase().includes(String(login).toLowerCase())) return "";
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 6 || words.some(word => word.length > 32)) return "";
    return text;
  }

  function sanitizeAddress(value, system = "") {
    const text = compact(value, 260);
    if (!text || text.length > 140 || TECHNICAL_NOISE.test(text)) return "";
    if (system === "billing" && !ADDRESS_MARKER.test(text)) return "";
    return text;
  }

  function sanitizeContext(context = {}) {
    return {
      ...context,
      fullName: sanitizeName(context.fullName, context.login),
      address: sanitizeAddress(context.address, context.system)
    };
  }

  function sanitizeState(input) {
    const state = input || {};
    return {
      ...state,
      context: sanitizeContext(state.context || {})
    };
  }

  const sanitizedCore = {
    ...baseCore,
    version: "0.4.1",
    getState() {
      return sanitizeState(baseCore.getState());
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      return baseCore.subscribe(state => listener(sanitizeState(state)));
    }
  };

  globalThis.__SIMNET_WORKBENCH_CORE__ = sanitizedCore;
  globalThis.__SIMNET_CONTEXT_SANITIZER__ = {
    version: "0.1.0",
    sanitizeState,
    sanitizeContext,
    sanitizeName,
    sanitizeAddress
  };
})();
