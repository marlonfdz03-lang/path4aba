// Path4ABA Extension — background.js (service worker)
// This file intentionally minimal. All API calls are made directly from popup.js.
// The service worker keeps the extension alive for chrome.storage access.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Path4ABA] Extension installed.');
});

// Keep service worker alive during active use
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ ok: true });
  }
  return false;
});
