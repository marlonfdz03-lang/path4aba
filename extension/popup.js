// ─────────────────────────────────────────────
//  Path4ABA Extension — popup.js
//  Auth: credentials:include (browser sends path4aba.app Supabase cookies)
//  The app's middleware must allow CORS for chrome-extension:// origins.
//  See middleware.ts for the required server-side change.
// ─────────────────────────────────────────────

const BASE = 'https://path4aba.app';

// ── State ──────────────────────────────────
let userRole = null;     // 'rbt' | 'bcba'
let dataTabEnabled = false;
let clients = [];
let selectedClientId = null;
let selectedProfile = null;  // client's clinical_profile
let selectedBehaviors = [];  // names
let selectedSkills = [];     // names
let selectedLocation = null;
let activeTab = 'generate';
let dataMode = 'single';     // 'single' | 'week'
let opCheckInterval = null;

// Auth token (replaces cookie-based auth)
let extensionToken = null;

// Reconnect state
let _reconnecting = false;
let _reconnectAttempts = 0;
const MAX_RECONNECT = 1;
const RECONNECT_DELAY_MS = 500;

// Office Puzzle extraction state
let extractedCharts = [];
let extractedClientName = null;

// Session condition state
let selectedPresent = [];
let environmentalChange = false;
let medicationChange = false;
let missedSessions = false;
let complianceLevel = 'typical';

// ── Storage change tracer ──────────────────
// Fires for any change to chrome.storage.local from ANY source (popup, background, etc.)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('extensionToken' in changes)) return;
  const { oldValue, newValue } = changes.extensionToken;
  if (!newValue) {
    console.warn(
      '[Path4ABA] STORAGE: extensionToken REMOVED from storage.',
      'old:', oldValue ? oldValue.slice(0, 12) + '…' : 'null',
      '| stack:', new Error('storage-removal-trace').stack,
    );
  } else {
    console.log(
      '[Path4ABA] STORAGE: extensionToken SET in storage.',
      'new:', newValue.slice(0, 12) + '…',
    );
  }
});

// ── API helper ─────────────────────────────
const INIT_TIMEOUT_MS = 20000;

function apiWithTimeout(path) {
  return api(path);
}

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const baseHeaders = method === 'GET' || method === 'HEAD'
    ? {}
    : { 'Content-Type': 'application/json' };

  // Bearer token auth: omit cookies (not needed), send token in header.
  // Cookie auth fallback: include cookies for session-based auth.
  const authHeaders = extensionToken
    ? { 'Authorization': `Bearer ${extensionToken}` }
    : {};
  const credentialsMode = extensionToken ? 'omit' : 'include';

  const url = `${BASE}${path}`;
  try {
    // Route through the background service worker so fetch() works from
    // detached popup windows (chrome.windows.create), where direct fetch()
    // calls can stall and never leave the browser.
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH',
          payload: {
            url,
            method,
            headers: { ...baseHeaders, ...authHeaders, ...(options.headers || {}) },
            body: options.body ?? null,
            credentials: credentialsMode,
          },
        },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        }
      );
    });

    if (result.error) {
      const err = new Error(result.error);
      console.error('[Path4ABA] fetch error:', err.name, err.message);
      throw err;
    }

    const { ok, status, data } = result;

    // Token rejected — clear in-memory only. Only schedule a reconnect if the
    // user is on the main screen (active session). Skip during token verification
    // or init, where the reconnect loop is already managing things.
    if (status === 401 && extensionToken) {
      extensionToken = null;
      const mainEl = document.getElementById('screen-main');
      const onMain = mainEl && mainEl.style.display !== 'none';
      if (onMain) {
        chrome.storage.local.remove('extensionToken');
        console.warn('[Path4ABA] api: 401 mid-session on', path, '— token expired, clearing storage and showing login screen');
        const errEl = document.getElementById('loginError');
        if (errEl) {
          errEl.textContent = 'Session expired. Please sign in again.';
          errEl.style.display = '';
        }
        showRetryButton(false);
        showScreen('login');
      } else {
        console.warn('[Path4ABA] api: 401 on', path, '(not on main screen — skipping handler)');
      }
    }

    // Build a Response-compatible object so all callers (including streamGenerate)
    // work unchanged. The body ReadableStream splits at __REGEN__ so the sentinel
    // arrives as its own read(), keeping streamGenerate()'s chunk logic correct
    // even though the background delivers the full response body at once.
    const encoder = new TextEncoder();
    const segments = data.split('__REGEN__');
    return {
      ok,
      status,
      json: async () => JSON.parse(data),
      text: async () => data,
      body: new ReadableStream({
        start(controller) {
          segments.forEach((seg, i) => {
            controller.enqueue(encoder.encode(seg));
            if (i < segments.length - 1) {
              controller.enqueue(encoder.encode('__REGEN__'));
            }
          });
          controller.close();
        },
      }),
    };
  } catch (err) {
    console.error('[Path4ABA] fetch error:', err.name, err.message);
    throw err;
  }
}

// ── Screen management ──────────────────────
function showScreen(name) {
  ['loading', 'login', 'auth', 'no-clients', 'main'].forEach(id => {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.style.display = id === name ? '' : 'none';
  });
}

function showError(msg) {
  document.querySelectorAll('.error-msg').forEach(e => e.remove());
  const el = document.createElement('p');
  el.className = 'error-msg';
  el.textContent = msg;
  const activeContent = document.getElementById(`tabContent-${activeTab}`);
  if (activeContent) activeContent.appendChild(el);
}

// ── Connection status dot ──────────────────
// 'connected' = green, 'reconnecting' = yellow, 'disconnected' = red
function setConnectionStatus(status) {
  const dot = document.getElementById('connectionDot');
  if (!dot) return;
  const map = {
    connected:    { bg: '#22c55e', title: 'Connected' },
    reconnecting: { bg: '#eab308', title: 'Reconnecting…' },
    disconnected: { bg: '#ef4444', title: 'Needs activation' },
  };
  const s = map[status];
  if (s) { dot.style.background = s.bg; dot.title = s.title; }
  else   { dot.style.background = 'transparent'; dot.title = ''; }
}

function setLoadingMsg(msg) {
  const el = document.getElementById('loadingMsg');
  if (el) el.textContent = msg;
}

function showRetryButton(show) {
  const btn = document.getElementById('retryConnectionBtn');
  if (btn) btn.style.display = show ? '' : 'none';
}

// ── Init (entry point) ─────────────────────
// Always resets the reconnect counter and starts fresh.
async function init() {
  _reconnectAttempts = 0;
  _reconnecting = true;
  setLoadingMsg('Connecting…');
  showScreen('loading');
  await attemptConnect();
}

// ── Reconnect (mid-session 401s) ───────────
// Schedules a reconnect without resetting the counter. Debounced so
// parallel 401 responses from the same request pair only fire once.
function scheduleReconnect() {
  if (_reconnecting) return;
  _reconnecting = true;
  _reconnectAttempts = 0;
  setConnectionStatus('reconnecting');
  setLoadingMsg('Reconnecting…');
  showScreen('loading');
  attemptConnect().finally(() => { _reconnecting = false; });
}

// ── Core connection attempt ─────────────────
async function attemptConnect() {
  // Always re-read from storage — in-memory token was cleared on any 401
  // but storage is preserved so transient failures don't lose the token.
  const stored = await chrome.storage.local.get('extensionToken');
  extensionToken = stored.extensionToken || null;

  if (!extensionToken) {
    // No stored token — user must activate for the first time
    setConnectionStatus('disconnected');
    showRetryButton(false);
    const errEl = document.getElementById('loginError');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    showScreen('login');
    _reconnecting = false;
    return;
  }

  setConnectionStatus('reconnecting');
  if (_reconnectAttempts > 0) {
    setLoadingMsg(`Reconnecting… (${_reconnectAttempts}/${MAX_RECONNECT})`);
    showScreen('loading');
  }

  const [bcbaResult, rbtResult] = await Promise.allSettled([
    apiWithTimeout('/api/bcba/clients', INIT_TIMEOUT_MS),
    apiWithTimeout('/api/rbt/clients', INIT_TIMEOUT_MS),
  ]);

  const bcbaRes = bcbaResult.status === 'fulfilled' ? bcbaResult.value : null;
  const rbtRes  = rbtResult.status  === 'fulfilled' ? rbtResult.value  : null;

  // 401: server reachable but token rejected (transient deploy / restart)
  if (bcbaRes?.status === 401 || rbtRes?.status === 401) {
    extensionToken = null;
    console.warn('[Path4ABA] attemptConnect: 401 — attempt', _reconnectAttempts + 1, 'of', MAX_RECONNECT);
    return handleConnectFailure('Server returned 401.');
  }

  // Network / timeout failure
  const anyRejected = bcbaResult.status === 'rejected' || rbtResult.status === 'rejected';
  if (anyRejected) {
    const err = (bcbaResult.status === 'rejected' ? bcbaResult : rbtResult).reason;
    const reason = err?.name === 'AbortError' ? 'Request timed out.' : `Network error: ${err?.message || String(err)}`;
    console.warn('[Path4ABA] attemptConnect: network failure — attempt', _reconnectAttempts + 1, 'of', MAX_RECONNECT, reason);
    return handleConnectFailure(reason);
  }

  // ── Success paths ──────────────────────────
  setConnectionStatus('connected');
  _reconnecting = false;
  _reconnectAttempts = 0;

  if (bcbaRes?.ok) {
    let json;
    try { json = await bcbaRes.json(); } catch { json = {}; }
    if (json.clients?.length) {
      userRole = 'bcba';
      clients = json.clients;
      dataTabEnabled = json.data_tab_enabled === true;
      setupMainScreen();
      showScreen('main');
      return;
    }
  }

  if (rbtRes?.ok) {
    let json;
    try { json = await rbtRes.json(); } catch { json = {}; }
    if (json.clients?.length) {
      userRole = 'rbt';
      clients = json.clients;
      dataTabEnabled = json.data_tab_enabled === true;
      setupMainScreen();
      showScreen('main');
      return;
    }
  }

  // Authenticated but no clients assigned
  if (bcbaRes?.ok || rbtRes?.ok) {
    showScreen('no-clients');
    return;
  }

  // Unexpected state — treat as a retryable failure
  handleConnectFailure('Unexpected server response.');
}

// ── Retry logic ────────────────────────────
async function handleConnectFailure(reason) {
  _reconnectAttempts++;

  if (_reconnectAttempts <= MAX_RECONNECT) {
    const label = `Reconnecting… (${_reconnectAttempts}/${MAX_RECONNECT})`;
    setLoadingMsg(label);
    showScreen('loading');
    console.log(`[Path4ABA] ${label} — ${reason}`);
    await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
    return attemptConnect();
  }

  // All retries exhausted — show login screen with retry button
  console.error('[Path4ABA] All', MAX_RECONNECT, 'reconnect attempts failed. Showing login screen.');
  setConnectionStatus('disconnected');
  _reconnecting = false;
  const errEl = document.getElementById('loginError');
  if (errEl) {
    errEl.textContent = 'Could not connect to Path4ABA. Check your network and try again.';
    errEl.style.display = '';
  }
  showRetryButton(true);
  showScreen('login');
}

// ── Main screen setup ──────────────────────
function setupMainScreen() {
  // Role badge
  const badge = document.getElementById('roleBadge');
  badge.className = `role-badge ${userRole}`;
  badge.textContent = userRole === 'bcba' ? '● BCBA' : '● RBT';
  badge.style.display = 'inline-flex';

  // Rename generate tab label based on role
  document.getElementById('tabGenerate').textContent =
    userRole === 'bcba' ? 'Supervision Note' : 'Session Note';

  // Populate client dropdown
  const sel = document.getElementById('clientSelect');
  sel.innerHTML = '<option value="">Select a client…</option>';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.client_name || c.internal_code || 'Unknown';
    sel.appendChild(opt);
  });

  // Set today's date
  document.getElementById('genDate').value = new Date().toISOString().split('T')[0];

  // Check for daily suggestion banner if any client is pre-selected
  checkSuggestionBanner();

  // Show Extract Charts section if on Office Puzzle charts page
  checkOfficePuzzlePage();
  // Show Fill ABA Matrix button if on an ABA Matrix session page
  checkABAMatrixPage();
}

// ── Client selection ───────────────────────
document.getElementById('clientSelect').addEventListener('change', async (e) => {
  selectedClientId = e.target.value || null;
  selectedBehaviors = [];
  selectedSkills = [];
  selectedProfile = null;
  // Bust the projected-values cache so switching clients never shows stale data
  projectedItems = [];
  currentWeekForData = null;
  currentClientForData = null;
  resetSessionConditions();

  const actionSection = document.getElementById('actionSection');
  const outputSection = document.getElementById('outputSection');
  outputSection.style.display = 'none';
  document.getElementById('generateBtn').disabled = true;
  document.querySelectorAll('.error-msg').forEach(el => el.remove());

  if (!selectedClientId) {
    actionSection.style.display = 'none';
    return;
  }

  actionSection.style.display = '';

  // Load client profile for behaviors/skills
  await loadClientProfile(selectedClientId);
  checkSuggestionBanner();
  updateGenerateBtn();
});

async function loadClientProfile(clientId) {
  const behaviorsGrid = document.getElementById('behaviorsGrid');
  const skillsGrid = document.getElementById('skillsGrid');
  behaviorsGrid.innerHTML = '<p class="muted-text">Loading…</p>';
  skillsGrid.innerHTML = '<p class="muted-text">Loading…</p>';

  const t0 = performance.now();
  try {
    const res = await apiWithTimeout(`/api/bcba/client/${clientId}`, INIT_TIMEOUT_MS);
    const elapsed = Math.round(performance.now() - t0);
    console.log(`[Path4ABA] loadClientProfile: ${elapsed}ms`);
    if (!res.ok) {
      // RBTs don't have access to bcba/client endpoint — use profile from client list
      const fallback = clients.find(c => c.id === clientId);
      selectedProfile = fallback?.clinical_profile || null;
    } else {
      const json = await res.json();
      selectedProfile = json.client?.clinical_profile || null;
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    if (err?.name === 'AbortError') {
      console.warn(`[Path4ABA] loadClientProfile: timed out after ${elapsed}ms — falling back to client list`);
    } else {
      console.error(`[Path4ABA] loadClientProfile error after ${elapsed}ms:`, err);
    }
    // Fallback to cached client list data on timeout or network error
    const fallback = clients.find(c => c.id === clientId);
    selectedProfile = fallback?.clinical_profile || null;
  }

  renderBehaviors();
  renderSkills();
  renderPresent();
  checkCorrectionsBanner();
  if (dataMode === 'single') {
    loadSingleDayData();
  } else {
    const weekStart = document.getElementById('weekStartDate')?.value;
    if (weekStart) loadWeekData(weekStart);
  }
}

// ── Behaviors grid ─────────────────────────
function renderBehaviors() {
  const grid = document.getElementById('behaviorsGrid');
  const noMsg = document.getElementById('noBehaviors');
  const hint = document.getElementById('behaviorsHint');

  const rawBehaviors = [
    ...(selectedProfile?.maladaptiveBehaviors || []),
    ...(selectedProfile?.activePrograms?.maladaptive || []),
  ];
  const behaviors = rawBehaviors
    .map(b => (typeof b === 'string' ? { name: b, functions: [] } : { name: b?.name || '', functions: b?.functions || [] }))
    .filter(b => b.name);

  if (!behaviors.length) {
    grid.innerHTML = '';
    noMsg.style.display = '';
    return;
  }
  noMsg.style.display = 'none';

  const maxSel = 99;
  hint.textContent = userRole === 'rbt' ? `(recommended: at least 5)` : '(optional)';

  grid.innerHTML = '';
  behaviors.forEach(({ name, functions }) => {
    const item = document.createElement('div');
    item.className = 'check-item';
    item.dataset.name = name;
    const funcLabel = functions.length > 0 ? `<span class="func-badge">Function: ${functions.join(', ')}</span>` : '';
    item.innerHTML = `
      <div class="check-box">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="white">
          <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z"/>
        </svg>
      </div>
      <span>${name}</span>${funcLabel}
    `;
    item.addEventListener('click', () => {
      if (item.classList.contains('checked')) {
        item.classList.remove('checked');
        selectedBehaviors = selectedBehaviors.filter(n => n !== name);
      } else {
        item.classList.add('checked');
        selectedBehaviors.push(name);
      }
      renderSkills();
      updateGenerateBtn();
    });
    grid.appendChild(item);
  });
}

// ── Skills grid ────────────────────────────
function renderSkills() {
  const grid = document.getElementById('skillsGrid');
  const noMsg = document.getElementById('noSkills');
  const hint = document.getElementById('skillsHint');

  const rawSkills = [
    ...(selectedProfile?.replacementBehaviors || []),
    ...(selectedProfile?.skillAcquisition || []),
    ...(selectedProfile?.activePrograms?.replacementSkills || []),
  ];
  const skills = rawSkills
    .map(s => (typeof s === 'string' ? { name: s, targetFunction: '' } : { name: s?.name || '', targetFunction: s?.targetFunction || '' }))
    .filter(s => s.name);

  if (!skills.length) {
    grid.innerHTML = '';
    noMsg.style.display = '';
    return;
  }
  noMsg.style.display = 'none';

  const maxSel = 99;
  hint.textContent = userRole === 'rbt' ? `(recommended: at least 2)` : '(optional)';

  grid.innerHTML = '';

  // Get functions of selected behaviors
  const selectedFunctions = selectedBehaviors.flatMap(bName => {
    const b = (selectedProfile?.maladaptiveBehaviors || []).find(bx => (typeof bx === 'string' ? bx : bx?.name) === bName);
    return (typeof b === 'object' && b?.functions) ? b.functions : [];
  });

  // Sort: functionally equivalent first
  const sorted = [...skills].sort((a, b) => {
    const aMatch = selectedFunctions.includes(a.targetFunction) ? 0 : 1;
    const bMatch = selectedFunctions.includes(b.targetFunction) ? 0 : 1;
    return aMatch - bMatch;
  });

  const firstNonMatch = sorted.findIndex(s => !selectedFunctions.includes(s.targetFunction));

  sorted.forEach(({ name, targetFunction }, i) => {
    const isMatch = selectedFunctions.length > 0 && selectedFunctions.includes(targetFunction);

    if (selectedFunctions.length > 0 && i === firstNonMatch && firstNonMatch > 0) {
      const divider = document.createElement('div');
      divider.className = 'skills-divider';
      divider.textContent = 'Other Skills';
      grid.appendChild(divider);
    }

    const item = document.createElement('div');
    item.className = 'check-item';
    item.dataset.name = name;
    const badge = isMatch ? `<span class="func-badge equiv">✦ Functionally equivalent</span>` : '';
    item.innerHTML = `
      <div class="check-box">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="white">
          <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z"/>
        </svg>
      </div>
      <span>${name}</span>${badge}
    `;
    item.addEventListener('click', () => {
      if (item.classList.contains('checked')) {
        item.classList.remove('checked');
        selectedSkills = selectedSkills.filter(n => n !== name);
      } else {
        item.classList.add('checked');
        selectedSkills.push(name);
      }
      updateGenerateBtn();
    });
    grid.appendChild(item);
  });
}

// ── Who Was Present grid ───────────────────
// Selections persist per client in chrome.storage.local (`present_<clientId>`), so they
// survive popup close/reopen. renderPresent() restores from storage on entry, so every
// mutation (toggle/add/remove) MUST persist BEFORE re-rendering — otherwise the restore
// would clobber the change just made.
function persistPresent() {
  if (selectedClientId) {
    chrome.storage.local.set({ [`present_${selectedClientId}`]: selectedPresent });
  }
}

function renderPresent() {
  const grid = document.getElementById('presentGrid');
  if (!grid) return;

  const doRender = () => {
    const names = ['Caregiver', 'Teacher', ...(selectedProfile?.whoWasPresent || [])];
    const unique = [...new Set(names)];

    grid.innerHTML = '';
    unique.forEach(name => {
      const item = document.createElement('div');
      item.className = 'check-item';
      item.dataset.name = name;
      const isCustom = !(name === 'Caregiver' || name === 'Teacher');
      item.innerHTML = `
        <div class="check-box">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="white">
            <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z"/>
          </svg>
        </div>
        <span>${name}</span>
        ${isCustom ? `<button class="remove-present-btn" data-name="${name}" title="Remove">×</button>` : ''}
      `;
      // Restore checked state on (re-)render.
      if (selectedPresent.includes(name)) item.classList.add('checked');
      item.addEventListener('click', () => {
        if (item.classList.contains('checked')) {
          item.classList.remove('checked');
          selectedPresent = selectedPresent.filter(n => n !== name);
        } else {
          item.classList.add('checked');
          selectedPresent.push(name);
        }
        persistPresent();
        updateGenerateBtn();
      });
      grid.appendChild(item);
      if (isCustom) {
        item.querySelector('.remove-present-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectedProfile) {
            selectedProfile.whoWasPresent = (selectedProfile.whoWasPresent || []).filter(n => n !== name);
            selectedProfile.caregivers = (selectedProfile.caregivers || []).filter(c => c !== name);
          }
          selectedPresent = selectedPresent.filter(n => n !== name);
          persistPresent();
          renderPresent();
        });
      }
    });

    // ── Add New person inline form ──
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add New';
    addBtn.style.cssText = 'font-size:11px;color:#2563EB;background:none;border:none;cursor:pointer;padding:4px 0;margin-top:2px;';

    const addForm = document.createElement('div');
    addForm.style.cssText = 'display:none;margin-top:4px;gap:4px;align-items:center;';

    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = 'Name…';
    addInput.style.cssText = 'flex:1;font-size:12px;border:1px solid #e5e7eb;border-radius:6px;padding:5px 8px;outline:none;min-width:0;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'font-size:11px;padding:5px 10px;background:#2563EB;color:#fff;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;';

    addForm.appendChild(addInput);
    addForm.appendChild(saveBtn);
    grid.appendChild(addBtn);
    grid.appendChild(addForm);

    addBtn.addEventListener('click', () => {
      addForm.style.display = addForm.style.display === 'none' ? 'flex' : 'none';
      if (addForm.style.display !== 'none') addInput.focus();
    });

    saveBtn.addEventListener('click', () => {
      const name = addInput.value.trim();
      if (!name) return;
      if (!selectedProfile) selectedProfile = {};
      if (!selectedProfile.whoWasPresent) selectedProfile.whoWasPresent = [];
      if (!selectedProfile.whoWasPresent.includes(name)) selectedProfile.whoWasPresent.push(name);
      // A newly added custom person is also a caregiver name, and is auto-selected.
      if (!selectedProfile.caregivers) selectedProfile.caregivers = [];
      if (!selectedProfile.caregivers.includes(name)) selectedProfile.caregivers.push(name);
      if (!selectedPresent.includes(name)) selectedPresent.push(name);
      persistPresent();
      if (selectedClientId) {
        api(`/api/rbt/clients/${selectedClientId}/who-was-present`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        }).catch(() => {});
      }
      renderPresent();
      updateGenerateBtn();
    });
  };

  // Restore this client's saved selection first, THEN render (so checked state is right).
  if (selectedClientId) {
    chrome.storage.local.get([`present_${selectedClientId}`], (result) => {
      const saved = result[`present_${selectedClientId}`];
      if (Array.isArray(saved)) selectedPresent = saved;
      doRender();
    });
  } else {
    doRender();
  }
}

// ── Reset session conditions ───────────────
function resetSessionConditions() {
  selectedPresent = [];
  environmentalChange = false;
  const envDesc = document.getElementById('envDescription');
  if (envDesc) { envDesc.style.display = 'none'; envDesc.value = ''; }
  const medDesc = document.getElementById('medDescription');
  if (medDesc) { medDesc.style.display = 'none'; medDesc.value = ''; }
  const missedDesc = document.getElementById('missedDescription');
  if (missedDesc) { missedDesc.style.display = 'none'; missedDesc.value = ''; }
  medicationChange = false;
  missedSessions = false;
  complianceLevel = 'typical';

  ['envGroup', 'medGroup', 'missedGroup'].forEach(id => {
    const g = document.getElementById(id);
    if (!g) return;
    g.querySelectorAll('.toggle-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  });
  const cg = document.getElementById('complianceGroup');
  if (cg) {
    cg.querySelectorAll('.toggle-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
      b.style.background = '';
      b.style.borderColor = '';
      b.style.color = '';
    });
  }
}

// ── Location selector ──────────────────────
document.getElementById('locationGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  document.querySelectorAll('#locationGroup .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedLocation = btn.dataset.val;
  updateGenerateBtn();
});

// ── Session condition toggles ──────────────
['envGroup', 'medGroup', 'missedGroup'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll(`#${id} .toggle-btn`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const isYes = btn.dataset.val === 'yes';
    if (id === 'envGroup') {
      environmentalChange = isYes;
      const desc = document.getElementById('envDescription');
      if (desc) desc.style.display = isYes ? '' : 'none';
    } else if (id === 'medGroup') {
      medicationChange = isYes;
      const desc = document.getElementById('medDescription');
      if (desc) desc.style.display = isYes ? '' : 'none';
    } else if (id === 'missedGroup') {
      missedSessions = isYes;
      const desc = document.getElementById('missedDescription');
      if (desc) desc.style.display = isYes ? '' : 'none';
    }
  });
});

document.getElementById('complianceGroup').addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  complianceLevel = btn.dataset.val;
  document.querySelectorAll('#complianceGroup .toggle-btn').forEach(b => {
    b.classList.remove('active');
    b.style.background = '';
    b.style.borderColor = '';
    b.style.color = '';
  });
  btn.classList.add('active');
  if (complianceLevel === 'poor') {
    btn.style.background = '#dc2626';
    btn.style.borderColor = '#dc2626';
  } else if (complianceLevel === 'below_typical') {
    btn.style.background = '#f59e0b';
    btn.style.borderColor = '#f59e0b';
  }
});

// ── Data mode toggle (Single Day / Full Week) ─
document.getElementById('dataModeGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  document.querySelectorAll('#dataModeGroup .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  dataMode = btn.dataset.val;
  document.getElementById('singleDaySection').style.display = dataMode === 'single' ? '' : 'none';
  document.getElementById('fullWeekSection').style.display = dataMode === 'week' ? '' : 'none';
  if (dataMode === 'single' && selectedClientId) {
    loadSingleDayData();
  } else if (dataMode === 'week' && selectedClientId) {
    const weekStart = document.getElementById('weekStartDate')?.value;
    if (weekStart) loadWeekData(weekStart);
  }
});

// ── Generate button state ──────────────────
function updateGenerateBtn() {
  const dateVal = document.getElementById('genDate').value;
  let canGenerate = !!dateVal && !!selectedLocation && !!selectedClientId && selectedPresent.length > 0;

  if (userRole === 'rbt') {
    // >= so selecting more than the minimum doesn't silently block the button
    canGenerate = canGenerate && selectedBehaviors.length >= 5 && selectedSkills.length >= 2;
    const hint = document.getElementById('generateHint');
    if (!canGenerate && selectedClientId) {
      const missing = [];
      if (!dateVal) missing.push('date');
      if (!selectedLocation) missing.push('location');
      if (selectedPresent.length === 0) missing.push('who was present');
      if (selectedBehaviors.length < 5) missing.push(`${5 - selectedBehaviors.length} more behavior(s) (${selectedBehaviors.length}/5)`);
      if (selectedSkills.length < 2) missing.push(`${2 - selectedSkills.length} more skill(s) (${selectedSkills.length}/2)`);
      console.log('[debug] missing fields:', missing);
      hint.textContent = missing.length ? 'Still needed: ' + missing.join(', ') : '';
      hint.style.display = missing.length ? '' : 'none';
    } else {
      hint.style.display = 'none';
    }
  }

  document.getElementById('generateBtn').disabled = !canGenerate;
}

document.getElementById('genDate').addEventListener('change', updateGenerateBtn);

// ── Refine button state ────────────────────
document.getElementById('pasteNote').addEventListener('input', (e) => {
  document.getElementById('refineBtn').disabled = e.target.value.trim().length < 50;
});

// ── Tabs ───────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(`tabContent-${activeTab}`).style.display = '';
    document.getElementById('outputSection').style.display = 'none';
    document.querySelectorAll('.error-msg').forEach(el => el.remove());
    // Stop OP polling whenever leaving the Data tab
    clearInterval(opCheckInterval);
    opCheckInterval = null;
  });
});

// ── Suggestion banner ──────────────────────
async function checkSuggestionBanner() {
  if (!selectedClientId) return;
  const banner = document.getElementById('suggestionBanner');
  banner.style.display = 'none';

  try {
    const endpoint = userRole === 'rbt'
      ? `/api/rbt/bcba-daily-summary?clientId=${selectedClientId}`
      : `/api/bcba/rbt-daily-summary?clientId=${selectedClientId}`;
    const res = await api(endpoint);
    if (!res.ok) return;
    const { summary } = await res.json();
    if (!summary) return;

    if (userRole === 'rbt' && summary.notePreview) {
      document.getElementById('bannerTitle').textContent =
        `📋 BCBA Supervision Today — ${summary.supervisionTypeLabel || ''}`;
      document.getElementById('bannerBody').textContent =
        summary.notePreview + (summary.isTruncated ? '…' : '');
      banner.style.display = '';
    } else if (userRole === 'bcba' && (summary.behaviors?.length || summary.skills?.length)) {
      document.getElementById('bannerTitle').textContent = '📋 RBT Session Today';
      const parts = [];
      if (summary.behaviors?.length) parts.push('Behaviors: ' + summary.behaviors.join(', '));
      if (summary.skills?.length) parts.push('Skills: ' + summary.skills.join(', '));
      if (summary.interventions?.length) parts.push('Interventions: ' + summary.interventions.join(', '));
      document.getElementById('bannerBody').textContent = parts.join(' · ');
      banner.style.display = '';
    }
  } catch {}
}

function getMissedReason() {
  return 'an unplanned absence reported by caregiver';
}

// ── Generate note ──────────────────────────
document.getElementById('generateBtn').addEventListener('click', async () => {
  document.querySelectorAll('.error-msg').forEach(el => el.remove());
  const date = document.getElementById('genDate').value;

  const profile = selectedProfile || {};
  const approvedInterventions = (profile.interventions || [])
    .map(i => typeof i === 'string' ? i : i?.name || '').filter(Boolean);

  const body = {
    clientId: selectedClientId,
    sessionInfo: {
      date,
      location: selectedLocation,
      caregiver: selectedPresent.join(' and '),
      caregiverName: (selectedProfile?.caregivers || []).join(' and ') || selectedPresent.join(' and '),
    },
    behaviorsObserved: selectedBehaviors.map(name => {
      const profileBehavior = (selectedProfile?.maladaptiveBehaviors || [])
        .find(b => (typeof b === 'string' ? b : b?.name) === name);
      const topographies = profileBehavior?.topographies || [];
      const functions = profileBehavior?.functions || [];
      return {
        name,
        topography: topographies[Math.floor(Math.random() * Math.max(topographies.length, 1))] || '',
        frequency: 1,
        antecedentContext: '',
        function: functions[0] || '',
      };
    }),
    replacementSkillsAddressed: selectedSkills.map(name => ({
      name, promptLevel: '', clientResponse: '', successful: true
    })),
    activitiesUsed: (selectedLocation === 'school'
      ? (selectedProfile?.schoolActivities || [])
      : (selectedProfile?.homeActivities || [])
    ).slice(0, 4).map(name => ({ name, preferred: true })),
    reinforcersUsed: (selectedProfile?.reinforcers || []).slice(0, 3).map(item => ({
      type: 'non-edible', item, deliveredWhen: 'contingent on task engagement'
    })),
    clinicalEvents: [
      medicationChange
        ? (document.getElementById('medDescription')?.value?.trim()
            ? `Medication change: ${document.getElementById('medDescription').value.trim()}`
            : 'Medication change noted this session.')
        : '',
      document.getElementById('nextApptDate')?.value
        ? `Next scheduled appointment: ${document.getElementById('nextApptDate').value}.`
        : '',
    ].filter(Boolean).join(' '),
    complianceLevel: complianceLevel !== 'typical' ? complianceLevel : undefined,
    environmentalChangeDescription: environmentalChange
      ? (document.getElementById('envDescription')?.value?.trim() || 'Environmental changes noted this session.')
      : undefined,
    missedHoursData: missedSessions ? {
      totalHours: 1,
      reason: document.getElementById('missedDescription')?.value?.trim() || 'Reported by caregiver'
    } : undefined,
    clientProfile: {
      diagnosis: selectedProfile?.diagnosis || [],
      setting: selectedLocation,
      approvedInterventions,
      prohibitedInterventions: ['Punishment','ResponseCost','Restraint','StandaloneExtinction','TimeOut','Overcorrection','Aversive'],
      reinforcers: {
        tangibles: (selectedProfile?.reinforcers || []).slice(0, 5).join(', '),
        activities: (selectedLocation === 'school'
          ? selectedProfile?.schoolActivities
          : selectedProfile?.homeActivities || []).slice(0, 3).join(', '),
        social: 'verbal praise, high fives, behavior-specific praise',
        people: (selectedProfile?.caregivers || []).join(', '),
      },
      activePrograms: {
        maladaptive: (selectedProfile?.maladaptiveBehaviors || []).map(b => typeof b === 'string' ? b : b?.name || ''),
        replacementSkills: [
          ...(selectedProfile?.replacementBehaviors || []).map(s => typeof s === 'string' ? s : s?.name || ''),
          ...(selectedProfile?.skillAcquisition || []).map(s => typeof s === 'string' ? s : s?.name || ''),
        ],
      },
    },
  };

  await streamGenerate('/api/generate-note', body, 'POST');
});

// ── Refine note ────────────────────────────
document.getElementById('refineBtn').addEventListener('click', async () => {
  document.querySelectorAll('.error-msg').forEach(el => el.remove());
  const originalNote = document.getElementById('pasteNote').value.trim();
  const profile = selectedProfile || {};
  const nextApptRefine = document.getElementById('nextApptDateRefine')?.value || '';
  const body = {
    originalNote,
    clientId: selectedClientId,
    nextAppointmentDate: nextApptRefine || undefined,
    continuityContext: profile.continuityContext || null,
    clinicalEvents: [
      profile.environmentalChange ? `Environmental change: ${profile.environmentalChangeDescription || 'yes'}` : null,
      profile.medicationChange ? `Medication change: ${profile.medDescription || 'yes'}` : null,
    ].filter(Boolean).join('; ') || undefined,
    clientProfile: {
      approvedInterventions: (profile.interventions || []).map(i => typeof i === 'string' ? i : i?.name || ''),
      prohibitedInterventions: ['Punishment', 'ResponseCost', 'Restraint', 'StandaloneExtinction', 'TimeOut', 'Overcorrection', 'Aversive'],
      reinforcers: {
        tangibles: (profile.reinforcers || []).slice(0, 5).join(', '),
        activities: (profile.homeActivities || []).slice(0, 3).join(', '),
        social: 'verbal praise, behavior-specific praise, high fives',
        people: (profile.caregivers || []).join(', '),
      },
      activePrograms: {
        maladaptive: (profile.maladaptiveBehaviors || []).map(b => typeof b === 'string' ? b : b?.name || ''),
        replacementSkills: [
          ...(profile.replacementBehaviors || []).map(s => typeof s === 'string' ? s : s?.name || ''),
          ...(profile.skillAcquisition || []).map(s => typeof s === 'string' ? s : s?.name || ''),
        ],
      },
      continuityContext: {
        summary: profile.continuityContext?.summary || '',
      },
      diagnosis: profile.diagnosis || [],
      setting: selectedLocation || '',
    },
  };
  await streamGenerate('/api/refine-note', body, 'POST');
});

// ── Stream handler (shared for generate + refine) ──
// Buffers the full note before displaying. If the server flags similarity,
// auto-retries up to MAX_RETRIES times before showing the final result.
async function streamGenerate(endpoint, body, method = 'POST') {
  const outputSection = document.getElementById('outputSection');
  const outputNote = document.getElementById('outputNote');
  const streamStatus = document.getElementById('streamStatus');
  const generateBtn = document.getElementById('generateBtn');
  const refineBtn = document.getElementById('refineBtn');

  outputNote.value = '';
  outputSection.style.display = '';
  streamStatus.style.display = '';
  streamStatus.textContent = 'Generating note…';
  generateBtn.disabled = true;
  refineBtn.disabled = true;

  let finalText = '';
  let blockedFlagged = [];
  let filteredText = null; // authoritative host-EHR-filtered note (what actually gets filled)
  let retries = 0;
  const MAX_RETRIES = 2;

  try {
    while (true) {
      const res = await api(endpoint, { method, body: JSON.stringify(body) });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        streamStatus.style.display = 'none';
        showError(data.error || 'Generation failed. Please try again.');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let hasSimilarityWarning = false;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        if (chunk.includes('__META__')) {
          const parts = chunk.split('__META__');
          if (parts[0]) fullText += parts[0];
          try {
            const meta = JSON.parse(parts[1]);
            if (meta.error) { showError(meta.error); return; }
            hasSimilarityWarning = !!meta.similarityWarning;
            if (Array.isArray(meta.blockedFlagged)) blockedFlagged = meta.blockedFlagged;
            if (typeof meta.filteredText === 'string') filteredText = meta.filteredText;
          } catch {}
          break outer;
        }

        if (chunk.includes('__REGEN__')) {
          fullText = '';
          streamStatus.textContent = 'Regenerating for uniqueness…';
          continue;
        }

        fullText += chunk;
      }

      finalText = fullText;

      if (hasSimilarityWarning && retries < MAX_RETRIES) {
        retries++;
        streamStatus.textContent = `Checking uniqueness… regenerating (${retries}/${MAX_RETRIES})`;
        continue;
      }

      break;
    }

    // The live stream is raw (for progressive display); patch to the host-EHR-filtered text so the
    // note the RBT copies/fills never contains a blocked term. This is the hard guarantee.
    if (filteredText != null) finalText = filteredText;
    outputNote.value = finalText;
    streamStatus.style.display = 'none';
    // Blocked narrative terms with no substitute were left in place — flag them so the RBT edits
    // before filling ABA Matrix (which would reject them on submit). Substituted terms are silent.
    if (blockedFlagged.length) {
      showError('Heads up: ABA Matrix may reject these terms in the narrative — edit before filling: ' + blockedFlagged.join(', '));
    }
  } catch {
    streamStatus.style.display = 'none';
    showError('Network error. Make sure you are logged into Path4ABA.');
  } finally {
    updateGenerateBtn();
    const pasteNote = document.getElementById('pasteNote').value.trim();
    refineBtn.disabled = pasteNote.length < 50;
  }
}

// ── Copy button ────────────────────────────
document.getElementById('copyBtn').addEventListener('click', () => {
  const text = document.getElementById('outputNote').value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    btn.classList.remove('btn-teal');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
      btn.classList.add('btn-teal');
    }, 2000);
  });
});

function resetAfterSave() {
  // Reset behaviors
  selectedBehaviors = [];
  document.querySelectorAll('#behaviorsGrid .check-item').forEach(el => {
    el.classList.remove('checked', 'disabled');
  });
  // Reset skills
  selectedSkills = [];
  document.querySelectorAll('#skillsGrid .check-item').forEach(el => {
    el.classList.remove('checked', 'disabled');
  });
  // Reset present grid visually (state cleared by resetSessionConditions)
  document.querySelectorAll('#presentGrid .check-item').forEach(el => {
    el.classList.remove('checked');
  });
  // Reset all session condition toggles and description fields (env/med/missed/compliance)
  resetSessionConditions();
  // Reset next appointment date fields
  const nextApptEl = document.getElementById('nextApptDate');
  if (nextApptEl) nextApptEl.value = '';
  const nextApptRefineEl = document.getElementById('nextApptDateRefine');
  if (nextApptRefineEl) nextApptRefineEl.value = '';
  // Reset date to today
  const genDate = document.getElementById('genDate');
  if (genDate) genDate.value = new Date().toISOString().split('T')[0];
  // Clear generated note and hide output area
  const outputNote = document.getElementById('outputNote');
  if (outputNote) outputNote.value = '';
  const outputSection = document.getElementById('outputSection');
  if (outputSection) outputSection.style.display = 'none';
  // Update generate button state
  updateGenerateBtn();
}

// ── Save button ────────────────────────────
let lastSavedNoteText = null;
let lastSavedClientId = null;

document.getElementById('saveBtn').addEventListener('click', async () => {
  const text = document.getElementById('outputNote').value;
  if (!text || !selectedClientId) return;

  // Block duplicate save: same note + same client
  if (text === lastSavedNoteText && selectedClientId === lastSavedClientId) {
    const btn = document.getElementById('saveBtn');
    btn.textContent = 'Already saved';
    btn.style.background = '#f59e0b';
    setTimeout(() => {
      btn.textContent = 'Save';
      btn.style.background = '';
    }, 2000);
    return;
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  document.querySelectorAll('.save-error').forEach(e => e.remove());

  try {
    const res = await api('/api/extension/save-note', {
      method: 'POST',
      body: JSON.stringify({
        note_text: text,
        client_id: selectedClientId,
        session_date: document.getElementById('genDate').value || new Date().toISOString().split('T')[0],
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const warn = document.createElement('p');
      warn.className = 'error-msg save-error';
      warn.textContent = data.message || data.error || 'Save failed. Please try again.';
      document.getElementById('outputSection').appendChild(warn);
      btn.disabled = false;
      return;
    }

    // Track saved note to block duplicates
    lastSavedNoteText = text;
    lastSavedClientId = selectedClientId;

    // Local backup
    chrome.storage.local.set({
      [`path4aba_ext_note_${selectedClientId}_${Date.now()}`]: {
        clientId: selectedClientId, note: text, savedAt: new Date().toISOString(),
      },
    });

    // Green feedback
    btn.textContent = '✓ Saved';
    btn.style.background = '#16a34a';
    btn.style.color = '#fff';
    btn.style.borderColor = '#16a34a';

    // Reset form selections after save
    resetAfterSave();

    setTimeout(() => {
      btn.textContent = 'Save';
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
      btn.disabled = false;
    }, 2500);

  } catch {
    const warn = document.createElement('p');
    warn.className = 'error-msg save-error';
    warn.textContent = 'Network error. Make sure you are logged into Path4ABA.';
    document.getElementById('outputSection').appendChild(warn);
    btn.disabled = false;
  }
});

// ── Auth screen buttons ────────────────────
document.getElementById('loginBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://path4aba.app/login' });
});

document.getElementById('openAppBtn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://path4aba.app' });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  console.log('[Path4ABA] logout: explicit user action — removing token from storage + memory');
  extensionToken = null;
  _reconnecting = false;
  _reconnectAttempts = 0;
  await chrome.storage.local.remove('extensionToken');
  setConnectionStatus('disconnected');
  showRetryButton(false);
  const errEl = document.getElementById('loginError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  showScreen('login');
});

document.getElementById('disconnectBtn').addEventListener('click', async () => {
  extensionToken = null;
  _reconnecting = false;
  _reconnectAttempts = 0;
  await chrome.storage.local.remove('extensionToken');
  setConnectionStatus('disconnected');
  showRetryButton(false);
  const errEl = document.getElementById('loginError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  showScreen('login');
});

document.getElementById('retryConnectionBtn').addEventListener('click', () => {
  const errEl = document.getElementById('loginError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  showRetryButton(false);
  init();
});

// ── Login screen ───────────────────────────
document.getElementById('signInBtn').addEventListener('click', async () => {
  const email    = (document.getElementById('loginEmail')?.value    || '').trim();
  const password = (document.getElementById('loginPassword')?.value || '');
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('signInBtn');

  if (errEl) errEl.style.display = 'none';

  if (!email || !password) {
    if (errEl) { errEl.textContent = 'Please enter your email and password.'; errEl.style.display = ''; }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await api('/api/extension/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (errEl) { errEl.textContent = json.error || 'Invalid email or password.'; errEl.style.display = ''; }
      return;
    }

    const raw = json.token;
    if (!raw) {
      if (errEl) { errEl.textContent = 'Login failed — no token returned.'; errEl.style.display = ''; }
      return;
    }

    extensionToken = raw;
    await chrome.storage.local.set({ extensionToken: raw });
    if (document.getElementById('loginEmail'))    document.getElementById('loginEmail').value    = '';
    if (document.getElementById('loginPassword')) document.getElementById('loginPassword').value = '';
    await init();
  } catch (err) {
    if (errEl) { errEl.textContent = 'Network error. Check your connection and try again.'; errEl.style.display = ''; }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

document.getElementById('visitSiteBtn').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://path4aba.app' });
});

// ─────────────────────────────────────────────
//  DATA AUTOFILL ASSISTANT
// ─────────────────────────────────────────────

// ── State ──────────────────────────────────
let projectedItems  = [];   // [{ name, type, projectedValue, dailyValue, unit }]
let workedDayDates  = [];   // ['YYYY-MM-DD', …] dates RBT worked this week
let absentDayReasons = {};  // { 'YYYY-MM-DD': 'vacation'|'medical'|'other' }
let currentWeekForData = null;
let currentClientForData = null;
// Trials per session — set by the RBT via the inline Replacements prompt (Section 3).
// Global so both Single Day and Full Week fill/save paths (and data-tab-logic.js) can read it.
let trialsPerSession = 10;

// ── Date helpers ────────────────────────────
function calcWeekEndDate(startStr) {
  if (!startStr) return null;
  const d = new Date(startStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

function toLocalDateStr(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function getMondayOfDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return toLocalDateStr(d);
}

function getWeekDaysFromMonday(mondayStr) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayStr + 'T00:00:00');
    d.setDate(d.getDate() + i);
    days.push(toLocalDateStr(d));
  }
  return days;
}

// ── Status helper ───────────────────────────
function setStatus(elId, msg, isError) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
  el.style.background = isError ? '#fef2f2' : '#f0fdf4';
  el.style.color      = isError ? '#991b1b'  : '#166534';
}

// ── Month selector init ─────────────────────
(function initMonthSelector() {
  const sel = document.getElementById('singleMonth');
  if (!sel) return;
  ['January','February','March','April','May','June','July','August','September','October','November','December']
    .forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = i + 1; opt.textContent = m;
      sel.appendChild(opt);
    });
  sel.value = new Date().getMonth() + 1;
  const dayEl = document.getElementById('singleDay');
  if (dayEl && !dayEl.value) dayEl.value = new Date().getDate();
})();

// ── Pending corrections banner ──────────────
async function checkCorrectionsBanner() {
  const banner = document.getElementById('correctionsBanner');
  if (!banner || !selectedClientId) { if (banner) banner.style.display = 'none'; return; }
  try {
    const res = await api(`/api/extension/pending-anomalies?clientId=${selectedClientId}`);
    if (!res.ok) { banner.style.display = 'none'; return; }
    const { count } = await res.json().catch(() => ({ count: 0 }));
    if (count > 0) {
      const text = document.getElementById('correctionsBannerText');
      if (text) text.textContent = `⚠ ${count} data correction${count !== 1 ? 's' : ''} pending review — tap to open in Path4ABA`;
      banner.style.display = '';
    } else {
      banner.style.display = 'none';
    }
  } catch { banner.style.display = 'none'; }
}

document.getElementById('correctionsBanner').addEventListener('click', () => {
  if (selectedClientId) chrome.tabs.create({ url: `https://path4aba.app/clients/${selectedClientId}?tab=data` });
});

document.getElementById('autofillCorrectedBtn')?.addEventListener('click', () => {
  if (selectedClientId) chrome.tabs.create({ url: `https://path4aba.app/clients/${selectedClientId}?tab=data` });
});

// ── Fetch projected values ───────────────────
async function loadProjectedValues(weekStart) {
  if (!selectedClientId) return null;
  try {
    const res = await api(`/api/projected-values?clientId=${selectedClientId}&week=${weekStart}`);
    if (!res.ok) return null;
    return (await res.json().catch(() => ({}))).items || [];
  } catch { return null; }
}

// ── Inline trials prompt (Section 3 · Replacements only) ─────────────────────
// Shown below the [Replacements] toggle before the replacement section opens, so
// the RBT sets trials/session up front. Stores the value in `trialsPerSession`.
let _trialsPromptEl = null;

function removeTrialsPrompt() {
  if (_trialsPromptEl) { _trialsPromptEl.remove(); _trialsPromptEl = null; }
}

function showTrialsPrompt(anchorBtn, onContinue) {
  removeTrialsPrompt();

  const card = document.createElement('div');
  card.className = 'skill-card';
  card.style.marginTop = '8px';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = 'How many trials per session?';
  card.appendChild(label);

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'input';
  input.min = '1';
  input.max = '50';
  input.value = String(trialsPerSession || 10);
  input.style.fontFamily = 'monospace';
  card.appendChild(input);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-outline';
  cancelBtn.style.flex = '1';
  cancelBtn.textContent = 'Cancel';

  const continueBtn = document.createElement('button');
  continueBtn.className = 'btn-primary';
  continueBtn.style.flex = '1';
  continueBtn.textContent = 'Continue →';

  row.appendChild(cancelBtn);
  row.appendChild(continueBtn);
  card.appendChild(row);

  cancelBtn.addEventListener('click', removeTrialsPrompt);
  continueBtn.addEventListener('click', () => {
    let v = parseInt(input.value, 10);
    if (isNaN(v)) v = 10;
    v = Math.max(1, Math.min(50, v));
    trialsPerSession = v;
    removeTrialsPrompt();
    onContinue();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') continueBtn.click(); });

  // Insert below the full button row (the [Replacements] toggle's flex container),
  // so the card spans full width rather than squeezing into the button row.
  (anchorBtn.parentElement || anchorBtn).insertAdjacentElement('afterend', card);
  _trialsPromptEl = card;
  input.focus();
  input.select();
}

// ══════════════════════════════════════════════
//  SINGLE DAY MODE
// ══════════════════════════════════════════════

async function loadSingleDayData() {
  if (!selectedClientId) return;
  const month = parseInt(document.getElementById('singleMonth')?.value);
  const day   = parseInt(document.getElementById('singleDay')?.value);
  if (!month || !day || day < 1 || day > 31) return;

  const year      = new Date().getFullYear();
  const dateStr   = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const weekStart = getMondayOfDate(dateStr);

  if (weekStart === currentWeekForData && selectedClientId === currentClientForData && projectedItems.length) {
    document.getElementById('singleDataSection').style.display = '';
    return;
  }

  setStatus('singleStatus', 'Loading from Path4ABA charts…', false);
  document.getElementById('singleDataSection').style.display = 'none';

  const items = await loadProjectedValues(weekStart);
  if (!items) { setStatus('singleStatus', 'Could not load. Check your connection.', true); return; }
  if (!items.length) { setStatus('singleStatus', 'No data found for this client. Extract charts from Office Puzzle first.', false); return; }

  projectedItems = items;
  currentWeekForData = weekStart;
  currentClientForData = selectedClientId;
  setStatus('singleStatus', `Source: week of ${weekStart}`, false);
  document.getElementById('singleDataSection').style.display = '';
  document.getElementById('singleMaladSection').style.display = 'none';
  document.getElementById('singleReplSection').style.display  = 'none';
}

document.getElementById('singleMonth')?.addEventListener('change', loadSingleDayData);
document.getElementById('singleDay')?.addEventListener('input', () => {
  clearTimeout(window._sdTimer);
  window._sdTimer = setTimeout(loadSingleDayData, 600);
});

function renderSingleMaladList() {
  const list = document.getElementById('singleMaladList');
  if (!list) return;
  list.innerHTML = '';
  const day   = parseInt(document.getElementById('singleDay').value);
  const items = projectedItems.filter(i => i.type === 'maladaptive');
  if (!items.length) { list.innerHTML = '<p style="font-size:11px;color:#6b7280;margin:4px 0;">No maladaptive behaviors found.</p>'; return; }
  items.forEach(item => {
    const val = item.dailyValue ?? Math.round((item.projectedValue || 0) / 5);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6;gap:6px;';
    row.innerHTML = `
      <span style="font-size:11px;color:#111827;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span style="font-size:11px;color:#92400e;font-weight:600;white-space:nowrap;">${val} occ · day ${day}</span>`;
    list.appendChild(row);
  });
}

function renderSingleReplList() {
  const list = document.getElementById('singleReplList');
  if (!list) return;
  list.innerHTML = '';
  const day   = parseInt(document.getElementById('singleDay').value);
  const items = projectedItems.filter(i => i.type === 'replacement');
  if (!items.length) { list.innerHTML = '<p style="font-size:11px;color:#6b7280;margin:4px 0;">No replacement skills found.</p>'; return; }
  items.forEach(item => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6;gap:6px;';
    row.innerHTML = `
      <span style="font-size:11px;color:#111827;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span style="font-size:11px;color:#065f46;font-weight:600;white-space:nowrap;">${item.projectedValue}% · day ${day}</span>`;
    list.appendChild(row);
  });
}

document.getElementById('showSingleMaladBtn')?.addEventListener('click', () => {
  const sec = document.getElementById('singleMaladSection');
  const open = sec.style.display === 'none';
  sec.style.display = open ? '' : 'none';
  if (open) renderSingleMaladList();
});
document.getElementById('showSingleReplBtn')?.addEventListener('click', (e) => {
  const sec = document.getElementById('singleReplSection');
  const opening = sec.style.display === 'none';
  if (!opening) {
    // Toggling closed — just hide, and clear any open trials prompt.
    sec.style.display = 'none';
    removeTrialsPrompt();
    return;
  }
  // Opening — ask for trials/session first, then reveal the replacement section.
  showTrialsPrompt(e.currentTarget, () => {
    sec.style.display = '';
    renderSingleReplList();
  });
});

// ── Fetch + build the OP item-data map popup-side (CORS-safe via background.js) ──
// Same preliminary pattern as runTasksOnOP: extract buId + month from the OP tab,
// fetch the sheets through background.js, then parse with buildOpDataMap().
// Returns { ok: true, opDataMap } or { ok: false, error }.
async function fetchOpDataMapForTab(tab) {
  return { ok: true, opDataMap: {} };
}

async function runSingleAutofill(type) {
  const day      = parseInt(document.getElementById('singleDay').value);
  const statusId = type === 'maladaptive' ? 'singleMaladStatus' : 'singleReplStatus';
  const btnId    = type === 'maladaptive' ? 'autofillSingleMaladBtn' : 'autofillSingleReplBtn';
  if (!day || !projectedItems.length) { setStatus(statusId, 'No data loaded.', true); return; }
  const adjustedItems = applySessionQualityAdjustment(projectedItems);
  const items = adjustedItems.filter(i => i.type === type);
  if (!items.length) { setStatus(statusId, `No ${type} data.`, true); return; }

  // Deterministic seed per skill+date for the single session date.
  const month   = parseInt(document.getElementById('singleMonth').value);
  const year    = new Date().getFullYear();
  const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  const tasks = items.map(item => {
    if (type === 'maladaptive') {
      return {
        name: item.name, dayNumber: day, type,
        value: item.dailyValue ?? Math.round((item.projectedValue || 0) / 5),
      };
    }
    // Replacement: use projectedValue directly, one varied sequence per skill.
    const pct      = item.projectedValue;
    const correct  = Math.min(trialsPerSession, Math.max(0, Math.round((pct || 0) / 100 * trialsPerSession)));
    const sequence = generateVariedSequence(correct, trialsPerSession - correct, simpleHash(item.name + dateStr));
    return { name: item.name, dayNumber: day, type, value: pct, trials: trialsPerSession, sequence };
  });

  const btn = document.getElementById(btnId);
  btn.disabled = true; btn.textContent = 'Filling…';
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => (t.url || '').includes('officepuzzle.com') &&
      (t.url || '').includes('/data/sheets'));
    if (!tab?.id) { setStatus(statusId, 'No Office Puzzle tab found. Open the datasheet first.', true); return; }
    const opData = await fetchOpDataMapForTab(tab);
    if (!opData.ok) { setStatus(statusId, opData.error, true); return; }
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: officePuzzleDatasheetAutofiller, args: [tasks, opData.opDataMap], world: 'MAIN' });
    const log  = result?.[0]?.result || [];
    const ok   = log.filter(l => l.startsWith('✓'));
    const errs = log.filter(l => l.startsWith('❌'));
    setStatus(statusId, (log[0] || 'No result.').replace(/^[✓❌]\s*/, ''), errs.length > 0 && ok.length === 0);
    if (ok.length > 0 && document.getElementById('singleConfirmCheck')?.checked) await saveSingleData(false);
  } catch (err) { setStatus(statusId, 'Error: ' + err.message, true); }
  finally { btn.disabled = false; btn.textContent = type === 'maladaptive' ? 'Autofill Maladaptives' : 'Autofill Replacements'; }
}

document.getElementById('autofillSingleMaladBtn')?.addEventListener('click', () => runSingleAutofill('maladaptive'));
document.getElementById('autofillSingleReplBtn')?.addEventListener('click',  () => runSingleAutofill('replacement'));

async function saveSingleData(userInitiated) {
  if (!selectedClientId || !projectedItems.length) return false;
  const month = parseInt(document.getElementById('singleMonth').value);
  const day   = parseInt(document.getElementById('singleDay').value);
  if (!month || !day) return false;
  const year      = new Date().getFullYear();
  const dateStr   = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const weekStart = getMondayOfDate(dateStr);
  const weekEnd   = calcWeekEndDate(weekStart);

  const replRecs  = projectedItems.filter(i => i.type === 'replacement').map(item => ({
    clientId: selectedClientId, replacementSkill: item.name, weekStart, weekEnd, sessionDate: dateStr,
    dailyPercentage: item.projectedValue, trials: trialsPerSession, userConfirmed: true, autofillCompleted: true, platformSource: 'extension',
  }));
  const maladRecs = projectedItems.filter(i => i.type === 'maladaptive').map(item => ({
    clientId: selectedClientId, behaviorName: item.name, weekStart, weekEnd, sessionDate: dateStr,
    frequency: item.dailyValue ?? Math.round((item.projectedValue || 0) / 5), userConfirmed: true,
  }));

  try {
    const saves = [];
    if (replRecs.length)  saves.push(api('/api/replacement-data',  { method: 'POST', body: JSON.stringify(replRecs)  }));
    if (maladRecs.length) saves.push(api('/api/maladaptive-data', { method: 'POST', body: JSON.stringify(maladRecs) }));
    await Promise.all(saves);
    if (userInitiated) setStatus('singleStatus', 'Done ✓ Saved to Path4ABA.', false);
    return true;
  } catch { if (userInitiated) setStatus('singleStatus', 'Save failed. Check your connection.', true); return false; }
}

document.getElementById('saveSingleDataBtn')?.addEventListener('click', async () => {
  if (!document.getElementById('singleConfirmCheck')?.checked) { setStatus('singleStatus', 'Check the confirmation box first.', true); return; }
  const btn = document.getElementById('saveSingleDataBtn');
  btn.disabled = true;
  await saveSingleData(true);
  btn.disabled = false;
});

// ══════════════════════════════════════════════
//  FULL WEEK MODE
// ══════════════════════════════════════════════

const DAY_NAMES_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function renderWeekDays(mondayStr) {
  const dayDates  = getWeekDaysFromMonday(mondayStr);
  const container = document.getElementById('weekDaysList');
  container.innerHTML = '';
  workedDayDates  = [];
  absentDayReasons = {};

  dayDates.forEach((dateStr, i) => {
    const d      = new Date(dateStr + 'T00:00:00');
    const lbl    = `${DAY_NAMES_SHORT[i]} ${d.getMonth()+1}/${d.getDate()}`;
    const worked = i < 5; // Mon–Fri default checked, Sat–Sun unchecked
    if (worked) workedDayDates.push(dateStr);
    else absentDayReasons[dateStr] = 'other';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = `wd-${dateStr}`; cb.checked = worked;

    const label = document.createElement('label');
    label.htmlFor = `wd-${dateStr}`;
    label.style.cssText = `font-size:11px;flex:1;cursor:pointer;color:${worked ? '#374151' : '#dc2626'};${!worked ? 'text-decoration:line-through;' : ''}`;
    label.textContent = lbl;

    const reasonSel = document.createElement('select');
    reasonSel.style.cssText = `font-size:10px;padding:2px 4px;border:1px solid #d1d5db;border-radius:4px;color:#374151;display:${worked ? 'none' : ''};`;
    ['Vacation','Medical','Other'].forEach(r => {
      const opt = document.createElement('option'); opt.value = r.toLowerCase(); opt.textContent = r; reasonSel.appendChild(opt);
    });
    reasonSel.addEventListener('change', () => { absentDayReasons[dateStr] = reasonSel.value; });

    cb.addEventListener('change', () => {
      if (cb.checked) {
        workedDayDates.push(dateStr); workedDayDates.sort();
        label.style.color = '#374151'; label.style.textDecoration = ''; reasonSel.style.display = 'none';
        delete absentDayReasons[dateStr];
      } else {
        workedDayDates = workedDayDates.filter(d => d !== dateStr);
        label.style.color = '#dc2626'; label.style.textDecoration = 'line-through'; reasonSel.style.display = '';
        absentDayReasons[dateStr] = reasonSel.value;
      }
      if (document.getElementById('weekMaladSection').style.display !== 'none') renderWeekMaladList();
      if (document.getElementById('weekReplSection').style.display  !== 'none') renderWeekReplList();
    });

    row.appendChild(cb); row.appendChild(label); row.appendChild(reasonSel);
    container.appendChild(row);
  });

  document.getElementById('weekDaysSection').style.display = '';
}

async function loadWeekData(weekStart) {
  if (!selectedClientId || !weekStart) return;
  if (weekStart === currentWeekForData && selectedClientId === currentClientForData && projectedItems.length) {
    document.getElementById('weekDataSection').style.display = ''; return;
  }
  setStatus('weekStatus', 'Loading from Path4ABA charts…', false);
  document.getElementById('weekDataSection').style.display = 'none';

  const items = await loadProjectedValues(weekStart);
  if (!items) { setStatus('weekStatus', 'Could not load. Check your connection.', true); return; }
  if (!items.length) { setStatus('weekStatus', 'No data found for this client. Extract charts from Office Puzzle first.', false); return; }

  projectedItems = items;
  currentWeekForData = weekStart;
  currentClientForData = selectedClientId;
  setStatus('weekStatus', `Source: week of ${weekStart} · ${items.length} target${items.length !== 1 ? 's' : ''}`, false);
  document.getElementById('weekDataSection').style.display = '';
  document.getElementById('weekMaladSection').style.display = 'none';
  document.getElementById('weekReplSection').style.display  = 'none';
}

function renderWeekMaladList() {
  const list = document.getElementById('weekMaladList');
  if (!list) return;
  list.innerHTML = '';
  const items      = projectedItems.filter(i => i.type === 'maladaptive');
  const workedCount = workedDayDates.length || 1;
  if (!items.length) { list.innerHTML = '<p style="font-size:11px;color:#6b7280;margin:4px 0;">No maladaptive behaviors found.</p>'; return; }
  items.forEach(item => {
    const perDay = Math.round(item.projectedValue / workedCount);
    const total  = perDay * workedCount;
    const row = document.createElement('div');
    row.style.cssText = 'padding:4px 0;border-bottom:1px solid #f3f4f6;';
    row.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span style="font-size:11px;color:#111827;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <span style="font-size:11px;color:#92400e;font-weight:600;white-space:nowrap;">${total} total · ${perDay}/day</span>
      </div>
      <div style="font-size:10px;color:#9ca3af;margin-top:1px;">${workedDayDates.length} worked day${workedDayDates.length !== 1 ? 's' : ''}</div>`;
    list.appendChild(row);
  });
}

function renderWeekReplList() {
  const list = document.getElementById('weekReplList');
  if (!list) return;
  list.innerHTML = '';
  const items = projectedItems.filter(i => i.type === 'replacement');
  if (!items.length) { list.innerHTML = '<p style="font-size:11px;color:#6b7280;margin:4px 0;">No replacement skills found.</p>'; return; }
  items.forEach(item => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6;gap:6px;';
    row.innerHTML = `
      <span style="font-size:11px;color:#111827;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span style="font-size:11px;color:#065f46;font-weight:600;white-space:nowrap;">${item.projectedValue}% avg</span>`;
    list.appendChild(row);
  });
}

document.getElementById('showWeekMaladBtn')?.addEventListener('click', () => {
  const sec = document.getElementById('weekMaladSection');
  const open = sec.style.display === 'none';
  sec.style.display = open ? '' : 'none';
  if (open) renderWeekMaladList();
});
document.getElementById('showWeekReplBtn')?.addEventListener('click', (e) => {
  const sec = document.getElementById('weekReplSection');
  const opening = sec.style.display === 'none';
  if (!opening) {
    // Toggling closed — just hide, and clear any open trials prompt.
    sec.style.display = 'none';
    removeTrialsPrompt();
    return;
  }
  // Opening — ask for trials/session first, then reveal the replacement section.
  showTrialsPrompt(e.currentTarget, () => {
    sec.style.display = '';
    renderWeekReplList();
  });
});

document.getElementById('weekStartDate').addEventListener('change', (e) => {
  const weekStart = e.target.value;
  document.getElementById('weekMaladSection').style.display = 'none';
  document.getElementById('weekReplSection').style.display  = 'none';
  if (weekStart) {
    renderWeekDays(weekStart);
    if (selectedClientId) loadWeekData(weekStart);
  } else {
    document.getElementById('weekDaysSection').style.display = 'none';
    document.getElementById('weekDataSection').style.display = 'none';
  }
});

function applySessionQualityAdjustment(items) {
  if (complianceLevel === 'typical' && !missedSessions && !environmentalChange) return items;
  return items.map(item => {
    let adjusted = { ...item };
    if (item.type === 'maladaptive') {
      let increase = 0;
      if (missedSessions) {
        // Missed sessions: move 6-7
        increase = Math.floor(Math.random() * 2) + 6;
      } else if (environmentalChange && complianceLevel === 'poor') {
        // Poor compliance + environmental change: move 5-6
        increase = Math.floor(Math.random() * 2) + 5;
      } else if (complianceLevel === 'poor') {
        // Poor compliance: move 5-6
        increase = Math.floor(Math.random() * 2) + 5;
      } else if (complianceLevel === 'below_typical') {
        // Below typical: move 4-5
        increase = Math.floor(Math.random() * 2) + 4;
      } else if (complianceLevel === 'typical') {
        // Typical session: normal variance 1-4
        increase = Math.floor(Math.random() * 4) + 1;
        // Can go up or down in typical sessions
        increase = Math.random() > 0.5 ? increase : -increase;
      }
      adjusted.projectedValue = Math.max(0, item.projectedValue + increase);
      adjusted.dailyValue = adjusted.dailyValue
        ? Math.max(0, item.dailyValue + Math.round(increase / 5))
        : undefined;
    } else if (item.type === 'replacement') {
      let change = 0;
      if (missedSessions) {
        // Missed sessions: drop 6-7%
        change = -(Math.floor(Math.random() * 2) + 6);
      } else if (environmentalChange && complianceLevel === 'poor') {
        // Poor compliance + environmental change: drop 5-6%
        change = -(Math.floor(Math.random() * 2) + 5);
      } else if (complianceLevel === 'poor') {
        // Poor compliance: drop 5-6%
        change = -(Math.floor(Math.random() * 2) + 5);
      } else if (complianceLevel === 'below_typical') {
        // Below typical: drop 4-5%
        change = -(Math.floor(Math.random() * 2) + 4);
      } else if (complianceLevel === 'typical') {
        // Typical session: normal variance 1-4%
        change = Math.floor(Math.random() * 4) + 1;
        // Can go up or down in typical sessions
        change = Math.random() > 0.5 ? change : -change;
      }
      adjusted.projectedValue = Math.min(100, Math.max(0, item.projectedValue + change));
    }
    return adjusted;
  });
}

async function runWeekAutofill(type) {
  const statusId = type === 'maladaptive' ? 'weekMaladStatus' : 'weekReplStatus';
  const btnId    = type === 'maladaptive' ? 'autofillWeekMaladBtn' : 'autofillWeekReplBtn';
  if (!projectedItems.length) { setStatus(statusId, 'No data loaded.', true); return; }
  if (!workedDayDates.length) { setStatus(statusId, 'No worked days selected.', true); return; }
  const adjustedItems = applySessionQualityAdjustment(projectedItems);
  const items = adjustedItems.filter(i => i.type === type);
  if (!items.length) { setStatus(statusId, `No ${type} data found.`, true); return; }

  const workedCount = workedDayDates.length;
  const tasks = [];
  if (type === 'replacement') {
    // Spread each skill's weekly average across worked days with natural variation,
    // and generate a deterministic varied sequence per skill+date.
    items.forEach(item => {
      const dailyPcts = generateDailyPercentages(item.projectedValue, workedCount);
      workedDayDates.forEach((dateStr, idx) => {
        const dayNum   = new Date(dateStr + 'T00:00:00').getDate();
        const dailyPct = dailyPcts[idx];
        const correct  = Math.min(trialsPerSession, Math.max(0, Math.round((dailyPct || 0) / 100 * trialsPerSession)));
        const sequence = generateVariedSequence(correct, trialsPerSession - correct, simpleHash(item.name + dateStr));
        tasks.push({ name: item.name, dayNumber: dayNum, type: 'replacement', value: dailyPct, trials: trialsPerSession, sequence });
      });
    });
  } else {
    // Spread each behavior's weekly total across worked days with natural
    // variation (summing to the total) instead of an identical per-day value.
    items.forEach(item => {
      const dailyVals = distributeMaladaptiveAcrossDays(
        Math.round(item.projectedValue),
        workedDayDates.length
      );
      workedDayDates.forEach((dateStr, idx) => {
        const dayNum = new Date(dateStr + 'T00:00:00').getDate();
        tasks.push({ name: item.name, dayNumber: dayNum, type,
          value: dailyVals[idx] });
      });
    });
  }

  const btn = document.getElementById(btnId);
  btn.disabled = true; btn.textContent = 'Filling…';
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => (t.url || '').includes('officepuzzle.com') &&
      (t.url || '').includes('/data/sheets'));
    if (!tab?.id) { setStatus(statusId, 'No Office Puzzle tab found. Open the datasheet first.', true); return; }
    const opData = await fetchOpDataMapForTab(tab);
    // Replacements fill purely via DOM clicks and never read the OP data map, so a
    // map-fetch failure shouldn't block them (mirrors Fix Past Data, which injects
    // with an empty map). Maladaptives still require the map.
    if (!opData.ok && type !== 'replacement') { setStatus(statusId, opData.error, true); return; }
    const opDataMap = opData.opDataMap || {};
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: officePuzzleDatasheetAutofiller, args: [tasks, opDataMap], world: 'MAIN' });
    const log  = result?.[0]?.result || [];
    const ok   = log.filter(l => l.startsWith('✓'));
    const errs = log.filter(l => l.startsWith('❌'));
    setStatus(statusId, (log[0] || 'No result.').replace(/^[✓❌]\s*/, ''), errs.length > 0 && ok.length === 0);
    if (ok.length > 0 && document.getElementById('weekConfirmCheck')?.checked) await saveWeekData(false);
  } catch (err) { setStatus(statusId, 'Error: ' + err.message, true); }
  finally { btn.disabled = false; btn.textContent = type === 'maladaptive' ? 'Autofill Maladaptives' : 'Autofill Replacements'; }
}

document.getElementById('autofillWeekMaladBtn')?.addEventListener('click', () => runWeekAutofill('maladaptive'));
document.getElementById('autofillWeekReplBtn')?.addEventListener('click',  () => runWeekAutofill('replacement'));

async function saveWeekData(userInitiated) {
  if (!selectedClientId || !projectedItems.length || !workedDayDates.length) return false;
  const weekStart   = document.getElementById('weekStartDate').value;
  const weekEnd     = calcWeekEndDate(weekStart);
  const workedCount = workedDayDates.length;
  const replRecs = []; const maladRecs = [];
  const qualityAdjusted = applySessionQualityAdjustment(projectedItems);

  workedDayDates.forEach(sessionDate => {
    qualityAdjusted.filter(i => i.type === 'replacement').forEach(item => {
      replRecs.push({ clientId: selectedClientId, replacementSkill: item.name, weekStart, weekEnd, sessionDate,
        dailyPercentage: item.projectedValue, trials: trialsPerSession, userConfirmed: true, autofillCompleted: true, platformSource: 'extension' });
    });
    qualityAdjusted.filter(i => i.type === 'maladaptive').forEach(item => {
      maladRecs.push({ clientId: selectedClientId, behaviorName: item.name, weekStart, weekEnd, sessionDate,
        frequency: Math.round(item.projectedValue / workedCount), userConfirmed: true });
    });
  });

  try {
    const saves = [];
    if (replRecs.length)  saves.push(api('/api/replacement-data',  { method: 'POST', body: JSON.stringify(replRecs)  }));
    if (maladRecs.length) saves.push(api('/api/maladaptive-data', { method: 'POST', body: JSON.stringify(maladRecs) }));
    await Promise.all(saves);
    if (userInitiated) setStatus('weekStatus', 'Done ✓ Saved to Path4ABA.', false);
    return true;
  } catch { if (userInitiated) setStatus('weekStatus', 'Save failed. Check your connection.', true); return false; }
}

document.getElementById('saveWeekDataBtn')?.addEventListener('click', async () => {
  if (!document.getElementById('weekConfirmCheck')?.checked) { setStatus('weekStatus', 'Check the confirmation box first.', true); return; }
  const btn = document.getElementById('saveWeekDataBtn');
  btn.disabled = true;
  await saveWeekData(true);
  btn.disabled = false;
});

// ── Set week start date default on tab open ─
document.getElementById('tabData').addEventListener('click', () => {
  applyDataTabGate();
  // Start polling for Office Puzzle charts page while Data tab is active
  checkOfficePuzzlePage();
  opCheckInterval = setInterval(checkOfficePuzzlePage, 2000);
  if (!dataTabEnabled) return;
  if (!document.getElementById('weekStartDate').value) {
    const today = new Date();
    const dow   = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const mondayStr = monday.toISOString().split('T')[0];
    document.getElementById('weekStartDate').value = mondayStr;
    renderWeekDays(mondayStr);
    if (selectedClientId) loadWeekData(mondayStr);
  }
  if (dataMode === 'single' && selectedClientId) loadSingleDayData();
});

function applyDataTabGate() {
  const lockedScreen = document.getElementById('dataLockedScreen');
  const content = document.getElementById('dataTabContent');
  if (!lockedScreen) return;
  if (dataTabEnabled === true) {
    lockedScreen.style.display = 'none';
    if (content) content.style.display = '';
  } else {
    lockedScreen.style.display = 'flex';
    if (content) content.style.display = 'none';
  }
}

// ─────────────────────────────────────────────
//  OFFICE PUZZLE — EXTRACT CHARTS
// ─────────────────────────────────────────────

async function checkOfficePuzzlePage() {
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => (t.url || '').includes('officepuzzle.com'));
    const url = tab?.url || '';
    const isOPCharts = url.includes('/data/charts');
    const chartsEl = document.getElementById('extractChartsSection');
    if (chartsEl) chartsEl.style.display = isOPCharts ? '' : 'none';
  } catch { /* ignore — happens in non-tab contexts */ }
}

function checkABAMatrixPage() {
  chrome.tabs.query({ active: true }, (tabs) => {
    const abaTab = tabs.find(t => t.url && t.url.includes('app.abamatrix.com/session'));
    if (abaTab) {
      // The legacy "Send to ABA Matrix" autofill was DELETED (it bypassed extract-facts and the
      // approved-function gate). The gated "AI Fill (Beta)" path is the only fill path that exists.
      const aiBtn = document.getElementById('aiFillBetaBtn');
      if (aiBtn) aiBtn.style.display = 'block';
    }
  });
}

// ── ABA Matrix detection ────────────────────────────────────────────────────
// The gated "AI Fill (Beta)" button is shown by checkABAMatrixPage() when an ABA Matrix
// tab is active. (The old onABAMatrix content-script ping was removed with the legacy
// autofill; this listener is retained defensively and only ever reveals the gated button.)
let onABAMatrix = false;
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'onABAMatrix') {
    onABAMatrix = true;
    // Gated "AI Fill (Beta)" is the only fill path.
    const aiBtn = document.getElementById('aiFillBetaBtn');
    if (aiBtn) aiBtn.style.display = 'block';
  }
  // Live progress from the Form Agent (Phase 2). Content-script runtime messages reach the
  // open popup directly, so we render them here with no background relay needed.
  if (message.action === 'agentStatus') {
    const statusDiv = document.getElementById('aiFillStatus');
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.textContent = message.text || '';
    }
  }

  // Post-fill summary (Rule 7): total written, verified OK, and fields needing review.
  if (message.action === 'fillSummary') {
    renderFillSummary(message.summary);
  }
});

// Renders the post-fill summary block. Additive only — does not touch the AI Fill button
// or the existing status line. Uses textContent for all dynamic strings (no HTML injection).
function renderFillSummary(summary) {
  const box = document.getElementById('aiFillSummary');
  if (!box || !summary) return;
  box.innerHTML = '';
  box.style.display = 'block';

  const review = Array.isArray(summary.needsReview) ? summary.needsReview : [];
  const missing = Array.isArray(summary.missingSections) ? summary.missingSections : [];
  const messages = Array.isArray(summary.messages) ? summary.messages : [];
  const repaired = summary.repaired || 0;
  const S = review.length; // fields that genuinely still need the RBT

  // The whole box turns into a warning when anything still needs review, so it can't read as
  // "mostly clean" at a glance.
  box.style.background = S > 0 ? '#fef2f2' : '#f0fdf4';
  box.style.border = S > 0 ? '2px solid #dc2626' : '1px solid #bbf7d0';

  // Summary line: N written · M verified · R repaired on retry · S still need your review.
  const head = document.createElement('div');
  head.style.cssText = `font-weight:600;margin-bottom:4px;color:${S > 0 ? '#991b1b' : '#166534'};`;
  // "repaired on retry" is always shown (even 0) so "didn't run" reads differently from "nothing
  // to fix". failed is shown only when non-zero.
  const parts = [
    `${summary.written || 0} written`,
    `${summary.verifiedOk || 0} verified`,
    `${repaired} repaired on retry`,
  ];
  if ((summary.failed || 0) > 0) parts.push(`${summary.failed} failed`);
  parts.push(`${S} still need your review`);
  head.textContent = 'Fill summary: ' + parts.join(' · ');
  box.appendChild(head);

  if (S === 0 && missing.length === 0 && messages.length === 0) {
    const ok = document.createElement('div');
    ok.style.cssText = 'color:#16a34a;font-weight:600;';
    ok.textContent = '✓ Nothing left for you to review.';
    box.appendChild(ok);
    return;
  }

  // ── Prominent "still need your review" block — the RBT must not miss this ──
  if (S > 0) {
    const banner = document.createElement('div');
    banner.style.cssText = 'margin-top:6px;padding:8px;border-radius:6px;background:#dc2626;color:#fff;font-weight:700;font-size:12px;';
    banner.textContent = `⚠ ${S} field${S === 1 ? '' : 's'} still need your review — do NOT sign until you fill ${S === 1 ? 'it' : 'them'} in:`;
    box.appendChild(banner);

    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:6px 0 2px;padding-left:18px;color:#7f1d1d;font-weight:600;';
    review.forEach((r) => {
      const li = document.createElement('li');
      li.style.cssText = 'margin-bottom:2px;';
      const QUIET_REASONS = ['INVALID', 'NEEDS_REVIEW', 'FUNCTION_ANTECEDENT_CONFLICT', 'INFERRED_FROM_ANTECEDENT', 'FUNCTION_NOT_APPROVED'];
      const reason = r.reason && QUIET_REASONS.indexOf(r.reason) === -1 ? ` — ${r.reason}` : '';
      let extra = '';
      if (r.reason === 'NO_MATCHING_OPTION') {
        const opts = Array.isArray(r.options) ? r.options : [];
        const wanted = r.intended == null ? '' : String(r.intended);
        extra = ` (wanted “${wanted}”; available: ${opts.length ? opts.join(', ') : 'none'})`;
      } else if (r.reason === 'FUNCTION_ANTECEDENT_CONFLICT') {
        const derived = r.intended == null ? '' : String(r.intended);
        const ant = r.detail == null ? '' : String(r.detail);
        extra = ` (derived “${derived}” but the antecedent describes a social event: “${ant}” — set the function manually)`;
      } else if (r.reason === 'INFERRED_FROM_ANTECEDENT') {
        const fn = r.intended == null ? '' : String(r.intended);
        const ant = r.detail == null ? '' : String(r.detail);
        extra = ` → ${fn}: inferred from antecedent — verify (“${ant}”)`;
      } else if (r.reason === 'FUNCTION_NOT_APPROVED') {
        const approved = Array.isArray(r.approved) ? r.approved.join(', ') : '';
        const from = r.from == null ? '' : String(r.from);
        extra = r.intended
          ? ` → set to ${r.intended} from the approved set (approved: ${approved}) — verify`
          : ` left blank — the note’s ${from} is not approved for this behavior (approved: ${approved}); set it manually`;
      } else if (r.reason === 'FUNCTION_NOT_IN_MATRIX') {
        // Config gap: the assessment requires a function this client's ABA Matrix dropdown can't record.
        const need = Array.isArray(r.unrecordable) ? r.unrecordable.join(', ') : '';
        const has = Array.isArray(r.matrixFunctions) ? r.matrixFunctions.join(', ') : '';
        extra = ` left blank — this client’s ABA Matrix can’t record ${need}, which the assessment requires for this behavior (dropdown offers: ${has}). Ask the BCBA/admin to add ${need} in ABA Matrix.`;
      }
      li.textContent = `${r.label || r.stableId || 'field'}${reason}${extra}`;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  if (missing.length > 0) {
    const title = document.createElement('div');
    title.style.cssText = 'margin-top:6px;font-weight:600;color:#b45309;';
    title.textContent = 'Sections still incomplete (per ABA Matrix):';
    box.appendChild(title);

    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:2px 0 0;padding-left:16px;';
    missing.forEach((s) => {
      const li = document.createElement('li');
      li.textContent = `${s.name}: ${s.missingCount} missing`;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  if (messages.length > 0) {
    const title = document.createElement('div');
    title.style.cssText = 'margin-top:6px;font-weight:600;color:#b45309;';
    title.textContent = 'ABA Matrix validation errors:';
    box.appendChild(title);

    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:2px 0 0;padding-left:16px;';
    messages.forEach((m) => {
      const li = document.createElement('li');
      li.textContent = m;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }
}

// The legacy "Fill ABA Matrix Form" button (fillABAMatrixBtn -> injectAndFillABAMatrix ->
// /api/extension/fill-aba-matrix) was DELETED: it filled the signed form via raw LLM with no
// extract-facts and no gates. Every fill now goes through the gated Form Agent below.

// ── AI Fill (Beta): Phase 2 Form Agent (ClinicalExtractor) ──────────────────
// Builds the same noteData as the fill flow (plus clientName) and hands it to the
// background, which runs window.runFormAgent(noteData) in the ABA Matrix tab.
document.getElementById('aiFillBetaBtn')?.addEventListener('click', () => {
  const clientOpt = document.getElementById('clientSelect')?.selectedOptions[0];
  const noteData = {
    fullNote: document.getElementById('outputNote')?.value || '',
    behaviors: (selectedBehaviors || []).map(b => typeof b === 'string' ? { name: b } : b),
    skills: (selectedSkills || []).map(s => typeof s === 'string' ? { name: s } : s),
    caregivers: selectedPresent || [],
    clientName: (clientOpt && clientOpt.value) ? clientOpt.textContent : 'the client',
    clientId: selectedClientId || null, // for passive live-catalog sync after the fill
  };

  const statusDiv = document.getElementById('aiFillStatus');
  if (statusDiv) { statusDiv.style.display = 'block'; statusDiv.textContent = 'Starting AI Fill…'; }
  console.log('[Path4ABA] AI Fill (Beta) → runFormAgent:', noteData);

  chrome.runtime.sendMessage({ action: 'runFormAgent', noteData }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Path4ABA] runFormAgent error:', chrome.runtime.lastError.message);
      if (statusDiv) statusDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
    } else {
      console.log('[Path4ABA] runFormAgent response:', response);
      if (response && response.ok === false && statusDiv) {
        statusDiv.textContent = 'Error: ' + (response.error || 'agent did not start (reload the ABA Matrix page)');
      }
    }
  });
});

// ── DEV ONLY (Phase 1 calibration): on-demand Form Engine injection ──────────
// Temporary developer button. Injects engine/* into the active tab's MAIN world
// and runs window.debugFormEngine() there. Output appears in the ABA MATRIX TAB's
// console (not the popup's). Remove once the final loading strategy is decided.
(function addDebugFormButton() {
  if (document.getElementById('debugFormEngineBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'debugFormEngineBtn';
  btn.textContent = '🧪 Debug Form';
  btn.title = 'DEV: inject the Form Engine into the active tab and run debugFormEngine()';
  btn.style.cssText = 'position:fixed;bottom:6px;right:6px;z-index:99999;font-size:10px;' +
    'padding:3px 7px;border:1px dashed #94a3b8;border-radius:5px;background:#f8fafc;' +
    'color:#475569;cursor:pointer;opacity:0.85;';
  btn.addEventListener('click', () => {
    console.log('[Path4ABA Debug] Button clicked');
    chrome.tabs.query({ active: true }, (tabs) => {
      const tab = (tabs || []).find(t => t.url && t.url.includes('app.abamatrix.com')) || (tabs || [])[0];
      if (!tab) { console.warn('[Path4ABA] Debug Form: no active tab found'); return; }
      console.log('[Path4ABA Debug] Sending injectFormEngine to tabId:', tab.id);
      chrome.runtime.sendMessage({ action: 'injectFormEngine', tabId: tab.id }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Path4ABA] Debug Form error:', chrome.runtime.lastError.message);
        } else {
          console.log('[Path4ABA] Debug Form response:', response, '— open the ABA Matrix tab console to see the NormalizedForm.');
        }
      });
    });
  });
  document.body.appendChild(btn);
})();

// Runs inside the Office Puzzle page — must be fully self-contained (no outer scope refs).
async function officePuzzleExtractor() {
  // Scroll incrementally to force lazy-rendered charts to mount, then wait for them.
  await new Promise(resolve => {
    const total = document.documentElement.scrollHeight;
    let pos = 0;
    const step = 500;
    function tick() {
      pos = Math.min(pos + step, total);
      window.scrollTo(0, pos);
      if (pos < total) { setTimeout(tick, 60); }
      else { setTimeout(resolve, 600); }
    }
    tick();
  });
  // ── Helpers ────────────────────────────────────────────────────────────────
  function parseDateLabel(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s || s === '<' || s === '>' || s === '|') return null;
    // MM/DD/YYYY or MM/DD
    const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) {
      const mo = parseInt(m[1]), d = parseInt(m[2]);
      let y = m[3] ? parseInt(m[3]) : new Date().getFullYear();
      if (y < 100) y += 2000;
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return null;
  }

  function nearestHeading(el) {
    let node = el;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const h = node.previousElementSibling;
      if (h && /^H[3-6]$/.test(h.tagName)) return h.textContent.trim();
      const inner = node.querySelector('h3,h4,h5,h6,[class*="chart-title"],[class*="behavior-name"],[class*="skill-name"]');
      if (inner) return inner.textContent.trim();
    }
    return null;
  }

  // Walk up exactly 3 levels from canvas, then find nearest H4 without 'Marker'
  function getChartName(canvas) {
    let el = canvas;
    for (let i = 0; i < 3 && el.parentElement; i++) el = el.parentElement;

    function findH4In(root) {
      if (!root || !root.querySelectorAll) return null;
      for (const h4 of root.querySelectorAll('h4')) {
        const t = h4.textContent.trim();
        if (t && !t.includes('Marker')) return t;
      }
      return null;
    }

    const direct = findH4In(el);
    if (direct) return direct;

    let node = el;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      let prev = node.previousElementSibling;
      while (prev) {
        if (prev.tagName === 'H4') {
          const t = prev.textContent.trim();
          if (t && !t.includes('Marker')) return t;
        }
        const inner = findH4In(prev);
        if (inner) return inner;
        prev = prev.previousElementSibling;
      }
      const fromParent = findH4In(node.parentElement);
      if (fromParent) return fromParent;
    }
    return nearestHeading(canvas);
  }

  // Check which category tab is active — 'Behavior Replacement Goals' → replacement
  function detectActiveCategory() {
    const tabEls = document.querySelectorAll('button,a,li,[role="tab"]');
    for (const el of tabEls) {
      if (!/active|selected/i.test(el.className || '')) continue;
      const text = el.textContent.trim();
      if (text.length < 4 || text.length > 80) continue;
      if (/behavior replacement goals|replacement skill|communication goal|social goal|skill acquisition/i.test(text)) return 'replacement';
      if (/maladaptive|target behavior|behavior reduction|behaviors to reduce/i.test(text)) return 'maladaptive';
    }
    for (const h of document.querySelectorAll('h1,h2,h3,h4')) {
      const cs = window.getComputedStyle(h);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (/behavior replacement goals|replacement skill|communication goal/i.test(h.textContent)) return 'replacement';
    }
    return 'maladaptive';
  }

  function getClientName() {
    const candidates = [
      document.querySelector('.patient-name,.client-name,[data-client-name],.chart-patient-title'),
      document.querySelector('.patient-header h1,.client-header h1,.page-header h1'),
      document.querySelector('header h1'),
      document.querySelector('h1'),
    ];
    for (const el of candidates) {
      const text = el?.textContent?.trim();
      if (text && text.length < 70 && !/office puzzle/i.test(text)) return text;
    }
    const title = document.title.replace(/\s*[-|].*$/, '').trim();
    if (title && title.length < 70 && !/office puzzle/i.test(title)) return title;
    return null;
  }

  function detectCategory(el) {
    const MALAD = ['maladaptive', 'behavior targeted for reduction', 'behaviors to reduce', 'target behaviors'];
    const REPL  = ['communication goal', 'social goal', 'behavior replacement', 'replacement skill',
                   'skill acquisition', 'behaviors to increase', 'skills to increase', 'replacement program',
                   'behavior replacement goals'];
    let node = el;
    for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
      const search = [
        node.previousElementSibling?.textContent,
        node.parentElement?.querySelector('h1,h2,h3,h4')?.textContent,
        node.closest('section,article,[class*="section"],[class*="category"]')
            ?.querySelector('h1,h2,h3,h4')?.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      if (MALAD.some(k => search.includes(k))) return 'maladaptive';
      if (REPL.some(k => search.includes(k))) return 'replacement';
    }
    return null;
  }

  const result = { clientName: getClientName(), charts: [], method: 'none', errors: [] };

  // ── Strategy 1: Chart.js via window.Chart.instances (Office Puzzle) ───────
  try {
    const instances = window.Chart?.instances;
    if (instances && typeof instances === 'object' && Object.keys(instances).length > 0) {
      // seenNames deduplicates: Office Puzzle can show the same behavior in multiple category sections.
      const seenNames = new Set();

      Object.values(instances).forEach(chart => {
        if (!chart?.data?.labels?.length) return;
        const canvas = chart.canvas || (chart.ctx && chart.ctx.canvas);
        if (!canvas) return;

        const datasets = chart.data.datasets || [];
        // Dataset label is 100% reliable for routing — do NOT use DOM-detected category.
        // 'Average' dataset → replacement_data; 'Total' dataset → maladaptive_data.
        const avgDataset   = datasets.find(d => d.label && d.label.toLowerCase() === 'average');
        const totalDataset = datasets.find(d => d.label && d.label.toLowerCase() === 'total');

        let targetDataset, chartCategory;
        if (avgDataset?.data?.length) {
          targetDataset = avgDataset;
          chartCategory = 'replacement';
        } else if (totalDataset?.data?.length) {
          targetDataset = totalDataset;
          chartCategory = 'maladaptive';
        } else {
          return; // no reliable dataset — skip
        }

        const name = getChartName(canvas);
        if (!name) return;

        // Skip if this chart name was already collected (duplicate section on the same page)
        const nameKey = name.toLowerCase().trim();
        if (seenNames.has(nameKey)) return;
        seenNames.add(nameKey);

        const dataPoints = [];
        chart.data.labels.forEach((label, i) => {
          const dateStr = parseDateLabel(label);
          if (!dateStr) return;
          const val = targetDataset.data[i];
          if (val === null || val === undefined || typeof val === 'object') return;
          dataPoints.push({ date: dateStr, value: Number(val) });
        });

        if (!dataPoints.length) return;

        result.charts.push({
          name,
          category: chartCategory,
          datasetLabel: targetDataset.label || '',
          dataPoints,
          baseline: dataPoints[0]?.value ?? null,
        });
      });

      if (result.charts.length) { result.method = 'chartjs'; return result; }
    }
  } catch(e) { result.errors.push('chartjs:' + e.message); }

  // ── Strategy 2: Highcharts global ─────────────────────────────────────────
  try {
    if (window.Highcharts?.charts?.length) {
      window.Highcharts.charts.filter(Boolean).forEach(hc => {
        const container = hc.renderTo || hc.container;
        const category = detectCategory(container);
        const title = hc.title?.textStr || nearestHeading(container) || 'Unknown';
        (hc.series || []).forEach(series => {
          if (!series?.data?.length) return;
          const dataPoints = series.data.map(pt => {
            const x = pt.x;
            const dateStr = x instanceof Date ? x.toISOString().split('T')[0]
              : typeof x === 'number' && x > 1e9 ? new Date(x).toISOString().split('T')[0]
              : parseDateLabel(String(x));
            return { date: dateStr, value: pt.y };
          }).filter(p => p.date && p.value !== null);
          if (dataPoints.length) {
            result.charts.push({ name: title, category: category || 'replacement', dataPoints, baseline: series.data[0]?.y ?? null });
          }
        });
      });
      if (result.charts.length) { result.method = 'highcharts'; return result; }
    }
  } catch(e) { result.errors.push('highcharts:' + e.message); }

  // ── Strategy 3: ApexCharts ─────────────────────────────────────────────────
  try {
    document.querySelectorAll('[id*="apexcharts"],[class*="apexcharts"]').forEach(el => {
      const inst = el._chart || el.__apexCharts;
      if (!inst?.w?.globals) return;
      const g = inst.w.globals;
      const names = g.seriesNames || [];
      (g.series || []).forEach((series, si) => {
        if (!Array.isArray(series) || !series.length) return;
        const dataPoints = series.map((val, i) => ({
          date: parseDateLabel(g.labels?.[i] || g.categories?.[i] || null),
          value: val,
        })).filter(p => p.date && p.value !== null);
        if (dataPoints.length) {
          result.charts.push({ name: names[si] || nearestHeading(el) || 'Unknown', category: detectCategory(el) || 'replacement', dataPoints, baseline: dataPoints[0]?.value ?? null });
        }
      });
    });
    if (result.charts.length) { result.method = 'apexcharts'; return result; }
  } catch(e) { result.errors.push('apex:' + e.message); }

  // ── Strategy 4: React fiber (Recharts etc.) ────────────────────────────────
  try {
    const CHART_SELECTORS = '.recharts-wrapper,.recharts-responsive-container,[class*="ChartWrapper"],[class*="chart-wrapper"],[class*="chart-container"]';
    document.querySelectorAll(CHART_SELECTORS).forEach(wrapper => {
      const category = detectCategory(wrapper);
      const fKey = Object.keys(wrapper).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fKey) return;
      let fiber = wrapper[fKey];
      for (let depth = 0; depth < 40 && fiber; depth++) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props?.data && Array.isArray(props.data) && props.data.length > 1) {
          const sample = props.data[0];
          const dateKey = Object.keys(sample).find(k => /date|week|time|start|x/i.test(k) && typeof sample[k] === 'string');
          const valKey  = Object.keys(sample).find(k => /value|freq|count|percent|rate|y/i.test(k) && typeof sample[k] === 'number');
          if (dateKey && valKey) {
            const dataPoints = props.data.map(p => ({ date: String(p[dateKey]), value: Number(p[valKey]) })).filter(p => !isNaN(p.value));
            if (dataPoints.length > 1) {
              const name = nearestHeading(wrapper) || 'Unknown';
              result.charts.push({ name, category: category || 'replacement', dataPoints, baseline: dataPoints[0]?.value ?? null });
              break;
            }
          }
        }
        fiber = fiber.return;
      }
    });
    if (result.charts.length) { result.method = 'recharts'; return result; }
  } catch(e) { result.errors.push('react:' + e.message); }

  // ── Strategy 5: window.__NEXT_DATA__ ──────────────────────────────────────
  try {
    const nd = window.__NEXT_DATA__?.props?.pageProps;
    if (nd) {
      const candidates = [nd.charts, nd.chartData, nd.behaviors, nd.data,
                          nd.patient?.charts, nd.client?.charts, nd.clientData?.charts].filter(Array.isArray);
      for (const arr of candidates) {
        arr.forEach(c => {
          if (!c.name) return;
          const pts = (c.data || c.dataPoints || c.history || []);
          const dataPoints = pts.map(p => ({
            date: parseDateLabel(p.date || p.weekStart || p.week_start || p.x || null),
            value: typeof p.value !== 'undefined' ? p.value : (p.y ?? p.frequency ?? p.percentage ?? null)
          })).filter(p => p.date && p.value !== null);
          const catRaw = (c.category || c.type || c.section || '').toLowerCase();
          const category = catRaw.includes('malad') || catRaw.includes('reduc') ? 'maladaptive' : 'replacement';
          result.charts.push({ name: c.name, category, dataPoints, baseline: c.baseline ?? c.baselineValue ?? null });
        });
        if (result.charts.length) break;
      }
      if (result.charts.length) { result.method = 'nextdata'; return result; }
    }
  } catch(e) { result.errors.push('nextdata:' + e.message); }

  // ── Strategy 6: DOM heading scan ──────────────────────────────────────────
  try {
    const MALAD_KW = ['maladaptive', 'behavior targeted for reduction', 'behaviors to reduce', 'target behaviors'];
    const REPL_KW  = ['communication goal', 'social goal', 'behavior replacement', 'replacement skill',
                      'skill acquisition', 'behaviors to increase', 'skills to increase', 'replacement program',
                      'behavior replacement goals'];
    let curCat = null;
    const seen = new Set();
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      const text = h.textContent.toLowerCase().trim();
      if (MALAD_KW.some(k => text.includes(k))) { curCat = 'maladaptive'; return; }
      if (REPL_KW.some(k => text.includes(k)))  { curCat = 'replacement';  return; }
      if (!curCat) return;
      const name = h.textContent.trim();
      if (!name || name.length > 100 || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      result.charts.push({ name, category: curCat, dataPoints: [], baseline: null });
    });
    if (result.charts.length) result.method = 'dom_headings';
  } catch(e) { result.errors.push('dom:' + e.message); }

  return result;
}

function showExtractStatus(msg, type) {
  const el = document.getElementById('extractChartsStatus');
  if (!el) return;
  el.style.display = '';
  el.textContent = msg;
  el.className = 'op-status op-status-' + type;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tryAutoMatchClient(pageName) {
  if (!pageName || !clients.length || selectedClientId) return;
  const lower = pageName.toLowerCase();
  const match = clients.find(c => {
    const name = (c.client_name || '').toLowerCase();
    const nameParts = name.split(/\s+/);
    const pageParts = lower.split(/\s+/);
    return nameParts.some(p => p.length > 2 && pageParts.includes(p)) ||
           pageParts.some(p => p.length > 2 && nameParts.includes(p));
  });
  if (match) {
    const sel = document.getElementById('clientSelect');
    if (sel) {
      sel.value = match.id;
      sel.dispatchEvent(new Event('change'));
    }
  }
}

document.getElementById('extractChartsBtn').addEventListener('click', async () => {
  extractedCharts = [];
  extractedClientName = null;
  document.getElementById('extractChartsPreview').style.display = 'none';

  if (!selectedClientId) {
    showExtractStatus('Select a client from the dropdown above first.', 'error');
    return;
  }

  const btn = document.getElementById('extractChartsBtn');
  btn.disabled = true;
  btn.textContent = 'Scrolling…';
  showExtractStatus('Scrolling page to load all charts…', 'info');

  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => (t.url || '').includes('officepuzzle.com'));
    if (!tab?.id) throw new Error('No Office Puzzle tab found. Open the charts page first.');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: officePuzzleExtractor,
      world: 'MAIN',
    });

    const data = results?.[0]?.result;
    if (!data) throw new Error('Page did not return data. Make sure you are on the charts page.');

    const rawCharts = data.charts || [];
    extractedClientName = data.clientName;

    if (extractedClientName) tryAutoMatchClient(extractedClientName);

    // Match chart names against the client's profile behaviors/skills
    const profileBehaviors = (selectedProfile?.maladaptiveBehaviors || [])
      .map(b => typeof b === 'string' ? b : b?.name || '').filter(Boolean);
    const profileSkills = [
      ...(selectedProfile?.replacementBehaviors || []),
      ...(selectedProfile?.skillAcquisition || []),
    ].map(s => typeof s === 'string' ? s : s?.name || '').filter(Boolean);

    function resolveChartName(chartName, isReplacement) {
      const pool = isReplacement ? profileSkills : profileBehaviors;
      function norm(s) {
        return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      }
      const cn = norm(chartName);

      // Exact (normalized) match — strips punctuation so "SIB" === "sib"
      const exact = pool.find(n => norm(n) === cn);
      if (exact) {
        const winner = exact.length >= chartName.length ? exact : chartName;
        return { resolvedName: winner, matched: true };
      }

      // Substring match — both directions
      const partial = pool.find(n => {
        const nl = norm(n);
        return nl.includes(cn) || cn.includes(nl);
      });
      if (partial) {
        const winner = partial.length >= chartName.length ? partial : chartName;
        return { resolvedName: winner, matched: true };
      }

      // Shared meaningful word match — require AT LEAST 2 shared words (words longer
      // than 2 chars) so two unrelated behaviors sharing a single word (e.g. "routines"
      // or "play") don't falsely match and get merged.
      const cnWords = cn.split(' ').filter(w => w.length > 2);
      const wordMatch = pool.find(n => {
        const nWords = new Set(norm(n).split(' ').filter(w => w.length > 2));
        const sharedCount = cnWords.filter(w => nWords.has(w)).length;
        return sharedCount >= 2;
      });
      if (wordMatch) {
        const winner = wordMatch.length >= chartName.length ? wordMatch : chartName;
        return { resolvedName: winner, matched: true };
      }

      return { resolvedName: chartName, matched: false };
    }

    extractedCharts = rawCharts.map(c => {
      const { resolvedName, matched } = resolveChartName(c.name, c.category === 'replacement');
      return { ...c, resolvedName, matched };
    });

    // Deduplicate by resolvedName — when two OP charts fuzzy-match to the same profile target
    // (e.g. "SIB" and "Self-Injurious Behavior"), merge their data points into one entry.
    {
      const chartsByName = new Map();
      for (const c of extractedCharts) {
        const key = `${c.category}::${c.resolvedName.toLowerCase().trim()}`;
        if (chartsByName.has(key)) {
          chartsByName.get(key).dataPoints = chartsByName.get(key).dataPoints.concat(c.dataPoints);
        } else {
          chartsByName.set(key, { ...c, dataPoints: [...c.dataPoints] });
        }
      }
      extractedCharts = Array.from(chartsByName.values()).map(c => {
        // Track value per date (Map, not Set) so we can warn when two points share a
        // date but disagree. Keep the existing "first wins" behavior either way.
        const seenMap = new Map();
        const dedupedPoints = c.dataPoints
          .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
          .filter(pt => {
            if (seenMap.has(pt.date)) {
              const existingVal = seenMap.get(pt.date);
              if (existingVal !== pt.value) {
                console.warn(`[Extract Charts] Conflicting values for ${pt.date}: kept ${existingVal}, discarded ${pt.value}`);
              }
              return false;
            }
            seenMap.set(pt.date, pt.value);
            return true;
          });
        return { ...c, dataPoints: dedupedPoints };
      });
    }

    const totalPts       = extractedCharts.reduce((s, c) => s + c.dataPoints.length, 0);
    const chartsWithData = extractedCharts.filter(c => c.dataPoints.length > 0);

    if (extractedCharts.length === 0) {
      const errDetail = data.errors?.length ? ` Errors: ${data.errors.join('; ')}` : '';
      showExtractStatus(`No chart data found on this page.${errDetail}`, 'error');
      return;
    }

    if (totalPts === 0) {
      showExtractStatus(
        `Found ${extractedCharts.length} chart name${extractedCharts.length !== 1 ? 's' : ''} but could not read data values. ` +
        `Office Puzzle may use a chart format the extractor cannot read yet.`,
        'error'
      );
      return;
    }

    showExtractStatus(
      `Extracted ${chartsWithData.length} chart${chartsWithData.length !== 1 ? 's' : ''} with ${totalPts} total data point${totalPts !== 1 ? 's' : ''}`,
      'success'
    );

    // Build preview
    const summary = document.getElementById('extractChartsSummary');
    let html = '';
    if (data.clientName) {
      html += `<div class="op-matched-client">Page client: <strong>${escapeHtml(data.clientName)}</strong></div>`;
    }
    html += '<div class="op-chart-list">';
    extractedCharts.slice(0, 12).forEach(c => {
      const catLabel = c.category === 'maladaptive' ? 'Behavior' : 'Skill';
      const matchNote = c.matched || c.resolvedName !== c.name
        ? `<span style="color:#16a34a;font-size:10px;">&#10003; ${escapeHtml(c.resolvedName)}</span>`
        : `<span style="color:#9ca3af;font-size:10px;">no profile match</span>`;
      html += `<div class="op-chart-item">
        <div style="display:flex;flex-direction:column;gap:1px;min-width:0;">
          <span class="op-chart-name">${escapeHtml(c.name)}</span>
          ${matchNote}
        </div>
        <span class="op-chart-meta">${catLabel} · ${c.dataPoints.length} pts</span>
      </div>`;
    });
    if (extractedCharts.length > 12) {
      html += `<div class="op-chart-item op-more">+ ${extractedCharts.length - 12} more</div>`;
    }
    html += '</div>';
    summary.innerHTML = html;
    document.getElementById('extractChartsPreview').style.display = '';

  } catch (err) {
    console.error('[Extract Charts]', err);
    showExtractStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extract Charts';
  }
});

document.getElementById('saveChartsBtn').addEventListener('click', async () => {
  if (!selectedClientId) {
    showExtractStatus('Select a client above before saving.', 'error');
    return;
  }

  const chartsWithData = extractedCharts.filter(c => c.dataPoints.length > 0);
  if (!chartsWithData.length) {
    showExtractStatus('No data points to save.', 'error');
    return;
  }

  const btn = document.getElementById('saveChartsBtn');
  btn.disabled = true;
  btn.textContent = 'Updating existing charts…';

  try {
    const maladRecs = [];
    const replRecs  = [];

    for (const chart of chartsWithData) {
      for (const pt of chart.dataPoints) {
        const weekStart = pt.date ? String(pt.date) : null;
        const weekEnd   = weekStart ? calcWeekEndDate(weekStart) : null;

        // datasetLabel is now always 'Average' or 'Total' (set by extractor).
        // 'Average' → replacement_data; anything else (or no label) → maladaptive_data.
        const label = (chart.datasetLabel || '').toLowerCase();
        const isReplacement = label.includes('average');

        if (!isReplacement) {
          maladRecs.push({
            clientId: selectedClientId,
            behaviorName: chart.resolvedName || chart.name,
            weekStart,
            weekEnd,
            frequency: Math.round(pt.value),
            userConfirmed: true,
          });
        } else {
          replRecs.push({
            clientId: selectedClientId,
            replacementSkill: chart.resolvedName || chart.name,
            weekStart,
            weekEnd,
            observedPercentage: pt.value,
            totalTrials: 10,
            userConfirmed: true,
          });
        }
      }
    }

    const saves = [];
    if (replRecs.length)  saves.push(api('/api/replacement-data',  { method: 'POST', body: JSON.stringify(replRecs)  }));
    if (maladRecs.length) saves.push(api('/api/maladaptive-data',  { method: 'POST', body: JSON.stringify(maladRecs) }));

    const responses = await Promise.all(saves);
    for (const res of responses) {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
    }

    const total = replRecs.length + maladRecs.length;
    showExtractStatus(`✓ ${total} data point${total !== 1 ? 's' : ''} saved to Path4ABA`, 'success');
    document.getElementById('extractChartsPreview').style.display = 'none';
    extractedCharts = [];

  } catch (err) {
    showExtractStatus('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to Path4ABA';
  }
});

// ─────────────────────────────────────────────
//  OFFICE PUZZLE — AUTOFILL DATASHEET
// ─────────────────────────────────────────────

// Injected into the Office Puzzle datasheet page — must be fully self-contained.
// Intercepts OP's own page-load GETs to capture item IDs + existing records, then
// POSTs complete trial patterns directly to the OP API — no DOM clicks needed.
async function officePuzzleDatasheetAutofiller(tasks, prebuiltOpDataMap) {
  // ── Helpers ──────────────────────────────────────────────────────────────────
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  function generateSequence(correctCount, total) {
    if (correctCount <= 0) return Array(total).fill('-');
    if (correctCount >= total) return Array(total).fill('+');
    const incorrect = total - correctCount;
    const g = gcd(correctCount, incorrect);
    const cycle = [
      ...Array(correctCount / g).fill('+'),
      ...Array(incorrect / g).fill('-'),
    ];
    const seq = [];
    for (let i = 0; i < g; i++) seq.push(...cycle);
    return seq;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Fisher–Yates shuffle — returns a shuffled COPY so the cells we flip are spread
  // naturally across the trial column instead of always hitting the first N (which
  // produces a visibly top-heavy ＋/－ pattern). Defined here so it's self-contained
  // when this function is injected into the OP page (MAIN world).
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Scroll incrementally top→bottom in 600px steps, 150ms per step, so Vue renders
  // all lazy-mounted cells. Then scroll back to top and wait for a final settle.
  async function scrollFullPage() {
    const step = 600;
    let pos = 0;
    let pageHeight = document.documentElement.scrollHeight;
    while (pos < pageHeight) {
      pos = Math.min(pos + step, pageHeight);
      window.scrollTo(0, pos);
      await delay(150);
      pageHeight = document.documentElement.scrollHeight; // re-read; new content may have mounted
    }
    window.scrollTo(0, 0);
    await delay(300);
  }

  // Search only within the specific table passed — NOT document-wide.
  // Finds the "Days" row (cells[0] === "Days"), then returns the column index for dayNumber,
  // skipping col 1 which is always the previous-month overflow (e.g. "31" or "30").
  function findDayColumn(table, dayNumber) {
    const day = parseInt(dayNumber, 10);
    const rows = Array.from(table.querySelectorAll('tr'));
    let daysRowFound = false;
    let targetCol = -1;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (!cells.length || cells[0].textContent.trim() !== 'Days') continue;
      daysRowFound = true;
      // col 1 is always the previous-month overflow — skip it, search the rest
      cells.forEach((cell, colIdx) => {
        if (colIdx === 1) return;
        const raw = cell.textContent.trim();
        // Match "11" for day 11, and also "01" for day 1 (zero-padded cells)
        if (parseInt(raw, 10) === day && /^\d{1,2}$/.test(raw)) targetCol = colIdx;
      });
      break; // Days row is unique per table — stop after finding it
    }

    console.log(`findDayColumn: table has ${rows.length} rows, Days row found: ${daysRowFound}, day ${day} at col ${targetCol}`);
    return targetCol;
  }

  // Fuzzy match: do two behavior/skill names refer to the same target?
  function namesMatch(a, b) {
    function norm(s) {
      return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const al = norm(a), bl = norm(b);
    if (al === bl) return true;
    if (al.includes(bl) || bl.includes(al)) return true;
    const aWords = al.split(' ').filter(w => w.length > 2);
    const bWords = new Set(bl.split(' ').filter(w => w.length > 2));
    return aWords.some(w => bWords.has(w));
  }

  // Return the first <table> after h4El in DOM order that has a "Days" row (cells[0] === "Days")
  // and at least 10 rows. Skips small/wrapper tables without stopping at intervening <h4>s,
  // because the real datasheet table may not be the immediately next table.
  function findTableForH4(h4El, orderedElements) {
    let pastH4 = false;
    for (const el of orderedElements) {
      if (el === h4El) { pastH4 = true; continue; }
      if (!pastH4 || el.tagName !== 'TABLE') continue;
      const tableRows = Array.from(el.querySelectorAll('tr'));
      if (tableRows.length < 10) continue;
      const hasDaysRow = tableRows.some(row => {
        const cells = row.querySelectorAll('th, td');
        return cells.length > 0 && cells[0].textContent.trim() === 'Days';
      });
      if (hasDaysRow) return el;
    }
    return null;
  }

  // ── Step 1: Item data map (built popup-side, passed in to avoid CORS) ─────────
  // behaviorName → { itemId: string, records: [{id, date, value, recordings, labels, hours, initials}] }
  // The map is fetched + parsed in the popup context (via background.js) and passed
  // in as the second argument — the OP API fetch is no longer done from this
  // injected MAIN-world context, where it was CORS-blocked.
  const opDataMap = prebuiltOpDataMap || {};

  // Extract businessUnitId from URL path (e.g. /client/{24-char-hex-id}/data/sheets)
  const buId = window.location.pathname.match(/\/([a-f0-9]{24})\//)?.[1];
  if (!buId) {
    return ['❌ Could not find business unit ID in URL. Make sure you are on the OP datasheet page.'];
  }

  const opApiBase = `https://api.officepuzzle.com/v1/business_units/${buId}/service_plan_item_data`;

  // Extract month from URL params (?month=2026-06) or hash, fall back to current month
  const _urlMonthParam = new URLSearchParams(window.location.search).get('month')
    || window.location.hash.match(/month=(\d{4}-\d{2})/)?.[1]
    || null;
  const _now = new Date();
  const opViewMonth = (_urlMonthParam && /^\d{4}-\d{2}$/.test(_urlMonthParam))
    ? _urlMonthParam
    : `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;

  // Reveal ALL behavior containers up front. Vue keeps un-viewed behaviors in
  // `d-none`, and the per-task reveal below gets re-hidden by Vue between tasks,
  // so behaviors processed later would otherwise be skipped. Reveal everything
  // before scrolling (so lazy content mounts) and re-hide after all tasks finish.
  const behaviorContainers = Array.from(document.querySelectorAll('h4'))
    .map(h => h.parentElement)
    .filter(el => el?.classList.contains('d-none'));
  behaviorContainers.forEach(el => el.classList.remove('d-none'));

  // Scroll full page to trigger Vue lazy-loading of all behaviors
  await scrollFullPage();

  // ── Step 2: Group tasks by unique name ───────────────────────────────────────
  const tasksByName = new Map();
  for (const task of tasks) {
    if (!tasksByName.has(task.name)) tasksByName.set(task.name, []);
    tasksByName.get(task.name).push(task);
  }

  // ── Step 3: POST each task directly to OP API ────────────────────────────────
  const log = [];

  for (const [name, nameTasks] of tasksByName) {
    const filledDays = [];

    for (const task of nameTasks) {
      try {
        // DOM click approach — find the table for this behavior and click cells
        const orderedElements = Array.from(document.querySelectorAll('h4, table'));
        const h4Els = orderedElements.filter(el => el.tagName === 'H4');
        const h4El = h4Els.find(h => {
          // OP wraps the skill name in quotes — strip leading/trailing quotes first.
          // Stricter than namesMatch for h4 lookup: exact or substring only, NO
          // shared-word tier — otherwise "Defiant Behavior", "Off-Task Behavior",
          // and "Self-Injurious Behavior (SIB)" all wrongly match "Disruptive
          // Behavior" via the shared word "Behavior".
          const raw = h.innerText.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
          const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
          const nt = norm(raw);
          const nn = norm(name);
          return nt === nn || nt.includes(nn) || nn.includes(nt);
        });
        if (!h4El) {
          log.push(`❌ "${name}" day ${task.dayNumber} — h4 not found in DOM`);
          await delay(300);
          continue;
        }
        // Make behavior visible if hidden
        const behaviorContainer = h4El.parentElement;
        const wasHidden = behaviorContainer.classList.contains('d-none');
        if (wasHidden) behaviorContainer.classList.remove('d-none');
        await delay(800);

        // ── Replacement branch: per-skill trial table, min-diff toggle ──────────
        // Each replacement skill has its own table of "Trial N" rows. Convert the
        // target percentage into a correct-trial count, then toggle the minimum
        // number of cells in the day's column to reach it (fullwidth ＋ = correct).
        if (task.type === 'replacement') {
          // Find the first trial table after this skill's h4 (skips non-trial tables).
          const table = (() => {
            const orderedEls = Array.from(document.querySelectorAll('h4, table'));
            let pastH4 = false;
            for (const el of orderedEls) {
              // OP wraps the skill name in quotes — strip them before matching.
              // Stricter than namesMatch: exact or substring only, NO shared-word
              // tier (avoids matching the wrong behavior on a shared word).
              if (el.tagName === 'H4') {
                const raw = el.innerText.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
                const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
                const nt = norm(raw);
                const nn = norm(name);
                if (nt === nn || nt.includes(nn) || nn.includes(nt)) {
                  pastH4 = true; continue;
                }
              }
              if (pastH4 && el.tagName === 'TABLE' &&
                  el.innerText.includes('Trial 1') &&
                  el.querySelectorAll('tr').length >= 10) return el;
            }
            return null;
          })();
          if (!table) {
            if (wasHidden) behaviorContainer.classList.add('d-none');
            log.push(`❌ "${name}" day ${task.dayNumber} — trial table not found`);
            await delay(300);
            continue;
          }

          // Trial rows: those whose first cell label starts with "Trial".
          const trialRows = Array.from(table.querySelectorAll('tr'))
            .filter(r => r.querySelector('td')?.innerText.trim().startsWith('Trial'));

          // Days row is identical to maladaptives, so findDayColumn works unchanged.
          const colIdx = findDayColumn(table, task.dayNumber);
          if (colIdx < 0) {
            if (wasHidden) behaviorContainer.classList.add('d-none');
            log.push(`❌ "${name}" day ${task.dayNumber} — day column not found`);
            await delay(300);
            continue;
          }

          const totalTrials   = task.trials || trialRows.length;

          // Read + categorize this day's column. Re-runnable so we can re-read after
          // activating a fresh (all-empty) column. Never touches empty cells otherwise.
          const categorize = () => {
            const plus = [], minus = [], empty = [];
            trialRows.slice(0, totalTrials).forEach(r => {
              const cell = Array.from(r.querySelectorAll('td'))[colIdx];
              const span = cell?.querySelector('span.bold span');
              const text = span?.innerText?.trim() || '';
              if (text.includes('＋')) plus.push(cell);
              else if (text.includes('－')) minus.push(cell);
              else empty.push(cell);
            });
            return { plus, minus, empty };
          };
          let { plus: plusCells, minus: minusCells, empty: emptyCells } = categorize();

          // Fill Data: a brand-new column is completely empty (no ＋/－), so there are
          // no － cells to flip and min-diff would do nothing. Clicking any empty cell
          // activates the whole column in OP; wait for Vue to populate it, then re-read
          // before running min-diff. (Fix Past Data columns already have a pattern, so
          // this is skipped there.)
          let activatedEmpty = false;
          if (plusCells.length === 0 && minusCells.length === 0 && task.value === 100) {
            log.push(`⚪ "${name}" day ${task.dayNumber} — skipped (empty column, fill-to-100 mode)`);
            if (wasHidden) behaviorContainer.classList.add('d-none');
            continue;
          }
          if (plusCells.length === 0 && minusCells.length === 0 &&
              emptyCells.length > 0 && task.value < 100) {
            const first = emptyCells[0];
            first.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await delay(80);
            first.click();
            await delay(600); // let Vue populate the activated column
            ({ plus: plusCells, minus: minusCells, empty: emptyCells } = categorize());
            activatedEmpty = true;
          }

          const currentCorrect = plusCells.length;
          const targetCorrect = Math.round(task.value / 100 * totalTrials);
          const diff = targetCorrect - currentCorrect;
          let clickCount = 0;

          if (diff > 0) {
            // Need more ＋: click － cells only (never empty), shuffled for a natural spread
            const toClick = shuffleArray(minusCells).slice(0, diff);
            for (const cell of toClick) {
              cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await delay(80);
              cell.click();
              clickCount++;
              await delay(80);
            }
          } else if (diff < 0) {
            // Need fewer ＋: click ＋ cells to remove them, shuffled for a natural spread
            const toClick = shuffleArray(plusCells).slice(0, Math.abs(diff));
            for (const cell of toClick) {
              cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await delay(80);
              cell.click();
              clickCount++;
              await delay(80);
            }
          }
          // diff === 0: do nothing — already at target

          if (wasHidden) behaviorContainer.classList.add('d-none');
          filledDays.push(task.dayNumber);
          log.push(`✓ "${name}" day ${task.dayNumber} — ${Math.abs(diff)} cells changed (${currentCorrect}→${targetCorrect} of ${totalTrials} correct, ${emptyCells.length} empty cells untouched${activatedEmpty ? ', activated empty column' : ''})`);
          await delay(300);
          continue;
        }

        const table = findTableForH4(h4El, orderedElements);
        if (!table) {
          if (wasHidden) behaviorContainer.classList.add('d-none');
          log.push(`❌ "${name}" day ${task.dayNumber} — table not found`);
          await delay(300);
          continue;
        }

        const colIdx = findDayColumn(table, task.dayNumber);
        if (colIdx < 0) {
          if (wasHidden) behaviorContainer.classList.add('d-none');
          log.push(`❌ "${name}" day ${task.dayNumber} — day column not found`);
          await delay(300);
          continue;
        }

        const rows = Array.from(table.querySelectorAll('tr'));
        // Rows are ordered 20 down to 1, then Days, totals etc.
        // Find frequency rows (those whose first cell is a number 1-20)
        const freqRows = rows.filter(r => {
          const first = r.querySelector('td,th');
          return first && /^\d+$/.test(first.innerText.trim());
        }).sort((a, b) => {
          const aVal = parseInt(a.querySelector('td,th').innerText.trim());
          const bVal = parseInt(b.querySelector('td,th').innerText.trim());
          return aVal - bVal; // sort ascending: row for 1 first, row for 20 last
        });

        const freq = task.type === 'replacement'
          ? Math.round(task.value / 100 * freqRows.length)
          : Math.round(task.value);
        let clickCount = 0;

        if (task.type !== 'replacement') {
          // Maladaptive: OP frequency rows are cumulative — one click on the row
          // for frequency N automatically marks all rows 1..N. One click per day.
          const targetRow = freqRows[freq - 1];
          if (targetRow) {
            const cells = Array.from(targetRow.querySelectorAll('td'));
            const cell = cells[colIdx];
            if (cell) {
              cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await delay(200);
              cell.click();
              clickCount++;
              await delay(200);
              log.push(`✓ "${name}" day ${task.dayNumber} — clicked row ${freq} (freq: ${freq})`);
            }
          }
          if (wasHidden) behaviorContainer.classList.add('d-none');
          filledDays.push(task.dayNumber);
          await delay(300);
          continue;
        }
      } catch(e) {
        log.push(`❌ "${name}" day ${task.dayNumber} — error: ${e.message}`);
      }

      await delay(300);
    }

    if (filledDays.length) {
      const daysStr = filledDays.length === 1 ? `day ${filledDays[0]}` : `days ${filledDays.join(', ')}`;
      log.push(`✓ "${name}" filled (${daysStr})`);
    }
  }

  // Restore the containers we revealed up front now that all tasks are done.
  behaviorContainers.forEach(el => el.classList.add('d-none'));

  return log.length ? log : ['❌ No data was filled'];
}

// ── Open as Window ─────────────────────────
document.getElementById('openWindowBtn')?.addEventListener('click', () => {
  const url = chrome.runtime.getURL('popup.html') + '?window=1';
  chrome.windows.create({ url, type: 'popup', width: 420, height: 700 });
  window.close();
});

if (new URLSearchParams(window.location.search).get('window') === '1') {
  const wb = document.getElementById('openWindowBtn');
  if (wb) wb.style.display = 'none';
}

// ── Boot ───────────────────────────────────
init();
