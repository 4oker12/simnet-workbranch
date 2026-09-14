const hosts = new Set(['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua', 'userside.simnet.kiev.ua', 'pbx.simnet.kiev.ua']);
let cached = null;
let cachedAt = 0;
export async function tabInventory() {
  if (cached && Date.now() - cachedAt < 4000) return cached;
  const tabs = await chrome.tabs.query({});
  const working = tabs.flatMap(tab => {
    try {
      const host = new URL(tab.url).hostname;
      return hosts.has(host) ? [{ tabId: tab.id, host, selected: Boolean(tab.active), discarded: Boolean(tab.discarded) }] : [];
    } catch { return []; }
  });
  cachedAt = Date.now();
  return cached = { at: new Date(cachedAt).toISOString(), total: tabs.length, working: working.length,
    background: working.filter(tab => !tab.selected).length,
    discarded: working.filter(tab => tab.discarded).length, tabs: working };
}

export function tabLoadReport(samples = [], inventory = null) {
  const rows = new Map();
  const buckets = new Map();
  for (const sample of [...samples].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    if (sample.tabId == null) continue;
    const row = rows.get(sample.tabId) || { tabId: sample.tabId, sampleCount: 0, requests: 0, hiddenRequests: 0,
      longTasks: 0, hiddenLongTasks: 0, longTaskMs: 0, visibleMs: 0, hiddenMs: 0, activations: 0,
      heapBytes: null, peakHeapBytes: null, maxEventLoopDelayMs: null, activationFrameMaxMs: null };
    row.sampleCount++;
    row.at = sample.at;
    row.route = sample.page?.route || '';
    row.requests += sample.resources?.count || 0;
    row.longTasks += sample.longTasks?.count || 0;
    row.longTaskMs += sample.longTasks?.totalDurationMs || 0;
    for (const key of ['hiddenRequests', 'hiddenLongTasks', 'visibleMs', 'hiddenMs', 'activations']) row[key] += sample.activity?.[key] || 0;
    if (sample.memory?.usedJsHeapBytes != null) {
      row.heapBytes = sample.memory.usedJsHeapBytes;
      row.peakHeapBytes = Math.max(row.peakHeapBytes || 0, row.heapBytes);
    }
    if (sample.eventLoopDelayMs != null) row.maxEventLoopDelayMs = Math.max(row.maxEventLoopDelayMs || 0, sample.eventLoopDelayMs);
    const activation = sample.metrics?.find(metric => metric.metric === 'tab.activation_frame');
    if (activation) row.activationFrameMaxMs = Math.max(row.activationFrameMaxMs || 0, activation.maxDurationMs);
    rows.set(sample.tabId, row);
    if (sample.tabCounts?.total != null) {
      const key = `${sample.tabCounts.total}/${sample.tabCounts.working}`;
      const bucket = buckets.get(key) || { totalTabs: sample.tabCounts.total, workingTabs: sample.tabCounts.working,
        samples: 0, pageLoads: 0, totalLoadMs: 0, eventLoopSamples: 0, totalEventLoopMs: 0 };
      bucket.samples++;
      if (sample.navigation?.loadMs != null && !sample.navigation.startedBeforeSession) { bucket.pageLoads++; bucket.totalLoadMs += sample.navigation.loadMs; }
      if (sample.eventLoopDelayMs != null) { bucket.eventLoopSamples++; bucket.totalEventLoopMs += sample.eventLoopDelayMs; }
      buckets.set(key, bucket);
    }
  }
  for (const tab of inventory?.tabs || []) rows.set(tab.tabId, { ...(rows.get(tab.tabId) || { tabId: tab.tabId, sampleCount: 0 }), ...tab, open: true });
  return { inventory, scope: 'retained-samples', memoryScope: 'approximate JS heap; renderer may be shared; do not sum',
    backgroundAttribution: 'visibility at observer delivery; background timers may be throttled',
    tabs: [...rows.values()].map(row => ({ ...row, open: inventory ? row.open === true : null })),
    byTabCount: [...buckets.values()].map(row => ({ ...row,
      averageLoadMs: row.pageLoads ? row.totalLoadMs / row.pageLoads : null,
      averageEventLoopMs: row.eventLoopSamples ? row.totalEventLoopMs / row.eventLoopSamples : null })) };
}
