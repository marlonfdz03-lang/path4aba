"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

interface WeekPoint { week: string; avg: number }

// ── Utilities ──────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  return s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
}

function fmtWeek(week: string): string {
  if (!week || week === "?") return "";
  try {
    const d = new Date(week.substring(0, 7) + "-01");
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
    const d = new Date(weekStr.substring(0, 7) + "-01");
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

// ── Projection engine ──────────────────────────────────────────────────────

const TOTAL_WEEKS = 26;
const MAX_STEP = 4;

function buildProjection(
  histValues: number[],
  sto: { baseline: number; goal: number; totalWeeks: number | null },
  nameIndex: number,
): number[] {
  const start = histValues.length > 0 ? histValues[histValues.length - 1] : sto.baseline;
  const { goal } = sto;
  if (start === goal) return [];

  const rising = goal > start;
  const totalDist = Math.abs(goal - start);
  const completionWeek = 18 + (Math.abs(nameIndex) % 8);
  const avgStep = totalDist / completionWeek;

  const magMultipliers = [0.5, 1.2, 0.3, 2.0, 0.8, 1.6, 0.4, 2.4, 1.0, 1.8, 0.6, 2.8, 1.4, 0.7, 2.2, 0.9];
  const magPool = magMultipliers.map((m) => Math.min(m * avgStep, MAX_STEP));

  const seed = Math.abs(hashStr(String(nameIndex).padStart(4, "X")));
  const rng = mulberry32(seed);

  const out: number[] = [];
  let prev = start;
  let consecutiveDir = 0;
  let lastDir = 0;
  let lastMagIdx = -1;

  for (let w = 0; w < TOTAL_WEEKS; w++) {
    if (w >= completionWeek) {
      out.push(Math.round(goal * 10) / 10);
      continue;
    }
    if (w === completionWeek - 1) {
      out.push(Math.round(goal * 10) / 10);
      prev = goal;
      continue;
    }

    let magIdx = Math.floor(rng() * magPool.length);
    if (magIdx === lastMagIdx) magIdx = (magIdx + 1) % magPool.length;
    lastMagIdx = magIdx;
    const mag = magPool[magIdx];

    const remaining = completionWeek - w;
    const distLeft = Math.abs(goal - prev);

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

// ── Set Starting Value Modal ────────────────────────────────────────────────

function SetStartingValueModal({
  name,
  isReplacement,
  unit,
  clientId,
  onSaved,
  onClose,
}: {
  name: string;
  isReplacement: boolean;
  unit: string;
  clientId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    const num = isReplacement ? parseFloat(trimmed) : parseInt(trimmed);
    if (isNaN(num)) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const weekStart = today.substring(0, 7) + "-01";
      const endpoint = isReplacement ? "/api/replacement-data" : "/api/maladaptive-data";
      const body = isReplacement
        ? [{ clientId, replacementSkill: name, sessionDate: today, weekStart, observedPercentage: num, totalTrials: 10, userConfirmed: true }]
        : [{ clientId, behaviorName: name, sessionDate: today, weekStart, frequency: num, userConfirmed: true }];
      await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      onSaved();
      onClose();
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
              Set Starting Value
            </p>
            <p className="text-[11px] truncate max-w-[240px]" style={{ color: "var(--text3)" }}>
              {name}
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
              CURRENT VALUE
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max={isReplacement ? 100 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder={isReplacement ? "0–100" : "e.g. 20"}
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
            disabled={saving || value.trim() === ""}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--teal)" }}
          >
            {saving ? "Saving…" : "Save & Generate Projection"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [value, setValue] = useState(String(projectedValue));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const num = isReplacement ? parseFloat(value) : parseInt(value);
    if (isNaN(num)) return;
    setSaving(true);
    try {
      const weekStart = week.substring(0, 7) + "-01";
      const endpoint = isReplacement ? "/api/replacement-data" : "/api/maladaptive-data";
      const body = isReplacement
        ? [{ clientId, replacementSkill: name, sessionDate: weekStart, weekStart, observedPercentage: num, totalTrials: 10, userConfirmed: true }]
        : [{ clientId, behaviorName: name, sessionDate: weekStart, weekStart, frequency: num, userConfirmed: true }];
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
              {fmtWeek(week)}
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
              ACTUAL VALUE
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
              <span className="text-[11px] ml-auto flex-shrink-0" style={{ color: "var(--text3)" }}>
                Projected: {projectedValue}{unit}
              </span>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 transition-colors"
            style={{ background: saved ? "#16A34A" : "var(--teal)" }}
          >
            {saved ? "✓ Saved!" : saving ? "Saving…" : "Confirm Value"}
          </button>
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
  onSelectProjected,
}: {
  histData: WeekPoint[];
  projValues: number[];
  isRising: boolean;
  unit: string;
  yMax: number;
  onSelectProjected?: (week: string, value: number) => void;
}) {
  const lastHistWeek = histData.length > 0 ? histData[histData.length - 1].week : null;
  const today = todayWeekStr();
  const baseWeek = lastHistWeek || today;
  const projWeeks = projValues.map((_, i) => addWeeksToMonth(baseWeek, i + 1));

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
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 24, left: 28 }}>
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
}: {
  name: string;
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
  const prevValue = histData.length > 1 ? histData[histData.length - 2].avg : null;
  const delta =
    prevValue != null && currentValue != null
      ? Math.round((currentValue - prevValue) * 10) / 10
      : null;

  const [showSetStart, setShowSetStart] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ week: string; value: number } | null>(null);

  const goal = isRising ? 100 : 0;

  const projValues = useMemo(() => {
    if (histData.length === 0) return [];
    return buildProjection(
      histData.map((d) => d.avg),
      { baseline: histData[histData.length - 1].avg, goal, totalWeeks: null },
      nameIndex,
    );
  }, [histData, goal, nameIndex]);

  const yMax = useMemo(() => {
    if (isRising) return 100;
    const allVals = [...histData.map((d) => d.avg), ...projValues];
    return allVals.length > 0 ? Math.ceil(Math.max(...allVals) * 1.1) : 10;
  }, [histData, projValues, isRising]);

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
            <p className="text-[12px] italic" style={{ color: "var(--text3)" }}>No data yet</p>
          </div>
        ) : (
          <ProgressChart
            histData={histData}
            projValues={projValues}
            isRising={isRising}
            unit={unit}
            yMax={yMax}
            onSelectProjected={(week, value) => setPendingConfirm({ week, value })}
          />
        )}

        {/* Action */}
        {histData.length === 0 ? (
          <button
            onClick={() => setShowSetStart(true)}
            className="mt-3 w-full py-2.5 rounded-lg text-[13px] font-semibold text-white"
            style={{ background: "var(--teal)" }}
          >
            Set Starting Value
          </button>
        ) : (
          <p className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>
            Click any green dot to confirm the week&apos;s actual value.
          </p>
        )}
      </div>

      {showSetStart && (
        <SetStartingValueModal
          name={name}
          isReplacement={isRising}
          unit={unit}
          clientId={clientId}
          onSaved={onDataConfirmed}
          onClose={() => setShowSetStart(false)}
        />
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
    </div>
  );
}

// ── Main DataTab ────────────────────────────────────────────────────────────

export function DataTab({ client }: { client: any }) {
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
    const set = new Set<string>();
    Object.keys(maladByBehavior).forEach((n) => set.add(n));
    (client.clinicalProfile?.maladaptiveBehaviors || []).forEach((b: any) =>
      set.add(typeof b === "string" ? b : b.name),
    );
    return [...set].filter(Boolean);
  }, [maladByBehavior, client.clinicalProfile]);

  const skillNames: string[] = useMemo(() => {
    const set = new Set<string>();
    Object.keys(repBySkill).forEach((n) => set.add(n));
    [
      ...(client.clinicalProfile?.replacementBehaviors || []),
      ...(client.clinicalProfile?.skillAcquisition || []),
    ].forEach((s: any) => set.add(typeof s === "string" ? s : s.name));
    return [...set].filter(Boolean);
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
                />
              ))}
        </div>
      )}
    </div>
  );
}
