// ── Data Tab — Helper Functions + Fix Past Data (Section 2) ──────────────────

// ── Date helpers ──────────────────────────────────────────────────────────────

function calcWeekEndDate(startStr) {
  if (!startStr) return null;
  const d = new Date(startStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
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
  if (total <= 0) return Array(numDays).fill(0); // rule 1: zeros only when total is 0

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Not enough to give every day ≥1 — spread single counts across `total` random
  // days (zeros are mathematically unavoidable here).
  if (total < numDays) {
    const vals = Array(numDays).fill(0);
    for (let i = 0; i < total; i++) vals[i] = 1;
    return shuffle(vals);
  }

  const avg = total / numDays;
  const base = Math.floor(avg);
  // Max per-day deviation: ±40% of base, at least 1, capped at 3 when the base is small (rule 4).
  let maxDev = Math.max(1, Math.round(avg * 0.4));
  if (avg < 8) maxDev = Math.min(3, maxDev);

  const vals = [];
  let remaining = total;
  for (let i = 0; i < numDays - 1; i++) {
    const daysAfter = numDays - 1 - i; // days still to fill after this one (incl. remainder day)
    const dev = Math.floor(Math.random() * (2 * maxDev + 1)) - maxDev;
    let v = base + dev;
    if (v < 1) v = 1;                      // rule 1: never 0
    if (v > total) v = total;              // rule 2: never exceed total
    const maxAllowed = remaining - daysAfter; // leave ≥1 for every later day (incl. remainder)
    if (v > maxAllowed) v = maxAllowed;
    if (v < 1) v = 1;
    vals.push(v);
    remaining -= v;
  }
  vals.push(remaining); // rule 5: last day is the exact remainder (≥1, ≤total, sum is exact)

  return shuffle(vals); // rule 6: randomize which day holds the remainder
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

      // ── Read-only preview (rendered above Confirm & Apply) ──
      // Lets the RBT inspect the current OP pattern and see how many trials will flip
      // per worked day BEFORE anything is applied — cancel if it looks wrong.
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.textContent = '🔍 Preview current pattern';
      previewBtn.style.cssText = 'width:100%;margin-bottom:8px;font-size:11px;padding:6px 0;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;color:#374151;cursor:pointer;font-weight:600;';
      daySelector.appendChild(previewBtn);

      const previewContainer = document.createElement('div');
      daySelector.appendChild(previewContainer);

      previewBtn.addEventListener('click', async () => {
        const workedDays = [...checkedDates].sort();
        if (!workedDays.length) {
          showWeekStatus(statusEl, 'Select at least one worked day to preview.', true);
          return;
        }
        previewBtn.disabled = true;
        previewBtn.textContent = 'Reading OP…';
        previewContainer.innerHTML = '';
        try {
          const tabs = await chrome.tabs.query({ url: '*://*.officepuzzle.com/*' });
          const tab = tabs[0];
          if (!tab?.id) {
            showWeekStatus(statusEl, 'No Office Puzzle tab found. Open the datasheet first.', true);
            return;
          }
          const patternRows = await readReplacementPattern(tab, items, workedDays);
          renderReplacementPreview(previewContainer, items, workedDays, patternRows);
        } catch (err) {
          showWeekStatus(statusEl, 'Preview failed: ' + err.message, true);
        } finally {
          previewBtn.disabled = false;
          previewBtn.textContent = '🔍 Preview current pattern';
        }
      });
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

      // Applied to OP — but do NOT resolve the corrections or save to Path4ABA yet.
      // Let the RBT verify the result in OP first, then commit via "Mark as Done".
      showWeekStatus(statusEl,
        `✓ Applied ${applied.length} of ${items.length}${errCount ? ` (${errCount} failed — check OP)` : ''} — verify in OP, then mark done.`,
        errCount > 0
      );

      daySelector.style.display = 'none';
      applyBtn.style.display = 'none';

      // Two-phase confirm: show a green button so the RBT can verify the autofill in OP
      // before anything is committed. Only on click do we save the corrected values to
      // Path4ABA, mark the corrections resolved, and fade the card.
      const doneBtn = document.createElement('button');
      doneBtn.textContent = '✓ Looks correct in OP — Mark as Done';
      doneBtn.style.cssText = 'width:100%;margin-top:8px;font-size:11px;padding:7px 0;border:1px solid #16a34a;border-radius:6px;background:#16a34a;color:#fff;cursor:pointer;font-weight:600;';
      body.appendChild(doneBtn);

      doneBtn.addEventListener('click', async () => {
        doneBtn.disabled = true;
        doneBtn.textContent = 'Saving…';

        // Persist the corrected values to Path4ABA so the charts update. Fire-and-forget
        // with errors swallowed. For maladaptives, dailyVals is computed once per correction
        // — same as applyWeekToOP — so the saved per-day frequencies form one consistent
        // distribution summing to the total.
        applied.forEach(c => {
          const corrWeekStart = c.weekStart || getMondayOfDate(workedDays[0]) || workedDays[0];
          if (c.type === 'replacement') {
            workedDays.forEach(dateStr => {
              api('/api/replacement-data', {
                method: 'POST',
                body: JSON.stringify([{
                  clientId: selectedClientId,
                  replacementSkill: c.name,
                  weekStart: corrWeekStart,
                  sessionDate: dateStr,
                  observedPercentage: c.currentValue,
                  totalTrials: c.totalTrials ?? trialsPerSession ?? 10,
                  userConfirmed: true,
                  autofillCompleted: true,
                  platformSource: 'extension',
                }]),
              }).catch(() => {});
            });
          } else {
            const dailyVals = distributeMaladaptiveAcrossDays(c.currentValue ?? 0, workedDays.length);
            workedDays.forEach((dateStr, idx) => {
              api('/api/maladaptive-data', {
                method: 'POST',
                body: JSON.stringify([{
                  clientId: selectedClientId,
                  behaviorName: c.name,
                  weekStart: corrWeekStart,
                  sessionDate: dateStr,
                  frequency: dailyVals[idx] ?? 0,
                  userConfirmed: true,
                  autofillCompleted: true,
                  platformSource: 'extension',
                }]),
              }).catch(() => {});
            });
          }
        });

        // Mark the applied corrections resolved (only now that the RBT confirmed OP looks right).
        await Promise.all(applied.map(c =>
          api('/api/rbt/data-corrections', { method: 'PATCH', body: JSON.stringify({ id: c.id, type: c.type }) }).catch(() => {})
        ));

        showWeekStatus(statusEl, 'Applied and confirmed', false);
        doneBtn.textContent = '✓ Done';

        if (applied.length === items.length) {
          setTimeout(() => {
            card.style.opacity = '0';
            card.style.transition = 'opacity .3s';
            setTimeout(() => card.remove(), 310);
          }, 1500);
        }
      });
    });

    actionsRow.appendChild(cancelBtn);
    actionsRow.appendChild(confirmBtn);
    daySelector.appendChild(actionsRow);

    daySelector.style.display = '';
  });

  return card;
}

// ── Section 2b: Replacement pattern preview (read-only, pre-confirm) ───────────

// Injected into the OP tab (MAIN world) to READ — never click — the current
// replacement pattern. Serialized by chrome.scripting.executeScript, so it must be
// fully self-contained: every helper it uses is declared inside it.
async function opReadReplacementPattern(skills, days) {
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  function namesMatch(a, b) {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const al = norm(a), bl = norm(b);
    if (al === bl) return true;
    if (al.includes(bl) || bl.includes(al)) return true;
    const aWords = al.split(' ').filter(w => w.length > 2);
    const bWords = new Set(bl.split(' ').filter(w => w.length > 2));
    return aWords.some(w => bWords.has(w));
  }

  function findDayColumn(table, dayNumber) {
    const day = parseInt(dayNumber, 10);
    const rows = Array.from(table.querySelectorAll('tr'));
    let targetCol = -1;
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (!cells.length || cells[0].textContent.trim() !== 'Days') continue;
      cells.forEach((cell, colIdx) => {
        if (colIdx === 1) return; // col 1 is the previous-month overflow
        const raw = cell.textContent.trim();
        if (parseInt(raw, 10) === day && /^\d{1,2}$/.test(raw)) targetCol = colIdx;
      });
      break;
    }
    return targetCol;
  }

  function readSymbol(cell) {
    const span = cell?.querySelector('span.bold span');
    const text = span?.innerText?.trim() || '';
    if (text.includes('＋')) return '＋';
    if (text.includes('－')) return '－';
    return '·';
  }

  // Nudge Vue to mount lazy cells, then return to top.
  let pos = 0, h = document.documentElement.scrollHeight;
  while (pos < h) { pos = Math.min(pos + 600, h); window.scrollTo(0, pos); await delay(120); h = document.documentElement.scrollHeight; }
  window.scrollTo(0, 0);
  await delay(200);

  const out = [];
  for (const skill of skills) {
    const h4El = Array.from(document.querySelectorAll('h4')).find(x => namesMatch(x.innerText.trim(), skill.name));
    let hiddenContainer = null;
    if (h4El) {
      const container = h4El.parentElement;
      if (container?.classList.contains('d-none')) { container.classList.remove('d-none'); hiddenContainer = container; await delay(150); }
    }
    // h4El is already found and its container is already d-none-removed.
    // Search for the trial table starting from h4El in DOM order — since the
    // container is revealed, the table's rows/innerText are now readable.
    let table = null;
    if (h4El) {
      const allEls = Array.from(document.querySelectorAll('h4, table'));
      let pastH4 = false;
      for (const el of allEls) {
        if (el === h4El) { pastH4 = true; continue; }
        if (pastH4 && el.tagName === 'TABLE') {
          const rows = el.querySelectorAll('tr');
          if (rows.length >= 10) {
            // Trial table = one that contains at least one "Trial …" row. Scan all
            // rows (not just row[0]) so a header-first layout still matches.
            const hasTrialRow = Array.from(rows).some(r => r.querySelector('td')?.innerText.trim().startsWith('Trial'));
            if (hasTrialRow) {
              table = el;
              break;
            }
          }
        }
      }
    }
    for (const day of days) {
      if (!table) { out.push({ skillName: skill.name, dayNumber: day.dayNumber, trials: null, currentPct: null }); continue; }
      const trialRows = Array.from(table.querySelectorAll('tr'))
        .filter(r => r.querySelector('td')?.innerText.trim().startsWith('Trial'));
      const colIdx = findDayColumn(table, day.dayNumber);
      if (colIdx < 0) { out.push({ skillName: skill.name, dayNumber: day.dayNumber, trials: null, currentPct: null }); continue; }
      const total = skill.totalTrials || trialRows.length;
      const trials = trialRows.slice(0, total).map(r => readSymbol(Array.from(r.querySelectorAll('td'))[colIdx]));
      const plus = trials.filter(s => s === '＋').length;
      const currentPct = total ? Math.round(plus / total * 100) : 0;
      out.push({ skillName: skill.name, dayNumber: day.dayNumber, trials, currentPct });
    }
    if (hiddenContainer) hiddenContainer.classList.add('d-none');
  }
  return out;
}

// Popup-side wrapper: runs a preliminary read-only executeScript on the OP tab and
// returns [{ skillName, dayNumber, trials:['＋','－','·',…], currentPct }] for every
// replacement skill × worked day. No cells are clicked — safe to run before confirm.
async function readReplacementPattern(tab, corrections, workedDays) {
  const skills = corrections
    .filter(c => c.type === 'replacement')
    .map(c => ({
      name: c.name,
      targetPct: c.currentValue,
      totalTrials: c.totalTrials ?? trialsPerSession ?? 10,
    }));
  const days = workedDays.map(dateStr => ({
    dateStr,
    dayNumber: new Date(dateStr + 'T00:00:00').getDate(),
  }));
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: opReadReplacementPattern,
    args: [skills, days],
    world: 'MAIN',
  });
  return res?.result || [];
}

// Render the read-only preview grid (rows = trials, cols = worked days) into
// `container`, one table per replacement skill. Cells that will flip are shaded.
function renderReplacementPreview(container, corrections, workedDays, patternRows) {
  container.innerHTML = '';

  const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dayCols = workedDays.map(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();              // 0=Sun … 6=Sat
    const idx = dow === 0 ? 6 : dow - 1; // Mon=0 … Sun=6
    return { dateStr, dayNumber: d.getDate(), label: `${DAY_SHORT[idx]} ${d.getMonth() + 1}/${d.getDate()}` };
  });

  const repl = corrections.filter(c => c.type === 'replacement');
  if (!repl.length) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin:8px 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;';

  repl.forEach(c => {
    const totalTrials   = c.totalTrials ?? trialsPerSession ?? 10;
    const targetPct     = c.currentValue;
    const targetCorrect = Math.round((targetPct || 0) / 100 * totalTrials);

    const perDay = dayCols.map(col => {
      const row = patternRows.find(r => r.skillName === c.name && r.dayNumber === col.dayNumber);
      const trials = Array.isArray(row?.trials) ? row.trials : null;
      const currentPct = (row && row.currentPct != null) ? row.currentPct : null;
      const currentCorrect = trials ? trials.filter(s => s === '＋').length : null;
      const diff = currentCorrect != null ? targetCorrect - currentCorrect : null;

      // Illustrative highlight: the first |diff| cells of the type that would flip.
      // The autofiller shuffles before clicking, so the COUNT is exact but the actual
      // cells are randomized on apply.
      const highlight = new Set();
      if (trials && diff) {
        const want = diff > 0 ? '－' : '＋';
        let need = Math.abs(diff);
        for (let i = 0; i < trials.length && need > 0; i++) {
          if (trials[i] === want) { highlight.add(i); need--; }
        }
      }
      return { col, trials, currentPct, diff, highlight };
    });

    const nTrials = Math.max(totalTrials, ...perDay.map(d => (d.trials ? d.trials.length : 0)));

    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:10px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.03em;margin:8px 0 3px;';
    hdr.textContent = c.name;
    wrap.appendChild(hdr);

    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;font-size:10px;width:100%;';

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    htr.appendChild(document.createElement('th')); // empty corner
    dayCols.forEach(col => {
      const th = document.createElement('th');
      th.style.cssText = 'padding:1px 4px;color:#374151;font-weight:600;text-align:center;white-space:nowrap;';
      th.textContent = col.label;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 0; i < nTrials; i++) {
      const tr = document.createElement('tr');
      const lbl = document.createElement('td');
      lbl.style.cssText = 'padding:1px 4px;color:#6b7280;white-space:nowrap;';
      lbl.textContent = `Trial ${i + 1}`;
      tr.appendChild(lbl);
      perDay.forEach(d => {
        const td = document.createElement('td');
        const sym = d.trials ? (d.trials[i] ?? '·') : '?';
        const flips = d.highlight.has(i);
        td.style.cssText = `padding:1px 4px;text-align:center;${flips ? 'background:#fef08a;font-weight:700;border-radius:2px;' : ''}`;
        td.textContent = sym;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const tfoot = document.createElement('tfoot');
    const footRow = (label, labelColor, cellFn) => {
      const tr = document.createElement('tr');
      const l = document.createElement('td');
      l.style.cssText = `padding:2px 4px;color:${labelColor};font-weight:600;white-space:nowrap;border-top:1px solid #e5e7eb;`;
      l.textContent = label;
      tr.appendChild(l);
      perDay.forEach(d => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:2px 4px;text-align:center;border-top:1px solid #e5e7eb;';
        td.appendChild(cellFn(d));
        tr.appendChild(td);
      });
      return tr;
    };

    tfoot.appendChild(footRow('Current', '#6b7280', d =>
      document.createTextNode(d.currentPct != null ? `${d.currentPct}%` : '—')));
    tfoot.appendChild(footRow('Target', '#065f46', () =>
      document.createTextNode(targetPct != null ? `${targetPct}%` : '—')));
    tfoot.appendChild(footRow('Change', '#374151', d => {
      const span = document.createElement('span');
      if (d.diff == null)    { span.textContent = '—'; span.style.color = '#9ca3af'; }
      else if (d.diff === 0) { span.textContent = '0'; span.style.color = '#9ca3af'; }
      else {
        span.textContent = (d.diff > 0 ? '+' : '') + d.diff;
        span.style.color = d.diff > 0 ? '#16a34a' : '#dc2626';
        span.style.fontWeight = '700';
      }
      return span;
    }));
    table.appendChild(tfoot);

    wrap.appendChild(table);
  });

  const note = document.createElement('p');
  note.style.cssText = 'font-size:9px;color:#9ca3af;margin:4px 0 0;font-style:italic;';
  note.textContent = 'Shaded = trials that will flip (count is exact; which cells are randomized on apply).';
  wrap.appendChild(note);

  container.appendChild(wrap);
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
      const ws = getMondayOfDate(c.weekStart || c.sessionDate || new Date().toISOString().split('T')[0]);
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

// ── Build OP item-data map from a service_plan_item_data_sheets response ────────
// Mirrors the parsing in officePuzzleDatasheetAutofiller, but runs popup-side so the
// resulting map can be passed into the injected function (avoids the CORS-blocked
// fetch from the injected MAIN-world context). Handles both array-of-records and
// array-of-sheets response shapes.
function buildOpDataMap(sheetsData) {
  const opDataMap = {};
  const entries = Array.isArray(sheetsData) ? sheetsData : (sheetsData.data || sheetsData.records || []);
  entries.forEach(entry => {
    if (entry.item?.name) {
      // Shape: flat record — { item: { id, name }, id, date, value, recordings, ... }
      const name = entry.item.name.trim();
      if (!opDataMap[name]) opDataMap[name] = { itemId: entry.item.id, records: [] };
      if (entry.id) {
        opDataMap[name].records.push({
          id: entry.id, date: entry.date, value: entry.value,
          recordings: entry.recordings, labels: entry.labels,
          hours: entry.hours, initials: entry.initials,
        });
      }
    } else if (entry.item_id) {
      // Shape: sheet wrapper — { item_id, item_name/name, data/records: [...] }
      const name = (entry.item_name || entry.name || '').trim();
      if (!name) return;
      if (!opDataMap[name]) opDataMap[name] = { itemId: entry.item_id, records: [] };
      (entry.data || entry.records || []).forEach(r => {
        opDataMap[name].records.push({
          id: r.id, date: r.date, value: r.value,
          recordings: r.recordings, labels: r.labels,
          hours: r.hours, initials: r.initials,
        });
      });
    }
  });
  return opDataMap;
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

    // Extract buId + viewing month + OP auth token from the OP tab before the main
    // injection, so the OP data fetch can run popup-side. The token is passed as a
    // Bearer header because the background service worker doesn't share the OP
    // cookie jar (cookie-based credentials return 401).
    const [metaResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const buId = window.location.pathname.match(/\/([a-f0-9]{24})\//)?.[1];
        const monthParam = new URLSearchParams(window.location.search).get('month')
          || window.location.hash.match(/month=(\d{4}-\d{2})/)?.[1]
          || null;
        const now = new Date();
        const opViewMonth = (monthParam && /^\d{4}-\d{2}$/.test(monthParam))
          ? monthParam
          : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Try to get auth token from localStorage keys OP commonly uses
        const token =
          localStorage.getItem('token') ||
          localStorage.getItem('auth_token') ||
          localStorage.getItem('access_token') ||
          localStorage.getItem('authToken') ||
          localStorage.getItem('jwt') ||
          null;

        // Also check cookies for session token
        const cookieToken = document.cookie
          .split(';')
          .map(c => c.trim())
          .find(c => c.startsWith('token=') || c.startsWith('auth=') ||
                     c.startsWith('session=') || c.startsWith('_session='))
          ?.split('=')[1] || null;

        return { buId, opViewMonth, token: token || cookieToken };
      },
      world: 'MAIN',
    });
    const { buId, opViewMonth, token } = metaResult.result;
    if (!buId) {
      setCorrectionsStatus('Could not find OP business unit in the URL. Open the datasheet page first.', true);
      return { ok: false };
    }
    const opDataMap = {};

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: officePuzzleDatasheetAutofiller,
      args: [tasks, opDataMap],
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
