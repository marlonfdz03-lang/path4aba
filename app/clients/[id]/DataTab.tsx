"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────

type Section = "maladaptive" | "replacement";

interface WeekPoint { week: string; avg: number }

// ── Utilities ──────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  return s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
}

function fmtWeek(week: string): string {
  if (!week || week === "?") return "";
  try {
    // Accept both "YYYY-MM" and "YYYY-MM-DD" — always extract just the month part
    const yymm = week.substring(0, 7);
    const d = new Date(yymm + "-01");
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  } catch {
    return week;
  }
}

function todayWeekStr(): string {
  return new Date().toISOString().substring(0, 7);
}

function addWeeksToMonth(weekStr: string, n: number): string {
  try {
    const yymm = weekStr.substring(0, 7);
    const d = new Date(yymm + "-01");
    d.setDate(d.getDate() + n * 7);
    return d.toISOString().substring(0, 7);
  } catch {
    return weekStr;
  }
}

function weeklyAvgs(records: any[], valueKey: string): WeekPoint[] {
  const map: Record<string, number[]> = {};
  records.forEach((r) => {
    const raw = r.week_start || r.session_date || "?";
    // Normalize to YYYY-MM so YYYY-MM-DD and YYYY-MM records group together
    const week = raw !== "?" ? raw.substring(0, 7) : "?";
    (map[week] = map[week] || []).push(Number(r[valueKey]) || 0);
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, vs]) => ({
      week,
      avg: Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10) / 10,
    }));
}

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Weekly confirmation utilities ──────────────────────────────────────────

type SessionQuality = "normal" | "missed" | "poor";

function getWeekDates(weekStr: string): { dayIdx: number; label: string; dateStr: string }[] {
  const LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const base = new Date(weekStr.substring(0, 7) + "-15T12:00:00Z");
  const dow = base.getUTCDay();
  const sunday = new Date(base);
  sunday.setUTCDate(base.getUTCDate() - dow);
  return LABELS.map((label, i) => {
    const d = new Date(sunday);
    d.setUTCDate(sunday.getUTCDate() + i);
    return { dayIdx: i, label, dateStr: d.toISOString().slice(0, 10) };
  });
}

function distributeWeekly(
  weeklyValue: number,
  dayIdxs: number[],
  isReplacement: boolean,
  seed: number,
): Record<number, number> {
  if (dayIdxs.length === 0) return {};
  const rng = mulberry32(seed);
  const n = dayIdxs.length;
  if (isReplacement) {
    const raw = dayIdxs.map(() =>
      Math.max(0, Math.min(100, weeklyValue + (rng() - 0.5) * 14)),
    );
    const avg = raw.reduce((s, v) => s + v, 0) / n;
    const scale = avg > 0 ? weeklyValue / avg : 1;
    return Object.fromEntries(
      dayIdxs.map((d, i) => [d, Math.round(Math.min(100, Math.max(0, raw[i] * scale)))]),
    );
  }
  const base = Math.floor(weeklyValue / n);
  const extra = Math.round(weeklyValue) - base * n;
  const vals = dayIdxs.map((_, i) => base + (i < extra ? 1 : 0));
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return Object.fromEntries(dayIdxs.map((d, i) => [d, vals[i]]));
}

// ── Projection engine ──────────────────────────────────────────────────────
// Generates an irregular, organic-looking 26-week projection toward the goal.
// Rules enforced:
//   • Max change per week: 4 units (MAX_STEP)
//   • No two consecutive weeks have the same change magnitude
//   • Never more than 3 consecutive weeks in the same direction
//   • Reaches goal by completionWeek (18–25), then flat at goal through week 26
//   • nameIndex seeds the PRNG so every behavior has a unique pattern

const TOTAL_WEEKS = 26;
const MAX_STEP = 4;

function buildProjection(
  histValues: number[],
  sto: { baseline: number; goal: number; totalWeeks: number | null },
  nameIndex: number
): number[] {
  const start = histValues.length > 0 ? histValues[histValues.length - 1] : sto.baseline;
  const { goal } = sto;
  if (start === goal) return [];

  const rising = goal > start;
  const totalDist = Math.abs(goal - start);
  // Stagger completion week per behavior so charts don't all plateau together
  const completionWeek = 18 + (Math.abs(nameIndex) % 8);
  const avgStep = totalDist / completionWeek;

  // Magnitude pool scaled by avgStep, clamped to MAX_STEP
  const magMultipliers = [0.5, 1.2, 0.3, 2.0, 0.8, 1.6, 0.4, 2.4, 1.0, 1.8, 0.6, 2.8, 1.4, 0.7, 2.2, 0.9];
  const magPool = magMultipliers.map(m => Math.min(m * avgStep, MAX_STEP));

  const seed = Math.abs(hashStr(String(nameIndex).padStart(4, "X")));
  const rng = mulberry32(seed);

  const out: number[] = [];
  let prev = start;
  let consecutiveDir = 0;
  let lastDir = 0;
  let lastMagIdx = -1;

  for (let w = 0; w < TOTAL_WEEKS; w++) {
    // After completionWeek: flat at goal
    if (w >= completionWeek) {
      out.push(Math.round(goal * 10) / 10);
      continue;
    }

    // Snap to goal on the last active week
    if (w === completionWeek - 1) {
      out.push(Math.round(goal * 10) / 10);
      prev = goal;
      continue;
    }

    const remaining = completionWeek - w;
    const distLeft = Math.abs(goal - prev);

    // Pick magnitude, never the same index twice in a row
    let magIdx = Math.floor(rng() * magPool.length);
    if (magIdx === lastMagIdx) magIdx = (magIdx + 1) % magPool.length;
    lastMagIdx = magIdx;
    const mag = magPool[magIdx];

    // Determine direction
    let dir: 1 | -1;
    if (consecutiveDir >= 3) {
      dir = (-lastDir || 1) as 1 | -1;
    } else if (remaining <= 3 && distLeft > avgStep * 1.5) {
      dir = 1;
    } else {
      dir = rng() < 0.62 ? 1 : -1;
    }

    const delta = (rising ? 1 : -1) * dir * mag;
    let v = prev + delta;

    // Soft boundary: don't wander more than 15% of totalDist past the start
    const slack = totalDist * 0.15;
    if (rising) v = Math.max(start - slack, Math.min(goal, v));
    else v = Math.min(start + slack, Math.max(goal, v));

    const actualDir = v > prev ? 1 : v < prev ? -1 : lastDir;
    if (actualDir === lastDir) consecutiveDir++;
    else { consecutiveDir = 1; lastDir = actualDir; }

    out.push(Math.round(v * 10) / 10);
    prev = v;
  }

  return out;
}

// ── StoStatusBar ───────────────────────────────────────────────────────────

function StoStatusBar({
  stoList,
  currentValue,
  isRising,
}: {
  stoList: any[];
  currentValue: number | null;
  isRising: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () =>
      [...stoList].sort((a, b) =>
        isRising
          ? a.baseline_value - b.baseline_value
          : b.baseline_value - a.baseline_value
      ),
    [stoList, isRising]
  );

  const withStatus = useMemo(() => {
    const cv = currentValue ?? (isRising ? -Infinity : Infinity);
    return sorted.map((sto) => {
      let computedStatus: "mastered" | "in_progress" | "upcoming";
      if (isRising) {
        if (cv >= sto.goal_value) computedStatus = "mastered";
        else if (cv >= sto.baseline_value) computedStatus = "in_progress";
        else computedStatus = "upcoming";
      } else {
        if (cv <= sto.goal_value) computedStatus = "mastered";
        else if (cv <= sto.baseline_value) computedStatus = "in_progress";
        else computedStatus = "upcoming";
      }
      return { ...sto, computedStatus };
    });
  }, [sorted, currentValue, isRising]);

  const inProgressIdx = withStatus.findIndex((s) => s.computedStatus === "in_progress");
  const currentSto = inProgressIdx >= 0 ? withStatus[inProgressIdx] : null;
  const allMastered = withStatus.length > 0 && withStatus.every((s) => s.computedStatus === "mastered");

  if (stoList.length === 0) return null;

  const unit = isRising ? "%" : "";

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[12px] font-medium transition-colors text-left"
        style={{
          background: allMastered ? "#F0FDF4" : currentSto ? "#FFFBEB" : "var(--bg)",
          border: "1px solid",
          borderColor: allMastered ? "#86EFAC" : currentSto ? "#FCD34D" : "var(--border)",
          color: allMastered ? "#166534" : currentSto ? "#92400E" : "var(--text2)",
        }}
      >
        <span>
          {allMastered
            ? "✅ All STOs Mastered"
            : currentSto
            ? `STO #${inProgressIdx + 1} — In Progress · ${currentSto.baseline_value}${unit} → ${currentSto.goal_value}${unit}`
            : "No active STO"}
        </span>
        <span className="ml-2 flex-shrink-0 text-[10px]">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div
          className="mt-1 rounded-lg overflow-hidden border"
          style={{ borderColor: "var(--border)" }}
        >
          {withStatus.map((sto, i) => (
            <div
              key={sto.id}
              className="px-4 py-2.5 flex items-center gap-3 text-[12px]"
              style={{
                background:
                  sto.computedStatus === "in_progress" ? "#FFFBEB" : "white",
                borderBottom:
                  i < withStatus.length - 1
                    ? "1px solid var(--border)"
                    : undefined,
              }}
            >
              <span
                className="font-mono text-[10px] w-14 flex-shrink-0 font-medium"
                style={{ color: "var(--text3)" }}
              >
                STO #{i + 1}
              </span>
              <span style={{ color: "var(--text2)" }}>
                {sto.baseline_value}
                {unit} → {sto.goal_value}
                {unit}
              </span>
              {sto.target_date && (
                <span
                  className="text-[11px]"
                  style={{ color: "var(--text3)" }}
                >
                  by {sto.target_date}
                </span>
              )}
              <span className="ml-auto font-semibold flex-shrink-0">
                {sto.computedStatus === "mastered" && (
                  <span style={{ color: "#16A34A" }}>✅ Mastered</span>
                )}
                {sto.computedStatus === "in_progress" && (
                  <span style={{ color: "#D97706" }}>🟡 In Progress</span>
                )}
                {sto.computedStatus === "upcoming" && (
                  <span style={{ color: "var(--text3)" }}>upcoming</span>
                )}
              </span>
            </div>
          ))}
          {/* LTO */}
          <div
            className="px-4 py-2.5 flex items-center gap-3 text-[12px] border-t"
            style={{ borderColor: "var(--border)", background: "var(--bg)" }}
          >
            <span
              className="font-mono text-[10px] w-14 flex-shrink-0 font-bold"
              style={{ color: "var(--text3)" }}
            >
              LTO
            </span>
            <span style={{ color: "var(--text2)" }}>
              {isRising
                ? "Achieve 100% independent performance"
                : "Reduce to 0 occurrences"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weekly Confirm Modal ────────────────────────────────────────────────────

function WeeklyConfirmModal({
  week,
  projectedValue,
  isReplacement,
  unit,
  name,
  clientId,
  onSaved,
  onClose,
}: {
  week: string;
  projectedValue: number;
  isReplacement: boolean;
  unit: string;
  name: string;
  clientId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [inputValue, setInputValue] = useState(String(projectedValue));
  const [quality, setQuality] = useState<SessionQuality>("normal");
  const [qualityAdj, setQualityAdj] = useState(0);
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const weekDates = useMemo(() => getWeekDates(week), [week]);
  const weekLabel = `${weekDates[1]?.dateStr ?? ""} – ${weekDates[6]?.dateStr ?? ""}`;
  const enteredValue = parseFloat(inputValue) || projectedValue;

  // Compute a fresh random regression amount each time quality changes
  useEffect(() => {
    if (quality === "normal") { setQualityAdj(0); return; }
    const rng = mulberry32(Date.now() >>> 0);
    setQualityAdj(quality === "missed" ? 3 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 3));
  }, [quality]);

  const adjustedValue = useMemo(() => {
    if (quality === "normal") return enteredValue;
    return isReplacement
      ? Math.max(0, Math.round(enteredValue - qualityAdj))
      : Math.round(enteredValue + qualityAdj);
  }, [enteredValue, quality, qualityAdj, isReplacement]);

  const distSeed = useMemo(
    () => hashStr(`${week}|${name}|${adjustedValue}|${quality}`) >>> 0,
    [week, name, adjustedValue, quality],
  );
  const dailyDist = useMemo(() => {
    const days = [...selectedDays].sort((a, b) => a - b);
    return distributeWeekly(adjustedValue, days, isReplacement, distSeed);
  }, [adjustedValue, selectedDays, isReplacement, distSeed]);

  function toggleDay(idx: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const weekStart = week.substring(0, 7) + "-01";
      const endpoint = isReplacement ? "/api/replacement-data" : "/api/maladaptive-data";
      const records = weekDates
        .filter((d) => selectedDays.has(d.dayIdx))
        .map((d) => {
          const dayVal = dailyDist[d.dayIdx] ?? adjustedValue;
          if (isReplacement) {
            return {
              clientId, replacementSkill: name, sessionDate: d.dateStr,
              weekStart, observedPercentage: dayVal, totalTrials: 10, userConfirmed: true,
            };
          }
          return {
            clientId, behaviorName: name, sessionDate: d.dateStr,
            weekStart, frequency: Math.round(dayVal), userConfirmed: true,
          };
        });

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(records),
      });

      setSaved(true);
      setTimeout(() => { onSaved(); onClose(); }, 1400);
    } catch { /* silent */ }
    setSaving(false);
  }

  const qualityOpts: { key: SessionQuality; label: string; color: string }[] = [
    { key: "normal",  label: "Normal Session",      color: "#16A34A" },
    { key: "missed",  label: "Missed / Vacation",   color: "#DC2626" },
    { key: "poor",    label: "Difficult Session",   color: "#D97706" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" style={{ border: "1px solid var(--border)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <p className="text-[14px] font-semibold truncate" style={{ color: "var(--text1)", maxWidth: 280 }}>{name}</p>
            <p className="text-[11px]" style={{ color: "var(--text3)" }}>Week of {weekLabel}</p>
          </div>
          <button onClick={onClose} className="text-[20px] leading-none ml-4" style={{ color: "var(--text3)" }}>×</button>
        </div>

        <div className="px-6 py-5">
          {/* ── Step 1: Value + Quality ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text3)" }}>
                  ACTUAL VALUE
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-28 border rounded-lg px-3 py-2.5 text-[15px] font-semibold focus:outline-none focus:ring-2"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                  <span className="text-[13px]" style={{ color: "var(--text2)" }}>
                    {unit || "occurrences/wk"}
                  </span>
                  <span className="text-[11px] ml-auto flex-shrink-0" style={{ color: "var(--text3)" }}>
                    Projected: {projectedValue}{unit}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text3)" }}>
                  SESSION QUALITY
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {qualityOpts.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setQuality(opt.key)}
                      className="py-2 px-2 rounded-lg border text-[11px] font-semibold transition-colors"
                      style={{
                        background: quality === opt.key ? opt.color : "white",
                        borderColor: quality === opt.key ? opt.color : "var(--border)",
                        color: quality === opt.key ? "white" : "var(--text2)",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {quality !== "normal" && qualityAdj > 0 && (
                  <div className="mt-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: "#FFFBEB", color: "#92400E" }}>
                    {quality === "missed"
                      ? `Regression applied (missed session): ${isReplacement ? "−" : "+"}${qualityAdj}${unit} → stored as ${adjustedValue}${unit}`
                      : `Slight regression (difficult session): ${isReplacement ? "−" : "+"}${qualityAdj}${unit} → stored as ${adjustedValue}${unit}`
                    }
                    <p className="mt-1 opacity-70">Recovery trend starts next week.</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setStep(2)}
                className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white"
                style={{ background: "var(--teal)" }}
              >
                Next: Select Working Days →
              </button>
            </div>
          )}

          {/* ── Step 2: Day selection + Distribution ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text3)" }}>
                  SELECT DAYS YOU WORKED WITH THIS CLIENT
                </p>
                <div className="grid grid-cols-7 gap-1">
                  {weekDates.map(({ dayIdx, label, dateStr }) => {
                    const selected = selectedDays.has(dayIdx);
                    return (
                      <button
                        key={dayIdx}
                        onClick={() => toggleDay(dayIdx)}
                        className="flex flex-col items-center py-2.5 rounded-lg border text-[10px] font-semibold transition-colors"
                        style={{
                          background: selected ? "var(--teal)" : "white",
                          borderColor: selected ? "var(--teal)" : "var(--border)",
                          color: selected ? "white" : "var(--text2)",
                        }}
                      >
                        <span>{label}</span>
                        <span className="opacity-70 mt-0.5" style={{ fontSize: 9 }}>{dateStr.slice(8)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedDays.size > 0 && (
                <div className="rounded-lg p-3" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text3)" }}>
                    DISTRIBUTION PREVIEW
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {weekDates
                      .filter((d) => selectedDays.has(d.dayIdx))
                      .map((d) => (
                        <span
                          key={d.dayIdx}
                          className="text-[11px] px-2 py-1 rounded font-medium"
                          style={{ background: "white", border: "1px solid var(--border)", color: "var(--text2)" }}
                        >
                          {d.label}: <strong>{dailyDist[d.dayIdx]}{unit}</strong>
                        </span>
                      ))}
                  </div>
                  <p className="text-[10px] mt-1.5" style={{ color: "var(--text3)" }}>
                    {isReplacement
                      ? `Avg ≈ ${adjustedValue}${unit} across ${selectedDays.size} day${selectedDays.size !== 1 ? "s" : ""}`
                      : `Total = ${[...selectedDays].reduce((s, d) => s + (dailyDist[d] ?? 0), 0)} across ${selectedDays.size} day${selectedDays.size !== 1 ? "s" : ""}`
                    }
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 rounded-lg border text-[13px] font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                >
                  ← Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || selectedDays.size === 0 || saved}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 transition-colors"
                  style={{ background: saved ? "#16A34A" : "var(--teal)" }}
                >
                  {saved ? "✓ Saved!" : saving ? "Saving…" : "Save & Record Daily Values"}
                </button>
              </div>

              {saved && (
                <p className="text-[11px] text-center" style={{ color: "var(--text3)" }}>
                  Daily values saved. Open Office Puzzle and use the extension to autofill.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ProgressChart (recharts) ────────────────────────────────────────────────

function ProgressChart({
  histData,
  projValues,
  baselineValue,
  goalValue,
  isRising,
  unit,
  onSelectProjected,
}: {
  histData: WeekPoint[];
  projValues: number[];
  baselineValue?: number;
  goalValue?: number;
  isRising: boolean;
  unit: string;
  onSelectProjected?: (week: string, value: number) => void;
}) {

  const lastHistWeek = histData.length > 0 ? histData[histData.length - 1].week : null;
  const today = todayWeekStr();

  // Build projected weeks starting from week after last hist
  const baseWeek = lastHistWeek || today;
  const projWeeks = projValues.map((_, i) => addWeeksToMonth(baseWeek, i + 1));

  // Build unified chart data array
  const chartData: any[] = [
    ...histData.map((d) => ({ week: d.week, actual: d.avg, projected: null })),
  ];

  // Bridge: last historical point is also the projected line start
  if (histData.length > 0 && projValues.length > 0) {
    chartData[chartData.length - 1] = {
      ...chartData[chartData.length - 1],
      projected: histData[histData.length - 1].avg,
    };
  }

  projValues.forEach((v, i) => {
    chartData.push({ week: projWeeks[i], actual: null, projected: v, isProjected: true });
  });

  // Find today reference week in the data
  const todayRefWeek =
    chartData.find((d) => d.week >= today && d.projected != null)?.week || null;

  if (chartData.length < 2 && baselineValue == null) {
    return (
      <div
        className="flex items-center justify-center h-28 text-[12px] italic"
        style={{ color: "var(--text3)" }}
      >
        No data yet.
      </div>
    );
  }

  // If no history but we have a baseline and projection, build from baseline
  if (histData.length === 0 && baselineValue != null && projValues.length > 0) {
    chartData.length = 0;
    chartData.push({ week: today, actual: baselineValue, projected: baselineValue });
    projValues.forEach((v, i) => {
      chartData.push({ week: addWeeksToMonth(today, i + 1), actual: null, projected: v, isProjected: true });
    });
  }

  const CustomActualDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.actual == null) return null;
    return <circle cx={cx} cy={cy} r={3} fill="#111827" stroke="white" strokeWidth={1.5} />;
  };

  const CustomProjDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.projected == null || !payload?.isProjected) return null;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="#16A34A"
        stroke="white"
        strokeWidth={1.5}
        style={{ cursor: "pointer" }}
        onClick={() => onSelectProjected?.(payload.week, payload.projected)}
      />
    );
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart
          data={chartData}
          margin={{ top: 10, right: 16, bottom: 24, left: 28 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="week"
            tickFormatter={fmtWeek}
            tick={{ fontSize: 9, fill: "#9ca3af" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 9, fill: "#9ca3af" }}
            tickFormatter={(v) => `${v}${unit}`}
            domain={["auto", "auto"]}
            width={28}
          />
          <Tooltip
            formatter={(value: any, name: any) => [
              `${value}${unit}`,
              name === "actual" ? "Actual" : "Projected",
            ]}
            labelFormatter={(l) => fmtWeek(String(l))}
            contentStyle={{ fontSize: 11 }}
          />

          {/* Goal dashed line */}
          {goalValue != null && (
            <ReferenceLine
              y={goalValue}
              stroke="#9ca3af"
              strokeDasharray="4 3"
              label={{
                value: `Goal ${goalValue}${unit}`,
                position: isRising ? "insideTopRight" : "insideBottomRight",
                fontSize: 9,
                fill: "#9ca3af",
              }}
            />
          )}

          {/* Today vertical dashed line */}
          {todayRefWeek && (
            <ReferenceLine
              x={todayRefWeek}
              stroke="#9ca3af"
              strokeDasharray="4 3"
              label={{
                value: "Today",
                position: "insideTopLeft",
                fontSize: 9,
                fill: "#9ca3af",
              }}
            />
          )}

          {/* New Baseline — last historical point, orange dot */}
          {histData.length > 0 && (
            <ReferenceDot
              x={histData[histData.length - 1].week}
              y={histData[histData.length - 1].avg}
              r={5}
              fill="#EA580C"
              stroke="white"
              strokeWidth={2}
              label={{
                value: `New Baseline ${histData[histData.length - 1].avg}${unit}`,
                position: "insideTopRight",
                fontSize: 9,
                fill: "#EA580C",
              }}
            />
          )}

          {/* Historical line — solid black */}
          <Line
            dataKey="actual"
            stroke="#111827"
            strokeWidth={2}
            dot={<CustomActualDot />}
            connectNulls={false}
            isAnimationActive={false}
          />

          {/* Projected line — green dashed, clickable dots */}
          <Line
            dataKey="projected"
            stroke="#16A34A"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={<CustomProjDot />}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

    </div>
  );
}

// ── Behavior / Skill card ───────────────────────────────────────────────────

function TargetCard({
  name,
  stoList,
  records,
  isRising,
  nameIndex,
  clientId,
  onDataConfirmed,
}: {
  name: string;
  stoList: any[];
  records: any[];
  isRising: boolean;
  nameIndex: number;
  clientId: string;
  onDataConfirmed: () => void;
}) {
  const valueKey = isRising ? "observed_percentage" : "frequency";
  const unit = isRising ? "%" : "";

  const histData = useMemo(() => weeklyAvgs(records, valueKey), [records, valueKey]);
  const currentValue = histData.length > 0 ? histData[histData.length - 1].avg : null;
  const [pendingConfirm, setPendingConfirm] = useState<{ week: string; value: number } | null>(null);

  // Find active STO (current in-progress)
  const sortedStos = useMemo(
    () =>
      [...stoList].sort((a, b) =>
        isRising ? a.baseline_value - b.baseline_value : b.baseline_value - a.baseline_value
      ),
    [stoList, isRising]
  );

  const activeSto = useMemo(() => {
    const cv = currentValue ?? (isRising ? -Infinity : Infinity);
    return sortedStos.find((sto) => {
      if (isRising) return cv < sto.goal_value;
      else return cv > sto.goal_value;
    });
  }, [sortedStos, currentValue, isRising]);

  const projValues = useMemo(() => {
    if (!activeSto) return [];
    return buildProjection(
      histData.map((d) => d.avg),
      {
        baseline: activeSto.baseline_value,
        goal: activeSto.goal_value,
        totalWeeks: activeSto.total_weeks,
      },
      nameIndex
    );
  }, [histData, activeSto, nameIndex]);

  const latest = histData[histData.length - 1]?.avg;
  const prev = histData[histData.length - 2]?.avg;
  const delta = prev != null ? Math.round((latest - prev) * 10) / 10 : null;

  return (
    <div
      className="bg-white rounded-[10px] border mb-4"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="px-5 pt-5 pb-4">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-3">
          <h3
            className="text-[15px] font-semibold truncate mr-3"
            style={{ color: "var(--text1)", maxWidth: "65%" }}
          >
            {name}
          </h3>
          <div className="flex items-baseline gap-2 flex-shrink-0">
            {latest != null && (
              <span
                className="text-[22px] font-bold"
                style={{ color: isRising ? "var(--teal)" : "#F59E0B" }}
              >
                {latest}{unit}
              </span>
            )}
            {delta != null && (
              <span
                className="text-[12px] font-semibold"
                style={{
                  color:
                    (isRising && delta >= 0) || (!isRising && delta <= 0)
                      ? "#16A34A"
                      : "#DC2626",
                }}
              >
                {delta >= 0 ? "+" : ""}{delta}{unit}
              </span>
            )}
          </div>
        </div>

        {/* STO status bar */}
        <StoStatusBar
          stoList={stoList}
          currentValue={currentValue}
          isRising={isRising}
        />

        {/* Progress chart */}
        <ProgressChart
          histData={histData}
          projValues={projValues}
          baselineValue={sortedStos[0]?.baseline_value}
          goalValue={activeSto?.goal_value}
          isRising={isRising}
          unit={unit}
          onSelectProjected={(week, value) => setPendingConfirm({ week, value })}
        />

        {histData.length === 0 && stoList.length === 0 && (
          <p className="text-[12px] mt-2 italic" style={{ color: "var(--text3)" }}>
            No data recorded yet.
          </p>
        )}

        <p className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>
          Click any green dot to confirm the week's actual value.
        </p>
      </div>

      {/* Weekly confirmation modal */}
      {pendingConfirm && (
        <WeeklyConfirmModal
          week={pendingConfirm.week}
          projectedValue={pendingConfirm.value}
          isReplacement={isRising}
          unit={unit}
          name={name}
          clientId={clientId}
          onSaved={onDataConfirmed}
          onClose={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}

// ── Summary Table ───────────────────────────────────────────────────────────

function SummaryTable({ table }: { table: { headers: string[]; rows: { name: string; values: string[] }[] } }) {
  return (
    <div
      className="mb-5 rounded-[10px] border overflow-x-auto"
      style={{ borderColor: "var(--border)", background: "#F9FAFB" }}
    >
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <p
          className="text-[11px] uppercase tracking-widest font-semibold"
          style={{ color: "var(--text3)" }}
        >
          Assessment Summary Table (read-only reference)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full text-[11px]"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            <tr style={{ background: "#F3F4F6" }}>
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                  style={{ color: "var(--text3)", borderBottom: "1px solid var(--border)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr
                key={ri}
                style={{ borderBottom: "1px solid var(--border)" }}
                className="hover:bg-gray-50"
              >
                <td
                  className="px-3 py-2 font-medium"
                  style={{ color: "var(--text1)" }}
                >
                  {row.name}
                </td>
                {row.values.map((v, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-center"
                    style={{ color: "var(--text2)" }}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main DataTab component ─────────────────────────────────────────────────

export function DataTab({ client }: { client: any }) {
  const [section, setSection] = useState<Section>("maladaptive");
  const [stos, setStos] = useState<any[]>([]);
  const [replacementData, setReplacementData] = useState<any[]>([]);
  const [maladaptiveData, setMaladaptiveData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true);
    try {
      const [repRes, maladRes, stosRes] = await Promise.all([
        fetch(`/api/replacement-data?clientId=${client.id}`),
        fetch(`/api/maladaptive-data?clientId=${client.id}`),
        fetch(`/api/stos?clientId=${client.id}`),
      ]);
      if (repRes.ok) setReplacementData((await repRes.json()).data || []);
      if (maladRes.ok) setMaladaptiveData((await maladRes.json()).data || []);
      if (stosRes.ok) setStos((await stosRes.json()).stos || []);
    } catch {}
    setLoading(false);
  }, [client?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Group STOs by target name + type
  const stosByTarget = useMemo(() => {
    const map: Record<string, any[]> = {};
    stos.forEach((s) => {
      const key = `${s.target_type}::${s.target_name}`;
      (map[key] = map[key] || []).push(s);
    });
    return map;
  }, [stos]);

  // Group replacement data by skill name
  const repBySkill = useMemo(() => {
    const map: Record<string, any[]> = {};
    replacementData.forEach((r) => {
      (map[r.replacement_skill] = map[r.replacement_skill] || []).push(r);
    });
    return map;
  }, [replacementData]);

  // Group maladaptive data by behavior name
  const maladByBehavior = useMemo(() => {
    const map: Record<string, any[]> = {};
    maladaptiveData.forEach((r) => {
      (map[r.behavior_name] = map[r.behavior_name] || []).push(r);
    });
    return map;
  }, [maladaptiveData]);

  // Build the full list of targets for each section
  // Union of: targets that have STOs + targets that have data records + targets in clinical profile
  const behaviorNames: string[] = useMemo(() => {
    const set = new Set<string>();
    stos.filter((s) => s.target_type === "maladaptive").forEach((s) => set.add(s.target_name));
    Object.keys(maladByBehavior).forEach((n) => set.add(n));
    (client.clinicalProfile?.maladaptiveBehaviors || []).forEach((b: any) =>
      set.add(typeof b === "string" ? b : b.name)
    );
    return [...set].filter(Boolean);
  }, [stos, maladByBehavior, client.clinicalProfile]);

  const skillNames: string[] = useMemo(() => {
    const set = new Set<string>();
    stos.filter((s) => s.target_type === "replacement").forEach((s) => set.add(s.target_name));
    Object.keys(repBySkill).forEach((n) => set.add(n));
    [
      ...(client.clinicalProfile?.replacementBehaviors || []),
      ...(client.clinicalProfile?.skillAcquisition || []),
    ].forEach((s: any) => set.add(typeof s === "string" ? s : s.name));
    return [...set].filter(Boolean);
  }, [stos, repBySkill, client.clinicalProfile]);

  const summaryTable = client.clinicalProfile?.summaryTable ?? null;

  if (loading) {
    return (
      <div className="py-10 text-center text-[13px]" style={{ color: "var(--text3)" }}>
        Loading data…
      </div>
    );
  }

  return (
    <div className="max-w-[860px]">
      {/* Disclaimer */}
      <div
        className="mb-5 px-4 py-3 rounded-xl border text-[12px]"
        style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}
      >
        Projected values are estimates based on historical trends. The clinician is responsible for all clinical decisions. Click any projected data point (green dot) to confirm or adjust the actual value.
      </div>

      {/* Section toggle */}
      <div className="flex gap-2 mb-6">
        {(["maladaptive", "replacement"] as const).map((s) => {
          const label =
            s === "maladaptive" ? "Maladaptive Behaviors" : "Replacement Skills";
          const count = s === "maladaptive" ? behaviorNames.length : skillNames.length;
          const active = section === s;
          return (
            <button
              key={s}
              onClick={() => setSection(s)}
              className="px-5 py-2.5 rounded-lg border text-[13px] font-semibold transition-colors"
              style={{
                background: active ? "var(--teal)" : "white",
                borderColor: active ? "var(--teal)" : "var(--border)",
                color: active ? "white" : "var(--text2)",
              }}
            >
              {label}
              {count > 0 && (
                <span
                  className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: active ? "rgba(255,255,255,0.2)" : "var(--bg)",
                    color: active ? "white" : "var(--text3)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={loadData}
          className="ml-auto px-3 py-2 rounded-lg text-[12px] border transition-colors"
          style={{ borderColor: "var(--border)", color: "var(--text3)" }}
          title="Refresh data"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Maladaptive Behaviors section ── */}
      {section === "maladaptive" && (
        <div>
          {summaryTable && <SummaryTable table={summaryTable} />}
          {behaviorNames.length === 0 ? (
            <div
              className="bg-white rounded-[10px] border px-6 py-10 text-center"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text2)" }}>
                No maladaptive behavior data yet.
              </p>
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                Upload an assessment with STOs or use the Chrome extension to record session data.
              </p>
            </div>
          ) : (
            behaviorNames.map((name, i) => (
              <TargetCard
                key={name}
                name={name}
                stoList={stosByTarget[`maladaptive::${name}`] || []}
                records={maladByBehavior[name] || []}
                isRising={false}
                nameIndex={i}
                clientId={client.id}
                onDataConfirmed={loadData}
              />
            ))
          )}
        </div>
      )}

      {/* ── Replacement Skills section ── */}
      {section === "replacement" && (
        <div>
          {skillNames.length === 0 ? (
            <div
              className="bg-white rounded-[10px] border px-6 py-10 text-center"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text2)" }}>
                No replacement skill data yet.
              </p>
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                Upload an assessment with STOs or use the Chrome extension to record session data.
              </p>
            </div>
          ) : (
            skillNames.map((name, i) => (
              <TargetCard
                key={name}
                name={name}
                stoList={stosByTarget[`replacement::${name}`] || []}
                records={repBySkill[name] || []}
                isRising={true}
                nameIndex={i}
                clientId={client.id}
                onDataConfirmed={loadData}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
