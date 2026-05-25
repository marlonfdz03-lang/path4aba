"use client";

import { BACB_RULES, estimatedCompletion, type FieldworkType, type CertificationTrack } from "@/lib/bcba-students/calculations";

interface Props {
  totalHours: number;
  supervisedHours: number;
  supervisionPct: number;
  fieldworkType: FieldworkType;
  certificationTrack: CertificationTrack;
  monthsActive: number;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
      <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--text3)" }}>{label}</p>
      <p className="text-[24px] font-semibold" style={{ color: "var(--text1)" }}>{value}</p>
      {sub && <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>{sub}</p>}
    </div>
  );
}

export default function DashboardMetrics({ totalHours, supervisedHours, supervisionPct, fieldworkType, certificationTrack, monthsActive }: Props) {
  const rules = BACB_RULES[certificationTrack][fieldworkType];
  const remaining = Math.max(0, rules.totalHoursRequired - totalHours);
  const estDate = estimatedCompletion(totalHours, rules.totalHoursRequired, monthsActive);
  const estLabel = estDate
    ? estDate <= new Date()
      ? "Complete!"
      : estDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "—";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        label="Total Hours"
        value={`${totalHours.toFixed(1)} / ${rules.totalHoursRequired}`}
        sub={`${((totalHours / rules.totalHoursRequired) * 100).toFixed(1)}% complete`}
      />
      <MetricCard
        label="Supervised Hours"
        value={`${supervisedHours.toFixed(1)} hrs`}
        sub={`${supervisionPct.toFixed(1)}% supervision`}
      />
      <MetricCard
        label="Hours Remaining"
        value={`${remaining.toFixed(1)} hrs`}
        sub={`of ${rules.totalHoursRequired} required`}
      />
      <MetricCard
        label="Est. Completion"
        value={estLabel}
        sub={monthsActive > 0 ? `${(totalHours / monthsActive).toFixed(1)} hrs/mo avg` : "Log sessions to estimate"}
      />
    </div>
  );
}
