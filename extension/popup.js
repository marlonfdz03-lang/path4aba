// ─────────────────────────────────────────────
//  Path4ABA Extension — popup.js
//  Auth: credentials:include (browser sends path4aba.app Supabase cookies)
//  The app's middleware must allow CORS for chrome-extension:// origins.
//  See middleware.ts for the required server-side change.
// ─────────────────────────────────────────────

const BASE = 'https://www.path4aba.app';

// ── State ──────────────────────────────────
let userRole = null;     // 'rbt' | 'bcba'
let clients = [];
let selectedClientId = null;
let selectedProfile = null;  // client's clinical_profile
let selectedBehaviors = [];  // names
let selectedSkills = [];     // names
let selectedLocation = null;
let activeTab = 'generate';

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
    const json = await res.json();
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
      const json = await rbtRes.json();
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

// ── Location selector ──────────────────────
document.getElementById('locationGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  document.querySelectorAll('#locationGroup .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedLocation = btn.dataset.val;
  updateGenerateBtn();
});

// ── Generate button state ──────────────────
function updateGenerateBtn() {
  const dateVal = document.getElementById('genDate').value;
  let canGenerate = !!dateVal && !!selectedLocation && !!selectedClientId;

  if (userRole === 'rbt') {
    canGenerate = canGenerate && selectedBehaviors.length === 5 && selectedSkills.length === 2;
    const hint = document.getElementById('generateHint');
    if (!canGenerate && selectedClientId) {
      const missing = [];
      if (!dateVal) missing.push('date');
      if (!selectedLocation) missing.push('location');
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
    sessionInfo: { date, location: selectedLocation, caregiver: '' },
    behaviorsObserved: selectedBehaviors.map(name => ({
      name, topography: '', frequency: 1, antecedentContext: '', function: ''
    })),
    replacementSkillsAddressed: selectedSkills.map(name => ({
      name, promptLevel: '', clientResponse: '', successful: true
    })),
    activitiesUsed: [],
    reinforcersUsed: [],
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

  try {
    // Save to chrome.storage as local backup
    const key = `path4aba_ext_note_${selectedClientId}_${Date.now()}`;
    chrome.storage.local.set({ [key]: { clientId: selectedClientId, note: text, savedAt: new Date().toISOString() } });

    // Save to session_notes table
    await api('/api/session-notes', {
      method: 'POST',
      body: JSON.stringify({
        clientId: selectedClientId,
        noteText: text,
        sessionDate: document.getElementById('genDate').value || new Date().toISOString().split('T')[0],
      }),
    });
  } catch {}

  btn.textContent = 'Saved ✓';
  btn.classList.add('saved');
  setTimeout(() => {
    btn.textContent = 'Save';
    btn.classList.remove('saved');
    btn.disabled = false;
  }, 2000);
});

// ── Auth screen buttons ────────────────────
document.getElementById('loginBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.path4aba.app/login' });
});

document.getElementById('openAppBtn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.path4aba.app' });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/signout', { method: 'POST' }).catch(() => {});
  showScreen('auth');
});

// ── Boot ───────────────────────────────────
init();
