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

  async function openAiSettings() {
    const response = await chrome.runtime.sendMessage({ type: 'AI_RUNTIME_OPEN_SETTINGS' });
    if (!response?.success) throw new Error(response?.error || 'Не удалось открыть настройки AI');
  }

  function ensureRoot() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      document.documentElement.appendChild(host);
    }
    Object.assign(host.style, {
      all: 'initial',
      position: 'fixed',
      top: '68px',
      right: '4px',
      width: open ? 'min(380px, calc(100vw - 8px))' : 'max-content',
      maxWidth: 'calc(100vw - 8px)',
      zIndex: '2147483644'
    });
    return host.shadowRoot || host.attachShadow({ mode: 'open' });
  }

  function render() {
    const root = ensureRoot();
    const c = countByStatus();
    const configured = Boolean(String(ai?.groqApiKey || '').trim());

    root.innerHTML = `
      <style>
        :host{all:initial;color-scheme:light}
        *,*::before,*::after{box-sizing:border-box}
        button{font:inherit}
        .shell{
          width:${open ? '100%' : 'max-content'};
          max-width:100%;
          margin-left:auto;
          color:#243247;
          font:12px/1.4 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;
        }
        .toggle{
          display:flex;
          align-items:center;
          gap:8px;
          width:max-content;
          max-width:100%;
          height:40px;
          margin-left:auto;
          padding:0 13px;
          border:1px solid #dce3eb;
          border-radius:13px;
          background:#fff;
          color:#344256;
          box-shadow:0 7px 22px rgba(15,23,42,.14);
          font-weight:800;
          cursor:pointer
        }
        .toggle .dot{
          width:8px;
          height:8px;
          flex:0 0 auto;
          border-radius:50%;
          background:#a50046;
          box-shadow:0 0 0 4px rgba(165,0,70,.08)
        }
        .panel{
          display:${open ? 'block' : 'none'};
          width:100%;
          max-height:min(74vh,620px);
          margin-top:8px;
          overflow:auto;
          border:1px solid #dce3eb;
          border-radius:16px;
          background:#f8fafc;
          box-shadow:0 16px 46px rgba(15,23,42,.22);
          scrollbar-width:thin
        }
        .head{
          position:sticky;
          top:0;
          z-index:2;
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          padding:14px 15px 12px;
          border-bottom:1px solid #e6ebf1;
          background:rgba(255,255,255,.97)
        }
        .head-copy{min-width:0}
        .head strong{display:block;color:#243247;font-size:14px;line-height:1.2}
        .head small{
          display:block;
          margin-top:4px;
          color:#8a97a7;
          font-size:10px;
          font-weight:500;
          overflow-wrap:anywhere
        }
        .close{
          width:28px;
          height:28px;
          flex:0 0 auto;
          display:grid;
          place-items:center;
          padding:0;
          border:0;
          border-radius:8px;
          background:transparent;
          color:#7a8798;
          font-size:20px;
          line-height:1;
          cursor:pointer
        }
        .close:hover{background:#f1f5f9;color:#334155}
        .body{display:grid;gap:10px;padding:12px}
        .card{
          min-width:0;
          padding:12px;
          border:1px solid #e0e6ed;
          border-radius:12px;
          background:#fff;
          box-shadow:0 1px 2px rgba(15,23,42,.025)
        }
        .title{color:#2d3b50;font-size:12px;font-weight:850}
        .sub{
          margin-top:4px;
          color:#8491a1;
          font-size:10px;
          line-height:1.45;
          overflow-wrap:anywhere
        }
        .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:10px}
        .stat{
          min-width:0;
          padding:8px 3px;
          border:1px solid #eef2f6;
          border-radius:9px;
          background:#f8fafc;
          text-align:center
        }
        .stat b{display:block;color:#26364a;font-size:14px}
        .stat span{
          display:block;
          margin-top:1px;
          color:#8a97a7;
          font-size:8.5px;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .ai{display:flex;align-items:center;justify-content:space-between;gap:10px}
        .ai-copy{min-width:0;flex:1}
        .pill{
          display:inline-flex;
          align-items:center;
          gap:5px;
          max-width:48%;
          padding:5px 8px;
          border-radius:999px;
          background:${configured ? '#ecfdf5' : '#fff7ed'};
          color:${configured ? '#047857' : '#b45309'};
          font-size:9px;
          font-weight:800;
          white-space:normal
        }
        .pill::before{
          content:'';
          width:6px;
          height:6px;
          flex:0 0 auto;
          border-radius:50%;
          background:${configured ? '#10b981' : '#f59e0b'}
        }
        .btn{
          width:100%;
          min-height:38px;
          padding:8px 12px;
          border:0;
          border-radius:9px;
          background:#a50046;
          color:#fff;
          font-weight:800;
          cursor:pointer
        }
        .btn:hover{filter:brightness(1.05)}
        .btn:active{transform:translateY(1px)}
        .btn.secondary{border:1px solid #dce3eb;background:#fff;color:#445266}
        .foot{padding:0 0 2px;color:#9aa6b5;font-size:8.5px;text-align:center}

        @media (max-width:520px){
          .body{padding:10px}
          .card{padding:10px}
          .stats{gap:4px}
          .ai{align-items:flex-start;flex-direction:column}
          .pill{max-width:100%}
        }
      </style>

      <div class="shell">
        <button class="toggle" type="button" data-wb-toggle>
          <span class="dot"></span><span>Workbench · PBX</span>
        </button>

        <section class="panel" aria-label="Workbench PBX">
          <div class="head">
            <div class="head-copy">
              <strong>Workbench · PBX</strong>
              <small>История звонков и AI-разбор</small>
            </div>
            <button class="close" type="button" data-wb-close aria-label="Закрыть">×</button>
          </div>

          <div class="body">
            <div class="card">
              <div class="title">Разборы звонков</div>
              <div class="sub">Нажми ✦ возле нужной записи. Аудио уйдёт в Whisper, затем готовый текст — в AI-разбор.</div>
              <div class="stats">
                <div class="stat"><b>${c.ready}</b><span>AI</span></div>
                <div class="stat"><b>${c.txt}</b><span>TXT</span></div>
                <div class="stat"><b>${c.busy}</b><span>в работе</span></div>
                <div class="stat"><b>${c.error}</b><span>ошибка</span></div>
              </div>
            </div>

            <div class="card">
              <div class="ai">
                <div class="ai-copy">
                  <div class="title">Groq</div>
                  <div class="sub">Qwen → GPT-OSS fallback</div>
                </div>
                <span class="pill">${configured ? 'ключ настроен' : 'нужен ключ'}</span>
              </div>
            </div>

            <button class="btn" type="button" data-wb-settings>Настройки AI</button>
            <button class="btn secondary" type="button" data-wb-refresh>Обновить статусы</button>
            <div class="foot">SIMNET Workbench ${esc(VERSION)}</div>
          </div>
        </section>
      </div>`;

    root.querySelector('[data-wb-toggle]')?.addEventListener('click', () => {
      open = !open;
      render();
    });
    root.querySelector('[data-wb-close]')?.addEventListener('click', () => {
      open = false;
      render();
    });
    root.querySelector('[data-wb-settings]')?.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await openAiSettings();
      } catch (error) {
        console.error('[SIMNET WB][PBX] AI settings open failed', error);
      }
    });
    root.querySelector('[data-wb-refresh]')?.addEventListener('click', () => {
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
