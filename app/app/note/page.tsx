"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// ── Constants (mirror the website's note form) ──────────────────────────────
const LOCATION_OPTIONS = [
  { label: "Home", value: "home" },
  { label: "School", value: "school" },
  { label: "Clinic", value: "clinic" },
  { label: "Other", value: "other" },
];
const FIXED_PRESENT = ["Caregiver", "Teacher"];
const COMPLIANCE_OPTIONS = [
  { label: "Typical", value: "typical" },
  { label: "Below", value: "below_typical" },
  { label: "Poor", value: "poor" },
];

// ── Icons ───────────────────────────────────────────────────────────────────
const IconBack = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);
const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// clinical_profile items may be strings or { name } objects.
const getName = (item: unknown): string =>
  typeof item === "string" ? item : ((item as { name?: string } | null)?.name ?? "");

const todayISO = () => new Date().toISOString().split("T")[0];

type Profile = {
  name?: string;
  maladaptiveBehaviors?: unknown[];
  replacementBehaviors?: unknown[];
  skillAcquisition?: unknown[];
  whoWasPresent?: string[];
};

function NoteForm() {
  const clientId = useSearchParams().get("clientId") ?? "";

  const [state, setState] = useState<"loading" | "ready" | "error" | "notfound" | "no-client">(
    clientId ? "loading" : "no-client"
  );
  const [clientName, setClientName] = useState("");
  const [profile, setProfile] = useState<Profile>({});

  // ── Form state ──
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("home");
  const [savedPresent, setSavedPresent] = useState<string[]>([]);
  const [selectedPresent, setSelectedPresent] = useState<string[]>([]);
  const [customPresent, setCustomPresent] = useState("");
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [compliance, setCompliance] = useState("typical");
  const [medicationChange, setMedicationChange] = useState(false);
  const [envChange, setEnvChange] = useState(false);
  const [envChangeDesc, setEnvChangeDesc] = useState("");
  const [missedHours, setMissedHours] = useState(false);
  const [missedCount, setMissedCount] = useState("");
  const [missedReason, setMissedReason] = useState("");
  const [nextAppt, setNextAppt] = useState("");

  // Default the date on the client (device clock) to avoid an SSR mismatch.
  useEffect(() => setDate(todayISO()), []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    fetch(`/api/clients/${clientId}`)
      .then((r) => {
        if (r.status === 404) throw new Error("notfound");
        if (!r.ok) throw new Error("error");
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const p: Profile = data.clinical_profile || {};
        setProfile(p);
        setClientName(p.name || data.internal_code || "Unnamed Client");
        setSavedPresent(p.whoWasPresent || []);
        setState("ready");
      })
      .catch((e) => {
        if (!cancelled) setState(e.message === "notfound" ? "notfound" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const addCustomPresent = () => {
    const name = customPresent.trim();
    if (!name) return;
    // Local only — we don't PATCH the client profile here (read-only usage).
    if (!savedPresent.includes(name) && !FIXED_PRESENT.includes(name)) {
      setSavedPresent((prev) => [...prev, name]);
    }
    if (!selectedPresent.includes(name)) setSelectedPresent((prev) => [...prev, name]);
    setCustomPresent("");
  };

  // ── Non-ready states ──
  if (state !== "ready") {
    const message =
      state === "loading"
        ? "Loading client…"
        : state === "no-client"
          ? "No client selected."
          : state === "notfound"
            ? "Client not found."
            : "Couldn't load this client. Please try again.";
    return (
      <div className="app-screen__content">
        <Link href="/app/home" className="app-back" aria-label="Back to home">
          <IconBack />
        </Link>
        <p className="app-empty">{message}</p>
      </div>
    );
  }

  const behaviors = (profile.maladaptiveBehaviors || []).map(getName).filter(Boolean);
  const skills = [
    ...(profile.replacementBehaviors || []),
    ...(profile.skillAcquisition || []),
  ].map(getName).filter(Boolean);
  const presentOptions = [...FIXED_PRESENT, ...savedPresent];

  return (
    <div className="app-screen__content">
      <Link href="/app/home" className="app-back" aria-label="Back to home">
        <IconBack />
      </Link>

      <h1 className="app-auth__title">{clientName}</h1>
      <p className="app-auth__subtitle">New session note</p>

      {/* Date */}
      <div className="app-form-group">
        <p className="app-section-label">Date</p>
        <label className="app-field">
          <input
            className="app-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      {/* Location */}
      <div className="app-form-group">
        <p className="app-section-label">Location</p>
        <div className="app-seg">
          {LOCATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`app-seg__btn ${location === opt.value ? "app-seg__btn--active" : ""}`}
              onClick={() => setLocation(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Who was present */}
      <div className="app-form-group">
        <p className="app-section-label">Who was present</p>
        <div className="app-chips">
          {presentOptions.map((name) => (
            <button
              key={name}
              type="button"
              className={`app-chip ${selectedPresent.includes(name) ? "app-chip--active" : ""}`}
              onClick={() => toggle(selectedPresent, setSelectedPresent, name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="app-subfield">
          <label className="app-field">
            <input
              className="app-input"
              type="text"
              placeholder="Add someone…"
              value={customPresent}
              onChange={(e) => setCustomPresent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomPresent();
                }
              }}
            />
          </label>
        </div>
      </div>

      {/* Behaviors observed */}
      <div className="app-form-group">
        <p className="app-section-label">Behaviors observed</p>
        {behaviors.length === 0 ? (
          <p className="app-empty">No behaviors on file for this client.</p>
        ) : (
          <div className="app-check-list">
            {behaviors.map((name) => {
              const checked = selectedBehaviors.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`app-check-row ${checked ? "app-check-row--checked" : ""}`}
                  onClick={() => toggle(selectedBehaviors, setSelectedBehaviors, name)}
                >
                  <span className="app-check-row__box">{checked && <IconCheck />}</span>
                  <span className="app-check-row__label">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Replacement skills addressed */}
      <div className="app-form-group">
        <p className="app-section-label">Replacement skills addressed</p>
        {skills.length === 0 ? (
          <p className="app-empty">No replacement skills on file for this client.</p>
        ) : (
          <div className="app-check-list">
            {skills.map((name) => {
              const checked = selectedSkills.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`app-check-row ${checked ? "app-check-row--checked" : ""}`}
                  onClick={() => toggle(selectedSkills, setSelectedSkills, name)}
                >
                  <span className="app-check-row__box">{checked && <IconCheck />}</span>
                  <span className="app-check-row__label">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Compliance level */}
      <div className="app-form-group">
        <p className="app-section-label">Compliance level</p>
        <div className="app-seg">
          {COMPLIANCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`app-seg__btn ${compliance === opt.value ? "app-seg__btn--active" : ""}`}
              onClick={() => setCompliance(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Medication change */}
      <div className="app-form-group">
        <div className="app-toggle-row">
          <span className="app-toggle-row__label">Medication change</span>
          <button
            type="button"
            role="switch"
            aria-checked={medicationChange}
            className={`app-toggle ${medicationChange ? "app-toggle--on" : ""}`}
            onClick={() => setMedicationChange((v) => !v)}
          >
            <span className="app-toggle__knob" />
          </button>
        </div>
      </div>

      {/* Environmental change */}
      <div className="app-form-group">
        <div className="app-toggle-row">
          <span className="app-toggle-row__label">Environmental change</span>
          <button
            type="button"
            role="switch"
            aria-checked={envChange}
            className={`app-toggle ${envChange ? "app-toggle--on" : ""}`}
            onClick={() => setEnvChange((v) => !v)}
          >
            <span className="app-toggle__knob" />
          </button>
        </div>
        {envChange && (
          <textarea
            className="app-textarea app-subfield"
            placeholder="Describe the environmental change…"
            value={envChangeDesc}
            onChange={(e) => setEnvChangeDesc(e.target.value)}
          />
        )}
      </div>

      {/* Missed hours */}
      <div className="app-form-group">
        <div className="app-toggle-row">
          <span className="app-toggle-row__label">Missed hours</span>
          <button
            type="button"
            role="switch"
            aria-checked={missedHours}
            className={`app-toggle ${missedHours ? "app-toggle--on" : ""}`}
            onClick={() => setMissedHours((v) => !v)}
          >
            <span className="app-toggle__knob" />
          </button>
        </div>
        {missedHours && (
          <>
            <div className="app-subfield">
              <label className="app-field">
                <input
                  className="app-input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="Hours missed"
                  value={missedCount}
                  onChange={(e) => setMissedCount(e.target.value)}
                />
              </label>
            </div>
            <div className="app-subfield">
              <label className="app-field">
                <input
                  className="app-input"
                  type="text"
                  placeholder="Reason"
                  value={missedReason}
                  onChange={(e) => setMissedReason(e.target.value)}
                />
              </label>
            </div>
          </>
        )}
      </div>

      {/* Next appointment (optional) */}
      <div className="app-form-group">
        <p className="app-section-label">Next appointment (optional)</p>
        <label className="app-field">
          <input
            className="app-input"
            type="date"
            value={nextAppt}
            onChange={(e) => setNextAppt(e.target.value)}
          />
        </label>
      </div>

      {/* Generate — wired in Part 2 */}
      <button type="button" className="app-btn app-btn--primary">
        Generate note
      </button>
    </div>
  );
}

export default function AppNotePage() {
  return (
    <main className="app-screen">
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />
      <Suspense fallback={null}>
        <NoteForm />
      </Suspense>
    </main>
  );
}
