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

// Session condition state
let selectedPresent = [];
let environmentalChange = false;
let medicationChange = false;
let missedSessions = false;
let complianceLevel = 'typical';

// ── API helper ─────────────────────────────
async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  // Don't send Content-Type on GET/HEAD — it triggers an unnecessary CORS preflight.
  // POST/PATCH requests that send a body still need it.
  const baseHeaders = method === 'GET' || method === 'HEAD'
    ? {}
    : { 'Content-Type': 'application/json' };

  const url = `${BASE}${path}`;
  try {
    return await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        ...baseHeaders,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    console.error('[Path4ABA] fetch error:', err.name, err.message);
    console.error('[Path4ABA] URL attempted:', url);
    throw err;
  }
}

// ── Screen management ──────────────────────
function showScreen(name) {
  ['loading', 'auth', 'no-clients', 'main'].forEach(id => {
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
  console.log('[Path4ABA] extension starting, calling:', BASE + '/api/bcba/clients');

  // Try BCBA clients
  let res;
  try {
    res = await api('/api/bcba/clients');
  } catch (err) {
    console.error('[Path4ABA] init error:', err.message);
    showScreen('auth');
    document.getElementById('screen-auth').insertAdjacentHTML('beforeend',
      `<p style="color:#f87171;font-size:12px;margin-top:8px">Network error: ${err.message}</p>`);
    return;
  }

  if (res.status === 401) {
    showScreen('auth');
    return;
  }

  if (res.ok) {
    let json;
    try { json = await res.json(); } catch { showScreen('auth'); return; }
    const bcbaClients = json.clients || [];
    if (bcbaClients.length > 0) {
      userRole = 'bcba';
      clients = bcbaClients;
      setupMainScreen();
      showScreen('main');
      return;
    }
  }

  // Try RBT clients
  try {
    const rbtRes = await api('/api/rbt/clients');
    if (rbtRes.ok) {
      let json;
      try { json = await rbtRes.json(); } catch { json = {}; }
      const rbtClients = json.clients || [];
      if (rbtClients.length > 0) {
        userRole = 'rbt';
        clients = rbtClients;
        setupMainScreen();
        showScreen('main');
        return;
      }
    }
  } catch (err) {
    console.error('[Path4ABA] RBT clients error:', err.name, err.message);
  }

  // Authenticated but no clients
  if (res.ok) {
    showScreen('no-clients');
    return;
  }

  showScreen('auth');
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
  showScreen('auth');
});

// ─────────────────────────────────────────────
//  DATA AUTOFILL ASSISTANT
// ─────────────────────────────────────────────

// ── State ──────────────────────────────────
let dataLocation = null;
let skillRows = []; // { skill, trials, percentage, notes, correct, incorrect, sequence, status }

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

// ── Extract replacements from profile ──────
document.getElementById('extractBtn').addEventListener('click', () => {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());

  if (!selectedClientId || !selectedProfile) {
    showDataMsg('Select a client first.');
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

  skillRows = skills.map(skill => ({
    skill, trials: '', percentage: '', notes: '',
    correct: null, incorrect: null, sequence: null, status: 'pending',
  }));

  renderSkillCards();
  document.getElementById('skillCards').style.display = '';
  document.getElementById('dataActions').style.display = '';
  document.getElementById('confirmSection').style.display = '';
  document.getElementById('autofillBtn').disabled = true;
});

// ── Render skill cards ──────────────────────
function renderSkillCards() {
  const container = document.getElementById('skillCards');
  container.innerHTML = '';

  if (!skillRows.length) return;

  skillRows.forEach((row, idx) => {
    const card = document.createElement('div');
    card.className = `skill-card ${row.status}`;
    card.id = `skillCard-${idx}`;

    const resultsHtml = row.correct !== null ? `
      <div class="skill-results">
        <span class="result-plus">+ ${row.correct}</span>
        <span class="result-minus">− ${row.incorrect}</span>
        ${row.correct + row.incorrect > 0 && Math.round(row.correct / (row.correct + row.incorrect) * 100) !== Math.round(parseFloat(row.percentage))
          ? `<span class="result-pct">Actual: ${Math.round(row.correct / (row.correct + row.incorrect) * 100)}%</span>` : ''}
      </div>` : '';

    const seqHtml = row.sequence ? `
      <div class="sequence-display">
        ${row.sequence.map(s => `<span class="seq-dot ${s === '+' ? 'pos' : 'neg'}">${s}</span>`).join('')}
      </div>` : '';

    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-name" title="${row.skill}">${row.skill}</span>
        <span class="skill-status-badge ${row.status}">${getStatusLabel(row.status)}</span>
      </div>
      <div class="skill-inputs">
        <div class="skill-input-group">
          <label>Trials</label>
          <input type="number" min="1" max="999" class="input small" placeholder="0"
                 value="${row.trials}" data-idx="${idx}" data-field="trials">
        </div>
        <div class="skill-input-group">
          <label>% Observed</label>
          <input type="number" min="0" max="100" class="input small" placeholder="0"
                 value="${row.percentage}" data-idx="${idx}" data-field="percentage">
        </div>
        <div class="skill-input-group">
          <label>Notes</label>
          <input type="text" class="input small" placeholder="Optional"
                 value="${row.notes}" data-idx="${idx}" data-field="notes">
        </div>
      </div>
      ${resultsHtml}${seqHtml}
    `;
    container.appendChild(card);
  });

  // Input listeners
  container.querySelectorAll('input[data-idx]').forEach(input => {
    input.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      skillRows[idx][field] = e.target.value;
      if (field === 'trials' || field === 'percentage') {
        skillRows[idx].correct = null;
        skillRows[idx].incorrect = null;
        skillRows[idx].sequence = null;
        skillRows[idx].status = 'pending';
        const card = document.getElementById(`skillCard-${idx}`);
        if (card) {
          card.className = 'skill-card pending';
          card.querySelector('.skill-status-badge').className = 'skill-status-badge pending';
          card.querySelector('.skill-status-badge').textContent = 'Pending';
        }
      }
    });
  });
}

// ── Calculate Data ─────────────────────────
document.getElementById('calculateBtn').addEventListener('click', () => {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());
  let hasErrors = false;

  skillRows.forEach((row, idx) => {
    if (!row.trials && !row.percentage) return; // skip empty rows
    const trials = parseInt(row.trials);
    const pct = parseFloat(row.percentage);

    if (isNaN(trials) || trials <= 0) { skillRows[idx].status = 'error'; hasErrors = true; return; }
    if (isNaN(pct) || pct < 0 || pct > 100) { skillRows[idx].status = 'error'; hasErrors = true; return; }

    skillRows[idx].correct = Math.round((pct / 100) * trials);
    skillRows[idx].incorrect = trials - skillRows[idx].correct;
    skillRows[idx].status = 'calculated';
  });

  renderSkillCards();
  if (hasErrors) showDataMsg('Some rows have invalid values. Trials must be > 0 and percentage must be 0–100.');
});

// ── Generate Sequence ──────────────────────
document.getElementById('genSeqBtn').addEventListener('click', () => {
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());
  const uncalculated = skillRows.filter(r => r.trials && r.correct === null);
  if (uncalculated.length) {
    showDataMsg('Calculate data first before generating sequences.');
    return;
  }
  skillRows.forEach((row, idx) => {
    if (row.correct !== null) {
      skillRows[idx].sequence = generateAltSequence(row.correct, row.incorrect);
    }
  });
  renderSkillCards();
});

// ── Location for data tab ──────────────────
document.getElementById('dataLocationGroup').addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  document.querySelectorAll('#dataLocationGroup .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  dataLocation = btn.dataset.val;
});

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

  // Try to inject autofill script into active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { showDataMsg('Could not access the active tab.'); return; }

    const rows = skillRows.filter(r => r.sequence);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectAutofill,
      args: [rows.map(r => ({
        skill: r.skill,
        trials: parseInt(r.trials),
        percentage: parseFloat(r.percentage),
        correct: r.correct,
        incorrect: r.incorrect,
        sequence: r.sequence,
      }))],
    });
    showDataMsg('Autofill injected. Review the values on the page before submitting.', false);
  } catch (err) {
    showDataMsg('Autofill injection failed: ' + err.message);
  }
});

// Injected into the target page — must be self-contained (no closure refs)
function injectAutofill(rows) {
  const overlay = document.createElement('div');
  overlay.id = '__p4a_overlay__';
  overlay.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:999999;
    background:#fff;border:2px solid #0d6e6e;border-radius:12px;
    padding:14px 16px;max-width:340px;font-family:system-ui,sans-serif;
    font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);
  `;
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;color:#0d6e6e;margin-bottom:10px;font-size:13px;';
  title.textContent = 'Path4ABA · Data Autofill';
  overlay.appendChild(title);

  rows.forEach(row => {
    const card = document.createElement('div');
    card.style.cssText = 'margin-bottom:8px;padding:8px;background:#f9fafb;border-radius:7px;';
    const seq = row.sequence.join(' ');
    card.innerHTML = `
      <div style="font-weight:600;color:#111827;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${row.skill}">${row.skill}</div>
      <div style="display:flex;gap:10px;font-size:11px;color:#374151;">
        <span>Trials: <b>${row.trials}</b></span>
        <span style="color:#16a34a;">+${row.correct}</span>
        <span style="color:#dc2626;">−${row.incorrect}</span>
        <span>${Math.round(row.correct / row.trials * 100)}%</span>
      </div>
      <div style="margin-top:4px;font-size:10px;color:#6b7280;word-break:break-all;">${seq}</div>
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

  const records = skillRows
    .filter(r => r.correct !== null)
    .map(r => ({
      clientId: selectedClientId,
      sessionDate: document.getElementById('dataDate').value || new Date().toISOString().split('T')[0],
      location: dataLocation,
      sessionTimeIn: document.getElementById('dataTimeIn').value || null,
      sessionTimeOut: document.getElementById('dataTimeOut').value || null,
      rbtName: document.getElementById('dataRbtName').value || null,
      platformSource: 'extension',
      replacementSkill: r.skill,
      totalTrials: parseInt(r.trials),
      observedPercentage: parseFloat(r.percentage),
      correctCount: r.correct,
      incorrectCount: r.incorrect,
      alternatedSequence: r.sequence ? r.sequence.join(',') : null,
      userConfirmed: true,
      autofillCompleted,
    }));

  if (!records.length) {
    showDataMsg('No calculated rows to save. Run "Calculate Data" first.');
    return false;
  }

  const saveBtn = document.getElementById('saveDataBtn');
  saveBtn.disabled = true;
  try {
    const res = await api('/api/replacement-data', {
      method: 'POST',
      body: JSON.stringify(records),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showDataMsg(data.error || 'Save failed.');
      return false;
    }
    showDataMsg(`Saved ${records.length} record${records.length !== 1 ? 's' : ''} to Path4ABA.`, false);
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
  document.getElementById('skillCards').style.display = 'none';
  document.getElementById('dataActions').style.display = 'none';
  document.getElementById('confirmSection').style.display = 'none';
  document.getElementById('confirmCheck').checked = false;
  document.getElementById('autofillBtn').disabled = true;
  document.querySelectorAll('.data-feedback').forEach(e => e.remove());
});

// ── Set today's date on data tab open ──────
document.getElementById('tabData').addEventListener('click', () => {
  if (!document.getElementById('dataDate').value) {
    document.getElementById('dataDate').value = new Date().toISOString().split('T')[0];
  }
});

// ── Boot ───────────────────────────────────
init();
