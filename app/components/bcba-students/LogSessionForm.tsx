"use client";

import { useState, useEffect } from "react";
import { BACB_RULES, type FieldworkType } from "@/lib/bcba-students/calculations";
import NoteSuggestionsPanel from "./NoteSuggestionsPanel";

export interface SavedSession {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  contact_type: string;
  independent_hours: number;
  supervised_hours: number;
  session_note: string | null;
  supervisor_name: string | null;
}

interface Props {
  fieldworkType: FieldworkType;
  defaultSupervisorName?: string;
  onSaved: (session: SavedSession) => void;
}

const SETTINGS = ["Office", "Client home", "School", "Telehealth/Zoom", "Community", "Other"];

function toDecimalHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max(0, Math.round((mins / 60) * 100) / 100);
}

export default function LogSessionForm({ fieldworkType, defaultSupervisorName = "", onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [activityType, setActivityType] = useState<"unrestricted" | "restricted">("unrestricted");
  const [contactType, setContactType] = useState<"none" | "individual_supervision" | "group_supervision" | "client_observation">("none");
  const [setting, setSetting] = useState("Office");
  const [supervisorName, setSupervisorName] = useState(defaultSupervisorName);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dailyHoursLogged, setDailyHoursLogged] = useState(0);

  const totalHours = toDecimalHours(startTime, endTime);
  const isSupervised = contactType !== "none";
  const supervisedHours = isSupervised ? totalHours : 0;
  const independentHours = isSupervised ? 0 : totalHours;

  // Fetch existing sessions for the selected date to enforce daily 8-hour limit
  useEffect(() => {
    if (!date) return;
    const monthYear = date.slice(0, 7);
    fetch(`/api/bcba-students/sessions?monthYear=${monthYear}`)
      .then(r => r.json())
      .then(d => {
        const sessions: Array<{ session_date: string; total_hours: number }> = d.sessions || [];
        const dayTotal = sessions
          .filter(s => s.session_date === date)
          .reduce((sum, s) => sum + (s.total_hours || 0), 0);
        setDailyHoursLogged(Math.round(dayTotal * 100) / 100);
      })
      .catch(() => {});
  }, [date]);

  // Real-time warnings — simplified checks
  useEffect(() => {
    const w: string[] = [];
    if (fieldworkType === "supervised") {
      if (activityType === "restricted") {
        w.push("Adding restricted hours may reduce your cumulative unrestricted % below 60%. Verify your running total.");
      }
    }
    setWarnings(w);
  }, [activityType, contactType, totalHours, fieldworkType]);

  async function handleSave() {
    // Midnight crossing / same-time check
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      setError("Sessions cannot cross midnight. A session must start and end within the same day (12:00 AM – 11:59 PM).");
      return;
    }

    // Daily 8-hour limit check
    if (dailyHoursLogged + totalHours > 8) {
      const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      setError(`You cannot log more than 8 hours per day. You have ${dailyHoursLogged.toFixed(2)} hrs already logged on ${dateLabel}.`);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/bcba-students/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_date: date,
          start_time: startTime,
          end_time: endTime,
          independent_hours: independentHours,
          supervised_hours: supervisedHours,
          activity_type: activityType,
          contact_type: contactType,
          setting,
          supervisor_name: supervisorName || null,
          session_note: note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(data.session);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Date */}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} max={today}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
        </div>

        {/* Start / End */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Start Time</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
          </div>
          <div className="flex-1">
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>End Time</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
          </div>
        </div>
      </div>

      {/* Auto hours */}
      {totalHours > 0 && (
        <p className="text-[13px] mb-4 font-medium" style={{ color: "var(--teal)" }}>
          Session duration: {totalHours.toFixed(2)} hrs
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Activity type */}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Activity Type</label>
          <select value={activityType} onChange={e => setActivityType(e.target.value as any)}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}>
            <option value="unrestricted">Unrestricted</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>

        {/* Contact type */}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Contact Type</label>
          <select value={contactType} onChange={e => setContactType(e.target.value as any)}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}>
            <option value="none">None (independent)</option>
            <option value="individual_supervision">Individual supervision</option>
            <option value="group_supervision">Group supervision</option>
            <option value="client_observation">Client observation + feedback</option>
          </select>
        </div>

        {/* Setting */}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Setting</label>
          <select value={setting} onChange={e => setSetting(e.target.value)}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}>
            {SETTINGS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        {/* Supervisor name */}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Supervisor Name</label>
          <input type="text" value={supervisorName} onChange={e => setSupervisorName(e.target.value)}
            placeholder="Pre-filled from profile"
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
        </div>
      </div>

      {/* Warnings */}
      {warnings.map((w, i) => (
        <p key={i} className="text-[12px] px-4 py-2.5 rounded-xl mb-3 border" style={{ background: "#FFF8E1", borderColor: "#FDE68A", color: "#92400E" }}>
          ⚠ {w}
        </p>
      ))}

      {/* Note */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[12px] font-medium" style={{ color: "var(--text2)" }}>Session Description</label>
          <button onClick={() => setShowPanel(true)} className="text-[12px] font-medium hover:opacity-80" style={{ color: "var(--teal)" }}>
            Suggest a note
          </button>
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Describe what you worked on during this session…"
          className="w-full border rounded-xl px-4 py-3 text-[13px] focus:outline-none resize-none"
          style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 100 }}
        />
      </div>

      {error && (
        <p className="text-[13px] px-4 py-3 rounded-xl mb-4 border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
          {error}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || totalHours <= 0}
        className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: "var(--teal)" }}
      >
        {saving ? "Saving…" : "Save Session"}
      </button>

      {showPanel && (
        <NoteSuggestionsPanel
          activityType={activityType}
          onSelect={text => { setNote(text); setShowPanel(false); }}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}
