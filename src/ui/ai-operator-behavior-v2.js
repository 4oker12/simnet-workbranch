(async () => {
  'use strict';

  const { normalizeBehaviorProfile } = await import(
    chrome.runtime.getURL('src/features/ai-operator/behavior-profile.js')
  );

  const ROOT_ID = 'aiLabExperiment';
  const UPGRADED_ATTR = 'data-behavior-v2';

  let latestBehavior = null;
  let saveTimer = null;

  function clampLevel(value, fallback = 3) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(5, Math.round(numeric))) : fallback;
  }

  async function runtime(type, payload = undefined) {
    const response = await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
    if (!response?.success) throw new Error(response?.error || 'AI Lab runtime did not return success');
    return response.data || {};
  }

  function create(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function row(key, label, help) {
    const wrap = create('label', 'ai-lab-slider');
    wrap.title = help;
    const labelNode = create('span', 'ai-lab-slider-label');
    labelNode.append(create('b', '', label), create('small', '', help));
    const range = create('input');
    range.type = 'range';
    range.min = '1';
    range.max = '5';
    range.step = '1';
    range.value = '3';
    range.dataset.behaviorV2Key = key;
    const output = create('output', 'ai-lab-slider-value', '3');
    output.dataset.behaviorV2Output = key;
    wrap.append(labelNode, range, output);
    return wrap;
  }

  function levelsFrom(container) {
    const result = {};
    container.querySelectorAll('[data-behavior-v2-key]').forEach(input => {
      result[input.dataset.behaviorV2Key] = clampLevel(input.value);
    });
    return result;
  }

  function renderLevels(container, behavior = {}) {
    const levels = normalizeBehaviorProfile(behavior);
    for (const [key, value] of Object.entries(levels)) {
      const input = container.querySelector(`[data-behavior-v2-key="${key}"]`);
      const output = container.querySelector(`[data-behavior-v2-output="${key}"]`);
      if (input) input.value = String(value);
      if (output) output.textContent = String(value);
    }
  }

  async function save(container) {
    const behavior = normalizeBehaviorProfile(levelsFrom(container));
    latestBehavior = behavior;
    try {
      const state = await runtime('AI_OPERATOR_LAB_CONFIG', { behavior });
      latestBehavior = state?.behavior || behavior;
      renderLevels(container, latestBehavior);
    } catch (error) {
      console.warn('[AI Lab behavior v2]', error);
    }
  }

  function scheduleSave(container) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(container), 120);
  }

  async function upgrade() {
    const root = document.getElementById(ROOT_ID);
    const sliders = root?.querySelector?.('.ai-lab-sliders');
    if (!sliders || sliders.hasAttribute(UPGRADED_ATTR)) return;

    sliders.setAttribute(UPGRADED_ATTR, '1');
    sliders.replaceChildren(
      row('humanLikeness', 'Человекоподобность', '1 — сухо и формально; 5 — максимально естественно, как живой оператор. На достоверность фактов не влияет.'),
      row('depth', 'Полезная развернутость', '1 — только необходимый минимум; 5 — подробнее объяснять причины, связи и следующий полезный контекст.'),
      row('initiative', 'Инициативность', '1 — отвечать только на поставленный вопрос; 5 — чаще предлагать уместный следующий шаг после прямого ответа.')
    );

    sliders.addEventListener('input', event => {
      const input = event.target?.closest?.('[data-behavior-v2-key]');
      if (!input) return;
      const output = sliders.querySelector(`[data-behavior-v2-output="${input.dataset.behaviorV2Key}"]`);
      if (output) output.textContent = String(clampLevel(input.value));
    });
    sliders.addEventListener('change', event => {
      if (!event.target?.closest?.('[data-behavior-v2-key]')) return;
      scheduleSave(sliders);
    });

    try {
      const state = await runtime('AI_OPERATOR_LAB_GET');
      latestBehavior = state?.behavior || {};
      renderLevels(sliders, latestBehavior);
    } catch (error) {
      console.warn('[AI Lab behavior v2]', error);
    }
  }

  const observer = new MutationObserver(() => void upgrade());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  void upgrade();
})().catch(error => console.warn('[AI Lab behavior v2]', error));
