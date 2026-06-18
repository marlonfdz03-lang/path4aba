// ── Data Tab — Helper Functions + Fix Past Data (Section 2) ──────────────────

// ── Date helpers ──────────────────────────────────────────────────────────────

function calcWeekEndDate(startStr) {
  if (!startStr) return null;
  const d = new Date(startStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
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

// ── Legacy save helper (kept for compatibility) ───────────────────────────────
// Uses skillRows / projectedItems state defined in popup.js.
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
    trials: 12,
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

  function renderGroup(items, label, color) {
    if (!items.length) return;
    const hdr = document.createElement('p');
    hdr.style.cssText = `font-size:10px;font-weight:700;color:${color};margin:0 0 5px;letter-spacing:.05em;`;
    hdr.textContent = label;
    list.appendChild(hdr);

    items.forEach(c => {
      const row = document.createElement('div');
      row.dataset.corrId = c.id;
      row.style.cssText = 'padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:5px;';

      const dateStr = c.sessionDate || c.weekStart || '—';
      const oldVal  = c.originalValue !== null && c.originalValue !== undefined ? c.originalValue : '—';
      const newVal  = c.currentValue  !== null && c.currentValue  !== undefined ? c.currentValue  : '—';
      const unit    = c.type === 'replacement' ? '%' : 'occ';
      const reason  = c.justification ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;">${escapeCorrectionsHtml(c.justification)}</div>` : '';

      row.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
          <div style="min-width:0;">
            <div style="font-size:11px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeCorrectionsHtml(c.name)}">${escapeCorrectionsHtml(c.name)}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:1px;">${dateStr} · <span style="color:#dc2626;text-decoration:line-through;">${oldVal}${unit}</span> → <span style="color:#16a34a;font-weight:600;">${newVal}${unit}</span></div>
            ${reason}
          </div>
          <button class="apply-correction-btn" style="flex-shrink:0;font-size:10px;padding:3px 8px;border:1px solid #3b82f6;border-radius:4px;background:#eff6ff;color:#1d4ed8;cursor:pointer;white-space:nowrap;">Apply to OP</button>
        </div>`;
      list.appendChild(row);

      const btn = row.querySelector('.apply-correction-btn');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Applying…';
        const result = await applyCorrectionsToOP([c]);
        if (!result.ok) {
          btn.disabled = false;
          btn.textContent = 'Apply to OP';
          return;
        }
        const succeeded = result.log.some(l => l.startsWith('✓'));
        if (succeeded) {
          try {
            await api('/api/rbt/data-corrections', { method: 'PATCH', body: JSON.stringify({ id: c.id, type: c.type }) });
          } catch {}
          btn.textContent = '✓ Applied';
          btn.style.cssText = 'flex-shrink:0;font-size:10px;padding:3px 8px;border:1px solid #86efac;border-radius:4px;background:#dcfce7;color:#166534;white-space:nowrap;cursor:default;';
        } else {
          btn.disabled = false;
          btn.textContent = 'Apply to OP';
          const errMsg = result.log.find(l => l.startsWith('❌')) || 'Apply failed.';
          setCorrectionsStatus(errMsg.replace(/^❌\s*/, ''), true);
        }
      });
    });
  }

  renderGroup(malad, 'MALADAPTIVES', '#92400e');
  renderGroup(repl,  'REPLACEMENTS', '#065f46');

  // Apply All button
  const applyAllBtn = document.createElement('button');
  applyAllBtn.textContent = 'Apply All to OP';
  applyAllBtn.style.cssText = 'width:100%;margin-top:8px;font-size:11px;padding:6px 0;border:1px solid #3b82f6;border-radius:6px;background:#eff6ff;color:#1d4ed8;cursor:pointer;font-weight:600;';
  applyAllBtn.addEventListener('click', async () => {
    applyAllBtn.disabled = true;
    applyAllBtn.textContent = 'Applying…';
    const result = await applyCorrectionsToOP(corrections);
    if (!result.ok) {
      applyAllBtn.disabled = false;
      applyAllBtn.textContent = 'Apply All to OP';
      return;
    }
    const log = result.log;
    const okLines = log.filter(l => l.startsWith('✓'));
    const applied = corrections.filter(c => okLines.some(l => l.includes(`"${c.name}"`)));
    await Promise.all(applied.map(c =>
      api('/api/rbt/data-corrections', { method: 'PATCH', body: JSON.stringify({ id: c.id, type: c.type }) }).catch(() => {})
    ));
    applied.forEach(c => {
      const row = list.querySelector(`[data-corr-id="${c.id}"]`);
      if (!row) return;
      const btn = row.querySelector('.apply-correction-btn');
      if (!btn) return;
      btn.textContent = '✓ Applied';
      btn.disabled = true;
      btn.style.cssText = 'flex-shrink:0;font-size:10px;padding:3px 8px;border:1px solid #86efac;border-radius:4px;background:#dcfce7;color:#166534;white-space:nowrap;cursor:default;';
    });
    const errCount = corrections.length - applied.length;
    setCorrectionsStatus(
      `Applied ${applied.length} of ${corrections.length} correction${corrections.length !== 1 ? 's' : ''}.${errCount ? ` ${errCount} failed — check OP tab.` : ''}`,
      errCount > 0
    );
    applyAllBtn.disabled = false;
    applyAllBtn.textContent = 'Apply All to OP';
  });
  list.appendChild(applyAllBtn);

  list.style.display = '';
}

async function applyCorrectionsToOP(corrections) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.officepuzzle.com/*' });
    const tab = tabs[0];
    if (!tab?.id) {
      setCorrectionsStatus('No Office Puzzle tab found. Open the datasheet first.', true);
      return { ok: false };
    }
    const tasks = corrections.map(c => ({
      name: c.name,
      dayNumber: c.sessionDate ? parseInt(c.sessionDate.split('-')[2], 10) : 1,
      type: c.type,
      value: c.currentValue,
      trials: c.type === 'replacement' ? (c.totalTrials ?? 12) : undefined,
    }));
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
