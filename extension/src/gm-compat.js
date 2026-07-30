(() => {
  "use strict";

  const GLOBAL_KEY = "__SIMNET_EXTENSION_COMPAT__";
  if (globalThis[GLOBAL_KEY]) {
    return;
  }

  const LOG_PREFIX = "[SIMNET-WB-EXT]";
  const FETCH_MESSAGE = "SIMNET_WB_FETCH";
  const ABORT_MESSAGE = "SIMNET_WB_ABORT_FETCH";
  const INFO_MESSAGE = "SIMNET_WB_GET_EXTENSION_INFO";
  const DELETE_MARKER = "__SIMNET_EXTENSION_DELETED__";
  const cache = Object.create(null);
  const listeners = new Map();
  const pendingLocalChanges = new Map();
  const storageWriteTails = new Map();
  let nextListenerId = 1;

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function extensionContextWasInvalidated(error) {
    return /Extension context invalidated/i.test(errorMessage(error));
  }

  function cloneValue(value) {
    if (value === undefined || value === null) {
      return value;
    }

    try {
      return structuredClone(value);
    } catch (_) {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (_) {
        return value;
      }
    }
  }

  function fingerprint(value, deleted = false) {
    if (deleted) {
      return DELETE_MARKER;
    }

    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function markPendingLocalChange(key, value, deleted = false) {
    const markers = pendingLocalChanges.get(key) || [];
    markers.push({
      fingerprint: fingerprint(value, deleted),
      createdAt: Date.now()
    });
    pendingLocalChanges.set(key, markers.slice(-20));
  }

  function consumePendingLocalChange(key, value, deleted = false) {
    const markers = pendingLocalChanges.get(key);
    if (!markers?.length) {
      return false;
    }

    const expected = fingerprint(value, deleted);
    const now = Date.now();
    const liveMarkers = markers.filter((marker) => now - marker.createdAt < 10_000);
    const index = liveMarkers.findIndex((marker) => marker.fingerprint === expected);

    if (index === -1) {
      if (liveMarkers.length) {
        pendingLocalChanges.set(key, liveMarkers);
      } else {
        pendingLocalChanges.delete(key);
      }
      return false;
    }

    liveMarkers.splice(index, 1);
    if (liveMarkers.length) {
      pendingLocalChanges.set(key, liveMarkers);
    } else {
      pendingLocalChanges.delete(key);
    }
    return true;
  }

  function notifyValueListeners(key, oldValue, newValue, remote) {
    for (const listener of listeners.values()) {
      if (listener.key !== key) {
        continue;
      }

      try {
        listener.callback(
          key,
          cloneValue(oldValue),
          cloneValue(newValue),
          remote
        );
      } catch (error) {
        console.error(`${LOG_PREFIX} Storage listener failed`, error);
      }
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    for (const [key, change] of Object.entries(changes)) {
      const deleted = change.newValue === undefined;
      const local = consumePendingLocalChange(key, change.newValue, deleted);

      if (deleted) {
        delete cache[key];
      } else {
        cache[key] = cloneValue(change.newValue);
      }

      notifyValueListeners(key, change.oldValue, change.newValue, !local);
    }
  });

  const ready = chrome.storage.local
    .get(null)
    .then((stored) => {
      for (const [key, value] of Object.entries(stored || {})) {
        cache[key] = cloneValue(value);
      }
      console.log(`${LOG_PREFIX} Storage compatibility cache ready`);
      return true;
    })
    .catch((error) => {
      if (!extensionContextWasInvalidated(error)) {
        console.error(`${LOG_PREFIX} Storage preload failed`, error);
      }
      return false;
    });

  function GM_getValue(key, fallback) {
    const normalizedKey = String(key);
    return Object.hasOwn(cache, normalizedKey)
      ? cloneValue(cache[normalizedKey])
      : cloneValue(fallback);
  }

  function enqueueStorageWrite(key, operation) {
    const previous = storageWriteTails.get(key) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(operation);
    storageWriteTails.set(key, next);

    return next.finally(() => {
      if (storageWriteTails.get(key) === next) {
        storageWriteTails.delete(key);
      }
    });
  }

  function GM_setValue(key, value) {
    const normalizedKey = String(key);
    const cloned = cloneValue(value);
    cache[normalizedKey] = cloned;
    markPendingLocalChange(normalizedKey, cloned);

    return enqueueStorageWrite(normalizedKey, () => chrome.storage.local.set({
      [normalizedKey]: cloned
    }))
      .then(() => true)
      .catch((error) => {
        if (!extensionContextWasInvalidated(error)) {
          console.error(`${LOG_PREFIX} Storage write failed for ${normalizedKey}`, error);
        }
        return false;
      });
  }

  function GM_deleteValue(key) {
    const normalizedKey = String(key);
    delete cache[normalizedKey];
    markPendingLocalChange(normalizedKey, undefined, true);

    return enqueueStorageWrite(
      normalizedKey,
      () => chrome.storage.local.remove(normalizedKey)
    )
      .then(() => true)
      .catch((error) => {
        if (!extensionContextWasInvalidated(error)) {
          console.error(`${LOG_PREFIX} Storage delete failed for ${normalizedKey}`, error);
        }
        return false;
      });
  }

  function GM_addValueChangeListener(key, callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Value change listener must be a function");
    }

    const id = nextListenerId;
    nextListenerId += 1;
    listeners.set(id, {
      key: String(key),
      callback
    });
    return id;
  }

  function GM_removeValueChangeListener(id) {
    return listeners.delete(Number(id));
  }

  function GM_addStyle(cssText) {
    const style = document.createElement("style");
    style.dataset.simnetExtensionStyle = "1";
    style.textContent = String(cssText || "");
    (document.head || document.documentElement).append(style);
    return style;
  }

  function legacyClipboardWrite(text) {
    const textarea = document.createElement("textarea");
    textarea.value = String(text || "");
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.documentElement.append(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  function GM_setClipboard(text, type = "text") {
    if (!String(type || "text").startsWith("text")) {
      throw new Error(`Unsupported clipboard type: ${type}`);
    }

    const value = String(text || "");
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(value).catch((error) => {
        console.warn(`${LOG_PREFIX} Clipboard API failed; using fallback`, error);
        return legacyClipboardWrite(value);
      });
    }

    return Promise.resolve(legacyClipboardWrite(value));
  }

  function responseHeadersText(headers) {
    return Array.from(headers.entries())
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
  }

  function invokeCallback(callback, payload, label) {
    if (typeof callback !== "function") {
      return;
    }

    try {
      callback(payload);
    } catch (error) {
      console.error(`${LOG_PREFIX} ${label} callback failed`, error);
    }
  }

  function GM_xmlhttpRequest(details = {}) {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const method = String(details.method || "GET").toUpperCase();
    const url = new URL(String(details.url || ""), location.href);
    const timeoutMs = Math.max(0, Number(details.timeout || 0));
    const sameOrigin = url.origin === location.origin;
    let settled = false;
    let timeoutId = 0;

    const finish = (callback, payload, label) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      invokeCallback(callback, payload, label);
    };

    const abort = (reason = "caller-abort") => {
      if (settled) {
        return;
      }

      controller.abort(reason);
      if (!sameOrigin) {
        void chrome.runtime.sendMessage({
          type: ABORT_MESSAGE,
          requestId
        }).catch(() => {});
      }
      finish(details.onabort, {
        readyState: 4,
        status: 0,
        statusText: "aborted",
        responseText: "",
        finalUrl: url.toString()
      }, "onabort");
    };

    if (method !== "GET") {
      queueMicrotask(() => {
        finish(details.onerror, {
          readyState: 4,
          status: 0,
          statusText: `Method ${method} is not allowed`,
          responseText: "",
          finalUrl: url.toString()
        }, "onerror");
      });
      return { abort };
    }

    if (timeoutMs > 0) {
      timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        controller.abort("timeout");
        if (!sameOrigin) {
          void chrome.runtime.sendMessage({
            type: ABORT_MESSAGE,
            requestId
          }).catch(() => {});
        }
        finish(details.ontimeout, {
          readyState: 4,
          status: 0,
          statusText: "timeout",
          responseText: "",
          finalUrl: url.toString()
        }, "ontimeout");
      }, timeoutMs);
    }

    queueMicrotask(() => {
      invokeCallback(details.onloadstart, {
        readyState: 1,
        status: 0,
        finalUrl: url.toString()
      }, "onloadstart");
    });

    if (sameOrigin) {
      void fetch(url.toString(), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "follow",
        headers: details.headers || {},
        signal: controller.signal
      })
        .then(async (response) => {
          const responseText = await response.text();
          finish(details.onload, {
            readyState: 4,
            status: response.status,
            statusText: response.statusText,
            response: responseText,
            responseText,
            responseHeaders: responseHeadersText(response.headers),
            finalUrl: response.url || url.toString()
          }, "onload");
        })
        .catch((error) => {
          if (settled || controller.signal.aborted) {
            return;
          }
          finish(details.onerror, {
            readyState: 4,
            status: 0,
            statusText: errorMessage(error),
            responseText: "",
            finalUrl: url.toString()
          }, "onerror");
        });
    } else {
      void chrome.runtime
        .sendMessage({
          type: FETCH_MESSAGE,
          requestId,
          method,
          url: url.toString(),
          timeout: timeoutMs
            ? Math.min(timeoutMs + 1_000, 60_000)
            : 30_000,
          headers: details.headers || {}
        })
        .then((response) => {
          if (settled) {
            return;
          }

          if (!response?.ok) {
            throw new Error(response?.error || "Background GET failed");
          }

          finish(details.onload, {
            readyState: 4,
            status: Number(response.status || 0),
            statusText: String(response.statusText || ""),
            response: String(response.responseText || ""),
            responseText: String(response.responseText || ""),
            responseHeaders: String(response.responseHeaders || ""),
            finalUrl: String(response.finalUrl || url.toString())
          }, "onload");
        })
        .catch((error) => {
          if (settled) {
            return;
          }
          finish(details.onerror, {
            readyState: 4,
            status: 0,
            statusText: errorMessage(error),
            responseText: "",
            finalUrl: url.toString()
          }, "onerror");
        });
    }

    return { abort };
  }

  const api = Object.freeze({
    GM_getValue,
    GM_setValue,
    GM_deleteValue,
    GM_addValueChangeListener,
    GM_removeValueChangeListener,
    GM_addStyle,
    GM_setClipboard,
    GM_xmlhttpRequest
  });

  globalThis[GLOBAL_KEY] = Object.freeze({
    version: "1.0.0",
    ready,
    api
  });

  void ready.then(() => chrome.runtime.sendMessage({
    type: INFO_MESSAGE
  })).then((info) => {
    if (info?.ok) {
      console.log(
        `${LOG_PREFIX} Extension v${info.version}; Workbench compatibility layer ready`
      );
    }
  }).catch((error) => {
    console.error(`${LOG_PREFIX} Service worker handshake failed`, error);
  });
})();
