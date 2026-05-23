"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getClientProfiles, deleteClientProfile } from "@/lib/clientStorage";

const AVATAR_COLORS = ["#1BA8A0", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981"];

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join("");
}

type Filter = "all" | "active" | "inactive";

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  function handleDeleteClient(clientId: string) {
    if (!window.confirm("Are you sure you want to delete this client profile?")) return;
    deleteClientProfile(clientId);
    setClients((prev) => prev.filter((c) => c.id !== clientId));
  }

  useEffect(() => {
    setClients(getClientProfiles());

    const testSupabaseConnection = async () => {
      try {
        const { data, error } = await supabase.from("behaviors").select("*");
        if (error) {
          console.error("❌ Supabase error:", error.message);
        } else {
          console.log("✅ Supabase connection successful. Behaviors fetched:", data);
        }
      } catch (err) {
        console.error("❌ Connection error:", err);
      }
    };
    testSupabaseConnection();
    setLoaded(true);
  }, []);

  const filtered = clients.filter((c) =>
    c.clientName.toLowerCase().includes(search.toLowerCase())
  );

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "All Clients" },
    { key: "active", label: "Active" },
    { key: "inactive", label: "Inactive" },
  ];

  const tabCount = (key: Filter) => {
    if (key === "all") return clients.length;
    if (key === "active") return clients.length;
    return 0;
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Topbar */}
      <div
        className="flex items-center justify-between px-8 h-14 bg-white"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Clients</p>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text3)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-[220px] pl-9 pr-4 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text1)" }}
            />
          </div>
          <Link
            href="/upload-assessment"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--teal)" }}
          >
            + New Client
          </Link>
        </div>
      </div>

      <div className="px-8 py-7">
        {/* Title */}
        <h1 className="text-xl font-semibold mb-0.5" style={{ color: "var(--text1)" }}>Clients</h1>
        <p className="text-[13.5px] mb-5" style={{ color: "var(--text3)" }}>Manage and view all your clients</p>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map(({ key, label }) => {
            const active = filter === key;
            const count = tabCount(key);
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-colors"
                style={{
                  background: active ? "var(--teal-light)" : "white",
                  borderColor: active ? "var(--teal)" : "var(--border)",
                  color: active ? "var(--teal)" : "var(--text2)",
                }}
              >
                {label}
                <span
                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: active ? "var(--teal)" : "var(--border)", color: active ? "white" : "var(--text3)" }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {!loaded ? (
          <div className="bg-white rounded-xl p-10 text-center" style={{ color: "var(--text3)" }}>
            Loading client profiles...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl p-10 text-center" style={{ color: "var(--text3)", borderColor: "var(--border)" }}>
            {clients.length === 0 ? "No client profiles yet." : "No clients match your search."}
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {filtered.map((client, idx) => {
              const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];
              const initials = getInitials(client.clientName);
              const behaviorCount = client.clinicalProfile?.maladaptiveBehaviors?.length || 0;
              const interventionCount = client.clinicalProfile?.interventions?.length || 0;
              const skillCount = (client.clinicalProfile?.skillAcquisition?.length || 0) + (client.clinicalProfile?.replacementBehaviors?.length || 0);
              const reinforcerCount = client.clinicalProfile?.reinforcers?.length || 0;

              return (
                <div
                  key={client.id}
                  className="bg-white rounded-[10px] border overflow-hidden flex flex-col transition-all cursor-pointer group"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => { window.location.href = `/clients/${client.id}`; }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--teal2)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px #24BDB440, 0 4px 12px rgba(27,168,160,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                  }}
                >
                  {/* Gradient top bar */}
                  <div className="h-[3px] w-full" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />

                  <div className="p-5 flex flex-col flex-1">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-[14px] font-semibold text-white flex-shrink-0"
                        style={{ background: color }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold truncate" style={{ color: "var(--text1)" }}>
                          {client.clientName}
                        </p>
                        <p className="text-[11px]" style={{ color: "var(--text3)" }}>
                          #{client.id.slice(0, 6).toUpperCase()}
                        </p>
                      </div>
                    </div>

                    {/* Meta grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4 flex-1">
                      {[
                        { label: "Behaviors", value: behaviorCount },
                        { label: "Interventions", value: interventionCount },
                        { label: "Skills", value: skillCount },
                        { label: "Reinforcers", value: reinforcerCount },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5 font-medium" style={{ color: "var(--text3)" }}>{label}</p>
                          <p className="text-[12.5px] font-medium" style={{ color: "var(--text1)" }}>{value}</p>
                        </div>
                      ))}
                      <div>
                        <p className="text-[10px] uppercase tracking-wide mb-0.5 font-medium" style={{ color: "var(--text3)" }}>Status</p>
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: "#E6F9F5", color: "#0D8A6A" }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          Active
                        </span>
                      </div>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteClient(client.id); }}
                      className="mt-auto text-[12px] font-medium text-red-400 hover:text-red-600 self-start transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
