// Both hosts mount the same view and UI controllers. The AI runtime stays in
// src/background-entry.js; this module never creates state, facts or tools.
export const LAB_UI_MODULES = Object.freeze([
  './ai-operator-lab.js',
  './ai-operator-behavior-v2.js',
  './ai-operator-lab-trace.js',
  './ai-operator-batch.js',
  './ai-operator-replay.js',
  './ai-operator-scenario-replay.js',
  './ai-operator-lab-workspace.js',
  './settings-accordion.js'
]);

const mounts = new WeakMap();

export function mountAiOperatorLab(host, {
  fetchView = globalThis.fetch,
  loadModule = path => import(path)
} = {}) {
  if (!host) return Promise.reject(new Error('AI Operator Lab: отсутствует UI host.'));
  if (mounts.has(host)) return mounts.get(host);

  const mounted = (async () => {
    const response = await fetchView(new URL('./ai-operator-lab-view.html', import.meta.url));
    if (!response.ok) throw new Error(`AI Operator Lab: view недоступен (${response.status}).`);
    const template = host.ownerDocument.createElement('template');
    template.innerHTML = await response.text();
    const panel = template.content.querySelector('[data-accordion-panel="lab"]');
    if (!panel || !template.content.querySelector('#aiLabInput')) {
      throw new Error('AI Operator Lab: неполная разметка view.');
    }
    if (host.dataset.aiLabHost === 'standalone') {
      // Settings may have persisted an open API/model panel. It must not hide
      // the standalone Lab; its inner Lab accordion still uses the same state.
      panel.removeAttribute('data-accordion-group');
      panel.open = true;
    }
    host.replaceChildren(template.content);
    // Order matters: mount the dialog before its enhancers, and Scenario Replay
    // before the accordion takes its initial inventory of panels.
    for (const module of LAB_UI_MODULES) await loadModule(module);
    host.dataset.aiLabReady = 'true';
    host.setAttribute('aria-busy', 'false');
    return host;
  })();
  mounts.set(host, mounted);
  return mounted;
}

const host = globalThis.document?.querySelector('[data-ai-lab-host]');
if (host) void mountAiOperatorLab(host).catch(error => {
  const status = host.ownerDocument.createElement('p');
  status.className = 'status bad';
  status.textContent = String(error?.message || 'AI Operator Lab: ошибка загрузки.');
  host.prepend(status);
  host.setAttribute('aria-busy', 'false');
  console.error('[AI Lab host]', error);
});
