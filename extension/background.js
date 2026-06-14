// Path4ABA Extension — background.js (service worker)
// All API calls are proxied through here so fetch() works from detached popup windows.

console.log('[Path4ABA] background.js loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Path4ABA] Extension installed.');
});

// Registering onConnect at the top level ensures the service worker is woken
// and kept alive when detached popup windows open a port connection.
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Path4ABA] onConnect:', port.name);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH') {
    console.log('[Path4ABA] FETCH received:', message.payload?.method, message.payload?.url);
    const { url, method, headers, body, credentials } = message.payload;
    console.log('[Path4ABA] FETCH starting:', method, url);

    // Ping chrome.storage.local every 5 s so the service worker is not garbage-
    // collected while awaiting a slow network response from path4aba.app.
    const keepAlive = setInterval(() => chrome.storage.local.get('__keepalive__'), 5000);

    fetch(url, {
      method,
      headers,
      body: body || undefined,
      credentials: credentials || 'omit',
      keepalive: true,
    })
      .then(async (res) => {
        console.log('[Path4ABA] FETCH complete:', res.ok, res.status);
        const data = await res.text();
        console.log('[Path4ABA] sendResponse called, data.length:', data.length);
        sendResponse({ ok: res.ok, status: res.status, data });
      })
      .catch((err) => {
        console.error('[Path4ABA] FETCH error:', err);
        sendResponse({ ok: false, status: 0, error: err.message });
      })
      .finally(() => {
        clearInterval(keepAlive);
      });
    return true; // keep channel open for async sendResponse
  }
});
