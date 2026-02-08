/**
 * MV3 service worker
 * Acts as the single source of truth for scan results
 */

console.log('[A11Y] Service worker started');

const resultsByTab = new Map();

/* ---------------- Lifecycle ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[A11Y] Extension installed');
});

/* ---------------- Commands ---------------- */

chrome.commands?.onCommand.addListener((command) => {
  if (command === 'run-scan') {
    console.log('[A11Y] Run scan command triggered');
  }
});

/* ---------------- Messaging (CRITICAL) ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return;

  // 🔹 Restore results for active tab
  if (msg.type === 'GET_A11Y_RESULTS') {
    sendResponse({
      results: resultsByTab.get(msg.key) || null
    });
    return true; // keep channel alive
  }

  // 🔹 Save results after scan
  if (msg.type === 'SAVE_A11Y_RESULTS') {
    resultsByTab.set(msg.key, msg.results);
    sendResponse({ ok: true });
    return true;
  }
});

/* ---------------- Cleanup on navigation ---------------- */

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    for (const key of resultsByTab.keys()) {
      if (key.startsWith(`${tabId}:`)) {
        resultsByTab.delete(key);
      }
    }
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  for (const key of resultsByTab.keys()) {
    if (key.startsWith(`${tabId}:`)) {
      resultsByTab.delete(key);
    }
  }
});