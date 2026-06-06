"use client";

import { useEffect, useState, useRef } from "react";
import { BACB_RULES, type FieldworkType, type CertificationTrack } from "@/lib/bcba-students/calculations";
import { isInvalidCategory, isValidCategory } from "@/lib/bcba-students/activity-categories";
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
  activity_category: string | null;
  client_reference: string;
  contact_type: string;
  setting: string | null;
  supervisor_name: string | null;
  session_note: string | null;
}

const VAGUE_PHRASES = ['worked on programs','did session','reviewed stuff','did work','worked with client','session was conducted','worked on goals','completed session'];

function auditRiskScore(s: Session): { score: number; label: string; color: string; bg: string } {
  let score = 100;
  if (s.activity_category && isInvalidCategory(s.activity_category)) score -= 40;
  else if (s.activity_category && !isValidCategory(s.activity_category)) score -= 40;
  const ref = (s.client_reference ?? '').trim();
  if (!ref) score -= 30;
  const desc = (s.session_note ?? '').trim().toLowerCase();
  if (desc.length < 30 || VAGUE_PHRASES.some(p => desc.includes(p))) score -= 25;
  if (s.total_hours > 8) score -= 15;
  score = Math.max(0, Math.min(100, score));
  if (score >= 80) return { score, label: 'LOW', color: '#16A34A', bg: '#F0FDF4' };
  if (score >= 50) return { score, label: 'MEDIUM', color: '#92400E', bg: '#FFF8E1' };
  return { score, label: 'HIGH', color: '#DC2626', bg: '#FEF2F2' };
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
  const certificationTrack: CertificationTrack = profile?.certification_track === 'BCaBA' ? 'BCaBA' : 'BCBA';
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<Summary | null>(initialSummary);
  const [loading, setLoading] = useState(true);
  const [signingMvf, setSigningMvf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
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

  function handlePrintMonthlySummary() {
    if (!summary) return;

    const esc = (s: string | null | undefined) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    function fmt(t: string) {
      if (!t) return "";
      const [h, m] = t.split(":").map(Number);
      return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
    }

    const rules = BACB_RULES[certificationTrack][fieldworkType];
    const grpPct = summary.supervisor_contacts > 0
      ? (summary.group_contacts / summary.supervisor_contacts) * 100 : 0;

    const checkRow = (label: string, met: boolean, detail: string) =>
      `<tr><td class="ck ${met ? "ok" : "fail"}">${met ? "✓" : "✗"}</td><td>${esc(label)}</td><td class="det">${esc(detail)}</td></tr>`;

    const CLABELS: Record<string, string> = {
      none: "Independent",
      individual_supervision: "Individual Sup.",
      group_supervision: "Group Sup.",
      client_observation: "Client Obs.",
    };

    const sessionRows = sessions.map((s, i) => {
      const dl = new Date(s.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const note = s.session_note && s.session_note.length > 100
        ? s.session_note.slice(0, 99) + "…" : (s.session_note || "");
      return `<tr class="${i % 2 === 0 ? "alt" : ""}">
        <td>${esc(dl)}</td><td>${esc(fmt(s.start_time))}</td><td>${esc(fmt(s.end_time))}</td>
        <td>${s.total_hours.toFixed(2)}</td>
        <td>${esc(s.activity_type === "unrestricted" ? "Unrestricted" : "Restricted")}</td>
        <td>${esc(CLABELS[s.contact_type] || s.contact_type)}</td>
        <td>${esc(s.supervisor_name || "—")}</td>
        <td>${esc(note)}</td>
      </tr>`;
    }).join("");

    const fieldworkLabel = fieldworkType === "concentrated"
      ? "Concentrated Supervised Fieldwork" : "Supervised Fieldwork";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Monthly Summary — ${esc(monthLabel)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#000;background:#fff;padding:40px;max-width:900px;margin:0 auto}
    @media print{body{padding:0}@page{margin:1in}}
    h1{font-size:18px;font-weight:700;margin-bottom:2px}
    .sub{font-size:10px;color:#555;margin-bottom:22px}
    .igrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:1px solid #ccc;margin-bottom:20px}
    .icol{padding:12px;border-right:1px solid #ccc}
    .icol:last-child{border-right:none}
    .lbl{font-size:8px;text-transform:uppercase;color:#888;font-weight:700;margin-bottom:4px;letter-spacing:.5px}
    .val{font-size:12px;font-weight:700}
    .val-sm{font-size:11px}
    .sec{font-size:9px;font-weight:700;text-transform:uppercase;color:#888;border-bottom:2px solid #000;padding-bottom:3px;margin:20px 0 10px;letter-spacing:.8px}
    .hgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
    .hbox{border:1.5px solid #000;padding:10px}
    .hlbl{font-size:8px;text-transform:uppercase;color:#888;font-weight:700;margin-bottom:6px}
    .hval{font-size:18px;font-weight:700}
    table.chk{width:100%;border-collapse:collapse;margin-bottom:8px}
    table.chk td{padding:4px 6px;font-size:10px}
    .ck{font-weight:700;width:20px;font-size:11px}
    .ck.ok{color:#16a34a}.ck.fail{color:#dc2626}
    .det{color:#666;text-align:right;font-size:9px}
    .ghdr{font-size:9px;font-weight:700;color:#555;padding:6px 6px 2px;text-transform:uppercase;letter-spacing:.5px}
    .badge{display:inline-block;padding:5px 14px;border:2px solid;font-size:10px;font-weight:700;border-radius:3px;margin-top:8px}
    .badge.ok{color:#16a34a;border-color:#16a34a;background:#f0fdf4}
    .badge.fail{color:#dc2626;border-color:#dc2626;background:#fef2f2}
    table.sess{width:100%;border-collapse:collapse;font-size:9px}
    table.sess th{background:#000;color:#fff;padding:5px 6px;text-align:left;font-size:8px}
    table.sess td{padding:4px 6px;border-bottom:1px solid #eee;vertical-align:top}
    table.sess tr.alt td{background:#f7f7f7}
    .foot{margin-top:28px;font-size:8px;color:#bbb;text-align:center;border-top:1px solid #eee;padding-top:8px}
  </style>
</head>
<body>
  <h1>MONTHLY FIELDWORK SUMMARY</h1>
  <div class="sub">${esc(monthLabel)} &nbsp;·&nbsp; ${esc(fieldworkLabel)}</div>
  <div class="igrid">
    <div class="icol">
      <div class="lbl">Supervisee</div><div class="val">${esc(traineeName || "—")}</div>
      <div class="lbl" style="margin-top:10px">BACB ID</div><div class="val-sm">${esc(profile?.trainee_bacb_id || "—")}</div>
    </div>
    <div class="icol">
      <div class="lbl">Supervisor</div><div class="val">${esc(profile?.supervisor_name || "—")}</div>
      <div class="lbl" style="margin-top:10px">BACB ID</div><div class="val-sm">${esc(profile?.supervisor_bacb_id || "—")}</div>
    </div>
    <div class="icol">
      <div class="lbl">Month</div><div class="val">${esc(monthLabel)}</div>
      <div class="lbl" style="margin-top:10px">Generated</div><div class="val-sm">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
    </div>
  </div>
  <div class="sec">Hours Summary</div>
  <div class="hgrid">
    <div class="hbox"><div class="hlbl">Total Hours</div><div class="hval">${summary.total_hours.toFixed(2)}</div></div>
    <div class="hbox"><div class="hlbl">Independent Hours</div><div class="hval">${summary.total_independent_hours.toFixed(2)}</div></div>
    <div class="hbox"><div class="hlbl">Supervised Hours</div><div class="hval">${summary.total_supervised_hours.toFixed(2)}</div></div>
    <div class="hbox"><div class="hlbl">% Hours Supervised</div><div class="hval">${summary.supervision_pct.toFixed(1)}%</div></div>
  </div>
  <div class="sec">BACB Requirements Checklist</div>
  <table class="chk">
    <tr><td colspan="3" class="ghdr">Total Hour Requirements</td></tr>
    ${checkRow("Minimum 20 Total Hours", summary.total_hours >= 20, `${summary.total_hours.toFixed(2)} hrs logged`)}
    ${checkRow("Maximum 130 Total Hours", summary.total_hours <= 130, summary.total_hours > 130 ? `${summary.total_hours.toFixed(2)} hrs — exceeds limit` : `${summary.total_hours.toFixed(2)} hrs — within limit`)}
    <tr><td colspan="3" class="ghdr">Supervision Requirements</td></tr>
    ${checkRow(`Minimum ${rules.supervisionPctMin}% Supervision`, summary.supervision_pct >= rules.supervisionPctMin, `${summary.supervision_pct.toFixed(1)}% achieved`)}
    ${checkRow("Maximum 50% Group Supervision", summary.supervisor_contacts === 0 || grpPct <= 50, summary.supervisor_contacts === 0 ? "No contacts recorded" : `${grpPct.toFixed(0)}% group`)}
    <tr><td colspan="3" class="ghdr">Contacts Requirements</td></tr>
    ${checkRow(`Minimum ${rules.contactsPerMonth} Total Contacts`, summary.supervisor_contacts >= rules.contactsPerMonth, `${summary.supervisor_contacts} contact${summary.supervisor_contacts !== 1 ? "s" : ""} recorded`)}
    ${checkRow("Minimum 1 Observation with Client", summary.client_observations >= 1, `${summary.client_observations} recorded`)}
  </table>
  <div>
    <span class="badge ${summary.is_eligible ? "ok" : "fail"}">${summary.is_eligible ? "✓ ELIGIBLE" : "✗ INELIGIBLE"}</span>
    ${!summary.is_eligible && summary.ineligibility_reason ? `<span style="font-size:10px;color:#666;margin-left:12px">${esc(summary.ineligibility_reason)}</span>` : ""}
  </div>
  <div class="sec" style="margin-top:24px">Session Log</div>
  <table class="sess">
    <thead><tr><th>Date</th><th>Start</th><th>End</th><th>Hrs</th><th>Activity</th><th>Contact</th><th>Supervisor</th><th>Description</th></tr></thead>
    <tbody>${sessionRows || '<tr><td colspan="8" style="color:#999;padding:12px">No sessions logged.</td></tr>'}</tbody>
  </table>
  <div class="foot">
    Generated by Path4ABA &nbsp;·&nbsp; For reference only. Official M-FVF must be signed by supervisor.<br>
    Both parties must retain a copy of all fieldwork documentation for at least 7 years.
  </div>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
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

  function handleDownloadSupervisionForm(session: Session) {
    const win = window.open('', '_blank');
    if (!win) { alert('Enable popups to download this form.'); return; }

    const sd = session.session_date;
    const sessionDate = sd
      ? new Date(sd + 'T00:00:00').toLocaleDateString('en-US')
      : new Date().toLocaleDateString('en-US');

    function fmtT(t: string) {
      const [h, m] = t.split(':').map(Number);
      return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }

    const st = session.start_time || '';
    const et = session.end_time || '';
    let duration = '___';
    if (st && et) {
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      const h = Math.floor(mins / 60), m = mins % 60;
      duration = `${fmtT(st)} – ${fmtT(et)} (${h}h${m > 0 ? ` ${m}min` : ''})`;
    }

    const ct = session.contact_type || '';
    const ctLabel = CONTACT_LABELS[ct] || '___';
    const groupNoteHtml = ct === 'group_supervision'
      ? '<p style="font-size:11px;color:#666;margin-top:4px;font-style:italic;">Group supervision session — maximum 10 trainees per BACB requirements.</p>'
      : '';

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const superviseeNameValue = esc(traineeName || '___');
    const certTrack = profile?.certification_track || 'BCBA';
    const supName = esc(session.supervisor_name || profile?.supervisor_name || '___');

    const independentHoursOnDate = sessions
      .filter(s => s.session_date === session.session_date)
      .reduce((sum, s) => sum + (s.independent_hours || 0), 0);

    const indep = independentHoursOnDate.toFixed(2);
    const sup = (session.supervised_hours ?? 0).toFixed(2);
    const totalHoursAccumulated = (summary?.total_hours ?? 0).toFixed(2);
    const sessionNote = esc(session.session_note || '');

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
            <div class="field"><div class="label">Certification Seeking</div><div class="value">${certTrack}</div></div>
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
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
              onClick={handlePrintMonthlySummary}
              disabled={!summary}
              className="text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--teal)" }}
            >
              Monthly Summary
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
          <ComplianceChecklist month={summary} fieldworkType={fieldworkType} certificationTrack={certificationTrack} />

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
                              onClick={() => handleDownloadSupervisionForm(s)}
                              title="Download Supervision Form"
                              className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-opacity hover:opacity-80 flex-shrink-0"
                              style={{ color: "var(--teal)", background: "rgba(27,168,160,0.08)", border: "1px solid rgba(27,168,160,0.2)" }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                              </svg>
                              Form
                            </button>
                          )}
                          <div className="text-right">
                            <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{s.total_hours.toFixed(2)} hrs</p>
                            <p className="text-[11px] capitalize" style={{ color: "var(--text3)" }}>{s.activity_type}</p>
                            {/* Audit Risk Score — Priority 4 */}
                            {(() => {
                              const r = auditRiskScore(s);
                              const dot = r.label === 'LOW' ? '🟢' : r.label === 'MEDIUM' ? '🟡' : '🔴';
                              return (
                                <span
                                  title={`Audit Risk Score: ${r.score}/100 — ${r.label}\nThis score does not guarantee BACB approval.`}
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 inline-block"
                                  style={{ background: r.bg, color: r.color }}
                                >
                                  {dot} {r.label}
                                </span>
                              );
                            })()}
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
