"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { type FieldworkType } from "@/lib/bcba-students/calculations";
import LogSessionForm, { type SavedSession } from "@/app/components/bcba-students/LogSessionForm";
import type { SupervisionPdfData } from "@/lib/bcba-students/generateSupervisionPdf";

const SUPERVISION_TYPES = new Set(["individual_supervision", "group_supervision", "client_observation"]);

const CONTACT_LABELS: Record<string, string> = {
  individual_supervision: "Individual Supervision",
  group_supervision: "Group Supervision",
  client_observation: "Client Observation",
};

export default function LogSessionPage() {
  const router = useRouter();
  const [fieldworkType, setFieldworkType] = useState<FieldworkType>("supervised");
  const [supervisorName, setSupervisorName] = useState("");
  const [traineeName, setTraineeName] = useState("");
  const [certificationTrack, setCertificationTrack] = useState("BCBA");
  const [loading, setLoading] = useState(true);

  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);
  const [pdfData, setPdfData] = useState<SupervisionPdfData | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setTraineeName(user.user_metadata?.full_name || user.email?.split("@")[0] || "");
      const res = await fetch("/api/bcba-students/profile");
      const data = await res.json();
      if (data.profile) {
        setFieldworkType(data.profile.fieldwork_type || "supervised");
        setSupervisorName(data.profile.supervisor_name || "");
        setCertificationTrack(data.profile.certification_track || "BCBA");
      }
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleSaved(session: SavedSession) {
    setSavedSession(session);

    if (SUPERVISION_TYPES.has(session.contact_type)) {
      // Fetch data needed for the PDF (daily independent hours + monthly total)
      const monthYear = session.session_date.slice(0, 7);
      const [sessionsRes, summaryRes] = await Promise.all([
        fetch(`/api/bcba-students/sessions?monthYear=${monthYear}`),
        fetch("/api/bcba-students/monthly"),
      ]);
      const sessionsData = await sessionsRes.json();
      const summaryData = await summaryRes.json();

      const allSessions: Array<{ session_date: string; independent_hours: number }> = sessionsData.sessions || [];
      const independentHoursOnDate = allSessions
        .filter(s => s.session_date === session.session_date)
        .reduce((sum, s) => sum + (s.independent_hours || 0), 0);

      const monthSummary = (summaryData.summaries || []).find((s: { month_year: string }) => s.month_year === monthYear);

      setPdfData({
        traineeName,
        certificationTrack,
        sessionDate: session.session_date,
        startTime: session.start_time,
        endTime: session.end_time,
        contactType: session.contact_type as SupervisionPdfData["contactType"],
        sessionNote: session.session_note,
        supervisorName: session.supervisor_name || supervisorName,
        independentHoursOnDate,
        totalMonthHours: monthSummary?.total_hours ?? 0,
      });
    } else {
      router.refresh();
      router.push("/bcba-students");
    }
  }

  const handleDownloadSupervisionForm = () => {
    const sessionSupervisorName = pdfData?.supervisorName || supervisorName;
    const contactType = savedSession ? (CONTACT_LABELS[savedSession.contact_type] || savedSession.contact_type) : '';
    const duration = savedSession ? `${savedSession.start_time} – ${savedSession.end_time}` : '';

    const win = window.open('', '_blank');
    if (!win) {
      alert('Please allow popups for this site to download forms.');
      return;
    }
    win.document.write(`
      <html>
        <head>
          <title>Supervision Meeting Form</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; font-size: 13px; }
            h1 { font-size: 18px; text-align: center; }
            .field { margin: 16px 0; border-bottom: 1px solid #000; padding-bottom: 4px; }
            .label { font-weight: bold; font-size: 11px; color: #555; }
            @media print { body { font-family: Arial, sans-serif; font-size: 12px; } @page { margin: 1in; } }
          </style>
        </head>
        <body>
          <h1>Supervision Meeting Form</h1>
          <div class="field"><div class="label">Date of Supervision</div>${savedSession?.session_date || new Date().toLocaleDateString()}</div>
          <div class="field"><div class="label">Supervisor Name</div>${sessionSupervisorName || '_______________'}</div>
          <div class="field"><div class="label">Duration</div>${duration || '_______________'}</div>
          <div class="field"><div class="label">Meeting Format</div>${contactType || '_______________'}</div>
          <div class="field"><div class="label">Activities Conducted</div><br/><br/><br/></div>
          <div class="field"><div class="label">Supervisor Signature</div><br/><br/></div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  const isSupervisionSession = savedSession && SUPERVISION_TYPES.has(savedSession.contact_type);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      {/* Topbar */}
      <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link href="/bcba-students" className="hover:underline" style={{ color: "var(--text3)" }}>BCBA Students</Link>
        <span style={{ color: "var(--border2)" }}>/</span>
        <span className="font-medium" style={{ color: "var(--text1)" }}>Log Session</span>
      </div>

      <div className="px-8 py-8 max-w-2xl">
        {savedSession ? (
          <div className="bg-white rounded-xl p-8" style={{ border: "1px solid var(--border)" }}>
            {/* Success icon */}
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ background: "#DCFCE7" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-[16px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Session saved!</p>
              {isSupervisionSession ? (
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>
                  {CONTACT_LABELS[savedSession.contact_type]} — {savedSession.session_date}
                </p>
              ) : (
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>Redirecting to dashboard…</p>
              )}
            </div>

            {/* Supervision PDF download — only for supervision contact types */}
            {isSupervisionSession && (
              <>
                <div className="rounded-xl p-5 mb-5" style={{ background: "rgba(27,168,160,0.06)", border: "1px solid rgba(27,168,160,0.2)" }}>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(27,168,160,0.12)" }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] font-semibold mb-0.5" style={{ color: "var(--text1)" }}>Supervision Meeting Form ready</p>
                      <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                        Pre-filled with your session details. Print and sign with your supervisor.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleDownloadSupervisionForm}
                    className="mt-4 w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: "var(--teal)" }}
                  >
                    Download Supervision Form
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => { router.refresh(); router.push("/bcba-students"); }}
                    className="text-[13px] font-medium hover:underline"
                    style={{ color: "var(--text3)" }}
                  >
                    ← Back to Dashboard
                  </button>
                  <button
                    onClick={() => { setSavedSession(null); setPdfData(null); }}
                    className="text-[13px] font-medium hover:underline"
                    style={{ color: "var(--teal)" }}
                  >
                    Log another session
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl p-7" style={{ border: "1px solid var(--border)" }}>
            <h1 className="text-[18px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Log Fieldwork Session</h1>
            <p className="text-[13px] mb-7" style={{ color: "var(--text3)" }}>
              Record your hours. Compliance metrics update automatically.
            </p>
            <LogSessionForm
              fieldworkType={fieldworkType}
              defaultSupervisorName={supervisorName}
              onSaved={handleSaved}
            />
          </div>
        )}
      </div>
    </main>
  );
}
