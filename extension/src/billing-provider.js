"use strict";

(() => {
  const profiles = Object.freeze({
    simnet: Object.freeze({
      id: "simnet",
      label: "Simnet",
      hostname: "admin.simnet.kiev.ua",
      base: "https://admin.simnet.kiev.ua",
      cookieTopLevelSite: "https://admin.simnet.kiev.ua",
      ppKey: "dp_billing_pp_v5",
      ppMetaKey: "dp_billing_pp_meta_v5",
      ppCandidateKey: "dp_billing_pp_candidate_v5",
      bridgePresenceKey: "dp_billing_bridge_presence_v1"
    }),
    looknet: Object.freeze({
      id: "looknet",
      label: "Looknet",
      hostname: "admin.looknet.kiev.ua",
      base: "https://admin.looknet.kiev.ua",
      cookieTopLevelSite: "https://admin.looknet.kiev.ua",
      ppKey: "dp_looknet_billing_pp_v1",
      ppMetaKey: "dp_looknet_billing_pp_meta_v1",
      ppCandidateKey: "dp_looknet_billing_pp_candidate_v1",
      bridgePresenceKey: "dp_looknet_billing_bridge_presence_v1"
    })
  });

  function normalizeProvider(value) {
    const provider = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(profiles, provider) ? provider : "";
  }

  function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return mode === "simnet" || mode === "looknet" ? mode : "auto";
  }

  function profileForProvider(provider) {
    return profiles[normalizeProvider(provider)] || profiles.simnet;
  }

  function providerForHostname(hostname) {
    const normalized = String(hostname || "").trim().toLowerCase();
    return Object.values(profiles).find((profile) => profile.hostname === normalized)?.id || "";
  }

  function providerFromText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (/\blooknet\b/i.test(text)) return "looknet";
    if (/\bsimnet\b/i.test(text)) return "simnet";
    return "";
  }

  function providerFromBillingSystemId(value) {
    const id = String(value || "").trim();
    if (id === "2") return "looknet";
    if (id === "1") return "simnet";
    return "";
  }

  function detectFromDocument(doc) {
    if (!doc || typeof doc.querySelectorAll !== "function") {
      return { provider: "", source: "none" };
    }

    for (const item of doc.querySelectorAll(".item")) {
      const label = item.querySelector?.(".left_data");
      if (!/^\s*Биллинг\s*:/iu.test(String(label?.textContent || ""))) continue;
      const value = [...(item.children || [])]
        .filter((child) => child !== label)
        .map((child) => String(child?.textContent || ""))
        .join(" ");
      const provider = providerFromText(value);
      if (provider) return { provider, source: "userside.billing-label" };
    }

    const iframe = doc.querySelector('iframe[src*="juniper.php"]');
    if (iframe) {
      const src = String(iframe.getAttribute?.("src") || iframe.src || "");
      const query = src.includes("?") ? src.slice(src.indexOf("?") + 1) : "";
      const provider = providerFromBillingSystemId(new URLSearchParams(query).get("billing_id"));
      if (provider) return { provider, source: "userside.juniper.billing_id" };
    }

    return { provider: "", source: "none" };
  }

  globalThis.__SIMNET_BILLING_PROVIDER__ = Object.freeze({
    profiles,
    normalizeMode,
    normalizeProvider,
    profileForProvider,
    providerForHostname,
    providerFromBillingSystemId,
    providerFromText,
    detectFromDocument
  });
})();
