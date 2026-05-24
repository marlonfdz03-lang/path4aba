"use client";

import { useEffect, useState, useRef } from "react";
import { type FieldworkType } from "@/lib/bcba-students/calculations";
import ComplianceChecklist from "./ComplianceChecklist";

interface Session {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  total_hours: number;
  independent_hours: number;
  supervised_hours: number;
  activity_type: string;
  contact_type: string;
  setting: string | null;
  supervisor_name: string | null;
  session_note: string | null;
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

const SETTINGS = ["Office", "Client home", "School", "Telehealth/Zoom", "Community", "Other"];

function toDecimalHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max(0, Math.round((mins / 60) * 100) / 100);
}

interface EditForm {
  session_date: string;
  start_time: string;
  end_time: string;
  activity_type: "unrestricted" | "restricted";
  contact_type: "none" | "individual_supervision" | "group_supervision" | "client_observation";
  setting: string;
  supervisor_name: string;
  session_note: string;
}

export default function MonthDrawer({ monthYear, summary: initialSummary, fieldworkType, profile, traineeName, onClose, onMvfSigned }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<Summary | null>(initialSummary);
  const [loading, setLoading] = useState(true);
  const [signingMvf, setSigningMvf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingSummary, setDownloadingSummary] = useState(false);
  const [downloadingSupervisionId, setDownloadingSupervisionId] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  // three-dot menu
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // edit state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const SUPERVISION_TYPES = new Set(["individual_supervision", "group_supervision", "client_observation"]);

  const monthLabel = new Date(monthYear + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  async function fetchSessions() {
    const res = await fetch(`/api/bcba-students/monthly/${monthYear}`);
    const d = await res.json();
    setSessions(d.sessions || []);
  }

  useEffect(() => {
    fetchSessions().then(() => setLoading(false)).catch(() => setLoading(false));
  }, [monthYear]);

  // Close three-dot menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSignMvf() {
    setSigningMvf(true);
    await fetch(`/api/bcba-students/monthly/${monthYear}/mvf`, { method: "POST" });
    setSigningMvf(false);
    onMvfSigned();
  }

  async function handleDownloadSummary() {
    setDownloadingSummary(true);
    try {
      const res = await fetch(`/api/bcba-students/monthly/${monthYear}/summary-pdf`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = traineeName.replace(/\s+/g, "-") || "Trainee";
      a.download = `Monthly-Summary-${monthYear}-${safeName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Monthly summary PDF failed:", e);
    } finally {
      setDownloadingSummary(false);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      const res = await fetch(`/api/bcba-students/monthly/${monthYear}/recalculate`, { method: "POST" });
      const d = await res.json();
      if (d.summary) setSummary(d.summary);
      await fetchSessions();
    } catch (e) {
      console.error("Recalculate failed:", e);
    } finally {
      setRecalculating(false);
    }
  }

  async function handleDelete(sessionId: string) {
    setDeletingId(sessionId);
    setOpenMenuId(null);
    try {
      await fetch(`/api/bcba-students/sessions/${sessionId}`, { method: "DELETE" });
      // Refresh sessions and summary after delete
      const [sessRes, summaryRes] = await Promise.all([
        fetch(`/api/bcba-students/monthly/${monthYear}`),
        fetch(`/api/bcba-students/monthly/${monthYear}/recalculate`, { method: "POST" }),
      ]);
      const sessData = await sessRes.json();
      const summaryData = await summaryRes.json();
      setSessions(sessData.sessions || []);
      if (summaryData.summary) setSummary(summaryData.summary);
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      setDeletingId(null);
    }
  }

  function openEdit(s: Session) {
    setOpenMenuId(null);
    setEditingSessionId(s.id);
    setEditError("");
    setEditForm({
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
      activity_type: s.activity_type as "unrestricted" | "restricted",
      contact_type: s.contact_type as EditForm["contact_type"],
      setting: s.setting || "Office",
      supervisor_name: s.supervisor_name || "",
      session_note: s.session_note || "",
    });
  }

  async function handleEditSave() {
    if (!editForm || !editingSessionId) return;
    const [sh, sm] = editForm.start_time.split(":").map(Number);
    const [eh, em] = editForm.end_time.split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      setEditError("End time must be after start time.");
      return;
    }
    const totalHours = toDecimalHours(editForm.start_time, editForm.end_time);
    const isSupervised = editForm.contact_type !== "none";
    setEditSaving(true);
    setEditError("");
    try {
      const res = await fetch(`/api/bcba-students/sessions/${editingSessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_date: editForm.session_date,
          start_time: editForm.start_time,
          end_time: editForm.end_time,
          independent_hours: isSupervised ? 0 : totalHours,
          supervised_hours: isSupervised ? totalHours : 0,
          activity_type: editForm.activity_type,
          contact_type: editForm.contact_type,
          setting: editForm.setting || null,
          supervisor_name: editForm.supervisor_name || null,
          session_note: editForm.session_note || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Save failed");
      }
      // Refresh sessions + summary
      const [sessRes, summaryRes] = await Promise.all([
        fetch(`/api/bcba-students/monthly/${monthYear}`),
        fetch(`/api/bcba-students/monthly/${monthYear}/recalculate`, { method: "POST" }),
      ]);
      const sessData = await sessRes.json();
      const summaryData = await summaryRes.json();
      setSessions(sessData.sessions || []);
      if (summaryData.summary) setSummary(summaryData.summary);
      setEditingSessionId(null);
      setEditForm(null);
    } catch (e: any) {
      setEditError(e.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDownloadSupervisionPdf(session: Session) {
    if (!profile) return;
    setDownloadingSupervisionId(session.id);
    try {
      const { generateSupervisionPdf } = await import("@/lib/bcba-students/generateSupervisionPdf");
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
      const buf = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
          const blob = new Blob([buf], { type: "application/pdf" });
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
      const buf = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
          const blob = new Blob([buf], { type: "application/pdf" });
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
              onClick={handleDownloadSummary}
              disabled={downloadingSummary}
              className="text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--teal)" }}
            >
              {downloadingSummary ? "Generating…" : "Monthly Summary"}
            </button>
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
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>
                Sessions ({sessions.length})
              </p>
              <button
                onClick={handleRecalculate}
                disabled={recalculating}
                className="text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
                style={{ color: "var(--text3)" }}
              >
                {recalculating ? "Recalculating…" : "↻ Recalculate"}
              </button>
            </div>

            {loading ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No sessions logged this month.</p>
            ) : (
              <div className="space-y-3" ref={menuRef}>
                {sessions.map(s => {
                  const dateLabel = new Date(s.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const isEditing = editingSessionId === s.id;
                  const isDeleting = deletingId === s.id;

                  if (isEditing && editForm) {
                    const previewHours = toDecimalHours(editForm.start_time, editForm.end_time);
                    return (
                      <div key={s.id} className="rounded-xl p-4" style={{ border: "1px solid var(--teal)", background: "rgba(27,168,160,0.03)" }}>
                        <p className="text-[12px] font-semibold mb-3" style={{ color: "var(--teal)" }}>Edit Session</p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>Date</label>
                            <input type="date" value={editForm.session_date}
                              onChange={e => setEditForm(f => f && ({ ...f, session_date: e.target.value }))}
                              className="w-full border rounded-lg px-3 py-2 text-[12px] focus:outline-none"
                              style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>Start</label>
                              <input type="time" value={editForm.start_time}
                                onChange={e => setEditForm(f => f && ({ ...f, start_time: e.target.value }))}
                                className="w-full border rounded-lg px-2 py-2 text-[12px] focus:outline-none"
                                style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                            </div>
                            <div className="flex-1">
                              <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>End</label>
                              <input type="time" value={editForm.end_time}
                                onChange={e => setEditForm(f => f && ({ ...f, end_time: e.target.value }))}
                                className="w-full border rounded-lg px-2 py-2 text-[12px] focus:outline-none"
                                style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                            </div>
                          </div>
                        </div>
                        {previewHours > 0 && (
                          <p className="text-[11px] mb-2 font-medium" style={{ color: "var(--teal)" }}>{previewHours.toFixed(2)} hrs</p>
                        )}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>Activity</label>
                            <select value={editForm.activity_type}
                              onChange={e => setEditForm(f => f && ({ ...f, activity_type: e.target.value as EditForm["activity_type"] }))}
                              className="w-full border rounded-lg px-3 py-2 text-[12px] focus:outline-none"
                              style={{ borderColor: "var(--border)", color: "var(--text1)" }}>
                              <option value="unrestricted">Unrestricted</option>
                              <option value="restricted">Restricted</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>Contact</label>
                            <select value={editForm.contact_type}
                              onChange={e => setEditForm(f => f && ({ ...f, contact_type: e.target.value as EditForm["contact_type"] }))}
                              className="w-full border rounded-lg px-3 py-2 text-[12px] focus:outline-none"
                              style={{ borderColor: "var(--border)", color: "var(--text1)" }}>
                              <option value="none">Independent</option>
                              <option value="individual_supervision">Individual</option>
                              <option value="group_supervision">Group</option>
                              <option value="client_observation">Client obs.</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>Setting</label>
                            <select value={editForm.setting}
                              onChange={e => setEditForm(f => f && ({ ...f, setting: e.target.value }))}
                              className="w-full border rounded-lg px-3 py-2 text-[12px] focus:outline-none"
                              style={{ borderColor: "var(--border)", color: "var(--text1)" }}>
                              {SETTINGS.map(st => <option key={st}>{st}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>Supervisor</label>
                            <input type="text" value={editForm.supervisor_name}
                              onChange={e => setEditForm(f => f && ({ ...f, supervisor_name: e.target.value }))}
                              className="w-full border rounded-lg px-3 py-2 text-[12px] focus:outline-none"
                              style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                          </div>
                        </div>
                        <div className="mb-3">
                          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text2)" }}>Note</label>
                          <textarea value={editForm.session_note}
                            onChange={e => setEditForm(f => f && ({ ...f, session_note: e.target.value }))}
                            className="w-full border rounded-lg px-3 py-2 text-[12px] focus:outline-none resize-none"
                            style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 60 }} />
                        </div>
                        {editError && (
                          <p className="text-[12px] px-3 py-2 rounded-lg mb-2" style={{ background: "#FEF2F2", color: "#DC2626" }}>{editError}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleEditSave}
                            disabled={editSaving || previewHours <= 0}
                            className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={{ background: "var(--teal)" }}
                          >
                            {editSaving ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => { setEditingSessionId(null); setEditForm(null); setEditError(""); }}
                            className="px-4 py-1.5 rounded-lg text-[12px] font-medium hover:opacity-80"
                            style={{ color: "var(--text2)" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={s.id} className="rounded-xl p-4" style={{ border: "1px solid var(--border)", opacity: isDeleting ? 0.5 : 1 }}>
                      <div className="flex items-start justify-between mb-1">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                            {s.start_time} – {s.end_time} · {CONTACT_LABELS[s.contact_type] || s.contact_type}
                          </p>
                        </div>
                        <div className="flex items-start gap-2">
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
                          {/* Three-dot menu */}
                          <div className="relative">
                            <button
                              onClick={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
                              disabled={isDeleting}
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
                              style={{ color: "var(--text3)" }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                              </svg>
                            </button>
                            {openMenuId === s.id && (
                              <div
                                className="absolute right-0 top-8 z-10 bg-white rounded-xl shadow-lg py-1 w-32"
                                style={{ border: "1px solid var(--border)" }}
                              >
                                <button
                                  onClick={() => openEdit(s)}
                                  className="w-full text-left px-4 py-2 text-[13px] hover:bg-gray-50 transition-colors"
                                  style={{ color: "var(--text1)" }}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(s.id)}
                                  className="w-full text-left px-4 py-2 text-[13px] hover:bg-gray-50 transition-colors"
                                  style={{ color: "#DC2626" }}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
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
