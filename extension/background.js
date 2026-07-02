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

    // Ensure body is a string — callers in popup.js already JSON.stringify, but
    // guard here in case a caller ever passes a raw object/array.
    let fetchBody = body || undefined;
    if (fetchBody !== undefined && typeof fetchBody !== 'string') {
      console.warn('[Path4ABA] FETCH: body was not a string — stringifying now. type:', typeof fetchBody);
      fetchBody = JSON.stringify(fetchBody);
    }

    // Ensure Content-Type is present for requests with a body.
    const fetchHeaders = { ...headers };
    if (fetchBody !== undefined && !fetchHeaders['Content-Type'] && !fetchHeaders['content-type']) {
      fetchHeaders['Content-Type'] = 'application/json';
    }

    console.log('[Path4ABA] FETCH starting:', method, url,
      '| body type:', typeof fetchBody,
      '| body preview:', fetchBody ? String(fetchBody).slice(0, 200) : '(none)');

    // Ping chrome.storage.local every 5 s so the service worker is not garbage-
    // collected while awaiting a slow network response from path4aba.app.
    const keepAlive = setInterval(() => chrome.storage.local.get('__keepalive__'), 5000);

    fetch(url, {
      method,
      headers: fetchHeaders,
      body: fetchBody,
      credentials: credentials || 'omit',
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

// ── ABA Matrix: inject the autofill script on demand, then fill ──────────────
// Routed through the background service worker (not the popup) so it works from
// detached popup windows, where the popup's own chrome.tabs/chrome.scripting
// context is scoped to the popup window rather than the browser window holding
// the ABA Matrix tab. The injected script's __abaMatrixLoaded guard makes repeat
// injections safe (no duplicate onMessage listeners).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'injectAndFillABAMatrix') {
    chrome.tabs.query({ active: true }, (tabs) => {
      const abaTab = tabs.find(t => t.url?.includes('app.abamatrix.com/session'));
      if (!abaTab) {
        sendResponse({ ok: false, error: 'ABA Matrix tab not found' });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: abaTab.id },
        files: ['abamatrix-autofill.js']
      }, () => {
        setTimeout(() => {
          chrome.tabs.sendMessage(abaTab.id, { action: 'fillABAMatrix', data: message.data }, (response) => {
            sendResponse({ ok: true, response });
          });
        }, 500);
      });
    });
    return true; // Keep channel open for async response
  }

  if (message.action === 'getABAMatrixAnswers') {
    // Fetch AI answers from path4aba.app with the stored Bearer token. Runs in the
    // background (not the content script) so it's exempt from CORS, and can read the
    // token from chrome.storage. NOTE: the storage key is `extensionToken` (set by the
    // popup at login) — not `authToken`. Callback-form storage.get keeps this listener
    // synchronous so `return true` reliably holds the channel open.
    chrome.storage.local.get(['extensionToken'], (stored) => {
      const token = stored.extensionToken;
      if (!token) { sendResponse({ error: 'Not authenticated' }); return; }
      fetch('https://path4aba.app/api/extension/fill-aba-matrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ note: message.note, questions: message.questions }),
      })
        .then(r => r.json())
        .then(data => sendResponse({ answers: data.answers || {} }))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true; // keep channel open for async sendResponse
  }
});
