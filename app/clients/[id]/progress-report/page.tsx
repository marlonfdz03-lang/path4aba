"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getClientProfiles } from "@/lib/clientStorage";

function TrendBadge({ trend }: { trend: string }) {
  const config: Record<string, { label: string; bg: string; color: string }> = {
    improving:         { label: "Improving",         bg: "#DCFCE7", color: "#16A34A" },
    stable:            { label: "Stable",             bg: "#F1F5F9", color: "#64748B" },
    worsening:         { label: "Worsening",          bg: "#FEE2E2", color: "#DC2626" },
    insufficient_data: { label: "Insufficient Data",  bg: "#FEF3C7", color: "#D97706" },
  };
  const { label, bg, color } = config[trend] ?? config.insufficient_data;
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function GoalStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string }> = {
    "On Track":          { bg: "var(--teal-light)", color: "var(--teal)" },
    "Needs Attention":   { bg: "#FEE2E2",           color: "#DC2626" },
    "Mastered":          { bg: "#EEF2FF",            color: "var(--navy, #1E293B)" },
    "Insufficient Data": { bg: "#F1F5F9",            color: "#64748B" },
  };
  const { bg, color } = config[status] ?? config["Insufficient Data"];
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: bg, color }}
    >
      {status}
    </span>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <p className="text-[11px] uppercase tracking-widest font-semibold whitespace-nowrap" style={{ color: "var(--text3)" }}>
        {title}
      </p>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}

export default function ProgressReportPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [clientName, setClientName] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const [generating, setGenerating] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [behaviorTrends, setBehaviorTrends] = useState<any[]>([]);
  const [skillTrends, setSkillTrends] = useState<any[]>([]);
  const [goalProgress, setGoalProgress] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [genError, setGenError] = useState("");
  const [noteCopied, setNoteCopied] = useState(false);
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());

  const narrativeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const profiles = getClientProfiles();
    const found = profiles.find((p: any) => p.id === clientId);
    if (found) setClientName(found.clientName || "");
    loadReports();
  }, [clientId]);

  async function loadReports() {
    try {
      const res = await fetch(`/api/progress-report?clientId=${clientId}`);
      if (res.ok) {
        const json = await res.json();
        setReports(json.reports || []);
      }
    } catch {}
  }

  const [year, month] = selectedMonth.split("-").map(Number);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
  const periodLabel = new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  async function handleGenerate() {
    setGenerating(true);
    setGenError("");
    setNarrative("");
    setBehaviorTrends([]);
    setSkillTrends([]);
    setGoalProgress([]);

    try {
      const res = await fetch("/api/progress-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart, periodEnd, periodLabel }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGenError(err.error || "Generation failed.");
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const metaIdx = buffer.indexOf("\n__META__");
        if (metaIdx !== -1) {
          const narrativeText = buffer.slice(0, metaIdx);
          const metaRaw = buffer.slice(metaIdx + "\n__META__".length);
          setNarrative(narrativeText);
          try {
            const meta = JSON.parse(metaRaw);
            if (meta.error) {
              setGenError(meta.error);
            } else {
              setBehaviorTrends(meta.behaviorTrends || []);
              setSkillTrends(meta.skillTrends || []);
              setGoalProgress(meta.goalProgress || []);
              loadReports();
            }
          } catch {}
          break;
        } else {
          setNarrative(buffer);
        }
      }
    } catch {
      setGenError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(narrative);
      setNoteCopied(true);
      setTimeout(() => setNoteCopied(false), 2000);
    } catch {}
  }

  function toggleReport(id: string) {
    setExpandedReports(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasResults = narrative || behaviorTrends.length > 0 || skillTrends.length > 0 || goalProgress.length > 0;

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* Topbar */}
      <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link href="/clients" className="hover:underline" style={{ color: "var(--text3)" }}>Clients</Link>
        <span style={{ color: "var(--border2)" }}>/</span>
        <Link href={`/clients/${clientId}`} className="hover:underline" style={{ color: "var(--text3)" }}>
          {clientName || "Client"}
        </Link>
        <span style={{ color: "var(--border2)" }}>/</span>
        <span className="font-medium" style={{ color: "var(--text1)" }}>Progress Report</span>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-5">

        {/* Generate card */}
        <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
          <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Generate Progress Report</p>
          <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>
            Analyzes behavior trends, skill acquisition, and goal progress for the selected month.
          </p>

          <div className="flex items-end gap-3">
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                Reporting Period
              </label>
              <input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--teal)" }}
            >
              {generating ? "Generating…" : "Generate Report"}
            </button>
          </div>

          {genError && (
            <p className="mt-3 text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
              {genError}
            </p>
          )}
        </div>

        {/* Results */}
        {hasResults && (
          <>
            {/* Behavior Trends */}
            {behaviorTrends.length > 0 && (
              <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Behavior Trends" />
                <div className="space-y-3">
                  {behaviorTrends.map((b: any) => (
                    <div key={b.name} className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{b.name}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>
                          Avg {b.avgFrequency.toFixed(1)}/week
                          {b.changePercent !== null && (
                            <span> · {b.changePercent > 0 ? "+" : ""}{b.changePercent.toFixed(0)}% change</span>
                          )}
                        </p>
                      </div>
                      <TrendBadge trend={b.trend} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skill Trends */}
            {skillTrends.length > 0 && (
              <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Skill Trends" />
                <div className="space-y-3">
                  {skillTrends.map((s: any) => (
                    <div key={s.name} className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{s.name}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>
                          Avg {s.avgPercentage.toFixed(0)}%
                          {s.changePercent !== null && (
                            <span> · {s.changePercent > 0 ? "+" : ""}{s.changePercent.toFixed(0)}% change</span>
                          )}
                        </p>
                      </div>
                      <TrendBadge trend={s.trend} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Goal Progress */}
            {goalProgress.length > 0 && (
              <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Goal Progress" />
                <div className="space-y-4">
                  {goalProgress.map((g: any) => (
                    <div key={g.targetName}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{g.targetName}</p>
                          <p className="text-[11px]" style={{ color: "var(--text3)" }}>
                            Baseline {g.baselineValue} → Goal {g.goalValue}
                            {g.currentValue !== null && ` · Current ${g.currentValue}`}
                          </p>
                        </div>
                        <GoalStatusBadge status={g.goalStatus} />
                      </div>
                      {g.percentToGoal !== null && (
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${g.percentToGoal}%`, background: "var(--teal)" }}
                          />
                        </div>
                      )}
                      {g.percentToGoal !== null && (
                        <p className="text-[11px] mt-1" style={{ color: "var(--text3)" }}>
                          {g.percentToGoal.toFixed(0)}% to goal
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical Narrative */}
            {narrative && (
              <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between mb-4">
                  <SectionHeader title="Clinical Narrative" />
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors hover:opacity-80 flex-shrink-0"
                    style={{ borderColor: "var(--border)", color: noteCopied ? "var(--teal)" : "var(--text2)" }}
                  >
                    {noteCopied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
                <textarea
                  ref={narrativeRef}
                  value={narrative}
                  onChange={e => setNarrative(e.target.value)}
                  rows={12}
                  className="w-full border rounded-xl px-4 py-3 text-[13px] leading-relaxed focus:outline-none resize-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)", background: "var(--bg)" }}
                />
              </div>
            )}
          </>
        )}

        {/* History */}
        {reports.length > 0 && (
          <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
            <SectionHeader title="Previous Reports" />
            <div className="space-y-2">
              {reports.map((r: any) => {
                const isExpanded = expandedReports.has(r.id);
                const date = r.created_at
                  ? new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "";
                return (
                  <div key={r.id} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    <button
                      onClick={() => toggleReport(r.id)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:opacity-80"
                      style={{ background: "var(--bg)" }}
                    >
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{r.period_label}</p>
                        {date && <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>Generated {date}</p>}
                      </div>
                      <span className="text-[12px]" style={{ color: "var(--text3)" }}>
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </button>
                    {isExpanded && r.narrative && (
                      <div className="px-4 pb-4" style={{ borderTop: "1px solid var(--border)" }}>
                        <p className="text-[13px] leading-relaxed pt-3 whitespace-pre-wrap" style={{ color: "var(--text2)" }}>
                          {r.narrative}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
