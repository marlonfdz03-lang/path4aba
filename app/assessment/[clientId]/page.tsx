"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { isAssessmentBuilderRole } from "@/lib/assessmentAccess";

// Assessment Builder — OVERVIEW DASHBOARD (Part 3b). Section-by-section traffic-light status for an
// assessment, computed deterministically server-side (see lib/assessmentStatus.ts — no LLM, no clinical
// judgment). This is the first piece of the Builder; today it reads the client's current clinical_profile.
// When the Builder's draft-assessment model (design spec 3a) is approved, the API swaps its source and this
// page is unchanged.

type Status = "green" | "yellow" | "red";
interface SectionStatus {
  key: string; label: string; status: Status;
  present: boolean; missing: string[]; issues: string[]; advisories: string[];
}
interface Overview {
  sections: SectionStatus[];
  overallPct: number; redCount: number; yellowCount: number;
  judgmentDeferred: string[];
  error?: string;
}

const LIGHT: Record<Status, { dot: string; bg: string; border: string; label: string }> = {
  green:  { dot: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0", label: "Complete" },
  yellow: { dot: "#D97706", bg: "#FFFBEB", border: "#FDE68A", label: "Needs attention" },
  red:    { dot: "#DC2626", bg: "#FEF2F2", border: "#FECACA", label: "Missing / problems" },
};

export default function AssessmentOverviewPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  // BCBA-ONLY: the Builder lives in the BCBA's area — RBTs have no access. Redirect a non-BCBA away (the
  // server route enforces the same rule, so this is just to avoid rendering a page they can't use). Matches the
  // wrong-role redirect convention used in app/clients/page.tsx.
  const allowed = isAssessmentBuilderRole((session?.user as any)?.role);
  useEffect(() => {
    if (authStatus === "loading") return;
    if (!allowed) router.replace("/clients");
  }, [authStatus, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true); setNotice("");
    try {
      const res = await fetch(`/api/assessment/${clientId}/overview`);
      const d = await res.json();
      if (!res.ok || d.error) { setNotice(d.error || "Failed to load."); setData(null); }
      else setData(d);
    } catch { setNotice("Failed to load the overview."); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  // Non-BCBA: render nothing while the redirect above runs (server route also denies).
  if (authStatus !== "loading" && !allowed) return null;

  const pct = data?.overallPct ?? 0;
  const barColor = pct >= 80 ? "#16A34A" : pct >= 50 ? "#D97706" : "#DC2626";

  return (
    <div style={{ padding: 24, maxWidth: 860, fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Assessment overview</h1>
        <a href={`/clients/${clientId}`} style={{ fontSize: 13, color: "#1BA8A0" }}>← Back to client</a>
      </div>
      <p style={{ fontSize: 13, color: "var(--text3, #6B7280)", marginBottom: 16 }}>
        <strong>Structural readiness</strong> of the assessment, computed automatically from the data present.
        Green / Yellow / Red reflect whether required fields are <strong>present and internally consistent</strong> —
        these are mechanical checks, <strong>not a clinical review</strong> and not a judgment of whether the content
        is correct. A section can be green while its content is still clinically unverified.
      </p>

      {notice && (
        <div style={{ padding: 12, borderRadius: 10, background: "#FEF3C7", color: "#92400E", fontSize: 13, marginBottom: 16 }}>{notice}</div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--text3, #6B7280)" }}>Loading…</p>
      ) : data ? (
        <>
          {/* overall completion */}
          <div style={{ border: "1px solid var(--border, #E5E7EB)", borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Structural completeness</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: barColor }}>{pct}%</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "#F1F5F9", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: barColor, transition: "width .3s" }} />
            </div>
            <p style={{ fontSize: 12, color: "var(--text3, #6B7280)", marginTop: 8 }}>
              {data.redCount} section{data.redCount === 1 ? "" : "s"} missing/with problems · {data.yellowCount} needing attention
            </p>
            <p style={{ fontSize: 12, color: "var(--text3, #9CA3AF)", marginTop: 6 }}>
              This is <strong>required-field presence and internal consistency</strong> — not clinical correctness or
              content quality. A profile can reach 100% while still containing unverified functions or definitions
              that only a clinician can confirm.
            </p>
          </div>

          {/* sections */}
          <div style={{ display: "grid", gap: 10 }}>
            {data.sections.map((s) => {
              const l = LIGHT[s.status];
              return (
                <div key={s.key} style={{ border: `1px solid ${l.border}`, background: l.bg, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 999, background: l.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{s.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: l.dot, textTransform: "uppercase", letterSpacing: ".04em" }}>{l.label}</span>
                  </div>
                  {(s.missing.length > 0 || s.issues.length > 0 || s.advisories.length > 0) && (
                    <ul style={{ margin: "10px 0 0", paddingLeft: 26, display: "grid", gap: 4 }}>
                      {s.missing.map((m, i) => (
                        <li key={`m${i}`} style={{ fontSize: 13, color: "#B91C1C" }}>Missing: {m}</li>
                      ))}
                      {s.issues.map((m, i) => (
                        <li key={`i${i}`} style={{ fontSize: 13, color: "#92400E" }}>{m}</li>
                      ))}
                      {s.advisories.map((m, i) => (
                        <li key={`a${i}`} style={{ fontSize: 13, color: "#6B7280", fontStyle: "italic" }}>Review: {m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {/* judgment-deferred */}
          {data.judgmentDeferred?.length > 0 && (
            <div style={{ marginTop: 22, border: "1px dashed var(--border, #E5E7EB)", borderRadius: 10, padding: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text2, #4B5563)", marginBottom: 6 }}>
                Not checked here (needs clinical judgment — not mechanical)
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                {data.judgmentDeferred.map((j, i) => (
                  <li key={i} style={{ fontSize: 12, color: "var(--text3, #6B7280)" }}>{j}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
