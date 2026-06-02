"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildProjection } from "@/lib/projection";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────

type Section = "maladaptive" | "replacement";

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
      const confirmed = recs.filter((r) => r.user_confirmed);
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
              {!isEdit && (
                <span className="text-[11px] ml-auto flex-shrink-0" style={{ color: "var(--text3)" }}>
                  Projected: {projectedValue}{unit}
                </span>
              )}
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

// ── ProgressChart ───────────────────────────────────────────────────────────

function ProgressChart({
  histData,
  projValues,
  isRising,
  unit,
  yMax,
  anomalies,
  onSelectProjected,
  onSelectActual,
  onSelectAnomaly,
}: {
  histData: WeekPoint[];
  projValues: number[];
  isRising: boolean;
  unit: string;
  yMax: number;
  anomalies?: Map<string, { reviewed: boolean; justification: string | null }>;
  onSelectProjected?: (week: string, value: number) => void;
  onSelectActual?: (week: string, value: number) => void;
  onSelectAnomaly?: (week: string) => void;
}) {
  const lastHistWeek = histData.length > 0 ? histData[histData.length - 1].week : null;
  const today = todayWeekStr();
  const baseWeek = lastHistWeek || today;
  const projWeeks = projValues.map((_, i) => addWeeksToDate(baseWeek, i + 1));

  const chartData: any[] = [
    ...histData.map((d) => ({ week: d.week, actual: d.avg, projected: null })),
  ];

  if (histData.length > 0 && projValues.length > 0) {
    chartData[chartData.length - 1] = {
      ...chartData[chartData.length - 1],
      projected: histData[histData.length - 1].avg,
    };
  }

  projValues.forEach((v, i) => {
    chartData.push({ week: projWeeks[i], actual: null, projected: v, isProjected: true });
  });

  const todayRefWeek =
    chartData.find((d) => d.week >= today && d.projected != null)?.week || null;

  const CustomActualDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.actual == null) return null;
    const anomaly = anomalies?.get(payload.week);
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="#111827"
          stroke="white"
          strokeWidth={1.5}
          style={{ cursor: "pointer" }}
          onClick={() => onSelectActual?.(payload.week, payload.actual)}
        />
        {anomaly && (
          <polygon
            points={`${cx},${cy - 14} ${cx - 6},${cy - 3} ${cx + 6},${cy - 3}`}
            fill={anomaly.reviewed ? "#FCD34D" : "#EF4444"}
            stroke="white"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectAnomaly?.(payload.week);
            }}
          />
        )}
      </g>
    );
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
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData} margin={{ top: 16, right: 16, bottom: 24, left: 28 }}>
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
          domain={[0, yMax]}
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
        {todayRefWeek && (
          <ReferenceLine
            x={todayRefWeek}
            stroke="#9ca3af"
            strokeDasharray="4 3"
            label={{ value: "Today", position: "insideTopLeft", fontSize: 9, fill: "#9ca3af" }}
          />
        )}
        <Line
          dataKey="actual"
          stroke="#111827"
          strokeWidth={2}
          dot={<CustomActualDot />}
          connectNulls={false}
          isAnimationActive={false}
        />
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
  );
}

// ── Target Card ─────────────────────────────────────────────────────────────

function TargetCard({
  name,
  records,
  isRising,
  nameIndex,
  clientId,
  onDataConfirmed,
  adjustValue,
}: {
  name: string;
  records: any[];
  isRising: boolean;
  nameIndex: number;
  clientId: string;
  onDataConfirmed: () => void;
  adjustValue?: (v: number) => number;
}) {
  const valueKey = isRising ? "observed_percentage" : "frequency";
  const unit = isRising ? "%" : "";

  const histData = useMemo(
    () => weeklyAvgs(records, valueKey, isRising ? "avg" : "sum"),
    [records, valueKey, isRising],
  );
  const currentValue = histData.length > 0 ? histData[histData.length - 1].avg : null;
  const prevValue = histData.length > 1 ? histData[histData.length - 2].avg : null;
  const delta =
    prevValue != null && currentValue != null
      ? Math.round((currentValue - prevValue) * 10) / 10
      : null;

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

  // Compute anomaly map: client-side delta detection + DB-stored anomaly flags
  const anomalyMap = useMemo(() => {
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
  }, [histData]);

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
            {currentValue != null && (
              <span
                className="text-[22px] font-bold"
                style={{ color: isRising ? "var(--teal)" : "#F59E0B" }}
              >
                {currentValue}{unit}
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

        {/* Chart or empty state */}
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
          <ProgressChart
            histData={histData}
            projValues={projValues}
            isRising={isRising}
            unit={unit}
            yMax={yMax}
            anomalies={anomalyMap}
            onSelectProjected={(week, value) => setPendingConfirm({ week, value })}
            onSelectActual={(week, value) => setEditingActual({ week, value })}
            onSelectAnomaly={handleSelectAnomaly}
          />
        )}

        {/* Action hint */}
        {histData.length > 0 && (
          <p className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>
            Click a black dot to edit · green dot to confirm projection · red/yellow triangle to review anomaly
          </p>
        )}
      </div>

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
    </div>
  );
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
  const [section, setSection] = useState<Section>("maladaptive");
  const [replacementData, setReplacementData] = useState<any[]>([]);
  const [maladaptiveData, setMaladaptiveData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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
    const map: Record<string, any[]> = {};
    replacementData.forEach((r) => {
      (map[r.replacement_skill] = map[r.replacement_skill] || []).push(r);
    });
    return map;
  }, [replacementData]);

  const maladByBehavior = useMemo(() => {
    const map: Record<string, any[]> = {};
    maladaptiveData.forEach((r) => {
      (map[r.behavior_name] = map[r.behavior_name] || []).push(r);
    });
    return map;
  }, [maladaptiveData]);

  const behaviorNames: string[] = useMemo(() => {
    const profileNames = (client.clinicalProfile?.maladaptiveBehaviors || [])
      .map((b: any) => (typeof b === "string" ? b : b.name))
      .filter(Boolean) as string[];
    const profileSet = new Set(profileNames);
    const dbExtra = Object.keys(maladByBehavior).filter((n) => !profileSet.has(n));
    return [...profileNames, ...dbExtra];
  }, [maladByBehavior, client.clinicalProfile]);

  const skillNames: string[] = useMemo(() => {
    const raw = [
      ...(client.clinicalProfile?.replacementBehaviors || []),
      ...(client.clinicalProfile?.skillAcquisition || []),
    ]
      .map((s: any) => (typeof s === "string" ? s : s.name))
      .filter(Boolean) as string[];
    const seen = new Set<string>();
    const profileNames = raw.filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    const dbExtra = Object.keys(repBySkill).filter((n) => !seen.has(n));
    return [...profileNames, ...dbExtra];
  }, [repBySkill, client.clinicalProfile]);

  if (loading) {
    return (
      <div className="py-10 text-center text-[13px]" style={{ color: "var(--text3)" }}>
        Loading data…
      </div>
    );
  }

  const emptyCard = (message: string) => (
    <div
      className="bg-white rounded-[10px] border px-6 py-10 text-center"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text2)" }}>
        {message}
      </p>
      <p className="text-[12px]" style={{ color: "var(--text3)" }}>
        Upload an assessment to add targets to this client.
      </p>
    </div>
  );

  return (
    <div className="max-w-[860px]">
      {/* Section toggle */}
      <div className="flex gap-2 mb-6">
        {(["maladaptive", "replacement"] as const).map((s) => {
          const label = s === "maladaptive" ? "Maladaptive Behaviors" : "Replacement Skills";
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

      {section === "maladaptive" && (
        <div>
          {behaviorNames.length === 0
            ? emptyCard("No maladaptive behaviors yet.")
            : behaviorNames.map((name, i) => (
                <TargetCard
                  key={name}
                  name={name}
                  records={maladByBehavior[name] || []}
                  isRising={false}
                  nameIndex={i}
                  clientId={client.id}
                  onDataConfirmed={loadData}
                  adjustValue={(v) => applyQualityAdjustment(v, "maladaptive")}
                />
              ))}
        </div>
      )}

      {section === "replacement" && (
        <div>
          {skillNames.length === 0
            ? emptyCard("No replacement skills yet.")
            : skillNames.map((name, i) => (
                <TargetCard
                  key={name}
                  name={name}
                  records={repBySkill[name] || []}
                  isRising={true}
                  nameIndex={i}
                  clientId={client.id}
                  onDataConfirmed={loadData}
                  adjustValue={(v) => applyQualityAdjustment(v, "replacement")}
                />
              ))}
        </div>
      )}
    </div>
  );
}
