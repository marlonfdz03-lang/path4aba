"use client";

import { useCallback, useEffect, useState } from "react";

// Compliance-gate findings. The gates never block a note reaching an RBT — every finding lands here
// instead, so a recurring defect gets fixed at its root rather than surfacing to a user mid-session.

interface Grouped {
  gate: string;
  severity: string;
  count: number;
  clientCount: number;
  userCount: number;
  examples: string[];
  lastSeen: string;
}

interface Finding {
  id: string;
  created_at: string;
  client_id: string | null;
  user_id: string | null;
  source: string;
  gate: string;
  severity: string;
  detail: string;
  regen_count: number | null;
}

const SEVERITY: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: "#FEE2E2", color: "#DC2626", label: "Critical" },
  warning:  { bg: "#FEF3C7", color: "#B45309", label: "Warning" },
  info:     { bg: "#EFF6FF", color: "#1D4ED8", label: "Info" },
};

const GATE_LABEL: Record<string, string> = {
  "intervention": "Approved intervention",
  "approved-function": "Approved function",
  "coverage": "Function coverage",
  "teaching-method": "Teaching method",
  "coherence": "Function/antecedent coherence",
  "red-flag": "97153 red flag",
  "similarity": "Note similarity",
  "blocked-term": "Host-EHR blocked term",
  "data-integrity": "Assessment data integrity",
};

export default function AdminGateFindingsPage() {
  const [days, setDays] = useState(7);
  const [grouped, setGrouped] = useState<Grouped[]>([]);
  const [recent, setRecent] = useState<Finding[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setNotice("");
    try {
      const res = await fetch(`/api/admin/gate-findings?days=${d}`);
      const data = await res.json();
      if (data.pendingMigration) {
        setNotice("The gate_findings table has not been created yet — run the migration in prisma/migrations/20260819000000_gate_findings/migration.sql. Note generation is unaffected.");
        setGrouped([]); setRecent([]); setCriticalCount(0); setTotal(0);
      } else if (data.error) {
        setNotice(data.error);
      } else {
        setGrouped(data.grouped || []);
        setRecent(data.recent || []);
        setCriticalCount(data.criticalCount || 0);
        setTotal(data.total || 0);
      }
    } catch {
      setNotice("Failed to load findings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Gate findings</h1>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: "4px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${days === d ? "#1BA8A0" : "var(--border, #E5E7EB)"}`,
                background: days === d ? "#1BA8A0" : "white",
                color: days === d ? "white" : "var(--text2, #4B5563)",
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--text3, #6B7280)", marginBottom: 16 }}>
        Notes always generate — these are recorded silently and never shown to the RBT. Fix what recurs.
      </p>

      {notice && (
        <div style={{ padding: 12, borderRadius: 10, background: "#FEF3C7", color: "#92400E", fontSize: 13, marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {criticalCount > 0 && (
        <div style={{ padding: 14, borderRadius: 10, background: "#FEE2E2", border: "1px solid #DC2626", marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#DC2626" }}>
            {criticalCount} prohibited-intervention finding{criticalCount === 1 ? "" : "s"} in the last {days} days
          </p>
          <p style={{ fontSize: 13, color: "#7F1D1D", marginTop: 2 }}>
            A procedure no plan may authorize reached a generated note. Review immediately.
          </p>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--text3, #6B7280)" }}>Loading…</p>
      ) : total === 0 && !notice ? (
        <p style={{ fontSize: 13, color: "var(--text3, #6B7280)" }}>No findings in the last {days} days.</p>
      ) : (
        <>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text3, #6B7280)", margin: "18px 0 8px" }}>
            By gate ({total} finding{total === 1 ? "" : "s"})
          </h2>
          <div style={{ display: "grid", gap: 8, marginBottom: 24 }}>
            {grouped.map((g) => {
              const s = SEVERITY[g.severity] || SEVERITY.info;
              return (
                <div key={`${g.gate}|${g.severity}`} style={{ border: "1px solid var(--border, #E5E7EB)", borderRadius: 10, padding: 12, background: "white" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: s.bg, color: s.color }}>{s.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{GATE_LABEL[g.gate] || g.gate}</span>
                    <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700 }}>{g.count}×</span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text3, #6B7280)" }}>
                    {g.clientCount} client{g.clientCount === 1 ? "" : "s"} · {g.userCount} user{g.userCount === 1 ? "" : "s"} · last {new Date(g.lastSeen).toLocaleString()}
                  </p>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
                    {g.examples.map((e, i) => (
                      <li key={i} style={{ fontSize: 12, color: "var(--text2, #4B5563)" }}>{e}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text3, #6B7280)", margin: "0 0 8px" }}>
            Recent
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text3, #6B7280)" }}>
                  <th style={{ padding: "6px 8px" }}>When</th>
                  <th style={{ padding: "6px 8px" }}>Severity</th>
                  <th style={{ padding: "6px 8px" }}>Gate</th>
                  <th style={{ padding: "6px 8px" }}>Detail</th>
                  <th style={{ padding: "6px 8px" }}>Client</th>
                  <th style={{ padding: "6px 8px" }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((f) => {
                  const s = SEVERITY[f.severity] || SEVERITY.info;
                  return (
                    <tr key={f.id} style={{ borderTop: "1px solid var(--border, #E5E7EB)" }}>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{new Date(f.created_at).toLocaleString()}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 999, background: s.bg, color: s.color }}>{s.label}</span>
                      </td>
                      <td style={{ padding: "6px 8px" }}>{GATE_LABEL[f.gate] || f.gate}</td>
                      <td style={{ padding: "6px 8px" }}>{f.detail}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {f.client_id ? <a href={`/clients/${f.client_id}`} style={{ color: "#1BA8A0" }}>{f.client_id.slice(0, 8)}…</a> : "—"}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{f.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
