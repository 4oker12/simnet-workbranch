"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__) return;
  const HOST_ID = "simnet-workbench-dock";
  const OPEN_PANEL = "SIMNET_WB_OPEN_SIDE_PANEL";
  const icons = {
    mentor: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z",
    talk: "M4 5h16v11H8l-4 4V5z",
    learn: "M4 5h7a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4V5Zm16 0h-6a3 3 0 0 0-3 3"
  };
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"></path></svg>`;
  const open = mode => chrome.runtime.sendMessage({ type: OPEN_PANEL, mode }).catch(() => {});

  function install() {
    document.getElementById("simnet-mentor-shell")?.remove();
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{all:initial;position:fixed;z-index:2147483647;right:0;top:0;width:48px;height:100vh}
      *{box-sizing:border-box}nav{display:flex;flex-direction:column;align-items:center;gap:7px;width:48px;height:100%;padding:8px 5px;background:#0a1019;border-left:1px solid #253246;box-shadow:-4px 0 12px rgba(0,0,0,.18)}
      button{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;color:#8f9caf;background:transparent;border:0;border-radius:9px;cursor:pointer}
      button:hover,button:focus-visible{color:#fff;background:#1c293a;outline:none}button.primary{color:#ceb1ff;background:#2c2143}.spacer{flex:1}
      svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .tip{position:absolute;right:46px;top:50%;padding:5px 7px;color:#fff;background:#111a28;border:1px solid #34445a;border-radius:6px;opacity:0;visibility:hidden;transform:translateY(-50%);white-space:nowrap;font:11px "Segoe UI",Arial,sans-serif;pointer-events:none}
      button:hover .tip{opacity:1;visibility:visible}
    </style><nav aria-label="Workbench">
      <button class="primary" data-mode="mentor">${svg("mentor")}<span class="tip">Наставник</span></button>
      <button data-mode="quick">${svg("quick")}<span class="tip">Быстрые факты</span></button>
      <button data-mode="mentor">${svg("talk")}<span class="tip">Live Call</span></button>
      <button data-mode="mentor">${svg("learn")}<span class="tip">Обучение</span></button>
      <span class="spacer"></span>
    </nav>`;
    root.addEventListener("click", event => {
      const button = event.target.closest("button[data-mode]");
      if (button) open(button.dataset.mode || "mentor");
    });
    (document.body || document.documentElement).appendChild(host);
  }

  globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__ = { version: "0.1.0", open };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
