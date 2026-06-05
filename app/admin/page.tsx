"use client";

import { useEffect, useState } from "react";

interface Stats {
  totalUsers: number;
  totalClients: number;
  totalNotes: number;
  totalSubscriptions: number;
  recentUsers: { id: string; email: string; name: string | null; role: string; created_at: string }[];
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border, #E2E8F0)" }}>
      <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--text3, #94A3B8)" }}>{label}</p>
      <p className="text-[28px] font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/stats")
      .then(r => r.json())
      .then(data => { if (data.error) setError(data.error); else setStats(data); })
      .catch(() => setError("Failed to load stats"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="px-8 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-[22px] font-bold mb-1" style={{ color: "var(--text1, #0F172A)" }}>Admin Dashboard</h1>
        <p className="text-[13px]" style={{ color: "var(--text3, #94A3B8)" }}>Platform overview</p>
      </div>

      {loading && <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>}
      {error && <p className="text-[13px] text-red-500">{error}</p>}

      {stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Users" value={stats.totalUsers} color="var(--teal, #1BA8A0)" />
            <StatCard label="Active Subscriptions" value={stats.totalSubscriptions} color="#8B5CF6" />
            <StatCard label="Total Clients" value={stats.totalClients} color="#F59E0B" />
            <StatCard label="Notes Generated" value={stats.totalNotes} color="#10B981" />
          </div>

          <div className="bg-white rounded-xl border" style={{ borderColor: "var(--border, #E2E8F0)" }}>
            <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--border, #E2E8F0)" }}>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Recent Signups</p>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border, #E2E8F0)" }}>
              {stats.recentUsers.map(u => (
                <div key={u.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{u.email}</p>
                    {u.name && <p className="text-[12px]" style={{ color: "var(--text3)" }}>{u.name}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: u.role === 'admin' ? "#FEE2E2" : u.role === 'bcba' ? "var(--teal-light, #E6F9F5)" : "#EFF6FF",
                        color: u.role === 'admin' ? "#DC2626" : u.role === 'bcba' ? "var(--teal)" : "#1D4ED8",
                      }}>
                      {u.role}
                    </span>
                    <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                      {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
