"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { isAssessmentBuilderRole } from "@/lib/assessmentAccess";

// Assessment Builder LANDING — the sidebar "Assessment Builder" item lands here. /assessment/[clientId] needs
// a client, so this is the minimal client-picker step: it lists the BCBA's clients (same source as the BCBA
// portal, /api/bcba/clients), each linking to that client's Assessment overview. BCBA-only, mirroring the
// [clientId] page gate (server routes enforce it too). NOTE for Marlon: minimal sensible flow chosen — a
// client list first. If you'd rather it default to the most-recent client or a blank new-assessment, that's a
// follow-up decision.
interface PickerClient { id: string; client_name?: string; }

export default function AssessmentBuilderLanding() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const [clients, setClients] = useState<PickerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const allowed = isAssessmentBuilderRole((session?.user as any)?.role);
  useEffect(() => {
    if (authStatus === "loading") return;
    if (!allowed) router.replace("/clients");
  }, [authStatus, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true); setNotice("");
    try {
      const res = await fetch("/api/bcba/clients");
      const data = await res.json();
      if (!res.ok || data.error) { setNotice(data.error || "Failed to load clients."); setClients([]); }
      else setClients(Array.isArray(data.clients) ? data.clients : []);
    } catch { setNotice("Failed to load clients."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (authStatus !== "loading" && !allowed) return null;

  return (
    <div style={{ padding: 24, maxWidth: 760, fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Assessment Builder</h1>
      <p style={{ fontSize: 13, color: "var(--text3, #6B7280)", marginBottom: 16 }}>
        Choose a client to view and build their assessment. Only your clients appear here.
      </p>

      {notice && (
        <div style={{ padding: 12, borderRadius: 10, background: "#FEF3C7", color: "#92400E", fontSize: 13, marginBottom: 16 }}>{notice}</div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--text3, #6B7280)" }}>Loading…</p>
      ) : clients.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text3, #6B7280)" }}>No clients yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {clients.map((c) => (
            <Link key={c.id} href={`/assessment/${c.id}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border, #E5E7EB)", background: "white", textDecoration: "none", color: "inherit" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{c.client_name || "Unnamed client"}</span>
              <span style={{ fontSize: 13, color: "#1BA8A0" }}>Open overview →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
