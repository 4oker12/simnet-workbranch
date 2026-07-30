(() => {
  "use strict";

  const GUARD = "__SIMNET_MAP_CAPTURE_PAGE_HOOK_V2__";
  const EVENT_NAME = "simnet-map-evidence-capture-v2";
  const MAX_GENERIC_BODY = 500_000;
  const MAX_MAP_FEATURES = 1_800;

  if (window[GUARD] || location.hostname !== "userside.simnet.kiev.ua") {
    return;
  }
  window[GUARD] = true;

  function markInstalled() {
    if (document.documentElement) {
      document.documentElement.dataset.simnetMapCaptureHook = "1";
      return true;
    }
    return false;
  }

  if (!markInstalled()) {
    document.addEventListener("DOMContentLoaded", markInstalled, {
      once: true
    });
  }

  function classify(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      if (
        /maps\.googleapis\.com$/i.test(url.hostname)
        && /\/maps\/api\/geocode\/json$/i.test(url.pathname)
      ) {
        return "geocode";
      }
      if (url.hostname !== location.hostname) {
        return "";
      }
      if (url.pathname === "/map/ajax_find") {
        return "map-find";
      }
      if (url.pathname === "/map/request_by_ws") {
        return "map-window-request";
      }
      if (url.pathname === "/map/load_from_ws") {
        return "map-features";
      }
      if (url.pathname === "/map/tooltip") {
        return "map-tooltip";
      }
    } catch (_) {
      return "";
    }
    return "";
  }

  function compactMapFeatures(text) {
    try {
      const parsed = JSON.parse(String(text || ""));
      const features = Array.isArray(parsed.features) ? parsed.features : [];
      const selected = features.filter((feature) => {
        const type = String(feature?.properties?.type || "");
        return type === "house" || type === "node";
      });
      const limited = selected.slice(0, MAX_MAP_FEATURES);

      return JSON.stringify({
        type: parsed.type || "FeatureCollection",
        features: limited,
        __capture: {
          originalFeatureCount: features.length,
          selectedFeatureCount: selected.length,
          exportedFeatureCount: limited.length,
          truncated: selected.length > limited.length
        }
      });
    } catch (_) {
      return String(text || "").slice(0, MAX_GENERIC_BODY);
    }
  }

  function prepareBody(kind, text) {
    const raw = String(text || "");
    if (kind === "map-features") {
      return compactMapFeatures(raw);
    }
    return raw.slice(0, MAX_GENERIC_BODY);
  }

  function emit(payload) {
    try {
      document.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: JSON.stringify(payload)
      }));
    } catch (_) {
      // The page request must never fail because passive capture failed.
    }
  }

  function capture(transport, method, rawUrl, status, ok, body) {
    const kind = classify(rawUrl);
    if (!kind) {
      return;
    }

    emit({
      at: new Date().toISOString(),
      transport,
      method: String(method || "GET").toUpperCase(),
      url: new URL(String(rawUrl || ""), location.href).toString(),
      status: Number(status || 0),
      ok: Boolean(ok),
      body: prepareBody(kind, body)
    });
  }

  try {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function" && !originalFetch.__simnetMapCaptureWrapped) {
      const wrappedFetch = function (...args) {
        const input = args[0];
        const init = args[1] || {};
        const rawUrl = typeof input === "string" ? input : input?.url || "";
        const method = String(init.method || input?.method || "GET").toUpperCase();
        const promise = originalFetch.apply(this, args);

        Promise.resolve(promise)
          .then((response) => {
            if (!classify(rawUrl)) {
              return;
            }
            try {
              void response.clone().text()
                .then((text) => capture(
                  "fetch",
                  method,
                  rawUrl,
                  response.status,
                  response.ok,
                  text
                ))
                .catch(() => {});
            } catch (_) {
              // Passive capture must not affect the original response.
            }
          })
          .catch(() => {});

        return promise;
      };
      wrappedFetch.__simnetMapCaptureWrapped = true;
      window.fetch = wrappedFetch;
    }
  } catch (_) {
    // XHR capture can still work when fetch wrapping is unavailable.
  }

  try {
    const proto = window.XMLHttpRequest?.prototype;
    if (proto && !proto.__simnetMapCaptureWrapped) {
      const originalOpen = proto.open;
      const originalSend = proto.send;

      proto.open = function (method, rawUrl, ...rest) {
        this.__simnetMapCaptureMeta = {
          method: String(method || "GET").toUpperCase(),
          url: String(rawUrl || "")
        };
        return originalOpen.call(this, method, rawUrl, ...rest);
      };

      proto.send = function (...args) {
        const xhr = this;
        xhr.addEventListener("loadend", () => {
          const meta = xhr.__simnetMapCaptureMeta || {
            method: "GET",
            url: ""
          };
          if (!classify(meta.url)) {
            return;
          }

          let body = "";
          try {
            if (!xhr.responseType || xhr.responseType === "text") {
              body = String(xhr.responseText || "");
            } else if (xhr.responseType === "json") {
              body = JSON.stringify(xhr.response || null);
            }
          } catch (_) {
            body = "";
          }

          capture(
            "xhr",
            meta.method,
            meta.url,
            xhr.status,
            xhr.status >= 200 && xhr.status < 400,
            body
          );
        }, {
          once: true
        });
        return originalSend.apply(this, args);
      };
      proto.__simnetMapCaptureWrapped = true;
    }
  } catch (_) {
    // The Workbench remains usable without passive map capture.
  }
})();
