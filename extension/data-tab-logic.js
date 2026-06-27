// ── Data Tab — Helper Functions + Fix Past Data (Section 2) ──────────────────

// ── Date helpers ──────────────────────────────────────────────────────────────

function calcWeekEndDate(startStr) {
  if (!startStr) return null;
  const d = new Date(startStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

function fmtWeekRange(mondayStr) {
  if (!mondayStr) return '—';
  try {
    const start = new Date(mondayStr + 'T00:00:00');
    const end   = new Date(mondayStr + 'T00:00:00');
    end.setDate(end.getDate() + 6);
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${mo[start.getMonth()]} ${start.getDate()} – ${mo[end.getMonth()]} ${end.getDate()}`;
  } catch { return mondayStr; }
}

// ── Natural distribution helpers ──────────────────────────────────────────────

function generateDailyPercentages(weeklyAvg, numDays = 5) {
  const maxDeviation = 15;
  const dailyPcts = [];
  for (let i = 0; i < numDays; i++) {
    let pct;
    if (i === numDays - 1) {
      const sum = dailyPcts.reduce((a, b) => a + b, 0);
      pct = Math.round(weeklyAvg * numDays - sum);
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

function generateVariedSequence(correct, incorrect, seed = null) {
  const positions = [
    ...Array(correct).fill('+'),
    ...Array(incorrect).fill('-'),
  ];
  let rng = seed !== null ? mulberry32(seed) : Math.random;
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions;
}

function mulberry32(a) {
  return function () {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Deterministic 32-bit hash — used to seed generateVariedSequence per skill+date,
// so the same skill on the same date always produces the same sequence.
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── Distribute maladaptive total across days with natural variation ────────────
function distributeMaladaptiveAcrossDays(total, numDays) {
  if (numDays <= 0) return [];
  if (numDays === 1) return [total];
  const base = Math.floor(total / numDays);
  let remaining = total;
  const vals = [];
  for (let i = 0; i < numDays - 1; i++) {
    const delta = Math.random() > 0.5 ? 1 : -1;
    const v = Math.max(0, base + delta);
    vals.push(v);
    remaining -= v;
  }
  vals.push(Math.max(0, remaining));
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return vals;
}

// ── Legacy save helper (kept for compatibility) ───────────────────────────────
async function saveReplacementData(autofillCompleted) {
  if (!selectedClientId) return false;
  const weekStart = document.getElementById('weekStartDate')?.value;
  const weekEnd = weekStart ? calcWeekEndDate(weekStart) : null;
  if (!weekStart || !weekEnd) return false;

  const items = (typeof projectedItems !== 'undefined') ? projectedItems : [];
  if (!items.length) return false;

  const replRecs = items.filter(i => i.type === 'replacement').map(item => ({
    clientId: selectedClientId,
    replacementSkill: item.name,
    weekStart,
    weekEnd,
    dailyPercentage: item.projectedValue,
    trials: trialsPerSession,
    userConfirmed: true,
    autofillCompleted,
    platformSource: 'extension',
  }));
  const maladRecs = items.filter(i => i.type === 'maladaptive').map(item => ({
    clientId: selectedClientId,
    behaviorName: item.name,
    weekStart,
    weekEnd,
    frequency: item.dailyValue ?? Math.round((item.projectedValue || 0) / 5),
    userConfirmed: true,
  }));

  try {
    const saves = [];
    if (replRecs.length)  saves.push(api('/api/replacement-data',  { method: 'POST', body: JSON.stringify(replRecs) }));
    if (maladRecs.length) saves.push(api('/api/maladaptive-data', { method: 'POST', body: JSON.stringify(maladRecs) }));
    await Promise.all(saves);
    return true;
  } catch {
    return false;
  }
}

// ── Section 2: Fix Past Data ──────────────────────────────────────────────────

function setCorrectionsStatus(msg, isError) {
  const el = document.getElementById('correctionsStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
  el.style.background = isError ? '#fef2f2' : '#f0fdf4';
  el.style.color      = isError ? '#991b1b'  : '#166534';
}

function escapeCorrectionsHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showWeekStatus(el, msg, isError) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
  el.style.background = isError ? '#fef2f2' : '#f0fdf4';
  el.style.color      = isError ? '#991b1b'  : '#166534';
}

// ── Build a collapsible week card ─────────────────────────────────────────────
function buildWeekCard(weekStart, items) {
  const isReplacement = items[0]?.type === 'replacement';

  const card = document.createElement('div');
  card.style.cssText = 'border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;overflow:hidden;background:#fff;';

  // ── Header (always visible) ──
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;user-select:none;';

  const chevron = document.createElement('span');
  chevron.textContent = '▶';
  chevron.style.cssText = 'font-size:8px;color:#9ca3af;transition:transform .15s;flex-shrink:0;display:inline-block;';

  const weekLabel = document.createElement('span');
  weekLabel.style.cssText = 'font-size:11px;font-weight:600;color:#111827;flex:1;';
  weekLabel.textContent = `Week of ${fmtWeekRange(weekStart)}`;

  const countBadge = document.createElement('span');
  countBadge.style.cssText = 'font-size:10px;color:#6b7280;flex-shrink:0;';
  countBadge.textContent = `(${items.length} change${items.length !== 1 ? 's' : ''})`;

  header.appendChild(chevron);
  header.appendChild(weekLabel);
  header.appendChild(countBadge);
  card.appendChild(header);

  // ── Body (collapsed by default) ──
  const body = document.createElement('div');
  body.style.cssText = 'display:none;padding:0 10px 10px;border-top:1px solid #f3f4f6;';
  card.appendChild(body);

  let expanded = false;
  header.addEventListener('click', () => {
    expanded = !expanded;
    body.style.display = expanded ? '' : 'none';
    chevron.style.transform = expanded ? 'rotate(90deg)' : '';
  });

  // ── Corrections rows ──
  const corrList = document.createElement('div');
  corrList.style.cssText = 'margin-top:8px;';

  items.forEach(c => {
    const unit   = c.type === 'replacement' ? '%' : 'cc';
    const oldVal = c.originalValue !== null && c.originalValue !== undefined ? `${c.originalValue}${unit}` : `—${unit}`;
    const newVal = c.currentValue  !== null && c.currentValue  !== undefined ? `${c.currentValue}${unit}`  : `—${unit}`;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:4px;padding:4px 0;border-bottom:1px solid #f9fafb;';

    const bullet = document.createElement('span');
    bullet.style.cssText = 'font-size:10px;color:#9ca3af;flex-shrink:0;margin-top:1px;line-height:1.6;';
    bullet.textContent = '•';

    const info = document.createElement('div');
    info.style.cssText = 'min-width:0;flex:1;';

    const nameLine = document.createElement('div');
    nameLine.style.cssText = 'font-size:11px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameLine.title = c.name;
    nameLine.textContent = c.name;

    const valLine = document.createElement('div');
    valLine.style.cssText = 'font-size:10px;color:#6b7280;margin-top:1px;';
    valLine.innerHTML = `<span style="color:#dc2626;text-decoration:line-through;">${escapeCorrectionsHtml(oldVal)}</span> → <span style="color:#16a34a;font-weight:600;">${escapeCorrectionsHtml(newVal)}</span>`;

    info.appendChild(nameLine);
    info.appendChild(valLine);

    if (c.justification) {
      const justLine = document.createElement('div');
      justLine.style.cssText = 'font-size:10px;color:#6b7280;font-style:italic;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      justLine.title = c.justification;
      justLine.textContent = `"${c.justification}"`;
      info.appendChild(justLine);
    }

    row.appendChild(bullet);
    row.appendChild(info);
    corrList.appendChild(row);
  });

  body.appendChild(corrList);

  // ── Apply This Week button ──
  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply This Week to OP';
  applyBtn.style.cssText = 'width:100%;margin-top:8px;font-size:11px;padding:6px 0;border:1px solid #3b82f6;border-radius:6px;background:#eff6ff;color:#1d4ed8;cursor:pointer;font-weight:600;';
  body.appendChild(applyBtn);

  // ── Day selector (shown after Apply click) ──
  const daySelector = document.createElement('div');
  daySelector.style.display = 'none';
  body.appendChild(daySelector);

  // ── Per-week status message ──
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'display:none;margin-top:6px;font-size:11px;padding:5px 8px;border-radius:5px;';
  body.appendChild(statusEl);

  applyBtn.addEventListener('click', () => {
    if (daySelector.style.display !== 'none') return;

    daySelector.innerHTML = '';

    const dayLbl = document.createElement('p');
    dayLbl.style.cssText = 'font-size:10px;font-weight:700;color:#374151;margin:8px 0 4px;text-transform:uppercase;letter-spacing:.04em;';
    dayLbl.textContent = 'Days worked this week';
    daySelector.appendChild(dayLbl);

    const dayDates  = getWeekDaysFromMonday(weekStart);
    const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const checkedDates = new Set(dayDates.slice(0, 5));

    const daysGrid = document.createElement('div');
    daysGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;';

    dayDates.forEach((dateStr, i) => {
      const d   = new Date(dateStr + 'T00:00:00');
      const lbl = `${DAY_SHORT[i]} ${d.getMonth()+1}/${d.getDate()}`;
      const isChecked = i < 5;

      const chipLabel = document.createElement('label');
      chipLabel.style.cssText = `display:flex;align-items:center;gap:3px;font-size:10px;padding:3px 7px;border:1px solid ${isChecked ? '#3b82f6' : '#e5e7eb'};border-radius:20px;background:${isChecked ? '#eff6ff' : '#fff'};color:${isChecked ? '#1d4ed8' : '#6b7280'};cursor:pointer;`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.style.cssText = 'width:11px;height:11px;accent-color:#2563EB;';

      cb.addEventListener('change', () => {
        if (cb.checked) {
          checkedDates.add(dateStr);
          chipLabel.style.borderColor = '#3b82f6';
          chipLabel.style.background  = '#eff6ff';
          chipLabel.style.color       = '#1d4ed8';
        } else {
          checkedDates.delete(dateStr);
          chipLabel.style.borderColor = '#e5e7eb';
          chipLabel.style.background  = '#fff';
          chipLabel.style.color       = '#6b7280';
        }
      });

      chipLabel.appendChild(cb);
      chipLabel.appendChild(document.createTextNode(lbl));
      daysGrid.appendChild(chipLabel);
    });

    daySelector.appendChild(daysGrid);

    if (isReplacement) {
      const notice = document.createElement('p');
      notice.style.cssText = 'font-size:10px;color:#854d0e;background:#fef9c3;border:1px solid #fde047;border-radius:5px;padding:5px 8px;margin-bottom:8px;line-height:1.4;';
      notice.textContent = `Navigate to the OP datasheet for the week of ${fmtWeekRange(weekStart)}, then click Apply below.`;
      daySelector.appendChild(notice);
    }

    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex;gap:6px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex:1;font-size:11px;padding:6px 0;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#374151;cursor:pointer;';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm & Apply';
    confirmBtn.style.cssText = 'flex:2;font-size:11px;padding:6px 0;border:1px solid #2563EB;border-radius:6px;background:#2563EB;color:#fff;cursor:pointer;font-weight:600;';

    cancelBtn.addEventListener('click', () => {
      daySelector.style.display = 'none';
      daySelector.innerHTML = '';
    });

    confirmBtn.addEventListener('click', async () => {
      const workedDays = [...checkedDates].sort();
      if (!workedDays.length) {
        showWeekStatus(statusEl, 'Select at least one worked day.', true);
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Applying…';
      cancelBtn.disabled = true;

      const result = await applyWeekToOP(items, workedDays);

      if (!result.ok) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Apply';
        cancelBtn.disabled = false;
        return;
      }

      const okLines = result.log.filter(l => l.startsWith('✓'));
      const applied = items.filter(c => okLines.some(l => l.includes(`"${c.name}"`)));
      const errCount = items.length - applied.length;

      if (!applied.length) {
        const errMsg = (result.log.find(l => l.startsWith('❌')) || 'Apply failed — check OP tab.').replace(/^❌\s*/, '');
        showWeekStatus(statusEl, errMsg, true);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Apply';
        cancelBtn.disabled = false;
        return;
      }

      await Promise.all(applied.map(c =>
        api('/api/rbt/data-corrections', { method: 'PATCH', body: JSON.stringify({ id: c.id, type: c.type }) }).catch(() => {})
      ));

      showWeekStatus(statusEl,
        `✓ Applied ${applied.length} of ${items.length}${errCount ? ` (${errCount} failed — check OP)` : ''}`,
        errCount > 0
      );

      daySelector.style.display = 'none';
      applyBtn.style.display = 'none';

      if (applied.length === items.length) {
        setTimeout(() => {
          card.style.opacity = '0';
          card.style.transition = 'opacity .3s';
          setTimeout(() => card.remove(), 310);
        }, 1500);
      }
    });

    actionsRow.appendChild(cancelBtn);
    actionsRow.appendChild(confirmBtn);
    daySelector.appendChild(actionsRow);

    daySelector.style.display = '';
  });

  return card;
}

// ── Render grouped corrections ────────────────────────────────────────────────
function renderCorrectionsList(corrections) {
  const list = document.getElementById('correctionsList');
  if (!list) return;
  list.innerHTML = '';

  if (!corrections.length) {
    list.innerHTML = '<p style="font-size:11px;color:#6b7280;margin:4px 0;">No pending corrections found.</p>';
    list.style.display = '';
    return;
  }

  const malad = corrections.filter(c => c.type === 'maladaptive');
  const repl  = corrections.filter(c => c.type === 'replacement');

  function renderTypeGroup(items, label, color) {
    if (!items.length) return;

    const hdr = document.createElement('p');
    hdr.style.cssText = `font-size:10px;font-weight:700;color:${color};margin:8px 0 4px;letter-spacing:.05em;`;
    hdr.textContent = label;
    list.appendChild(hdr);

    const byWeek = {};
    items.forEach(c => {
      const ws = c.weekStart || getMondayOfDate(c.sessionDate || new Date().toISOString().split('T')[0]);
      (byWeek[ws] = byWeek[ws] || []).push(c);
    });

    Object.keys(byWeek).sort((a, b) => b.localeCompare(a)).forEach(weekStart => {
      list.appendChild(buildWeekCard(weekStart, byWeek[weekStart]));
    });
  }

  renderTypeGroup(malad, 'MALADAPTIVES', '#92400e');
  renderTypeGroup(repl,  'REPLACEMENTS', '#065f46');

  list.style.display = '';
}

// ── Core OP task runner ───────────────────────────────────────────────────────
async function runTasksOnOP(tasks) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.officepuzzle.com/*' });
    const tab = tabs[0];
    if (!tab?.id) {
      setCorrectionsStatus('No Office Puzzle tab found. Open the datasheet first.', true);
      return { ok: false };
    }
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: officePuzzleDatasheetAutofiller,
      args: [tasks],
      world: 'MAIN',
    });
    const log = result?.[0]?.result || [];
    return { ok: true, log };
  } catch (err) {
    setCorrectionsStatus('Error: ' + err.message, true);
    return { ok: false };
  }
}

// ── Apply a week's corrections across worked days ─────────────────────────────
async function applyWeekToOP(corrections, workedDayDates) {
  const tasks = [];
  corrections.forEach(c => {
    if (c.type === 'maladaptive') {
      const dailyVals = distributeMaladaptiveAcrossDays(c.currentValue ?? 0, workedDayDates.length);
      workedDayDates.forEach((dateStr, idx) => {
        tasks.push({
          name: c.name,
          dayNumber: new Date(dateStr + 'T00:00:00').getDate(),
          type: 'maladaptive',
          value: dailyVals[idx],
        });
      });
    } else {
      workedDayDates.forEach(dateStr => {
        tasks.push({
          name: c.name,
          dayNumber: new Date(dateStr + 'T00:00:00').getDate(),
          type: 'replacement',
          value: c.currentValue,
          trials: c.totalTrials ?? trialsPerSession,
        });
      });
    }
  });
  return runTasksOnOP(tasks);
}

// ── Legacy: apply corrections at their exact session date (kept for compatibility) ──
async function applyCorrectionsToOP(corrections) {
  const tasks = corrections.map(c => ({
    name: c.name,
    dayNumber: c.sessionDate ? parseInt(c.sessionDate.split('-')[2], 10) : 1,
    type: c.type,
    value: c.currentValue,
    trials: c.type === 'replacement' ? (c.totalTrials ?? 12) : undefined,
  }));
  return runTasksOnOP(tasks);
}

document.getElementById('loadCorrectionsBtn').addEventListener('click', async () => {
  if (!selectedClientId) {
    setCorrectionsStatus('Select a client first.', true);
    return;
  }
  const btn = document.getElementById('loadCorrectionsBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  setCorrectionsStatus('', false);
  document.getElementById('correctionsList').style.display = 'none';

  try {
    const res = await api(`/api/rbt/data-corrections?clientId=${selectedClientId}`);
    if (!res.ok) { setCorrectionsStatus('Could not load corrections.', true); return; }
    const { corrections } = await res.json().catch(() => ({ corrections: [] }));
    renderCorrectionsList(corrections || []);
    setCorrectionsStatus(
      corrections?.length
        ? `${corrections.length} pending correction${corrections.length !== 1 ? 's' : ''}`
        : 'No pending corrections.',
      false
    );
  } catch {
    setCorrectionsStatus('Network error. Check your connection.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load Corrections';
  }
});
