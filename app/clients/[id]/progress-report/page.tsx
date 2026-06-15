"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PDFDownloadLink } from '@react-pdf/renderer';
import { ProgressReportPDF } from './ProgressReportPDF';

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
  const [clinicalProfile, setClinicalProfile] = useState<any>(null);
  const narrativeRef = useRef("");

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

  // ── Derived summary stats ──
  const improving = behaviorTrends.filter(b => b.trend === "improving").length;
  const worsening = behaviorTrends.filter(b => b.trend === "worsening").length;
  const skillsImproving = skillTrends.filter(s => s.trend === "improving").length;
  const mastered = goalProgress.filter(g => g.goalStatus === "Mastered").length;
  const needsAttention = goalProgress.filter(g => g.goalStatus === "Needs Attention").length;
  const onTrack = goalProgress.filter(g => g.goalStatus === "On Track").length;

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
            <PDFDownloadLink
              document={
                <ProgressReportPDF
                  clientCode={clientName}
                  periodLabel={selectedMonth}
                  generatedAt={new Date().toLocaleDateString()}
                  behaviorTrends={behaviorTrends}
                  skillTrends={skillTrends}
                  goalProgress={goalProgress}
                  narrative={narrative}
                  clinicalProfile={clinicalProfile}
                />
              }
              fileName={`progress-report-${clientName}-${selectedMonth}.pdf`}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold border hover:opacity-80 transition-opacity"
              style={{ borderColor: "var(--border)", color: "var(--text1)", textDecoration: 'none' }}
            >
              {({ loading }) => loading ? 'Preparing PDF…' : '↓ Download PDF'}
            </PDFDownloadLink>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Behaviors Improved", value: improving, color: "#16A34A", bg: "#DCFCE7" },
                { label: "Behaviors Need Attention", value: worsening, color: "#DC2626", bg: "#FEE2E2" },
                { label: "Skills Improving", value: skillsImproving, color: "#2563EB", bg: "#EFF6FF" },
                { label: "Goals Mastered", value: mastered, color: "#7C3AED", bg: "#EEF2FF" },
              ].map(card => (
                <div key={card.label} className="rounded-xl p-4 text-center" style={{ background: card.bg }}>
                  <p className="text-[28px] font-bold" style={{ color: card.color }}>{card.value}</p>
                  <p className="text-[11px] font-semibold mt-1" style={{ color: card.color }}>{card.label}</p>
                </div>
              ))}
            </div>

            {/* Service Justification Banner */}
            <div className="rounded-xl px-5 py-4" style={{ background: "#F0FDF4", border: "1px solid #A7F3D0" }}>
              <p className="text-[13px] font-semibold" style={{ color: "#065F46" }}>✓ Continued ABA services remain clinically indicated at the current authorized intensity.</p>
              <p className="text-[12px] mt-1" style={{ color: "#047857" }}>Service needs are determined by individual behavioral profile, not age-based criteria.</p>
            </div>

            {/* Maladaptive Behaviors Table */}
            {behaviorTrends.length > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Maladaptive Behaviors" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        {["Behavior", "Function", "Intervention", "Baseline", "Current", "Trend", "Status"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {behaviorTrends.map((b, i) => (
                        <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                          <td className="px-4 py-3 font-medium" style={{ color: "var(--text1)" }}>{b.name}</td>
                          <td className="px-4 py-3 capitalize text-[12px]" style={{ color: "var(--text2)" }}>{getBehaviorFunction(b.name) || "—"}</td>
                          <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text2)" }}>{getBehaviorIntervention(b.name)}</td>
                          <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text3)" }}>
                            {b.weeklyFrequencies?.length > 0 ? `${b.weeklyFrequencies[0]}/wk` : "—"}
                          </td>
                          <td className="px-4 py-3 text-[12px] font-semibold" style={{ color: "var(--text1)" }}>
                            {b.weeklyFrequencies?.length > 0 ? `${b.weeklyFrequencies[b.weeklyFrequencies.length - 1]}/wk` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-[16px]" style={{ color: trendColor(b.trend) }}>{trendIcon(b.trend)}</span>
                            {b.changePercent !== null && (
                              <span className="text-[11px] ml-1" style={{ color: trendColor(b.trend) }}>
                                {b.changePercent > 0 ? "+" : ""}{Math.abs(b.changePercent).toFixed(0)}%
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3"><StatusPill status={b.trend} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Replacement Skills Table */}
            {skillTrends.length > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Replacement Skills" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        {["Skill", "Baseline", "Current", "Goal", "Trend", "Status"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {skillTrends.map((s, i) => (
                        <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                          <td className="px-4 py-3 font-medium" style={{ color: "var(--text1)" }}>{s.name}</td>
                          <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text3)" }}>
                            {s.weeklyPercentages?.length > 0 ? `${s.weeklyPercentages[0].toFixed(0)}%` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16"><ProgressBar value={s.avgPercentage} color={trendColor(s.trend)} /></div>
                              <span className="text-[12px] font-semibold" style={{ color: trendColor(s.trend) }}>{s.avgPercentage.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text3)" }}>
                            {goalProgress.find(g => g.targetName === s.name)?.goalValue != null
                              ? `${goalProgress.find(g => g.targetName === s.name)?.goalValue}%`
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-[16px]" style={{ color: trendColor(s.trend) }}>{trendIcon(s.trend)}</span>
                            {s.changePercent !== null && (
                              <span className="text-[11px] ml-1" style={{ color: trendColor(s.trend) }}>
                                {s.changePercent > 0 ? "+" : ""}{Math.abs(s.changePercent).toFixed(0)}%
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3"><StatusPill status={s.trend} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Goal Progress */}
            {goalProgress.length > 0 && (
              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Goal Progress" />
                <div className="grid gap-4 sm:grid-cols-2">
                  {goalProgress.map((g, i) => (
                    <div key={i} className="p-4 rounded-xl border" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{g.targetName}</p>
                        <StatusPill status={g.goalStatus} />
                      </div>
                      {g.percentToGoal !== null && (
                        <>
                          <ProgressBar
                            value={g.percentToGoal}
                            color={g.goalStatus === "Mastered" ? "#7C3AED" : g.goalStatus === "On Track" ? "#16A34A" : g.goalStatus === "Needs Attention" ? "#DC2626" : "#D97706"}
                          />
                          <p className="text-[11px] mt-1.5" style={{ color: "var(--text3)" }}>{g.percentToGoal.toFixed(0)}% to goal</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical Priorities */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Focus Areas Next Month" />
                <div className="space-y-2">
                  {behaviorTrends.filter(b => b.trend === "worsening").map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span style={{ color: "#DC2626" }}>🔴</span>
                      <span style={{ color: "var(--text1)" }}>{b.name} — Requires attention</span>
                    </div>
                  ))}
                  {skillTrends.filter(s => s.trend === "worsening" || s.trend === "stable").slice(0, 2).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span style={{ color: "#D97706" }}>🟡</span>
                      <span style={{ color: "var(--text1)" }}>{s.name} — Needs more practice</span>
                    </div>
                  ))}
                  {goalProgress.filter(g => g.goalStatus === "Needs Attention").map((g, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span style={{ color: "#D97706" }}>⚠</span>
                      <span style={{ color: "var(--text1)" }}>{g.targetName} goal needs review</span>
                    </div>
                  ))}
                  {(behaviorTrends.filter(b => b.trend === "worsening").length === 0 &&
                    skillTrends.filter(s => s.trend !== "improving").length === 0 &&
                    goalProgress.filter(g => g.goalStatus === "Needs Attention").length === 0) && (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>No critical areas identified. Maintain current programming.</p>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Strengths This Month" />
                <div className="space-y-2">
                  {behaviorTrends.filter(b => b.trend === "improving").map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span style={{ color: "#16A34A" }}>🟢</span>
                      <span style={{ color: "var(--text1)" }}>{b.name} — Improving</span>
                    </div>
                  ))}
                  {skillTrends.filter(s => s.trend === "improving").map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span style={{ color: "#16A34A" }}>✓</span>
                      <span style={{ color: "var(--text1)" }}>{s.name} — Progressing</span>
                    </div>
                  ))}
                  {goalProgress.filter(g => g.goalStatus === "Mastered").map((g, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span style={{ color: "#7C3AED" }}>⭐</span>
                      <span style={{ color: "var(--text1)" }}>{g.targetName} — Mastered</span>
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
      </div>
    </div>
  );
}
