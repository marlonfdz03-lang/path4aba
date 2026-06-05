"use client";

import { useEffect, useState } from "react";

interface AdminClient {
  id: string;
  internal_code: string | null;
  client_name: string;
  rbt_id: string | null;
  rbt_email: string | null;
  rbt_name: string | null;
  primary_setting: string | null;
  bcba_count: number;
  note_count: number;
  created_at: string | null;
}

export default function AdminClientsPage() {
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rbtFilter, setRbtFilter] = useState("");
  const [filterInput, setFilterInput] = useState("");

  async function loadClients(rbtId = "") {
    setLoading(true);
    setError("");
    try {
      const url = rbtId ? `/api/admin/clients?rbtId=${encodeURIComponent(rbtId)}` : "/api/admin/clients";
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setClients(data.clients || []);
    } catch { setError("Failed to load clients"); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadClients(); }, []);

  function handleFilter() {
    setRbtFilter(filterInput);
    loadClients(filterInput);
  }

  function handleClear() {
    setFilterInput("");
    setRbtFilter("");
    loadClients("");
  }

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="px-8 py-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold mb-1" style={{ color: "var(--text1)" }}>Clients</h1>
          <p className="text-[13px]" style={{ color: "var(--text3)" }}>{clients.length} total{rbtFilter ? " (filtered)" : ""}</p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={filterInput}
            onChange={e => setFilterInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleFilter()}
            placeholder="Filter by RBT user ID…"
            className="border rounded-xl px-4 py-2 text-[13px] focus:outline-none w-64"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          />
          <button
            onClick={handleFilter}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white"
            style={{ background: "var(--teal)" }}
          >
            Filter
          </button>
          {rbtFilter && (
            <button
              onClick={handleClear}
              className="px-4 py-2 rounded-xl text-[13px] font-medium border"
              style={{ borderColor: "var(--border)", color: "var(--text2)" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

      <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
              {["Client", "Code", "RBT", "Setting", "BCBAs", "Notes", "Created"].map(h => (
                <th key={h} className="px-5 py-3 text-left font-semibold" style={{ color: "var(--text3)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-6 text-center" style={{ color: "var(--text3)" }}>Loading…</td></tr>
            ) : clients.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-6 text-center" style={{ color: "var(--text3)" }}>No clients found.</td></tr>
            ) : clients.map(c => (
              <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3 font-medium" style={{ color: "var(--text1)" }}>{c.client_name}</td>
                <td className="px-5 py-3 font-mono text-[12px]" style={{ color: "var(--text3)" }}>{c.internal_code || "—"}</td>
                <td className="px-5 py-3">
                  {c.rbt_email ? (
                    <>
                      <p style={{ color: "var(--text2)" }}>{c.rbt_email}</p>
                      {c.rbt_name && <p className="text-[12px]" style={{ color: "var(--text3)" }}>{c.rbt_name}</p>}
                    </>
                  ) : <span style={{ color: "var(--text3)" }}>—</span>}
                </td>
                <td className="px-5 py-3" style={{ color: "var(--text3)" }}>{c.primary_setting || "—"}</td>
                <td className="px-5 py-3 text-center" style={{ color: "var(--text2)" }}>{c.bcba_count}</td>
                <td className="px-5 py-3 text-center" style={{ color: "var(--text2)" }}>{c.note_count}</td>
                <td className="px-5 py-3" style={{ color: "var(--text3)" }}>{fmt(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
