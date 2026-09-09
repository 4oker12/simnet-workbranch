(() => {
  'use strict';

  if (window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-rail-host';
  const SETTINGS_ID = 'wb-human-settings';
  const STYLE_ID = 'wb-human-settings-style';
  const AI_USAGE_LEDGER_KEY = 'simnet_workbench_ai_usage_ledger_v1';
  const MODELS = Object.freeze([
    ['qwen/qwen3.6-27b', 'Qwen 3.6 27B'],
    ['openai/gpt-oss-120b', 'GPT-OSS 120B'],
    ['qwen/qwen3.8-27b', 'Qwen 3.8 27B'],
    ['openai/gpt-oss-20b', 'GPT-OSS 20B']
  ]);

  let rootObserver = null;
  let documentObserver = null;
  let attachedRoot = null;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const tokenNumber = value => Math.max(0, Math.round(Number(value || 0))).toLocaleString('ru-RU');

  function installStyle(root) {
    if (root.getElementById?.(STYLE_ID) || root.querySelector?.(`#${STYLE_ID}`)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${SETTINGS_ID}{display:grid;gap:8px;padding:2px 0 8px}
      #${SETTINGS_ID} .wb-set-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px;box-shadow:0 1px 2px rgba(15,23,42,.03)}
      #${SETTINGS_ID} .wb-set-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
      #${SETTINGS_ID} .wb-set-title{font-size:12px;font-weight:800;color:#243247}
      #${SETTINGS_ID} .wb-set-sub{margin-top:2px;color:#7c8ba0;font-size:9.5px;line-height:1.35}
      #${SETTINGS_ID} .wb-set-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
      #${SETTINGS_ID} .wb-set-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:9px;font-weight:800;white-space:nowrap}
      #${SETTINGS_ID} .wb-set-pill:before{content:'';width:6px;height:6px;border-radius:50%;background:#94a3b8}
      #${SETTINGS_ID} .wb-set-pill.ok{background:#ecfdf5;color:#047857}
      #${SETTINGS_ID} .wb-set-pill.ok:before{background:#10b981}
      #${SETTINGS_ID} .wb-set-pill.bad{background:#fff1f2;color:#be123c}
      #${SETTINGS_ID} .wb-set-pill.bad:before{background:#e11d48}
      #${SETTINGS_ID} .wb-ai-meta{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap}
      #${SETTINGS_ID} .wb-token-total{display:inline-flex;align-items:center;height:22px;padding:0 7px;border-radius:999px;background:#fff5f8;color:#7a123d;font:800 8.8px/22px Arial,sans-serif;white-space:nowrap;font-variant-numeric:tabular-nums}
      #${SETTINGS_ID} .wb-key{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px}
      #${SETTINGS_ID} input,#${SETTINGS_ID} select{min-width:0;width:100%;height:34px;border:1px solid #dbe3ec;border-radius:8px;background:#f8fafc;color:#243247;padding:0 9px;font:11px/1.2 Arial,sans-serif;outline:none}
      #${SETTINGS_ID} input:focus,#${SETTINGS_ID} select:focus{border-color:#a50046;box-shadow:0 0 0 2px rgba(165,0,70,.08);background:#fff}
      #${SETTINGS_ID} .wb-btn{height:34px;border:0;border-radius:8px;padding:0 11px;background:#a50046;color:#fff;font:700 10px/34px Arial,sans-serif;cursor:pointer;white-space:nowrap}
      #${SETTINGS_ID} .wb-btn:hover{background:#b80a55}
      #${SETTINGS_ID} .wb-btn.secondary{border:1px solid #dbe3ec;background:#fff;color:#455468}
      #${SETTINGS_ID} .wb-btn.secondary:hover{background:#f8fafc}
      #${SETTINGS_ID} .wb-btn.danger{border:1px solid #fecaca;background:#fff7f7;color:#c24141}
      #${SETTINGS_ID} .wb-btn:disabled{opacity:.55;cursor:wait}
      #${SETTINGS_ID} .wb-ai-grid{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:7px}
      #${SETTINGS_ID} .wb-fallback{margin-top:8px;padding:7px 8px;border-radius:8px;background:#f8fafc;color:#7b8798;font-size:8.8px;line-height:1.4}
      #${SETTINGS_ID} .wb-status{min-height:14px;margin-top:6px;color:#7c8ba0;font-size:8.8px;line-height:1.35}
      #${SETTINGS_ID} .wb-status.ok{color:#047857}
      #${SETTINGS_ID} .wb-status.bad{color:#b42318}
      #${SETTINGS_ID} .wb-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      #${SETTINGS_ID} .wb-action{height:36px;border-radius:8px;border:1px solid #dbe3ec;background:#fff;color:#344256;font:700 10px/1 Arial,sans-serif;cursor:pointer}
      #${SETTINGS_ID} .wb-action.primary{border-color:#a50046;background:#a50046;color:#fff}
      #${SETTINGS_ID} .wb-action.danger{border-color:#fecaca;color:#c24141;background:#fff7f7}
      #${SETTINGS_ID} details{margin:0}
      #${SETTINGS_ID} details summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;color:#7c8ba0;font-size:10px;font-weight:700}
      #${SETTINGS_ID} details summary::-webkit-details-marker{display:none}
      #${SETTINGS_ID} .wb-danger-body{padding-top:9px;color:#8b98a9;font-size:8.8px;line-height:1.45}
      #${SETTINGS_ID} .wb-danger-body .wb-btn{margin-top:7px}
      #${SETTINGS_ID} .wb-foot{text-align:center;color:#a0adbc;font-size:9px;padding:1px 0 2px}
      #${SETTINGS_ID} .switch{flex:0 0 auto}
      #${SETTINGS_ID} .wb-tech-card{padding:7px 9px;border-radius:10px}
      #${SETTINGS_ID} .wb-tech-card .wb-set-row{min-height:30px;gap:8px}
      #${SETTINGS_ID} .wb-tech-card .wb-set-title{font-size:11px}
      #${SETTINGS_ID} .wb-tech-card .wb-set-sub{margin-top:1px;font-size:8.5px;line-height:1.2}
      #${SETTINGS_ID} .wb-tech-card .wb-tech-switch{width:32px!important;height:18px!important;flex:0 0 32px!important;padding:2px!important;border-radius:999px!important}
      #${SETTINGS_ID} .wb-tech-card .wb-tech-switch span{width:12px!important;height:12px!important}
      #${SETTINGS_ID} .wb-tech-card .wb-tech-switch.on span{transform:translateX(14px)!important}
    `;
    root.appendChild(style);
  }

  async function runtime(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service Worker не ответил');
    return response.data || {};
  }

  function isSettingsOpen(root) {
    const active = root.querySelector('.full-nav button.active[data-section="settings"]');
    if (active) return true;
    const head = root.querySelector('.panel .head');
    return /Настройки/i.test(String(head?.textContent || ''));
  }

  function buildHtml(compactOn, engineerOn) {
    return `
      <div id="${SETTINGS_ID}">
        <section class="wb-set-card">
          <div class="wb-set-row">
            <div>
              <div class="wb-set-title">Интерфейс</div>
              <div class="wb-set-sub">Компактная ширина панели Workbench</div>
            </div>
            <button class="switch ${compactOn ? 'on' : ''}" data-action="compact" title="Компактный режим"><span></span></button>
          </div>
        </section>

        <section class="wb-set-card wb-tech-card">
          <div class="wb-set-row">
            <div>
              <div class="wb-set-title">Тех. режим</div>
              <div class="wb-set-sub">Прямой доступ к ожидающим действиям LIVE.</div>
            </div>
            <button class="switch wb-tech-switch ${engineerOn ? 'on' : ''}" data-action="engineer-tools" aria-pressed="${engineerOn ? 'true' : 'false'}" title="Тех. режим"><span></span></button>
          </div>
        </section>

        <section class="wb-set-card">
          <div class="wb-set-head">
            <div>
              <div class="wb-set-title">AI</div>
              <div class="wb-set-sub">Один локальный Groq key для помощника и разбора звонков</div>
            </div>
            <div class="wb-ai-meta">
              <span class="wb-token-total" data-ai-usage title="Суммарный учтённый расход Groq">Σ 0 ток.</span>
              <span class="wb-set-pill" data-ai-badge>Проверка…</span>
            </div>
          </div>
          <div class="wb-key">
            <input data-ai-key type="password" autocomplete="off" spellcheck="false" placeholder="gsk_…">
            <button class="wb-btn" data-ai-save type="button">Сохранить</button>
          </div>
          <div class="wb-ai-grid">
            <select data-ai-model aria-label="Модель AI-помощника">
              ${MODELS.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}
            </select>
            <button class="wb-btn secondary" data-ai-test type="button">Проверить</button>
          </div>
          <div class="wb-fallback"><b>Разбор звонка:</b> Qwen 3.6 27B → GPT-OSS 120B → Qwen 3.8 27B → GPT-OSS 20B</div>
          <div class="wb-status" data-ai-status></div>
          <div style="display:flex;gap:6px;margin-top:7px">
            <button class="wb-btn secondary" data-ai-options type="button">Расширенные настройки</button>
            <button class="wb-btn danger" data-ai-delete type="button">Удалить ключ</button>
          </div>
        </section>

        <section class="wb-set-card">
          <div class="wb-set-head"><div><div class="wb-set-title">Текущий кейс</div><div class="wb-set-sub">Экспорт или очистка только активного контекста</div></div></div>
          <div class="wb-action-grid">
            <button class="wb-action primary" data-action="export">Экспорт JSON</button>
            <button class="wb-action danger" data-action="reset">Очистить кейс</button>
          </div>
        </section>

        <section class="wb-set-card">
          <details>
            <summary><span>Данные Workbench</span><span>опасная зона ▾</span></summary>
            <div class="wb-danger-body">
              Полный сброс удалит Case, CALL evidence/snapshots, AI-сессии, CRM-кэш, локальный Groq key и Audit DB. Cookies и авторизация UserSide/Billing не затрагиваются.
              <br><button class="wb-btn danger" data-action="clear-workbench-data" type="button">Полный сброс WB</button>
            </div>
          </details>
        </section>

        <div class="wb-foot">SIMNET Workbench ${esc(chrome.runtime.getManifest().version)}</div>
      </div>`;
  }

  function applyUsage(container, usage = {}) {
    const node = container?.querySelector?.('[data-ai-usage]');
    if (!node) return;
    const total = Math.max(0, Number(usage?.totalTokens || 0));
    const prompt = Math.max(0, Number(usage?.promptTokens || 0));
    const completion = Math.max(0, Number(usage?.completionTokens || 0));
    const requests = Math.max(0, Number(usage?.requests || 0));
    node.textContent = `Σ ${tokenNumber(total)} ток.`;
    node.title = `Учтённый расход Groq · input ${tokenNumber(prompt)} · output ${tokenNumber(completion)} · запросов ${tokenNumber(requests)}`;
  }

  async function hydrate(container) {
    const badge = container.querySelector('[data-ai-badge]');
    const status = container.querySelector('[data-ai-status]');
    const keyInput = container.querySelector('[data-ai-key]');
    const modelSelect = container.querySelector('[data-ai-model]');
    try {
      const cfg = await runtime('AI_RUNTIME_GET');
      if (!container.isConnected) return;
      badge.textContent = cfg.configured ? 'Подключён' : 'Не настроен';
      badge.className = `wb-set-pill ${cfg.configured ? 'ok' : ''}`;
      keyInput.placeholder = cfg.configured ? `Ключ сохранён ${cfg.keyHint || ''}` : 'gsk_…';
      if (MODELS.some(([id]) => id === cfg.chatModel)) modelSelect.value = cfg.chatModel;
      applyUsage(container, cfg.usage || {});
      status.textContent = cfg.configured
        ? 'Ключ хранится только локально в этом Chrome-профиле.'
        : 'Whisper работает без ключа; AI-разбор без него остановится на TXT.';
      status.className = `wb-status ${cfg.configured ? 'ok' : ''}`;
    } catch (error) {
      badge.textContent = 'SW недоступен';
      badge.className = 'wb-set-pill bad';
      status.textContent = String(error?.message || error || 'Ошибка');
      status.className = 'wb-status bad';
    }
  }

  function bind(container) {
    const badge = container.querySelector('[data-ai-badge]');
    const status = container.querySelector('[data-ai-status]');
    const keyInput = container.querySelector('[data-ai-key]');
    const save = container.querySelector('[data-ai-save]');
    const test = container.querySelector('[data-ai-test]');
    const del = container.querySelector('[data-ai-delete]');
    const model = container.querySelector('[data-ai-model]');
    const options = container.querySelector('[data-ai-options]');

    save?.addEventListener('click', async event => {
      event.stopPropagation();
      const apiKey = String(keyInput?.value || '').trim();
      if (!apiKey) {
        status.textContent = 'Вставь Groq API key.';
        status.className = 'wb-status bad';
        return;
      }
      save.disabled = true;
      try {
        const cfg = await runtime('AI_RUNTIME_SAVE', { groqApiKey: apiKey });
        keyInput.value = '';
        keyInput.placeholder = `Ключ сохранён ${cfg.keyHint || ''}`;
        badge.textContent = 'Подключён';
        badge.className = 'wb-set-pill ok';
        status.textContent = 'Сохранено локально. Можно нажать «Проверить».';
        status.className = 'wb-status ok';
      } catch (error) {
        status.textContent = String(error?.message || error || 'Ошибка сохранения');
        status.className = 'wb-status bad';
      } finally {
        save.disabled = false;
      }
    });

    test?.addEventListener('click', async event => {
      event.stopPropagation();
      test.disabled = true;
      status.textContent = 'Проверяю Groq…';
      status.className = 'wb-status';
      try {
        const result = await runtime('AI_RUNTIME_TEST', { groqApiKey: String(keyInput?.value || '').trim() });
        badge.textContent = 'Подключён';
        badge.className = 'wb-set-pill ok';
        status.textContent = `Groq отвечает · fallback-моделей доступно ${Number(result.availableCount || 0)}/${Number(result.expectedCount || MODELS.length)}.`;
        status.className = 'wb-status ok';
      } catch (error) {
        badge.textContent = 'Ошибка';
        badge.className = 'wb-set-pill bad';
        status.textContent = String(error?.message || error || 'Ошибка проверки');
        status.className = 'wb-status bad';
      } finally {
        test.disabled = false;
      }
    });

    model?.addEventListener('change', async event => {
      event.stopPropagation();
      try {
        await runtime('AI_RUNTIME_SAVE', { chatModel: model.value });
        status.textContent = `Модель помощника: ${model.options[model.selectedIndex]?.textContent || model.value}.`;
        status.className = 'wb-status ok';
      } catch (error) {
        status.textContent = String(error?.message || error || 'Ошибка сохранения модели');
        status.className = 'wb-status bad';
      }
    });

    del?.addEventListener('click', async event => {
      event.stopPropagation();
      if (!confirm('Удалить локальный Groq API key из этого Chrome-профиля?')) return;
      try {
        await runtime('AI_RUNTIME_DELETE_KEY');
        badge.textContent = 'Не настроен';
        badge.className = 'wb-set-pill';
        keyInput.value = '';
        keyInput.placeholder = 'gsk_…';
        status.textContent = 'Ключ удалён.';
        status.className = 'wb-status';
      } catch (error) {
        status.textContent = String(error?.message || error || 'Ошибка удаления');
        status.className = 'wb-status bad';
      }
    });

    options?.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      options.disabled = true;
      try {
        await runtime('AI_RUNTIME_OPEN_SETTINGS');
      } catch (error) {
        status.textContent = String(error?.message || error || 'Не удалось открыть настройки AI');
        status.className = 'wb-status bad';
      } finally {
        options.disabled = false;
      }
    });
  }

  function upgrade(root) {
    if (!root || !isSettingsOpen(root)) return;
    const body = root.querySelector('.panel .body');
    if (!body || body.querySelector(`#${SETTINGS_ID}`)) return;

    installStyle(root);
    const compactOn = Boolean(body.querySelector('button[data-action="compact"]')?.classList.contains('on'));
    const engineerOn = Boolean(globalThis.SIMNET_WB?.engineerTools?.enabled?.());
    const nav = body.querySelector('.full-nav');
    const navHtml = nav?.outerHTML || '';
    body.innerHTML = `${navHtml}${buildHtml(compactOn, engineerOn)}`;
    const container = body.querySelector(`#${SETTINGS_ID}`);
    if (!container) return;
    bind(container);
    void hydrate(container);
  }

  function attach(host) {
    const root = host?.shadowRoot;
    if (!root) return false;
    attachedRoot = root;
    rootObserver?.disconnect();
    rootObserver = new MutationObserver(() => upgrade(root));
    rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    upgrade(root);
    return true;
  }

  function discover() {
    const host = document.getElementById(HOST_ID);
    if (host?.shadowRoot && attach(host)) {
      documentObserver?.disconnect();
      documentObserver = null;
      return;
    }
    if (documentObserver) return;
    documentObserver = new MutationObserver(discover);
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[AI_USAGE_LEDGER_KEY]) return;
    const container = attachedRoot?.querySelector?.(`#${SETTINGS_ID}`);
    if (container?.isConnected) void hydrate(container);
  });

  discover();
})();