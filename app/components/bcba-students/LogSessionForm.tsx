"use client";

import { useState, useEffect } from "react";
import { BACB_RULES, type FieldworkType } from "@/lib/bcba-students/calculations";
import {
  RESTRICTED_CATEGORIES,
  UNRESTRICTED_CATEGORIES,
  CATEGORY_LABELS,
  deriveActivityType,
  noteCategories,
} from "@/lib/bcba-students/activity-categories";
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
  activity_category: string | null;
  client_reference: string;
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

function toMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

const RESTRICTED_CONTACT_TYPES = ["client_observation"];
const UNRESTRICTED_CONTACT_TYPES = ["none", "individual_supervision", "group_supervision"];

export default function LogSessionForm({ fieldworkType, defaultSupervisorName = "", onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  // activityCategory replaces the old binary "unrestricted/restricted" toggle
  const [activityCategory, setActivityCategory] = useState<string>("");
  const [contactType, setContactType] = useState<"none" | "individual_supervision" | "group_supervision" | "client_observation">("none");
  const [clientReference, setClientReference] = useState("");
  const [setting, setSetting] = useState("Office");
  const [supervisorName, setSupervisorName] = useState(defaultSupervisorName);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dailyHoursLogged, setDailyHoursLogged] = useState(0);
  const [monthlyHoursLogged, setMonthlyHoursLogged] = useState(0);
  const [sessionsOnDate, setSessionsOnDate] = useState<Array<{ start_time: string; end_time: string }>>([]);
  const [allUnrestrictedHours, setAllUnrestrictedHours] = useState(0);
  const [allRestrictedHours, setAllRestrictedHours] = useState(0);

  // Derive activity_type from selected category (server mirrors this logic)
  const activityType = activityCategory ? deriveActivityType(activityCategory) : null;

  const totalHours = toDecimalHours(startTime, endTime);
  const isSupervised = contactType !== "none";
  const supervisedHours = isSupervised ? totalHours : 0;
  const independentHours = isSupervised ? 0 : totalHours;

  // Ratio tracker
  const sessionUnrestricted = activityType === "unrestricted" ? totalHours : 0;
  const sessionRestricted = activityType === "restricted" ? totalHours : 0;
  const displayUnrestricted = allUnrestrictedHours + sessionUnrestricted;
  const displayRestricted = allRestrictedHours + sessionRestricted;
  const displayTotal = displayUnrestricted + displayRestricted;
  const restrictedPct = displayTotal > 0 ? (displayRestricted / displayTotal) * 100 : 0;

  useEffect(() => {
    fetch("/api/bcba-students/monthly")
      .then(r => r.json())
      .then(d => {
        const sums: Array<{ unrestricted_hours: number; restricted_hours: number }> = d.summaries || [];
        setAllUnrestrictedHours(sums.reduce((acc, s) => acc + (s.unrestricted_hours || 0), 0));
        setAllRestrictedHours(sums.reduce((acc, s) => acc + (s.restricted_hours || 0), 0));
      })
      .catch(() => {});
  }, []);

  // Auto-set contact type when category changes
  useEffect(() => {
    if (activityType === "restricted") {
      setContactType("client_observation");
    } else if (activityType === "unrestricted") {
      setContactType(prev => RESTRICTED_CONTACT_TYPES.includes(prev) ? "none" : prev);
    }
  }, [activityType]);

  useEffect(() => {
    if (!date) return;
    const monthYear = date.slice(0, 7);
    fetch(`/api/bcba-students/sessions?monthYear=${monthYear}`)
      .then(r => r.json())
      .then(d => {
        const sessions: Array<{ session_date: string; start_time: string; end_time: string; total_hours: number }> = d.sessions || [];
        const daySessions = sessions.filter(s => s.session_date === date);
        const dayTotal = daySessions.reduce((sum, s) => sum + (s.total_hours || 0), 0);
        const monthTotal = sessions.reduce((sum, s) => sum + (s.total_hours || 0), 0);
        setDailyHoursLogged(Math.round(dayTotal * 100) / 100);
        setMonthlyHoursLogged(Math.round(monthTotal * 100) / 100);
        setSessionsOnDate(daySessions);
      })
      .catch(() => {});
  }, [date]);

  // Real-time warnings
  useEffect(() => {
    const w: string[] = [];
    if (activityType === "restricted" && fieldworkType === "supervised") {
      w.push("Adding restricted hours may reduce your cumulative unrestricted % below 60%. Verify your running total.");
    }
    if (totalHours > 0 && monthlyHoursLogged + totalHours > 130) {
      const monthLabel = new Date(date.slice(0, 7) + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const remaining = Math.max(0, 130 - monthlyHoursLogged);
      w.push(
        `This session would bring your total for ${monthLabel} to ${(monthlyHoursLogged + totalHours).toFixed(2)} hours, ` +
        `exceeding the BACB maximum of 130 hours per month. You can log a maximum of ${remaining.toFixed(2)} more hours this month.`
      );
    }
    if (totalHours > 0 && dailyHoursLogged + totalHours > 8) {
      w.push(`This session would exceed 8 hours for the day. The BACB may flag sessions exceeding 8 hours.`);
    }
    if (startTime && endTime && totalHours > 0) {
      const newStart = toMins(startTime);
      const newEnd = toMins(endTime);
      for (const s of sessionsOnDate) {
        if (newStart < toMins(s.end_time) && newEnd > toMins(s.start_time)) {
          w.push(`This session overlaps with an existing session on this date (${fmt12(s.start_time)} – ${fmt12(s.end_time)}). Please adjust your times.`);
          break;
        }
      }
    }
    setWarnings(w);
  }, [activityType, totalHours, fieldworkType, monthlyHoursLogged, dailyHoursLogged, date, startTime, endTime, sessionsOnDate]);

  async function handleSave() {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      setError("Sessions cannot cross midnight. A session must start and end within the same day.");
      return;
    }
    if (!activityCategory) {
      setError("Please select an activity category.");
      return;
    }
    if (!clientReference.trim()) {
      setError("Client reference is required. Use a de-identified identifier (e.g. 'Client A', 'AJ-2026').");
      return;
    }
    if (note.trim().length < 20) {
      setError("Session description must be at least 20 characters. Describe specifically what was worked on.");
      return;
    }

    // Overlap check
    const newStart = toMins(startTime);
    const newEnd = toMins(endTime);
    for (const s of sessionsOnDate) {
      if (newStart < toMins(s.end_time) && newEnd > toMins(s.start_time)) {
        setError(`This session overlaps with an existing session on this date (${fmt12(s.start_time)} – ${fmt12(s.end_time)}). Please adjust your times.`);
        return;
      }
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
          activity_category: activityCategory,
          activity_type: activityType, // also send for backward compat; server re-derives from category
          contact_type: contactType,
          client_reference: clientReference.trim(),
          setting,
          supervisor_name: supervisorName || null,
          session_note: note.trim() || null,
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

  const noteLen = note.trim().length;
  const noteOk = noteLen >= 20;

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

      {totalHours > 0 && (
        <p className="text-[13px] mb-4 font-medium" style={{ color: "var(--teal)" }}>
          Session duration: {totalHours.toFixed(2)} hrs
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Activity category (replaces binary restricted/unrestricted) */}
        <div className="md:col-span-2">
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Activity Category</label>
          <select
            value={activityCategory}
            onChange={e => setActivityCategory(e.target.value)}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: activityCategory ? "var(--border)" : "#FBBF24", color: "var(--text1)" }}
          >
            <option value="">— Select BACB activity category —</option>
            <optgroup label="Restricted (direct client contact)">
              {RESTRICTED_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
              ))}
            </optgroup>
            <optgroup label="Unrestricted (indirect, client-related)">
              {UNRESTRICTED_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
              ))}
            </optgroup>
          </select>
          {activityType && (
            <p className="text-[11px] mt-1" style={{ color: activityType === "restricted" ? "#DC2626" : "var(--teal)" }}>
              → Counts as {activityType === "restricted" ? "Restricted" : "Unrestricted"} fieldwork
            </p>
          )}
        </div>

        {/* Contact type */}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Contact Type</label>
          <select value={contactType} onChange={e => setContactType(e.target.value as any)}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}>
            {activityType === "restricted" ? (
              <option value="client_observation">Client observation + feedback</option>
            ) : (
              <>
                <option value="none">None (independent)</option>
                <option value="individual_supervision">Individual supervision</option>
                <option value="group_supervision">Group supervision</option>
              </>
            )}
          </select>
        </div>

        {/* Client reference — REQUIRED */}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
            Client Reference <span style={{ color: "#DC2626" }}>*</span>
          </label>
          <input
            type="text"
            value={clientReference}
            onChange={e => setClientReference(e.target.value)}
            placeholder='e.g. "Client A", "AJ-2026", "School Case 1"'
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
            style={{ borderColor: clientReference.trim() ? "var(--border)" : "#FBBF24", color: "var(--text1)" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>HIPAA: use de-identified IDs only — never full legal names.</p>
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

      {/* Restricted/unrestricted ratio tracker */}
      {displayTotal > 0 && (
        <div
          className="rounded-xl px-4 py-3 mb-4"
          style={{
            background: restrictedPct > 40 ? "#FEF2F2" : restrictedPct > 35 ? "#FFF8E1" : "rgba(27,168,160,0.05)",
            border: `1px solid ${restrictedPct > 40 ? "#FECACA" : restrictedPct > 35 ? "#FDE68A" : "rgba(27,168,160,0.2)"}`,
          }}
        >
          <p className="text-[12px] font-medium" style={{ color: restrictedPct > 40 ? "#DC2626" : restrictedPct > 35 ? "#92400E" : "var(--text2)" }}>
            Unrestricted: {displayUnrestricted.toFixed(2)} hrs ({displayTotal > 0 ? (100 - restrictedPct).toFixed(1) : "0.0"}%) · Restricted: {displayRestricted.toFixed(2)} hrs ({restrictedPct.toFixed(1)}%)
          </p>
          {restrictedPct > 40 && (
            <p className="text-[12px] mt-0.5" style={{ color: "#DC2626" }}>You have exceeded the BACB maximum of 40% restricted hours.</p>
          )}
          {restrictedPct > 35 && restrictedPct <= 40 && (
            <p className="text-[12px] mt-0.5" style={{ color: "#92400E" }}>Approaching 40% restricted limit.</p>
          )}
        </div>
      )}

      {/* Warnings */}
      {warnings.map((w, i) => (
        <p key={i} className="text-[12px] px-4 py-2.5 rounded-xl mb-3 border" style={{ background: "#FFF8E1", borderColor: "#FDE68A", color: "#92400E" }}>
          ⚠ {w}
        </p>
      ))}

      {/* Note */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[12px] font-medium" style={{ color: "var(--text2)" }}>
            Session Description <span style={{ color: "#DC2626" }}>*</span>
            <span className="ml-2 font-normal" style={{ color: noteOk ? "var(--teal)" : noteLen > 0 ? "#92400E" : "var(--text3)" }}>
              ({noteLen}/20 min)
            </span>
          </label>
          <button onClick={() => setShowPanel(true)} className="text-[12px] font-medium hover:opacity-80" style={{ color: "var(--teal)" }}>
            Suggest a note
          </button>
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Describe specifically what was worked on — include behavior, program name, or observable outcome…"
          className="w-full border rounded-xl px-4 py-3 text-[13px] focus:outline-none resize-none"
          style={{ borderColor: noteLen > 0 && !noteOk ? "#FBBF24" : "var(--border)", color: "var(--text1)", minHeight: 100 }}
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
          activityType={activityType ?? "unrestricted"}
          activityCategory={activityCategory}
          suggestedCategories={activityCategory ? noteCategories(activityCategory) : []}
          onSelect={text => { setNote(text); setShowPanel(false); }}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}
