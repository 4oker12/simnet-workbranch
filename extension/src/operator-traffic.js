"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_TRAFFIC__) return;
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  if (!compat?.ready || !compat?.api) return;
  await compat.ready;

  const { GM_xmlhttpRequest } = compat.api;
  const cache = new Map();

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseNumber(value) {
    const normalized = text(value).replace(/\s/g, "").replace(",", ".");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function formatMegabytes(value) {
    if (!Number.isFinite(value)) return "Не найдено";
    if (value >= 1024 * 1024) {
      return `${(value / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ТБ`;
    }
    if (value >= 1024) {
      return `${(value / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ГБ`;
    }
    return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} МБ`;
  }

  function currentCredentials() {
    const page = new URL(location.href);
    const form = document.querySelector('form[action*="stat.pl"], form[action*="adm.pl"]');
    const id = page.searchParams.get("id")
      || document.querySelector('input[name="id"]')?.value
      || form?.querySelector('input[name="id"]')?.value
      || "";
    const pp = page.searchParams.get("pp")
      || document.querySelector('input[name="pp"]')?.value
      || form?.querySelector('input[name="pp"]')?.value
      || "";
    return { id: text(id), pp: text(pp) };
  }

  function normalizePeriod(input = {}) {
    const now = new Date();
    const month = Math.max(1, Math.min(12, Number(input.month) || now.getMonth() + 1));
    const year = Math.max(2000, Math.min(2200, Number(input.year) || now.getFullYear()));
    return { month, year };
  }

  function buildUrl(input = {}) {
    const { id, pp } = currentCredentials();
    if (!id || !pp) throw new Error("Не удалось определить id или pp текущего абонента.");
    const { month, year } = normalizePeriod(input);
    const url = new URL("/cgi-bin/adm/stat.pl", location.origin);
    url.searchParams.set("alias", "0");
    url.searchParams.set("pp", pp);
    url.searchParams.set("a", "108");
    url.searchParams.set("ed", "0");
    url.searchParams.set("id", id);
    url.searchParams.set("sday", "0");
    url.searchParams.set("eday", "0");
    url.searchParams.set("mon", String(month));
    url.searchParams.set("year", String(year - 1900));
    return { url, id, month, year };
  }

  function directCells(row) {
    return [...row.querySelectorAll(":scope > td, :scope > th")];
  }

  function findDailyTable(doc) {
    return [...doc.querySelectorAll("table.tbg1, table")].find((table) => {
      const content = text(table.textContent);
      return /День/i.test(content)
        && /Прийом|Прием/i.test(content)
        && /Відправка|Отправка/i.test(content)
        && /Сумма/i.test(content);
    }) || null;
  }

  function parseDailyTrafficHtml(html, meta = {}) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const heading = text(doc.body?.textContent);
    if (/войти|авторизац|login/i.test(heading) && !/Трафік подобово|Трафик посуточно/i.test(heading)) {
      throw new Error("Billing вернул страницу авторизации вместо статистики.");
    }

    const table = findDailyTable(doc);
    if (!table) throw new Error("Таблица посуточного трафика не найдена.");

    const days = [];
    let declaredReceive = null;
    let declaredSend = null;

    for (const row of table.querySelectorAll("tr")) {
      const cells = directCells(row);
      if (cells.length < 3) continue;
      const label = text(cells[0]?.textContent);
      if (/^Сумма$/i.test(label)) {
        declaredReceive = parseNumber(cells[1]?.textContent);
        declaredSend = parseNumber(cells[2]?.textContent);
        continue;
      }
      if (!/^\d{1,2}$/.test(label)) continue;
      const day = Number(label);
      const receive = parseNumber(cells[1]?.textContent);
      const send = parseNumber(cells[2]?.textContent);
      days.push({
        day,
        receive: Number.isFinite(receive) ? receive : 0,
        send: Number.isFinite(send) ? send : 0,
        total: (Number.isFinite(receive) ? receive : 0) + (Number.isFinite(send) ? send : 0),
        hasTraffic: (Number.isFinite(receive) && receive > 0) || (Number.isFinite(send) && send > 0)
      });
    }

    days.sort((a, b) => a.day - b.day);
    const activeDays = days.filter((item) => item.hasTraffic);
    const calculatedReceive = days.reduce((sum, item) => sum + item.receive, 0);
    const calculatedSend = days.reduce((sum, item) => sum + item.send, 0);
    const receive = Number.isFinite(declaredReceive) ? declaredReceive : calculatedReceive;
    const send = Number.isFinite(declaredSend) ? declaredSend : calculatedSend;
    const total = receive + send;
    const accountMatch = heading.match(/Статистика для облікового запису\s+([^\s(]+)(?:\s*\(ip\s*([^\)]+)\))?/i);

    return {
      source: "billing-stat-daily",
      id: meta.id || "",
      month: meta.month || null,
      year: meta.year || null,
      account: text(accountMatch?.[1]),
      ip: text(accountMatch?.[2]),
      unit: "MB",
      days,
      activeDays: activeDays.length,
      firstActiveDay: activeDays[0]?.day || null,
      lastActiveDay: activeDays.at(-1)?.day || null,
      receive,
      send,
      total,
      formatted: {
        receive: formatMegabytes(receive),
        send: formatMegabytes(send),
        total: formatMegabytes(total)
      },
      recentActiveDays: activeDays.slice(-5).reverse(),
      fetchedAt: Date.now()
    };
  }

  function requestText(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url.toString(),
        timeout,
        onload(response) {
          if (Number(response.status) < 200 || Number(response.status) >= 400) {
            reject(new Error(`Статистика вернула HTTP ${response.status || 0}.`));
            return;
          }
          resolve(String(response.responseText || response.response || ""));
        },
        onerror(response) {
          reject(new Error(response?.statusText || "Не удалось загрузить статистику."));
        },
        ontimeout() {
          reject(new Error("Превышено время ожидания статистики."));
        }
      });
    });
  }

  async function loadMonth(input = {}) {
    const built = buildUrl(input);
    const key = `${location.origin}|${built.id}|${built.year}-${built.month}`;
    if (!input.force && cache.has(key)) return cache.get(key);
    const html = await requestText(built.url);
    const report = parseDailyTrafficHtml(html, built);
    cache.set(key, report);
    return report;
  }

  function peekMonth(input = {}) {
    try {
      const built = buildUrl(input);
      return cache.get(`${location.origin}|${built.id}|${built.year}-${built.month}`) || null;
    } catch (_) {
      return null;
    }
  }

  globalThis.__SIMNET_OPERATOR_TRAFFIC__ = Object.freeze({
    loadMonth,
    peekMonth,
    buildUrl,
    parseDailyTrafficHtml,
    formatMegabytes
  });
})();
