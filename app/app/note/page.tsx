"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type NoteClientProfile } from "./lib/noteProfile";
import { consumeNoteStream } from "./lib/consumeNoteStream";
import { extractInterventions } from "./lib/extractInterventions";
import { activeBehaviorsForSelection, activeSkills } from "@/lib/activePrograms";

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
  const [nextAppt, setNextAppt] = useState("");
  // Something out of the ordinary was reported (environmental change or medication change). When either
  // is marked, the session cannot be "typical": the RBT must actively pick below typical or poor.
  // `typical` is disabled and compliance starts UNSET; even a prior "typical" choice is neutralized to
  // "". Mirrors the website form.
  const outOfOrdinary = envChange || medicationChange;
  const compliance = outOfOrdinary
    ? (complianceTouched && complianceChoice !== "typical" ? complianceChoice : "")
    : (complianceTouched ? complianceChoice : "typical");

  // ── Generation state ──
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);  // calm label for the coverage retry (no visible wipe)
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
      const ok = res.ok || res.status === 409;
      setSaveState(ok ? "saved" : "error");
      // The note is filed, so this one is finished: clear the per-note state so nothing carries
      // into the next note. Date and location stay — the RBT is usually still in the same session day.
      if (ok) { resetNoteForm({ keepDateAndLocation: true }); setSaveState("saved"); }
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
    setFinalizing(false);
    setStatus("");  // progress shown by the calm output-area label; status stays for genuine errors

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

      // Only a BLOCKING stop discards the result. An advisory message is surfaced like the other
      // review flags, alongside the note and its summary tables.
      let blockingError = "";
      const finalText = await consumeNoteStream(res, {
        // Option (a): pass 1 streams LIVE. consumeNoteStream freezes (stops calling onText) once a coverage
        // retry begins and calls onText once more with the final text at the end — so the RBT watches the note
        // write itself, then it settles, then the finished note appears. No wipe, no restart.
        onText: (t) => setGeneratedNote(t),
        onRegen: () => {
          // Coverage retry — presentation only. Freeze + dim the streamed text and show a calm "Finalizing…"
          // state; never a wipe, never an alarming "Regenerating".
          setFinalizing(true);
        },
        onMeta: (meta) => {
          if (meta.error && meta.blocking !== false) {
            blockingError = meta.error;
            setGenError(meta.error);
            return;
          }
          setSimilarityWarning(!!meta.similarityWarning);
          setCoherenceFlags([
            ...(Array.isArray(meta.coherenceFlags) ? meta.coherenceFlags : []),
            ...(meta.error ? [meta.error] : []),
          ]);
          setRedFlags(Array.isArray(meta.redFlags) ? meta.redFlags : []);
        },
      });
      setStatus("");

      // Build the summary from state at generation time + the final note text
      // (matches the website — /api/generate-note does not return these).
      if (!blockingError && finalText.trim()) {
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
      setFinalizing(false);
    }
  }

  // Leaves the result view without discarding the session selections — the RBT may want to adjust
  // one and regenerate. This is navigation, NOT the end of a note; resetNoteForm is that.
  function backToForm() {
    setGenError("");
    setGeneratedNote("");
    setStatus("");
    setSimilarityWarning(false);
    setCoherenceFlags([]);
    setRedFlags([]);
    setSummary(null);
  }

  // ONE reset for the COMPLETE per-note state, mirroring the website. Every path that ENDS a note
  // calls this — saving and switching client — so nothing survives into the next note. Before this,
  // saving on the app reset nothing at all: the RBT saved, went back, and every selection from the
  // previous note was still there, ready to be submitted again.
  //   keepDateAndLocation: after a save the RBT is usually writing another note the same day.
  function resetNoteForm({ keepDateAndLocation = false } = {}) {
    setSelectedPresent([]);
    setCustomPresent("");
    setSelectedBehaviors([]);
    setSelectedSkills([]);
    setComplianceChoice("typical");
    setComplianceTouched(false);
    setMedicationChange(false);
    setEnvChange(false);
    setEnvChangeDesc("");
    setNextAppt("");
    setSaveState("idle");
    if (!keepDateAndLocation) { setDate(""); setLocation("home"); setOtherLocation(""); }
    backToForm();
  }

  // A session selection belongs to ONE client's note; switching client must not carry it over.
  // Adjust-during-render (React's documented pattern) rather than an effect. Mirrors the website.
  const [prevClientId, setPrevClientId] = useState(clientId);
  if (clientId !== prevClientId) {
    setPrevClientId(clientId);
    resetNoteForm();
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
            <div style={{ position: "relative" }}>
              <div className="app-note-output" style={{ opacity: finalizing ? 0.5 : 1, transition: "opacity .2s" }}>
                {generatedNote || (generating && !finalizing ? "Generating your note…" : "")}
              </div>
              {finalizing && (
                <div className="app-note-finalizing" role="status" aria-live="polite"
                  style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: "#F0FDFA", border: "1px solid #99F6E4", color: "#0F766E", fontSize: 13, fontWeight: 600 }}>
                  <svg className="app-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                  </svg>
                  Finalizing your note…
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // NOTE-FORM SELECTION LISTS — ACTIVE ONLY. A mastered behavior/skill is progress history; it must not be
  // selectable (documenting it records work on a program that no longer exists). Mastered items stay in the
  // profile (progress reports / dashboard); they are only filtered out of what is selectable here. Only
  // ACTIVE skills (replacementBehaviors) are offered — skillAcquisition (mastered) is excluded.
  // ACTIVE behaviors WITH completeness: an incomplete one (no operational definition and/or function) is
  // shown but NOT selectable (Option B) — the generator has nothing to write for it until a BCBA completes
  // it. keepActiveBehaviorNames enforces the same rule server-side.
  const behaviors = activeBehaviorsForSelection(profile);
  const skills = activeSkills(profile.replacementBehaviors || [], profile).map(getName).filter(Boolean);
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
            {behaviors.map(({ name, incomplete, reason }) => {
              // Incomplete → shown but not selectable, with the reason inline. Not a button, so it can't be
              // toggled; the server backstop (keepActiveBehaviorNames) drops it too if it were posted anyway.
              if (incomplete) {
                return (
                  <div
                    key={name}
                    className="app-check-row"
                    aria-disabled="true"
                    title={reason || undefined}
                    style={{ opacity: 0.55, cursor: "not-allowed" }}
                  >
                    <span className="app-check-row__box" />
                    <span className="app-check-row__label">
                      {name}
                      <span style={{ display: "block", fontSize: 12, color: "var(--text3)" }}>{reason}</span>
                    </span>
                  </div>
                );
              }
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
        {outOfOrdinary && compliance === "" && (
          <p className="app-warning">
            Something out of the ordinary was reported — please indicate the session&apos;s compliance level (below typical or poor).
          </p>
        )}
        <div className="app-seg">
          {COMPLIANCE_OPTIONS.map((opt) => {
            const disabled = outOfOrdinary && opt.value === "typical";
            return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              title={disabled ? "Something out of the ordinary was reported — choose below typical or poor" : undefined}
              className={`app-seg__btn ${compliance === opt.value ? "app-seg__btn--active" : ""}`}
              onClick={() => { if (disabled) return; setComplianceChoice(opt.value); setComplianceTouched(true); }}
            >
              {opt.label}
            </button>
            );
          })}
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
