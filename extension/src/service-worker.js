"use strict";

const LOG_PREFIX = "[SIMNET-WB-EXT]";
const FETCH_MESSAGE = "SIMNET_WB_FETCH";
const ABORT_MESSAGE = "SIMNET_WB_ABORT_FETCH";
const INFO_MESSAGE = "SIMNET_WB_GET_EXTENSION_INFO";
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_CHARS = 8_000_000;
const ALLOWED_ORIGINS = new Set([
  "https://userside.simnet.kiev.ua",
  "https://admin.simnet.kiev.ua",
  "http://admin.looknet.kiev.ua",
  "https://admin.looknet.kiev.ua"
]);
const activeRequests = new Map();

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requestKey(sender, requestId) {
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : "unknown";
  return `${tabId}:${String(requestId || "")}`;
}

function senderIsAllowed(sender) {
  try {
    return ALLOWED_ORIGINS.has(new URL(sender.url || "").origin);
  } catch (_) {
    return false;
  }
}

function normalizedRequest(input) {
  const url = new URL(String(input?.url || ""));
  const method = String(input?.method || "GET").toUpperCase();

  if (!ALLOWED_ORIGINS.has(url.origin)) {
    throw new Error(`Запрещённый origin: ${url.origin}`);
  }

  if (method !== "GET") {
    throw new Error(`Метод ${method} запрещён: bridge поддерживает только GET`);
  }

  const timeoutMs = Math.max(
    1_000,
    Math.min(Number(input?.timeout || 30_000), MAX_TIMEOUT_MS)
  );
  const headers = new Headers();
  const allowedHeaders = new Set([
    "accept",
    "cache-control",
    "pragma",
    "x-requested-with"
  ]);

  for (const [name, value] of Object.entries(input?.headers || {})) {
    if (allowedHeaders.has(name.toLowerCase())) {
      headers.set(name, String(value));
    }
  }

  return {
    url,
    method,
    timeoutMs,
    headers
  };
}

async function performFetch(message, sender) {
  if (!senderIsAllowed(sender)) {
    throw new Error("Запрос отклонён: сообщение пришло не с разрешённого Workbench origin");
  }

  const requestId = String(message?.requestId || "");
  if (!requestId) {
    throw new Error("Отсутствует requestId");
  }

  const request = normalizedRequest(message);
  const key = requestKey(sender, requestId);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), request.timeoutMs);
  activeRequests.set(key, controller);

  try {
    const response = await fetch(request.url.toString(), {
      method: request.method,
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      headers: request.headers,
      signal: controller.signal
    });
    const responseText = await response.text();

    if (responseText.length > MAX_RESPONSE_CHARS) {
      throw new Error("Ответ превышает безопасный лимит bridge");
    }

    const responseHeaders = Array.from(response.headers.entries())
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      responseText,
      responseHeaders,
      finalUrl: response.url || request.url.toString()
    };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      const abortReason = String(controller.signal.reason || errorMessage(error));
      const controlledAbort = new Error(
        abortReason === "timeout"
          ? "Запрос превысил таймаут"
          : "Запрос отменён вызывающей вкладкой"
      );
      controlledAbort.code = abortReason === "timeout"
        ? "FETCH_TIMEOUT"
        : "FETCH_CALLER_ABORT";
      throw controlledAbort;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    activeRequests.delete(key);
  }
}

function abortFetch(message, sender) {
  const key = requestKey(sender, message?.requestId);
  const controller = activeRequests.get(key);

  if (!controller) {
    return false;
  }

  controller.abort("caller-abort");
  activeRequests.delete(key);
  return true;
}

console.log(`${LOG_PREFIX} Service worker started`);

chrome.runtime.onInstalled.addListener((details) => {
  try {
    console.log(
      `${LOG_PREFIX} Extension installed or updated: ${details.reason}`
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} Installation event handling failed`, error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === INFO_MESSAGE) {
    try {
      const manifest = chrome.runtime.getManifest();
      sendResponse({
        ok: true,
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
        responseTime: Date.now()
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: errorMessage(error)
      });
      console.error(`${LOG_PREFIX} Extension info request failed`, error);
    }
    return false;
  }

  if (message?.type === ABORT_MESSAGE) {
    try {
      sendResponse({
        ok: true,
        aborted: abortFetch(message, sender)
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: errorMessage(error)
      });
      console.error(`${LOG_PREFIX} Fetch abort failed`, error);
    }
    return false;
  }

  if (message?.type !== FETCH_MESSAGE) {
    return false;
  }

  void performFetch(message, sender)
    .then(sendResponse)
    .catch((error) => {
      if (error?.code === "FETCH_CALLER_ABORT") {
        sendResponse({
          ok: false,
          aborted: true,
          error: errorMessage(error)
        });
        return;
      }
      console.error(`${LOG_PREFIX} Background GET failed`, error);
      sendResponse({
        ok: false,
        error: errorMessage(error)
      });
    });

  return true;
});
