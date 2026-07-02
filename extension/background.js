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

  // ── Phase 2 ClinicalExtractor: fetch structured ClinicalFacts from a session note ──
  // Same CORS-exempt Bearer proxy as getABAMatrixAnswers: runs in the background (not the
  // content script) so it's exempt from CORS and can read the token from chrome.storage.
  // Called ONCE per session.
  if (message.action === 'getClinicalFacts') {
    chrome.storage.local.get(['extensionToken'], (stored) => {
      const token = stored.extensionToken;
      if (!token) { sendResponse({ error: 'Not authenticated' }); return; }
      fetch('https://path4aba.app/api/extension/extract-facts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          note: message.note,
          behaviors: message.behaviors,
          skills: message.skills,
          caregivers: message.caregivers,
          clientName: message.clientName,
        }),
      })
        .then(r => r.json())
        .then(data => sendResponse({ facts: data.facts || null, error: data.error }))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true; // keep channel open for async sendResponse
  }

  // ── DEV (Phase 1 calibration): inject the Form Engine on demand, then debug ──
  // Injects the engine modules into the target tab's MAIN world (so
  // window.debugFormEngine is reachable) and runs it immediately. This is an
  // ADDITIONAL path — it coexists with the content_scripts loading strategy; the
  // modules' idempotency guards make the double-injection a harmless no-op. The
  // NormalizedForm is logged in the TARGET TAB's console, not here.
  if (message.action === 'injectFormEngine') {
    console.log('[Path4ABA Debug] injectFormEngine received, tabId:', message.tabId);
    try {
      const engineFiles = [
        'engine/adapters/ABAMatrixAdapter.js',
        'engine/core/scanner.js',
        'engine/core/normalizer.js',
        'engine/debug.js',
      ];

      const runDebug = (tabId) => {
        if (!tabId) {
          console.error('[Path4ABA Debug] No target tab id');
          sendResponse({ ok: false, error: 'No target tab' });
          return;
        }
        chrome.scripting.executeScript(
          { target: { tabId }, files: engineFiles, world: 'MAIN' },
          () => {
            if (chrome.runtime.lastError) {
              console.error('[Path4ABA Debug] inject files error:', chrome.runtime.lastError.message);
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            console.log('[Path4ABA Debug] Scripts injected');
            // Second call MUST also target MAIN world, or it won't see window.debugFormEngine.
            chrome.scripting.executeScript(
              {
                target: { tabId },
                world: 'MAIN',
                func: () => (typeof window.debugFormEngine === 'function' ? !!window.debugFormEngine() : false),
              },
              (results) => {
                if (chrome.runtime.lastError) {
                  console.error('[Path4ABA Debug] run debugFormEngine error:', chrome.runtime.lastError.message);
                  sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                  return;
                }
                console.log('[Path4ABA Debug] debugFormEngine called');
                sendResponse({ ok: true, ran: results && results[0] ? results[0].result : null });
              }
            );
          }
        );
      };

      if (message.tabId) {
        runDebug(message.tabId);
      } else {
        // Fallback: locate the ABA Matrix tab when no tabId was passed.
        chrome.tabs.query({ active: true }, (tabs) => {
          const tab = (tabs || []).find(t => t.url && t.url.includes('app.abamatrix.com')) || (tabs || [])[0];
          console.log('[Path4ABA Debug] Fallback resolved tabId:', tab && tab.id);
          runDebug(tab && tab.id);
        });
      }
    } catch (err) {
      console.error('[Path4ABA Debug] injectFormEngine error:', err);
      sendResponse({ ok: false, error: err.message });
    }
    return true; // keep channel open for async sendResponse
  }

  // ── Phase 2 live test: run the Form Agent (ClinicalExtractor) in the ABA Matrix tab ──
  // form-agent.js is a declared content script in the ISOLATED world, so window.runFormAgent
  // lives there. executeScript with a func and NO `world` runs in that same ISOLATED world,
  // so it sees runFormAgent (which needs chrome.runtime for the extract-facts proxy).
  if (message.action === 'runFormAgent') {
    chrome.tabs.query({ active: true }, (tabs) => {
      const abaTab = (tabs || []).find(t => t.url && t.url.includes('app.abamatrix.com')) || (tabs || [])[0];
      if (!abaTab) { sendResponse({ ok: false, error: 'ABA Matrix tab not found' }); return; }
      // Ensure form-agent.js is present (idempotent — it overwrites, no guard), then run it.
      chrome.scripting.executeScript(
        { target: { tabId: abaTab.id }, files: ['form-agent.js'] },
        () => {
          if (chrome.runtime.lastError) { sendResponse({ ok: false, error: chrome.runtime.lastError.message }); return; }
          chrome.scripting.executeScript(
            {
              target: { tabId: abaTab.id },
              func: (noteData) => {
                if (typeof window.runFormAgent === 'function') { window.runFormAgent(noteData); return true; }
                return false;
              },
              args: [message.noteData],
              // default world = ISOLATED (same world as the form-agent.js content script)
            },
            (results) => {
              if (chrome.runtime.lastError) { sendResponse({ ok: false, error: chrome.runtime.lastError.message }); return; }
              const ran = results && results[0] ? results[0].result : false;
              sendResponse({ ok: ran !== false, ran });
            }
          );
        }
      );
    });
    return true; // keep channel open for async sendResponse
  }

  // ── Phase 4 prep: expand the form — add one Behavior/Goal section per extracted fact ──
  // Runs in the MAIN world (button clicks drive the Angular app). Must run BEFORE getFormSchema
  // so the scan sees the newly-rendered sections and their fields.
  if (message.action === 'expandFormSections') {
    chrome.tabs.query({ active: true }, (tabs) => {
      const abaTab = (tabs || []).find(t => t.url && t.url.includes('app.abamatrix.com')) || (tabs || [])[0];
      if (!abaTab) { sendResponse({ error: 'ABA Matrix tab not found' }); return; }
      chrome.scripting.executeScript(
        {
          target: { tabId: abaTab.id },
          world: 'MAIN',
          func: async (behaviorsCount, skillsCount) => {
            async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

            // Click Add Behavior Reduction button N times
            for (let i = 0; i < behaviorsCount; i++) {
              const addBtns = Array.from(document.querySelectorAll('button'))
                .filter(b => b.innerText?.trim().includes('Add Behavior') && b.offsetParent !== null);
              if (addBtns.length > 0) {
                addBtns[0].click();
                await wait(800);
              }
            }

            // Click Add Goal Implementation button N times
            for (let i = 0; i < skillsCount; i++) {
              const addBtns = Array.from(document.querySelectorAll('button'))
                .filter(b => b.innerText?.trim().includes('Add Goal') && b.offsetParent !== null);
              if (addBtns.length > 0) {
                addBtns[0].click();
                await wait(800);
              }
            }

            // Wait for Angular to render all sections
            await wait(1000);
            return { behaviors: behaviorsCount, skills: skillsCount };
          },
          args: [message.behaviorsCount || 0, message.skillsCount || 0],
        },
        (results) => {
          if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
          sendResponse({ ok: true, expanded: results && results[0] ? results[0].result : null });
        }
      );
    });
    return true; // keep channel open for async sendResponse
  }

  // ── Phase 3: MAIN<->ISOLATED bridge — run the scan in the ABA Matrix tab's MAIN world ──
  // The engine (Scanner/Normalizer/Adapter) lives in the MAIN world. Inject it (idempotent)
  // and run scan+normalize there, returning the plain NormalizedForm to the ISOLATED caller.
  if (message.action === 'getFormSchema') {
    chrome.tabs.query({ active: true }, (tabs) => {
      const abaTab = (tabs || []).find(t => t.url && t.url.includes('app.abamatrix.com')) || (tabs || [])[0];
      if (!abaTab) { sendResponse({ error: 'ABA Matrix tab not found' }); return; }
      chrome.scripting.executeScript(
        {
          target: { tabId: abaTab.id },
          world: 'MAIN',
          files: ['engine/adapters/ABAMatrixAdapter.js', 'engine/core/scanner.js', 'engine/core/normalizer.js'],
        },
        () => {
          if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
          chrome.scripting.executeScript(
            {
              target: { tabId: abaTab.id },
              world: 'MAIN',
              func: () => {
                if (!window.FormEngineScanner || !window.FormEngineNormalizer) return null;
                const raw = window.FormEngineScanner.scan(window.ABAMatrixAdapter || null);
                const norm = window.FormEngineNormalizer.normalize(raw, window.ABAMatrixAdapter || null);
                window.__p4NormalizedForm = norm; // persist in MAIN world for the Executor
                return norm;
              },
            },
            (results) => {
              if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
              sendResponse({ normalizedForm: results && results[0] ? results[0].result : null });
            }
          );
        }
      );
    });
    return true; // keep channel open for async sendResponse
  }

  // ── Phase 3: Planner — fetch the FillPlan (facts + normalizedForm -> actions) ──
  // Same CORS-exempt Bearer proxy as getClinicalFacts.
  if (message.action === 'getPlanFill') {
    chrome.storage.local.get(['extensionToken'], (stored) => {
      const token = stored.extensionToken;
      if (!token) { sendResponse({ error: 'Not authenticated' }); return; }
      fetch('https://path4aba.app/api/extension/plan-fill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ facts: message.facts, normalizedForm: message.normalizedForm }),
      })
        .then(r => r.json())
        .then(data => sendResponse({ plan: data.plan || [], error: data.error }))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true; // keep channel open for async sendResponse
  }

  // ── Phase 4: Executor — run the FillPlan in the ABA Matrix tab's MAIN world ──
  // The Executor + mat-helpers + adapter live in the MAIN world. Inject them (idempotent),
  // then run FormEngineExecutor.execute(plan). window.__p4NormalizedForm was persisted by the
  // earlier getFormSchema call, so the Executor can resolve each field's questionText.
  if (message.action === 'executeFillPlan') {
    chrome.tabs.query({ active: true }, (tabs) => {
      const abaTab = (tabs || []).find(t => t.url && t.url.includes('app.abamatrix.com')) || (tabs || [])[0];
      if (!abaTab) { sendResponse({ error: 'ABA Matrix tab not found' }); return; }
      chrome.scripting.executeScript(
        {
          target: { tabId: abaTab.id },
          world: 'MAIN',
          files: ['engine/adapters/ABAMatrixAdapter.js', 'engine/core/mat-helpers.js', 'engine/core/executor.js'],
        },
        () => {
          if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
          chrome.scripting.executeScript(
            {
              target: { tabId: abaTab.id },
              world: 'MAIN',
              func: async (plan) => {
                if (!window.FormEngineExecutor) return { error: 'Executor not loaded' };
                return await window.FormEngineExecutor.execute(plan);
              },
              args: [message.plan],
            },
            (results) => {
              if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
              sendResponse({ results: results && results[0] ? results[0].result : null });
            }
          );
        }
      );
    });
    return true; // keep channel open for async sendResponse
  }

  // Progress from the Form Agent. The open popup receives this runtime message directly
  // (content-script messages reach open extension views), so we only log it here — a
  // re-broadcast would duplicate the status line in the popup.
  if (message.action === 'agentStatus') {
    console.log('[Path4ABA] agentStatus:', message.text);
    return false;
  }
});
