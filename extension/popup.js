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
        console.warn('[Path4ABA] api: 401 mid-session on', path, '— scheduling reconnect');
        scheduleReconnect();
      } else {
        console.warn('[Path4ABA] api: 401 on', path, '(not on main screen — skipping reconnect trigger)');
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
  ['loading', 'token', 'auth', 'no-clients', 'main'].forEach(id => {
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
    const errEl = document.getElementById('tokenError');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    showScreen('token');
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

  // All retries exhausted — show activation screen with retry button
  console.error('[Path4ABA] All', MAX_RECONNECT, 'reconnect attempts failed. Showing activation screen.');
  setConnectionStatus('disconnected');
  _reconnecting = false;
  const errEl = document.getElementById('tokenError');
  if (errEl) {
    errEl.textContent = 'Could not connect to Path4ABA. Make sure you are logged in at path4aba.app, then click Retry.';
    errEl.style.display = '';
  }
  showRetryButton(true);
  showScreen('token');
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
  hint.textContent = userRole === 'rbt' ? `(select 5)` : '(optional)';

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
  hint.textContent = userRole === 'rbt' ? `(select 2)` : '(optional)';

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
function renderPresent() {
  const grid = document.getElementById('presentGrid');
  if (!grid) return;

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
    item.addEventListener('click', () => {
      if (item.classList.contains('checked')) {
        item.classList.remove('checked');
        selectedPresent = selectedPresent.filter(n => n !== name);
      } else {
        item.classList.add('checked');
        selectedPresent.push(name);
      }
      updateGenerateBtn();
    });
    grid.appendChild(item);
    if (isCustom) {
      item.querySelector('.remove-present-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedProfile?.caregivers) {
          selectedProfile.caregivers = selectedProfile.caregivers.filter(c => c !== name);
        }
        selectedPresent = selectedPresent.filter(n => n !== name);
        renderPresent();
      });
    }
  });
}

// ── Reset session conditions ───────────────
function resetSessionConditions() {
  selectedPresent = [];
  environmentalChange = false;
  const envDesc = document.getElementById('envDescription');
  if (envDesc) { envDesc.style.display = 'none'; envDesc.value = ''; }
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
      medicationChange ? 'Medication consumed today.' : '',
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
      diagnosis: profile.diagnosis || [],
      setting: selectedLocation || '',
    },
  };
  await streamGenerate('/api/refine-note', body, 'POST');
});

// ── Stream handler (shared for generate + refine) ──
async function streamGenerate(endpoint, body, method = 'POST') {
  const outputSection = document.getElementById('outputSection');
  const outputNote = document.getElementById('outputNote');
  const streamStatus = document.getElementById('streamStatus');
  const similarityWarn = document.getElementById('similarityWarn');
  const generateBtn = document.getElementById('generateBtn');
  const refineBtn = document.getElementById('refineBtn');

  outputNote.value = '';
  similarityWarn.style.display = 'none';
  outputSection.style.display = '';
  streamStatus.style.display = '';
  streamStatus.textContent = 'Generating note…';
  generateBtn.disabled = true;
  refineBtn.disabled = true;

  try {
    const res = await api(endpoint, {
      method,
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      streamStatus.style.display = 'none';
      showError(data.error || 'Generation failed. Please try again.');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });

      if (chunk.includes('__META__')) {
        const parts = chunk.split('__META__');
        if (parts[0]) { fullText += parts[0]; outputNote.value = fullText; }
        try {
          const meta = JSON.parse(parts[1]);
          if (meta.error) { showError(meta.error); return; }
          similarityWarn.style.display = meta.similarityWarning ? '' : 'none';
        } catch {}
        break outer;
      }

      if (chunk.includes('__REGEN__')) {
        fullText = '';
        outputNote.value = '';
        streamStatus.textContent = 'Regenerating for uniqueness…';
        continue;
      }

      fullText += chunk;
      outputNote.value = fullText;
      // Auto-scroll textarea to bottom while streaming
      outputNote.scrollTop = outputNote.scrollHeight;
    }

    streamStatus.style.display = 'none';
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
  // Reset present
  selectedPresent = [];
  document.querySelectorAll('#presentGrid .check-item').forEach(el => {
    el.classList.remove('checked');
  });
  // Reset session conditions
  resetSessionConditions();
  // Reset next appointment date fields
  const nextApptEl = document.getElementById('nextApptDate');
  if (nextApptEl) nextApptEl.value = '';
  const nextApptRefineEl = document.getElementById('nextApptDateRefine');
  if (nextApptRefineEl) nextApptRefineEl.value = '';
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
  await api('/api/auth/signout', { method: 'POST' }).catch(() => {});
  // Explicit logout — only place where storage is cleared
  console.log('[Path4ABA] logout: explicit user action — removing token from storage + memory');
  extensionToken = null;
  _reconnecting = false;
  _reconnectAttempts = 0;
  await chrome.storage.local.remove('extensionToken');
  setConnectionStatus('disconnected');
  showRetryButton(false);
  const errEl = document.getElementById('tokenError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  showScreen('token');
});

document.getElementById('retryConnectionBtn').addEventListener('click', () => {
  const errEl = document.getElementById('tokenError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  showRetryButton(false);
  init();
});

// ── Token setup screen ─────────────────────
document.getElementById('activateBtn').addEventListener('click', async () => {
  const input = document.getElementById('tokenInput');
  const errEl = document.getElementById('tokenError');
  const raw = (input?.value || '').trim();

  errEl.style.display = 'none';

  if (!raw.startsWith('p4a_') || raw.length < 20) {
    errEl.textContent = 'Invalid token format. Make sure you copied the full token from Path4ABA Settings.';
    errEl.style.display = '';
    return;
  }

  const btn = document.getElementById('activateBtn');
  btn.disabled = true;
  btn.textContent = 'Verifying…';

  try {
    // Set token temporarily so api() / apiWithTimeout() send the Bearer header
    console.log('[Path4ABA] activateBtn: testing token (in-memory only until verified):', raw.slice(0, 12) + '…');
    extensionToken = raw;

    // Use apiWithTimeout — waits indefinitely for background sendResponse
    const [bcbaResult, rbtResult] = await Promise.allSettled([
      apiWithTimeout(`/api/bcba/clients`, INIT_TIMEOUT_MS),
      apiWithTimeout('/api/rbt/clients',  INIT_TIMEOUT_MS),
    ]);

    const responses = [bcbaResult, rbtResult]
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (responses.length === 0) {
      // Both timed out or had a network error
      console.warn('[Path4ABA] activateBtn: network failure — clearing in-memory token (storage unchanged)');
      extensionToken = null;
      const rejectedResult = bcbaResult.status === 'rejected' ? bcbaResult : rbtResult;
      const err = rejectedResult.reason;
      const isTimeout = err?.name === 'AbortError';
      const msg = isTimeout
        ? 'Request timed out. Check your network and try again.'
        : `Connection failed: ${err?.message || String(err)}`;
      console.error('[Path4ABA] activateBtn network error:', err);
      errEl.textContent = msg;
      errEl.style.display = '';
      return;
    }

    const allUnauthorized = responses.every(r => r.status === 401);
    if (allUnauthorized) {
      console.warn('[Path4ABA] activateBtn: token rejected by server — clearing in-memory token (storage unchanged)');
      extensionToken = null;
      errEl.textContent = 'Token not recognized. Regenerate a new one in Path4ABA Settings → Extension.';
      errEl.style.display = '';
      return;
    }

    // Token valid — persist and boot normally
    console.log('[Path4ABA] activateBtn: token verified — saving to storage:', raw.slice(0, 12) + '…');
    await chrome.storage.local.set({ extensionToken: raw });
    if (input) input.value = '';
    await init();
  } catch (err) {
    console.warn('[Path4ABA] activateBtn: caught error — clearing in-memory token (storage unchanged):', err);
    extensionToken = null;
    errEl.textContent = 'Network error. Check your connection and try again.';
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Activate';
  }
});

document.getElementById('openSettingsBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://path4aba.app/settings' });
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

// ── Date helpers ────────────────────────────
function calcWeekEndDate(startStr) {
  if (!startStr) return null;
  const d = new Date(startStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

function getMondayOfDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().split('T')[0];
}

function getWeekDaysFromMonday(mondayStr) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayStr + 'T00:00:00');
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
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
document.getElementById('showSingleReplBtn')?.addEventListener('click', () => {
  const sec = document.getElementById('singleReplSection');
  const open = sec.style.display === 'none';
  sec.style.display = open ? '' : 'none';
  if (open) renderSingleReplList();
});

async function runSingleAutofill(type) {
  const day      = parseInt(document.getElementById('singleDay').value);
  const statusId = type === 'maladaptive' ? 'singleMaladStatus' : 'singleReplStatus';
  const btnId    = type === 'maladaptive' ? 'autofillSingleMaladBtn' : 'autofillSingleReplBtn';
  if (!day || !projectedItems.length) { setStatus(statusId, 'No data loaded.', true); return; }
  const adjustedItems = applySessionQualityAdjustment(projectedItems);
  const items = adjustedItems.filter(i => i.type === type);
  if (!items.length) { setStatus(statusId, `No ${type} data.`, true); return; }

  const tasks = items.map(item => ({
    name: item.name, dayNumber: day, type,
    value: type === 'maladaptive' ? (item.dailyValue ?? Math.round((item.projectedValue || 0) / 5)) : item.projectedValue,
  }));

  const btn = document.getElementById(btnId);
  btn.disabled = true; btn.textContent = 'Filling…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { setStatus(statusId, 'Could not access the active tab.', true); return; }
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: officePuzzleDatasheetAutofiller, args: [tasks], world: 'MAIN' });
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
    dailyPercentage: item.projectedValue, trials: 12, userConfirmed: true, autofillCompleted: true, platformSource: 'extension',
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
document.getElementById('showWeekReplBtn')?.addEventListener('click', () => {
  const sec = document.getElementById('weekReplSection');
  const open = sec.style.display === 'none';
  sec.style.display = open ? '' : 'none';
  if (open) renderWeekReplList();
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
  workedDayDates.forEach(dateStr => {
    const dayNum = new Date(dateStr + 'T00:00:00').getDate();
    items.forEach(item => {
      tasks.push({ name: item.name, dayNumber: dayNum, type,
        value: type === 'maladaptive' ? Math.round(item.projectedValue / workedCount) : item.projectedValue });
    });
  });

  const btn = document.getElementById(btnId);
  btn.disabled = true; btn.textContent = 'Filling…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { setStatus(statusId, 'Could not access the active tab.', true); return; }
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: officePuzzleDatasheetAutofiller, args: [tasks], world: 'MAIN' });
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
        dailyPercentage: item.projectedValue, trials: 12, userConfirmed: true, autofillCompleted: true, platformSource: 'extension' });
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
  if (dataTabEnabled) {
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    const isOPCharts = url.includes('officepuzzle.com') && url.includes('/data/charts');
    const chartsEl = document.getElementById('extractChartsSection');
    if (chartsEl) chartsEl.style.display = isOPCharts ? '' : 'none';
  } catch { /* ignore — happens in non-tab contexts */ }
}

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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
      const lower = chartName.toLowerCase().trim();
      const exact = pool.find(n => n.toLowerCase().trim() === lower);
      if (exact) return { resolvedName: exact, matched: true };
      const partial = pool.find(n => {
        const nl = n.toLowerCase().trim();
        return nl.includes(lower) || lower.includes(nl);
      });
      return { resolvedName: partial || chartName, matched: !!partial };
    }

    extractedCharts = rawCharts.map(c => {
      const { resolvedName, matched } = resolveChartName(c.name, c.category === 'replacement');
      return { ...c, resolvedName, matched };
    });

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
  btn.textContent = 'Saving…';

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
// Office Puzzle shows ONE behavior/skill per datasheet page. This function reads
// the page header to identify which behavior is currently shown, then fills only that one.
function officePuzzleDatasheetAutofiller(tasks) {
  // ── Helpers ──────────────────────────────────────────────────────────────────
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  function generateSequence(correctCount, total) {
    if (correctCount <= 0) return Array(total).fill('-');
    if (correctCount >= total) return Array(total).fill('+');
    const incorrect = total - correctCount;
    const g = gcd(correctCount, incorrect);
    const cycle = [
      ...Array(correctCount / g).fill('+'),
      ...Array(incorrect   / g).fill('-'),
    ];
    const seq = [];
    for (let i = 0; i < g; i++) seq.push(...cycle);
    return seq;
  }

  // Scan ALL rows for a "Days" row (cells contain bare day numbers 1–31).
  // OP puts this row at the bottom of tbody, not in thead.
  function findDayColumn(table, dayNumber) {
    const day = parseInt(dayNumber);
    const allRows = Array.from(table.querySelectorAll('tr'));

    for (const row of allRows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      let dayHits = 0;
      let targetCol = -1;
      cells.forEach((cell, colIdx) => {
        const raw = cell.textContent.trim();
        if (!/^\d{1,2}$/.test(raw)) return; // must be a bare 1–2 digit number
        const n = parseInt(raw, 10);
        if (n < 1 || n > 31) return;
        dayHits++;
        if (n === day) targetCol = colIdx;
      });
      // ≥5 day-number cells → this is the Days row
      if (dayHits >= 5 && targetCol !== -1) return targetCol;
    }
    return -1;
  }

  // Read the page header to identify which behavior/skill this datasheet page shows.
  function detectCurrentPageName() {
    const selectors = [
      'h4', 'h3', 'h2',
      '[class*="behavior-name"],[class*="skill-name"],[class*="program-name"]',
      '[class*="sheet-title"],[class*="goal-name"],[class*="chart-title"]',
      '.page-title',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = el.textContent.trim();
        if (text.length > 2 && text.length < 120 && !/marker|office puzzle/i.test(text)) return text;
      }
    }
    return null;
  }

  // Fuzzy match: does task name match detected page name?
  function namesMatch(a, b) {
    function norm(s) {
      return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const al = norm(a);
    const bl = norm(b);
    if (al === bl) return true;
    if (al.includes(bl) || bl.includes(al)) return true;
    const aWords = al.split(' ').filter(w => w.length > 2);
    const bWords = new Set(bl.split(' ').filter(w => w.length > 2));
    return aWords.some(w => bWords.has(w));
  }

  // ── Detect which behavior is on this page ─────────────────────────────────
  const pageName = detectCurrentPageName();
  if (!pageName) {
    return ['❌ Could not detect behavior name from this page. Make sure you are on a datasheet page.'];
  }

  // Match ALL tasks for this behavior (may be multiple days in full-week mode)
  const matchingTasks = tasks.filter(t => namesMatch(t.name, pageName));
  if (!matchingTasks.length) {
    const names = [...new Set(tasks.map(t => t.name))].join(', ');
    return [`❌ "${pageName}" not found in your loaded data. Navigate to a sheet for: ${names}`];
  }

  // ── Find the datasheet table ──────────────────────────────────────────────
  const table = Array.from(document.querySelectorAll('table')).find(t => t.querySelector('td.value'))
    || document.querySelector('table');
  if (!table) return [`❌ "${matchingTasks[0].name}" — no datasheet table found on this page`];

  const bodyRows   = Array.from(table.querySelectorAll('tbody tr'));
  const filledDays = [];

  for (const task of matchingTasks) {
    const colIndex = findDayColumn(table, task.dayNumber);
    if (colIndex === -1) continue;

    if (task.type === 'replacement') {
      const totalTrials = 12;
      const correct = Math.min(totalTrials, Math.max(0, Math.round(task.value / 100 * totalTrials)));
      const seq = generateSequence(correct, totalTrials);
      bodyRows.slice(0, totalTrials).forEach((row, i) => {
        const cell = row.children[colIndex];
        if (!cell || !cell.classList.contains('value')) return;
        if (cell.textContent.trim() !== seq[i]) cell.click();
      });
    } else {
      const freq = Math.round(task.value);
      bodyRows.forEach((row, i) => {
        const cell = row.children[colIndex];
        if (!cell || !cell.classList.contains('value')) return;
        const shouldMark = i < freq;
        const isMarked   = cell.textContent.trim().toUpperCase() === 'X';
        if (shouldMark !== isMarked) cell.click();
      });
    }
    filledDays.push(task.dayNumber);
  }

  if (!filledDays.length) return [`❌ "${matchingTasks[0].name}" — could not match any day columns`];
  const daysStr = filledDays.length === 1 ? `day ${filledDays[0]}` : `days ${filledDays.join(', ')}`;
  return [`✓ "${matchingTasks[0].name}" filled (${daysStr}) — navigate to the next behavior sheet to continue`];
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
