"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
// ── Helpers ──────────────────────────────────────────────────────────────────

function trendIcon(trend: string) {
  if (trend === "improving") return "↓";
  if (trend === "worsening") return "↑";
  if (trend === "stable") return "→";
  return "—";
}

function trendColor(trend: string) {
  if (trend === "improving") return "#16A34A";
  if (trend === "worsening") return "#DC2626";
  if (trend === "stable") return "#64748B";
  return "#D97706";
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    "improving":         { bg: "#DCFCE7", color: "#16A34A", label: "🟢 Improving" },
    "stable":            { bg: "#F1F5F9", color: "#64748B", label: "→ Stable" },
    "worsening":         { bg: "#FEE2E2", color: "#DC2626", label: "🔴 Worsening" },
    "insufficient_data": { bg: "#FEF3C7", color: "#D97706", label: "⚠ Insufficient Data" },
    "On Track":          { bg: "#DCFCE7", color: "#16A34A", label: "🟢 On Track" },
    "Needs Attention":   { bg: "#FEE2E2", color: "#DC2626", label: "🔴 Needs Attention" },
    "Mastered":          { bg: "#EEF2FF", color: "#3730A3", label: "⭐ Mastered" },
    "Insufficient Data": { bg: "#FEF3C7", color: "#D97706", label: "⚠ Insufficient Data" },
  };
  const s = map[status] ?? map["insufficient_data"];
  return (
    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function ProgressBar({ value, color = "#2563EB" }: { value: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full" style={{ background: "#E5E7EB" }}>
      <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <p className="text-[11px] uppercase tracking-widest font-semibold whitespace-nowrap" style={{ color: "var(--text3)" }}>{title}</p>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProgressReportPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [clientName, setClientName] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [generating, setGenerating] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [behaviorTrends, setBehaviorTrends] = useState<any[]>([]);
  const [skillTrends, setSkillTrends] = useState<any[]>([]);
  const [goalProgress, setGoalProgress] = useState<any[]>([]);
  const [previousReports, setPreviousReports] = useState<any[]>([]);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [clinicalProfile, setClinicalProfile] = useState<any>(null);
  const [serviceUtilization, setServiceUtilization] = useState<any>(null);
  const [behaviorWeeklyTable, setBehaviorWeeklyTable] = useState<any>({});
  const [skillWeeklyTable, setSkillWeeklyTable] = useState<any>({});
  const [activeTreatmentAreas, setActiveTreatmentAreas] = useState<any>(null);
  const [clinicalBarriers, setClinicalBarriers] = useState<string[]>([]);
  const narrativeRef = useRef("");
  const [showReassessment, setShowReassessment] = useState(false);
  const [reassessStart, setReassessStart] = useState("");
  const [reassessEnd, setReassessEnd] = useState("");
  const [reassessSummary, setReassessSummary] = useState("");
  const [reassessGenerating, setReassessGenerating] = useState(false);
  const [reassessError, setReassessError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("path4aba_clients");
    if (stored) {
      const clients = JSON.parse(stored);
      const client = clients.find((c: any) => c.id === clientId);
      if (client) {
        setClientName(client.client_name || client.internal_code || "Client");
        setClinicalProfile(client.clinical_profile || null);
      }
    }
    fetchPreviousReports();
  }, [clientId]);

  async function fetchPreviousReports() {
    try {
      const res = await fetch(`/api/progress-report?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setPreviousReports(data.reports || []);
      }
    } catch {}
  }

  async function handleGenerate() {
    const [year, month] = selectedMonth.split("-").map(Number);
    const periodStart = new Date(year, month - 1, 1).toISOString().split("T")[0];
    const periodEnd = new Date(year, month, 0).toISOString().split("T")[0];
    const periodLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

    setGenerating(true);
    setNarrative("");
    setBehaviorTrends([]);
    setSkillTrends([]);
    setGoalProgress([]);
    setStatus("Analyzing clinical data…");
    narrativeRef.current = "";

    try {
      const res = await fetch("/api/progress-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart, periodEnd, periodLabel }),
      });
      if (!res.ok || !res.body) { setStatus("Generation failed."); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__META__")) {
          const [text, metaStr] = chunk.split("__META__");
          if (text) { narrativeRef.current += text; setNarrative(narrativeRef.current); }
          try {
            const meta = JSON.parse(metaStr);
            if (meta.behaviorTrends) setBehaviorTrends(meta.behaviorTrends);
            if (meta.skillTrends) setSkillTrends(meta.skillTrends);
            if (meta.goalProgress) setGoalProgress(meta.goalProgress);
            if (meta.serviceUtilization) setServiceUtilization(meta.serviceUtilization);
            if (meta.behaviorWeeklyTable) setBehaviorWeeklyTable(meta.behaviorWeeklyTable);
            if (meta.skillWeeklyTable) setSkillWeeklyTable(meta.skillWeeklyTable);
            if (meta.activeTreatmentAreas) setActiveTreatmentAreas(meta.activeTreatmentAreas);
            if (meta.clinicalBarriers) setClinicalBarriers(meta.clinicalBarriers);
            if (meta.error) setStatus(meta.error);
          } catch {}
        } else {
          narrativeRef.current += chunk;
          setNarrative(narrativeRef.current);
          setStatus("Generating clinical narrative…");
        }
      }
      setStatus("");
      fetchPreviousReports();
    } catch { setStatus("Network error. Please try again."); }
    finally { setGenerating(false); }
  }

  async function handleGenerateReassessment() {
    if (!reassessStart || !reassessEnd) return;
    setReassessGenerating(true);
    setReassessSummary("");
    setReassessError("");
    try {
      const res = await fetch("/api/progress-report/reassessment-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart: reassessStart, periodEnd: reassessEnd }),
      });
      if (!res.ok || !res.body) { setReassessError("Generation failed."); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__REASSESS_META__")) {
          const [narrative] = chunk.split("__REASSESS_META__");
          if (narrative) text += narrative;
        } else {
          text += chunk;
        }
        setReassessSummary(text);
      }
    } catch { setReassessError("Network error. Please try again."); }
    finally { setReassessGenerating(false); }
  }

  // ── Derived summary stats ──
  const improving = behaviorTrends.filter(b => b.trend === "improving").length;
  const worsening = behaviorTrends.filter(b => b.trend === "worsening").length;
  const skillsImproving = skillTrends.filter(s => s.trend === "improving").length;
  // Get intervention names from clinical profile
  const interventionMap: Record<string, string> = {};
  if (clinicalProfile?.interventions) {
    clinicalProfile.interventions.forEach((i: any) => {
      const name = typeof i === "string" ? i : i?.name || "";
      if (name) interventionMap[name.toLowerCase()] = name;
    });
  }

  // Match behavior to its intervention from clinical profile
  function getBehaviorIntervention(behaviorName: string): string {
    const profile = clinicalProfile?.maladaptiveBehaviors?.find((b: any) =>
      (typeof b === "string" ? b : b?.name || "").toLowerCase() === behaviorName.toLowerCase()
    );
    if (!profile || typeof profile === "string") return "Per treatment plan";
    return (clinicalProfile?.interventions || []).slice(0, 2).map((i: any) => typeof i === "string" ? i : i?.name || "").filter(Boolean).join(", ") || "Per treatment plan";
  }

  function getBehaviorFunction(behaviorName: string): string {
    const profile = clinicalProfile?.maladaptiveBehaviors?.find((b: any) =>
      (typeof b === "string" ? b : b?.name || "").toLowerCase() === behaviorName.toLowerCase()
    );
    if (!profile || typeof profile === "string") return "—";
    const funcs = profile.functions || profile.function || [];
    return Array.isArray(funcs) ? funcs.join(", ") : funcs || "—";
  }

  const hasData = behaviorTrends.length > 0 || skillTrends.length > 0 || goalProgress.length > 0;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <style>{`
        @media print {
          nav, header, button, .no-print { display: none !important; }
          body { background: white !important; }
          .print-content { padding: 0 !important; }
        }
      `}</style>
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ background: "white", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <Link href={`/clients/${clientId}`} className="text-[13px] hover:opacity-70" style={{ color: "var(--text3)" }}>← Back</Link>
          <div className="w-px h-4" style={{ background: "var(--border)" }} />
          <div>
            <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Monthly Progress Report</p>
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>{clientName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-[13px]"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          />
          <button
            onClick={handleGenerate} disabled={generating}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--primary, #2563EB)" }}
          >
            {generating ? "Generating…" : "Generate Report"}
          </button>
          {hasData && (
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold border hover:opacity-80 transition-opacity"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            >
              ↓ Save as PDF
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {status && (
          <div className="px-4 py-3 rounded-xl text-[13px]" style={{ background: "#EFF6FF", color: "#1E40AF" }}>
            {status}
          </div>
        )}

        {hasData && (
          <>
            {/* Executive Summary Cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Behaviors Improved", value: improving, color: "#16A34A", bg: "#DCFCE7" },
                { label: "Behaviors Need Attention", value: worsening, color: "#DC2626", bg: "#FEE2E2" },
                { label: "Skills Improving", value: skillsImproving, color: "#2563EB", bg: "#EFF6FF" },
              ].map(card => (
                <div key={card.label} className="rounded-xl p-4 text-center" style={{ background: card.bg }}>
                  <p className="text-[28px] font-bold" style={{ color: card.color }}>{card.value}</p>
                  <p className="text-[11px] font-semibold mt-1" style={{ color: card.color }}>{card.label}</p>
                </div>
              ))}
            </div>

            {/* Service Utilization */}
            {serviceUtilization && (
              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Service Utilization" />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
                  {[
                    { label: "Authorized Hours", value: serviceUtilization.authorizedHoursTotal > 0 ? `${serviceUtilization.authorizedHoursTotal}h` : "—" },
                    { label: "Delivered Hours", value: serviceUtilization.deliveredHours > 0 ? `${serviceUtilization.deliveredHours}h` : "—" },
                    { label: "Missed Hours", value: serviceUtilization.missedHoursTotal > 0 ? `${serviceUtilization.missedHoursTotal}h` : "0h" },
                    { label: "Attendance Rate", value: serviceUtilization.attendanceRate !== null ? `${serviceUtilization.attendanceRate}%` : "—" },
                  ].map(item => (
                    <div key={item.label} className="text-center p-3 rounded-xl" style={{ background: "var(--bg)" }}>
                      <p className="text-[20px] font-bold" style={{ color: "var(--text1)" }}>{item.value}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>{item.label}</p>
                    </div>
                  ))}
                </div>
                {Object.keys(serviceUtilization.missedReasons || {}).length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text3)" }}>Missed Session Reasons</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(serviceUtilization.missedReasons).map(([reason, count]: [string, any]) => (
                        <span key={reason} className="text-[12px] px-3 py-1 rounded-full border" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                          {reason} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {serviceUtilization.missedHoursTotal > 0 && (
                  <div className="mt-3 px-4 py-2.5 rounded-lg" style={{ background: "#FEF3C7", border: "1px solid #FCD34D" }}>
                    <p className="text-[12px]" style={{ color: "#92400E" }}>
                      The client missed {serviceUtilization.missedHoursTotal} authorized treatment hours during the reporting period. Reduced treatment exposure may have limited opportunities for skill acquisition, maintenance, and generalization. Consistent service delivery remains necessary to support continued progress.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Medical Necessity Indicators */}
            <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
              <SectionHeader title="Medical Necessity Indicators" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  "Active behavior reduction targets",
                  "Active skill acquisition targets",
                  "Generalization needs across settings",
                  "Multiple caregivers involved",
                  "Ongoing BCBA supervision required",
                  "Individual clinical need — not age-based",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: "#065F46" }}>
                    <span style={{ color: "#16A34A", fontWeight: 700 }}>✓</span>
                    <span>{item}</span>
                  </div>
                ))}
                {worsening > 0 && (
                  <div className="flex items-center gap-2 text-[12px]" style={{ color: "#991B1B" }}>
                    <span style={{ color: "#DC2626", fontWeight: 700 }}>⚠</span>
                    <span>Safety concerns present — behaviors worsening</span>
                  </div>
                )}
              </div>
              <div className="mt-3 px-4 py-2.5 rounded-lg" style={{ background: "#F0FDF4", border: "1px solid #A7F3D0" }}>
                <p className="text-[12px] font-semibold" style={{ color: "#065F46" }}>
                  ✓ Continued ABA services at the current authorized intensity remain clinically indicated based on the client's active behavioral profile and ongoing acquisition needs.
                </p>
              </div>
            </div>

            {/* Maladaptive Behaviors Table */}
            {Object.keys(behaviorWeeklyTable).length === 0 && hasData && (
              <div className="bg-white rounded-xl border p-6 text-center" style={{ borderColor: "var(--border)" }}>
                <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>No behavior data yet</p>
                <p className="text-[12px]" style={{ color: "var(--text3)" }}>Data will appear here as you log sessions in the Data tab.</p>
              </div>
            )}
            {Object.keys(behaviorWeeklyTable).length > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#FEF2F2" }}>
                  <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#991B1B" }}>Maladaptive Behavior Summary</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        {["Behavior", "Baseline", "Week 1", "Week 2", "Week 3", "Week 4", "Monthly Avg"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(behaviorWeeklyTable).map(([name, data]: [string, any], i) => (
                        <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                          <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{name}</td>
                          <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text3)" }}>—</td>
                          {data.weeks.map((w: number | null, wi: number) => (
                            <td key={wi} className="px-4 py-3 text-[12px]" style={{ color: w !== null ? "var(--text1)" : "var(--text3)" }}>
                              {w !== null ? w : "—"}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-[12px] font-semibold" style={{ color: "var(--teal, #0D9488)" }}>
                            {data.monthlyAvg !== null ? data.monthlyAvg : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Replacement Skills Table */}
            {Object.keys(skillWeeklyTable).length === 0 && hasData && (
              <div className="bg-white rounded-xl border p-6 text-center" style={{ borderColor: "var(--border)" }}>
                <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>No skill data yet</p>
                <p className="text-[12px]" style={{ color: "var(--text3)" }}>Data will appear here as you log sessions in the Data tab.</p>
              </div>
            )}
            {Object.keys(skillWeeklyTable).length > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#F0FDF4" }}>
                  <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#065F46" }}>Replacement Skill Summary</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        {["Skill", "Baseline", "Week 1", "Week 2", "Week 3", "Week 4", "Monthly Avg"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(skillWeeklyTable).map(([name, data]: [string, any], i) => (
                        <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                          <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{name}</td>
                          <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text3)" }}>—</td>
                          {data.weeks.map((w: number | null, wi: number) => (
                            <td key={wi} className="px-4 py-3 text-[12px]" style={{ color: w !== null ? "var(--text1)" : "var(--text3)" }}>
                              {w !== null ? `${w}%` : "—"}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-[12px] font-semibold" style={{ color: "var(--teal, #0D9488)" }}>
                            {data.monthlyAvg !== null ? `${data.monthlyAvg}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Active Treatment Areas */}
            {activeTreatmentAreas && (
              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Active Treatment Areas" />
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    { label: "Behavior Reduction Targets", items: activeTreatmentAreas.behaviorReductionTargets },
                    { label: "Replacement Programs", items: activeTreatmentAreas.replacementPrograms },
                    { label: "Interventions Used", items: activeTreatmentAreas.frequentlyUsedInterventions },
                  ].map(col => (
                    <div key={col.label}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text3)" }}>{col.label}</p>
                      {col.items?.length > 0 ? col.items.map((item: string, i: number) => (
                        <p key={i} className="text-[12px] py-0.5" style={{ color: "var(--text2)" }}>• {item}</p>
                      )) : <p className="text-[12px]" style={{ color: "var(--text3)" }}>None documented</p>}
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t flex gap-6" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[12px]" style={{ color: "var(--text3)" }}>RBT Sessions: <span className="font-semibold" style={{ color: "var(--text1)" }}>{activeTreatmentAreas.rbtSessionCount}</span></p>
                  {activeTreatmentAreas.bcbaSessionCount > 0 && (
                    <p className="text-[12px]" style={{ color: "var(--text3)" }}>BCBA Sessions: <span className="font-semibold" style={{ color: "var(--text1)" }}>{activeTreatmentAreas.bcbaSessionCount}</span></p>
                  )}
                </div>
              </div>
            )}

            {/* Clinical Barriers */}
            {clinicalBarriers.length > 0 && (
              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Clinical Barriers" />
                <div className="space-y-1.5">
                  {clinicalBarriers.map((barrier, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text2)" }}>
                      <span style={{ color: "#D97706" }}>•</span>
                      <span>{barrier}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Environmental Impact */}
            {(behaviorTrends.length > 0 || skillTrends.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Most Common Triggers" />
                  <div className="space-y-1.5">
                    {["Transitions between activities", "Non-preferred task demands", "Denied access to preferred items", "Waiting requirements", "Changes in routine"].map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text2)" }}>
                        <span style={{ color: "#DC2626" }}>•</span><span>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Most Successful Supports" />
                  <div className="space-y-1.5">
                    {(clinicalProfile?.interventions || []).slice(0, 5).map((i: any, idx: number) => {
                      const name = typeof i === "string" ? i : i?.name || "";
                      return name ? (
                        <div key={idx} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text2)" }}>
                          <span style={{ color: "#16A34A" }}>✓</span><span>{name}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Clinical Priorities & Strengths */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Clinical Priorities Next Month" />
                <div className="space-y-2">
                  {[
                    ...behaviorTrends.filter(b => b.trend === "worsening").map(b => ({ label: b.name, reason: "Requires immediate attention", color: "#DC2626", icon: "🔴" })),
                    ...skillTrends.filter(s => s.trend === "worsening" || s.trend === "stable").slice(0, 2).map(s => ({ label: s.name, reason: "Needs increased teaching opportunities", color: "#D97706", icon: "🟡" })),
                    ...behaviorTrends.filter(b => b.trend === "improving").slice(0, 1).map(b => ({ label: b.name, reason: "Monitor for maintenance and generalization", color: "#2563EB", icon: "🔵" })),
                  ].slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span>{item.icon}</span>
                      <div>
                        <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{item.label}</p>
                        <p className="text-[11px]" style={{ color: "var(--text3)" }}>{item.reason}</p>
                      </div>
                    </div>
                  ))}
                  {behaviorTrends.filter(b => b.trend === "worsening").length === 0 &&
                   skillTrends.filter(s => s.trend !== "improving").length === 0 && (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>Maintain current programming intensity.</p>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Strengths This Month" />
                <div className="space-y-2">
                  {[
                    ...behaviorTrends.filter(b => b.trend === "improving").map(b => ({ label: b.name, note: "Behavior reducing with intervention", icon: "🟢" })),
                    ...skillTrends.filter(s => s.trend === "improving").map(s => ({ label: s.name, note: `Avg ${s.avgPercentage.toFixed(0)}% accuracy`, icon: "✓" })),
                  ].slice(0, 6).map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span style={{ color: "#16A34A" }}>{item.icon}</span>
                      <div>
                        <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{item.label}</p>
                        <p className="text-[11px]" style={{ color: "var(--text3)" }}>{item.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Medical Necessity Narrative */}
            {narrative && (
              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Clinical Narrative & Medical Necessity" />
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{narrative}</p>
              </div>
            )}
          </>
        )}

        {/* Previous Reports */}
        {previousReports.length > 0 && (
          <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <SectionHeader title="Previous Reports" />
            </div>
            {previousReports.map(report => (
              <div key={report.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <div className="px-5 py-3 flex items-center justify-between">
                  <button
                    onClick={() => setExpandedReport(expandedReport === report.id ? null : report.id)}
                    className="text-[13px] font-medium text-left hover:opacity-70"
                    style={{ color: "var(--text1)" }}
                  >
                    {report.period_label}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const [year, month] = report.period_start.split("-");
                        setSelectedMonth(`${year}-${month}`);
                        handleGenerate();
                      }}
                      className="text-[11px] px-3 py-1 rounded-lg border font-medium hover:opacity-70"
                      style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                    >
                      Update Report
                    </button>
                    <span className="text-[12px]" style={{ color: "var(--text3)" }}>
                      {expandedReport === report.id ? "▲" : "▼"}
                    </span>
                  </div>
                </div>
                {expandedReport === report.id && (
                  <div className="px-5 pb-5">
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{report.narrative}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Reassessment Summary Tool */}
        <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setShowReassessment(!showReassessment)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>📋 Create Reassessment Summary</p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>Generate a clinical summary for a custom period to include in your reassessment</p>
            </div>
            <span style={{ color: "var(--text3)" }}>{showReassessment ? "▲" : "▼"}</span>
          </button>
          {showReassessment && (
            <div className="px-5 pb-5 border-t" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-3 mt-4 mb-4">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "var(--text3)" }}>Start Date</label>
                  <input type="date" value={reassessStart} onChange={e => setReassessStart(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "var(--text3)" }}>End Date</label>
                  <input type="date" value={reassessEnd} onChange={e => setReassessEnd(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                </div>
                <div className="pt-5">
                  <button
                    onClick={handleGenerateReassessment}
                    disabled={!reassessStart || !reassessEnd || reassessGenerating}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--primary, #2563EB)" }}
                  >
                    {reassessGenerating ? "Generating…" : "Generate Summary"}
                  </button>
                </div>
              </div>
              {reassessError && <p className="text-[12px] px-3 py-2 rounded-lg mb-3" style={{ background: "#fef2f2", color: "#991b1b" }}>{reassessError}</p>}
              {reassessSummary && (
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-semibold" style={{ color: "var(--text3)" }}>
                      Reassessment Summary · {reassessStart} to {reassessEnd}
                    </p>
                    <button
                      onClick={() => { navigator.clipboard.writeText(reassessSummary); setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }}
                      className="text-[12px] px-3 py-1 rounded-lg border hover:opacity-70 transition-colors"
                      style={{ borderColor: summaryCopied ? "#16A34A" : "var(--border)", color: summaryCopied ? "#16A34A" : "var(--text2)" }}
                    >
                      {summaryCopied ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{reassessSummary}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
