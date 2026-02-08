/**
 * Minimal MV3 service worker
 * Required for extension lifecycle and future features
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[A11Y] Extension installed');
});

/**
 * Optional: keyboard shortcut support
 */
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'run-scan') {
    console.log('[A11Y] Run scan command triggered');
  }
});