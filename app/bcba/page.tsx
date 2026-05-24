"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface BCBAClient {
  id: string;
  client_name: string;
  diagnosis: string[];
  connected_at: string;
  rbt_id: string;
}

function Topbar({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex items-center justify-between px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-medium" style={{ color: "var(--text1)" }}>My Clients</span>
      </div>
      <button
        onClick={onConnect}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
        style={{ background: "var(--teal)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Connect Client
      </button>
    </div>
  );
}

function ConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: (client: BCBAClient) => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect() {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clients/connect-with-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to connect"); setLoading(false); return; }
      onConnected(data.client);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
        <h2 className="text-[18px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Connect a Client</h2>
        <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>
          Ask your RBT to generate a client code from their client profile, then enter it below.
        </p>
        <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Client Code</label>
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
          placeholder="e.g. AB-123456"
          className="w-full border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 mb-3 uppercase tracking-widest"
          style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
          autoFocus
        />
        {error && (
          <p className="text-[12px] mb-3 px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={handleConnect}
            disabled={loading || !code.trim()}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--teal)" }}
          >
            {loading ? "Connecting…" : "Connect"}
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientCard({ client }: { client: BCBAClient }) {
  const connectedDate = new Date(client.connected_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <Link href={`/bcba/${client.id}`}>
      <div
        className="bg-white rounded-xl p-5 border cursor-pointer transition-shadow hover:shadow-md"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-start justify-between mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
          >
            {client.client_name?.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
          </div>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(27,168,160,0.12)", color: "var(--teal)" }}>
            Connected
          </span>
        </div>
        <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>{client.client_name}</p>
        <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>
          {client.diagnosis?.join(", ") || "ASD"}
        </p>
        <p className="text-[11px]" style={{ color: "var(--text3)" }}>Connected {connectedDate}</p>
      </div>
    </Link>
  );
}

export default function BCBADashboard() {
  const router = useRouter();
  const [clients, setClients] = useState<BCBAClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
      fetchClients(data.user.id);
    });
  }, []);

  async function fetchClients(userId: string) {
    const { data } = await supabase
      .from("bcba_clients")
      .select("client_id, rbt_id, connected_at, clients(id, client_name, diagnosis)")
      .eq("bcba_id", userId)
      .order("connected_at", { ascending: false });

    const mapped = (data || []).map((row: any) => ({
      id: row.client_id,
      client_name: row.clients?.client_name || "Unknown Client",
      diagnosis: row.clients?.diagnosis || [],
      connected_at: row.connected_at,
      rbt_id: row.rbt_id,
    }));
    setClients(mapped);
    setLoading(false);
  }

  function handleConnected(client: BCBAClient) {
    setShowModal(false);
    setClients(prev => [client, ...prev]);
    if (client?.id) router.push(`/bcba/${client.id}`);
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <Topbar onConnect={() => setShowModal(true)} />

      <div className="px-8 py-8 max-w-5xl">
        {loading ? (
          <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
        ) : clients.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(27,168,160,0.1)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <p className="text-[15px] font-semibold mb-2" style={{ color: "var(--text1)" }}>No clients connected yet</p>
            <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>
              Ask your RBT for a client code, then click "Connect Client" above.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="px-6 py-2.5 rounded-xl text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: "var(--teal)" }}
            >
              Connect Client
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map(c => <ClientCard key={c.id} client={c} />)}
          </div>
        )}
      </div>

      {showModal && (
        <ConnectModal onClose={() => setShowModal(false)} onConnected={handleConnected} />
      )}
    </main>
  );
}
