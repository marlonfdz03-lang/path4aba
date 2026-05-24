"use client";

import { type FieldworkType } from "@/lib/bcba-students/calculations";

interface Summary {
  id: string;
  month_year: string;
  total_independent_hours: number;
  total_supervised_hours: number;
  total_hours: number;
  supervision_pct: number;
  individual_contacts: number;
  group_contacts: number;
  client_observations: number;
  is_eligible: boolean;
  ineligibility_reason: string | null;
  mvf_signed: boolean;
}

interface Props {
  summaries: Summary[];
  fieldworkType: FieldworkType;
  onSelectMonth: (monthYear: string) => void;
}

function StatusBadge({ summary }: { summary: Summary }) {
  const now = new Date();
  const [y, m] = summary.month_year.split("-").map(Number);
  const isCurrentMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
  const isPast = new Date(y, m - 1, 1) < new Date(now.getFullYear(), now.getMonth(), 1);

  if (isCurrentMonth) {
    return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>🔄 In progress</span>;
  }
  if (summary.is_eligible) {
    return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#E6F9F5", color: "#065F46" }}>✅ Eligible</span>;
  }
  if (!isPast) {
    return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#FFF8E1", color: "#92400E" }}>⚠ At risk</span>;
  }
  return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#FEF2F2", color: "#DC2626" }}>❌ Ineligible</span>;
}

export default function MonthlyTable({ summaries, fieldworkType, onSelectMonth }: Props) {
  if (summaries.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text1)" }}>No months recorded yet</p>
        <p className="text-[13px]" style={{ color: "var(--text3)" }}>Log your first session to start tracking.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      {/* Header */}
      <div
        className="grid text-[11px] uppercase tracking-widest font-semibold px-5 py-3"
        style={{
          gridTemplateColumns: "140px 90px 90px 90px 80px 70px 70px auto",
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          color: "var(--text3)",
        }}
      >
        <span>Month</span>
        <span>Indep. hrs</span>
        <span>Sup. hrs</span>
        <span>Total hrs</span>
        <span>Sup. %</span>
        <span>Contacts</span>
        <span>M-FVF</span>
        <span>Status</span>
      </div>

      {summaries.map(s => {
        const monthLabel = new Date(s.month_year + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
        return (
          <button
            key={s.id}
            onClick={() => onSelectMonth(s.month_year)}
            className="grid w-full px-5 py-4 text-left transition-colors hover:bg-gray-50"
            style={{
              gridTemplateColumns: "140px 90px 90px 90px 80px 70px 70px auto",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{monthLabel}</span>
            <span className="text-[13px]" style={{ color: "var(--text2)" }}>{s.total_independent_hours.toFixed(1)}</span>
            <span className="text-[13px]" style={{ color: "var(--text2)" }}>{s.total_supervised_hours.toFixed(1)}</span>
            <span className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{s.total_hours.toFixed(1)}</span>
            <span className="text-[13px]" style={{ color: "var(--text2)" }}>{s.supervision_pct.toFixed(1)}%</span>
            <span className="text-[13px]" style={{ color: "var(--text2)" }}>
              {s.individual_contacts}i / {s.group_contacts}g
            </span>
            <span className="text-[13px]">
              {s.mvf_signed
                ? <span style={{ color: "#16A34A" }}>✓ Signed</span>
                : <span style={{ color: "var(--text3)" }}>—</span>
              }
            </span>
            <StatusBadge summary={s} />
          </button>
        );
      })}
    </div>
  );
}
