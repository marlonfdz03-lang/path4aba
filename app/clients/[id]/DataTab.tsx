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
    const d = new Date(week + "-01");
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
    const d = new Date(weekStr + "-01");
    d.setDate(d.getDate() + n * 7);
    return d.toISOString().substring(0, 7);
  } catch {
    return weekStr;
  }
}

function weeklyAvgs(records: any[], valueKey: string): WeekPoint[] {
  const map: Record<string, number[]> = {};
  records.forEach((r) => {
    const week = r.week_start || r.session_date?.substring(0, 7) || "?";
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
// Generates an irregular, organic-looking trend toward the goal.
// Rules enforced:
//   • No two consecutive weeks have the same change magnitude
//   • Never more than 3 consecutive weeks in the same direction
//   • Overall trend reaches goal in 12–16 weeks (3–4 months)
//   • nameIndex seeds the PRNG so every behavior has a unique pattern

function buildProjection(
  histValues: number[],
  sto: { baseline: number; goal: number; totalWeeks: number },
  nameIndex: number
): number[] {
  const start = histValues.length > 0 ? histValues[histValues.length - 1] : sto.baseline;
  const { goal } = sto;
  if (start === goal) return [];

  const rising = goal > start;
  const totalDist = Math.abs(goal - start);

  // 12–16 weeks, staggered by name so completions never land the same month
  const totalW = 12 + (Math.abs(nameIndex) % 5);
  const avgStep = totalDist / totalW;

  // Magnitude pool: multiples of avgStep — deliberately uneven
  const magPool = [0.6, 1.8, 0.4, 2.4, 1.0, 3.2, 0.5, 1.5, 0.8, 2.0, 1.3, 0.7];
  const seed = Math.abs(hashStr(String(nameIndex).padStart(4, "X")));
  const rng = mulberry32(seed);

  const out: number[] = [];
  let prev = start;
  let consecutiveDir = 0;
  let lastDir = 0;   // +1 or -1
  let lastMagIdx = -1;

  for (let w = 0; w < totalW; w++) {
    // Last week: snap to goal exactly
    if (w === totalW - 1) {
      out.push(Math.round(goal * 10) / 10);
      break;
    }

    const remaining = totalW - w;
    const distLeft = Math.abs(goal - prev);

    // Pick magnitude, never the same index twice in a row
    let magIdx = Math.floor(rng() * magPool.length);
    if (magIdx === lastMagIdx) magIdx = (magIdx + 1) % magPool.length;
    lastMagIdx = magIdx;
    const mag = magPool[magIdx] * avgStep;

    // Determine direction
    let dir: 1 | -1;
    if (consecutiveDir >= 3) {
      // Force a reversal
      dir = (-lastDir || 1) as 1 | -1;
    } else if (remaining <= 3 && distLeft > avgStep * 1.5) {
      // In last 3 weeks, force toward goal if still far
      dir = 1;
    } else {
      // 62% toward goal, 38% against — irregular but trending
      dir = rng() < 0.62 ? 1 : -1;
    }

    // Convert +1/-1 relative to goal into an absolute delta
    const delta = (rising ? 1 : -1) * dir * mag;
    let v = prev + delta;

    // Soft boundary: don't wander more than 15% of totalDist past the start
    const slack = totalDist * 0.15;
    if (rising) v = Math.max(start - slack, Math.min(goal, v));
    else v = Math.min(start + slack, Math.max(goal, v));

    // Track consecutive direction
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

// ── ProgressChart (recharts) ────────────────────────────────────────────────

function ProgressChart({
  histData,
  projValues,
  baselineValue,
  goalValue,
  isRising,
  unit,
  onConfirmProjected,
}: {
  histData: WeekPoint[];
  projValues: number[];
  baselineValue?: number;
  goalValue?: number;
  isRising: boolean;
  unit: string;
  onConfirmProjected?: (week: string, value: number) => void;
}) {
  const [pendingConfirm, setPendingConfirm] = useState<{ week: string; value: number } | null>(null);
  const [confirmInput, setConfirmInput] = useState("");

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
        onClick={() => {
          setPendingConfirm({ week: payload.week, value: payload.projected });
          setConfirmInput(String(payload.projected));
        }}
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

          {/* Baseline red dot */}
          {baselineValue != null && histData.length > 0 && (
            <ReferenceDot
              x={histData[0].week}
              y={baselineValue}
              r={5}
              fill="#EF4444"
              stroke="white"
              strokeWidth={2}
              label={{
                value: `Baseline ${baselineValue}${unit}`,
                position: "insideTopRight",
                fontSize: 9,
                fill: "#EF4444",
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

      {/* Inline confirm popover */}
      {pendingConfirm && (
        <div
          className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px]"
          style={{ background: "#F0FDF4", borderColor: "#86EFAC" }}
        >
          <span style={{ color: "#166534" }}>
            Confirm actual value for {fmtWeek(pendingConfirm.week)}:
          </span>
          <input
            type="number"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            className="w-20 border rounded px-2 py-1 text-[12px]"
            style={{ borderColor: "#86EFAC", color: "#166534" }}
          />
          <span className="text-[11px]" style={{ color: "#166534" }}>{unit}</span>
          <button
            onClick={() => {
              const v = parseFloat(confirmInput);
              if (!isNaN(v)) onConfirmProjected?.(pendingConfirm.week, v);
              setPendingConfirm(null);
            }}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold text-white"
            style={{ background: "#16A34A" }}
          >
            Save
          </button>
          <button
            onClick={() => setPendingConfirm(null)}
            className="text-[11px]"
            style={{ color: "var(--text3)" }}
          >
            Cancel
          </button>
        </div>
      )}
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

  async function handleConfirmProjected(week: string, value: number) {
    const endpoint = isRising ? "/api/replacement-data" : "/api/maladaptive-data";
    const body = isRising
      ? { clientId, replacementSkill: name, weekStart: week, observedPercentage: value, totalTrials: 10, userConfirmed: true }
      : { clientId, behaviorName: name, weekStart: week, frequency: Math.round(value), userConfirmed: true };
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onDataConfirmed();
  }

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
          onConfirmProjected={handleConfirmProjected}
        />

        {histData.length === 0 && stoList.length === 0 && (
          <p className="text-[12px] mt-2 italic" style={{ color: "var(--text3)" }}>
            No data recorded yet.
          </p>
        )}
      </div>
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
