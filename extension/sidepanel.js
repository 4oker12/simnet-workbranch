"use strict";

const CORE_STATE = "SIMNET_WB_CORE_STATE";
const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
const GET_ACTIVE_STATE = "SIMNET_WB_GET_ACTIVE_STATE";
const SET_PANEL_MODE = "SIMNET_WB_SET_PANEL_MODE";

let snapshot = null;
let mode = "mentor";

const $ = selector => document.querySelector(selector);
const safe = (value, max = 180) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const send = message => chrome.runtime.sendMessage(message);

function stepList(state) {
  const context = state?.context || {};
  const facts = state?.facts || [];
  const joined = facts.join(" ").toLowerCase();
  return [
    {
      id: "subscriber",
      title: "Подтвердить абонента",
      detail: context.contract ? `${context.login || `abon${context.contract}`} · карточка найдена` : "Контекст не подтверждён",
      done: Boolean(context.contract)
    },
    {
      id: "session",
      title: "Проверить сессию",
      detail: /сесси/.test(joined) ? "Результат присутствует в фактах" : "Пока нет подтверждённого результата",
      done: /сесси/.test(joined)
    },
    {
      id: "line",
      title: "Проверить линию / ONU",
      detail: /(onu|olt|сигнал|оптик)/.test(joined) ? "Технические данные получены" : "Ожидает диагностики",
      done: /(onu|olt|сигнал|оптик)/.test(joined)
    }
  ];
}

function focusFor(state) {
  if (!state?.context?.contract) return ["Открой карточку абонента", "Workbench ожидает подтверждённый контекст Billing или UserSide."];
  if (state?.status?.running) return ["Не делай вывод раньше времени", "Диагностика выполняется. Дождись завершения текущего шага."];
  const joined = (state?.facts || []).join(" ").toLowerCase();
  if (/сесси.{0,30}(нет|отсутств|не найден)/.test(joined)) return ["Сессия не подтверждена", "Активный договор сам по себе не доказывает наличие авторизации."];
  if (/(onu|olt).{0,30}(offline|down|не доступ|не найден)/.test(joined)) return ["Проверь физическое состояние линии", "Сопоставь live-данные с технической привязкой абонента."];
  return ["Следующий шаг — короткая диагностика", "Запусти сбор данных или подсвети нужное поле на странице."];
}

function renderMode() {
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("#mentorView").hidden = mode !== "mentor";
  $("#quickView").hidden = mode !== "quick";
}

function render() {
  const state = snapshot || {};
  const context = state.context || {};
  $("#subscriberTitle").textContent = context.fullName || context.login || (context.contract ? `abon${context.contract}` : "Ожидаю карточку");
  $("#subscriberMeta").textContent = context.address || (context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : "Открой Billing или UserSide");
  $("#chips").innerHTML = [
    context.contract && `№ ${context.contract}`,
    context.ip && `IP ${context.ip}`,
    context.mac && `MAC ${context.mac}`
  ].filter(Boolean).map(value => `<span class="chip">${safe(value)}</span>`).join("");

  $("#stageText").textContent = state.status?.label || state.status?.stage || "Готов к работе";
  $("#statusText").textContent = state.status?.text || "Ожидаю действие оператора";
  $("#statusDot").classList.toggle("running", Boolean(state.status?.running));

  const [focusTitle, focusText] = focusFor(state);
  $("#focusTitle").textContent = focusTitle;
  $("#focusText").textContent = focusText;

  $("#checklist").innerHTML = stepList(state).map((step, index) => `
    <div class="step">
      <span class="step-index">${step.done ? "✓" : index + 1}</span>
      <span class="step-copy"><strong>${safe(step.title)}</strong><span>${safe(step.detail)}</span></span>
      <span class="step-actions"><button data-highlight="${step.id}">🎯 Поле</button><button data-answer="yes">Да</button><button data-answer="no">Нет</button></span>
    </div>`).join("");

  $("#runBtn").disabled = !context.contract || Boolean(state.status?.running);
  $("#stopBtn").hidden = !state.status?.running;
  $("#facts").innerHTML = (state.facts || []).length
    ? state.facts.map(fact => `<div class="fact-card"><b>Факт</b><span>${safe(fact, 320)}</span></div>`).join("")
    : `<div class="empty">Факты появятся после диагностики.</div>`;
  renderMode();
}

async function load() {
  const response = await send({ type: GET_ACTIVE_STATE });
  if (response?.ok) {
    snapshot = response.state;
    mode = response.mode || "mentor";
    render();
  }
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === CORE_STATE) {
    snapshot = message.state;
    render();
  }
  if (message?.type === "SIMNET_WB_PANEL_MODE_CHANGED") {
    mode = message.mode || "mentor";
    renderMode();
  }
});

document.addEventListener("click", async event => {
  const modeButton = event.target.closest("[data-mode]");
  if (modeButton) {
    mode = modeButton.dataset.mode;
    await send({ type: SET_PANEL_MODE, mode });
    renderMode();
    return;
  }
  const highlight = event.target.closest("[data-highlight]");
  if (highlight) {
    await send({ type: CORE_COMMAND, action: "highlight", target: highlight.dataset.highlight });
    return;
  }
  if (event.target.closest("#runBtn")) await send({ type: CORE_COMMAND, action: "run" });
  if (event.target.closest("#stopBtn")) await send({ type: CORE_COMMAND, action: "stop" });
  if (event.target.closest("#refreshBtn")) await send({ type: CORE_COMMAND, action: "refresh" });
});

void load();
