(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const base = WB?.taskCurrentLiveRecovery;
  if (!WB || !base?.debug || WB.__taskSpecialInfoDebugAugmentLoaded) return;
  WB.__taskSpecialInfoDebugAugmentLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const compact = (value, max = 6000) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };
  const fold = value => compact(value, 6000).toLowerCase().replace(/\s+/g, ' ').trim();

  function containerBuildingUuid(root) {
    for (const script of Array.from(root?.querySelectorAll?.('script') || []).reverse()) {
      const match = String(script.textContent || '').match(/lastBuildingSelectorValue\s*\[\s*["']task_address["']\s*\]\s*=\s*["']([0-9a-f-]{36})["']/i);
      if (match && UUID_RE.test(match[1])) return match[1];
    }
    return '';
  }

  function workDescriptionRow(expectedBuildingUuid = '') {
    const container = document.querySelector('#buildingWorkDescriptionId');
    if (!container) return null;

    const containerUuid = containerBuildingUuid(container);
    if (UUID_RE.test(expectedBuildingUuid)) {
      if (!UUID_RE.test(containerUuid) || containerUuid !== expectedBuildingUuid) return null;
    }

    const clone = container.cloneNode(true);
    clone.querySelectorAll?.('script,style,#buildingTimeIntervalId').forEach(node => node.remove());
    const text = compact(clone.textContent || '', 6000);
    if (fold(text).length < 4) return null;
    return { key: 'buildingWorkDescriptionId', label: 'Информация по дому', text };
  }

  function mergeRows(rows = [], extra = null) {
    const out = [];
    const seen = new Set();
    for (const row of [...(Array.isArray(rows) ? rows : []), ...(extra ? [extra] : [])]) {
      const key = fold(row?.text || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  async function debug(form = null) {
    const result = await base.debug(form);
    if (!result) return result;
    const expected = UUID_RE.test(result.resolvedBuildingUuid) ? result.resolvedBuildingUuid
      : UUID_RE.test(result.directBuildingUuid) ? result.directBuildingUuid
        : '';
    const rows = mergeRows(result.noteRows, workDescriptionRow(expected));
    let actionableItems = result.actionableItems;
    try {
      if (WB.taskSpecialPolicyV3?.interpretRows) {
        actionableItems = WB.taskSpecialPolicyV3.interpretRows(rows, {
          address: result.address || '',
          taskTypeLabel: ''
        });
      }
    } catch {}
    return { ...result, noteRows: rows, actionableItems };
  }

  try {
    WB.taskCurrentLiveRecovery = Object.freeze({
      ...base,
      debug,
      specialInfoDebugAugmentVersion: 1
    });
  } catch {}
})();