(() => {
  'use strict';

  const ROOT_ID = 'aiLabExperiment';
  const UPGRADED_ATTR = 'data-behavior-v2';
  const LEVELS = Object.freeze([1, 2, 3, 4, 5]);
  const INITIATIVE_TO_LEGACY = Object.freeze({ 1: 20, 2: 35, 3: 50, 4: 65, 5: 80 });
  const DEPTH_TO_BREVITY = Object.freeze({ 1: 90, 2: 75, 3: 60, 4: 45, 5: 30 });

  let latestBehavior = null;
  let saveTimer = null;

  function clampLevel(value, fallback = 3) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(5, Math.round(numeric))) : fallback;
  }

  function levelFromRange(value, points, fallback = 3) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    let best = fallback;
    let distance = Infinity;
    for (const [level, point] of Object.entries(points)) {
      const next = Math.abs(numeric - Number(point));
      if (next < distance) {
        distance = next;
        best = Number(level);
      }
    }
    return clampLevel(best, fallback);
  }

  function viewModel(behavior = {}) {
    const humanLikeness = levelFromRange(behavior.confidenceStyle, { 1: 35, 2: 45, 3: 55, 4: 65, 5: 75 }, 3);
    const depth = levelFromRange(behavior.brevity, DEPTH_TO_BREVITY, 3);
    const initiative = levelFromRange(behavior.initiative, INITIATIVE_TO_LEGACY, 3);
    return { humanLikeness, depth, initiative };
  }

  function legacyBehavior(levels = {}, current = {}) {
    const human = clampLevel(levels.humanLikeness);
    const depth = clampLevel(levels.depth);
    const initiative = clampLevel(levels.initiative);
    return {
      ...current,
      confidenceStyle: { 1: 35, 2: 45, 3: 55, 4: 65, 5: 75 }[human],
      curiosity: { 1: 45, 2: 50, 3: 55, 4: 60, 5: 65 }[human],
      // Truthfulness is not a style knob. Keep skepticism high and stable.
      skepticism: Math.max(70, Number(current.skepticism || 75)),
      brevity: DEPTH_TO_BREVITY[depth],
      maxFollowUpQuestions: depth <= 2 ? 1 : depth >= 5 ? 3 : 2,
      initiative: INITIATIVE_TO_LEGACY[initiative]
    };
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
    const levels = viewModel(behavior);
    for (const [key, value] of Object.entries(levels)) {
      const input = container.querySelector(`[data-behavior-v2-key="${key}"]`);
      const output = container.querySelector(`[data-behavior-v2-output="${key}"]`);
      if (input) input.value = String(value);
      if (output) output.textContent = String(value);
    }
  }

  async function save(container) {
    const behavior = legacyBehavior(levelsFrom(container), latestBehavior || {});
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
})();
