"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type NoteClientProfile } from "./lib/noteProfile";
import { consumeNoteStream } from "./lib/consumeNoteStream";
import { extractInterventions } from "./lib/extractInterventions";

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

// Copy button: "Copy" -> "✓ Copied" for 2s (matches the website).
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`app-copy-btn ${copied ? "app-copy-btn--copied" : ""}`}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

// clinical_profile items may be strings or { name } objects.
const getName = (item: unknown): string =>
  typeof item === "string" ? item : ((item as { name?: string } | null)?.name ?? "");

const todayISO = () => new Date().toISOString().split("T")[0];

function NoteForm() {
  const clientId = useSearchParams().get("clientId") ?? "";

  const [state, setState] = useState<"loading" | "ready" | "error" | "notfound" | "no-client">(
    clientId ? "loading" : "no-client"
  );
  const [clientName, setClientName] = useState("");
  const [profile, setProfile] = useState<NoteClientProfile>({});
  const [continuity, setContinuity] = useState<unknown>(null);

  // ── Form state ──
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("home");
  const [otherLocation, setOtherLocation] = useState("");
  const [savedPresent, setSavedPresent] = useState<string[]>([]);
  const [selectedPresent, setSelectedPresent] = useState<string[]>([]);
  const [customPresent, setCustomPresent] = useState("");
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [complianceChoice, setComplianceChoice] = useState("typical");
  const [complianceTouched, setComplianceTouched] = useState(false);
  const [medicationChange, setMedicationChange] = useState(false);
  const [envChange, setEnvChange] = useState(false);
  const [envChangeDesc, setEnvChangeDesc] = useState("");
  const [missedHours, setMissedHours] = useState(false);
  const [missedCount, setMissedCount] = useState("");
  const [missedReason, setMissedReason] = useState("");
  const [nextAppt, setNextAppt] = useState("");
  // When the RBT reports an environmental change, the compliance control is UNSET until they
  // actively choose — the system never pre-picks how the session went, and never infers it from the
  // reported context. Derived rather than stored, so a real choice can never be overwritten.
  // Mirrors the website form.
  const envChangeReported = envChange && envChangeDesc.trim() !== "";
  const compliance = complianceTouched ? complianceChoice : envChangeReported ? "" : "typical";

  // ── Generation state ──
  const [generating, setGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState("");
  const [status, setStatus] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);
  const [coherenceFlags, setCoherenceFlags] = useState<string[]>([]);
  const [redFlags, setRedFlags] = useState<string[]>([]);
  const [genError, setGenError] = useState("");
  const [summary, setSummary] = useState<
    { behaviors: string[]; skills: string[]; interventions: string[] } | null
  >(null);
  // Persistence is explicit-save-only (generation no longer auto-saves), so the note is written to
  // the client's record only when the RBT clicks Save.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

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
        const p: NoteClientProfile = data.clinical_profile || {};
        setProfile(p);
        setClientName(p.name || data.internal_code || "Unnamed Client");
        setSavedPresent((data.clinical_profile?.whoWasPresent as string[]) || []);
        setState("ready");
      })
      .catch((e) => {
        if (!cancelled) setState(e.message === "notfound" ? "notfound" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Best-effort progress-report trend context (matches the website; optional).
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    fetch(`/api/progress-report?clientId=${clientId}&latest=true`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.report?.continuity_context) {
          setContinuity(data.report.continuity_context);
        }
      })
      .catch(() => {});
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

  const canGenerate =
    date.trim() !== "" &&
    location !== "" &&
    selectedPresent.length > 0 &&
    selectedBehaviors.length >= 1 &&
    selectedSkills.length >= 1 &&
    // An environmental change was reported, so the compliance level must be the RBT's own choice.
    compliance !== "";

  async function handleSave() {
    if (!generatedNote.trim() || saveState === "saving" || saveState === "saved") return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/session-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          noteText: generatedNote,
          sessionDate: date,
          behaviorsAddressed: selectedBehaviors,
          skillsAddressed: selectedSkills,
          interventionsUsed: summary?.interventions ?? [],
        }),
      });
      // 409 = the exact note is already saved (duplicate guard) — treat as saved, not an error.
      setSaveState(res.ok || res.status === 409 ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  async function handleGenerate() {
    if (!canGenerate || generating) return;
    setGenError("");
    setSimilarityWarning(false);
    setGeneratedNote("");
    setSummary(null);
    setSaveState("idle");
    setGenerating(true);
    setStatus("Generating note…");

    try {
      // Slim payload: the server builds the full SessionInput from the authoritative DB profile
      // (dual-accept in /api/generate-note). Constraint sets (allowedFunctions, matrixFunctions,
      // approvedInterventions) are derived server-side, never sent from here.
      const body = {
        clientId, date, location, otherLocation,
        present: selectedPresent,
        selectedBehaviors,
        selectedSkills,
        compliance, medicationChange,
        envChange, envChangeDesc,
        missedHours, missedCount, missedReason,
        nextAppt,
        continuityContext: continuity,
      };

      const res = await fetch("/api/generate-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setGenError(data?.details || data?.error || "Note generation failed.");
        setStatus("");
        return;
      }

      let metaError = "";
      const finalText = await consumeNoteStream(res, {
        onText: (t) => setGeneratedNote(t),
        onRegen: () => {
          setGeneratedNote("");
          setStatus("Regenerating for uniqueness…");
        },
        onMeta: (meta) => {
          if (meta.error) {
            metaError = meta.error;
            setGenError(meta.error);
          } else {
            setSimilarityWarning(!!meta.similarityWarning);
            setCoherenceFlags(Array.isArray(meta.coherenceFlags) ? meta.coherenceFlags : []);
            setRedFlags(Array.isArray(meta.redFlags) ? meta.redFlags : []);
          }
        },
      });
      setStatus("");

      // Build the summary from state at generation time + the final note text
      // (matches the website — /api/generate-note does not return these).
      if (!metaError && finalText.trim()) {
        setSummary({
          behaviors: selectedBehaviors,
          skills: selectedSkills,
          interventions: extractInterventions(finalText),
        });
      }
    } catch {
      setGenError("Something went wrong while generating. Please try again.");
      setStatus("");
    } finally {
      setGenerating(false);
    }
  }

  function backToForm() {
    setGenError("");
    setGeneratedNote("");
    setStatus("");
    setSimilarityWarning(false);
    setSummary(null);
  }

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

  // ── Generation result view ──
  const showResult = generating || generatedNote !== "" || genError !== "";
  if (showResult) {
    return (
      <div className="app-screen__content">
        <Link href="/app/home" className="app-back" aria-label="Back to home">
          <IconBack />
        </Link>
        <h1 className="app-auth__title">{clientName}</h1>
        <p className="app-auth__subtitle">Session note</p>

        {genError ? (
          <>
            <p className="app-empty">{genError}</p>
            <button type="button" className="app-btn app-btn--secondary app-note-cta" onClick={backToForm}>
              Back to form
            </button>
          </>
        ) : summary ? (
          <>
            {similarityWarning && (
              <div className="app-warning">
                This note is similar to a recent note for this client. Please review it carefully before use.
              </div>
            )}
            {coherenceFlags.length > 0 && (
              <div className="app-warning">
                Review before using — a behavior function may not match its antecedent:
                <ul>{coherenceFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </div>
            )}
            {redFlags.length > 0 && (
              <div className="app-warning">
                97153 red-flag phrases — rewrite these with observable detail before submitting:
                <ul>{redFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </div>
            )}

            <div className="app-result-list">
              {/* Box 1 — the generated note */}
              <div className="app-result-box">
                <div className="app-result-box__head">
                  <span className="app-result-box__label">Generated note</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      type="button"
                      className="app-btn app-btn--primary"
                      onClick={handleSave}
                      disabled={saveState === "saving" || saveState === "saved"}
                    >
                      {saveState === "saved" ? "Saved ✓" : saveState === "saving" ? "Saving…" : "Save note"}
                    </button>
                    <CopyButton text={generatedNote} />
                  </div>
                </div>
                <div className="app-note-text">{generatedNote}</div>
                {saveState === "idle" && (
                  <p className="app-result-none">Not saved yet — click Save to add it to this client's record.</p>
                )}
                {saveState === "error" && (
                  <p className="app-warning">Could not save the note. Please try again.</p>
                )}
              </div>

              {/* Boxes 2–4 — summary sections */}
              {[
                { label: "Maladaptive Behaviors", items: summary.behaviors },
                { label: "Replacement Skills", items: summary.skills },
                { label: "Interventions Used", items: summary.interventions },
              ].map((section) => (
                <div key={section.label} className="app-result-box">
                  <div className="app-result-box__head">
                    <span className="app-result-box__label">{section.label}</span>
                    <CopyButton text={section.items.join(", ")} />
                  </div>
                  {section.items.length > 0 ? (
                    <div className="app-tags">
                      {section.items.map((item, i) => (
                        <span key={i} className="app-tag">{item}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="app-result-none">None detected</p>
                  )}
                </div>
              ))}
            </div>

            <Link href="/app/home" className="app-btn app-btn--primary app-note-cta">
              Done
            </Link>
          </>
        ) : (
          <>
            {status && <p className="app-note-status">{status}</p>}
            {similarityWarning && (
              <div className="app-warning">
                This note is similar to a recent note for this client. Please review it carefully before use.
              </div>
            )}
            {coherenceFlags.length > 0 && (
              <div className="app-warning">
                Review before using — a behavior function may not match its antecedent:
                <ul>{coherenceFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </div>
            )}
            {redFlags.length > 0 && (
              <div className="app-warning">
                97153 red-flag phrases — rewrite these with observable detail before submitting:
                <ul>{redFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </div>
            )}
            <div className="app-note-output">
              {generatedNote || (generating ? "Generating…" : "")}
            </div>
          </>
        )}
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
          <input className="app-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
        {location === "other" && (
          <div className="app-subfield">
            <label className="app-field">
              <input
                className="app-input"
                type="text"
                placeholder="e.g. After school program, Summer camp..."
                value={otherLocation}
                onChange={(e) => setOtherLocation(e.target.value)}
              />
            </label>
          </div>
        )}
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
        {envChangeReported && compliance === "" && (
          <p className="app-warning">
            You reported an environmental change — please indicate the session&apos;s compliance level.
          </p>
        )}
        <div className="app-seg">
          {COMPLIANCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`app-seg__btn ${compliance === opt.value ? "app-seg__btn--active" : ""}`}
              onClick={() => { setComplianceChoice(opt.value); setComplianceTouched(true); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Medication change */}
      <div className="app-form-group">
        <div className="app-toggle-row">
          <span className="app-toggle-row__label">Medication Changes</span>
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
          <input className="app-input" type="date" value={nextAppt} onChange={(e) => setNextAppt(e.target.value)} />
        </label>
      </div>

      <button
        type="button"
        className="app-btn app-btn--primary"
        onClick={handleGenerate}
        disabled={!canGenerate}
      >
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
