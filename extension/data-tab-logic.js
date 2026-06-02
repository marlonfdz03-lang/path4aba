// ── Week-based Data Tab Logic (Updated) ───

// ── Week Helper Functions ──────────────────
function calcWeekEndDate(startStr) {
  if (!startStr) return null;
  const start = new Date(startStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);  // 7 days total (Mon-Sun)
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

// ── Generate daily percentages with natural variation ──
function generateDailyPercentages(weeklyAvg, numDays = 5) {
  const dailyPcts = [];
  const maxDeviation = 15;

  for (let i = 0; i < numDays; i++) {
    let pct;
    if (i === numDays - 1) {
      // Last day: adjust to match weekly average
      const sum = dailyPcts.reduce((a, b) => a + b, 0);
      pct = Math.round((weeklyAvg * numDays - sum));
      pct = Math.max(0, Math.min(100, pct));
    } else {
      // Random variation around weekly average
      const deviation = (Math.random() - 0.5) * (maxDeviation * 2);
      pct = Math.round(weeklyAvg + deviation);
      pct = Math.max(0, Math.min(100, pct));
    }
    dailyPcts.push(pct);
  }

  return dailyPcts;
}

// ── Generate varied trial sequences ────
function generateVariedSequence(correct, incorrect, seed = null) {
  const positions = [];

  for (let i = 0; i < correct; i++) {
    positions.push('+');
  }
  for (let i = 0; i < incorrect; i++) {
    positions.push('-');
  }

  // Shuffle
  let rng = seed ? mulberry32(seed) : Math.random;
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  return positions;
}

// ── Seeded RNG ─────────────────────────
function mulberry32(a) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
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
      
      // Reset generated data
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

  renderSkillCards();
  renderReviewScreen();
  document.getElementById('reviewSection').style.display = '';
  
  if (hasErrors) {
    showDataMsg('Some skills have invalid percentages. Use 0–100.');
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

  if (!records.length) {
    showDataMsg('No calculated data to save. Click "Calculate Data" first.');
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
