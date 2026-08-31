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
let complianceLevel = 'typical';
// '' = no active selection. When the RBT reports an environmental change the control is CLEARED and
// they must actively choose how the session went — the system never pre-picks a level and never
// infers one from the reported context. complianceTouched records a real choice so clearing never
// overwrites one. Mirrors the website and app forms.
let complianceTouched = false;

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
  // A tracked note id / local backup belong to ONE client. FLUSH any pending edit for the client we're LEAVING
  // first — while selectedClientId + savedNoteId still point at it — then drop them so an edit never PATCHes or
  // overwrites the previous client's note.
  flushExtPending();
  savedNoteId = null;
  backupKey = null;
  backupRecord = null;
  pendingEditText = null;
  setSaveStateExt('idle');
  selectedClientId = e.target.value || null;
  selectedBehaviors = [];
  selectedSkills = [];
  selectedProfile = null;
  // Bust the projected-values cache so switching clients never shows stale data
  projectedItems = [];
  currentWeekForData = null;
  currentClientForData = null;
  resetSessionConditions();
  // Per-note text belongs to the client it was written for — never carry it to another client.
  const prevOutput = document.getElementById('outputNote');
  if (prevOutput) prevOutput.value = '';

  // Location (incl. a typed "Other place of service") belongs to one client — reset it so client A's
  // location never carries to client B, and the saved-location chips re-render for the new client.
  selectedLocation = null;
  document.querySelectorAll('#locationGroup .toggle-btn').forEach(b => b.classList.remove('active'));
  const otherField = document.getElementById('otherLocationField');
  if (otherField) otherField.style.display = 'none';
  const otherInput = document.getElementById('otherLocationInput');
  if (otherInput) otherInput.value = '';

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

// ── Active-only helpers (mirror lib/activePrograms.ts; the extension can't import TS) ──
// A MASTERED behavior/skill is progress history and must NOT be selectable for a note. Read the existing
// status + the separate mastered fields (masteredBehaviors / skillAcquisition). Mastered items stay in the
// profile untouched — only the SELECTION lists here are filtered.
function extNameOf(x) { return (typeof x === 'string' ? x : (x && x.name) || '').toString().trim(); }
function extIsMastered(x) { return x && typeof x === 'object' && String(x.status || '').toLowerCase() === 'mastered'; }
function extMasteredBehaviorNameSet(profile) {
  const set = new Set();
  (profile && Array.isArray(profile.masteredBehaviors) ? profile.masteredBehaviors : []).forEach(n => { const k = extNameOf(n).toLowerCase(); if (k) set.add(k); });
  (profile && Array.isArray(profile.maladaptiveBehaviors) ? profile.maladaptiveBehaviors : []).forEach(b => { if (extIsMastered(b)) { const k = extNameOf(b).toLowerCase(); if (k) set.add(k); } });
  return set;
}
function extMasteredSkillNameSet(profile) {
  const set = new Set();
  (profile && Array.isArray(profile.skillAcquisition) ? profile.skillAcquisition : []).forEach(s => { const k = extNameOf(s).toLowerCase(); if (k) set.add(k); });
  return set;
}

// ── Behaviors grid ─────────────────────────
function renderBehaviors() {
  const grid = document.getElementById('behaviorsGrid');
  const noMsg = document.getElementById('noBehaviors');
  const hint = document.getElementById('behaviorsHint');

  const masteredBeh = extMasteredBehaviorNameSet(selectedProfile);
  const rawBehaviors = [
    ...(selectedProfile?.maladaptiveBehaviors || []),
    ...(selectedProfile?.activePrograms?.maladaptive || []),
  ].filter(b => !extIsMastered(b) && !masteredBeh.has(extNameOf(b).toLowerCase())); // ACTIVE only
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
  hint.textContent = userRole === 'rbt' ? `(select at least 1)` : '(optional)';

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

  // ACTIVE skills only — skillAcquisition (mastered) is EXCLUDED, and any name the profile marks mastered.
  const masteredSk = extMasteredSkillNameSet(selectedProfile);
  const rawSkills = [
    ...(selectedProfile?.replacementBehaviors || []),
    ...(selectedProfile?.activePrograms?.replacementSkills || []),
  ].filter(s => !extIsMastered(s) && !masteredSk.has(extNameOf(s).toLowerCase()));
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
  hint.textContent = userRole === 'rbt' ? `(select at least 1)` : '(optional)';

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
  medicationChange = false;
  complianceLevel = 'typical';
  complianceTouched = false;

  ['envGroup', 'medGroup'].forEach(id => {
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
  const val = btn.dataset.val;
  const otherField = document.getElementById('otherLocationField');
  if (val === 'other') {
    // NEVER send the literal "other" — the location is whatever the RBT saves/types/picks below. Until
    // then selectedLocation stays null (generation is gated), so a stray "other" can't reach the note.
    if (otherField) otherField.style.display = '';
    renderSavedLocations();
    const typed = document.getElementById('otherLocationInput')?.value?.trim() || '';
    selectedLocation = typed || null;
  } else {
    if (otherField) otherField.style.display = 'none';
    selectedLocation = val;
  }
  updateGenerateBtn();
});

// Per-client saved "Other place of service" options (mirrors who-was-present). Rendered when "Other" is
// selected; each chip picks that saved location; the input + Save adds a new one for this client.
function renderSavedLocations() {
  const row = document.getElementById('savedLocationsRow');
  if (!row) return;
  const saved = (selectedProfile && Array.isArray(selectedProfile.savedLocations)) ? selectedProfile.savedLocations : [];
  row.innerHTML = '';
  saved.forEach(loc => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle-btn' + (selectedLocation === loc ? ' active' : '');
    b.textContent = loc;
    b.addEventListener('click', () => {
      selectedLocation = loc;
      const input = document.getElementById('otherLocationInput');
      if (input) input.value = loc;
      renderSavedLocations();
      updateGenerateBtn();
    });
    row.appendChild(b);
  });
}

document.getElementById('otherLocationInput').addEventListener('input', (e) => {
  selectedLocation = e.target.value.trim() || null;
  // A freshly typed value deselects the saved chips (until it matches one).
  document.querySelectorAll('#savedLocationsRow .toggle-btn').forEach(b => b.classList.toggle('active', b.textContent === selectedLocation));
  updateGenerateBtn();
});

document.getElementById('saveLocationBtn').addEventListener('click', () => {
  const input = document.getElementById('otherLocationInput');
  const name = (input?.value || '').trim();
  if (!name) return;
  if (!selectedProfile) selectedProfile = {};
  if (!Array.isArray(selectedProfile.savedLocations)) selectedProfile.savedLocations = [];
  if (!selectedProfile.savedLocations.some(l => l.toLowerCase() === name.toLowerCase())) {
    selectedProfile.savedLocations.push(name);
  }
  selectedLocation = name; // the TYPED text reaches the note, never "other"
  if (selectedClientId) {
    api(`/api/rbt/clients/${selectedClientId}/saved-locations`, {
      method: 'POST',
      body: JSON.stringify({ location: name }),
    }).catch(() => {});
  }
  renderSavedLocations();
  updateGenerateBtn();
});

// Something out of the ordinary was reported (environmental change, medication change, or a missed
// session). When ANY is marked YES, the session cannot be "typical" — the RBT must actively pick below
// typical or poor.
function outOfOrdinaryReported() {
  return environmentalChange || medicationChange;
}

// When something out of the ordinary is reported the compliance control is UNSET and "typical" is
// disabled (the RBT must choose below typical or poor); otherwise restore the plain default — never
// overriding a level the RBT actually picked (unless that pick was "typical", which is neutralized).
function syncComplianceRequirement() {
  const ooo = outOfOrdinaryReported();
  if (ooo && complianceLevel === 'typical') { complianceLevel = ''; complianceTouched = false; }
  if (!complianceTouched) complianceLevel = ooo ? '' : 'typical';
  const cg = document.getElementById('complianceGroup');
  if (cg) {
    cg.querySelectorAll('.toggle-btn').forEach((b, i) => {
      const isTypical = b.dataset.val === 'typical';
      // Disable "typical" (the first option) when something out of the ordinary was reported.
      b.disabled = ooo && isTypical;
      b.style.opacity = (ooo && isTypical) ? '0.4' : '';
      b.style.cursor = (ooo && isTypical) ? 'not-allowed' : '';
      if (b.disabled) b.title = 'Something out of the ordinary was reported — choose below typical or poor';
      else b.removeAttribute('title');
      b.classList.toggle('active', complianceLevel !== '' && complianceLevel === b.dataset.val);
      if (complianceLevel !== b.dataset.val) { b.style.background = ''; b.style.borderColor = ''; b.style.color = ''; }
    });
  }
  updateGenerateBtn();
}

// ── Session condition toggles ──────────────
['envGroup', 'medGroup'].forEach(id => {
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
      syncComplianceRequirement();
    } else if (id === 'medGroup') {
      medicationChange = isYes;
      const desc = document.getElementById('medDescription');
      if (desc) desc.style.display = isYes ? '' : 'none';
      syncComplianceRequirement();
    }
  });
});

// Describing the change is what makes it "reported", so re-check the requirement as they type.
document.getElementById('envDescription')?.addEventListener('input', syncComplianceRequirement);

document.getElementById('complianceGroup').addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  // "typical" is unavailable when something out of the ordinary was reported.
  if (btn.dataset.val === 'typical' && outOfOrdinaryReported()) return;
  complianceLevel = btn.dataset.val;
  complianceTouched = true;
  updateGenerateBtn();
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
  // An environmental change was reported, so the session's compliance level must be the RBT's own
  // active choice before a note can be generated (it is only ever '' in that case).
  canGenerate = canGenerate && complianceLevel !== '';

  if (userRole === 'rbt') {
    // AT LEAST ONE behavior — the note documents exactly what the RBT marks, so the count is theirs
    // to choose. This required FIVE, which is what made a fixed five-ABC note look normal; the note
    // then padded from the client's treatment plan when fewer actually occurred. One is the floor
    // (a session note needs at least one documented behavior); there is no ceiling and no target.
    canGenerate = canGenerate && selectedBehaviors.length >= 1 && selectedSkills.length >= 1;
    const hint = document.getElementById('generateHint');
    if (!canGenerate && selectedClientId) {
      const missing = [];
      if (!dateVal) missing.push('date');
      if (!selectedLocation) missing.push('location');
      if (selectedPresent.length === 0) missing.push('who was present');
      if (selectedBehaviors.length < 1) missing.push('at least one behavior');
      if (selectedSkills.length < 1) missing.push('at least one skill');
      if (complianceLevel === '') missing.push("the session's compliance level (something out of the ordinary was reported — choose below typical or poor)");
      hint.textContent = missing.length ? 'Still needed: ' + missing.join(', ') : '';
      hint.style.display = missing.length ? '' : 'none';
    } else {
      hint.style.display = 'none';
    }
  }

  document.getElementById('generateBtn').disabled = !canGenerate;
}

document.getElementById('genDate').addEventListener('change', updateGenerateBtn);

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

// ── Generate note ──────────────────────────
document.getElementById('generateBtn').addEventListener('click', async () => {
  document.querySelectorAll('.error-msg').forEach(el => el.remove());
  const date = document.getElementById('genDate').value;

  const profile = selectedProfile || {};
  const approvedInterventions = (profile.interventions || [])
    .map(i => typeof i === 'string' ? i : i?.name || '').filter(Boolean);

  // Slim payload: the server builds the full SessionInput from the authoritative DB profile
  // (dual-accept in /api/generate-note). Constraint sets (allowedFunctions, matrixFunctions,
  // approvedInterventions) are derived server-side — so this path now runs the function gate it
  // never had. The medication free-text is intentionally NOT sent (server emits a fixed, non-PHI line).
  const body = {
    clientId: selectedClientId,
    date,
    location: selectedLocation,
    present: selectedPresent,
    selectedBehaviors,
    selectedSkills,
    compliance: complianceLevel,
    medicationChange,
    envChange: environmentalChange,
    envChangeDesc: document.getElementById('envDescription')?.value?.trim() || '',
    nextAppt: document.getElementById('nextApptDate')?.value || '',
  };

  await streamGenerate('/api/generate-note', body, 'POST');
});

// ── Stream handler (generate) ──
// Buffers the full note before displaying (so the RBT never watches a wipe/restart). Uniqueness NEVER
// regenerates (it is a cosmetic warning, warn-only server-side); the only server-driven restart is the
// class-B compliance coverage retry, shown calmly as "Finalizing your note…". There is no client-side retry loop.

// __PARITY_START__  Ported from lib/noteStream.ts:splitNoteStream — keep behavior byte-for-byte identical.
// The extension has no module system/build step, so this is a hand copy; lib/noteStreamParity.test.mjs
// extracts THIS text and runs it against the same 8 vectors under `npm test`, so drift fails CI. Pure: no
// DOM, no globals beyond String. The stream is <pass-1>[ __REGEN__[:src]\n <pass-2> ]* __META__{json};
// callers feed the FULL accumulated `raw` so a marker or the JSON that spans reads is handled correctly.
function splitNoteStream(raw) {
  const s = String(raw ?? '');
  const META = '__META__';
  const REGEN = '__REGEN__';
  const mi = s.indexOf(META);
  const body = mi === -1 ? s : s.slice(0, mi);
  const metaRaw = mi === -1 ? null : s.slice(mi + META.length);
  let note = body;
  let sawRegen = false;
  const ri = body.lastIndexOf(REGEN);
  if (ri !== -1) {
    sawRegen = true;
    let after = body.slice(ri + REGEN.length);
    if (after.startsWith(':')) {
      const nl = after.indexOf('\n');
      after = nl === -1 ? '' : after.slice(nl + 1);
    }
    note = after;
  }
  return { note, metaRaw, sawRegen };
}
// __PARITY_END__

async function streamGenerate(endpoint, body, method = 'POST') {
  const outputSection = document.getElementById('outputSection');
  const outputNote = document.getElementById('outputNote');
  const streamStatus = document.getElementById('streamStatus');
  const generateBtn = document.getElementById('generateBtn');

  outputNote.value = '';
  outputSection.style.display = '';
  streamStatus.style.display = '';
  streamStatus.textContent = 'Generating your note…';
  generateBtn.disabled = true;
  clearSessionSummary(); // drop any prior note's tables while the new one streams
  // Reset the autosave indicator + any pending edit for the OLD note. savedNoteId is deliberately KEPT so a
  // re-generation UPDATEs the same server row (upsert-per-cycle); it is cleared only by Start-new / client switch.
  setSaveStateExt('idle');
  if (editDebounceTimer) { clearTimeout(editDebounceTimer); editDebounceTimer = null; }
  pendingEditText = null;

  let finalText = '';
  let blockedFlagged = [];
  let filteredText = null; // authoritative host-EHR-filtered note (what actually gets filled)

  try {
    {
      const res = await api(endpoint, { method, body: JSON.stringify(body) });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        streamStatus.style.display = 'none';
        showError(data.error || 'Generation failed. Please try again.');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';               // FULL accumulation — markers and the meta JSON are located over this, never one chunk
      let regenSignaled = false;
      let metaParsed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { note, metaRaw, sawRegen } = splitNoteStream(raw);

        // Coverage retry — fired once: FREEZE (stop painting), DIM, and show the calm finalizing status.
        // Matches the web (consumeNoteStream + note page): the streamed text never wipes/restarts.
        if (sawRegen && !regenSignaled) {
          regenSignaled = true;
          streamStatus.textContent = 'Finalizing your note…';
          outputNote.classList.add('finalizing');
        }

        // PROGRESSIVE PAINT (pass 1 only): the note types itself. Guarded by !sawRegen so once a regen begins
        // the display FREEZES on the last pass-1 text — pass 2 accumulates invisibly and the single end-swap
        // below reveals the finished note. This paints RAW; the end-swap to filteredText is what makes it
        // correct. Does NOT touch the __META__ accumulate-and-reparse / verify logic below.
        if (metaRaw === null && !sawRegen) {
          outputNote.value = note;
        }

        // __META__ seen: its JSON can span several reads, so parse the ACCUMULATED tail and keep reading on
        // failure. The old per-chunk parse broke HERE — a split tail threw, was swallowed, and the RAW note
        // shipped to copy/fill. Only a parseable tail ends the loop.
        if (metaRaw !== null) {
          try {
            const meta = JSON.parse(metaRaw);
            // Only a BLOCKING stop discards the note. An advisory is shown and the note is kept.
            if (meta.error) { showError(meta.error); if (meta.blocking !== false) { streamStatus.style.display = 'none'; return; } }
            if (Array.isArray(meta.blockedFlagged)) blockedFlagged = meta.blockedFlagged;
            if (typeof meta.filteredText === 'string') filteredText = meta.filteredText;
            metaParsed = true;
            break;
          } catch { /* partial meta JSON — keep reading until it completes */ }
        }
      }

      // Paint ONCE at the end — UX unchanged (no live streaming in this commit). filteredText is the
      // authoritative host-EHR-filtered note; it is applied IFF the meta tail parsed and carried it.
      const { note: bestNote } = splitNoteStream(raw);
      const verified = filteredText != null;
      finalText = verified ? filteredText : bestNote;
      outputNote.value = finalText;          // the single swap (filteredText when verified) over any painted text
      outputNote.classList.remove('finalizing'); // un-dim on the swap
      streamStatus.style.display = 'none';
      renderSessionSummary(finalText);       // the three tables under the note (matches the web)

      // GENERATION-TIME LOCAL BACKUP + AUTOSAVE. The backup persists the finished note the instant it exists
      // (recoverable no matter what the save does); `verified` is recorded so a recovered unverified note is
      // identifiable. backupKey is STABLE for this cycle so subsequent edits rewrite THIS record (the backup
      // then tracks edits, not just the generated text). Then autosave CREATES the server row (or UPDATEs it
      // on a re-generation — savedNoteId carries across the cycle). Fail-soft — a backup write must never
      // block or discard the note.
      if (selectedClientId && finalText) {
        try {
          backupKey = `path4aba_ext_note_${selectedClientId}_${Date.now()}`;
          backupRecord = { clientId: selectedClientId, note: finalText, generatedAt: new Date().toISOString(), verified };
          chrome.storage.local.set({ [backupKey]: backupRecord });
        } catch { /* best-effort backup; never interrupt the note */ }
        pendingEditText = null;  // the generated text is what we're about to autosave, not a pending edit
        queueSaveExt(finalText); // create (or update the same row on a re-generation)
      }

      if (!verified) {
        // FAIL LOUD, NEVER SILENT: unverified text reaching the EHR unnoticed is the exact bug this commit
        // closes. Paint it so the RBT is not stuck, but warn visibly and log — never present it as clean.
        console.error('[Path4ABA] note stream ended without applying filteredText (metaParsed=' + metaParsed + ') — painted UNVERIFIED text; warned RBT to regenerate.');
        showError('⚠️ This note could not be verified for blocked terms — please Regenerate before copying or filling the EHR. Do not send it as is.');
      } else if (blockedFlagged.length) {
        // Blocked narrative terms with no substitute were left in place — flag them so the RBT edits before
        // filling ABA Matrix (which would reject them on submit). Substituted terms are silent.
        showError('Heads up: ABA Matrix may reject these terms in the narrative — edit before filling: ' + blockedFlagged.join(', '));
      }
    }
  } catch {
    streamStatus.style.display = 'none';
    showError('Network error. Make sure you are logged into Path4ABA.');
  } finally {
    outputNote.classList.remove('finalizing'); // defensive un-dim for early-return (blocking) / error paths
    updateGenerateBtn();
  }
}

// ── Session-summary tables (under the generated note) ──────────────────────
// Matches the website: three stacked cards — Maladaptive Behaviors, Replacement Skills, Interventions Used.
// Behaviors/skills come from the RBT's selection; interventions from the SHARED parser (extract-interventions.js,
// parity-fenced with lib/extractInterventions.impl.js) on the note text. Each card has a "✓ Copied" copy button
// copying the same comma-joined string the web copies.
function clearSessionSummary() {
  const c = document.getElementById('sessionSummary');
  if (c) { c.innerHTML = ''; c.style.display = 'none'; }
}

function renderSessionSummary(noteText) {
  const container = document.getElementById('sessionSummary');
  if (!container) return;
  const interventions = (window.P4Interventions && typeof window.P4Interventions.extractInterventions === 'function')
    ? window.P4Interventions.extractInterventions(noteText || '')
    : [];
  const sections = [
    { label: 'Maladaptive Behaviors', items: selectedBehaviors.slice(), color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
    { label: 'Replacement Skills',    items: selectedSkills.slice(),    color: '#0D9488', bg: '#F0FDF4', border: '#99F6E4' },
    { label: 'Interventions Used',    items: interventions,             color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
  ];
  container.innerHTML = '';
  for (const sec of sections) {
    const card = document.createElement('div');
    card.style.cssText = `border:1px solid ${sec.border}; background:${sec.bg}; border-radius:10px; padding:10px; margin-top:8px;`;
    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:6px;';
    const lbl = document.createElement('span');
    lbl.textContent = sec.label;
    lbl.style.cssText = `font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:${sec.color};`;
    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    btn.style.cssText = `font-size:10px; padding:3px 8px; border-radius:7px; border:1px solid ${sec.color}; color:${sec.color}; background:white; cursor:pointer; flex-shrink:0;`;
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(sec.items.join(', ')).then(() => {
        btn.textContent = '✓ Copied';
        btn.style.borderColor = '#16A34A';
        btn.style.color = '#16A34A';
        setTimeout(() => { btn.textContent = 'Copy'; btn.style.borderColor = sec.color; btn.style.color = sec.color; }, 2000);
      });
    });
    head.appendChild(lbl);
    head.appendChild(btn);
    card.appendChild(head);
    const body = document.createElement('div');
    if (sec.items.length) {
      body.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';
      for (const item of sec.items) {
        const chip = document.createElement('span');
        chip.textContent = item;
        chip.style.cssText = `font-size:11px; padding:2px 7px; border-radius:6px; background:white; border:1px solid ${sec.border}; color:${sec.color};`;
        body.appendChild(chip);
      }
    } else {
      body.textContent = 'None recorded';
      body.style.cssText = 'font-size:11px; color:#9ca3af;';
    }
    card.appendChild(body);
    container.appendChild(card);
  }
  container.style.display = '';
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
  // Reset next appointment date field
  const nextApptEl = document.getElementById('nextApptDate');
  if (nextApptEl) nextApptEl.value = '';
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

// ── Autosave (no Save button) ──────────────────────────────────────────────
// The note persists automatically: created when generation finishes, updated on every re-generation, debounced
// edit, blur, and popup teardown (upsert-per-cycle). Durability, given the popup closes constantly:
//  • the local backup TRACKS EDITS (rewritten on every keystroke) — the edit is on the device instantly;
//  • the server save runs through the background service worker's FETCH proxy, which owns completion — so a
//    save DISPATCHED at teardown (visibilitychange→hidden / pagehide / blur) finishes even after the popup dies.
let lastSavedNoteText = null;   // the last text confirmed on the server (the "clean" marker for Start-new)
let lastSavedClientId = null;
let savedNoteId = null;         // the server row this cycle writes to (null ⇒ next save CREATEs; set ⇒ PATCHes)
let pendingEditText = null;     // latest un-flushed edit, for the teardown/blur flush
let backupKey = null;           // stable chrome.storage key for THIS cycle's backup (edits rewrite it)
let backupRecord = null;        // the backup value, so an edit can rewrite `note` while keeping generatedAt/verified
let saveState = 'idle';         // 'idle' | 'saving' | 'saved' | 'failed' — drives the indicator
let editDebounceTimer = null;
let saveFadeTimer = null;
let extSaveChain = Promise.resolve(true);  // serializes saves so a create finishes (id captured) before an edit-update

function renderSaveState() {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.onclick = null;
  el.style.cursor = '';
  if (saveState === 'saving') {
    el.style.display = ''; el.textContent = 'Saving…'; el.style.color = '#6b7280';
  } else if (saveState === 'saved') {
    el.style.display = ''; el.textContent = 'Saved ✓'; el.style.color = '#16a34a';
  } else if (saveState === 'failed') {
    // Persists until resolved (a message that vanishes is how a failed save gets missed) and is clickable to retry.
    el.style.display = ''; el.textContent = 'Save failed — tap to retry'; el.style.color = '#dc2626'; el.style.cursor = 'pointer';
    el.onclick = () => { const t = document.getElementById('outputNote').value; if (t && t.trim()) queueSaveExt(t); };
  } else {
    el.style.display = 'none'; el.textContent = '';
  }
}

function setSaveStateExt(s) { saveState = s; renderSaveState(); }

function markSavedExt() {
  setSaveStateExt('saved');
  if (saveFadeTimer) clearTimeout(saveFadeTimer);
  saveFadeTimer = setTimeout(() => { if (saveState === 'saved') setSaveStateExt('idle'); }, 3000);
}

// The upsert. CREATE (POST) when no id is tracked, capturing the id so later saves UPDATE (PATCH) that row.
//  • POST 409 (identical note exists) → adopt that id, "Saved ✓" (never a duplicate error).
//  • POST 422 (too similar / create-time guard) → surface the message, "failed" — the RBT varies + regenerates.
//  • PATCH 404 (row gone) → drop the id and re-create — work re-saved, never lost.
// One silent auto-retry precedes the persistent "failed". Returns true on save/adopt, false otherwise.
async function persistExtNote(noteText, opts = {}) {
  if (!noteText || !noteText.trim() || !selectedClientId) return false;
  const attempt = opts.attempt || 0;
  setSaveStateExt('saving');
  const sessionDate = (document.getElementById('genDate') && document.getElementById('genDate').value) || new Date().toISOString().split('T')[0];
  try {
    const id = savedNoteId;
    const payload = id
      ? { id, client_id: selectedClientId, note_text: noteText, session_date: sessionDate }
      : { client_id: selectedClientId, note_text: noteText, session_date: sessionDate };
    const res = await api('/api/extension/save-note', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));

    if (id && res.status === 404) { savedNoteId = null; return await persistExtNote(noteText, opts); }  // re-create
    if (!id && res.status === 422) {
      // Create-time similarity guard — a content issue, not a transient failure. Surface it; do not retry.
      setSaveStateExt('failed');
      showError(data.message || data.error || 'Note is too similar to a previous session. Please vary your session details.');
      return false;
    }
    if (!id && res.status === 409) {
      if (data.id) savedNoteId = data.id;  // adopt the existing note; edits now update it
      lastSavedNoteText = noteText; lastSavedClientId = selectedClientId;
      if (pendingEditText === noteText) pendingEditText = null;
      markSavedExt();
      return true;
    }
    if (res.ok) {
      if (data.id) savedNoteId = data.id;
      lastSavedNoteText = noteText; lastSavedClientId = selectedClientId;
      if (pendingEditText === noteText) pendingEditText = null;
      markSavedExt();
      return true;
    }
    throw new Error('save failed');
  } catch {
    if (attempt === 0) return await persistExtNote(noteText, { attempt: 1 });  // one silent auto-retry
    setSaveStateExt('failed');
    return false;
  }
}

// Serialize saves so the first CREATE finishes (id captured) before any edit-UPDATE runs — else a fast edit
// during the create could read a null id and create a second row.
function queueSaveExt(noteText) {
  const p = extSaveChain.catch(() => false).then(() => persistExtNote(noteText));
  extSaveChain = p.catch(() => false);
  return p;
}

// Best-effort server flush of the latest un-saved edit at teardown (visibilitychange→hidden / pagehide) or on
// a client switch. api() posts the FETCH message to the background service worker SYNCHRONOUSLY, and the SW
// owns completion (its keep-alive) — so the save finishes even as this popup tears down. The device backup
// already holds this text, so a dropped flush loses nothing.
function flushExtPending() {
  if (!pendingEditText || !pendingEditText.trim() || !selectedClientId) return;
  if (editDebounceTimer) { clearTimeout(editDebounceTimer); editDebounceTimer = null; }
  const id = savedNoteId;
  const sessionDate = (document.getElementById('genDate') && document.getElementById('genDate').value) || new Date().toISOString().split('T')[0];
  const payload = id
    ? { id, client_id: selectedClientId, note_text: pendingEditText, session_date: sessionDate }
    : { client_id: selectedClientId, note_text: pendingEditText, session_date: sessionDate };
  try {
    api('/api/extension/save-note', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }).catch(() => {});
  } catch { /* device backup already holds this edit; a failed flush loses nothing */ }
  pendingEditText = null;
}

// User edits to the generated note. (A) rewrite the DEVICE BACKUP in place first — synchronous, offline, never
// fails, so the edited text is on the device the instant it is typed; then debounce the server autosave.
(function wireNoteEditing() {
  const outputNoteEl = document.getElementById('outputNote');
  if (!outputNoteEl) return;
  outputNoteEl.addEventListener('input', () => {
    const v = outputNoteEl.value;
    if (backupKey && backupRecord) {
      backupRecord = { ...backupRecord, note: v, editedAt: new Date().toISOString() };
      try { chrome.storage.local.set({ [backupKey]: backupRecord }); } catch { /* best-effort */ }
    }
    pendingEditText = v;
    if (editDebounceTimer) clearTimeout(editDebounceTimer);
    editDebounceTimer = setTimeout(() => { queueSaveExt(v); }, 1200);
  });
  // Leaving the textarea flushes immediately — the cheapest coverage of type-then-click-away.
  outputNoteEl.addEventListener('blur', () => {
    if (editDebounceTimer) { clearTimeout(editDebounceTimer); editDebounceTimer = null; }
    if (pendingEditText && pendingEditText.trim()) queueSaveExt(pendingEditText);
  });
})();

// The popup closes constantly (any click outside), so teardown is the NORMAL path, not an edge case.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushExtPending(); });
window.addEventListener('pagehide', flushExtPending);

// ── Start new note (gated on save state) ────────────────────────────────────
// Clean → the plain confirm. Dirty (edited since the last save, or a save pending) → FLUSH first: on success
// the plain confirm; on failure never clear silently — an explicit discard confirm that names the local backup
// (which holds the edits). Mirrors the web Start-new gating.
document.getElementById('startNewBtn').addEventListener('click', async () => {
  if (editDebounceTimer) { clearTimeout(editDebounceTimer); editDebounceTimer = null; }
  const text = document.getElementById('outputNote').value;
  const doClear = () => {
    savedNoteId = null; pendingEditText = null; backupKey = null; backupRecord = null;
    setSaveStateExt('idle');
    resetAfterSave();
  };
  const dirty = !!(text && text.trim()) && text !== lastSavedNoteText;
  if (dirty) {
    const ok = await queueSaveExt(text);
    if (!ok) {
      if (confirm("This note could not be saved to this client's notes, so it won't appear there. The full note — including your edits — is kept as a local backup on this device, so it can still be recovered. Discard it here and start a new note anyway?")) doClear();
      return;
    }
  }
  if (confirm('Start a new note? This clears the form.')) doClear();
});

// ── Auth screen buttons ────────────────────
document.getElementById('loginBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://path4aba.app/login' });
});

document.getElementById('openAppBtn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://path4aba.app' });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
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
// ── What the last autofill actually put into Office Puzzle ───────────────────
// Captured at the moment the tasks are built, and read by the save path instead of being
// recomputed. This is not an optimisation: generateDailyPercentages still draws from
// Math.random(), so a second call produces a DIFFERENT week than the one now sitting on the
// datasheet. Persisting a regenerated week would recreate exactly the OP-vs-database
// divergence this is meant to close. Cleared when the client or period changes.
//
// Shape: { clientId, periodKey, malad: { name -> {sessionDate, value}[] },
//                               repl:  { name -> {sessionDate, pct, trials, sequence}[] } }
let lastFill = null;

function resetLastFill(clientId, periodKey) {
  if (!lastFill || lastFill.clientId !== clientId || lastFill.periodKey !== periodKey) {
    lastFill = { clientId: clientId, periodKey: periodKey, malad: {}, repl: {} };
  }
  return lastFill;
}

// The whole captured map for a period, or null when this save does not correspond to an
// autofill the popup performed (a bare Save press, or a different client/week). The builders
// then fall back to the projected value — still an estimate, still marked as one.
function fillsForPeriod(kind, clientId, periodKey) {
  if (!lastFill || lastFill.clientId !== clientId || lastFill.periodKey !== periodKey) return null;
  return lastFill[kind];
}

// ── Pure record builders ─────────────────────────────────────────────────────
// No DOM, no globals — everything they need is passed in, so lib/saveRecords.test.mjs can
// extract and exercise them. They decide WHAT IS PERSISTED; nothing here computes a value.

// value_origin is the provenance of the NUMBER; user_confirmed is whether a human attested
// it. They are orthogonal, which is why both columns exist: an RBT ticking "I confirm this
// data reflects actual session observation" over an autofilled week makes user_confirmed
// true while the value stays 'estimated'. Autofill's own auto-save attests nothing.
const ORIGIN_ESTIMATED = 'estimated';
const ORIGIN_RBT_EDITED = 'rbt_edited';
const ORIGIN_OBSERVED = 'observed';

function countCorrect(sequence) {
  return (sequence || []).filter(function (c) { return c === '+' || c === '＋'; }).length;
}

// One row per behavior per week. daily_values carries the per-day array EXACTLY as filled, so
// the readers that already prefer it (projected-values, DataTab) sum the real week instead of
// re-deriving it from a flat average.
function buildMaladaptiveRecords(input) {
  const out = [];
  const days = input.days || [];
  (input.items || []).forEach(function (item) {
    const filled = input.fills ? input.fills[item.name] : null;
    const dailyValues = filled
      ? days.map(function (d) {
          const hit = filled.find(function (f) { return f.sessionDate === d; });
          return hit ? hit.value : 0;
        })
      : null;
    const weeklyTotal = dailyValues
      ? dailyValues.reduce(function (a, b) { return a + b; }, 0)
      : Math.round(item.projectedValue || 0);
    days.forEach(function (sessionDate, idx) {
      out.push({
        clientId: input.clientId,
        behaviorName: item.name,
        weekStart: input.weekStart,
        weekEnd: input.weekEnd,
        sessionDate: sessionDate,
        frequency: dailyValues ? dailyValues[idx] : Math.round(weeklyTotal / (days.length || 1)),
        dailyValues: dailyValues,
        userConfirmed: !!input.userConfirmed,
        autofillCompleted: !!input.autofillCompleted,
        valueOrigin: input.valueOrigin,
      });
    });
  });
  return out;
}

// One row per skill per day. The +/- pattern that was clicked into OP is persisted, and the
// correct/incorrect counts are derived FROM that pattern — so total_trials, the counts and
// observed_percentage finally describe the same session instead of three unrelated numbers.
function buildReplacementRecords(input) {
  const out = [];
  const days = input.days || [];
  (input.items || []).forEach(function (item) {
    const filled = input.fills ? input.fills[item.name] : null;
    days.forEach(function (sessionDate) {
      const hit = filled ? filled.find(function (f) { return f.sessionDate === sessionDate; }) : null;
      const sequence = hit ? hit.sequence : null;
      const trials = (hit && hit.trials) || input.trials || 10;
      const pct = hit ? hit.pct : item.projectedValue;
      const correct = sequence ? countCorrect(sequence) : Math.round((pct || 0) / 100 * trials);
      out.push({
        clientId: input.clientId,
        replacementSkill: item.name,
        weekStart: input.weekStart,
        weekEnd: input.weekEnd,
        sessionDate: sessionDate,
        observedPercentage: pct,
        totalTrials: trials,
        correctCount: correct,
        incorrectCount: Math.max(0, trials - correct),
        alternatedSequence: sequence ? sequence.join('') : null,
        userConfirmed: !!input.userConfirmed,
        autofillCompleted: !!input.autofillCompleted,
        platformSource: 'extension',
        valueOrigin: input.valueOrigin,
      });
    });
  });
  return out;
}

// The injected autofiller has no closure over the popup's scripts, so the shared name
// matcher has to be put into the OP page itself before the function is injected.
async function injectNameMatch(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['name-match.js'], world: 'MAIN' });
}

// Returns { ok: true, opDataMap } or { ok: false, error }.
async function fetchOpDataMapForTab(tab) {
  return { ok: true, opDataMap: {} };
}

// ── Auto-save gate ───────────────────────────────────────────────────────────
// An auto-save writes userConfirmed / autofillCompleted = true — a claim that the OP
// sheet now matches what Path4ABA is about to store. That claim may only be made when
// NOTHING in the run is in a non-verified state, so the gate is "zero ❌", not "at least
// one ✓". Previously one success alongside twenty-four failures still saved as confirmed.
//
// ⚪ does NOT block. It marks a day with nothing to record (a zero-frequency day), and a
// blank OP frequency cell and a stored 0 say the same thing — an all-zero week is a
// correct outcome, not a failure.
//
// log.length > 0 matters: if the injection returns nothing (tab closed mid-run, script
// rejected), the log is empty and "zero errors" would otherwise read as success.
function autofillVerified(log, errs) {
  return log.length > 0 && errs.length === 0;
}

// What the RBT sees when the gate blocks. Names the failure and the next step, rather
// than leaving them with a red box and no action. Mirrors the two-phase confirm in the
// corrections flow (data-tab-logic.js): nothing is committed until a human has looked
// at OP. The manual "Save to Path4ABA" button is deliberately still live — it is the
// escape hatch, used AFTER verifying, not a bypass.
function autofillBlockedMessage(log, errs) {
  if (!log.length) {
    return 'Not saved — Office Puzzle returned no result, so nothing could be verified. '
         + 'Check that the datasheet tab is still open, then run the autofill again.';
  }
  // A failing day produces TWO ❌ lines — the day itself and the per-behavior summary —
  // so counting `errs` would double-report it. Per-day lines are the ones naming a day;
  // fall back to the raw list if the log shape ever changes.
  const dayErrs = errs.filter(l => /\bday \d+\b/.test(l));
  const failed  = dayErrs.length ? dayErrs : errs;
  const first   = (failed[0] || '').replace(/^❌\s*/, '').trim();
  const more    = failed.length > 1 ? ` (+${failed.length - 1} more)` : '';
  return `Not saved — ${failed.length} step${failed.length === 1 ? '' : 's'} failed. `
       + `First: ${first}${more}. `
       + 'Fix these in Office Puzzle. Once the sheet looks right, tap "Save to Path4ABA" below to record it.';
}

async function runSingleAutofill(type) {
  const day      = parseInt(document.getElementById('singleDay').value);
  const statusId = type === 'maladaptive' ? 'singleMaladStatus' : 'singleReplStatus';
  const btnId    = type === 'maladaptive' ? 'autofillSingleMaladBtn' : 'autofillSingleReplBtn';
  if (!day || !projectedItems.length) { setStatus(statusId, 'No data loaded.', true); return; }

  // Deterministic seed per skill+date for the single session date. Computed before the
  // quality adjustment because it is also that adjustment's period key.
  const month   = parseInt(document.getElementById('singleMonth').value);
  const year    = new Date().getFullYear();
  const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  const adjustedItems = applySessionQualityAdjustment(projectedItems, dateStr);
  const items = adjustedItems.filter(i => i.type === type);
  if (!items.length) { setStatus(statusId, `No ${type} data.`, true); return; }

  const fill = resetLastFill(selectedClientId, dateStr);
  const tasks = items.map(item => {
    if (type === 'maladaptive') {
      const value = item.dailyValue ?? Math.round((item.projectedValue || 0) / 5);
      // Record what OP is about to receive, so the save persists this exact number.
      fill.malad[item.name] = [{ sessionDate: dateStr, value }];
      return { name: item.name, dayNumber: day, type, value };
    }
    // Replacement: use projectedValue directly, one varied sequence per skill.
    const pct      = item.projectedValue;
    const correct  = Math.min(trialsPerSession, Math.max(0, Math.round((pct || 0) / 100 * trialsPerSession)));
    const sequence = generateVariedSequence(correct, trialsPerSession - correct, simpleHash(item.name + dateStr));
    fill.repl[item.name] = [{ sessionDate: dateStr, pct, trials: trialsPerSession, sequence }];
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
    await injectNameMatch(tab.id);
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: officePuzzleDatasheetAutofiller, args: [tasks, opData.opDataMap], world: 'MAIN' });
    const log  = result?.[0]?.result || [];
    const errs = log.filter(l => l.startsWith('❌'));
    const verified = autofillVerified(log, errs);
    setStatus(statusId,
      verified ? (log[0] || 'No result.').replace(/^[✓⚪]\s*/, '') : autofillBlockedMessage(log, errs),
      !verified);
    if (verified && document.getElementById('singleConfirmCheck')?.checked) await saveSingleData(false);
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

  // The DB must receive what OP received. runSingleAutofill adjusts before filling and this
  // path did not adjust at all, so single-day OP carried adjusted values while the database
  // carried unadjusted ones. Fixed on THIS side: removing the adjustment from the autofill
  // would change what lands on the datasheet, which is not what this commit is for. The
  // adjustment is seeded on (clientId, name, dateStr), so this reproduces the autofill's
  // numbers exactly rather than re-rolling them.
  const adjusted = applySessionQualityAdjustment(projectedItems, dateStr);

  // userInitiated = the RBT ticked "I confirm this data reflects actual session observation"
  // and pressed Save. That is the explicit human confirmation; autofill's own auto-save is not.
  const confirmed = !!userInitiated;

  const replRecs = buildReplacementRecords({
    clientId: selectedClientId, items: adjusted.filter(i => i.type === 'replacement'),
    days: [dateStr], weekStart, weekEnd, trials: trialsPerSession,
    fills: fillsForPeriod('repl', selectedClientId, dateStr),
    userConfirmed: confirmed, autofillCompleted: true, valueOrigin: ORIGIN_ESTIMATED,
  });
  const maladRecs = buildMaladaptiveRecords({
    clientId: selectedClientId, items: adjusted.filter(i => i.type === 'maladaptive'),
    days: [dateStr], weekStart, weekEnd,
    fills: fillsForPeriod('malad', selectedClientId, dateStr),
    userConfirmed: confirmed, autofillCompleted: true, valueOrigin: ORIGIN_ESTIMATED,
  });

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

// `periodKey` is the session date (single-day mode) or the week start (week mode). It is
// part of the seed, so the SAME client + target + period always yields the SAME adjustment.
// This used to draw from Math.random() and was called independently by the autofill and by
// the save — two draws, two different numbers, so Office Puzzle and Path4ABA recorded
// different values for one session.
function applySessionQualityAdjustment(items, periodKey) {
  if (complianceLevel === 'typical' && !environmentalChange) return items;
  return items.map(item => {
    const rng = mulberry32(maladaptiveSeed(selectedClientId, item.name, periodKey));
    let adjusted = { ...item };
    if (item.type === 'maladaptive') {
      let increase = 0;
      if (environmentalChange && complianceLevel === 'poor') {
        // Poor compliance + environmental change: move 5-6
        increase = Math.floor(rng() * 2) + 5;
      } else if (complianceLevel === 'poor') {
        // Poor compliance: move 5-6
        increase = Math.floor(rng() * 2) + 5;
      } else if (complianceLevel === 'below_typical') {
        // Below typical: move 4-5
        increase = Math.floor(rng() * 2) + 4;
      } else if (complianceLevel === 'typical') {
        // Typical session: normal variance 1-4
        increase = Math.floor(rng() * 4) + 1;
        // Can go up or down in typical sessions
        increase = rng() > 0.5 ? increase : -increase;
      }
      adjusted.projectedValue = Math.max(0, item.projectedValue + increase);
      adjusted.dailyValue = adjusted.dailyValue
        ? Math.max(0, item.dailyValue + Math.round(increase / 5))
        : undefined;
    } else if (item.type === 'replacement') {
      let change = 0;
      if (environmentalChange && complianceLevel === 'poor') {
        // Poor compliance + environmental change: drop 5-6%
        change = -(Math.floor(rng() * 2) + 5);
      } else if (complianceLevel === 'poor') {
        // Poor compliance: drop 5-6%
        change = -(Math.floor(rng() * 2) + 5);
      } else if (complianceLevel === 'below_typical') {
        // Below typical: drop 4-5%
        change = -(Math.floor(rng() * 2) + 4);
      } else if (complianceLevel === 'typical') {
        // Typical session: normal variance 1-4%
        change = Math.floor(rng() * 4) + 1;
        // Can go up or down in typical sessions
        change = rng() > 0.5 ? change : -change;
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
  // Same period key saveWeekData uses, so the values filled into OP are the values saved.
  const weekStartKey = document.getElementById('weekStartDate')?.value || '';
  const adjustedItems = applySessionQualityAdjustment(projectedItems, weekStartKey);
  const items = adjustedItems.filter(i => i.type === type);
  if (!items.length) { setStatus(statusId, `No ${type} data found.`, true); return; }

  const workedCount = workedDayDates.length;
  const fill = resetLastFill(selectedClientId, weekStartKey);
  const tasks = [];
  if (type === 'replacement') {
    // Spread each skill's weekly average across worked days with natural variation,
    // and generate a deterministic varied sequence per skill+date.
    items.forEach(item => {
      const dailyPcts = generateDailyPercentages(item.projectedValue, workedCount);
      fill.repl[item.name] = [];
      workedDayDates.forEach((dateStr, idx) => {
        const dayNum   = new Date(dateStr + 'T00:00:00').getDate();
        const dailyPct = dailyPcts[idx];
        const correct  = Math.min(trialsPerSession, Math.max(0, Math.round((dailyPct || 0) / 100 * trialsPerSession)));
        const sequence = generateVariedSequence(correct, trialsPerSession - correct, simpleHash(item.name + dateStr));
        // generateDailyPercentages is NOT seeded — this per-day percentage cannot be
        // reproduced later, so it is recorded here or it is lost.
        fill.repl[item.name].push({ sessionDate: dateStr, pct: dailyPct, trials: trialsPerSession, sequence });
        tasks.push({ name: item.name, dayNumber: dayNum, type: 'replacement', value: dailyPct, trials: trialsPerSession, sequence });
      });
    });
  } else {
    // Spread each behavior's weekly total across worked days with natural
    // variation (summing to the total) instead of an identical per-day value.
    items.forEach(item => {
      const dailyVals = distributeMaladaptiveAcrossDays(
        Math.round(item.projectedValue),
        workedDayDates.length,
        maladaptiveSeed(selectedClientId, item.name, weekStartKey)
      );
      fill.malad[item.name] = [];
      workedDayDates.forEach((dateStr, idx) => {
        const dayNum = new Date(dateStr + 'T00:00:00').getDate();
        fill.malad[item.name].push({ sessionDate: dateStr, value: dailyVals[idx] });
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
    await injectNameMatch(tab.id);
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: officePuzzleDatasheetAutofiller, args: [tasks, opDataMap], world: 'MAIN' });
    const log  = result?.[0]?.result || [];
    const errs = log.filter(l => l.startsWith('❌'));
    const verified = autofillVerified(log, errs);
    setStatus(statusId,
      verified ? (log[0] || 'No result.').replace(/^[✓⚪]\s*/, '') : autofillBlockedMessage(log, errs),
      !verified);
    if (verified && document.getElementById('weekConfirmCheck')?.checked) await saveWeekData(false);
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
  const qualityAdjusted = applySessionQualityAdjustment(projectedItems, weekStart);

  // userInitiated = the RBT ticked the confirmation box and pressed Save. The auto-save that
  // follows a successful autofill attests nothing and must not claim otherwise.
  const confirmed = !!userInitiated;

  // Each row now carries the day it describes: the per-day frequency and, on the week's rows,
  // the daily_values array exactly as filled. The old shape saved
  // Math.round(projectedValue / workedCount) — one flat average repeated across every day,
  // while OP received a varied distribution.
  const replRecs = buildReplacementRecords({
    clientId: selectedClientId, items: qualityAdjusted.filter(i => i.type === 'replacement'),
    days: workedDayDates, weekStart, weekEnd, trials: trialsPerSession,
    fills: fillsForPeriod('repl', selectedClientId, weekStart),
    userConfirmed: confirmed, autofillCompleted: true, valueOrigin: ORIGIN_ESTIMATED,
  });
  const maladRecs = buildMaladaptiveRecords({
    clientId: selectedClientId, items: qualityAdjusted.filter(i => i.type === 'maladaptive'),
    days: workedDayDates, weekStart, weekEnd,
    fills: fillsForPeriod('malad', selectedClientId, weekStart),
    userConfirmed: confirmed, autofillCompleted: true, valueOrigin: ORIGIN_ESTIMATED,
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

// AI Fill (Beta) double-click guard: the button is disabled while a fill runs and re-enabled on the form
// agent's terminal 'done' message, the sendMessage error callback, or a 60s timeout fallback (so a lost
// message can never leave it stuck). Prevents the double-fill (5 maladaptive → 10) from a second click.
let aiFillTimeout = null;
function reEnableAiFill() {
  if (aiFillTimeout) { clearTimeout(aiFillTimeout); aiFillTimeout = null; }
  const aiBtn = document.getElementById('aiFillBetaBtn');
  if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '✨ AI Fill (Beta)'; }
}

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
    // Only render non-empty text — the terminal 'done' message carries empty text and must not clobber the
    // last real status line.
    if (statusDiv && typeof message.text === 'string' && message.text !== '') {
      statusDiv.style.display = 'block';
      statusDiv.textContent = message.text;
    }
    // Terminal signal from runFormAgent's finally (fires on success, early return, or error) → the fill is
    // over, re-enable the button.
    if (message.done) reEnableAiFill();
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
      const QUIET_REASONS = ['INVALID', 'NEEDS_REVIEW', 'FUNCTION_ANTECEDENT_CONFLICT', 'INFERRED_FROM_ANTECEDENT', 'FUNCTION_NOT_APPROVED', 'METHOD_DEFAULTED'];
      const reason = r.reason && QUIET_REASONS.indexOf(r.reason) === -1 ? ` — ${r.reason}` : '';
      let extra = '';
      if (r.reason === 'NO_MATCHING_OPTION') {
        const opts = Array.isArray(r.options) ? r.options : [];
        const wanted = r.intended == null ? '' : String(r.intended);
        extra = ` (wanted “${wanted}”; available: ${opts.length ? opts.join(', ') : 'none'})`;
      } else if (r.reason === 'AMBIGUOUS_MATCH') {
        const wanted = r.intended == null ? '' : String(r.intended);
        const cands = Array.isArray(r.candidates) ? r.candidates : [];
        extra = ` left blank — “${wanted}” matched more than one option (${cands.join(', ')}); refused rather than fill the wrong behavior. Select the correct row manually.`;
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
      } else if (r.reason === 'METHOD_DEFAULTED') {
        // Teaching method: the note didn't name one for this goal, so we filled an approved method.
        const approved = Array.isArray(r.approved) ? r.approved.join(', ') : '';
        extra = ` → set to ${r.intended} from the plan’s approved teaching methods (the note didn’t name one for this goal; approved: ${approved}) — verify`;
      } else if (r.reason === 'NO_APPROVED_METHOD') {
        // Config gap: the assessment approves NO teaching method for this client.
        extra = ` left blank — this client’s assessment approves NO teaching method, so none can be filled. The BCBA must add an approved teaching method to the assessment.`;
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
  const aiBtn = document.getElementById('aiFillBetaBtn');
  if (aiBtn && aiBtn.disabled) return; // already filling — ignore the second click

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

  // Disable while the fill runs (prevents the double-click double-fill). Re-enabled by the terminal 'done'
  // message (listener above), the error branch below, or the 60s timeout fallback.
  if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = 'Filling…'; }
  if (aiFillTimeout) clearTimeout(aiFillTimeout);
  aiFillTimeout = setTimeout(reEnableAiFill, 60000);

  chrome.runtime.sendMessage({ action: 'runFormAgent', noteData }, (response) => {
    // NOTE: this callback fires when the agent STARTS (background ack), not when the fill completes — so on
    // success we do NOT re-enable here (that would reopen the double-click window). Re-enable only on an
    // error, where the agent never started and no terminal 'done' will arrive.
    if (chrome.runtime.lastError) {
      console.error('[Path4ABA] runFormAgent error:', chrome.runtime.lastError.message);
      if (statusDiv) statusDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
      reEnableAiFill();
    } else {
      if (response && response.ok === false) {
        if (statusDiv) statusDiv.textContent = 'Error: ' + (response.error || 'agent did not start (reload the ABA Matrix page)');
        reEnableAiFill();
      }
    }
  });
});

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

    // RESOLUTION tier — `shared2`. Two shared words rather than one, so two unrelated
    // programs sharing a single word ("routines", "play") are not merged into one series.
    function resolveChartName(chartName, isReplacement) {
      const pool = isReplacement ? profileSkills : profileBehaviors;
      return window.P4NameMatch.resolveName(chartName, pool, 'shared2');
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
            // Read off Office Puzzle's own charts — a real recorded observation, not an
            // estimate, and the RBT pressed Save on it.
            userConfirmed: true,
            valueOrigin: ORIGIN_OBSERVED,
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
            valueOrigin: ORIGIN_OBSERVED,
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
  // An injected `func:` carries ONLY its own body — no closure, no imports. That is why the
  // two h4 matchers below used to be inline copies of the normalizer. name-match.js is now
  // injected into this page first (see injectNameMatch), so both reach the one shared
  // implementation instead. If it is missing, fail loudly rather than silently mismatching.
  const P4 = window.P4NameMatch;
  if (!P4) return ['❌ Name matcher failed to load into the Office Puzzle page. Reload the tab and try again.'];

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
    let targetCol = -1;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (!cells.length || cells[0].textContent.trim() !== 'Days') continue;
      // col 1 is always the previous-month overflow — skip it, search the rest
      cells.forEach((cell, colIdx) => {
        if (colIdx === 1) return;
        const raw = cell.textContent.trim();
        // Match "11" for day 11, and also "01" for day 1 (zero-padded cells)
        if (parseInt(raw, 10) === day && /^\d{1,2}$/.test(raw)) targetCol = colIdx;
      });
      break; // Days row is unique per table — stop after finding it
    }

    return targetCol;
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
    // filledDays = days where a cell was ACTUALLY clicked. skippedDays = days that
    // legitimately had nothing to record (zero frequency, or an untouchable column).
    // Kept apart so the per-behavior summary can tell "nothing to do" from "failed".
    const filledDays = [];
    const skippedDays = [];

    for (const task of nameTasks) {
      try {
        // DOM click approach — find the table for this behavior and click cells
        const orderedElements = Array.from(document.querySelectorAll('h4, table'));
        const h4Els = orderedElements.filter(el => el.tagName === 'H4');
        // APPLY tier — `strict`. Never widen this: "Defiant Behavior", "Off-Task Behavior"
        // and "Self-Injurious Behavior (SIB)" all share the word "Behavior" with "Disruptive
        // Behavior", and a shared-word match here writes a frequency onto the wrong target.
        // The shared matcher also strips OP's quoting and applies the acronym layer, which is
        // what finally lets "Self-Injurious Behavior (SIB)" match "Self-Injury Behaviors (SIB)".
        const h4El = h4Els.find(h => P4.namesMatch(h.innerText, name, 'strict'));
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
              // Same APPLY tier as the maladaptive lookup above — one implementation.
              if (el.tagName === 'H4') {
                if (P4.namesMatch(el.innerText, name, 'strict')) { pastH4 = true; continue; }
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
            skippedDays.push(task.dayNumber);
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

          // Report what was CLICKED, not what was intended. shuffleArray(...).slice(0, diff)
          // silently yields fewer cells when there aren't enough －/＋ to flip, so the column
          // can end short of target — the old line printed |diff| and targetCorrect either way.
          // A day is a ✓ ONLY when OP actually reached the target; anything short must NOT ride
          // a ✓, or the week auto-saves a value OP never received (same principle that closed the
          // maladaptive no-click paths). diff === 0 means it was already at target — a real success.
          const reached = currentCorrect + (diff > 0 ? clickCount : -clickCount);
          if (reached !== targetCorrect) {
            // Both shapes block (❌ → errs → verified false → no auto-save). The wording, not the
            // marker, distinguishes "nothing moved" from "moved, but short" — to the gate they are
            // the same event: OP is short of the value we would record.
            if (clickCount === 0) {
              log.push(`❌ "${name}" day ${task.dayNumber} — needed ${Math.abs(diff)} cell(s) to reach ${targetCorrect} of ${totalTrials}, but no flippable cell was available; nothing clicked`);
            } else {
              log.push(`❌ "${name}" day ${task.dayNumber} — TARGET NOT REACHED: reached ${reached} of ${totalTrials} correct, needed ${targetCorrect} (clicked ${clickCount} of ${Math.abs(diff)} cell(s)); Office Puzzle is short of the recorded value`);
            }
            await delay(300);
            continue;
          }
          filledDays.push(task.dayNumber);
          log.push(`✓ "${name}" day ${task.dayNumber} — ${clickCount} cell(s) changed (${currentCorrect}→${reached} of ${totalTrials} correct${diff === 0 ? ', already at target' : ''}, ${emptyCells.length} empty cells untouched${activatedEmpty ? ', activated empty column' : ''})`);
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

        if (task.type !== 'replacement') {
          // Maladaptive: OP frequency rows are cumulative — one click on the row
          // for frequency N automatically marks all rows 1..N. One click per day.
          //
          // Every way of NOT clicking is now explicit. Previously all three fell through
          // to an unconditional filledDays.push, so a day where nothing happened still
          // produced the ✓ summary line — which is what auto-fires saveWeekData.

          // Zero occurrences: legitimate (distributeMaladaptiveAcrossDays emits zeros
          // whenever the weekly total is below the number of worked days). Not an error.
          // <= 0 rather than === 0 so a negative can't fall through to freqRows[-2].
          if (freq <= 0) {
            if (wasHidden) behaviorContainer.classList.add('d-none');
            skippedDays.push(task.dayNumber);
            log.push(`⚪ "${name}" day ${task.dayNumber} — skipped (0 occurrences, nothing to record)`);
            await delay(300);
            continue;
          }

          // Requested frequency the sheet cannot represent. NOT clamped — a value the
          // datasheet has no row for is a real data problem the RBT has to see.
          if (freq > freqRows.length) {
            if (wasHidden) behaviorContainer.classList.add('d-none');
            log.push(`❌ "${name}" day ${task.dayNumber} — frequency ${freq} exceeds the ${freqRows.length} frequency row(s) on this sheet; nothing clicked`);
            await delay(300);
            continue;
          }

          const targetRow = freqRows[freq - 1];
          const cell = targetRow ? Array.from(targetRow.querySelectorAll('td'))[colIdx] : null;
          if (!cell) {
            if (wasHidden) behaviorContainer.classList.add('d-none');
            log.push(`❌ "${name}" day ${task.dayNumber} — row ${freq} has no cell at column ${colIdx}; nothing clicked`);
            await delay(300);
            continue;
          }

          cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await delay(200);
          cell.click();
          await delay(200);
          if (wasHidden) behaviorContainer.classList.add('d-none');
          filledDays.push(task.dayNumber);
          log.push(`✓ "${name}" day ${task.dayNumber} — clicked row ${freq} (freq: ${freq})`);
          await delay(300);
          continue;
        }
      } catch(e) {
        log.push(`❌ "${name}" day ${task.dayNumber} — error: ${e.message}`);
      }

      await delay(300);
    }

    // The summary is what the caller counts (log lines starting with ✓) to decide whether
    // the fill succeeded and whether to auto-save. It must therefore describe clicks that
    // actually happened, never days that were merely attempted.
    if (filledDays.length) {
      const daysStr = filledDays.length === 1 ? `day ${filledDays[0]}` : `days ${filledDays.join(', ')}`;
      const skipNote = skippedDays.length ? ` · ${skippedDays.length} day(s) skipped, nothing to record` : '';
      log.push(`✓ "${name}" filled (${daysStr})${skipNote}`);
    } else if (skippedDays.length === nameTasks.length) {
      // Every day legitimately had nothing to record (e.g. a zero-frequency week). Neither
      // a fill nor a failure — ⚪ so it counts toward neither ok nor errs in the caller.
      log.push(`⚪ "${name}" — nothing to record on any of the ${nameTasks.length} day(s)`);
    } else {
      log.push(`❌ "${name}" — no days filled (0 of ${nameTasks.length} attempted)`);
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
