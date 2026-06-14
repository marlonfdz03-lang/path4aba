// Path4ABA Extension — background.js (service worker)
// All API calls are proxied through here so fetch() works from detached popup windows.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Path4ABA] Extension installed.');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH') {
    const { url, method, headers, body, credentials } = message.payload;
    fetch(url, {
      method,
      headers,
      body: body || undefined,
      credentials: credentials || 'omit',
    })
      .then(async (res) => {
        const data = await res.text();
        sendResponse({ ok: res.ok, status: res.status, data });
      })
      .catch((err) => {
        sendResponse({ ok: false, status: 0, error: err.message });
      });
    return true; // keep channel open for async sendResponse
  }
});
