"use client";

import { useEffect, useState } from "react";
import { type FieldworkType } from "@/lib/bcba-students/calculations";
import ComplianceChecklist from "./ComplianceChecklist";

interface Session {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  total_hours: number;
  independent_hours: number;
  activity_type: string;
  contact_type: string;
  session_note: string | null;
  supervisor_name: string | null;
}

interface Summary {
  total_independent_hours: number;
  total_supervised_hours: number;
  total_hours: number;
  supervisor_contacts: number;
  individual_contacts: number;
  group_contacts: number;
  client_observations: number;
  supervision_pct: number;
  mvf_signed: boolean;
  mvf_signed_at: string | null;
  is_eligible: boolean;
  ineligibility_reason: string | null;
}

interface Profile {
  fieldwork_type: string;
  certification_track: string | null;
  supervisor_name: string | null;
  supervisor_bacb_id: string | null;
  state_of_fieldwork: string | null;
  country_of_fieldwork: string | null;
  trainee_bacb_id: string | null;
}

interface Props {
  monthYear: string;
  summary: Summary | null;
  fieldworkType: FieldworkType;
  profile: Profile | null;
  traineeName: string;
  onClose: () => void;
  onMvfSigned: () => void;
}

const CONTACT_LABELS: Record<string, string> = {
  none: "Independent",
  individual_supervision: "Individual Supervision",
  group_supervision: "Group Supervision",
  client_observation: "Client Observation",
};

export default function MonthDrawer({ monthYear, summary, fieldworkType, profile, traineeName, onClose, onMvfSigned }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingMvf, setSigningMvf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingSupervisionId, setDownloadingSupervisionId] = useState<string | null>(null);

  const SUPERVISION_TYPES = new Set(["individual_supervision", "group_supervision", "client_observation"]);

  const monthLabel = new Date(monthYear + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  useEffect(() => {
    fetch(`/api/bcba-students/monthly/${monthYear}`)
      .then(r => r.json())
      .then(d => { setSessions(d.sessions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [monthYear]);

  async function handleSignMvf() {
    setSigningMvf(true);
    await fetch(`/api/bcba-students/monthly/${monthYear}/mvf`, { method: "POST" });
    setSigningMvf(false);
    onMvfSigned();
  }

  async function handleDownloadSupervisionPdf(session: Session) {
    if (!profile) return;
    setDownloadingSupervisionId(session.id);
    try {
      const { generateSupervisionPdf } = await import("@/lib/bcba-students/generateSupervisionPdf");
      // Daily independent hours = sum of independent_hours from all sessions on that date
      const independentHoursOnDate = sessions
        .filter(s => s.session_date === session.session_date)
        .reduce((sum, s) => sum + (s.independent_hours || 0), 0);
      const pdfBytes = await generateSupervisionPdf({
        traineeName,
        certificationTrack: profile.certification_track || "BCBA",
        sessionDate: session.session_date,
        startTime: session.start_time,
        endTime: session.end_time,
        contactType: session.contact_type as "individual_supervision" | "group_supervision" | "client_observation",
        sessionNote: session.session_note,
        supervisorName: session.supervisor_name || profile.supervisor_name || "",
        independentHoursOnDate,
        totalMonthHours: summary?.total_hours ?? 0,
      });
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = traineeName.replace(/\s+/g, "-") || "Trainee";
      a.download = `Supervision-Form-${session.session_date}-${safeName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Supervision PDF failed:", e);
    } finally {
      setDownloadingSupervisionId(null);
    }
  }

  async function handleDownloadMvf() {
    if (!summary || !profile) return;
    setDownloadingPdf(true);
    try {
      const { generateMvfPdf } = await import("@/lib/bcba-students/generateMvfPdf");
      const pdfBytes = await generateMvfPdf({
        traineeName,
        traineeBacbId: profile.trainee_bacb_id || "",
        monthLabel,
        fieldworkType: profile.fieldwork_type,
        state: profile.state_of_fieldwork || "",
        country: profile.country_of_fieldwork || "",
        supervisorName: profile.supervisor_name || "",
        supervisorBacbId: profile.supervisor_bacb_id || "",
        independentHours: summary.total_independent_hours,
        supervisedHours: summary.total_supervised_hours,
        totalHours: summary.total_hours,
        supervisionPct: summary.supervision_pct,
        isEligible: summary.is_eligible,
      });
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = traineeName.replace(/\s+/g, "-") || "Trainee";
      a.download = `M-FVF-${monthYear}-${safeName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PDF generation failed:", e);
    } finally {
      setDownloadingPdf(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["Date", "Start", "End", "Hours", "Activity", "Contact", "Note"],
      ...sessions.map(s => [
        s.session_date,
        s.start_time,
        s.end_time,
        s.total_hours.toFixed(2),
        s.activity_type,
        CONTACT_LABELS[s.contact_type] || s.contact_type,
        (s.session_note || "").replace(/,/g, ";"),
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fieldwork-${monthYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="flex-1" onClick={onClose} />
      <div className="w-full max-w-lg bg-white flex flex-col overflow-hidden" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>{monthLabel}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadMvf}
              disabled={downloadingPdf || !summary || !profile}
              className="text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--teal)" }}
            >
              {downloadingPdf ? "Generating…" : "Download M-FVF"}
            </button>
            <button onClick={exportCsv} className="text-[12px] font-medium hover:opacity-80" style={{ color: "var(--teal)" }}>
              Export CSV
            </button>
            <button onClick={onClose} className="text-[13px] hover:opacity-70" style={{ color: "var(--text3)" }}>Close</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Compliance */}
          <ComplianceChecklist month={summary} fieldworkType={fieldworkType} />

          {/* MVF */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid var(--border)" }}>
            <p className="text-[13px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Monthly Fieldwork Verification Form</p>
            {summary?.mvf_signed ? (
              <p className="text-[13px]" style={{ color: "#16A34A" }}>
                ✓ Signed {summary.mvf_signed_at ? new Date(summary.mvf_signed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
              </p>
            ) : (
              <>
                <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>
                  Mark as signed once your supervisor has completed the M-FVF for this month.
                </p>
                <button
                  onClick={handleSignMvf}
                  disabled={signingMvf}
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "var(--teal)" }}
                >
                  {signingMvf ? "Saving…" : "Mark M-FVF as Signed"}
                </button>
              </>
            )}
          </div>

          {/* Sessions list */}
          <div>
            <p className="text-[13px] font-semibold mb-3" style={{ color: "var(--text1)" }}>
              Sessions ({sessions.length})
            </p>
            {loading ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No sessions logged this month.</p>
            ) : (
              <div className="space-y-3">
                {sessions.map(s => {
                  const dateLabel = new Date(s.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  return (
                    <div key={s.id} className="rounded-xl p-4" style={{ border: "1px solid var(--border)" }}>
                      <div className="flex items-start justify-between mb-1">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                            {s.start_time} – {s.end_time} · {CONTACT_LABELS[s.contact_type] || s.contact_type}
                          </p>
                        </div>
                        <div className="flex items-start gap-3">
                          {SUPERVISION_TYPES.has(s.contact_type) && (
                            <button
                              onClick={() => handleDownloadSupervisionPdf(s)}
                              disabled={downloadingSupervisionId === s.id}
                              title="Download Supervision Form"
                              className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40 flex-shrink-0"
                              style={{ color: "var(--teal)", background: "rgba(27,168,160,0.08)", border: "1px solid rgba(27,168,160,0.2)" }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                              </svg>
                              {downloadingSupervisionId === s.id ? "…" : "Form"}
                            </button>
                          )}
                          <div className="text-right">
                            <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{s.total_hours.toFixed(2)} hrs</p>
                            <p className="text-[11px] capitalize" style={{ color: "var(--text3)" }}>{s.activity_type}</p>
                          </div>
                        </div>
                      </div>
                      {s.session_note && (
                        <p className="text-[12px] mt-2 leading-relaxed" style={{ color: "var(--text2)" }}>{s.session_note}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
