"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { buildProjection } from "@/lib/projection";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────

interface WeekPoint {
  week: string;
  avg: number;
  recordId?: string;
  isAnomaly?: boolean;
  anomalyReviewed?: boolean;
  anomalyJustification?: string | null;
  originalValue?: number | null;
}

// ── Utilities ──────────────────────────────────────────────────────────────

const ANOMALY_THRESHOLD = 5;

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function fuzzyNamesMatch(a: string, b: string): boolean {
  const al = normName(a), bl = normName(b);
  if (al === bl) return true;
  if (al.includes(bl) || bl.includes(al)) return true;
  const aWords = al.split(" ").filter((w) => w.length > 2);
  const bWords = new Set(bl.split(" ").filter((w) => w.length > 2));
  return aWords.some((w) => bWords.has(w));
}

function fmtWeek(week: string): string {
  if (!week || week === "?") return "";
  try {
    const d = new Date(week + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return week;
  }
}

function todayWeekStr(): string {
  return new Date().toISOString().split("T")[0];
}

function addWeeksToDate(dateStr: string, n: number): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n * 7);
    return d.toISOString().split("T")[0];
  } catch {
    return dateStr;
  }
}

function weeklyAvgs(records: any[], valueKey: string, mode: "avg" | "sum" = "avg"): WeekPoint[] {
  const map: Record<string, any[]> = {};
  records.forEach((r) => {
    const rawDate = r.week_start || r.session_date;
    if (!rawDate) return;
    const dateStr = String(rawDate).replace(/T.*$/, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    (map[dateStr] = map[dateStr] || []).push(r);
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, recs]) => {
      const confirmed = recs;
      const primary = confirmed.length > 0 ? confirmed[0] : recs[0];
      let avg: number;
      if (mode === "sum") {
        // Prefer daily_values array (extension Data tab stores full week array);
        // fall back to summing all frequency values in the group.
        if (primary?.daily_values && Array.isArray(primary.daily_values) && primary.daily_values.length > 0) {
          avg = primary.daily_values.reduce((s: number, v: unknown) => s + (Number(v) || 0), 0);
        } else {
          avg = Math.round(recs.reduce((s: number, r: any) => s + (Number(r[valueKey]) || 0), 0));
        }
      } else {
        const vs = recs.map((r) => Number(r[valueKey]) || 0);
        avg =
          confirmed.length > 0
            ? Number(primary[valueKey]) || 0
            : Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10) / 10;
      }
      return {
        week,
        avg,
        recordId: primary?.id,
        isAnomaly: primary?.is_anomaly ?? false,
        anomalyReviewed: primary?.anomaly_reviewed ?? false,
        anomalyJustification: primary?.anomaly_justification ?? null,
        originalValue: primary?.original_value ?? null,
      };
    });
}

// ── Projection engine: imported from lib/projection ───────────────────────

// ── Confirm Week Modal ──────────────────────────────────────────────────────

function ConfirmWeekModal({
  week,
  projectedValue,
  isReplacement,
  unit,
  name,
  clientId,
  onSaved,
  onClose,
  isEdit = false,
}: {
  week: string;
  projectedValue: number;
  isReplacement: boolean;
  unit: string;
  name: string;
  clientId: string;
  onSaved: () => void;
  onClose: () => void;
  isEdit?: boolean;
}) {
  const [value, setValue] = useState(String(projectedValue));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const num = isReplacement ? parseFloat(value) : parseInt(value);
    if (isNaN(num)) return;
    setSaving(true);
    try {
      const endpoint = isReplacement ? "/api/replacement-data" : "/api/maladaptive-data";
      const body = isReplacement
        ? [{ clientId, replacementSkill: name, sessionDate: week, weekStart: week, observedPercentage: num, totalTrials: 10, userConfirmed: true }]
        : [{ clientId, behaviorName: name, sessionDate: week, weekStart: week, frequency: num, userConfirmed: true }];
      await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setSaved(true);
      setTimeout(() => { onSaved(); onClose(); }, 1000);
    } catch { /* silent */ }
    setSaving(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
        style={{ border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <p
              className="text-[14px] font-semibold truncate max-w-[240px]"
              style={{ color: "var(--text1)" }}
            >
              {name}
            </p>
            <p className="text-[11px]" style={{ color: "var(--text3)" }}>
              {fmtWeek(week)} {isEdit ? "· edit" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[20px] leading-none ml-4"
            style={{ color: "var(--text3)" }}
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <p
              className="text-[11px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: "var(--text3)" }}
            >
              {isEdit ? "CORRECTED VALUE" : "ACTUAL VALUE"}
            </p>
            {!isEdit && (
              <button
                type="button"
                onClick={() => setValue(String(projectedValue))}
                className="text-[11px] font-medium px-2.5 py-0.5 rounded-full mb-2 inline-flex items-center gap-1"
                style={{ background: "#DCFCE7", color: "#16A34A", border: "1px solid #BBF7D0", cursor: "pointer" }}
              >
                ✓ Recommended: {projectedValue}{unit || " occurrences/wk"}
              </button>
            )}
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max={isReplacement ? 100 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                autoFocus
                className="w-28 border rounded-lg px-3 py-2.5 text-[15px] font-semibold focus:outline-none focus:ring-2"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
              <span className="text-[13px]" style={{ color: "var(--text2)" }}>
                {unit || "occurrences/wk"}
              </span>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 transition-colors"
            style={{ background: saved ? "#16A34A" : "var(--teal)" }}
          >
            {saved ? "✓ Saved!" : saving ? "Saving…" : isEdit ? "Update Value" : "Confirm Value"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Anomaly Modal ───────────────────────────────────────────────────────────

function AnomalyModal({
  week,
  currentValue,
  recordId,
  isReplacement,
  unit,
  name,
  isReviewed,
  justification,
  onSaved,
  onClose,
}: {
  week: string;
  currentValue: number;
  recordId: string;
  isReplacement: boolean;
  unit: string;
  name: string;
  isReviewed: boolean;
  justification: string | null | undefined;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "justify" | "fix">(
    isReviewed ? "justify" : "choose",
  );
  const [reason, setReason] = useState(justification || "");
  const [fixValue, setFixValue] = useState(String(currentValue));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const endpoint = isReplacement ? "/api/replacement-data" : "/api/maladaptive-data";

  async function handleJustify() {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await fetch(`${endpoint}?id=${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isAnomaly: true,
          anomalyReviewed: true,
          anomalyJustification: reason.trim(),
        }),
      });
      setSaved(true);
      setTimeout(() => { onSaved(); onClose(); }, 800);
    } catch { /* silent */ }
    setSaving(false);
  }

  async function handleFix() {
    const num = isReplacement ? parseFloat(fixValue) : parseInt(fixValue);
    if (isNaN(num)) return;
    setSaving(true);
    try {
      const justMsg = `Data corrected: was ${currentValue}${unit}, changed to ${num}${unit}`;
      const body: any = {
        isAnomaly: true,
        anomalyReviewed: true,
        anomalyJustification: justMsg,
        originalValue: currentValue,
      };
      if (isReplacement) {
        body.observedPercentage = num;
        body.autofillCompleted = false;
      } else {
        body.frequency = num;
      }
      await fetch(`${endpoint}?id=${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSaved(true);
      setTimeout(() => { onSaved(); onClose(); }, 800);
    } catch { /* silent */ }
    setSaving(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
        style={{ border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>
              ⚠ Anomaly Detected
            </p>
            <p className="text-[11px] truncate max-w-[240px]" style={{ color: "var(--text3)" }}>
              {name} · {fmtWeek(week)} · {currentValue}{unit}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[20px] leading-none ml-4"
            style={{ color: "var(--text3)" }}
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          {mode === "choose" && (
            <div className="space-y-3">
              <p className="text-[12px]" style={{ color: "var(--text2)" }}>
                This data point changed by more than {ANOMALY_THRESHOLD}{unit} from the previous week. What would you like to do?
              </p>
              <button
                onClick={() => setMode("justify")}
                className="w-full py-2.5 rounded-lg text-[13px] font-semibold border"
                style={{ borderColor: "#F59E0B", color: "#92400E", background: "#FFFBEB" }}
              >
                Justify — explain the change
              </button>
              <button
                onClick={() => setMode("fix")}
                className="w-full py-2.5 rounded-lg text-[13px] font-semibold border"
                style={{ borderColor: "var(--teal)", color: "var(--teal)", background: "white" }}
              >
                Fix Data — enter correct value
              </button>
            </div>
          )}

          {mode === "justify" && (
            <div className="space-y-3">
              {isReviewed && justification && (
                <p
                  className="text-[11px] px-3 py-2 rounded-lg"
                  style={{ background: "#FEF9C3", color: "#713F12" }}
                >
                  Previously: "{justification}"
                </p>
              )}
              <div>
                <p
                  className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                  style={{ color: "var(--text3)" }}
                >
                  REASON
                </p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Missed sessions, vacation week, new environment…"
                  rows={3}
                  autoFocus
                  className="w-full border rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 resize-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                />
              </div>
              <div className="flex gap-2">
                {!isReviewed && (
                  <button
                    onClick={() => setMode("choose")}
                    className="flex-1 py-2 rounded-lg text-[12px] border"
                    style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={handleJustify}
                  disabled={saving || saved || !reason.trim()}
                  className="flex-1 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 transition-colors"
                  style={{ background: saved ? "#16A34A" : "#F59E0B" }}
                >
                  {saved ? "✓ Saved!" : saving ? "Saving…" : "Save Justification"}
                </button>
              </div>
            </div>
          )}

          {mode === "fix" && (
            <div className="space-y-3">
              <div>
                <p
                  className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                  style={{ color: "var(--text3)" }}
                >
                  CORRECT VALUE
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    max={isReplacement ? 100 : undefined}
                    value={fixValue}
                    onChange={(e) => setFixValue(e.target.value)}
                    autoFocus
                    className="w-28 border rounded-lg px-3 py-2.5 text-[15px] font-semibold focus:outline-none focus:ring-2"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                  <span className="text-[13px]" style={{ color: "var(--text2)" }}>
                    {unit || "occurrences/wk"}
                  </span>
                  <span className="text-[11px] ml-auto flex-shrink-0" style={{ color: "var(--text3)" }}>
                    was: {currentValue}{unit}
                  </span>
                </div>
              </div>
              <p className="text-[11px]" style={{ color: "var(--text3)" }}>
                Original value is saved for audit. Use the extension&apos;s Autofill button on the OP datasheet page to apply the correction.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("choose")}
                  className="flex-1 py-2 rounded-lg text-[12px] border"
                  style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                >
                  Back
                </button>
                <button
                  onClick={handleFix}
                  disabled={saving || saved}
                  className="flex-1 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 transition-colors"
                  style={{ background: saved ? "#16A34A" : "var(--teal)" }}
                >
                  {saved ? "✓ Saved!" : saving ? "Saving…" : "Fix Data"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Presentation constants ──────────────────────────────────────────────────

// Series colors. Purple = maladaptive (behaviors to reduce), green = replacement
// (skills to increase). Blue (--teal, which is #2563EB) is reserved for buttons and
// never encodes data, so a chart colour can never be mistaken for an action.
const SERIES = {
  maladaptive: { line: "#7F77DD", fill: "#EEEDFE", chip: "#F3F2FE", chipText: "#4F46A8" },
  replacement: { line: "#639922", fill: "#EAF3DE", chip: "#F0F7E7", chipText: "#4A7318" },
} as const;

type RangeKey = "4w" | "3m" | "6m" | "all";

const RANGES: { key: RangeKey; label: string; weeks: number | null }[] = [
  { key: "4w", label: "4 weeks", weeks: 4 },
  { key: "3m", label: "3 months", weeks: 13 },
  { key: "6m", label: "6 months", weeks: 26 },
  { key: "all", label: "All", weeks: null },
];

// The range filter is a VIEW window only. Every value — weeklyAvgs, buildProjection,
// yMax, the anomaly map — is still computed over the client's full record set; this
// only decides which of those points are drawn.
function rangeStartDate(weeks: number | null): string | null {
  if (weeks == null) return null;
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  return d.toISOString().split("T")[0];
}

// ── Status model ────────────────────────────────────────────────────────────

type StatusKey = "approaching" | "improving" | "steady" | "attention" | "no-data";

// Progress toward this program's own goal, direction-aware and normalised by its own
// baseline, so a behaviour going 30 -> 6 and a skill going 20 -> 92 are comparable on
// one scale. 1 = at goal, 0 = unchanged from baseline, negative = moved away from it.
// Derived from values weeklyAvgs already produced — nothing here is recomputed.
function goalProgress(hist: WeekPoint[], isRising: boolean): number | null {
  if (hist.length < 2) return null;
  const baseline = hist[0].avg;
  const latest = hist[hist.length - 1].avg;
  const goal = isRising ? 100 : 0;
  const span = Math.abs(goal - baseline);
  if (span === 0) return 1;
  return (span - Math.abs(goal - latest)) / span;
}

// One source of truth for both the metric cards and the row badges, so a card count and
// the rows it claims to summarise can never disagree.
function statusOf(hist: WeekPoint[], isRising: boolean, hasOpenAnomaly: boolean): StatusKey {
  if (hist.length === 0) return "no-data";
  if (hasOpenAnomaly) return "attention";
  const p = goalProgress(hist, isRising);
  if (p == null) return "steady";
  if (p < 0) return "attention";
  if (p >= 0.8) return "approaching";
  if (p > 0.05) return "improving";
  return "steady";
}

const STATUS_STYLE: Record<StatusKey, { label: string; bg: string; fg: string }> = {
  approaching: { label: "Approaching mastery", bg: "#EAF3DE", fg: "#3F6414" },
  improving:   { label: "Improving",           bg: "#F1F5F9", fg: "#334155" },
  steady:      { label: "Steady",              bg: "#F8FAFC", fg: "#64748B" },
  attention:   { label: "Needs attention",     bg: "#FEF2F2", fg: "#B91C1C" },
  "no-data":   { label: "No data",             bg: "#F8FAFC", fg: "#94A3B8" },
};

function StatusBadge({ status }: { status: StatusKey }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-block px-2 py-[3px] rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

// ── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div
      className="bg-white rounded-[10px] border px-4 py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-[11px] font-medium mb-1" style={{ color: "var(--text3)" }}>
        {label}
      </p>
      <p className="text-[26px] font-bold leading-none mb-1" style={{ color: "var(--text1)" }}>
        {value}
      </p>
      <p className="text-[10px] leading-snug" style={{ color: "var(--text3)" }}>
        {hint}
      </p>
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────

// Deliberately not recharts: one of these renders per row, and a full chart runtime per
// row is what made the old card list heavy. Breaks the path at gaps for the same reason
// the main chart does — a missing session must never read as a flat connecting line.
function Sparkline({ points, color }: { points: (number | null)[]; color: string }) {
  const W = 104, H = 26, PAD = 3;
  const real = points.filter((v): v is number => v != null);
  if (real.length < 2) {
    return (
      <svg width={W} height={H} aria-hidden>
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#E2E8F0" strokeWidth={1} strokeDasharray="2 3" />
      </svg>
    );
  }
  const min = Math.min(...real), max = Math.max(...real);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const segments: string[] = [];
  let cur: string[] = [];
  points.forEach((v, i) => {
    if (v == null) { if (cur.length > 1) segments.push(cur.join(" ")); cur = []; return; }
    cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length > 1) segments.push(cur.join(" "));

  const lastIdx = points.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
  const lastVal = lastIdx >= 0 ? points[lastIdx] : null;

  return (
    <svg width={W} height={H} aria-hidden>
      {segments.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {lastVal != null && (
        <circle cx={x(lastIdx)} cy={y(lastVal)} r={2.5} fill={color} stroke="white" strokeWidth={1} />
      )}
    </svg>
  );
}

// ── Program chart ───────────────────────────────────────────────────────────

function ProgramChart({
  histData,
  projValues,
  showProjections,
  unit,
  yMax,
  color,
  anomalies,
  weeksWithData,
  rangeStart,
  onSelectProjected,
  onSelectActual,
  onSelectAnomaly,
}: {
  histData: WeekPoint[];
  projValues: number[];
  showProjections: boolean;
  unit: string;
  yMax: number;
  color: { line: string; fill: string };
  anomalies?: Map<string, { reviewed: boolean; justification: string | null }>;
  weeksWithData?: Set<string>;
  rangeStart: string | null;
  onSelectProjected?: (week: string, value: number) => void;
  onSelectActual?: (week: string, value: number) => void;
  onSelectAnomaly?: (week: string) => void;
}) {
  const lastHistWeek = histData.length > 0 ? histData[histData.length - 1].week : null;
  const today = todayWeekStr();
  const baseWeek = lastHistWeek || today;

  // Cap projection to 4 weeks ahead — unchanged from the previous chart.
  const displayProjValues = projValues.slice(0, 4);
  const projWeeks = displayProjValues.map((_, i) => addWeeksToDate(baseWeek, i + 1));

  const chartData: any[] = [];
  for (let i = 0; i < histData.length; i++) {
    const d = histData[i];
    chartData.push({
      week: d.week,
      actual: (!weeksWithData || weeksWithData.has(d.week)) ? d.avg : null,
      projected: null,
    });
    if (i < histData.length - 1) {
      const nextExpected = addWeeksToDate(d.week, 1);
      if (nextExpected < histData[i + 1].week) {
        chartData.push({ week: nextExpected, actual: null, projected: null, isGap: true });
      }
    }
  }

  if (showProjections && histData.length > 0 && displayProjValues.length > 0) {
    let lastRealIdx = chartData.length - 1;
    while (lastRealIdx >= 0 && chartData[lastRealIdx].isGap) lastRealIdx--;
    if (lastRealIdx >= 0) {
      chartData[lastRealIdx] = {
        ...chartData[lastRealIdx],
        projected: histData[histData.length - 1].avg,
      };
    }
    displayProjValues.forEach((v, i) => {
      chartData.push({ week: projWeeks[i], actual: null, projected: v, isProjected: true });
    });
  }

  // The range filter trims the WINDOW, not the data: recorded points outside it are
  // dropped from the drawing only. Projected points always survive — they sit in the
  // future, and hiding them inside a past-facing window would be nonsense.
  const visible = rangeStart
    ? chartData.filter((d) => d.isProjected || d.week >= rangeStart)
    : chartData;

  // A missing session must read as a BREAK, never as a straight line to the next
  // recorded point. `actual` stays null across the gap (connectNulls={false}), and this
  // interpolated `bridge` is drawn UNDERNEATH in a dash: over recorded stretches the
  // solid area covers it exactly, so the dash is visible only where data is absent.
  const bridge: (number | null)[] = (() => {
    const vals = visible.map((d) => (d.actual == null ? null : Number(d.actual)));
    const out: (number | null)[] = vals.slice();
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] != null) continue;
      let prev = i - 1; while (prev >= 0 && vals[prev] == null) prev--;
      let next = i + 1; while (next < vals.length && vals[next] == null) next++;
      if (prev < 0 || next >= vals.length) { out[i] = null; continue; } // leading/trailing: nothing to bridge
      const a = vals[prev] as number, b = vals[next] as number;
      out[i] = a + ((b - a) * (i - prev)) / (next - prev);
    }
    return out;
  })();
  const data = visible.map((d, i) => ({ ...d, bridge: bridge[i] }));

  // Today marker: the first charted week on or after today.
  const todayRefWeek = data.find((d) => d.week >= today)?.week || null;
  const projSpan = showProjections
    ? data.filter((d) => d.isProjected).map((d) => d.week)
    : [];

  const ActualDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.actual == null) return null;
    const anomaly = anomalies?.get(payload.week);
    return (
      <g>
        <circle
          cx={cx} cy={cy} r={3.5}
          fill={color.line} stroke="white" strokeWidth={1.5}
          style={{ cursor: "pointer" }}
          onClick={() => onSelectActual?.(payload.week, payload.actual)}
        />
        {anomaly && (
          <polygon
            points={`${cx},${cy - 14} ${cx - 6},${cy - 3} ${cx + 6},${cy - 3}`}
            fill={anomaly.reviewed ? "#FCD34D" : "#EF4444"}
            stroke="white" strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelectAnomaly?.(payload.week); }}
          />
        )}
      </g>
    );
  };

  // Hollow: a projected point is a forecast, and must never look like something the RBT
  // recorded. Same hue as the series so it reads as the same program, opposite fill so
  // it cannot be confused with a real observation.
  const ProjDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.projected == null || !payload?.isProjected) return null;
    return (
      <circle
        cx={cx} cy={cy} r={4}
        fill="white" stroke={color.line} strokeWidth={2} strokeDasharray="2 1.5"
        style={{ cursor: "pointer" }}
        onClick={() => onSelectProjected?.(payload.week, payload.projected)}
      />
    );
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={data} margin={{ top: 18, right: 14, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id={`fill-${color.line.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color.fill} stopOpacity={1} />
              <stop offset="100%" stopColor={color.fill} stopOpacity={0.25} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={fmtWeek}
            tick={{ fontSize: 9, fill: "#94A3B8" }}
            interval="preserveStartEnd"
            tickLine={false}
            axisLine={{ stroke: "#E2E8F0" }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "#94A3B8" }}
            tickFormatter={(v) => `${v}${unit}`}
            domain={[0, yMax]}
            width={38}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value: any, name: any) => [
              `${value}${unit}`,
              name === "actual" ? "Recorded" : name === "projected" ? "Projected" : "",
            ]}
            labelFormatter={(l) => fmtWeek(String(l))}
            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--border)" }}
          />

          {projSpan.length > 0 && (
            <ReferenceArea
              x1={projSpan[0]}
              x2={projSpan[projSpan.length - 1]}
              fill={color.fill}
              fillOpacity={0.45}
              stroke="none"
              label={{ value: "Projected", position: "insideTop", fontSize: 9, fill: color.line }}
            />
          )}

          {todayRefWeek && (
            <ReferenceLine
              x={todayRefWeek}
              stroke="#94A3B8"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{ value: "Today", position: "insideTopLeft", fontSize: 9, fill: "#64748B" }}
            />
          )}

          {/* Dashed bridge, under the solid area — visible only across missing sessions. */}
          <Line
            dataKey="bridge"
            stroke={color.line}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            strokeOpacity={0.75}
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            dataKey="actual"
            stroke={color.line}
            strokeWidth={2}
            fill={`url(#fill-${color.line.slice(1)})`}
            dot={<ActualDot />}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {showProjections && (
            <Area
              dataKey="projected"
              stroke={color.line}
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
              dot={<ProjDot />}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      <p className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>
        Click a filled dot to edit a recorded value
        {showProjections ? " · a hollow dot to confirm a projection" : ""}
        {" · a triangle to review an anomaly"}
      </p>
    </div>
  );
}

// ── Program details panel ───────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px]">
      <span className="text-[11px]" style={{ color: "var(--text3)" }}>{label}</span>
      <span className="text-[11px] font-medium text-right" style={{ color: "var(--text1)" }}>
        {children}
      </span>
    </div>
  );
}

function ProgramDetails({
  histData,
  unit,
  isRising,
  openAnomalies,
  totalAnomalies,
}: {
  histData: WeekPoint[];
  unit: string;
  isRising: boolean;
  openAnomalies: number;
  totalAnomalies: number;
}) {
  const baseline = histData.length > 0 ? histData[0] : null;
  const latest = histData.length > 0 ? histData[histData.length - 1] : null;
  const change =
    baseline && latest && histData.length > 1
      ? Math.round((latest.avg - baseline.avg) * 10) / 10
      : null;
  const progress = goalProgress(histData, isRising);
  const towardGoal = change != null && ((isRising && change > 0) || (!isRising && change < 0));

  return (
    <div
      className="rounded-[8px] border px-3 py-2"
      style={{ borderColor: "var(--border)", background: "#FBFCFD" }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text3)" }}>
        Program details
      </p>

      <DetailRow label="Goal">{isRising ? "100%" : "0 occurrences"}</DetailRow>
      <DetailRow label="Baseline">
        {baseline ? <>{baseline.avg}{unit} <span style={{ color: "var(--text3)" }}>· {fmtWeek(baseline.week)}</span></> : "—"}
      </DetailRow>
      <DetailRow label="Last recorded">
        {latest ? <>{latest.avg}{unit} <span style={{ color: "var(--text3)" }}>· {fmtWeek(latest.week)}</span></> : "—"}
      </DetailRow>
      <DetailRow label="Change vs baseline">
        {change == null ? "—" : (
          <span style={{ color: towardGoal ? "#3F6414" : change === 0 ? "var(--text2)" : "#B91C1C" }}>
            {change > 0 ? "+" : ""}{change}{unit}
          </span>
        )}
      </DetailRow>
      <DetailRow label="Progress to goal">
        {progress == null ? "—" : `${Math.round(progress * 100)}%`}
      </DetailRow>
      <DetailRow label="Weeks recorded">{histData.length || "—"}</DetailRow>
      <DetailRow label="Anomalies">
        {totalAnomalies === 0 ? "None" : (
          <>
            {totalAnomalies} total
            {openAnomalies > 0 && (
              <span style={{ color: "#B91C1C" }}> · {openAnomalies} unreviewed</span>
            )}
          </>
        )}
      </DetailRow>

      <div className="mt-2 pt-2" style={{ borderTop: "1px dashed var(--border)" }}>
        {/* Placeholders. Session attendance is not tracked yet — these stay blank rather
            than being inferred from recorded weeks, which would state something untrue. */}
        <DetailRow label="Sessions expected"><span style={{ color: "var(--text3)" }}>—</span></DetailRow>
        <DetailRow label="Sessions completed"><span style={{ color: "var(--text3)" }}>—</span></DetailRow>
        <DetailRow label="Sessions missing"><span style={{ color: "var(--text3)" }}>—</span></DetailRow>
        <p className="text-[10px] mt-1 leading-snug" style={{ color: "var(--text3)" }}>
          Session counts are not tracked yet.
        </p>
      </div>
    </div>
  );
}

// ── Program row ─────────────────────────────────────────────────────────────

function ProgramRow({
  name,
  records,
  isRising,
  nameIndex,
  clientId,
  onDataConfirmed,
  adjustValue,
  rangeStart,
  showProjections,
  expanded,
  onToggle,
}: {
  name: string;
  records: any[];
  isRising: boolean;
  nameIndex: number;
  clientId: string;
  onDataConfirmed: () => void;
  adjustValue?: (v: number) => number;
  rangeStart: string | null;
  showProjections: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const valueKey = isRising ? "observed_percentage" : "frequency";
  const unit = isRising ? "%" : "";
  const color = isRising ? SERIES.replacement : SERIES.maladaptive;

  const histData = useMemo(
    () => weeklyAvgs(records, valueKey, isRising ? "avg" : "sum"),
    [records, valueKey, isRising],
  );

  const weeksWithData = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      const rawDate = r.week_start || r.session_date;
      if (!rawDate) return;
      const dateStr = String(rawDate).replace(/T.*$/, "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) set.add(dateStr);
    });
    return set;
  }, [records]);

  const [pendingConfirm, setPendingConfirm] = useState<{ week: string; value: number } | null>(null);
  const [editingActual, setEditingActual] = useState<{ week: string; value: number } | null>(null);
  const [anomalyTarget, setAnomalyTarget] = useState<{
    week: string;
    currentValue: number;
    recordId: string;
    isReviewed: boolean;
    justification: string | null;
  } | null>(null);

  const goal = isRising ? 100 : 0;

  const projValues = useMemo(() => {
    if (histData.length === 0) return [];
    const raw = buildProjection(
      histData.map((d) => d.avg),
      { baseline: histData[histData.length - 1].avg, goal, totalWeeks: null },
      nameIndex,
    );
    return adjustValue ? raw.map((v: number) => adjustValue(v)) : raw;
  }, [histData, goal, nameIndex, adjustValue]);

  const yMax = useMemo(() => {
    if (isRising) return 100;
    const allVals = [...histData.map((d) => d.avg), ...projValues];
    return allVals.length > 0 ? Math.ceil(Math.max(...allVals) * 1.1) : 10;
  }, [histData, projValues, isRising]);

  const anomalyMap = useMemo(() => buildAnomalyMap(histData), [histData]);

  const openAnomalies = useMemo(
    () => Array.from(anomalyMap.values()).filter((a) => !a.reviewed).length,
    [anomalyMap],
  );

  // Row-level summary uses the SAME window as the chart, so the sparkline, the last
  // recorded value and the expanded chart can never describe different periods.
  const windowed = useMemo(
    () => (rangeStart ? histData.filter((d) => d.week >= rangeStart) : histData),
    [histData, rangeStart],
  );
  const latest = windowed.length > 0 ? windowed[windowed.length - 1] : null;
  const status = statusOf(windowed, isRising, openAnomalies > 0);

  // Sparkline points on a weekly cadence, with nulls where a week has no record — the
  // gap has to survive into the sparkline or the row overstates continuity.
  const sparkPoints = useMemo(() => {
    if (windowed.length === 0) return [];
    const out: (number | null)[] = [];
    for (let i = 0; i < windowed.length; i++) {
      out.push(weeksWithData.has(windowed[i].week) ? windowed[i].avg : null);
      if (i < windowed.length - 1 && addWeeksToDate(windowed[i].week, 1) < windowed[i + 1].week) {
        out.push(null);
      }
    }
    return out;
  }, [windowed, weeksWithData]);

  function handleSelectAnomaly(week: string) {
    const pt = histData.find((p) => p.week === week);
    if (!pt?.recordId) return;
    const anomaly = anomalyMap.get(week);
    setAnomalyTarget({
      week,
      currentValue: pt.avg,
      recordId: pt.recordId,
      isReviewed: anomaly?.reviewed ?? false,
      justification: anomaly?.justification ?? null,
    });
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className="grid items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-[#FBFCFD]"
        style={{
          gridTemplateColumns: "minmax(0,1fr) 104px 128px 150px 20px",
          borderTop: "1px solid var(--border)",
          background: expanded ? "#FBFCFD" : undefined,
        }}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-medium truncate" style={{ color: "var(--text1)" }}>
            {name}
          </p>
          <span
            className="inline-block mt-[3px] px-1.5 py-[1px] rounded text-[9px] font-semibold"
            style={{ background: color.chip, color: color.chipText }}
          >
            {isRising ? "Replacement skill" : "Maladaptive behavior"}
          </span>
        </div>

        <Sparkline points={sparkPoints} color={color.line} />

        <div className="text-right">
          {latest ? (
            <>
              {/* Neutral, never orange — a last recorded value is data, not a warning. */}
              <p className="text-[15px] font-semibold leading-tight" style={{ color: "var(--text1)" }}>
                {latest.avg}{unit}
              </p>
              <p className="text-[10px]" style={{ color: "var(--text3)" }}>{fmtWeek(latest.week)}</p>
            </>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>No data in range</p>
          )}
        </div>

        <div><StatusBadge status={status} /></div>

        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>

      {expanded && (
        <div
          className="px-4 pb-4 pt-1"
          style={{ borderTop: "1px dashed var(--border)", background: "#FBFCFD" }}
        >
          {histData.length === 0 ? (
            <div
              className="flex items-center justify-center h-28 rounded-lg border-2 border-dashed"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="text-[12px] italic text-center px-4" style={{ color: "var(--text3)" }}>
                Extract charts from Office Puzzle to populate this graph.
              </p>
            </div>
          ) : (
            <div className="flex gap-4 items-start flex-col lg:flex-row">
              <div className="flex-1 min-w-0 w-full">
                <ProgramChart
                  histData={histData}
                  projValues={projValues}
                  showProjections={showProjections}
                  unit={unit}
                  yMax={yMax}
                  color={color}
                  anomalies={anomalyMap}
                  weeksWithData={weeksWithData}
                  rangeStart={rangeStart}
                  onSelectProjected={(week, value) => setPendingConfirm({ week, value })}
                  onSelectActual={(week, value) => setEditingActual({ week, value })}
                  onSelectAnomaly={handleSelectAnomaly}
                />
              </div>
              <div className="w-full lg:w-[248px] flex-shrink-0">
                <ProgramDetails
                  histData={histData}
                  unit={unit}
                  isRising={isRising}
                  openAnomalies={openAnomalies}
                  totalAnomalies={anomalyMap.size}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {pendingConfirm && (
        <ConfirmWeekModal
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
      {editingActual && (
        <ConfirmWeekModal
          week={editingActual.week}
          projectedValue={editingActual.value}
          isReplacement={isRising}
          unit={unit}
          name={name}
          clientId={clientId}
          onSaved={onDataConfirmed}
          onClose={() => setEditingActual(null)}
          isEdit
        />
      )}
      {anomalyTarget && (
        <AnomalyModal
          week={anomalyTarget.week}
          currentValue={anomalyTarget.currentValue}
          recordId={anomalyTarget.recordId}
          isReplacement={isRising}
          unit={unit}
          name={name}
          isReviewed={anomalyTarget.isReviewed}
          justification={anomalyTarget.justification}
          onSaved={onDataConfirmed}
          onClose={() => setAnomalyTarget(null)}
        />
      )}
    </>
  );
}

// ── Shared derivations ──────────────────────────────────────────────────────

// Extracted verbatim from the previous TargetCard so the metric cards and the row
// badges read anomalies through exactly one implementation.
function buildAnomalyMap(histData: WeekPoint[]) {
  const m = new Map<string, { reviewed: boolean; justification: string | null }>();
  for (let i = 1; i < histData.length; i++) {
    const pt = histData[i];
    const deltaAbs = Math.abs(pt.avg - histData[i - 1].avg);
    if (deltaAbs > ANOMALY_THRESHOLD || pt.isAnomaly) {
      m.set(pt.week, {
        reviewed: pt.anomalyReviewed ?? false,
        justification: pt.anomalyJustification ?? null,
      });
    }
  }
  return m;
}

// ── Main DataTab ────────────────────────────────────────────────────────────

export function DataTab({ client, complianceLevel = "typical", missedHours = 0 }: { client: any; complianceLevel?: "typical" | "below_typical" | "poor"; missedHours?: number }) {
  function applyQualityAdjustment(value: number, type: "maladaptive" | "replacement"): number {
    const isMissed = missedHours > 0;
    const hasEnvChange = complianceLevel === "poor";
    if (type === "maladaptive") {
      if (isMissed) return value + Math.floor(Math.random() * 2) + 6;
      if (hasEnvChange) return value + Math.floor(Math.random() * 2) + 5;
      if (complianceLevel === "below_typical") return value + Math.floor(Math.random() * 2) + 4;
      const v = Math.floor(Math.random() * 4) + 1;
      return Math.max(0, value + (Math.random() > 0.5 ? v : -v));
    } else {
      if (isMissed) return Math.max(0, Math.min(100, value - (Math.floor(Math.random() * 2) + 6)));
      if (hasEnvChange) return Math.max(0, Math.min(100, value - (Math.floor(Math.random() * 2) + 5)));
      if (complianceLevel === "below_typical") return Math.max(0, Math.min(100, value - (Math.floor(Math.random() * 2) + 4)));
      const v = Math.floor(Math.random() * 4) + 1;
      return Math.max(0, Math.min(100, value + (Math.random() > 0.5 ? v : -v)));
    }
  }
  const { data: session } = useSession();
  const [replacementData, setReplacementData] = useState<any[]>([]);
  const [maladaptiveData, setMaladaptiveData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // View state. Projections are OFF by default: the recorded record is what the tab is
  // for, and a forecast should be something the clinician asks to see.
  const [range, setRange] = useState<RangeKey>("3m");
  const [showProjections, setShowProjections] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true);
    try {
      const [repRes, maladRes] = await Promise.all([
        fetch(`/api/replacement-data?clientId=${client.id}`),
        fetch(`/api/maladaptive-data?clientId=${client.id}`),
      ]);
      if (repRes.ok) setReplacementData((await repRes.json()).data || []);
      if (maladRes.ok) setMaladaptiveData((await maladRes.json()).data || []);
    } catch {}
    setLoading(false);
  }, [client?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const repBySkill = useMemo(() => {
    const raw: Record<string, any[]> = {};
    replacementData.forEach((r) => {
      const n = r.replacement_skill;
      (raw[n] = raw[n] || []).push(r);
    });
    const merged: Record<string, any[]> = {};
    for (const [name, recs] of Object.entries(raw)) {
      const existingKey = Object.keys(merged).find((k) => fuzzyNamesMatch(k, name));
      if (existingKey) {
        const winner = existingKey.length >= name.length ? existingKey : name;
        const existing = merged[existingKey];
        delete merged[existingKey];
        merged[winner] = [...existing, ...recs];
      } else {
        merged[name] = [...recs];
      }
    }
    return merged;
  }, [replacementData]);

  const maladByBehavior = useMemo(() => {
    const raw: Record<string, any[]> = {};
    maladaptiveData.forEach((r) => {
      const n = r.behavior_name;
      (raw[n] = raw[n] || []).push(r);
    });
    const merged: Record<string, any[]> = {};
    for (const [name, recs] of Object.entries(raw)) {
      const existingKey = Object.keys(merged).find((k) => fuzzyNamesMatch(k, name));
      if (existingKey) {
        const winner = existingKey.length >= name.length ? existingKey : name;
        const existing = merged[existingKey];
        delete merged[existingKey];
        merged[winner] = [...existing, ...recs];
      } else {
        merged[name] = [...recs];
      }
    }
    return merged;
  }, [maladaptiveData]);

  const behaviorNames: string[] = useMemo(() => {
    const profileNames = (client.clinicalProfile?.maladaptiveBehaviors || [])
      .map((b: any) => (typeof b === "string" ? b : b.name))
      .filter(Boolean) as string[];
    const usedKeys = new Set<string>();
    const result: string[] = [];
    for (const pName of profileNames) {
      const matchKey = Object.keys(maladByBehavior).find((k) => fuzzyNamesMatch(k, pName));
      const key = matchKey ?? pName;
      if (!usedKeys.has(key)) { usedKeys.add(key); result.push(key); }
    }
    for (const k of Object.keys(maladByBehavior)) {
      if (!usedKeys.has(k) && !profileNames.some((p) => fuzzyNamesMatch(p, k))) {
        result.push(k); usedKeys.add(k);
      }
    }
    return result;
  }, [maladByBehavior, client.clinicalProfile]);

  const skillNames: string[] = useMemo(() => {
    const raw = [
      ...(client.clinicalProfile?.replacementBehaviors || []),
      ...(client.clinicalProfile?.skillAcquisition || []),
    ]
      .map((s: any) => (typeof s === "string" ? s : s.name))
      .filter(Boolean) as string[];
    const seen = new Set<string>();
    const profileNames = raw.filter((n) => { if (seen.has(n)) return false; seen.add(n); return true; });
    const usedKeys = new Set<string>();
    const result: string[] = [];
    for (const pName of profileNames) {
      const matchKey = Object.keys(repBySkill).find((k) => fuzzyNamesMatch(k, pName));
      const key = matchKey ?? pName;
      if (!usedKeys.has(key)) { usedKeys.add(key); result.push(key); }
    }
    for (const k of Object.keys(repBySkill)) {
      if (!usedKeys.has(k) && !profileNames.some((p) => fuzzyNamesMatch(p, k))) {
        result.push(k); usedKeys.add(k);
      }
    }
    return result;
  }, [repBySkill, client.clinicalProfile]);

  const rangeStart = useMemo(
    () => rangeStartDate(RANGES.find((r) => r.key === range)?.weeks ?? null),
    [range],
  );

  // One list, both sections. nameIndex stays the index within the program's OWN section:
  // buildProjection seeds its RNG and staggers its completion week off it, so renumbering
  // across a merged list would silently change every projected curve.
  const rows = useMemo(() => {
    const out = [
      ...behaviorNames.map((name, i) => ({
        key: `maladaptive:${name}`, name, isRising: false, nameIndex: i,
        records: maladByBehavior[name] || [],
      })),
      ...skillNames.map((name, i) => ({
        key: `replacement:${name}`, name, isRising: true, nameIndex: i,
        records: repBySkill[name] || [],
      })),
    ];
    return out.map((r) => {
      const hist = weeklyAvgs(r.records, r.isRising ? "observed_percentage" : "frequency", r.isRising ? "avg" : "sum");
      const windowed = rangeStart ? hist.filter((d) => d.week >= rangeStart) : hist;
      const openAnomalies = Array.from(buildAnomalyMap(hist).values()).filter((a) => !a.reviewed).length;
      return { ...r, status: statusOf(windowed, r.isRising, openAnomalies > 0) };
    });
  }, [behaviorNames, skillNames, maladByBehavior, repBySkill, rangeStart]);

  const metrics = useMemo(() => ({
    active: rows.length,
    improving: rows.filter((r) => r.status === "improving" || r.status === "approaching").length,
    approaching: rows.filter((r) => r.status === "approaching").length,
    attention: rows.filter((r) => r.status === "attention").length,
  }), [rows]);

  if (loading) {
    return (
      <div className="py-10 text-center text-[13px]" style={{ color: "var(--text3)" }}>
        Loading data…
      </div>
    );
  }

  const isAdmin =
    (session?.user as any)?.role === "admin" ||
    session?.user?.email === "marlonfdz03@gmail.com";

  if (!isAdmin) {
    return (
      <div className="flex justify-center py-16 px-6">
        <div
          className="bg-white rounded-2xl border px-10 py-12 text-center max-w-sm w-full"
          style={{ borderColor: "var(--border)", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: "rgba(37,99,235,0.1)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className="text-[16px] font-semibold mb-2" style={{ color: "var(--text1)" }}>
            Data tracking coming soon
          </p>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--text3)" }}>
            This feature will be available in a future update.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[980px]">
      {/* ── Metric cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricCard label="Active programs" value={metrics.active}
          hint="Behaviors and skills currently tracked" />
        <MetricCard label="Improving vs baseline" value={metrics.improving}
          hint="Programs closer to goal than at baseline" />
        <MetricCard label="Approaching mastery" value={metrics.approaching}
          hint="80% or more of the way to goal" />
        <MetricCard label="Needs attention" value={metrics.attention}
          hint="Moved away from goal, or an unreviewed anomaly" />
      </div>

      {/* ── Global controls: one range and one projection setting for every chart ── */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div
          className="inline-flex rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--border)", background: "white" }}
        >
          {RANGES.map((r) => {
            const active = range === r.key;
            return (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className="px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: active ? "var(--teal)" : "white",
                  color: active ? "white" : "var(--text2)",
                  borderLeft: r.key === "4w" ? "none" : "1px solid var(--border)",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <label
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] cursor-pointer select-none"
          style={{ borderColor: "var(--border)", background: "white", color: "var(--text2)" }}
        >
          <input
            type="checkbox"
            checked={showProjections}
            onChange={(e) => setShowProjections(e.target.checked)}
            style={{ accentColor: "var(--teal)" }}
          />
          Show projections
        </label>

        <button
          onClick={loadData}
          className="ml-auto px-3 py-1.5 rounded-lg text-[12px] border transition-colors"
          style={{ borderColor: "var(--border)", background: "white", color: "var(--text3)" }}
          title="Refresh data"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Program table ── */}
      <div
        className="bg-white rounded-[10px] border overflow-hidden"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="grid gap-3 px-4 py-2"
          style={{
            gridTemplateColumns: "minmax(0,1fr) 104px 128px 150px 20px",
            background: "#FBFCFD",
          }}
        >
          {["Program", "Trend", "Last recorded", "Status", ""].map((h, i) => (
            <span
              key={i}
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text3)", textAlign: i === 2 ? "right" : "left" }}
            >
              {h}
            </span>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text2)" }}>
              No programs yet.
            </p>
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>
              Upload an assessment to add targets to this client.
            </p>
          </div>
        ) : (
          rows.map((r) => (
            <ProgramRow
              key={r.key}
              name={r.name}
              records={r.records}
              isRising={r.isRising}
              nameIndex={r.nameIndex}
              clientId={client.id}
              onDataConfirmed={loadData}
              adjustValue={(v) => applyQualityAdjustment(v, r.isRising ? "replacement" : "maladaptive")}
              rangeStart={rangeStart}
              showProjections={showProjections}
              expanded={expandedKey === r.key}
              onToggle={() => setExpandedKey(expandedKey === r.key ? null : r.key)}
            />
          ))
        )}
      </div>

      {/* ── Footer disclaimer ── */}
      <p className="text-[10px] leading-relaxed mt-3" style={{ color: "var(--text3)" }}>
        Projected values are a statistical extrapolation of recorded data, not a clinical
        forecast. They are not observations, must not be treated as session data, and
        should never be entered as recorded values without direct observation. Only the
        solid line and filled points reflect data actually collected.
      </p>
    </div>
  );
}
