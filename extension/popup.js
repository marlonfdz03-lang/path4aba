// ─────────────────────────────────────────────
//  Path4ABA Extension — popup.js
//  Auth: credentials:include (browser sends path4aba.app Supabase cookies)
//  The app's middleware must allow CORS for chrome-extension:// origins.
//  See middleware.ts for the required server-side change.
// ─────────────────────────────────────────────

const BASE = 'https://path4aba.app';

// ── State ──────────────────────────────────
let userRole = null;     // 'rbt' | 'bcba'
let clients = [];
let selectedClientId = null;
let selectedProfile = null;  // client's clinical_profile
let selectedBehaviors = [];  // names
let selectedSkills = [];     // names
let selectedLocation = null;
let activeTab = 'generate';

// Auth token (replaces cookie-based auth)
let extensionToken = null;

// Office Puzzle extraction state
let extractedCharts = [];
let extractedClientName = null;

// Session condition state
let selectedPresent = [];
let environmentalChange = false;
let medicationChange = false;
let missedSessions = false;
let complianceLevel = 'typical';

// ── API helper ─────────────────────────────
const INIT_TIMEOUT_MS = 6000;

function apiWithTimeout(path, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return api(path, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
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
    const res = await fetch(url, {
      credentials: credentialsMode,
      ...options,
      headers: {
        ...baseHeaders,
        ...authHeaders,
        ...(options.headers || {}),
      },
    });
    // Token rejected — clear it and show setup screen
    if (res.status === 401 && extensionToken) {
      extensionToken = null;
      chrome.storage.local.remove('extensionToken');
      showScreen('token');
      const errEl = document.getElementById('tokenError');
      if (errEl) { errEl.textContent = 'Token expired or revoked. Generate a new one.'; errEl.style.display = ''; }
    }
    return res;
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
  // Remove any existing error
  document.querySelectorAll('.error-msg').forEach(e => e.remove());
  const el = document.createElement('p');
  el.className = 'error-msg';
  el.textContent = msg;
  const activeContent = document.getElementById(`tabContent-${activeTab}`);
  if (activeContent) activeContent.appendChild(el);
}

// ── Init ───────────────────────────────────
async function init() {
  showScreen('loading');

  // Load persisted token before making any API call
  const stored = await chrome.storage.local.get('extensionToken');
  extensionToken = stored.extensionToken || null;

  // No token → ask user to set one up (don't hit the API)
  if (!extensionToken) {
    showScreen('token');
    return;
  }

  // Fire both role checks in parallel with a shared timeout.
  const [bcbaResult, rbtResult] = await Promise.allSettled([
    apiWithTimeout('/api/bcba/clients', INIT_TIMEOUT_MS),
    apiWithTimeout('/api/rbt/clients', INIT_TIMEOUT_MS),
  ]);

  const bcbaRes = bcbaResult.status === 'fulfilled' ? bcbaResult.value : null;
  const rbtRes  = rbtResult.status  === 'fulfilled' ? rbtResult.value  : null;

  // 401 with a token means the token was revoked — clear it and ask for a new one
  if (bcbaRes?.status === 401 || rbtRes?.status === 401) {
    extensionToken = null;
    chrome.storage.local.remove('extensionToken');
    showScreen('token');
    const errEl = document.getElementById('tokenError');
    if (errEl) { errEl.textContent = 'Token is no longer valid. Generate a new one in Path4ABA Settings.'; errEl.style.display = ''; }
    return;
  }

  // BCBA with clients
  if (bcbaRes?.ok) {
    let json;
    try { json = await bcbaRes.json(); } catch { json = {}; }
    if (json.clients?.length) {
      userRole = 'bcba';
      clients = json.clients;
      setupMainScreen();
      showScreen('main');
      return;
    }
  }

  // RBT with clients
  if (rbtRes?.ok) {
    let json;
    try { json = await rbtRes.json(); } catch { json = {}; }
    if (json.clients?.length) {
      userRole = 'rbt';
      clients = json.clients;
      setupMainScreen();
      showScreen('main');
      return;
    }
  }

  // Both requests timed out or had a network error
  const timedOut = bcbaResult.status === 'rejected' || rbtResult.status === 'rejected';
  if (timedOut) {
    showScreen('token');
    const errEl = document.getElementById('tokenError');
    if (errEl) { errEl.textContent = 'Connection timed out. Check your network and try again.'; errEl.style.display = ''; }
    return;
  }

  // Authenticated but no clients assigned to this account
  if (bcbaRes?.ok || rbtRes?.ok) {
    showScreen('no-clients');
    return;
  }

  // Unexpected state — show token screen as fallback
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

  try {
    const res = await api(`/api/bcba/client/${clientId}`);
    if (!res.ok) {
      // RBTs don't have access to bcba/client endpoint — use profile from client list
      const fallback = clients.find(c => c.id === clientId);
      selectedProfile = fallback?.clinical_profile || null;
    } else {
      const json = await res.json();
      selectedProfile = json.client?.clinical_profile || null;
    }
  } catch {
    selectedProfile = null;
  }

  renderBehaviors();
  renderSkills();
  renderPresent();
  renderAutofillSheetsInputs();
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
    .map(b => (typeof b === 'string' ? b : b?.name || ''))
    .filter(Boolean);

  if (!behaviors.length) {
    grid.innerHTML = '';
    noMsg.style.display = '';
    return;
  }
  noMsg.style.display = 'none';

  const maxSel = userRole === 'rbt' ? 5 : 99;
  hint.textContent = userRole === 'rbt' ? `(select 5)` : '(optional)';

  grid.innerHTML = '';
  behaviors.forEach(name => {
    const item = document.createElement('div');
    item.className = 'check-item';
    item.dataset.name = name;
    item.innerHTML = `
      <div class="check-box">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="white">
          <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z"/>
        </svg>
      </div>
      <span>${name}</span>
    `;
    item.addEventListener('click', () => {
      if (item.classList.contains('checked')) {
        item.classList.remove('checked');
        selectedBehaviors = selectedBehaviors.filter(n => n !== name);
      } else if (selectedBehaviors.length < maxSel) {
        item.classList.add('checked');
        selectedBehaviors.push(name);
      }
      // Dim unchecked items when at limit
      grid.querySelectorAll('.check-item').forEach(el => {
        if (!el.classList.contains('checked')) {
          el.classList.toggle('disabled', selectedBehaviors.length >= maxSel);
        }
      });
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
    .map(s => (typeof s === 'string' ? s : s?.name || ''))
    .filter(Boolean);

  if (!skills.length) {
    grid.innerHTML = '';
    noMsg.style.display = '';
    return;
  }
  noMsg.style.display = 'none';

  const maxSel = userRole === 'rbt' ? 2 : 99;
  hint.textContent = userRole === 'rbt' ? `(select 2)` : '(optional)';

  grid.innerHTML = '';
  skills.forEach(name => {
    const item = document.createElement('div');
    item.className = 'check-item';
    item.dataset.name = name;
    item.innerHTML = `
      <div class="check-box">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="white">
          <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z"/>
        </svg>
      </div>
      <span>${name}</span>
    `;
    item.addEventListener('click', () => {
      if (item.classList.contains('checked')) {
        item.classList.remove('checked');
        selectedSkills = selectedSkills.filter(n => n !== name);
      } else if (selectedSkills.length < maxSel) {
        item.classList.add('checked');
        selectedSkills.push(name);
      }
      grid.querySelectorAll('.check-item').forEach(el => {
        if (!el.classList.contains('checked')) {
          el.classList.toggle('disabled', selectedSkills.length >= maxSel);
        }
      });
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
    item.innerHTML = `
      <div class="check-box">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="white">
          <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z"/>
        </svg>
      </div>
      <span>${name}</span>
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
  });
}

// ── Reset session conditions ───────────────
function resetSessionConditions() {
  selectedPresent = [];
  environmentalChange = false;
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
    if (id === 'envGroup') environmentalChange = btn.dataset.val === 'yes';
    else if (id === 'medGroup') medicationChange = btn.dataset.val === 'yes';
    else if (id === 'missedGroup') missedSessions = btn.dataset.val === 'yes';
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

// ── Generate button state ──────────────────
function updateGenerateBtn() {
  const dateVal = document.getElementById('genDate').value;
  let canGenerate = !!dateVal && !!selectedLocation && !!selectedClientId && selectedPresent.length > 0;

  if (userRole === 'rbt') {
    canGenerate = canGenerate && selectedBehaviors.length === 5 && selectedSkills.length === 2;
    const hint = document.getElementById('generateHint');
    if (!canGenerate && selectedClientId) {
      const missing = [];
      if (!dateVal) missing.push('date');
      if (!selectedLocation) missing.push('location');
      if (selectedPresent.length === 0) missing.push('who was present');
      if (selectedBehaviors.length < 5) missing.push(`${5 - selectedBehaviors.length} more behavior(s)`);
      if (selectedSkills.length < 2) missing.push(`${2 - selectedSkills.length} more skill(s)`);
      hint.textContent = 'Still needed: ' + missing.join(', ');
      hint.style.display = '';
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

// ── Generate note ──────────────────────────
document.getElementById('generateBtn').addEventListener('click', async () => {
  document.querySelectorAll('.error-msg').forEach(el => el.remove());
  const date = document.getElementById('genDate').value;

  const profile = selectedProfile || {};
  const approvedInterventions = (profile.interventions || [])
    .map(i => typeof i === 'string' ? i : i?.name || '').filter(Boolean);

  const body = {
    clientId: selectedClientId,
    sessionInfo: { date, location: selectedLocation, caregiver: selectedPresent.join(' and ') },
    behaviorsObserved: selectedBehaviors.map(name => ({
      name, topography: '', frequency: 1, antecedentContext: '', function: ''
    })),
    replacementSkillsAddressed: selectedSkills.map(name => ({
      name, promptLevel: '', clientResponse: '', successful: true
    })),
    activitiesUsed: [],
    reinforcersUsed: [],
    clinicalEvents: medicationChange ? 'Medication consumed today.' : '',
    complianceLevel: complianceLevel !== 'typical' ? complianceLevel : undefined,
    environmentalChangeDescription: environmentalChange ? 'Environmental changes noted this session.' : undefined,
    missedHoursData: missedSessions ? { totalHours: 1, reason: 'Reported by caregiver' } : undefined,
    clientProfile: {
      diagnosis: [],
      setting: selectedLocation,
      approvedInterventions,
      prohibitedInterventions: ['Punishment', 'ResponseCost', 'Restraint', 'StandaloneExtinction', 'TimeOut', 'Overcorrection', 'Aversive'],
      reinforcers: {
        tangibles: (profile.reinforcers || []).slice(0, 5).join(', '),
        activities: '',
        social: 'verbal praise, high fives, behavior-specific praise',
        people: '',
      },
      activePrograms: {
        maladaptive: (profile.maladaptiveBehaviors || []).map(b => typeof b === 'string' ? b : b?.name || ''),
        replacementSkills: [
          ...(profile.replacementBehaviors || []).map(s => typeof s === 'string' ? s : s?.name || ''),
          ...(profile.skillAcquisition || []).map(s => typeof s === 'string' ? s : s?.name || ''),
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
  const body = {
    originalNote,
    clientId: selectedClientId,
    clientProfile: {
      approvedInterventions: (profile.interventions || []).map(i => typeof i === 'string' ? i : i?.name || ''),
      prohibitedInterventions: ['Punishment', 'ResponseCost', 'Restraint', 'StandaloneExtinction', 'TimeOut', 'Overcorrection', 'Aversive'],
      reinforcers: {
        tangibles: (profile.reinforcers || []).slice(0, 5).join(', '),
        social: 'verbal praise, behavior-specific praise, high fives',
      },
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

// ── Save button ────────────────────────────
document.getElementById('saveBtn').addEventListener('click', async () => {
  const text = document.getElementById('outputNote').value;
  if (!text || !selectedClientId) return;

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

    // Local backup
    chrome.storage.local.set({
      [`path4aba_ext_note_${selectedClientId}_${Date.now()}`]: {
        clientId: selectedClientId, note: text, savedAt: new Date().toISOString(),
      },
    });

    btn.textContent = '✓ Saved to profile';
    btn.classList.add('saved');
    setTimeout(() => {
      btn.textContent = 'Save';
      btn.classList.remove('saved');
      btn.disabled = false;
    }, 2000);
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
  // Clear token so the user must re-activate the extension
  extensionToken = null;
  await chrome.storage.local.remove('extensionToken');
  showScreen('token');
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
    extensionToken = raw;

    // Use apiWithTimeout (6 s abort) — same pattern as init()
    const [bcbaResult, rbtResult] = await Promise.allSettled([
      apiWithTimeout('/api/bcba/clients', 6000),
      apiWithTimeout('/api/rbt/clients',  6000),
    ]);

    const responses = [bcbaResult, rbtResult]
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (responses.length === 0) {
      // Both timed out or had a network error
      extensionToken = null;
      errEl.textContent = 'Connection timed out. Check your network and try again.';
      errEl.style.display = '';
      return;
    }

    const allUnauthorized = responses.every(r => r.status === 401);
    if (allUnauthorized) {
      extensionToken = null;
      errEl.textContent = 'Token not recognized. Regenerate a new one in Path4ABA Settings → Extension.';
      errEl.style.display = '';
      return;
    }

    // Token valid — persist and boot normally
    await chrome.storage.local.set({ extensionToken: raw });
    if (input) input.value = '';
    await init();
  } catch {
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
let dataLocation = null;
let skillRows = [];        // replacement skill rows
let maladaptiveRows = [];  // { behavior, weeklyAvg, dailyValues, status }

// Projected-values autofill state (OP datasheet)
let autofillProjectedItems = [];   // [{ name, type, projectedValue, unit }]
let autofillSelections = {};       // name → { met: boolean, actualValue: number|null }

// ── Helpers ────────────────────────────────
function generateAltSequence(correct, incorrect) {
  const total = correct + incorrect;
  if (total === 0) return [];
  const seq = Array(total).fill('+');
  if (incorrect === 0) return seq;
  if (correct === 0) return Array(total).fill('-');
  for (let k = 0; k < incorrect; k++) {
    const pos = Math.floor((k + 1) * total / incorrect) - 1;
    if (pos >= 0 && pos < total) seq[pos] = '-';
  }
  return seq;
}

function getStatusLabel(status) {
  return { pending: 'Pending', calculated: 'Calculated', confirmed: 'Confirmed', error: 'Error' }[status] || status;
}

function showDataMsg(msg, isError = true) {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());
  const el = document.createElement('p');
  el.className = isError ? 'error-msg data-feedback' : 'data-feedback';
  el.style.cssText = isError ? '' : 'font-size:12px;color:#16a34a;margin-top:8px;';
  el.textContent = msg;
  document.getElementById('tabContent-data').appendChild(el);
}

// ── Seeded PRNG (mulberry32) ───────────────
// Referenced by generateVariedSequence; must be defined before it's called.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Week Helper Functions ──────────────────
function calcWeekEndDate(startStr) {
  if (!startStr) return null;
  const start = new Date(startStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end.toISOString().split('T')[0];
}

function getWeekDays(startDate) {
  const days = [];
  const start = new Date(startDate);
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function generateDailyPercentages(weeklyAvg, numDays = 5) {
  const dailyPcts = [];
  const maxDeviation = 15;

  for (let i = 0; i < numDays; i++) {
    let pct;
    if (i === numDays - 1) {
      const sum = dailyPcts.reduce((a, b) => a + b, 0);
      pct = Math.round((weeklyAvg * numDays - sum));
      pct = Math.max(0, Math.min(100, pct));
    } else {
      const deviation = (Math.random() - 0.5) * (maxDeviation * 2);
      pct = Math.round(weeklyAvg + deviation);
      pct = Math.max(0, Math.min(100, pct));
    }
    dailyPcts.push(pct);
  }

  return dailyPcts;
}

// Same distribution algorithm applied to frequency counts (integers, not percentages)
function generateDailyFrequencies(weeklyAvg, numDays = 5) {
  const daily = [];
  const maxDev = Math.max(2, Math.round(weeklyAvg * 0.3));
  for (let i = 0; i < numDays; i++) {
    if (i === numDays - 1) {
      const sum = daily.reduce((a, b) => a + b, 0);
      daily.push(Math.max(0, Math.round(weeklyAvg * numDays - sum)));
    } else {
      const dev = Math.round((Math.random() - 0.5) * maxDev * 2);
      daily.push(Math.max(0, Math.round(weeklyAvg + dev)));
    }
  }
  return daily;
}

function generateVariedSequence(correct, incorrect, seed = null) {
  const positions = [];

  for (let i = 0; i < correct; i++) {
    positions.push('+');
  }
  for (let i = 0; i < incorrect; i++) {
    positions.push('-');
  }

  let rng = seed ? mulberry32(seed) : Math.random;
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  return positions;
}

// ── Week Start Date listener ───────────────
document.getElementById('weekStartDate').addEventListener('change', (e) => {
  const weekStart = e.target.value;
  const weekEnd = calcWeekEndDate(weekStart);
  if (weekEnd) {
    document.getElementById('weekEndDate').value = weekEnd;
  }
  document.getElementById('reviewSection').style.display = 'none';
});

// ── Extract Maladaptives ───────────────────
document.getElementById('extractMaladaptivesBtn').addEventListener('click', () => {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());

  if (!selectedClientId || !selectedProfile) {
    showDataMsg('Select a client first.');
    return;
  }

  const weekStart = document.getElementById('weekStartDate').value;
  if (!weekStart) { showDataMsg('Select a week start date first.'); return; }

  const rawBehaviors = [
    ...(selectedProfile.maladaptiveBehaviors || []),
    ...(selectedProfile.activePrograms?.maladaptive || []),
  ];
  const behaviors = [...new Set(
    rawBehaviors.map(b => (typeof b === 'string' ? b : b?.name || '')).filter(Boolean)
  )];

  if (!behaviors.length) {
    showDataMsg('No maladaptive behaviors found in this client\'s profile.');
    return;
  }

  maladaptiveRows = behaviors.map(behavior => ({
    behavior,
    weeklyFreq: '',
    dailyValues: [],
    status: 'pending',
  }));

  renderMaladaptiveCards();
  document.getElementById('maladaptiveCards').style.display = '';
  document.getElementById('dataActions').style.display = '';
  document.getElementById('confirmSection').style.display = '';
  document.getElementById('autofillBtn').disabled = true;
});

function renderMaladaptiveCards() {
  const container = document.getElementById('maladaptiveCards');
  container.innerHTML = '';
  if (!maladaptiveRows.length) return;

  const sectionLabel = document.createElement('p');
  sectionLabel.style.cssText = 'font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;';
  sectionLabel.textContent = 'Maladaptive Behaviors';
  container.appendChild(sectionLabel);

  maladaptiveRows.forEach((row, idx) => {
    const card = document.createElement('div');
    card.className = `skill-card ${row.status}`;
    card.style.borderLeftColor = '#f59e0b';
    card.id = `maladCard-${idx}`;
    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name" title="${row.behavior}">${row.behavior}</span>
        <span class="skill-status-badge ${row.status}" style="background:#fef3c7;color:#92400e;">${getStatusLabel(row.status)}</span>
      </div>
      <div class="skill-inputs">
        <div class="skill-input-group">
          <label>Weekly Avg Frequency</label>
          <input type="number" min="0" max="999" class="input small" placeholder="0"
                 value="${row.weeklyFreq}" data-idx="${idx}" data-type="malad" data-field="weeklyFreq">
        </div>
        <div class="skill-input-group">
          <label>Unit</label>
          <select class="input small" data-idx="${idx}" data-type="malad" data-field="unit" style="padding:5px 6px;">
            <option value="count">Count</option>
            <option value="rate">Rate/hr</option>
          </select>
        </div>
      </div>
      ${row.dailyValues.length ? `
        <div class="skill-results">
          ${row.dailyValues.map((v, i) => `<span style="font-size:10px;color:#6b7280;">${['M','T','W','Th','F'][i]}:<b>${v}</b></span>`).join(' ')}
          <span class="result-pct">Avg: ${Math.round(row.dailyValues.reduce((a,b)=>a+b,0)/row.dailyValues.length)}</span>
        </div>` : ''}
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('input[data-type="malad"], select[data-type="malad"]').forEach(input => {
    input.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      maladaptiveRows[idx][field] = e.target.value;
      maladaptiveRows[idx].dailyValues = [];
      maladaptiveRows[idx].status = 'pending';
    });
  });
}

// ── Extract replacements (week-based) ──────
document.getElementById('extractBtn').addEventListener('click', () => {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());

  if (!selectedClientId || !selectedProfile) {
    showDataMsg('Select a client first.');
    return;
  }

  const weekStart = document.getElementById('weekStartDate').value;
  if (!weekStart) {
    showDataMsg('Select a week start date first.');
    return;
  }

  const rawSkills = [
    ...(selectedProfile.replacementBehaviors || []),
    ...(selectedProfile.skillAcquisition || []),
    ...(selectedProfile.activePrograms?.replacementSkills || []),
  ];
  const skills = [...new Set(
    rawSkills.map(s => (typeof s === 'string' ? s : s?.name || '')).filter(Boolean)
  )];

  if (!skills.length) {
    showDataMsg('No replacement skills found in this client\'s profile.');
    return;
  }

  const defaultTrials = parseInt(document.getElementById('defaultTrials').value) || 10;

  skillRows = skills.map(skill => ({
    skill,
    defaultTrials,
    trialsOverride: null,
    weeklyAvg: '',
    dailyPercentages: [],
    dailyCorrect: [],
    dailyIncorrect: [],
    sequences: [],
    status: 'pending',
  }));

  renderSkillCards();
  document.getElementById('skillCards').style.display = '';
  document.getElementById('dataActions').style.display = '';
  document.getElementById('confirmSection').style.display = '';
  document.getElementById('autofillBtn').disabled = true;
});

// ── Render skill cards (week-based) ────────
function renderSkillCards() {
  const container = document.getElementById('skillCards');
  container.innerHTML = '';

  if (!skillRows.length) return;

  skillRows.forEach((row, idx) => {
    const card = document.createElement('div');
    card.className = `skill-card ${row.status}`;
    card.id = `skillCard-${idx}`;

    const trials = row.trialsOverride || row.defaultTrials;

    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name" title="${row.skill}">${row.skill}</span>
        <span class="skill-status-badge ${row.status}">${getStatusLabel(row.status)}</span>
      </div>
      <div class="skill-inputs">
        <div class="skill-input-group">
          <label>Weekly Avg %</label>
          <input type="number" min="0" max="100" class="input small" placeholder="0"
                 value="${row.weeklyAvg}" data-idx="${idx}" data-field="weeklyAvg">
        </div>
        <div class="skill-input-group">
          <label>Trials (override)</label>
          <input type="number" min="1" max="999" class="input small" placeholder="${row.defaultTrials}"
                 value="${row.trialsOverride || ''}" data-idx="${idx}" data-field="trialsOverride">
        </div>
      </div>
      <div class="skill-info">
        <span style="color:#6b7280;font-size:11px;">Using ${trials} trials</span>
      </div>
    `;
    container.appendChild(card);
  });

  // Input listeners
  container.querySelectorAll('input[data-idx]').forEach(input => {
    input.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      const val = e.target.value;
      
      if (field === 'weeklyAvg') {
        skillRows[idx].weeklyAvg = val;
      } else if (field === 'trialsOverride') {
        skillRows[idx].trialsOverride = val ? parseInt(val) : null;
      }
      
      skillRows[idx].dailyPercentages = [];
      skillRows[idx].dailyCorrect = [];
      skillRows[idx].dailyIncorrect = [];
      skillRows[idx].sequences = [];
      skillRows[idx].status = 'pending';
      
      const card = document.getElementById(`skillCard-${idx}`);
      if (card) {
        card.className = 'skill-card pending';
        card.querySelector('.skill-status-badge').className = 'skill-status-badge pending';
        card.querySelector('.skill-status-badge').textContent = 'Pending';
      }
      
      document.getElementById('reviewSection').style.display = 'none';
    });
  });
}

// ── Calculate Data (generates daily percentages & correct/incorrect) ─
document.getElementById('calculateBtn').addEventListener('click', () => {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());
  let hasErrors = false;

  skillRows.forEach((row, idx) => {
    if (!row.weeklyAvg) return;

    const pct = parseFloat(row.weeklyAvg);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      skillRows[idx].status = 'error';
      hasErrors = true;
      return;
    }

    const trials = row.trialsOverride || row.defaultTrials;

    // Generate daily percentages with variation
    const dailyPcts = generateDailyPercentages(pct, 5);
    
    // Calculate correct/incorrect for each day
    const dailyCorrect = [];
    const dailyIncorrect = [];
    
    dailyPcts.forEach(dailyPct => {
      const correct = Math.round((dailyPct / 100) * trials);
      const incorrect = trials - correct;
      dailyCorrect.push(correct);
      dailyIncorrect.push(incorrect);
    });

    skillRows[idx].dailyPercentages = dailyPcts;
    skillRows[idx].dailyCorrect = dailyCorrect;
    skillRows[idx].dailyIncorrect = dailyIncorrect;
    skillRows[idx].status = 'calculated';
  });

  // Calculate maladaptive daily values
  maladaptiveRows.forEach((row, idx) => {
    if (!row.weeklyFreq) return;
    const avg = parseFloat(row.weeklyFreq);
    if (isNaN(avg) || avg < 0) { maladaptiveRows[idx].status = 'error'; hasErrors = true; return; }
    // Generate daily frequency values that average to weeklyFreq
    const daily = generateDailyFrequencies(avg, 5);
    maladaptiveRows[idx].dailyValues = daily;
    maladaptiveRows[idx].status = 'calculated';
  });

  renderSkillCards();
  renderMaladaptiveCards();
  renderReviewScreen();
  document.getElementById('reviewSection').style.display = '';

  if (hasErrors) {
    showDataMsg('Some rows have invalid values.');
  } else {
    showDataMsg('Data calculated. Review above and click "Generate Sequence" next.', false);
  }
});

// ── Generate Sequence ──────────────────────
document.getElementById('genSeqBtn').addEventListener('click', () => {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());

  const uncalculated = skillRows.filter(r => r.weeklyAvg && r.dailyPercentages.length === 0);
  if (uncalculated.length) {
    showDataMsg('Click "Calculate Data" first to generate daily percentages.');
    return;
  }

  skillRows.forEach((row, idx) => {
    if (row.dailyCorrect.length > 0) {
      // Generate sequence for each day
      const sequences = [];
      row.dailyCorrect.forEach((correct, dayIdx) => {
        const incorrect = row.dailyIncorrect[dayIdx];
        const seed = `${row.skill}-${document.getElementById('weekStartDate').value}-${dayIdx}`.split('').reduce((a, b) => {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return a & a;
        }, 0);
        const sequence = generateVariedSequence(correct, incorrect, seed);
        sequences.push(sequence);
      });
      skillRows[idx].sequences = sequences;
      skillRows[idx].status = 'confirmed';
    }
  });

  renderSkillCards();
  renderReviewScreen();
  
  if (skillRows.some(r => r.status === 'confirmed')) {
    showDataMsg('Sequences generated. Ready to save and autofill.', false);
  }
});

// ── Render Review Screen ───────────────────
function renderReviewScreen() {
  const container = document.getElementById('reviewCards');
  container.innerHTML = '';

  if (!skillRows.some(r => r.status === 'calculated' || r.status === 'confirmed')) {
    return;
  }

  const weekStart = document.getElementById('weekStartDate').value;
  const weekDays = getWeekDays(weekStart);
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  skillRows.filter(r => r.dailyPercentages.length > 0).forEach(row => {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.style.cssText = `
      background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:10px;
    `;

    const trials = row.trialsOverride || row.defaultTrials;
    const dailyPcts = row.dailyPercentages;
    const weeklyAvg = dailyPcts.reduce((a, b) => a + b, 0) / dailyPcts.length;

    let daysHtml = '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:8px;">';
    dayNames.forEach((dayName, idx) => {
      const pct = dailyPcts[idx];
      daysHtml += `
        <div style="text-align:center;font-size:11px;">
          <div style="font-weight:600;color:#111827;">${pct}%</div>
          <div style="color:#6b7280;">${dayName.slice(0, 3)}</div>
        </div>
      `;
    });
    daysHtml += '</div>';

    card.innerHTML = `
      <div style="font-weight:600;color:#111827;margin-bottom:6px;">${row.skill}</div>
      ${daysHtml}
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;">
        <span>Weekly Avg: <b>${Math.round(weeklyAvg)}%</b></span>
        <span>Trials: <b>${trials}</b></span>
      </div>
      <details style="margin-top:6px;cursor:pointer;">
        <summary style="font-size:10px;color:#0d6e6e;font-weight:600;">View sequences</summary>
        <div id="seq-${row.skill}" style="margin-top:4px;"></div>
      </details>
    `;
    container.appendChild(card);

    // Add sequence details
    const seqDiv = card.querySelector(`#seq-${row.skill}`);
    if (row.sequences && row.sequences.length > 0) {
      row.sequences.forEach((seq, dayIdx) => {
        const seqSpan = document.createElement('div');
        seqSpan.style.cssText = 'font-size:10px;color:#6b7280;margin-bottom:3px;font-family:monospace;';
        seqSpan.textContent = `${dayNames[dayIdx]}: ${seq.join(' ')}`;
        seqDiv.appendChild(seqSpan);
      });
    }
  });
}

// ── Confirmation checkbox enables autofill ─
document.getElementById('confirmCheck').addEventListener('change', e => {
  document.getElementById('autofillBtn').disabled = !e.target.checked;
});

// ── Save to Path4ABA ───────────────────────
document.getElementById('saveDataBtn').addEventListener('click', async () => {
  await saveReplacementData(false);
});

// ── Autofill Data ──────────────────────────
document.getElementById('autofillBtn').addEventListener('click', async () => {
  const saved = await saveReplacementData(true);
  if (!saved) return;

  // Inject autofill script into active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { showDataMsg('Could not access the active tab.'); return; }

    const weekStart = document.getElementById('weekStartDate').value;
    const weekDays = getWeekDays(weekStart);
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    // Prepare autofill data
    const autofillData = [];
    skillRows.filter(r => r.sequences && r.sequences.length > 0).forEach(row => {
      const trials = row.trialsOverride || row.defaultTrials;
      row.sequences.forEach((seq, dayIdx) => {
        const correct = row.dailyCorrect[dayIdx];
        const incorrect = row.dailyIncorrect[dayIdx];
        autofillData.push({
          skill: row.skill,
          day: dayNames[dayIdx],
          date: weekDays[dayIdx],
          trials,
          percentage: row.dailyPercentages[dayIdx],
          correct,
          incorrect,
          sequence: seq,
        });
      });
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectAutofill,
      args: [autofillData],
    });
    showDataMsg('Autofill injected. Review the values on the page before submitting.', false);
  } catch (err) {
    showDataMsg('Autofill injection failed: ' + err.message);
  }
});

// Injected into the target page — must be self-contained (no closure refs)
function injectAutofill(autofillData) {
  const overlay = document.createElement('div');
  overlay.id = '__p4a_overlay__';
  overlay.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:999999;
    background:#fff;border:2px solid #0d6e6e;border-radius:12px;
    padding:14px 16px;max-width:360px;font-family:system-ui,sans-serif;
    font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);max-height:70vh;overflow-y:auto;
  `;
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;color:#0d6e6e;margin-bottom:10px;font-size:13px;';
  title.textContent = 'Path4ABA · Weekly Data Autofill';
  overlay.appendChild(title);

  autofillData.forEach(row => {
    const card = document.createElement('div');
    card.style.cssText = 'margin-bottom:8px;padding:8px;background:#f9fafb;border-radius:7px;';
    const seq = row.sequence.join(' ');
    card.innerHTML = `
      <div style="font-weight:600;color:#111827;margin-bottom:2px;font-size:11px;">${row.skill}</div>
      <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">${row.day} (${row.date})</div>
      <div style="display:flex;gap:10px;font-size:11px;color:#374151;margin-bottom:4px;">
        <span>Trials: <b>${row.trials}</b></span>
        <span style="color:#16a34a;">+${row.correct}</span>
        <span style="color:#dc2626;">−${row.incorrect}</span>
        <span>${row.percentage}%</span>
      </div>
      <div style="font-size:10px;color:#6b7280;word-break:break-all;font-family:monospace;">${seq}</div>
    `;
    overlay.appendChild(card);
  });

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'margin-top:6px;width:100%;padding:6px;background:#0d6e6e;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.appendChild(closeBtn);

  document.getElementById('__p4a_overlay__')?.remove();
  document.body.appendChild(overlay);
}

// ── Save helper ────────────────────────────
async function saveReplacementData(autofillCompleted) {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());

  if (!selectedClientId) { showDataMsg('No client selected.'); return false; }
  if (!document.getElementById('confirmCheck').checked) {
    showDataMsg('Check the confirmation box before saving.');
    return false;
  }

  const weekStart = document.getElementById('weekStartDate').value;
  const weekEnd = document.getElementById('weekEndDate').value;

  if (!weekStart || !weekEnd) {
    showDataMsg('Week dates not properly set.');
    return false;
  }

  const weekDays = getWeekDays(weekStart);

  const records = [];
  skillRows.forEach(row => {
    if (row.dailyPercentages.length === 0) return;

    const trials = row.trialsOverride || row.defaultTrials;

    row.dailyPercentages.forEach((dailyPct, dayIdx) => {
      records.push({
        clientId: selectedClientId,
        replacementSkill: row.skill,
        weekStart,
        weekEnd,
        sessionDate: weekDays[dayIdx],
        dailyPercentage: dailyPct,
        trials,
        correctCount: row.dailyCorrect[dayIdx],
        incorrectCount: row.dailyIncorrect[dayIdx],
        sequence: row.sequences[dayIdx] ? row.sequences[dayIdx].join(',') : null,
        userConfirmed: true,
        autofillCompleted,
        platformSource: 'extension',
      });
    });
  });

  // Build maladaptive records
  const maladRecords = [];
  maladaptiveRows.forEach(row => {
    if (!row.dailyValues.length) return;
    const weekDays = getWeekDays(weekStart);
    row.dailyValues.forEach((freq, dayIdx) => {
      maladRecords.push({
        clientId: selectedClientId,
        behaviorName: row.behavior,
        weekStart,
        weekEnd,
        sessionDate: weekDays[dayIdx],
        frequency: freq,
        dailyValues: row.dailyValues,
        userConfirmed: true,
      });
    });
  });

  const hasAnything = records.length > 0 || maladRecords.length > 0;
  if (!hasAnything) {
    showDataMsg('No calculated data to save. Click "Calculate Data" first.');
    return false;
  }

  const saveBtn = document.getElementById('saveDataBtn');
  saveBtn.disabled = true;
  try {
    const saves = [];
    if (records.length) {
      saves.push(api('/api/replacement-data', { method: 'POST', body: JSON.stringify(records) }));
    }
    if (maladRecords.length) {
      saves.push(api('/api/maladaptive-data', { method: 'POST', body: JSON.stringify(maladRecords) }));
    }
    const results = await Promise.all(saves);
    for (const res of results) {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showDataMsg(data.error || 'Save failed.');
        return false;
      }
    }
    const total = records.length + maladRecords.length;
    showDataMsg(`Saved ${total} record${total !== 1 ? 's' : ''} to Path4ABA.`, false);
    return true;
  } catch {
    showDataMsg('Network error. Make sure you are logged into Path4ABA.');
    return false;
  } finally {
    saveBtn.disabled = false;
  }
}

// ── Cancel / reset data tab ────────────────
document.getElementById('cancelDataBtn').addEventListener('click', () => {
  skillRows = [];
  maladaptiveRows = [];
  document.getElementById('skillCards').style.display = 'none';
  document.getElementById('maladaptiveCards').style.display = 'none';
  document.getElementById('dataActions').style.display = 'none';
  document.getElementById('reviewSection').style.display = 'none';
  document.getElementById('confirmSection').style.display = 'none';
  document.getElementById('confirmCheck').checked = false;
  document.getElementById('autofillBtn').disabled = true;
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());
});

// ── Set week start date default on tab open ─
document.getElementById('tabData').addEventListener('click', () => {
  if (!document.getElementById('weekStartDate').value) {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    document.getElementById('weekStartDate').value = monday.toISOString().split('T')[0];
    const weekEnd = calcWeekEndDate(monday.toISOString().split('T')[0]);
    document.getElementById('weekEndDate').value = weekEnd;
  }
});

// ─────────────────────────────────────────────
//  OFFICE PUZZLE — EXTRACT CHARTS
// ─────────────────────────────────────────────

async function checkOfficePuzzlePage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    const isOPCharts  = url.includes('officepuzzle.com') && url.includes('/data/charts');
    const isOPSheets  = url.includes('officepuzzle.com') && url.includes('/data/sheets');
    const chartsEl = document.getElementById('extractChartsSection');
    const sheetsEl = document.getElementById('autofillSheetsSection');
    if (chartsEl) chartsEl.style.display = isOPCharts ? '' : 'none';
    if (sheetsEl) sheetsEl.style.display = isOPSheets ? '' : 'none';
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

async function renderAutofillSheetsInputs() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    if (!url.includes('officepuzzle.com') || !url.includes('/data/sheets')) return;
  } catch { return; }

  if (!selectedClientId) {
    showAutofillProjectedState('empty');
    const el = document.getElementById('autofillProjectedEmpty');
    if (el) el.textContent = "Select a client above to load this week's projected values.";
    return;
  }

  showAutofillProjectedState('loading');

  try {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const weekStr = monday.toISOString().split('T')[0];

    const res = await api(`/api/projected-values?clientId=${selectedClientId}&week=${weekStr}`);
    const data = res.ok ? await res.json().catch(() => ({})) : {};
    autofillProjectedItems = data.items || [];
    autofillSelections = {};

    if (!autofillProjectedItems.length) {
      showAutofillProjectedState('empty');
      const el = document.getElementById('autofillProjectedEmpty');
      if (el) el.textContent = 'No chart data yet. Extract charts from the Office Puzzle charts page first.';
      return;
    }

    autofillProjectedItems.forEach(item => {
      autofillSelections[item.name] = { met: true, actualValue: null };
    });

    renderProjectedConfirmList();
    showAutofillProjectedState('confirm');

    const dayInput = document.getElementById('autofillDay');
    if (dayInput && !dayInput.value) dayInput.value = String(new Date().getDate());
  } catch {
    showAutofillProjectedState('empty');
    const el = document.getElementById('autofillProjectedEmpty');
    if (el) el.textContent = 'Could not load projected values. Check your connection.';
  }
}

function showAutofillProjectedState(state) {
  document.getElementById('autofillProjectedLoading').style.display = state === 'loading' ? '' : 'none';
  document.getElementById('autofillProjectedEmpty').style.display   = state === 'empty'   ? '' : 'none';
  document.getElementById('autofillProjectedConfirm').style.display = state === 'confirm'  ? '' : 'none';
}

function renderProjectedConfirmList() {
  const list = document.getElementById('autofillProjectedList');
  if (!list) return;
  list.innerHTML = '';

  autofillProjectedItems.forEach(item => {
    const sel = autofillSelections[item.name] || { met: true, actualValue: null };
    const valueLabel = item.type === 'replacement'
      ? `${item.projectedValue}%`
      : `${item.projectedValue} occ.`;

    const row = document.createElement('div');
    row.style.cssText = 'padding:5px 0;border-bottom:1px solid #f3f4f6;';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    topRow.innerHTML = `
      <span style="flex:1;font-size:11px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span style="font-size:10px;color:#6b7280;white-space:nowrap;">${valueLabel}</span>
      <button class="proj-yes" data-name="${escapeHtml(item.name)}" style="padding:2px 7px;font-size:10px;font-weight:700;border-radius:4px;border:1.5px solid ${sel.met ? '#16a34a' : '#d1d5db'};background:${sel.met ? '#16a34a' : 'white'};color:${sel.met ? 'white' : '#9ca3af'};cursor:pointer;line-height:1.4;">Yes</button>
      <button class="proj-no" data-name="${escapeHtml(item.name)}" style="padding:2px 7px;font-size:10px;font-weight:700;border-radius:4px;border:1.5px solid ${!sel.met ? '#dc2626' : '#d1d5db'};background:${!sel.met ? '#dc2626' : 'white'};color:${!sel.met ? 'white' : '#9ca3af'};cursor:pointer;line-height:1.4;">No</button>
    `;
    row.appendChild(topRow);

    if (!sel.met) {
      const inputRow = document.createElement('div');
      inputRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;padding-left:2px;';
      inputRow.innerHTML = `
        <label style="font-size:10px;color:#6b7280;white-space:nowrap;">Actual value:</label>
        <input type="number" min="0" ${item.type === 'replacement' ? 'max="100"' : ''} class="proj-actual" data-name="${escapeHtml(item.name)}" placeholder="${item.projectedValue}" value="${sel.actualValue ?? ''}" style="width:60px;padding:2px 5px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;">
        <span style="font-size:10px;color:#6b7280;">${item.unit || 'occ.'}</span>
      `;
      row.appendChild(inputRow);
    }

    list.appendChild(row);
  });

  list.querySelectorAll('.proj-yes').forEach(btn => {
    btn.addEventListener('click', () => {
      autofillSelections[btn.dataset.name] = { met: true, actualValue: null };
      renderProjectedConfirmList();
    });
  });
  list.querySelectorAll('.proj-no').forEach(btn => {
    btn.addEventListener('click', () => {
      autofillSelections[btn.dataset.name] = { met: false, actualValue: null };
      renderProjectedConfirmList();
    });
  });
  list.querySelectorAll('.proj-actual').forEach(input => {
    input.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      autofillSelections[e.target.dataset.name] = { met: false, actualValue: isNaN(v) ? null : v };
    });
  });
}

function showAutofillSheetStatus(msg, isError) {
  const el = document.getElementById('autofillSheetStatus');
  if (!el) return;
  el.innerHTML = '';
  el.textContent = msg;
  el.style.display  = '';
  el.style.background = isError ? '#fef2f2' : '#f0fdf4';
  el.style.color      = isError ? '#991b1b'  : '#166534';
}

document.getElementById('autofillSheetBtn').addEventListener('click', async () => {
  const day = parseInt(document.getElementById('autofillDay').value);
  if (!day || day < 1 || day > 31) {
    showAutofillSheetStatus('Enter the day of month (1–31).', true);
    return;
  }

  if (!autofillProjectedItems.length) {
    showAutofillSheetStatus('No projected values loaded. Select a client first.', true);
    return;
  }

  const tasks = autofillProjectedItems.map(item => {
    const sel = autofillSelections[item.name] || { met: true, actualValue: null };
    const value = sel.met ? item.projectedValue : (sel.actualValue ?? item.projectedValue);
    return { name: item.name, dayNumber: day, value, type: item.type };
  });

  const btn = document.getElementById('autofillSheetBtn');
  btn.disabled = true;
  btn.textContent = 'Filling cells…';
  document.getElementById('autofillSheetStatus').style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: officePuzzleDatasheetAutofiller,
      args: [tasks],
      world: 'MAIN',
    });

    const log  = result?.[0]?.result || [];
    const ok   = log.filter(l => l.startsWith('✓'));
    const errs = log.filter(l => l.startsWith('❌'));

    showAutofillSheetStatus(
      `${ok.length} section${ok.length !== 1 ? 's' : ''} filled${errs.length ? `, ${errs.length} not found` : ''}.`,
      errs.length > 0 && ok.length === 0,
    );
    if (errs.length) {
      const statusEl = document.getElementById('autofillSheetStatus');
      const detail = document.createElement('div');
      detail.style.cssText = 'margin-top:4px;font-size:10px;opacity:0.75;word-break:break-word;';
      detail.textContent = errs.join(' · ');
      statusEl.appendChild(detail);
    }
  } catch (err) {
    showAutofillSheetStatus('Error: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Autofill Datasheet';
  }
});

// Injected into the Office Puzzle datasheet page — must be fully self-contained.
function officePuzzleDatasheetAutofiller(tasks) {
  // ── Helpers ──────────────────────────────────────────────────────────────────
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  // Generates an evenly alternated +/- sequence (e.g. 8 correct of 12 → ++ - ++ - ++ - ++ -)
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

  // Walk up from a heading that contains the target name, finding the nearest ancestor
  // that contains td.value cells (the datasheet section container).
  function findSectionByName(name) {
    const lower = name.toLowerCase().trim();
    const candidates = [
      ...document.querySelectorAll('h1,h2,h3,h4,h5,h6'),
      ...document.querySelectorAll('[class*="title"],[class*="heading"],[class*="name"],[class*="label"]'),
    ];
    for (const el of candidates) {
      const text = el.textContent.trim().toLowerCase();
      if (!text.includes(lower)) continue;
      if (text.length > lower.length * 5) continue; // skip large containers
      let node = el;
      for (let i = 0; i < 10 && node; i++, node = node.parentElement) {
        if (node.querySelector && node.querySelector('table td.value')) return node;
      }
    }
    return null;
  }

  // Find the column index (absolute, including any label columns) for a given day-of-month.
  function findDayColumn(table, dayNumber) {
    const day = parseInt(dayNumber);
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return -1;
    const cells = Array.from(headerRow.querySelectorAll('th, td'));
    for (let i = 1; i < cells.length; i++) { // skip col 0 (trial label)
      const nums = (cells[i].textContent.match(/\d+/g) || [])
        .map(Number)
        .filter(n => n >= 1 && n <= 31);
      if (nums.includes(day)) return i;
    }
    return -1;
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────
  const log = [];

  for (const { name, dayNumber, value, type } of tasks) {
    const section = findSectionByName(name);
    if (!section) { log.push(`❌ "${name}" — section not found`); continue; }

    const table = section.querySelector('table');
    if (!table) { log.push(`❌ "${name}" — no table in section`); continue; }

    const colIndex = findDayColumn(table, dayNumber);
    if (colIndex === -1) { log.push(`❌ "${name}" — day ${dayNumber} column not found`); continue; }

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    let clicks = 0;

    if (type === 'replacement') {
      const totalTrials = 12;
      const correct = Math.min(totalTrials, Math.max(0, Math.round(value / 100 * totalTrials)));
      const seq = generateSequence(correct, totalTrials);

      bodyRows.slice(0, totalTrials).forEach((row, i) => {
        const cell = row.children[colIndex];
        if (!cell || !cell.classList.contains('value')) return;
        if (cell.textContent.trim() !== seq[i]) { cell.click(); clicks++; }
      });

      log.push(`✓ "${name}" — ${value}% → ${correct}/${totalTrials} correct, ${clicks} clicks`);

    } else {
      // maladaptive: mark first N rows with X, clear the rest
      const freq = Math.round(value);
      bodyRows.forEach((row, i) => {
        const cell = row.children[colIndex];
        if (!cell || !cell.classList.contains('value')) return;
        const shouldMark = i < freq;
        const isMarked   = cell.textContent.trim().toUpperCase() === 'X';
        if (shouldMark !== isMarked) { cell.click(); clicks++; }
      });

      log.push(`✓ "${name}" — freq ${freq}, ${clicks} clicks`);
    }
  }

  return log;
}

// ── Projected values: All Yes / All No ────
document.getElementById('autofillAllYesBtn').addEventListener('click', () => {
  autofillProjectedItems.forEach(item => {
    autofillSelections[item.name] = { met: true, actualValue: null };
  });
  renderProjectedConfirmList();
});

document.getElementById('autofillAllNoBtn').addEventListener('click', () => {
  autofillProjectedItems.forEach(item => {
    autofillSelections[item.name] = { met: false, actualValue: null };
  });
  renderProjectedConfirmList();
});

// ── Boot ───────────────────────────────────
init();
