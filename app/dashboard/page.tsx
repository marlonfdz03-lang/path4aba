"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type StatsData = {
  activeClients: number;
  notesThisWeek: number;
  recentActivity: Array<{
    type: "note";
    clientName: string;
    date: string;
    sessionDate: string | null;
  }>;
};

// ── Icons ────────────────────────────────────────────────────────────────────

const IconUsers = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const IconFileText = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <line x1="10" y1="9" x2="8" y2="9"/>
  </svg>
);

const IconBarChart = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(hour: number): string {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function formatHeaderDate(): string {
  const d = new Date();
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatActivityDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const role = ((session?.user as any)?.role || "").toLowerCase();
  const isBCBA = ["bcba", "bcaba"].includes(role);
  const isStudent = ["bcba_student", "bcaba_student"].includes(role);
  const isAdmin = role === "admin";

  const name = session?.user?.name || session?.user?.email?.split("@")[0] || "there";
  const hour = new Date().getHours();
  const greeting = getGreeting(hour);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((d) => {
        setStats(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="px-8 py-7 max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-7">
          <h1 className="text-[22px] font-semibold mb-1" style={{ color: "var(--text1)" }}>
            Good {greeting}, {name}
          </h1>
          <p className="text-[14px] flex items-center gap-2" style={{ color: "var(--text3)" }}>
            Here&apos;s your overview for {formatHeaderDate()}
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Active Clients */}
          <div
            className="bg-white rounded-xl p-5 flex items-center gap-4"
            style={{ border: "1px solid var(--border)" }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--teal-light)", color: "var(--teal)" }}
            >
              <IconUsers />
            </div>
            <div>
              <p className="text-[22px] font-bold leading-none" style={{ color: "var(--text1)" }}>
                {loading ? "—" : stats?.activeClients ?? 0}
              </p>
              <p className="text-[12px] mt-1" style={{ color: "var(--text3)" }}>Active Clients</p>
            </div>
          </div>

          {/* Notes This Week */}
          <div
            className="bg-white rounded-xl p-5 flex items-center gap-4"
            style={{ border: "1px solid var(--border)" }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--teal-light)", color: "var(--teal)" }}
            >
              <IconFileText />
            </div>
            <div>
              <p className="text-[22px] font-bold leading-none" style={{ color: "var(--text1)" }}>
                {loading ? "—" : stats?.notesThisWeek ?? 0}
              </p>
              <p className="text-[12px] mt-1" style={{ color: "var(--text3)" }}>Notes This Week</p>
            </div>
          </div>

          {/* Data Collected */}
          <div
            className="bg-white rounded-xl p-5 flex items-center gap-4 relative overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--teal-light)", color: "var(--teal)" }}
            >
              <IconBarChart />
            </div>
            <div>
              <p className="text-[22px] font-bold leading-none" style={{ color: "var(--text1)" }}>
                {isAdmin ? 0 : 0}
              </p>
              <p className="text-[12px] mt-1" style={{ color: "var(--text3)" }}>Data Collected</p>
            </div>
            {!isAdmin && (
              <span
                className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                style={{ background: "var(--teal)" }}
              >
                Coming Soon
              </span>
            )}
          </div>
        </div>

        {/* Two-column section */}
        <div className="grid grid-cols-3 gap-6 mb-6">
          {/* Recent Activity */}
          <div
            className="col-span-2 bg-white rounded-xl p-5"
            style={{ border: "1px solid var(--border)" }}
          >
            <div className="mb-4">
              <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>Recent Activity</p>
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>Last 7 days</p>
            </div>
            {loading ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
            ) : !stats?.recentActivity?.length ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No activity yet</p>
            ) : (
              <ul className="space-y-3">
                {stats.recentActivity.map((item, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: "var(--teal)" }}
                      />
                      <span className="text-[13px]" style={{ color: "var(--text1)" }}>
                        Session note — {item.clientName}
                      </span>
                    </div>
                    <span className="text-[12px]" style={{ color: "var(--text3)" }}>
                      {formatActivityDate(item.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Quick Actions — not shown for students */}
          {!isStudent && (
            <div
              className="col-span-1 bg-white rounded-xl p-5"
              style={{ border: "1px solid var(--border)" }}
            >
              <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--text1)" }}>Quick Actions</p>
              <div className="space-y-2">
                {/* New Note */}
                <a
                  href={isBCBA ? "/bcba" : "/clients"}
                  className="block w-full text-center rounded-xl py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--teal)" }}
                >
                  ✦ New Note
                </a>

                {/* Collect Data — disabled */}
                <button
                  disabled
                  title="Coming Soon"
                  className="block w-full text-center rounded-xl py-2.5 text-[13px] font-medium cursor-not-allowed opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text3)" }}
                >
                  Collect Data
                </button>

                {/* Monthly Report */}
                <a
                  href={isBCBA ? "/bcba" : "/clients"}
                  className="block w-full text-center rounded-xl py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-80"
                  style={{ border: "1px solid var(--teal)", color: "var(--teal)" }}
                >
                  Monthly Report
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Welcome banner */}
        <div
          className="bg-white rounded-xl p-8 flex items-center gap-8"
          style={{ border: "1px solid var(--border)" }}
        >
          <img src="/logo.png" alt="Path4ABA" width={64} height={64} style={{ objectFit: "contain", flexShrink: 0 }} />
          <div>
            <h2 className="text-xl font-semibold" style={{ color: "var(--text1)" }}>
              Welcome to Path4ABA
            </h2>
            <p className="text-sm mt-1" style={{ color: "var(--text3)" }}>
              Streamline your ABA practice with AI-powered documentation, data collection, and reporting tools.
            </p>
            <a
              href="https://path4aba.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-4 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--teal)" }}
            >
              Learn More
            </a>
          </div>
        </div>

      </div>
    </main>
  );
}
