"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteClientProfile } from "@/lib/clientStorage";

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
            <p
              className="text-[11px] font-mono mt-0.5"
              style={{ color: "var(--text3)" }}
            >
              #{client.id.slice(0, 8).toUpperCase()}
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
  const [clients, setClients] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  async function handleDeleteClient(clientId: string) {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this client profile?"
    );
    if (!confirmDelete) return;
    deleteClientProfile(clientId);
    await supabase.from("clients").delete().eq("id", clientId);
    setClients((prev) => prev.filter((client) => client.id !== clientId));
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      console.log('[clients] user.id:', user?.id);

      if (!user) {
        console.log('[clients] No authenticated user, cannot fetch clients');
        setLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from("clients")
        .select("id, internal_code, clinical_profile, created_at")
        .or(`created_by.eq.${user.id},rbt_id.eq.${user.id},created_by.is.null`)
        .order("created_at", { ascending: false });

      console.log('[clients] Supabase fetch result:', { count: data?.length, error, userId: user.id });

      if (error) {
        console.error('[clients] Supabase fetch error:', error);
      }

      setClients(
        (data || []).map((row) => ({
          id: row.id,
          clientName: row.internal_code || 'Unnamed Client',
          clinicalProfile: row.clinical_profile,
        }))
      );
      setLoaded(true);
    }
    load();
  }, []);

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
          <a
            href="/upload-assessment"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: "var(--teal)" }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Client
          </a>
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
    </main>
  );
}
