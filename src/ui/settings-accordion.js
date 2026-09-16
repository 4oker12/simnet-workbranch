(() => {
  const STORAGE_KEY = 'simnet_settings_accordion_v1';
  const panels = [...document.querySelectorAll('details[data-accordion-group][data-accordion-panel]')];
  if (!panels.length) return;

  let stored = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    stored = {};
  }

  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch {}
  };

  const groups = new Map();
  for (const panel of panels) {
    const group = String(panel.dataset.accordionGroup || 'settings');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(panel);
  }

  let initializing = true;
  for (const [group, groupPanels] of groups) {
    const fallback = groupPanels.find(panel => panel.dataset.accordionDefault === 'true')?.dataset.accordionPanel || '';
    const wanted = Object.prototype.hasOwnProperty.call(stored, group) ? String(stored[group] || '') : fallback;
    for (const panel of groupPanels) {
      panel.open = Boolean(wanted) && panel.dataset.accordionPanel === wanted;
    }
  }
  initializing = false;

  for (const panel of panels) {
    panel.addEventListener('toggle', () => {
      if (initializing) return;
      const group = String(panel.dataset.accordionGroup || 'settings');
      const key = String(panel.dataset.accordionPanel || '');
      const groupPanels = groups.get(group) || [];

      if (panel.open) {
        for (const sibling of groupPanels) {
          if (sibling !== panel && sibling.open) sibling.open = false;
        }
        stored[group] = key;
      } else if (stored[group] === key) {
        stored[group] = '';
      }
      save();
    });
  }
})();