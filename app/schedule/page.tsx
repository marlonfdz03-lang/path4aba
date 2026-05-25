"use client";

import { useEffect, useState } from "react";
import { StoredClientProfile } from "@/lib/clientStorage";
import { supabase } from "@/lib/supabase";

const REASON_OPTIONS = [
  "Medical Appointment",
  "Vacation",
  "No Show",
  "Holiday",
  "RBT Unavailable",
  "Other",
];

interface MissedEntry {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  reason: string;
  hours: number;
  notes: string;
}

function loadEntries(): MissedEntry[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("missedHours") || "[]"); } catch { return []; }
}

function saveEntries(entries: MissedEntry[]) {
  localStorage.setItem("missedHours", JSON.stringify(entries));
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Topbar ─────────────────────────────────────────────────────────────────

function Topbar({ crumbs }: { crumbs: { label: string; onClick?: () => void }[] }) {
  return (
    <div
      className="flex items-center px-8 h-14 bg-white"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-[13px] mx-1" style={{ color: "var(--border2)" }}>/</span>}
          <button
            onClick={c.onClick}
            disabled={!c.onClick}
            className="text-[13px] transition-colors"
            style={{ color: c.onClick ? "var(--text3)" : "var(--text1)", fontWeight: c.onClick ? 400 : 500, cursor: c.onClick ? "pointer" : "default" }}
          >
            {c.label}
          </button>
        </span>
      ))}
    </div>
  );
}

// ── Client Selection ────────────────────────────────────────────────────────

function ClientSelectionView({
  clients,
  entries,
  onSelect,
}: {
  clients: StoredClientProfile[];
  entries: MissedEntry[];
  onSelect: (id: string) => void;
}) {
  const now = new Date();

  function hoursThisMonth(clientId: string) {
    return entries
      .filter((e) => {
        const d = new Date(e.date);
        return e.clientId === clientId && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, e) => sum + e.hours, 0);
  }

  const totalMissedMonth = entries
    .filter((e) => {
      const d = new Date(e.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, e) => sum + e.hours, 0);

  const termStart = new Date(now);
  termStart.setMonth(termStart.getMonth() - 6);
  const totalMissedTerm = entries
    .filter((e) => { const d = new Date(e.date); return d >= termStart && d <= now; })
    .reduce((sum, e) => sum + e.hours, 0);

  const totalSessions = entries.length;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <Topbar crumbs={[{ label: "Schedule" }]} />

      <div className="px-8 py-7">
        <h1 className="text-xl font-semibold mb-0.5" style={{ color: "var(--text1)" }}>Schedule & Hours Tracker</h1>
        <p className="text-[13.5px] mb-6" style={{ color: "var(--text3)" }}>Track missed session hours by client</p>

        {/* Metric strip */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Hours Missed This Month", value: totalMissedMonth.toFixed(1) },
            { label: "Hours Missed This Term", value: totalMissedTerm.toFixed(1) },
            { label: "Total Sessions Logged", value: totalSessions },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl p-5 text-center" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
              <p
                className="text-[28px] font-semibold leading-none mb-1"
                style={{ color: totalMissedMonth > 0 && label.includes("Month") ? "#E53E3E" : totalMissedTerm > 0 && label.includes("Term") ? "#E53E3E" : "var(--text1)" }}
              >
                {value}
              </p>
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Client cards */}
        {clients.length === 0 ? (
          <div className="bg-white rounded-xl p-10 text-center" style={{ borderColor: "var(--border)", border: "1px solid var(--border)" }}>
            <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text2)" }}>No clients found.</p>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>Add clients from the Clients page first.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client) => {
              const missed = hoursThisMonth(client.id);
              const clientEntries = entries.filter((e) => e.clientId === client.id);
              const topReason = clientEntries.length > 0
                ? Object.entries(
                    clientEntries.reduce((acc: Record<string, number>, e) => { acc[e.reason] = (acc[e.reason] || 0) + 1; return acc; }, {})
                  ).sort((a, b) => b[1] - a[1])[0]?.[0]
                : null;

              return (
                <button
                  key={client.id}
                  onClick={() => onSelect(client.id)}
                  className="bg-white rounded-[10px] border text-left p-5 transition-all hover:shadow-sm group"
                  style={{ borderColor: "var(--border)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--teal2)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold text-white flex-shrink-0"
                      style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
                    >
                      {client.clientName.split(/\s+/).map((w: string) => w[0].toUpperCase()).slice(0, 2).join("")}
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>{client.clientName}</p>
                      {topReason && <p className="text-[11px]" style={{ color: "var(--text3)" }}>{topReason}</p>}
                    </div>
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <p
                        className="text-[28px] font-semibold leading-none"
                        style={{ color: missed > 0 ? "#E53E3E" : "var(--text1)" }}
                      >
                        {missed.toFixed(1)}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>hrs missed this month</p>
                    </div>
                    <div className="w-6 h-6 flex items-center justify-center rounded-full transition-colors" style={{ color: "var(--border2)" }}>
                      →
                    </div>
                  </div>

                  {/* Red progress bar (proportional to max 20 hrs/month) */}
                  <div className="mt-3">
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min((missed / 20) * 100, 100)}%`, background: missed > 0 ? "#E53E3E" : "var(--border2)" }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Client Detail ────────────────────────────────────────────────────────────

function ClientDetailView({
  client,
  allEntries,
  onBack,
  onEntriesChange,
}: {
  client: StoredClientProfile;
  allEntries: MissedEntry[];
  onBack: () => void;
  onEntriesChange: (entries: MissedEntry[]) => void;
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");

  const entries = allEntries.filter((e) => e.clientId === client.id);
  const now = new Date();
  const termEnd = now;
  const termStart = new Date(now);
  termStart.setMonth(termStart.getMonth() - 6);

  const hoursThisMonth = entries
    .filter((e) => { const d = new Date(e.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
    .reduce((sum, e) => sum + e.hours, 0);

  const hoursThisTerm = entries
    .filter((e) => { const d = new Date(e.date); return d >= termStart && d <= termEnd; })
    .reduce((sum, e) => sum + e.hours, 0);

  const reasonCounts: Record<string, number> = {};
  for (const e of entries) { reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1; }
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

  const canLog = date !== "" && reason !== "" && Number(hours) > 0;

  function handleLog() {
    if (!canLog) return;
    const entry: MissedEntry = {
      id: crypto.randomUUID(),
      clientId: client.id,
      clientName: client.clientName,
      date, reason, hours: Number(hours), notes: notes.trim(),
    };
    const updated = [entry, ...allEntries];
    saveEntries(updated);
    onEntriesChange(updated);
    setDate(""); setReason(""); setHours(""); setNotes("");
  }

  function handleDelete(id: string) {
    if (!window.confirm("Delete this entry?")) return;
    const updated = allEntries.filter((e) => e.id !== id);
    saveEntries(updated);
    onEntriesChange(updated);
  }

  const INPUT_CLS = "w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 transition-colors";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <Topbar crumbs={[{ label: "Schedule", onClick: onBack }, { label: client.clientName }]} />

      <div className="px-8 py-7 max-w-5xl space-y-5">

        {/* Summary metric strip */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl p-5 text-center" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
            <p className="text-[28px] font-semibold leading-none mb-1" style={{ color: hoursThisMonth > 0 ? "#E53E3E" : "var(--text1)" }}>
              {hoursThisMonth.toFixed(1)}
            </p>
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>Hours Missed This Month</p>
          </div>
          <div className="rounded-xl p-5 text-center" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
            <p className="text-[28px] font-semibold leading-none mb-1" style={{ color: hoursThisTerm > 0 ? "#E53E3E" : "var(--text1)" }}>
              {hoursThisTerm.toFixed(1)}
            </p>
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>Hours Missed This Term</p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text3)" }}>{formatDate(termStart)} – {formatDate(termEnd)}</p>
          </div>
          <div className="rounded-xl p-5 text-center" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
            {topReason ? (
              <>
                <p className="text-[16px] font-semibold leading-snug mb-0.5" style={{ color: "var(--text1)" }}>{topReason[0]}</p>
                <p className="text-[12px]" style={{ color: "var(--text3)" }}>{topReason[1]} session{topReason[1] !== 1 ? "s" : ""} — Top Reason</p>
              </>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>No data yet</p>
            )}
          </div>
        </div>

        {/* Log form */}
        <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-[16px] font-semibold mb-5" style={{ color: "var(--text1)" }}>Log Missed Hours</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text3)" }}>Date</label>
              <input
                type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className={INPUT_CLS} style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text3)" }}>Hours Missed</label>
              <input
                type="number" value={hours} onChange={(e) => setHours(e.target.value)}
                min="0.5" step="0.5" placeholder="e.g. 2.0"
                className={INPUT_CLS} style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text3)" }}>Reason</label>
              <div className="flex flex-wrap gap-2">
                {REASON_OPTIONS.map((r) => (
                  <button
                    key={r} onClick={() => setReason(r)}
                    className="px-4 py-2 rounded-lg border text-[13px] font-medium transition-colors"
                    style={{
                      background: reason === r ? "var(--teal)" : "white",
                      borderColor: reason === r ? "var(--teal)" : "var(--border)",
                      color: reason === r ? "white" : "var(--text2)",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text3)" }}>Notes (optional)</label>
              <input
                type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional context..."
                className={INPUT_CLS} style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>
            <div className="md:col-span-2">
              <button
                onClick={handleLog} disabled={!canLog}
                className="px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                style={{ background: "var(--teal)" }}
              >
                Log Hours
              </button>
            </div>
          </div>
        </div>

        {/* Log table */}
        <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-[16px] font-semibold mb-4" style={{ color: "var(--text1)" }}>Hours Log</h2>
          {entries.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>No missed hours logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Date", "Reason", "Hours", "Notes", ""].map((h) => (
                      <th key={h} className="text-left py-3 pr-4 text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--text3)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="py-3 pr-4 text-[13px]" style={{ color: "var(--text2)" }}>{e.date}</td>
                      <td className="py-3 pr-4 text-[13px]" style={{ color: "var(--text2)" }}>{e.reason}</td>
                      <td className="py-3 pr-4 text-[13px] font-semibold" style={{ color: "#E53E3E" }}>{e.hours.toFixed(1)}</td>
                      <td className="py-3 pr-4 text-[13px]" style={{ color: "var(--text3)" }}>{e.notes || "—"}</td>
                      <td className="py-3">
                        <button
                          onClick={() => handleDelete(e.id)}
                          className="text-[12px] font-medium text-red-400 hover:text-red-600 transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Page Root ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [clients, setClients] = useState<StoredClientProfile[]>([]);
  const [entries, setEntries] = useState<MissedEntry[]>([]);
  const [showClientId, setShowClientId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setEntries(loadEntries());

    async function loadClients() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoaded(true); return; }

      const profession = user.user_metadata?.profession as string | undefined;
      const isBCBA = profession === 'BCBA' || profession === 'BCaBA';

      let rows: any[] = [];

      if (isBCBA) {
        const { data: links } = await supabase
          .from('bcba_clients')
          .select('client_id')
          .eq('bcba_id', user.id);

        const ids = (links || []).map((l: any) => l.client_id);
        if (ids.length > 0) {
          const { data } = await supabase
            .from('clients')
            .select('id, internal_code, clinical_profile')
            .in('id', ids);
          rows = data || [];
        }
      } else {
        const { data } = await supabase
          .from('clients')
          .select('id, clinical_profile')
          .or(`created_by.eq.${user.id},rbt_id.eq.${user.id}`);
        rows = data || [];
      }

      // Deduplicate by id (OR filter can return same row twice)
      const seen = new Set<string>();
      const unique = rows.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });

      setClients(unique.map((row) => ({
        id: row.id,
        clientName: row.clinical_profile?.name || row.internal_code || 'Unnamed Client',
        clinicalProfile: row.clinical_profile,
      })));
      setLoaded(true);
    }

    loadClients();
  }, []);

  const activeClient = clients.find((c) => c.id === showClientId) ?? null;

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading clients…</p>
    </div>;
  }

  if (activeClient) {
    return (
      <ClientDetailView
        client={activeClient}
        allEntries={entries}
        onBack={() => setShowClientId(null)}
        onEntriesChange={setEntries}
      />
    );
  }

  return (
    <ClientSelectionView
      clients={clients}
      entries={entries}
      onSelect={setShowClientId}
    />
  );
}
