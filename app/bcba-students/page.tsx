"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthSummary {
  month_year: string;
  total_hours: number;
  total_supervised_hours: number;
  total_independent_hours: number;
  supervision_pct: number;
  unrestricted_hours: number;
  restricted_hours: number;
  supervisor_contacts: number;
  individual_contacts: number;
  group_contacts: number;
  client_observations: number;
  is_eligible: boolean;
  mvf_signed: boolean;
}

interface Profile {
  fieldwork_type: string;
  certification_track: string;
  start_date: string | null;
  trainee_bacb_id: string | null;
  supervisor_name: string | null;
}

interface Session {
  id: string;
  session_date: string;
  total_hours: number;
  supervised_hours: number;
  independent_hours: number;
  contact_type: string | null;
  activity_type: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHours(n: number) {
  return n.toFixed(1);
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join("");
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtDate(dateStr: string) {
  return new Date(dateStr + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const GOAL = 2000;
const MILESTONES = [100, 250, 500, 1000, 2000];
const DONUT_COLORS = ["var(--teal)", "var(--navy2)", "#60A5FA", "#A78BFA"];

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, progress, statusColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  progress?: number;
  statusColor?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--teal-light)" }}>
          {icon}
        </div>
        {statusColor && (
          <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: statusColor }} />
        )}
      </div>
      <p className="text-[22px] font-bold leading-none mb-1" style={{ color: statusColor ?? "var(--text1)" }}>{value}</p>
      <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text3)" }}>{label}</p>
      {progress !== undefined && (
        <div className="rounded-full overflow-hidden mb-1" style={{ height: 4, background: "var(--border)" }}>
          <div style={{ width: `${Math.min(100, progress)}%`, height: "100%", background: "var(--teal)", borderRadius: 9999, transition: "width 0.6s ease" }} />
        </div>
      )}
      {sub && <p className="text-[11px]" style={{ color: "var(--text3)" }}>{sub}</p>}
    </div>
  );
}

// ── Donut chart wrapper ───────────────────────────────────────────────────────

function DonutChart({
  data, total, centerLabel, centerSub,
}: {
  data: { name: string; value: number; color: string }[];
  total: number;
  centerLabel: string;
  centerSub: string;
}) {
  return (
    <div className="relative" style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [`${fmtHours(Number(value))} hrs`, ""]}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-[18px] font-bold" style={{ color: "var(--text1)" }}>{centerLabel}</p>
        <p className="text-[11px]" style={{ color: "var(--text3)" }}>{centerSub}</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BCBAStudentsDashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }

    async function load() {
      const [profileRes, monthlyRes, sessionsRes] = await Promise.all([
        fetch("/api/bcba-students/profile"),
        fetch("/api/bcba-students/monthly"),
        fetch("/api/bcba-students/sessions"),
      ]);
      const [profileData, monthlyData, sessionsData] = await Promise.all([
        profileRes.json(), monthlyRes.json(), sessionsRes.json(),
      ]);
      setProfile(profileData.profile ?? null);
      setSummaries(monthlyData.summaries ?? []);
      setSessions(sessionsData.sessions ?? []);
      setLoading(false);
    }
    load();
  }, [status, session, router]);

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const sortedAsc = [...summaries].sort((a, b) => a.month_year.localeCompare(b.month_year));
  const allTotal = summaries.reduce((s, m) => s + m.total_hours, 0);
  const allSupervised = summaries.reduce((s, m) => s + m.total_supervised_hours, 0);
  const allUnrestricted = summaries.reduce((s, m) => s + m.unrestricted_hours, 0);
  const allRestricted = summaries.reduce((s, m) => s + m.restricted_hours, 0);

  const currentMonthYear = new Date().toISOString().slice(0, 7);
  const currentMonth = summaries.find((s) => s.month_year === currentMonthYear) ?? null;
  const prevMonthYear = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const prevMonth = summaries.find((s) => s.month_year === prevMonthYear) ?? null;

  const totalProgress = Math.min(100, (allTotal / GOAL) * 100);
  const supervisedDelta = (currentMonth?.total_supervised_hours ?? 0) - (prevMonth?.total_supervised_hours ?? 0);

  // Monthly progress status
  const monthStatus: { label: string; color: string; sub: string } = currentMonth?.is_eligible
    ? { label: "On Track", color: "#16A34A", sub: "Great job — keep it up!" }
    : allTotal === 0
    ? { label: "Not Started", color: "var(--text3)", sub: "Log your first session today" }
    : { label: "At Risk", color: "#D97706", sub: "Review your hours this month" };

  // ── Milestone dates ──────────────────────────────────────────────────────────

  const milestoneReached: Record<number, string> = {};
  let cum = 0;
  for (const s of sortedAsc) {
    cum += s.total_hours;
    for (const m of MILESTONES) {
      if (!milestoneReached[m] && cum >= m) {
        milestoneReached[m] = s.month_year;
      }
    }
  }

  // ── Chart data ───────────────────────────────────────────────────────────────

  const progressChartData = [
    { name: "Completed", value: Math.max(0, allTotal), color: "var(--teal)" },
    { name: "Remaining", value: Math.max(0, GOAL - allTotal), color: "var(--border)" },
  ];

  // Hours breakdown by contact type from sessions
  const sessionTotals = { supervised: 0, independent: 0, observation: 0 };
  for (const s of sessions) {
    const ct = (s.contact_type ?? "").toLowerCase();
    if (ct === "individual" || ct === "group") {
      sessionTotals.supervised += s.supervised_hours ?? 0;
    } else if (ct === "observation") {
      sessionTotals.observation += s.total_hours ?? 0;
    } else {
      sessionTotals.independent += s.independent_hours ?? 0;
    }
  }
  const breakdownChartData = [
    { name: "Supervised", value: parseFloat(fmtHours(allSupervised)), color: "var(--teal)" },
    { name: "Independent", value: parseFloat(fmtHours(Math.max(0, allTotal - allSupervised))), color: "var(--navy2)" },
    { name: "Unrestricted", value: parseFloat(fmtHours(allUnrestricted)), color: "#60A5FA" },
  ].filter((d) => d.value > 0);

  const breakdownTotal = breakdownChartData.reduce((s, d) => s + d.value, 0) || 1;

  // ── User info ────────────────────────────────────────────────────────────────

  const userName = session?.user?.name || session?.user?.email?.split("@")[0] || "Student";
  const userRole = (session?.user as any)?.role as string ?? "";
  const roleLabel = userRole === "bcaba_student" ? "BCaBA Student" : "BCBA Student";
  const initials = getInitials(userName);

  // ── This month stats ─────────────────────────────────────────────────────────

  const thisMonthSessions = sessions.filter((s) => s.session_date?.startsWith(currentMonthYear));
  const compliancePct = currentMonth ? (currentMonth.is_eligible ? 100 : Math.round(currentMonth.supervision_pct)) : 0;

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-8 h-16 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 className="text-[16px] font-semibold" style={{ color: "var(--text1)" }}>
            Welcome back, {userName}! 👋
          </h1>
          <p className="text-[12px]" style={{ color: "var(--text3)" }}>
            Track your fieldwork, stay on top of your hours, and achieve your goals.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Notification bell */}
          <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors" style={{ border: "1px solid var(--border)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text3)" }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>
          {/* Avatar + name */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold text-white flex-shrink-0"
              style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}>
              {initials}
            </div>
            <div className="hidden sm:block">
              <p className="text-[13px] font-medium leading-none" style={{ color: "var(--text1)" }}>{userName}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>{roleLabel}</p>
            </div>
          </div>
          {/* Add entry */}
          <Link
            href="/bcba-students/log"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: "var(--teal)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Fieldwork Entry
          </Link>
        </div>
      </div>

      <div className="px-8 py-7 w-full">

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
            label="Total Hours"
            value={`${fmtHours(allTotal)} hrs`}
            sub={`${totalProgress.toFixed(1)}% of ${GOAL}h goal`}
            progress={totalProgress}
          />
          <StatCard
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
            label="Supervised Hours"
            value={`${fmtHours(currentMonth?.total_supervised_hours ?? 0)} hrs`}
            sub={supervisedDelta !== 0 ? `${supervisedDelta > 0 ? "↑" : "↓"} ${Math.abs(supervisedDelta).toFixed(1)} from last month` : "This month"}
          />
          <StatCard
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
            label="Unrestricted / Restricted"
            value={allTotal > 0 ? `${Math.round((allUnrestricted / allTotal) * 100)}% / ${Math.round((allRestricted / allTotal) * 100)}%` : "0% / 0%"}
            sub={`${fmtHours(allUnrestricted)} unrestricted · ${fmtHours(allRestricted)} restricted`}
          />
          <StatCard
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={monthStatus.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
            label="Monthly Progress"
            value={monthStatus.label}
            sub={monthStatus.sub}
            statusColor={monthStatus.color}
          />
        </div>

        {/* ── Middle row: charts + milestones ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

          {/* Fieldwork Progress donut */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
            <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Fieldwork Progress</p>
            <p className="text-[12px] mb-4" style={{ color: "var(--text3)" }}>Toward {GOAL}h goal</p>
            <DonutChart
              data={progressChartData}
              total={GOAL}
              centerLabel={`${fmtHours(allTotal)}h`}
              centerSub={`of ${GOAL}h`}
            />
            <div className="flex justify-center gap-4 mt-3">
              {progressChartData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                  <span className="text-[11px]" style={{ color: "var(--text3)" }}>{d.name}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "#EFF6FF", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12 }}>
              <span style={{ fontSize: 18 }}>✨</span>
              <div>
                <div style={{ fontWeight: 600, color: "#1E3A8A", fontSize: 13 }}>Every hour counts!</div>
                <div style={{ color: "#3B82F6", fontSize: 12, marginTop: 3 }}>You&apos;re one step closer to making a bigger impact.</div>
              </div>
            </div>
          </div>

          {/* Hours Breakdown donut */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
            <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Hours Breakdown</p>
            <p className="text-[12px] mb-4" style={{ color: "var(--text3)" }}>Cumulative distribution</p>
            {breakdownChartData.length > 0 ? (
              <>
                <DonutChart
                  data={breakdownChartData}
                  total={breakdownTotal}
                  centerLabel={`${fmtHours(allTotal)}h`}
                  centerSub="total"
                />
                <div className="flex flex-col gap-1.5 mt-3">
                  {breakdownChartData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                        <span className="text-[11px]" style={{ color: "var(--text2)" }}>{d.name}</span>
                      </div>
                      <span className="text-[11px] font-medium" style={{ color: "var(--text1)" }}>
                        {fmtHours(d.value)}h ({((d.value / breakdownTotal) * 100).toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center" style={{ height: 200 }}>
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>No hours logged yet</p>
              </div>
            )}
          </div>

          {/* Upcoming Milestones */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
            <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Milestones</p>
            <p className="text-[12px] mb-4" style={{ color: "var(--text3)" }}>Your journey to {GOAL}h</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {MILESTONES.map((m, i) => {
                const reached = milestoneReached[m];
                const remaining = m - allTotal;
                return (
                  <div key={m} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    {/* Dot + connector */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: reached ? "var(--teal)" : "var(--teal-light)",
                        border: reached ? "none" : "2px solid var(--border2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: reached ? "white" : "var(--teal)",
                        fontSize: 10, fontWeight: 700,
                      }}>
                        {reached ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : (
                          <span>{m >= 1000 ? `${m / 1000}k` : m}</span>
                        )}
                      </div>
                      {i < MILESTONES.length - 1 && (
                        <div style={{ width: 2, height: 32, background: reached ? "var(--teal)" : "var(--border)", marginTop: 2 }} />
                      )}
                    </div>
                    {/* Label */}
                    <div style={{ paddingTop: 4, paddingBottom: i < MILESTONES.length - 1 ? 0 : 0, minWidth: 0 }}>
                      <p className="text-[13px] font-semibold" style={{ color: reached ? "var(--text1)" : "var(--text3)" }}>
                        {m.toLocaleString()} hours
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text3)", marginBottom: i < MILESTONES.length - 1 ? 6 : 0 }}>
                        {reached ? `Reached ${fmtDate(reached)}` : remaining > 0 ? `${fmtHours(remaining)} to go` : "Almost there!"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Bottom row ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* This Month Overview — col-span-2 */}
          <div className="md:col-span-2 bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
            <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--text1)" }}>
              This Month Overview
              <span className="ml-2 text-[12px] font-normal" style={{ color: "var(--text3)" }}>
                {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  label: "Total Hours",
                  value: `${fmtHours(currentMonth?.total_hours ?? 0)}h`,
                  icon: "⏱",
                },
                {
                  label: "Supervision Hours",
                  value: `${fmtHours(currentMonth?.total_supervised_hours ?? 0)}h`,
                  icon: "👥",
                },
                {
                  label: "Sessions",
                  value: String(thisMonthSessions.length),
                  icon: "📋",
                },
                {
                  label: "Compliance",
                  value: currentMonth ? (currentMonth.is_eligible ? "Eligible ✓" : `${compliancePct}%`) : "—",
                  icon: "✅",
                  color: currentMonth?.is_eligible ? "#16A34A" : undefined,
                },
              ].map(({ label, value, icon, color }) => (
                <div key={label} className="rounded-xl p-4" style={{ background: "var(--bg)" }}>
                  <p className="text-[20px] mb-1">{icon}</p>
                  <p className="text-[16px] font-bold" style={{ color: color ?? "var(--text1)" }}>{value}</p>
                  <p className="text-[11px]" style={{ color: "var(--text3)" }}>{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
            <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--text1)" }}>Quick Actions</p>
            <div className="space-y-2.5">
              {[
                {
                  label: "Add Fieldwork Entry",
                  sub: "Record today's hours",
                  href: "/bcba-students/log",
                  primary: true,
                },
                {
                  label: "View Monthly Forms",
                  sub: "Review & sign M-FVF",
                  href: "/bcba-students/monthly",
                  primary: false,
                },
                {
                  label: "BACB Requirements",
                  sub: "Fieldwork eligibility rules",
                  href: "https://www.bacb.com/bcba/fieldwork/",
                  primary: false,
                  external: true,
                },
              ].map(({ label, sub, href, primary, external }) => (
                <a
                  key={label}
                  href={href}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:opacity-90"
                  style={{
                    background: primary ? "var(--teal)" : "var(--bg)",
                    border: primary ? "none" : "1px solid var(--border)",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold" style={{ color: primary ? "white" : "var(--text1)" }}>
                      {label}
                    </p>
                    <p className="text-[11px]" style={{ color: primary ? "rgba(255,255,255,0.7)" : "var(--text3)" }}>
                      {sub}
                    </p>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ color: primary ? "rgba(255,255,255,0.7)" : "var(--text3)", flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </a>
              ))}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
