"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type StatsData = {
  activeClients: number;
  notesThisWeek: number;
  recentActivity: Array<{
    type: "note";
    clientName: string | null;
    date: string;
    sessionDate: string | null;
  }>;
};

// ── Icons ────────────────────────────────────────────────────────────────────

const IconUsers = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const IconFileText = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <line x1="10" y1="9" x2="8" y2="9"/>
  </svg>
);

const IconBarChart = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatActivityDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Card styles ───────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "white",
  borderRadius: 20,
  border: "1px solid #E2E8F0",
  boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  padding: 28,
};

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
      .then((d) => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <style>{`
        .qa-note { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .qa-note:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(15,98,254,0.3); }
        .qa-monthly { transition: background 0.15s ease, color 0.15s ease; }
        .qa-monthly:hover { background: #EFF6FF !important; }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }
      `}</style>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 40px" }}>

        {/* Header */}
        <div className="mb-8">
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
            Good {greeting}, {name}
          </h1>
          <p style={{ fontSize: 14, color: "#64748B" }}>
            Here&apos;s your overview for {formatHeaderDate()}
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-5 mb-6">

          {/* Active Clients */}
          <div style={CARD}>
            <div className="flex items-start gap-4">
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563EB", flexShrink: 0 }}>
                <IconUsers />
              </div>
              <div>
                {loading ? (
                  <div style={{ width: 60, height: 36, borderRadius: 8, background: "#E2E8F0", animation: "pulse 1.5s ease-in-out infinite" }} />
                ) : (
                  <p style={{ fontSize: 36, fontWeight: 700, color: "#0F172A", lineHeight: 1 }}>{stats?.activeClients ?? 0}</p>
                )}
                <p style={{ fontSize: 14, color: "#64748B", marginTop: 6 }}>Active Clients</p>
              </div>
            </div>
          </div>

          {/* Notes This Week */}
          <div style={CARD}>
            <div className="flex items-start gap-4">
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#7C3AED", flexShrink: 0 }}>
                <IconFileText />
              </div>
              <div>
                {loading ? (
                  <div style={{ width: 60, height: 36, borderRadius: 8, background: "#E2E8F0", animation: "pulse 1.5s ease-in-out infinite" }} />
                ) : (
                  <p style={{ fontSize: 36, fontWeight: 700, color: "#0F172A", lineHeight: 1 }}>{stats?.notesThisWeek ?? 0}</p>
                )}
                <p style={{ fontSize: 14, color: "#64748B", marginTop: 6 }}>Notes This Week</p>
              </div>
            </div>
          </div>

          {/* Data Collected */}
          <div style={{ ...CARD, position: "relative", overflow: "hidden" }}>
            <div className="flex items-start gap-4">
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#E0F2FE", display: "flex", alignItems: "center", justifyContent: "center", color: "#0284C7", flexShrink: 0 }}>
                <IconBarChart />
              </div>
              <div>
                <p style={{ fontSize: 36, fontWeight: 700, color: "#0F172A", lineHeight: 1 }}>
                  {isAdmin ? 0 : 0}
                </p>
                <p style={{ fontSize: 14, color: "#64748B", marginTop: 6 }}>Data Collected</p>
              </div>
            </div>
            {!isAdmin && (
              <span style={{ position: "absolute", top: 14, right: 14, fontSize: 10, fontWeight: 700, background: "#0F62FE", color: "white", padding: "2px 8px", borderRadius: 99 }}>
                Coming Soon
              </span>
            )}
          </div>
        </div>

        {/* Two-column section */}
        <div className="grid grid-cols-3 gap-5 mb-6">

          {/* Recent Activity */}
          <div className="col-span-2" style={CARD}>
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 18, fontWeight: 700, color: "#0F172A" }}>Recent Activity</p>
              <p style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>Last 7 days</p>
            </div>
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ height: 18, borderRadius: 6, background: "#F1F5F9", animation: "pulse 1.5s ease-in-out infinite" }} />
                ))}
              </div>
            ) : !stats?.recentActivity?.length ? (
              <p style={{ fontSize: 13, color: "#94A3B8" }}>No activity yet</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {stats.recentActivity.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderBottom: i < stats.recentActivity.length - 1 ? "1px solid #F1F5F9" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E", flexShrink: 0, display: "inline-block" }} />
                      <span style={{ fontSize: 14, color: "#0F172A", fontWeight: 500 }}>
                        {item.clientName ? `Session note · ${item.clientName}` : "Session note"}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: "#94A3B8", flexShrink: 0 }}>
                      {formatActivityDate(item.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Quick Actions */}
          {!isStudent && (
            <div className="col-span-1" style={CARD}>
              <p style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Quick Actions</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a
                  href={isBCBA ? "/bcba" : "/clients"}
                  className="qa-note"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 0", borderRadius: 12, background: "linear-gradient(135deg, #0F62FE, #1B5BE8)", color: "white", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
                >
                  📝 New Note
                </a>
                <button
                  disabled
                  title="Coming Soon"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 0", borderRadius: 12, background: "#F1F5F9", color: "#64748B", fontSize: 14, fontWeight: 500, border: "none", cursor: "not-allowed", opacity: 0.7 }}
                >
                  📊 Collect Data
                </button>
                <a
                  href={isBCBA ? "/bcba" : "/clients"}
                  className="qa-monthly"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px 0", borderRadius: 12, background: "transparent", border: "1.5px solid #0F62FE", color: "#0F62FE", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
                >
                  📄 Monthly Report
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Welcome banner */}
        <div style={{ background: "linear-gradient(135deg, #071A52 0%, #0F62FE 100%)", borderRadius: 20, padding: "32px 40px", position: "relative", overflow: "hidden" }}>
          {/* Decorative circles */}
          <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "rgba(63,169,245,0.15)", filter: "blur(60px)", top: -80, right: -80, pointerEvents: "none" }} />
          <div style={{ position: "absolute", width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.05)", filter: "blur(40px)", bottom: -40, left: 100, pointerEvents: "none" }} />

          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 28 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <img src="/logo.png" alt="Path4ABA" width={32} height={32} style={{ objectFit: "contain" }} />
            </div>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: "white", margin: 0, marginBottom: 6 }}>
                Welcome to Path4ABA
              </h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", margin: 0, maxWidth: 480 }}>
                Streamline your ABA practice with AI-powered documentation, data collection, and reporting tools.
              </p>
              <a
                href="https://path4aba.app"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: 16, padding: "9px 22px", borderRadius: 12, background: "white", color: "#0F62FE", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
              >
                Learn More
              </a>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
