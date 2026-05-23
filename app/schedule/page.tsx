"use client";

import { useEffect, useState } from "react";
import { getClientProfiles, StoredClientProfile } from "@/lib/clientStorage";

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
  try {
    return JSON.parse(localStorage.getItem("missedHours") || "[]");
  } catch {
    return [];
  }
}

function saveEntries(entries: MissedEntry[]) {
  localStorage.setItem("missedHours", JSON.stringify(entries));
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Client Selection ──────────────────────────────────────────────────────────

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
        return (
          e.clientId === clientId &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      })
      .reduce((sum, e) => sum + e.hours, 0);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-10 text-black">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="bg-white rounded-3xl shadow p-8">
          <h1 className="text-4xl font-bold mb-1">Schedule & Hours Tracker</h1>
          <p className="text-gray-500">Select a client to view or log missed hours</p>
        </div>

        {clients.length === 0 ? (
          <div className="bg-white rounded-3xl shadow p-10 text-center text-gray-400">
            <p className="text-lg font-medium">No clients found.</p>
            <p className="text-sm mt-1">Add clients from the Clients page first.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client) => {
              const missed = hoursThisMonth(client.id);
              return (
                <button
                  key={client.id}
                  onClick={() => onSelect(client.id)}
                  className="bg-white rounded-3xl shadow p-6 text-left hover:shadow-md hover:-translate-y-0.5 transition-all group"
                >
                  <p className="font-bold text-lg leading-snug mb-3 group-hover:text-black">
                    {client.clientName}
                  </p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide">This Month</p>
                      <p className="text-3xl font-bold mt-0.5">
                        {missed.toFixed(1)}
                        <span className="text-sm font-normal text-gray-500 ml-1">hrs missed</span>
                      </p>
                    </div>
                    <span className="text-gray-300 group-hover:text-gray-500 text-2xl transition-colors">→</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Client Detail ─────────────────────────────────────────────────────────────

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
    .filter((e) => {
      const d = new Date(e.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, e) => sum + e.hours, 0);

  const hoursThisTerm = entries
    .filter((e) => {
      const d = new Date(e.date);
      return d >= termStart && d <= termEnd;
    })
    .reduce((sum, e) => sum + e.hours, 0);

  const reasonCounts: Record<string, number> = {};
  for (const e of entries) {
    reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1;
  }
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

  const canLog = date !== "" && reason !== "" && Number(hours) > 0;

  function handleLog() {
    if (!canLog) return;
    const entry: MissedEntry = {
      id: crypto.randomUUID(),
      clientId: client.id,
      clientName: client.clientName,
      date,
      reason,
      hours: Number(hours),
      notes: notes.trim(),
    };
    const updated = [entry, ...allEntries];
    saveEntries(updated);
    onEntriesChange(updated);
    setDate("");
    setReason("");
    setHours("");
    setNotes("");
  }

  function handleDelete(id: string) {
    if (!window.confirm("Delete this entry?")) return;
    const updated = allEntries.filter((e) => e.id !== id);
    saveEntries(updated);
    onEntriesChange(updated);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-10 text-black">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white rounded-3xl shadow p-8">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-black mb-4 transition-colors"
          >
            ← All Clients
          </button>
          <h1 className="text-4xl font-bold">{client.clientName}</h1>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-3xl shadow p-6">
            <p className="text-sm text-gray-500 mb-1">Hours Missed This Month</p>
            <p className="text-4xl font-bold">{hoursThisMonth.toFixed(1)}</p>
          </div>

          <div className="bg-white rounded-3xl shadow p-6">
            <p className="text-sm text-gray-500 mb-1">Hours Missed This Term</p>
            <p className="text-4xl font-bold">{hoursThisTerm.toFixed(1)}</p>
            <p className="text-xs text-gray-400 mt-1">
              Term: {formatDate(termStart)} – {formatDate(termEnd)}
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow p-6">
            <p className="text-sm text-gray-500 mb-2">Top Reason</p>
            {topReason ? (
              <>
                <p className="text-xl font-bold leading-snug">{topReason[0]}</p>
                <p className="text-sm text-gray-400 mt-1">{topReason[1]} session{topReason[1] !== 1 ? "s" : ""}</p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">No data yet</p>
            )}
          </div>
        </div>

        {/* Log Form */}
        <div className="bg-white rounded-3xl shadow p-6">
          <h2 className="text-2xl font-bold mb-6">Log Missed Hours</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            <div>
              <label className="block text-sm font-bold mb-2">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border p-3 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-sm font-bold mb-2">Hours Missed</label>
              <input
                type="number"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                min="0.5"
                step="0.5"
                placeholder="e.g. 2.0"
                className="w-full border p-3 rounded-xl"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-bold mb-2">Reason</label>
              <div className="flex flex-wrap gap-2">
                {REASON_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                      reason === r
                        ? "bg-black text-white border-black"
                        : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-bold mb-2">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional context..."
                className="w-full border p-3 rounded-xl"
              />
            </div>

            <div className="md:col-span-2">
              <button
                onClick={handleLog}
                disabled={!canLog}
                className={`px-8 py-3 rounded-2xl text-white font-semibold transition-opacity ${
                  canLog
                    ? "bg-black cursor-pointer hover:opacity-80"
                    : "bg-gray-400 cursor-not-allowed"
                }`}
              >
                Log Hours
              </button>
            </div>

          </div>
        </div>

        {/* Log Table */}
        <div className="bg-white rounded-3xl shadow p-6">
          <h2 className="text-2xl font-bold mb-4">Hours Log</h2>

          {entries.length === 0 ? (
            <p className="text-gray-500">No missed hours logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 pr-4 font-bold text-gray-600">Date</th>
                    <th className="text-left py-3 pr-4 font-bold text-gray-600">Reason</th>
                    <th className="text-left py-3 pr-4 font-bold text-gray-600">Hours</th>
                    <th className="text-left py-3 pr-4 font-bold text-gray-600">Notes</th>
                    <th className="py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-3 pr-4 text-gray-700">{e.date}</td>
                      <td className="py-3 pr-4 text-gray-700">{e.reason}</td>
                      <td className="py-3 pr-4 font-semibold">{e.hours.toFixed(1)}</td>
                      <td className="py-3 pr-4 text-gray-500">{e.notes || "—"}</td>
                      <td className="py-3">
                        <button
                          onClick={() => handleDelete(e.id)}
                          className="text-red-500 hover:text-red-700 text-xs font-semibold px-3 py-1 rounded-lg hover:bg-red-50"
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
    </main>
  );
}

// ─── Page Root ─────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [clients, setClients] = useState<StoredClientProfile[]>([]);
  const [entries, setEntries] = useState<MissedEntry[]>([]);
  const [showClientId, setShowClientId] = useState<string | null>(null);

  useEffect(() => {
    setClients(getClientProfiles());
    setEntries(loadEntries());
  }, []);

  const activeClient = clients.find((c) => c.id === showClientId) ?? null;

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
