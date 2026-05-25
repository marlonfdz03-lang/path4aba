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
    const win = window.open('', '_blank');
    if (!win) { alert('Enable popups to download this form.'); return; }

    const sd = pdfData?.sessionDate || savedSession?.session_date || '';
    const sessionDate = sd
      ? new Date(sd + 'T00:00:00').toLocaleDateString('en-US')
      : new Date().toLocaleDateString('en-US');

    function fmtT(t: string) {
      const [h, m] = t.split(':').map(Number);
      return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    const st = pdfData?.startTime || savedSession?.start_time || '';
    const et = pdfData?.endTime || savedSession?.end_time || '';
    let duration = '___';
    if (st && et) {
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      const h = Math.floor(mins / 60), m = mins % 60;
      duration = `${fmtT(st)} – ${fmtT(et)} (${h}h${m > 0 ? ` ${m}min` : ''})`;
    }

    const ct = savedSession?.contact_type || '';
    const ctLabel = CONTACT_LABELS[ct] || '___';
    const groupNoteHtml = ct === 'group_supervision'
      ? '<p style="font-size:11px;color:#666;margin-top:4px;font-style:italic;">Group supervision session — maximum 10 trainees per BACB requirements.</p>'
      : '';

    const superviseeNameValue = pdfData?.traineeName || traineeName || '___';
    const supName = pdfData?.supervisorName || supervisorName || '___';
    const indep = (savedSession?.independent_hours ?? 0).toFixed(2);
    const sup = (savedSession?.supervised_hours ?? 0).toFixed(2);
    const totalHoursAccumulated = (pdfData?.totalMonthHours ?? 0).toFixed(2);
    const sessionNote = (pdfData?.sessionNote || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    win.document.write(`
      <html>
        <head>
          <title>Supervision Meeting Form</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; font-size: 13px; color: #000; }
            h1 { font-size: 16px; text-align: center; font-weight: bold; margin-bottom: 4px; }
            h2 { font-size: 13px; text-align: center; font-weight: normal; margin-bottom: 24px; }
            .row { display: flex; gap: 40px; margin-bottom: 16px; }
            .field { flex: 1; }
            .label { font-size: 10px; font-weight: bold; color: #555; margin-bottom: 2px; }
            .value { border-bottom: 1px solid #000; padding-bottom: 3px; min-height: 18px; }
            .section { margin-top: 20px; margin-bottom: 8px; font-weight: bold; font-size: 12px; border-bottom: 2px solid #000; padding-bottom: 3px; }
            .textarea { border: 1px solid #000; min-height: 80px; width: 100%; margin-top: 4px; padding: 8px; box-sizing: border-box; white-space: pre-wrap; }
            .sig-row { display: flex; gap: 40px; margin-top: 32px; }
            .sig { flex: 1; border-top: 1px solid #000; padding-top: 4px; font-size: 11px; }
            @media print { body { padding: 0.5in; } input[type="checkbox"] { -webkit-print-color-adjust: exact; } }
          </style>
        </head>
        <body>
          <h1>SUPERVISION MEETING FORM</h1>
          <h2>BCBA Fieldwork Documentation — Path4ABA</h2>
          <div class="row">
            <div class="field"><div class="label">Name of Supervisee</div><div class="value">${superviseeNameValue}</div></div>
            <div class="field"><div class="label">Certification Seeking</div><div class="value">${certificationTrack}</div></div>
          </div>
          <div class="row">
            <div class="field"><div class="label">Date of Supervision</div><div class="value">${sessionDate}</div></div>
            <div class="field"><div class="label">Duration of Supervision</div><div class="value">${duration}</div></div>
          </div>
          <div class="row">
            <div class="field"><div class="label">Meeting Format</div><div class="value">${ctLabel}${groupNoteHtml}</div></div>
            <div class="field"><div class="label">Total Hours Accumulated (This Month)</div><div class="value">${totalHoursAccumulated}</div></div>
          </div>
          <div class="row">
            <div class="field"><div class="label">Independent Hours (this session)</div><div class="value">${indep}</div></div>
            <div class="field"><div class="label">Supervised Hours (this session)</div><div class="value">${sup}</div></div>
          </div>
          <div class="section">Activities Conducted</div>
          <div class="textarea">${sessionNote}</div>
          <div class="section">Supervisee Performance Feedback</div>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:10px;font-size:13px;">
            <label style="display:flex;align-items:center;gap:10px;"><input type="checkbox" style="width:14px;height:14px;flex-shrink:0;" /> Appropriate implementation of procedures</label>
            <label style="display:flex;align-items:center;gap:10px;"><input type="checkbox" style="width:14px;height:14px;flex-shrink:0;" /> Accurate data collection</label>
            <label style="display:flex;align-items:center;gap:10px;"><input type="checkbox" style="width:14px;height:14px;flex-shrink:0;" /> Maintained treatment integrity</label>
            <label style="display:flex;align-items:center;gap:10px;"><input type="checkbox" style="width:14px;height:14px;flex-shrink:0;" /> Professional interaction and participation</label>
          </div>
          <div class="sig-row">
            <div class="sig">Supervisor Name: ${supName}<br/><br/>Supervisor Signature: _____________________________ &nbsp;&nbsp; Date: ___________</div>
          </div>
          <script>window.print();<\/script>
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
