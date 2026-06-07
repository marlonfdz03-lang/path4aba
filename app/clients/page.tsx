"use client";

export const dynamic = "force-dynamic";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteClientProfile } from "@/lib/clientStorage";
import { ConnectModal } from "@/app/components/ConnectModal";

const AVATAR_COLORS = ["#1BA8A0", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981"];

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");
}

function ClientCard({
  client,
  index,
  onDelete,
}: {
  client: any;
  index: number;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const profile = client.clinicalProfile || {};

  const maladaptives = profile.maladaptiveBehaviors?.length || 0;
  const interventions = profile.interventions?.length || 0;
  const skills =
    (profile.skillAcquisition?.length || 0) +
    (profile.replacementBehaviors?.length || 0);
  const replacements = profile.replacementBehaviors?.length || 0;

  return (
    <div
      className="bg-white flex flex-col transition-all"
      style={{
        border: "1px solid #E2E8F0",
        borderRadius: 10,
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#24BDB4";
        (e.currentTarget as HTMLElement).style.boxShadow =
          "0 0 0 3px rgba(36,189,180,0.12)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#E2E8F0";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      {/* Top colored bar */}
      <div
        style={{
          height: 3,
          background: "linear-gradient(90deg, #1BA8A0, #4AB5E3)",
        }}
      />

      <div className="p-5 flex flex-col flex-1">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold text-white flex-shrink-0"
            style={{ background: color }}
          >
            {getInitials(client.clientName)}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[14px] font-semibold truncate"
              style={{ color: "var(--text1)" }}
            >
              {client.clientName}
            </p>
          </div>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ background: "#E6F9F5", color: "#0D8A6A" }}
          >
            Active
          </span>
        </div>

        {/* Meta grid 2×2 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
          {[
            { label: "Maladaptives", value: maladaptives },
            { label: "Interventions", value: interventions },
            { label: "Skills", value: skills },
            { label: "Replacements", value: replacements },
          ].map(({ label, value }) => (
            <div key={label}>
              <p
                className="text-[10px] uppercase tracking-wide font-medium mb-0.5"
                style={{ color: "var(--text3)" }}
              >
                {label}
              </p>
              <p
                className="text-[13px] font-semibold"
                style={{ color: "var(--text1)" }}
              >
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Hours progress bar */}
        <div className="mb-5">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[11px]" style={{ color: "var(--text3)" }}>
              Hours this week
            </span>
            <span
              className="text-[11px] font-medium"
              style={{ color: "var(--text2)" }}
            >
              0 / 10
            </span>
          </div>
          <div
            className="rounded-full overflow-hidden"
            style={{ height: 4, background: "#F1F5F9" }}
          >
            <div
              style={{
                width: "0%",
                height: "100%",
                background: "linear-gradient(90deg, #1BA8A0, #4AB5E3)",
                borderRadius: 9999,
              }}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-auto">
          <button
            onClick={() => router.push(`/clients/${client.id}`)}
            className="flex-1 py-2 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--teal)" }}
          >
            Open Profile
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(client.id);
            }}
            className="px-3 py-2 rounded-lg text-[13px] font-semibold border transition-colors hover:bg-red-50"
            style={{ borderColor: "#FCA5A5", color: "#EF4444" }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [clients, setClients] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientFile, setNewClientFile] = useState<File | null>(null);
  const [newClientExtracting, setNewClientExtracting] = useState(false);
  const [newClientError, setNewClientError] = useState("");
  const [newClientSuccess, setNewClientSuccess] = useState(false);

  async function handleDeleteClient(clientId: string) {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this client profile?"
    );
    if (!confirmDelete) return;
    deleteClientProfile(clientId);
    await fetch(`/api/clients?id=${clientId}`, { method: "DELETE" });
    setClients((prev) => prev.filter((client) => client.id !== clientId));
  }

  useEffect(() => {
    if (status === "loading") return;

    const role = ((session?.user as any)?.role || "").toLowerCase();
    if (role === "bcba" || role === "bcaba") {
      router.push("/bcba");
      return;
    }

    async function load() {
      const res = await fetch("/api/clients");
      const data = await res.json();
      setClients(
        (Array.isArray(data) ? data : []).map((row: any) => ({
          id: row.id,
          clientName: row.clinical_profile?.name || row.internal_code || "Unnamed Client",
          clinicalProfile: row.clinical_profile,
        }))
      );
      setLoaded(true);
    }
    load();
  }, [session, status]);

  if (status === "loading") return null;

  async function handleCreateClient() {
    if (!newClientFile) return;
    setNewClientExtracting(true);
    setNewClientError("");
    setNewClientSuccess(false);
    try {
      const formData = new FormData();
      formData.append("file", newClientFile);
      const res = await fetch("/api/rbt/clients/create", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNewClientError(data.error || "Failed to create client.");
        return;
      }
      setNewClientSuccess(true);
      setTimeout(() => {
        setShowNewClientModal(false);
        setNewClientFile(null);
        setNewClientSuccess(false);
        window.location.reload();
      }, 1500);
    } catch {
      setNewClientError("Network error. Please try again.");
    } finally {
      setNewClientExtracting(false);
    }
  }

  const filtered = filter === "inactive" ? [] : clients;

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="px-8 py-7 max-w-6xl">
        {/* Page header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1
              className="font-semibold mb-1"
              style={{ fontSize: 20, color: "var(--text1)" }}
            >
              Clients
            </h1>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>
              Manage and view all your clients
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConnectModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold border hover:opacity-80 transition-opacity"
              style={{ borderColor: "var(--teal)", color: "var(--teal)", background: "white" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Connect Client
            </button>
            <button
              onClick={() => setShowNewClientModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
              style={{ background: "var(--teal)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Client
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6">
          {(
            [
              { key: "all", label: `All Clients ${clients.length}` },
              { key: "active", label: `Active ${clients.length}` },
              { key: "inactive", label: "Inactive 0" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
              style={{
                background: filter === key ? "var(--teal)" : "white",
                color: filter === key ? "white" : "var(--text3)",
                border: `1px solid ${filter === key ? "var(--teal)" : "var(--border)"}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {!loaded ? (
          <p className="text-[13px]" style={{ color: "var(--text3)" }}>
            Loading clients…
          </p>
        ) : filtered.length === 0 ? (
          <div
            className="bg-white rounded-[10px] border p-10 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p
              className="text-[14px] font-medium mb-1"
              style={{ color: "var(--text1)" }}
            >
              {filter === "inactive" ? "No inactive clients" : "No clients yet"}
            </p>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>
              {filter !== "inactive" &&
                "Upload an assessment to create your first client profile."}
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            {filtered.map((client, i) => (
              <ClientCard
                key={client.id}
                client={client}
                index={i}
                onDelete={handleDeleteClient}
              />
            ))}
          </div>
        )}
      </div>

      {showConnectModal && (
        <ConnectModal
          onClose={() => setShowConnectModal(false)}
          onConnected={(client) => {
            setShowConnectModal(false);
            if (client?.id) router.push(`/clients/${client.id}`);
          }}
        />
      )}

      {showNewClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-semibold" style={{ color: "var(--text1)" }}>New Client</h2>
              <button onClick={() => { setShowNewClientModal(false); setNewClientFile(null); setNewClientError(""); }} className="text-[20px] leading-none hover:opacity-60" style={{ color: "var(--text3)" }}>×</button>
            </div>
            <p className="text-[13px] mb-4" style={{ color: "var(--text2)" }}>Upload your client's ABA assessment PDF. The system will automatically extract behaviors, skills, interventions, and reinforcers.</p>
            <label className="block w-full border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-teal-400 transition-colors mb-4" style={{ borderColor: newClientFile ? "var(--teal)" : "var(--border2)" }}>
              <input type="file" accept=".pdf" className="hidden" onChange={e => setNewClientFile(e.target.files?.[0] || null)} />
              {newClientFile ? (
                <p className="text-[13px] font-medium" style={{ color: "var(--teal)" }}>✓ {newClientFile.name}</p>
              ) : (
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>Click to upload PDF assessment</p>
              )}
            </label>
            {newClientError && <p className="text-[12px] mb-3 px-3 py-2 rounded-lg" style={{ background: "#fef2f2", color: "#991b1b" }}>{newClientError}</p>}
            {newClientSuccess && <p className="text-[12px] mb-3 px-3 py-2 rounded-lg" style={{ background: "#f0fdf4", color: "#166534" }}>✓ Client created successfully!</p>}
            <button
              onClick={handleCreateClient}
              disabled={!newClientFile || newClientExtracting}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50 transition-opacity"
              style={{ background: "var(--teal)" }}
            >
              {newClientExtracting ? "Extracting assessment…" : "Create Client"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
