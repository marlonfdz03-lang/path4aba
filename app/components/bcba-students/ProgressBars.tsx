"use client";

import { BACB_RULES, type FieldworkType, type CertificationTrack } from "@/lib/bcba-students/calculations";

interface Props {
  totalHours: number;
  fieldworkType: FieldworkType;
  certificationTrack: CertificationTrack;
  cumulativeUnrestrictedPct: number;
  thisMonthSupervisionPct: number;
}

function Bar({ label, pct, min, color, warning }: { label: string; pct: number; min?: number; color: string; warning?: boolean }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[13px] font-medium" style={{ color: "var(--text2)" }}>{label}</p>
        <span className="text-[13px] font-semibold" style={{ color: warning ? "#DC2626" : "var(--text1)" }}>
          {pct.toFixed(1)}%{min !== undefined && <span className="text-[11px] font-normal ml-1" style={{ color: "var(--text3)" }}>min {min}%</span>}
        </span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, background: warning ? "#DC2626" : color }}
        />
      </div>
    </div>
  );
}

export default function ProgressBars({ totalHours, fieldworkType, certificationTrack, cumulativeUnrestrictedPct, thisMonthSupervisionPct }: Props) {
  const rules = BACB_RULES[certificationTrack][fieldworkType];
  const overallPct = (totalHours / rules.totalHoursRequired) * 100;
  const unrestrictedMin = BACB_RULES.shared.unrestrictedPctMin;
  const supervisionMin = rules.supervisionPctMin;

  return (
    <div className="bg-white rounded-xl p-6 space-y-5" style={{ border: "1px solid var(--border)" }}>
      <p className="text-[13px] font-semibold mb-4" style={{ color: "var(--text1)" }}>Progress Overview</p>
      <Bar
        label="Overall Fieldwork Progress"
        pct={overallPct}
        color="linear-gradient(90deg, var(--teal), var(--sky))"
      />
      <Bar
        label="Cumulative Unrestricted Hours %"
        pct={cumulativeUnrestrictedPct}
        min={unrestrictedMin}
        color="var(--teal)"
        warning={cumulativeUnrestrictedPct < unrestrictedMin && totalHours > 0}
      />
      <Bar
        label="This Month's Supervision %"
        pct={thisMonthSupervisionPct}
        min={supervisionMin}
        color="#8B5CF6"
        warning={thisMonthSupervisionPct < supervisionMin && thisMonthSupervisionPct > 0}
      />
    </div>
  );
}
