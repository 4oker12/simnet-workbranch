(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const HOST_ID = 'simnet-wb-pbx-shell';
  const JOBS_KEY = 'simnet_workbench_pbx_manual_analysis_jobs_v1';
  const AI_KEY = 'simnet_workbench_ai_runtime_v1';
  const VERSION = chrome.runtime.getManifest().version;

  let open = false;
  let jobs = {};
  let ai = {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function countByStatus() {
    const values = Object.values(jobs || {});
    return {
      ready: values.filter(job => job?.status === 'ready').length,
      txt: values.filter(job => job?.status === 'transcribed').length,
      busy: values.filter(job => ['queued', 'downloading', 'transcribing', 'analyzing'].includes(job?.status)).length,
      error: values.filter(job => job?.status === 'error').length
    };
  }

  async function refreshData() {
    try {
      const stored = await chrome.storage.local.get([JOBS_KEY, AI_KEY]);
      jobs = stored?.[JOBS_KEY] || {};
      ai = stored?.[AI_KEY] || {};
    } catch {
      jobs = {};
      ai = {};
    }
    render();
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, {
      position: 'fixed',
      top: '72px',
      right: '10px',
      zIndex: '2147483644',
      fontFamily: 'Inter, Arial, sans-serif'
    });
    document.documentElement.appendChild(host);
    return host;
  }

  function render() {
    const host = ensureHost();
    const c = countByStatus();
    const configured = Boolean(String(ai?.groqApiKey || '').trim());

    host.innerHTML = `
      <style>
        #${HOST_ID}{color:#243247}
        #${HOST_ID} *{box-sizing:border-box}
        #${HOST_ID} .wb-pbx-toggle{display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border:1px solid #dce3eb;border-radius:12px;background:#fff;color:#344256;box-shadow:0 7px 22px rgba(15,23,42,.14);font:700 11px/1 Arial,sans-serif;cursor:pointer}
        #${HOST_ID} .wb-pbx-toggle .dot{width:8px;height:8px;border-radius:50%;background:#a50046;box-shadow:0 0 0 4px rgba(165,0,70,.08)}
        #${HOST_ID} .wb-pbx-panel{display:${open ? 'block' : 'none'};width:330px;margin-top:7px;border:1px solid #dce3eb;border-radius:14px;background:#f8fafc;box-shadow:0 16px 46px rgba(15,23,42,.22);overflow:hidden}
        #${HOST_ID} .wb-pbx-head{display:flex;align-items:center;justify-content:space-between;padding:12px 13px;border-bottom:1px solid #e6ebf1;background:#fff}
        #${HOST_ID} .wb-pbx-head strong{font-size:13px}
        #${HOST_ID} .wb-pbx-head small{display:block;margin-top:3px;color:#8a97a7;font-size:9px;font-weight:500}
        #${HOST_ID} .wb-pbx-close{border:0;background:transparent;color:#7a8798;font-size:18px;cursor:pointer}
        #${HOST_ID} .wb-pbx-body{display:grid;gap:9px;padding:11px}
        #${HOST_ID} .wb-card{padding:11px;border:1px solid #e0e6ed;border-radius:11px;background:#fff}
        #${HOST_ID} .wb-title{font-size:11px;font-weight:800;color:#2d3b50}
        #${HOST_ID} .wb-sub{margin-top:3px;color:#8491a1;font-size:9px;line-height:1.45}
        #${HOST_ID} .wb-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:9px}
        #${HOST_ID} .wb-stat{padding:7px 3px;border-radius:8px;background:#f8fafc;text-align:center}
        #${HOST_ID} .wb-stat b{display:block;font-size:13px;color:#26364a}
        #${HOST_ID} .wb-stat span{font-size:8px;color:#8a97a7}
        #${HOST_ID} .wb-ai{display:flex;align-items:center;justify-content:space-between;gap:8px}
        #${HOST_ID} .wb-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border-radius:999px;background:${configured ? '#ecfdf5' : '#fff7ed'};color:${configured ? '#047857' : '#b45309'};font-size:8px;font-weight:800}
        #${HOST_ID} .wb-pill:before{content:'';width:6px;height:6px;border-radius:50%;background:${configured ? '#10b981' : '#f59e0b'}}
        #${HOST_ID} .wb-btn{width:100%;height:34px;border:0;border-radius:8px;background:#a50046;color:#fff;font:800 10px/34px Arial,sans-serif;cursor:pointer}
        #${HOST_ID} .wb-btn.secondary{border:1px solid #dce3eb;background:#fff;color:#445266}
        #${HOST_ID} .wb-foot{color:#9aa6b5;font-size:8px;text-align:center;padding:0 0 2px}
      </style>

      <button class="wb-pbx-toggle" type="button" data-wb-toggle>
        <span class="dot"></span><span>Workbench · PBX</span>
      </button>

      <section class="wb-pbx-panel">
        <div class="wb-pbx-head">
          <div><strong>Workbench · PBX</strong><small>История звонков и AI-разбор</small></div>
          <button class="wb-pbx-close" type="button" data-wb-close>×</button>
        </div>
        <div class="wb-pbx-body">
          <div class="wb-card">
            <div class="wb-title">Разборы звонков</div>
            <div class="wb-sub">Нажми ✦ возле нужной записи. Аудио уйдёт в Whisper, затем готовый текст — в AI-разбор.</div>
            <div class="wb-stats">
              <div class="wb-stat"><b>${c.ready}</b><span>AI</span></div>
              <div class="wb-stat"><b>${c.txt}</b><span>TXT</span></div>
              <div class="wb-stat"><b>${c.busy}</b><span>в работе</span></div>
              <div class="wb-stat"><b>${c.error}</b><span>ошибка</span></div>
            </div>
          </div>

          <div class="wb-card">
            <div class="wb-ai">
              <div><div class="wb-title">Groq</div><div class="wb-sub">Qwen → GPT-OSS fallback</div></div>
              <span class="wb-pill">${configured ? 'ключ настроен' : 'нужен ключ'}</span>
            </div>
          </div>

          <button class="wb-btn" type="button" data-wb-settings>Настройки AI</button>
          <button class="wb-btn secondary" type="button" data-wb-refresh>Обновить статусы</button>
          <div class="wb-foot">SIMNET Workbench ${esc(VERSION)}</div>
        </div>
      </section>`;

    host.querySelector('[data-wb-toggle]')?.addEventListener('click', () => {
      open = !open;
      render();
    });
    host.querySelector('[data-wb-close]')?.addEventListener('click', () => {
      open = false;
      render();
    });
    host.querySelector('[data-wb-settings]')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage?.();
    });
    host.querySelector('[data-wb-refresh]')?.addEventListener('click', () => {
      void refreshData();
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    let dirty = false;
    if (changes?.[JOBS_KEY]) {
      jobs = changes[JOBS_KEY].newValue || {};
      dirty = true;
    }
    if (changes?.[AI_KEY]) {
      ai = changes[AI_KEY].newValue || {};
      dirty = true;
    }
    if (dirty) render();
  });

  void refreshData();
})();
