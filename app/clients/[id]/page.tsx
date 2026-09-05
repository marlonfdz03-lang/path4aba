"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { getClientProfiles } from "@/lib/clientStorage";
import { nextSessionClause } from "@/lib/nextSessionDate";
import { saveNote, getNotesByClientId, deleteNote, updateNote } from "@/lib/noteStorage";
import { DataTab } from "./DataTab";
import { CatalogDiffPanel } from "./CatalogDiffPanel";
import { reviewBannerLines } from "@/lib/reviewFlagCopy";
import { activeBehaviors, activeSkills, behaviorMissingFields, incompleteBehaviorReason } from "@/lib/activePrograms";
import { splitReinforcerValue } from "@/lib/reinforcers";
import { looksEdible, EDIBLE_WARNING, EDIBLE_WARNING_ES } from "@/lib/edibleReinforcer";
import { isCommunityOuting, COMMUNITY_OUTING_WARNING } from "@/lib/deliverableReinforcer";
import { looksLikePersonRole, PERSON_WARNING } from "@/lib/clinicalLibrary";
import { extractInterventions } from "@/lib/extractInterventions";
import { subtractMasteredFromActive } from "@/lib/skillReconcile";
import { functionDisplayLabel, functionToCanonical } from "@/lib/functionPatterns";
import { splitNoteStream } from "@/lib/noteStream";

const LOCATION_OPTIONS = [
  { label: "Home", value: "home" },
  { label: "School", value: "school" },
  { label: "Clinic", value: "clinic" },
  { label: "Other Place of Service", value: "other" },
];

const FIXED_PRESENT = ["Caregiver", "Teacher"];

type Tab = "overview" | "fast" | "treatment_map" | "generate" | "notes" | "data";

// ── Shared micro-components ────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <p className="text-[11px] uppercase tracking-widest font-semibold whitespace-nowrap" style={{ color: "var(--text3)" }}>
        {title}
      </p>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-[38px] flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none"
      style={{ background: checked ? "var(--teal)" : "var(--border2)" }}
    >
      <span
        className="pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

function CheckboxRow({
  name,
  description,
  checked,
  disabled,
  onToggle,
}: {
  name: string;
  description?: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={() => !disabled && onToggle()}
      className="flex items-center gap-3 px-4 py-3 border-b last:border-0 transition-colors"
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--teal-light)" : "white",
        opacity: disabled && !checked ? 0.45 : 1,
        borderColor: "var(--border)",
      }}
    >
      {/* Custom checkbox */}
      <div
        className="w-[18px] h-[18px] rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
        style={{
          borderColor: checked ? "var(--teal)" : "var(--border2)",
          background: checked ? "var(--teal)" : "white",
        }}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12">
            <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{name}</span>
        {description && (
          <span className="text-[11px] ml-2" style={{ color: "var(--text3)" }}>{description}</span>
        )}
      </div>
    </div>
  );
}

function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-full border text-sm font-medium transition-colors"
      style={{
        background: selected ? "var(--teal)" : "white",
        borderColor: selected ? "var(--teal)" : "var(--border2)",
        color: selected ? "white" : "var(--text2)",
      }}
    >
      {label}
    </button>
  );
}

function NoteOutput({
  note,
  onChange,
  onCopy,
  onStartNew,
  onBlur,
  saveState = "idle",
  onRetry,
  generating,
}: {
  note: string;
  onChange: (v: string) => void;
  onCopy: () => void;
  onStartNew?: () => void;
  onBlur?: () => void;
  // Autosave status. "saving"/"saved" are quiet spans ("saved" fades in the parent); "failed" is a persistent
  // clickable button — never a message that disappears on its own, which is how a failed save gets missed.
  saveState?: "idle" | "saving" | "saved" | "failed";
  onRetry?: () => void;
  generating?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-5">
      <div className="flex justify-between items-center mb-3">
        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Generated Note</p>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            disabled={generating}
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors disabled:opacity-40"
            style={{ borderColor: copied ? "#16A34A" : "var(--border)", color: copied ? "#16A34A" : "var(--text2)" }}
          >
            {generating ? "Generating..." : copied ? "✓ Copied" : "Copy"}
          </button>
          {onStartNew && (
            <button
              onClick={onStartNew}
              disabled={generating}
              className="px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors disabled:opacity-40"
              style={{ borderColor: "var(--border)", color: "var(--text2)" }}
            >
              Start New Note
            </button>
          )}
          {/* Autosave indicator (replaces the Save button). "failed" persists and is clickable to retry. */}
          {saveState === "saving" && (
            <span className="px-3 py-1.5 text-[13px] font-medium flex items-center gap-1.5" style={{ color: "var(--text3)" }}>
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
              </svg>
              Saving…
            </span>
          )}
          {saveState === "saved" && (
            <span className="px-3 py-1.5 text-[13px] font-semibold" style={{ color: "#16A34A" }}>Saved ✓</span>
          )}
          {saveState === "failed" && (
            <button
              onClick={onRetry}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors"
              style={{ borderColor: "#DC2626", color: "#DC2626", background: "#FEF2F2" }}
            >
              Save failed — tap to retry
            </button>
          )}
        </div>
      </div>
      <textarea
        value={note}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full border p-4 rounded-xl text-sm leading-7 min-h-64 resize-none focus:outline-none focus:ring-2"
        style={{ borderColor: "var(--border)", color: "var(--text1)" }}
      />
    </div>
  );
}

// One Session-Summary section's Copy button. Each instance owns its own copied state so the three
// (Maladaptive / Replacement / Interventions) confirm independently. Matches the app convention:
// "✓ Copied", green #16A34A, revert after 2s.
function CopySection({ items, color }: { items: string[]; color: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(items.join(", ")); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-[11px] px-2.5 py-1 rounded-lg border font-medium hover:opacity-70 transition-colors"
      style={{ borderColor: copied ? "#16A34A" : color, color: copied ? "#16A34A" : color, background: "white" }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ClientProfilePage() {
  const params = useParams();
  const { data: session } = useSession();

  const [client, setClient] = useState<any>(null);
  const [clientLoading, setClientLoading] = useState(true);
  const [dailyNotes, setDailyNotes] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Generate Note state
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [otherLocation, setOtherLocation] = useState("");
  const [selectedPresent, setSelectedPresent] = useState<string[]>([]);
  const [savedPresent, setSavedPresent] = useState<string[]>([]);
  // Per-client saved "Other place of service" locations (clinical_profile.savedLocations) — the same
  // store the extension writes, so a location saved on either surface appears on both for this client.
  const [savedLocations, setSavedLocations] = useState<string[]>([]);
  // Profile-overview "add reinforcer" input + advisory edible warning (shown after adding an edible).
  const [newReinforcer, setNewReinforcer] = useState("");
  // Holds whichever add-time reinforcer advisory applies (edible or community-outing) — both render in the
  // same amber slot below the add form. Inform, don't block (Marlon's ruling).
  const [reinforcerWarning, setReinforcerWarning] = useState("");
  const [customPresent, setCustomPresent] = useState("");
  const customPresentRef = useRef<HTMLInputElement>(null);
  const [environmentalChange, setEnvironmentalChange] = useState(false);
  const [environmentalChangeDesc, setEnvironmentalChangeDesc] = useState("");
  const [medicationConsumed, setMedicationConsumed] = useState(false);
  // When the RBT reports an environmental change, the compliance control is UNSET ("") until they
  // actively choose — the system never pre-picks how the session went, and never infers it from the
  // reported context. Derived rather than stored, so a real choice can never be overwritten.
  const [complianceChoice, setComplianceChoice] = useState<"typical" | "below_typical" | "poor">("typical");
  const [complianceTouched, setComplianceTouched] = useState(false);
  // Something out of the ordinary was reported (environmental change or medication change). When either
  // is marked, the session cannot be "typical": the RBT must actively pick below typical or poor.
  // `typical` is disabled and compliance starts UNSET until they choose — and even a prior "typical"
  // choice is neutralized to "" (never a rubber-stamp).
  const outOfOrdinary = environmentalChange || medicationConsumed;
  const complianceLevel: "" | "typical" | "below_typical" | "poor" =
    outOfOrdinary
      ? (complianceTouched && complianceChoice !== "typical" ? complianceChoice : "")
      : (complianceTouched ? complianceChoice : "typical");
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [generatedNote, setGeneratedNote] = useState("");
  const [sessionSummary, setSessionSummary] = useState<{
    behaviors: string[];
    skills: string[];
    interventions: string[];
  } | null>(null);
  const sessionSummaryRef = useRef<{ behaviors: string[]; skills: string[]; interventions: string[] } | null>(null);
  // The preselector's per-note assignments + activities from __META__, persisted on save so rotation learns.
  const generationContextRef = useRef<{ generationContext: any; activities: string[] } | null>(null);
  const [generating, setGenerating] = useState(false);
  // Presentation of the compliance coverage retry: while true, the note is being finalized. Drives a calm
  // progress label — never a visible wipe, restart, or red "Regenerating" banner.
  const [finalizing, setFinalizing] = useState(false);
  const [status, setStatus] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);
  // AUTOSAVE (no Save button). The note is created the moment generation finishes and updated on every
  // re-generation and debounced edit — one server row per Start-new cycle (upsert-per-cycle).
  //  • savedNoteIdRef  — the row this cycle writes to. null ⇒ the next save CREATES (POST) and captures the id;
  //    set ⇒ the next save UPDATES (PATCH) that id. A ref, not state: persistNote reads/writes it synchronously
  //    to decide create-vs-update, so a rapid create-then-edit can never race into a second create.
  //  • saveState — drives the status indicator. "saved" fades after a moment; "failed" PERSISTS (a transient
  //    error someone misses is how work is lost) and is clickable to retry.
  //  • saveChainRef — serializes saves so the first create finishes (id captured) before any edit-update runs.
  const savedNoteIdRef = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The device backup for THIS cycle. backupIdRef is the localStorage record written at generation; every edit
  // rewrites it in place (updateNote) so the backup always holds the EDITED text — the load-bearing guarantee
  // that an edit lost inside the debounce window is never gone from both stores. pendingEditTextRef holds the
  // latest un-flushed edit for the best-effort keepalive flush on the way out (pagehide / switch / unmount).
  const backupIdRef = useRef<string | null>(null);
  const pendingEditTextRef = useRef<string | null>(null);
  // Latest client id + date in refs so the exit-flush (pagehide / client-switch / unmount) reads current
  // values with no stale closure. Assigned during render — the documented "latest value" ref pattern.
  const clientIdRef = useRef<string | null>(null);
  const dateRef = useRef<string>("");
  // Live compliance-calendar prompt (feature 2): occupiedDates = dates with an ACTIVE note (the PHI-free set,
  // checked when a date is picked). dateConflict drives the View/Replace/Cancel dialog. replaceDateRef arms the
  // next generation's autosave to SUPERSEDE that date's note. savedNoteCycleDateRef is this cycle's own note's
  // date, excluded from the prompt so the RBT is never warned about their own just-created note.
  const [occupiedDates, setOccupiedDates] = useState<Set<string>>(new Set());
  const [dateConflict, setDateConflict] = useState<{ date: string; previous: string; noteText?: string | null; loadingView?: boolean } | null>(null);
  const replaceDateRef = useRef<string | null>(null);
  const savedNoteCycleDateRef = useRef<string | null>(null);

  // Share with BCBA state
  const [shareCode, setShareCode] = useState("");
  const [generatingCode, setGeneratingCode] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareError, setShareError] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  // Update Assessment state
  const [showUpdateAssessment, setShowUpdateAssessment] = useState(false);
  const [updateAssessFile, setUpdateAssessFile] = useState<File | null>(null);
  const [updateAssessing, setUpdateAssessing] = useState(false);
  const [updateAssessError, setUpdateAssessError] = useState("");
  const [updateAssessSuccess, setUpdateAssessSuccess] = useState(false);

  // FAST tab — per-row function editing (2c). fnEdit = the behavior being edited + its in-progress selection.
  const [fnEdit, setFnEdit] = useState<{ name: string; selected: string[] } | null>(null);
  const [fnSaving, setFnSaving] = useState(false);
  const [fnError, setFnError] = useState("");
  // FAST tab — per-row topography editing (mirror of the function edit). topoEdit = the behavior + draft text.
  const [topoEdit, setTopoEdit] = useState<{ name: string; text: string } | null>(null);
  const [topoSaving, setTopoSaving] = useState(false);
  const [topoError, setTopoError] = useState("");

  const [nextApptDate, setNextApptDate] = useState("");
  const [lastSavedNote, setLastSavedNote] = useState("");

  // A session selection belongs to ONE client's note. The App Router can reuse this component
  // across /clients/[id] param changes, so without this a selection survives the switch — and a
  // stale name that is not in the new client's pill list renders NO pill at all, staying invisible
  // in the form while still being submitted. Adjust-during-render (React's documented pattern for
  // resetting state when a prop changes) rather than an effect, which would cascade a second
  // render. Declared with the other hooks, above the loading/not-found early returns.
  const [prevClientId, setPrevClientId] = useState(params.id);
  if (params.id !== prevClientId) {
    setPrevClientId(params.id);
    resetNoteForm();
  }
  // Latest-value refs for the exit-flush. On a client switch this render still holds the OLD client's data
  // (the new client loads async), so the switch cleanup below flushes to the correct, still-current client.
  clientIdRef.current = client?.id ?? null;
  dateRef.current = date;
  const [bcbaOverlapContext, setBcbaOverlapContext] = useState<{
    empty: boolean;
    behaviors?: string[];
    skills?: string[];
    interventions?: string[];
    noteText?: string;
  } | null>(null);
  const [continuityCtx, setContinuityCtx] = useState<any>(null);
  const [authorizedHoursPerWeek, setAuthorizedHoursPerWeek] = useState<number>(
    client?.clinicalProfile?.authorizedHoursPerWeek || 0
  );
  const [savingHours, setSavingHours] = useState(false);
  const [clientFiles, setClientFiles] = useState<any[]>([]);
  // Profile-overview editing state. MUST live with the other hooks (before any early return below) — React
  // requires every hook to run on every render, in the same order. It previously sat lower in the body, after
  // the `if (clientLoading) return …` / `if (!client) return …` early returns, so it was skipped on the
  // loading render and called on the loaded render → "rendered more hooks than during the previous render"
  // (React #310), which crashed the client page on open.
  const [profileSaving, setProfileSaving] = useState(false);

  async function loadNotesFromSupabase(clientId: string) {
    try {
      const res = await fetch(`/api/session-notes?clientId=${clientId}`);
      if (!res.ok) return false;
      const { notes } = await res.json();
      if (notes && notes.length > 0) {
        setDailyNotes(notes.map((n: any) => ({
          id: n.id,
          clientId,
          date: new Date(n.created_at).toLocaleDateString(),
          note: n.note_text,
          fromSupabase: true,
        })));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // The calendar occupancy set — PHI-free dates that have an active note. Refreshed on client load and after
  // each autosave create/supersede, so a date just filled reads as occupied on the next pick.
  async function refreshOccupiedDates(clientId?: string) {
    const cid = clientId || client?.id;
    if (!cid) return;
    try {
      const res = await fetch(`/api/session-notes/dates?clientId=${cid}`);
      if (!res.ok) return;
      const { dates } = await res.json();
      setOccupiedDates(new Set(Array.isArray(dates) ? dates : []));
    } catch { /* non-fatal: the prompt just won't fire until the next refresh */ }
  }

  useEffect(() => {
    async function load() {
      const id = params.id as string;

      const res = await fetch(`/api/clients/${id}`);
      if (res.ok) {
        const data = await res.json();
        const found = { id: data.id, clientName: data.clinical_profile?.name || data.internal_code || "Unnamed Client", clinicalProfile: data.clinical_profile, authorized_hours_weekly: data.authorized_hours_weekly ?? null, treatmentMapApproved: data.treatment_map_approved ?? false };
        setClient(found);
        refreshOccupiedDates(found.id);  // calendar occupancy for the replace prompt
        const loadedFromDB = await loadNotesFromSupabase(found.id);
        if (!loadedFromDB) setDailyNotes(getNotesByClientId(found.id));
        if (data.clinical_profile?.whoWasPresent?.length) {
          setSavedPresent(data.clinical_profile.whoWasPresent);
        } else {
          const raw = localStorage.getItem(`path4aba_saved_present_${found.id}`);
          if (raw) { try { setSavedPresent(JSON.parse(raw)); } catch {} }
        }
        setSavedLocations(Array.isArray(data.clinical_profile?.savedLocations) ? data.clinical_profile.savedLocations : []);
        setClientLoading(false);
        return;
      }

      // Fallback to localStorage
      const clients = getClientProfiles();
      const foundClient = clients.find((c: any) => c.id === id);
      if (foundClient) {
        setClient(foundClient);
        setDailyNotes(getNotesByClientId(foundClient.id));
        const raw = localStorage.getItem(`path4aba_saved_present_${foundClient.id}`);
        if (raw) { try { setSavedPresent(JSON.parse(raw)); } catch {} }
      }
      setClientLoading(false);
    }
    load();
  }, [params.id]);

  // On a client switch AND on unmount: FLUSH any pending edit for the client we're LEAVING (B, best-effort
  // keepalive) before dropping its tracked id, then reset the per-cycle refs. The cleanup closes over the
  // previous render, and this render still holds the old client (the new one loads async), so flushPending
  // targets the correct client. The new-client body then clears the indicator. resetNoteForm (during render)
  // already cleared the visible form; refs must be reset here, not during render.
  useEffect(() => {
    setSaveState("idle");
    return () => {
      flushPending();
      if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
      if (saveFadeRef.current) clearTimeout(saveFadeRef.current);
      savedNoteIdRef.current = null;
      backupIdRef.current = null;
      pendingEditTextRef.current = null;
      // Calendar state belongs to one client too — drop the replace-intent, this cycle's date, and the dialog.
      replaceDateRef.current = null;
      savedNoteCycleDateRef.current = null;
      setDateConflict(null);
    };
  }, [params.id]);

  // Tab close / reload / bfcache: flush the last un-saved edit best-effort (keepalive survives teardown). The
  // device backup (A) already holds it; this just gives the server the edit too. Registered once — flushPending
  // reads only refs, so the first-render closure stays correct.
  useEffect(() => {
    const onHide = () => flushPending();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    if (client?.id) loadClientFiles(client.id);
  }, [client?.id]);

  useEffect(() => {
    if (!client?.id) return;
    fetch(`/api/progress-report?clientId=${client.id}&latest=true`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.report?.continuity_context) {
          setContinuityCtx(data.report.continuity_context);
        }
      })
      .catch(() => {});
  }, [client?.id]);

  if (clientLoading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)", padding: "32px 40px" }}>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
        {/* Skeleton header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#E2E8F0", animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ width: 180, height: 20, borderRadius: 6, background: "#E2E8F0", animation: "pulse 1.5s ease-in-out infinite" }} />
            <div style={{ width: 120, height: 14, borderRadius: 6, background: "#F1F5F9", animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
        </div>
        {/* Skeleton tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
          {[80, 100, 70, 60, 60].map((w, i) => (
            <div key={i} style={{ width: w, height: 34, borderRadius: 99, background: "#F1F5F9", animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
        {/* Skeleton content block */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 28 }}>
          {[200, 160, 220, 140].map((w, i) => (
            <div key={i} style={{ width: w, height: 14, borderRadius: 6, background: "#F1F5F9", marginBottom: 16, animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
      </main>
    );
  }

  if (!client) {
    return (
      <main className="min-h-screen p-10" style={{ background: "var(--bg)" }}>
        <p className="text-lg font-medium" style={{ color: "var(--text3)" }}>Client not found.</p>
      </main>
    );
  }

  // Profile-view fields (the overview lists mastered skills as clinical history — KEEP them here).
  const masteredSkills: any[] = client.clinicalProfile?.skillAcquisition || [];
  const masteredSkillNames: string[] = masteredSkills.map((s: any) => (typeof s === "string" ? s : s?.name || ""));
  const activePrograms: any[] = subtractMasteredFromActive(
    client.clinicalProfile?.replacementBehaviors || [],
    masteredSkillNames,
  );
  // NOTE-FORM SELECTION LISTS — ACTIVE ONLY. A MASTERED behavior/skill is progress history; offering it would
  // let the RBT document work on a program that no longer exists. Mastered items stay in the profile (and in
  // the overview above, progress reports, dashboard) — they are only filtered out of what is SELECTABLE for a
  // note. activeBehaviors/activeSkills read the existing status + the separate mastered fields.
  const behaviors: any[] = activeBehaviors(client.clinicalProfile?.maladaptiveBehaviors || [], client.clinicalProfile);
  const skills: any[] = activeSkills(activePrograms, client.clinicalProfile);

  function getName(item: any): string {
    return typeof item === "string" ? item : item?.name || "";
  }

  // ONE reset for every path that ends a note — switching client, saving, and Start New Note — so
  // the three can never drift (a field added to the form is cleared by all of them or none).
  //   keepDateAndLocation: the post-save path keeps them; an RBT writing several notes in one
  //                        sitting is still in the same day and location.
  //   keepGeneratedNote:   the post-save path keeps the note on screen to read or copy.
  function resetNoteForm({ keepDateAndLocation = false, keepGeneratedNote = false } = {}) {
    setSelectedPresent([]);
    setCustomPresent("");
    setSelectedBehaviors([]);
    setSelectedSkills([]);
    setComplianceChoice("typical");
    setComplianceTouched(false);
    setMedicationConsumed(false);
    setEnvironmentalChange(false);
    setEnvironmentalChangeDesc("");
    setNextApptDate("");
    setStatus("");
    if (!keepDateAndLocation) { setDate(""); setLocation(""); setOtherLocation(""); }
    if (!keepGeneratedNote) {
      // NOTE: sessionSummaryRef is deliberately not touched here — this runs during render on a
      // client switch, and mutating a ref during render is invalid. It is cleared at the start of
      // handleGenerateNote instead, and it can never be read stale: saving requires a generated
      // note, and clearing generatedNote below makes that impossible until the next generation.
      setGeneratedNote("");
      setSessionSummary(null);
      setSimilarityWarning(false);
      setLastSavedNote("");
    }
  }

  const presentPerson = selectedPresent.join(" and ");

  function togglePresent(name: string) {
    setSelectedPresent((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  }

  function handleOtherClick() { customPresentRef.current?.focus(); }

  function handleSavePresent() {
    const name = customPresent.trim();
    if (!name) return;
    const updated = [...new Set([...savedPresent, name])];
    setSavedPresent(updated);
    localStorage.setItem(`path4aba_saved_present_${client.id}`, JSON.stringify(updated));
    fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinical_profile: { ...client.clinicalProfile, whoWasPresent: updated } }),
    });
    if (!selectedPresent.includes(name)) setSelectedPresent((prev) => [...prev, name]);
    setCustomPresent("");
  }

  // Save the typed "Other" location for this client, to the SAME store + route the extension uses
  // (clinical_profile.savedLocations via /api/rbt/clients/[id]/saved-locations — getExtensionAuth accepts
  // the web session too). Per-client; a location saved here appears as a chip in the extension and vice
  // versa. The note still receives the TYPED text (otherLocation), never the literal "other".
  function handleSaveLocation() {
    const name = otherLocation.trim();
    if (!name) return;
    if (!savedLocations.some((l) => l.toLowerCase() === name.toLowerCase())) {
      setSavedLocations((prev) => [...prev, name]);
    }
    fetch(`/api/rbt/clients/${client.id}/saved-locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: name }),
    }).catch(() => {});
  }

  // ── Profile overview editing (reinforcers + mark-mastered). Any assigned RBT can edit; the
  // /api/clients/[id] PATCH shallow-merges clinical_profile and is ownership-checked by canAccessClient.
  // We send only the changed top-level arrays; on success we mirror the change into local `client` state so
  // the overview + the note-form selection lists update immediately. On failure we alert and keep the old
  // state (no optimistic drift). NOTE: the profileSaving hook was moved UP to the hook cluster (see above) —
  // it must not be declared here, after the early returns, or it triggers React #310.
  async function patchClinicalProfile(patch: Record<string, any>) {
    if (!client?.id) return;
    setProfileSaving(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinical_profile: patch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || "Failed to save the change. Please try again.");
        return;
      }
      setClient((prev: any) => ({ ...prev, clinicalProfile: { ...prev.clinicalProfile, ...patch } }));
    } catch {
      alert("Network error saving the change. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  }

  const reinforcerName = (r: any) => (typeof r === "string" ? r : r?.name || String(r)).trim();

  // Reinforcers: delete removes from clinical_profile.reinforcers (no history kept — Marlon's ruling); add
  // runs splitReinforcerValue so "tablet or phone" becomes discrete items (the "or" fix stays).
  function deleteReinforcer(idx: number) {
    const current = (client.clinicalProfile?.reinforcers || []) as any[];
    patchClinicalProfile({ reinforcers: current.filter((_, i) => i !== idx) });
  }
  function addReinforcer(text: string) {
    const raw = text.trim();
    if (!raw) return;
    // Advisory only — warn if it looks edible OR like a community outing, but still add it (Marlon's ruling:
    // inform, don't block). Edible takes precedence if somehow both; a single item is virtually never both.
    setReinforcerWarning(
      looksEdible(raw) ? EDIBLE_WARNING
        : isCommunityOuting(raw) ? COMMUNITY_OUTING_WARNING
        : looksLikePersonRole(raw) ? PERSON_WARNING
        : "",
    );
    const current = (client.clinicalProfile?.reinforcers || []) as any[];
    // Split " or " into discrete items, then de-dupe (case-insensitive) against existing names.
    const additions = splitReinforcerValue([raw]) as string[];
    const existing = new Set(current.map((r) => reinforcerName(r).toLowerCase()));
    const merged = [...current];
    for (const a of additions) { if (a.trim() && !existing.has(a.trim().toLowerCase())) merged.push(a.trim()); }
    patchClinicalProfile({ reinforcers: merged });
  }

  const nameEq = (x: any, name: string) => reinforcerName(x).toLowerCase() === name.trim().toLowerCase();

  // Skill mastery: MOVE the object between replacementBehaviors (active) and skillAcquisition (mastered) —
  // the profile view + note filter both key mastered-skills on the skillAcquisition field. Reversible.
  function setSkillMastered(name: string, mastered: boolean) {
    const active = (client.clinicalProfile?.replacementBehaviors || []) as any[];
    const done = (client.clinicalProfile?.skillAcquisition || []) as any[];
    if (mastered) {
      const item = active.find((s) => nameEq(s, name)) ?? name;
      const moved = typeof item === "string" ? { name: item, status: "mastered" } : { ...item, status: "mastered" };
      patchClinicalProfile({
        replacementBehaviors: active.filter((s) => !nameEq(s, name)),
        skillAcquisition: done.some((s) => nameEq(s, name)) ? done : [...done, moved],
      });
    } else {
      const item = done.find((s) => nameEq(s, name)) ?? name;
      const moved = typeof item === "string" ? { name: item, status: "active" } : { ...item, status: "active" };
      patchClinicalProfile({
        skillAcquisition: done.filter((s) => !nameEq(s, name)),
        replacementBehaviors: active.some((s) => nameEq(s, name)) ? active : [...active, moved],
      });
    }
  }

  // Behavior mastery: flip the `status` on the maladaptiveBehaviors entry (the badge + the note filter both
  // read status). Reversible.
  function setBehaviorMastered(name: string, mastered: boolean) {
    const list = (client.clinicalProfile?.maladaptiveBehaviors || []) as any[];
    patchClinicalProfile({
      maladaptiveBehaviors: list.map((b) =>
        nameEq(b, name)
          ? (typeof b === "string" ? { name: b, status: mastered ? "mastered" : "active" } : { ...b, status: mastered ? "mastered" : "active" })
          : b,
      ),
    });
  }

  function toggleBehavior(name: string) {
    setSelectedBehaviors((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      return [...prev, name];
    });
  }

  function toggleSkill(name: string) {
    setSelectedSkills((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      return [...prev, name];
    });
  }

  const canGenerate =
    date.trim() !== "" && location !== "" && selectedPresent.length > 0 &&
    selectedBehaviors.length >= 1 && selectedSkills.length >= 1 &&
    date && location && selectedPresent.length > 0 &&
    // An environmental change was reported, so the session's compliance level must be the RBT's
    // own active choice before this note can be generated.
    complianceLevel !== "";

  async function handleGenerateNote() {
    if (!canGenerate) return;
    setGenerating(true);
    setFinalizing(false);
    setStatus("");           // progress is shown by the calm card, not the red status line (which is for errors)
    setGeneratedNote("");
    setSaveState("idle");    // the prior note's indicator must not bleed into this generation
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);  // drop any pending edit-save for the old text
    sessionSummaryRef.current = null;
    generationContextRef.current = null;

    // Slim payload: the server builds the full SessionInput from the authoritative DB profile
    // (dual-accept in /api/generate-note). Constraint sets (allowedFunctions, matrixFunctions,
    // approvedInterventions) are derived server-side, never sent from here.
    const body = {
      clientId: client.id,
      date,
      location,
      otherLocation,
      present: selectedPresent,
      selectedBehaviors,
      selectedSkills,
      compliance: complianceLevel,
      medicationChange: medicationConsumed,
      envChange: environmentalChange,
      envChangeDesc: environmentalChangeDesc,
      nextAppt: nextApptDate,
      continuityContext: continuityCtx || undefined,
    };

    try {
      const res = await fetch("/api/generate-note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setStatus(data?.details || data?.error || "Note generation failed.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // Accumulate the WHOLE stream (splitNoteStream parses over `raw`), so a __META__ JSON tail that spans
      // reads is handled — that per-chunk parse failure is why generation_context was being saved NULL.
      let raw = "";
      let fullText = "";      // the resolved note text (revealed live for pass 1; swapped to final at the end)
      // A message on the meta channel is not the same as "throw the result away". Only a BLOCKING
      // stop hides the note and skips the session-summary tables; an advisory is shown alongside them.
      let advisory = "";
      let regenSignaled = false;
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { note, metaRaw, sawRegen } = splitNoteStream(raw);

        // Option (a) — the compliance coverage retry: FREEZE the already-streamed text (stop updating it) and
        // dim it with a calm "Finalizing…" state. No wipe, no visible restart. Never a red "Regenerating".
        if (sawRegen && !regenSignaled) { regenSignaled = true; setFinalizing(true); }

        if (metaRaw === null) {
          // Still streaming. Pass 1 streams LIVE; once a regen has begun, hold the frozen text (do not update).
          if (!sawRegen) { fullText = note; setGeneratedNote(note); }
          continue;
        }
        // __META__ seen — accumulate until the JSON parses (it can span reads).
        try {
          const meta = JSON.parse(metaRaw);
          if (meta.error && meta.blocking !== false) { setStatus(meta.error); setGeneratedNote(""); return; }
          if (meta.error) { advisory = meta.error; }
          setSimilarityWarning(!!meta.similarityWarning);
          fullText = typeof meta.filteredText === "string" ? meta.filteredText : note;
          generationContextRef.current = { generationContext: meta.generationContext ?? null, activities: Array.isArray(meta.activitiesUsed) ? meta.activitiesUsed : [] };
          break outer;
        } catch {
          /* partial meta JSON — keep reading */
        }
      }
      setGeneratedNote(fullText);  // swap to the finished note (seamless for pass 1; the reveal after a regen)
      setStatus(advisory);  // only a genuine advisory ever shows here — no regeneration reporting
      if (fullText.trim()) {
        const backupNote = { id: crypto.randomUUID(), clientId: client.id, date: date || new Date().toLocaleDateString(), note: fullText };
        saveNote(backupNote);
        backupIdRef.current = backupNote.id;  // subsequent edits rewrite THIS record so the backup tracks them
        pendingEditTextRef.current = null;    // the generated text is what we're about to autosave, not a pending edit
        setDailyNotes(prev => [backupNote, ...prev]);
        setSessionSummary({
          behaviors: selectedBehaviors,
          skills: selectedSkills,
          interventions: extractInterventions(fullText),
        });
        sessionSummaryRef.current = {
          behaviors: selectedBehaviors,
          skills: selectedSkills,
          interventions: extractInterventions(fullText),
        };
        // AUTOSAVE — the note persists the instant it exists (the local backup above already ran first, so a
        // failed save never loses work). CREATE on a first generation, UPDATE the same row on a re-generation
        // (savedNoteIdRef carries across the cycle). Fire-and-forget so generation-complete never blocks on it.
        void queueSave(fullText, { withMetadata: true });
      }
    } catch {
      setStatus("Network error. Please try again.");
    } finally {
      setGenerating(false);
      setFinalizing(false);
    }
  }

  // Flip to "Saved ✓" and let it fade back to idle after a moment (a persistent green badge is noise once the
  // note is safe). A newer save that has already moved us to "saving"/"failed" cancels the fade.
  function markSaved() {
    setSaveState("saved");
    if (saveFadeRef.current) clearTimeout(saveFadeRef.current);
    saveFadeRef.current = setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 3000);
  }

  // The upsert. CREATE (POST) when no id is tracked yet — capturing the returned id so this cycle's later
  // saves UPDATE (PATCH) that same row. Metadata (behaviors/skills/interventions/activities/context) is sent
  // on a create and on an explicit generation/re-generation; a plain text edit omits it (the server preserves
  // untouched fields). Returns true on save/adopt, false only after the ONE silent auto-retry also fails.
  //   • POST 409 (identical note already exists) → adopt that id and show "Saved ✓" (never a duplicate error).
  //   • PATCH 404 (tracked note gone) → drop the id and recurse into a fresh CREATE — work is re-saved, never lost.
  async function persistNote(noteText: string, opts: { withMetadata?: boolean; attempt?: number } = {}): Promise<boolean> {
    if (!noteText.trim() || !client?.id) return false;
    const attempt = opts.attempt ?? 0;
    const isCreate = !savedNoteIdRef.current;
    const sendMeta = opts.withMetadata || isCreate;
    setSaveState("saving");
    const today = new Date();
    const meta = sendMeta ? {
      behaviorsAddressed: sessionSummaryRef.current?.behaviors || selectedBehaviors,
      skillsAddressed: sessionSummaryRef.current?.skills || selectedSkills,
      interventionsUsed: sessionSummaryRef.current?.interventions || [],
      activitiesUsed: generationContextRef.current?.activities || [],
      generationContext: generationContextRef.current?.generationContext || null,
    } : {};
    try {
      const id = savedNoteIdRef.current;
      const sessionDate = date || today.toISOString().split("T")[0];
      const body: any = { clientId: client.id, noteText, sessionDate, ...meta };
      // REPLACE: the RBT picked an occupied date and chose Replace (replaceDateRef). The first create of this
      // cycle supersedes that date's existing note atomically (client-generated id → idempotent, skips dup).
      const replacing = !id && replaceDateRef.current === sessionDate;
      if (replacing) { body.supersede = true; body.id = crypto.randomUUID(); }
      const res = id
        ? await fetch("/api/session-notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) })
        : await fetch("/api/session-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

      if (id && res.status === 404) {
        // The row we were updating no longer exists — re-create from scratch rather than losing the edit.
        savedNoteIdRef.current = null;
        return await persistNote(noteText, opts);
      }
      if (!id && res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data?.id) savedNoteIdRef.current = data.id;   // adopt the existing note; edits now update it
        setLastSavedNote(noteText);
        if (pendingEditTextRef.current === noteText) pendingEditTextRef.current = null;  // this edit is now on the server
        savedNoteCycleDateRef.current = sessionDate;      // this cycle's note is for this date — don't self-prompt on it
        markSaved();
        await loadNotesFromSupabase(client.id);
        await refreshOccupiedDates();
        return true;
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.id) savedNoteIdRef.current = data.id;
        setLastSavedNote(noteText);
        if (pendingEditTextRef.current === noteText) pendingEditTextRef.current = null;  // this edit is now on the server
        if (isCreate) {
          savedNoteCycleDateRef.current = sessionDate;    // this cycle's note is for this date — don't self-prompt on it
          if (replaceDateRef.current === sessionDate) replaceDateRef.current = null;  // replace consumed
        }
        markSaved();
        if (isCreate) { await loadNotesFromSupabase(client.id); await refreshOccupiedDates(); }  // reconcile list + occupancy once
        return true;
      }
      throw new Error("save failed");
    } catch {
      if (attempt === 0) return await persistNote(noteText, { ...opts, attempt: 1 });  // one silent auto-retry
      setSaveState("failed");  // persists until a retry or an explicit discard resolves it
      return false;
    }
  }

  // Serialize every save through one chain so the first CREATE finishes (and captures the id) before any
  // edit-UPDATE runs — otherwise a fast edit during the create could read a null id and create a second row.
  function queueSave(noteText: string, opts: { withMetadata?: boolean } = {}): Promise<boolean> {
    const p = saveChainRef.current.catch(() => false).then(() => persistNote(noteText, opts));
    saveChainRef.current = p.catch(() => false);
    return p;
  }

  // User edits to the generated note. Progressive-paint updates call setGeneratedNote directly, so they never
  // land here. Order matters: (A) rewrite the DEVICE BACKUP in place first — synchronous, offline, never fails,
  // so the edited text is on the device the instant it is typed (this is what makes a lost server save
  // recoverable); then debounce the server autosave (text only — an edit does not change metadata).
  function handleNoteEdit(v: string) {
    setGeneratedNote(v);
    if (backupIdRef.current) {
      updateNote(backupIdRef.current, v);
      setDailyNotes(prev => prev.map(n => (n.id === backupIdRef.current ? { ...n, note: v } : n)));
    }
    pendingEditTextRef.current = v;
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    editDebounceRef.current = setTimeout(() => { void queueSave(v, { withMetadata: false }); }, 1200);
  }

  // Best-effort server flush of the latest un-saved edit on the way out (pagehide / client-switch / unmount).
  // keepalive lets the request outlive the page teardown; it supports PATCH, which sendBeacon (POST-only) can
  // not. Reads only refs so it is safe from any closure. The device backup (A) already holds this text, so a
  // dropped flush loses nothing — and on a create-during-flush the server dedups identical text (409).
  function flushPending() {
    const text = pendingEditTextRef.current;
    const clientId = clientIdRef.current;
    if (!text || !text.trim() || !clientId) return;
    if (editDebounceRef.current) { clearTimeout(editDebounceRef.current); editDebounceRef.current = null; }
    const id = savedNoteIdRef.current;
    const body = JSON.stringify({ ...(id ? { id } : {}), clientId, noteText: text, sessionDate: dateRef.current || new Date().toISOString().split("T")[0] });
    try {
      fetch("/api/session-notes", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    } catch { /* device backup already holds this edit; a failed flush loses nothing */ }
    pendingEditTextRef.current = null;
  }

  // Leaving the textarea flushes immediately — the cheapest coverage of the common case (type, then click
  // away). A normal serialized save (with the indicator), since the page is still alive here.
  function handleNoteBlur() {
    if (editDebounceRef.current) { clearTimeout(editDebounceRef.current); editDebounceRef.current = null; }
    const text = pendingEditTextRef.current;
    if (text && text.trim()) void queueSave(text, { withMetadata: false });
  }

  // Clears the whole form for a fresh note. GATED ON SAVE STATE — clearing unpersisted work is data loss, and
  // Start-new is exactly the button pressed next. Clean → the plain confirm. Dirty (edited since the last save,
  // or a save still pending) → FLUSH first: on success, the plain confirm; on failure, never clear silently —
  // an explicit discard confirm that names the local backup. The generated note is always in the local backup
  // (saveNote at generation), so even a discard is recoverable.
  async function handleStartNewNote() {
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    const doClear = () => {
      savedNoteIdRef.current = null;
      savedNoteCycleDateRef.current = null;  // fresh cycle — no own-note date to exclude yet
      replaceDateRef.current = null;
      setSaveState("idle");
      resetNoteForm();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const dirty = !!generatedNote.trim() && generatedNote !== lastSavedNote;
    if (dirty) {
      const ok = await queueSave(generatedNote, { withMetadata: true });
      if (!ok) {
        if (confirm("This note could not be saved to this client's notes, so it won't appear there. The full note — including your edits — is kept as a local backup on this device, so it can still be recovered. Discard it here and start a new note anyway?")) doClear();
        return;
      }
    }
    if (confirm("Start a new note? This clears the form.")) doClear();
  }

  // Live compliance calendar — fires when the RBT PICKS the date (before any generation, so it never races the
  // autosave create). If the date already has an ACTIVE note (and it isn't this cycle's own note), open the
  // View/Replace/Cancel dialog. A new pick clears any prior replace-intent; the dialog re-arms it.
  function handleDatePick(picked: string) {
    const previous = date;
    replaceDateRef.current = null;
    setDate(picked);
    fetchBcbaOverlapContext(picked);
    if (picked && occupiedDates.has(picked) && picked !== savedNoteCycleDateRef.current) {
      setDateConflict({ date: picked, previous });
    }
  }

  // Cancel = "I'll pick a different date": REVERT the date so generation can never land on the occupied date
  // without a decision. The only way onto an occupied date is Replace → supersede.
  function cancelDateConflict() {
    if (!dateConflict) return;
    setDate(dateConflict.previous);
    fetchBcbaOverlapContext(dateConflict.previous);
    setDateConflict(null);
  }

  // Replace: arm the next generation's autosave to supersede this date's note (atomic supersede-create), keep
  // the picked date, close.
  function replaceDateConflict() {
    if (!dateConflict) return;
    replaceDateRef.current = dateConflict.date;
    setDateConflict(null);
  }

  // View: fetch the existing note's text (PHI, on demand only) and show it read-only inside the dialog, so the
  // RBT decides informed rather than blind.
  async function viewDateConflict() {
    if (!dateConflict || !client?.id) return;
    const forDate = dateConflict.date;
    setDateConflict((c) => (c ? { ...c, loadingView: true } : c));
    try {
      const res = await fetch(`/api/session-notes/by-date?clientId=${client.id}&date=${forDate}`);
      const { note } = await res.json();
      setDateConflict((c) => (c && c.date === forDate ? { ...c, noteText: note?.text ?? "(This note is empty.)", loadingView: false } : c));
    } catch {
      setDateConflict((c) => (c && c.date === forDate ? { ...c, noteText: "Could not load the existing note.", loadingView: false } : c));
    }
  }


  async function fetchBcbaOverlapContext(sessionDate: string) {
    if (!sessionDate || !client.id) return;
    try {
      const res = await fetch(`/api/rbt/bcba-overlap-context?clientId=${client.id}&date=${sessionDate}`);
      if (!res.ok) { setBcbaOverlapContext(null); return; }
      const json = await res.json();
      setBcbaOverlapContext(json.empty ? null : json);
    } catch {
      setBcbaOverlapContext(null);
    }
  }

  async function handleDeleteNote(noteId: string, fromSupabase?: boolean) {
    // The note is kept on file (soft-deleted), not destroyed — it leaves the list but is recoverable, so the
    // copy no longer implies permanence (same reasoning as the client Archive change).
    if (!window.confirm("Delete this note? It will be removed from the list but kept on file, and can be restored if you need it.")) return;
    if (fromSupabase) {
      await fetch(`/api/session-notes?id=${noteId}`, { method: "DELETE" });
    } else {
      deleteNote(noteId);
    }
    setDailyNotes((prev) => prev.filter((note) => note.id !== noteId));
  }

  async function handleUpdateAssessment() {
    if (!updateAssessFile || !client?.id) return;
    setUpdateAssessing(true);
    setUpdateAssessError("");
    setUpdateAssessSuccess(false);
    try {
      const formData = new FormData();
      formData.append("file", updateAssessFile);
      formData.append("clientId", client.id);
      const res = await fetch("/api/extract-assessment", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setUpdateAssessError(data?.details || data?.error || "Extraction failed.");
        return;
      }
      setUpdateAssessSuccess(true);
      // Refresh client profile
      const updatedClient = { ...client, clinicalProfile: { ...client.clinicalProfile, ...data } };
      setClient(updatedClient);
    } catch {
      setUpdateAssessError("Network error. Please try again.");
    } finally {
      setUpdateAssessing(false);
      // The source PDF is saved on success AND on a 422 (extraction rejected), so refresh either way.
      if (client?.id) loadClientFiles(client.id);
    }
  }

  async function handleShareWithBCBA() {
    setGeneratingCode(true);
    setShareError("");
    try {
      const res = await fetch("/api/clients/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const data = await res.json();
      if (!res.ok) { setShareError(data.error || "Failed to generate code"); setGeneratingCode(false); return; }
      setShareCode(data.code);
      setShowShareModal(true);
    } catch {
      setShareError("Network error. Please try again.");
    }
    setGeneratingCode(false);
  }

  async function loadClientFiles(clientId: string) {
    try {
      const res = await fetch(`/api/clients/${clientId}/files`);
      if (!res.ok) return; // non-owner (403) or error: leave the list empty
      const data = await res.json();
      setClientFiles(Array.isArray(data?.files) ? data.files : []);
    } catch { /* non-fatal: Files section just shows empty */ }
  }

  async function handleDeleteFile(fileId: string) {
    if (!client?.id) return;
    if (!confirm('Delete this stored source PDF? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/clients/${client.id}/files/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || 'Failed to delete the file. Please try again.');
        return; // do NOT remove from local state on a failed delete
      }
      setClientFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {
      alert('Network error deleting the file. Please try again.');
    }
  }

  async function handleSaveAuthorizedHours(hours: number) {
    setSavingHours(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorizedHoursPerWeek: hours }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || 'Failed to save authorized hours. Please try again.');
        return; // do NOT update local state on a failed save
      }
      setAuthorizedHoursPerWeek(hours);
    } catch {
      alert('Network error saving authorized hours. Please try again.');
    } finally { setSavingHours(false); }
  }

  const isAdmin = (session?.user as any)?.role === 'admin';

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "fast", label: "FAST" },
    ...(client?.treatmentMapApproved ? [{ key: "treatment_map" as Tab, label: "Treatment Map" }] : []),
    { key: "generate", label: "Generate Note" },
    { key: "notes", label: "Notes" },
    { key: "data", label: "Data" },
  ];

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
  }

  // extractInterventions is the shared parser (lib/extractInterventions) — one source for web, PWA, extension.

  // "Needs review" banner: plain-language lines derived from the guard's reviewFlags (persisted in
  // clinical_profile; also merged in after an in-page Update Assessment). Pure display — no mutation.
  const reviewLines = reviewBannerLines(client?.clinicalProfile?.reviewFlags);
  // Behavior list came from AI fallback (prose-woven upload the geometry couldn't verify) → show a prominent
  // "Needs verification" indicator next to the Maladaptive Behaviors section until a human confirms it.
  const behaviorsAiFallback = (client?.clinicalProfile?.reviewFlags || []).some(
    (f: any) => f?.field === "behaviors" && f?.source === "llm-fallback",
  );

  // FAST tab — save one behavior's edited functions via the gated behavior-functions route (2b). On success,
  // update the row in place with the server's canonical result + human-edited source marker. On failure, keep
  // the row as it was (the edit form stays open with an error) so we never leave a half-applied row.
  async function saveBehaviorFunctions(behaviorName: string, selected: string[]) {
    if (!client?.id) return;
    setFnSaving(true); setFnError("");
    try {
      const res = await fetch(`/api/clients/${client.id}/behavior-functions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ behaviorName, functions: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFnError(data?.error || "Could not save — please try again."); return; }
      // Reflect the server's canonical result on the matching behavior (functions + source marker).
      setClient((prev: any) => {
        const behaviors = (prev?.clinicalProfile?.maladaptiveBehaviors || []).map((b: any) =>
          (typeof b === "object" && String(b?.name || "") === String(data.behavior || behaviorName))
            ? { ...b, functions: data.functions, functionsSource: "human-edited", functionsEditedBy: data.editedBy, functionsEditedAt: data.editedAt }
            : b
        );
        return { ...prev, clinicalProfile: { ...prev.clinicalProfile, maladaptiveBehaviors: behaviors } };
      });
      setFnEdit(null);
    } catch {
      setFnError("Network error — please try again.");
    } finally {
      setFnSaving(false);
    }
  }

  // FAST tab — save one behavior's topography via the gated behavior-topography route. Mirrors
  // saveBehaviorFunctions: the server writes `topographies` + the human-edited markers; we reflect the server's
  // result on the matching row. Once saved, the behavior is no longer incomplete (behaviorMissingFields reads
  // topographies) and becomes selectable in the note form.
  async function saveBehaviorTopography(behaviorName: string, text: string) {
    if (!client?.id) return;
    setTopoSaving(true); setTopoError("");
    try {
      const res = await fetch(`/api/clients/${client.id}/behavior-topography`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ behaviorName, topography: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setTopoError(data?.error || "Could not save — please try again."); return; }
      setClient((prev: any) => {
        const behaviors = (prev?.clinicalProfile?.maladaptiveBehaviors || []).map((b: any) =>
          (typeof b === "object" && String(b?.name || "") === String(data.behavior || behaviorName))
            ? { ...b, topographies: data.topographies, topographySource: "human-edited", topographyEditedBy: data.editedBy, topographyEditedAt: data.editedAt }
            : b
        );
        return { ...prev, clinicalProfile: { ...prev.clinicalProfile, maladaptiveBehaviors: behaviors } };
      });
      setTopoEdit(null);
    } catch {
      setTopoError("Network error — please try again.");
    } finally {
      setTopoSaving(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Topbar / breadcrumb */}
      <div
        className="flex items-center px-8 h-14 bg-white"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Link href="/clients" className="text-[13px] hover:underline" style={{ color: "var(--text3)" }}>
          Clients
        </Link>
        <span className="mx-2 text-[13px]" style={{ color: "var(--border2)" }}>/</span>
        <span className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{client.clientName}</span>
      </div>

      <div className="px-8 py-7 max-w-5xl">

        {/* Profile header card */}
        <div className="bg-white rounded-[10px] border p-6 mb-6" style={{ borderColor: "var(--border)" }}>
          {/* Top row */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold text-white flex-shrink-0"
                style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
              >
                {client.clientName.split(/\s+/).filter(Boolean).map((w: string) => w[0].toUpperCase()).slice(0, 2).join("")}
              </div>
              <div>
                <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--text1)" }}>{client.clientName}</h1>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: "#E6F9F5", color: "#0D8A6A" }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Active
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => handleTabChange("generate")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--teal)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
                </svg>
                Generate Note
              </button>
              <button
                onClick={handleShareWithBCBA}
                disabled={generatingCode}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors hover:border-gray-400 disabled:opacity-50"
                style={{ borderColor: "var(--border)", color: "var(--text2)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
                {generatingCode ? "Generating…" : "Share with BCBA"}
              </button>
              <Link
                href={`/clients/${client.id}/progress-report`}
                className="px-4 py-2 rounded-xl border text-[13px] font-medium"
                style={{ borderColor: "var(--teal)", color: "var(--teal)" }}
              >
                Progress Report
              </Link>
              <button
                onClick={() => { setShowUpdateAssessment(true); setUpdateAssessFile(null); setUpdateAssessError(""); setUpdateAssessSuccess(false); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors hover:border-gray-400"
                style={{ borderColor: "var(--border)", color: "var(--text2)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Update Assessment
              </button>
            </div>
            {shareError && <p className="text-[12px] text-red-500 mt-1">{shareError}</p>}
          </div>

          {/* Meta fields */}
          <div className="grid grid-cols-3 gap-6" style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
            {[
              { label: "Behaviors", value: (client.clinicalProfile?.maladaptiveBehaviors?.length || 0) + " tracked" },
              { label: "Interventions", value: (client.clinicalProfile?.interventions?.length || 0) + " from assessment" },
              { label: "Skills", value: (activePrograms.length + masteredSkills.length) + " programs" },
              { label: "Reinforcers", value: client.clinicalProfile?.reinforcers?.length || 0 },
              { label: "Notes Saved", value: dailyNotes.length },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[11px] uppercase tracking-wide font-medium mb-0.5" style={{ color: "var(--text3)" }}>{label}</p>
                <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* "Needs review" banner — shown when the assessment guard flagged unverified data.
            Amber (visible, non-alarming), persistent while flags exist, self-clears when the next
            clean upload recomputes empty reviewFlags. Pure display: no mutation, no raw reason shown. */}
        {reviewLines.length > 0 && (
          <div className="rounded-[10px] border-l-4 p-4 mb-6" style={{ background: "#FEF3C7", borderLeftColor: "#F59E0B" }}>
            <div className="flex items-start gap-3" style={{ color: "#92400E" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div>
                <p className="text-[14px] font-semibold mb-1">Needs review</p>
                <p className="text-[13px] mb-2">This assessment upload couldn&apos;t be fully read automatically. The items below were kept or estimated — please double-check them.</p>
                <ul className="list-disc pl-5 text-[13px]" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {reviewLines.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6" style={{ borderBottom: "1px solid var(--border)" }}>
          {TABS.map(({ key, label }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className="px-4 py-3 text-[13px] font-medium transition-colors -mb-px border-b-2"
                style={{
                  color: active ? "var(--teal)" : "var(--text3)",
                  borderBottomColor: active ? "var(--teal)" : "transparent",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div>
          <p className="text-[12px] mb-4" style={{ color: "var(--text3)" }}>Clinical profile managed by your BCBA</p>
          <div className="grid grid-cols-[280px_1fr] gap-5">
            {/* Left column */}
            <div className="space-y-5">
              <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Clinical Snapshot" />
                <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: "var(--text3)" }}>Authorized Hours/Week</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="40"
                      value={authorizedHoursPerWeek || ""}
                      onChange={e => setAuthorizedHoursPerWeek(Number(e.target.value))}
                      onBlur={e => handleSaveAuthorizedHours(Number(e.target.value))}
                      placeholder="0"
                      className="w-16 text-right border rounded px-2 py-0.5 text-[12px]"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <span className="text-[12px] font-semibold" style={{ color: "var(--text1)" }}>hrs/wk</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: "var(--text3)" }}>Client Gender</span>
                  <select
                    value={client.clinicalProfile?.gender || ""}
                    onChange={async (e) => {
                      const gender = e.target.value;
                      try {
                        const res = await fetch(`/api/clients/${client.id}/profile`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ gender }),
                        });
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          alert(data?.error || 'Failed to save client gender. Please try again.');
                          setClient((prev: any) => ({ ...prev })); // revert the select to the persisted value
                          return; // do NOT update local state on a failed save
                        }
                        setClient((prev: any) => ({
                          ...prev,
                          clinicalProfile: { ...prev.clinicalProfile, gender }
                        }));
                      } catch {
                        alert('Network error saving client gender. Please try again.');
                        setClient((prev: any) => ({ ...prev })); // revert the select
                      }
                    }}
                    className="border rounded-lg px-2 py-1 text-[12px]"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  >
                    <option value="">Not specified</option>
                    <option value="male">Male (he/him)</option>
                    <option value="female">Female (she/her)</option>
                  </select>
                </div>
                {/* ── Files: stored source assessment PDFs ── */}
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--text1)" }}>Files (source assessments)</span>
                    <span className="text-[11px]" style={{ color: "var(--text3)" }}>{clientFiles.length} file{clientFiles.length === 1 ? "" : "s"}</span>
                  </div>
                  {clientFiles.length === 0 ? (
                    <p className="text-[11px]" style={{ color: "var(--text3)" }}>No source PDFs stored yet. Uploading an assessment saves the original here.</p>
                  ) : (
                    <ul className="space-y-1">
                      {clientFiles.map((f) => (
                        <li key={f.id} className="flex items-center justify-between text-[11px]" style={{ color: "var(--text2)" }}>
                          <span className="truncate mr-2" title={f.filename}>
                            {f.filename} · {(Number(f.size_bytes) / 1024 / 1024).toFixed(1)} MB · {new Date(f.uploaded_at).toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            <a href={`/api/clients/${client.id}/files/${f.id}`} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>View</a>
                            <button onClick={() => handleDeleteFile(f.id)} style={{ color: "#dc2626" }}>Delete</button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                  {[
                    { label: "Maladaptive Behaviors", value: client.clinicalProfile?.maladaptiveBehaviors?.length || 0 },
                    { label: "Interventions from Assessment", value: client.clinicalProfile?.interventions?.length || 0 },
                    { label: "Active Replacement Programs", value: activePrograms.length },
                    { label: "Mastered Skills", value: masteredSkills.length },
                    { label: "Reinforcers", value: client.clinicalProfile?.reinforcers?.length || 0 },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-[13px]" style={{ color: "var(--text2)" }}>{label}</span>
                      <span className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Interventions in Profile" />
                <div className="flex flex-wrap gap-2">
                  {(client.clinicalProfile?.interventions || []).slice(0, 8).map((i: any, idx: number) => (
                    <span
                      key={idx}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full"
                      style={{ background: "var(--teal-light)", color: "var(--teal)" }}
                    >
                      {typeof i === "string" ? i : i.name}
                    </span>
                  ))}
                  {!client.clinicalProfile?.interventions?.length && (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>No interventions recorded.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-5">
              <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <SectionHeader title="Maladaptive Behaviors" />
                  {behaviorsAiFallback && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #F59E0B" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      Needs verification — AI-extracted
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(client.clinicalProfile?.maladaptiveBehaviors || []).map((b: any, idx: number) => (
                    <span
                      key={idx}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full border"
                      style={{ background: "#FEF3E2", color: "#B7791F", borderColor: "#F6AD5580" }}
                    >
                      {typeof b === "string" ? b : b.name}
                    </span>
                  ))}
                  {!client.clinicalProfile?.maladaptiveBehaviors?.length && (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>No behaviors recorded.</p>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Replacement Skills" />
                {/* Two clinically-distinct groups: active replacement programs vs skills the assessment marked
                    MASTERED. Deduped (Layer 2) so a mastered skill never also appears as active. */}
                {!skills.length ? (
                  <p className="text-[13px]" style={{ color: "var(--text3)" }}>No skills recorded.</p>
                ) : (
                  <>
                    <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--text3)" }}>
                      Active Replacement Programs ({activePrograms.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {activePrograms.map((s: any, idx: number) => (
                        <span
                          key={idx}
                          className="text-[11px] font-medium px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
                          style={{ background: "var(--teal-light)", color: "var(--teal)" }}
                        >
                          {typeof s === "string" ? s : s.name}
                          <button
                            type="button"
                            disabled={profileSaving}
                            title="Mark this program as mastered (removes it from note selection)"
                            onClick={() => setSkillMastered(reinforcerName(s), true)}
                            className="text-[10px] underline disabled:opacity-40 hover:opacity-70"
                          >
                            mark mastered
                          </button>
                        </span>
                      ))}
                      {!activePrograms.length && (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>None.</p>
                      )}
                    </div>
                    <p className="text-[11px] uppercase tracking-widest font-semibold mb-2 mt-4" style={{ color: "var(--text3)" }}>
                      Mastered Skills ({masteredSkills.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {masteredSkills.map((s: any, idx: number) => (
                        <span
                          key={idx}
                          className="text-[11px] font-medium px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5"
                          style={{ background: "var(--bg)", color: "var(--text2)", borderColor: "var(--border)" }}
                        >
                          {typeof s === "string" ? s : s.name}
                          <button
                            type="button"
                            disabled={profileSaving}
                            title="Move back to active programs (skill regressed)"
                            onClick={() => setSkillMastered(reinforcerName(s), false)}
                            className="text-[10px] underline disabled:opacity-40 hover:opacity-70"
                          >
                            mark active
                          </button>
                        </span>
                      ))}
                      {!masteredSkills.length && (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>None.</p>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                <SectionHeader title="Reinforcers" />
                <div className="flex flex-wrap gap-2">
                  {(client.clinicalProfile?.reinforcers || []).map((r: any, idx: number) => (
                    <span
                      key={idx}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
                      style={{ background: "#F5F3FF", color: "#6D28D9" }}
                    >
                      {typeof r === "string" ? r : r?.name || String(r)}
                      <button
                        type="button"
                        aria-label={`Remove ${reinforcerName(r)}`}
                        disabled={profileSaving}
                        onClick={() => deleteReinforcer(idx)}
                        className="leading-none font-bold disabled:opacity-40 hover:opacity-70"
                        style={{ color: "#6D28D9" }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {!client.clinicalProfile?.reinforcers?.length && (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>No reinforcers recorded.</p>
                  )}
                </div>
                {/* Add a reinforcer. Edibles are allowed (advisory only, EN+ES below); " or " splits into items. */}
                <form
                  className="flex gap-2 mt-3"
                  onSubmit={(e) => { e.preventDefault(); addReinforcer(newReinforcer); setNewReinforcer(""); }}
                >
                  <input
                    type="text"
                    value={newReinforcer}
                    onChange={(e) => setNewReinforcer(e.target.value)}
                    placeholder="Add a reinforcer…"
                    className="flex-1 border rounded-lg px-3 py-2 text-[13px]"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                  <button
                    type="submit"
                    disabled={profileSaving || !newReinforcer.trim()}
                    className="px-3 py-2 rounded-lg border text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                  >
                    Add
                  </button>
                </form>
                {reinforcerWarning && (
                  reinforcerWarning === EDIBLE_WARNING ? (
                    // Edibles are allowed now — this is GUIDANCE, not a filter warning. Neutral tone, EN + ES.
                    <div className="mt-2 text-[12px] px-3 py-2 rounded-lg border" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                      <p>ℹ️ {EDIBLE_WARNING}</p>
                      <p className="mt-1">{EDIBLE_WARNING_ES}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                      ⚠️ {reinforcerWarning}
                    </p>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Phase 2: live treatment-plan diff (informational; proves the matcher for Phase 3) */}
          <CatalogDiffPanel clinicalProfile={client.clinicalProfile} />
          </div>
        )}

        {/* ── FAST Tab — behavior → function review (read-only, Piece 1) ── */}
        {activeTab === "fast" && (() => {
          const rows: any[] = client.clinicalProfile?.maladaptiveBehaviors || [];
          const flags: any[] = client.clinicalProfile?.reviewFlags || [];
          // Per-behavior FAST flags: the HIGH route writes behavior:<name> (source 'behavior-review') when a
          // behavior's function wasn't structurally verified. Match by normalized name.
          const flaggedNames = new Set(
            flags
              .filter((f: any) => f?.source === "behavior-review" && String(f?.field || "").startsWith("behavior:"))
              .map((f: any) => String(f.field).slice("behavior:".length).trim().toLowerCase())
          );
          // LOW/UNREAD route preserved the existing behaviors instead of refreshing them (guard-preserved).
          const preservedLow = flags.some((f: any) => f?.field === "behaviors" && f?.source === "guard-preserved");
          // Canonical function vocabulary — the UI half of the firewall (the 2b route re-validates server-side).
          const CANONICAL_FUNCTIONS = ["attention", "escape", "tangible", "automatic"];
          const fmtDate = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return isNaN(+d) ? "" : d.toLocaleDateString(); };

          return (
            <div className="space-y-4">
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                The function(s) recorded for each behavior. Click <strong>Edit</strong> to correct a behavior&apos;s functions — changes are saved and marked as reviewed by you.
              </p>
              {preservedLow && (
                <div className="rounded-[10px] border-l-4 p-3 text-[13px]" style={{ background: "#FEF3C7", borderLeftColor: "#F59E0B", color: "#92400E" }}>
                  Functions preserved from the prior assessment (this upload couldn&apos;t be read cleanly) — please review.
                </div>
              )}

              {rows.length === 0 ? (
                <div className="bg-white rounded-[10px] border p-8 text-center" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[13px]" style={{ color: "var(--text3)" }}>No behaviors recorded. Upload an assessment to populate this table.</p>
                </div>
              ) : (
                <div className="bg-white rounded-[10px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                          <th className="text-left font-semibold px-4 py-3" style={{ color: "var(--text2)" }}>Behavior</th>
                          <th className="text-left font-semibold px-4 py-3" style={{ color: "var(--text2)" }}>Function(s)</th>
                          <th className="text-left font-semibold px-4 py-3" style={{ color: "var(--text2)" }}>Topography</th>
                          <th className="text-left font-semibold px-4 py-3" style={{ color: "var(--text2)" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((b: any, i: number) => {
                          const name = typeof b === "string" ? b : (b?.name || "");
                          const fns: string[] = typeof b === "object" ? (b.functions || b.function || []) : [];
                          const topos: string[] = typeof b === "object" ? (b.topographies || (b.topography ? [b.topography] : [])) : [];
                          const status = (typeof b === "object" && b?.status) ? b.status : "active";
                          const flagged = flaggedNames.has(String(name).trim().toLowerCase());
                          const humanEdited = typeof b === "object" && b?.functionsSource === "human-edited";
                          const isEditing = fnEdit?.name === name;
                          const topoHumanEdited = typeof b === "object" && b?.topographySource === "human-edited";
                          const isEditingTopo = topoEdit?.name === name;
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td className="px-4 py-3 align-top" style={{ color: "var(--text1)", fontWeight: 500 }}>
                                {name}
                                {flagged && (
                                  <span className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "#FEF3C7", color: "#92400E" }}>⚠ confirm</span>
                                )}
                              </td>
                              <td className="px-4 py-3 align-top" style={{ minWidth: 260 }}>
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap gap-1.5">
                                      {CANONICAL_FUNCTIONS.map((fn) => {
                                        const on = fnEdit!.selected.includes(fn);
                                        return (
                                          <button
                                            key={fn}
                                            type="button"
                                            onClick={() => setFnEdit((p) => p && ({ ...p, selected: on ? p.selected.filter((x) => x !== fn) : [...p.selected, fn] }))}
                                            className="text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors"
                                            style={on
                                              ? { background: "var(--teal)", color: "white", borderColor: "var(--teal)" }
                                              : { background: "white", color: "var(--text2)", borderColor: "var(--border)" }}
                                          >
                                            {functionDisplayLabel(fn)}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button type="button" disabled={fnSaving} onClick={() => saveBehaviorFunctions(name, fnEdit!.selected)}
                                        className="text-[12px] font-semibold px-3 py-1 rounded-lg text-white disabled:opacity-50" style={{ background: "var(--teal)" }}>
                                        {fnSaving ? "Saving…" : "Save"}
                                      </button>
                                      <button type="button" disabled={fnSaving} onClick={() => { setFnEdit(null); setFnError(""); }}
                                        className="text-[12px] font-medium px-3 py-1 rounded-lg border disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                                        Cancel
                                      </button>
                                    </div>
                                    {fnError && <p className="text-[12px]" style={{ color: "#dc2626" }}>{fnError}</p>}
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {fns.length ? fns.map((fn, j) => (
                                        <span key={j} className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>
                                          {functionDisplayLabel(fn)}
                                        </span>
                                      )) : <span style={{ color: "var(--text3)" }}>—</span>}
                                      <button type="button"
                                        onClick={() => { setFnError(""); setFnEdit({ name, selected: fns.map((f: string) => functionToCanonical(f)).filter((x): x is string => !!x) }); }}
                                        className="ml-1 text-[11px] font-medium underline" style={{ color: "var(--teal)" }}>
                                        Edit
                                      </button>
                                    </div>
                                    <p className="text-[10px]" style={{ color: "var(--text3)" }}>
                                      {humanEdited
                                        ? `edited by ${b.functionsEditedBy || "a user"}${b.functionsEditedAt ? " · " + fmtDate(b.functionsEditedAt) : ""}`
                                        : "from assessment"}
                                    </p>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 align-top" style={{ color: "var(--text2)", maxWidth: 420 }}>
                                {isEditingTopo ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={topoEdit!.text}
                                      onChange={(e) => setTopoEdit((p) => p && ({ ...p, text: e.target.value }))}
                                      rows={3}
                                      placeholder="Operational definition — what the behavior looks like (e.g. 'any instance the client…')."
                                      className="w-full text-[12px] p-2 rounded-lg border"
                                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                                    />
                                    <div className="flex items-center gap-2">
                                      <button type="button" disabled={topoSaving || !topoEdit!.text.trim()} onClick={() => saveBehaviorTopography(name, topoEdit!.text)}
                                        className="text-[12px] font-semibold px-3 py-1 rounded-lg text-white disabled:opacity-50" style={{ background: "var(--teal)" }}>
                                        {topoSaving ? "Saving…" : "Save"}
                                      </button>
                                      <button type="button" disabled={topoSaving} onClick={() => { setTopoEdit(null); setTopoError(""); }}
                                        className="text-[12px] font-medium px-3 py-1 rounded-lg border disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                                        Cancel
                                      </button>
                                    </div>
                                    {topoError && <p className="text-[12px]" style={{ color: "#dc2626" }}>{topoError}</p>}
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="flex items-start gap-1.5">
                                      <span style={{ flex: 1 }}>{topos.length ? topos.join(" ") : <span style={{ color: "var(--text3)" }}>—</span>}</span>
                                      <button type="button"
                                        onClick={() => { setTopoError(""); setTopoEdit({ name, text: topos.join(" ") }); }}
                                        className="ml-1 text-[11px] font-medium underline flex-shrink-0" style={{ color: "var(--teal)" }}>
                                        {topos.length ? "Edit" : "Add"}
                                      </button>
                                    </div>
                                    {topoHumanEdited && (
                                      <p className="text-[10px]" style={{ color: "var(--text3)" }}>
                                        entered by {b.topographyEditedBy || "a user"}{b.topographyEditedAt ? " · " + fmtDate(b.topographyEditedAt) : ""}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: status === "mastered" ? "var(--bg)" : "#E6F9F5", color: status === "mastered" ? "var(--text2)" : "#0D8A6A", border: status === "mastered" ? "1px solid var(--border)" : "none" }}>
                                    {status}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={profileSaving}
                                    title={status === "mastered" ? "Move back to active (behavior regressed)" : "Mark as mastered (removes it from note selection)"}
                                    onClick={() => setBehaviorMastered(name, status !== "mastered")}
                                    className="text-[10px] underline disabled:opacity-40 hover:opacity-70"
                                    style={{ color: "var(--teal)" }}
                                  >
                                    {status === "mastered" ? "mark active" : "mark mastered"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Treatment Map Tab ── */}
        {/* ── Treatment Map Tab ── */}
        {activeTab === "treatment_map" && (
          <div className="space-y-4">
            {/* Header */}
            <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Treatment Map</p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>Visual summary of behaviors, functions, and replacement skills from the client's assessment. Reviewed and approved by supervising BCBA.</p>
            </div>

            {(() => {
              const rawBehaviors = (client.clinicalProfile?.maladaptiveBehaviors || []);
              // Reconciled (Layer 2): active programs (mastered subtracted) + mastered skills — no cross-field
              // duplicate reaches the Treatment Map.
              const rawReplacements = skills;
              const approvedInterventions = (client.clinicalProfile?.interventions || []).map((i: any) => typeof i === "string" ? i : i?.name || "").filter(Boolean);

              if (rawBehaviors.length === 0 && rawReplacements.length === 0) {
                return (
                  <div className="bg-white rounded-[10px] border p-8 text-center" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>No clinical data found. Upload an assessment to generate the Treatment Map.</p>
                  </div>
                );
              }

              // Build function groups
              const functionGroups: Record<string, { behaviors: string[]; replacements: string[] }> = {};
              rawBehaviors.forEach((b: any) => {
                const name = typeof b === "string" ? b : b?.name || "";
                const funcs: string[] = typeof b === "object" ? (b.functions || b.function || []) : [];
                const allFuncs = funcs.length > 0 ? funcs : ["unknown"];
                allFuncs.forEach((func: string) => {
                  const fKey = func.toLowerCase();
                  if (!functionGroups[fKey]) functionGroups[fKey] = { behaviors: [], replacements: [] };
                  if (name && !functionGroups[fKey].behaviors.includes(name)) {
                    functionGroups[fKey].behaviors.push(name);
                  }
                });
              });
              rawReplacements.forEach((s: any) => {
                const name = typeof s === "string" ? s : s?.name || "";
                const tf = (typeof s === "object" ? (s.targetFunction || "") : "").toLowerCase();
                if (tf && functionGroups[tf]) functionGroups[tf].replacements.push(name);
                else if (tf) { functionGroups[tf] = { behaviors: [], replacements: [name] }; }
              });

              const funcColors: Record<string, { bg: string; color: string; border: string }> = {
                escape:    { bg: "#FEF3C7", color: "#D97706", border: "#FCD34D" },
                attention: { bg: "#EFF6FF", color: "#2563EB", border: "#BFDBFE" },
                tangible:  { bg: "#F0FDF4", color: "#16A34A", border: "#A7F3D0" },
                automatic: { bg: "#F5F3FF", color: "#7C3AED", border: "#DDD6FE" },
                unknown:   { bg: "#F9FAFB", color: "#6B7280", border: "#E5E7EB" },
              };

              return (
                <>
                  {/* Table 1: Maladaptive Behaviors */}
                  {rawBehaviors.length > 0 && (
                    <div className="bg-white rounded-[10px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                      <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#FEF2F2" }}>
                        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#991B1B" }}>Maladaptive Behaviors</p>
                        <p className="text-[11px]" style={{ color: "#B91C1C" }}>What to do when you see this behavior</p>
                      </div>
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                            {["Behavior", "Functions"].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rawBehaviors.map((b: any, i: number) => {
                            const name = typeof b === "string" ? b : b?.name || "";
                            const funcs: string[] = typeof b === "object" ? (b.functions || b.function || []) : [];
                            return (
                              <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                                <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{name}</td>
                                <td className="px-4 py-3">
                                  {funcs.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {funcs.map((f: string, fi: number) => {
                                        const fci = funcColors[f.toLowerCase()] || funcColors.unknown;
                                        return (
                                          <span key={fi} className="text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize" style={{ background: fci.bg, color: fci.color }}>{f}</span>
                                        );
                                      })}
                                    </div>
                                  ) : <span style={{ color: "var(--text3)" }}>—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Table 2: Replacement Skills */}
                  {rawReplacements.length > 0 && (
                    <div className="bg-white rounded-[10px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                      <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#F0FDF4" }}>
                        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#065F46" }}>Replacement Skills</p>
                        <p className="text-[11px]" style={{ color: "#047857" }}>What to reinforce to replace maladaptive behaviors</p>
                      </div>
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                            {["Replacement Skill", "Function Addressed"].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rawReplacements.map((s: any, i: number) => {
                            const name = typeof s === "string" ? s : s?.name || "";
                            const tf = typeof s === "object" ? (s.targetFunction || "") : "";
                            const fc = funcColors[tf.toLowerCase()] || funcColors.unknown;
                            return (
                              <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                                <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{name}</td>
                                <td className="px-4 py-3">
                                  {tf ? (
                                    <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold capitalize" style={{ background: fc.bg, color: fc.color }}>{tf}</span>
                                  ) : <span style={{ color: "var(--text3)" }}>—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Function Map */}
                  {Object.keys(functionGroups).length > 0 && (
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-4" style={{ color: "var(--text3)" }}>Function Map</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {Object.entries(functionGroups).map(([func, data]) => {
                          const fc = funcColors[func] || funcColors.unknown;
                          return (
                            <div key={func} className="rounded-xl p-4 border" style={{ background: fc.bg, borderColor: fc.border }}>
                              <p className="text-[12px] font-bold uppercase tracking-wide mb-3 capitalize" style={{ color: fc.color }}>{func}</p>
                              {data.behaviors.length > 0 && (
                                <div className="mb-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: fc.color }}>Behaviors</p>
                                  {data.behaviors.map((b, i) => (
                                    <p key={i} className="text-[12px]" style={{ color: "var(--text1)" }}>• {b}</p>
                                  ))}
                                </div>
                              )}
                              {data.replacements.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 mt-2" style={{ color: fc.color }}>Replacement Skills</p>
                                  {data.replacements.map((r, i) => (
                                    <p key={i} className="text-[12px]" style={{ color: "var(--text1)" }}>✓ {r}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Disclaimer */}
                  <p className="text-[11px] text-center" style={{ color: "var(--text3)" }}>
                    Treatment Map is generated from the client's uploaded assessment. All clinical relationships should be reviewed and approved by the supervising BCBA.
                  </p>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Generate Note Tab ── */}
        {activeTab === "generate" && (
          <div className="space-y-5 max-w-[780px]">

            {/* Live compliance calendar — replace prompt. Fires on date pick (never at generation). */}
            {dateConflict && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
                <div className="bg-white rounded-2xl border shadow-xl w-full max-w-[520px] p-6" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>You already have a note for this day</p>
                  <p className="mt-1 text-[13px]" style={{ color: "var(--text3)" }}>
                    A note already exists for {dateConflict.date}. View it, replace it, or cancel and pick a different date.
                  </p>
                  {dateConflict.noteText != null && (
                    <div className="mt-3 rounded-xl border p-3 text-[13px] leading-6 max-h-64 overflow-y-auto whitespace-pre-wrap" style={{ borderColor: "var(--border)", background: "#F8FAFC", color: "var(--text1)" }}>
                      {dateConflict.noteText}
                    </div>
                  )}
                  <div className="mt-5 flex justify-end gap-2">
                    {dateConflict.noteText == null && (
                      <button onClick={viewDateConflict} disabled={dateConflict.loadingView}
                        className="px-3 py-1.5 rounded-lg text-[13px] font-medium border disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                        {dateConflict.loadingView ? "Loading…" : "View"}
                      </button>
                    )}
                    <button onClick={cancelDateConflict}
                      className="px-3 py-1.5 rounded-lg text-[13px] font-medium border" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                      Cancel
                    </button>
                    <button onClick={replaceDateConflict}
                      className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: "#D97706" }}>
                      Replace
                    </button>
                  </div>
                </div>
              </div>
            )}


            {/* Form header */}
            <div className="bg-white rounded-[10px] border p-6 flex items-start justify-between" style={{ borderColor: "var(--border)" }}>
              <div>
                <h2 className="text-[17px] font-semibold mb-1" style={{ color: "var(--text1)" }}>New Session Note</h2>
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>Fill in session details to generate a clinical note.</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: canGenerate ? "#E6F9F5" : "var(--bg)", color: canGenerate ? "#0D8A6A" : "var(--text3)" }}
                >
                  {selectedBehaviors.length} behavior{selectedBehaviors.length !== 1 ? 's' : ''} · {selectedSkills.length} skill{selectedSkills.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Section 1: Session Overview */}
            <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
              <SectionHeader title="Session Overview" />

              <div className="mb-4">
                <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text3)" }}>DATE</label>
                <input
                  type="date" value={date} onChange={(e) => handleDatePick(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text3)" }}>LOCATION</label>
                  <div className="flex gap-2 flex-wrap">
                    {LOCATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setLocation(opt.value)}
                        className="flex-1 py-2.5 rounded-lg border text-[13px] font-medium transition-colors"
                        style={{
                          background: location === opt.value ? "var(--teal)" : "white",
                          borderColor: location === opt.value ? "var(--teal)" : "var(--border)",
                          color: location === opt.value ? "white" : "var(--text2)",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {location === "other" && (
                    <div className="mt-2">
                      {savedLocations.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-2">
                          {savedLocations.map((loc) => {
                            const active = otherLocation.trim().toLowerCase() === loc.toLowerCase();
                            return (
                              <button
                                key={loc}
                                type="button"
                                onClick={() => setOtherLocation(loc)}
                                className="px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors"
                                style={{
                                  background: active ? "var(--teal)" : "white",
                                  borderColor: active ? "var(--teal)" : "var(--border)",
                                  color: active ? "white" : "var(--text2)",
                                }}
                              >
                                {loc}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="e.g. community, after-school program..."
                          value={otherLocation}
                          onChange={e => setOtherLocation(e.target.value)}
                          className="flex-1 border rounded-lg px-3 py-2 text-[13px]"
                          style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                        />
                        <button
                          type="button"
                          onClick={handleSaveLocation}
                          disabled={!otherLocation.trim()}
                          className="px-3 py-2 rounded-lg border text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text3)" }}>WHO WAS PRESENT</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {FIXED_PRESENT.map((name) => (
                      <Pill key={name} label={name} selected={selectedPresent.includes(name)} onClick={() => togglePresent(name)} />
                    ))}
                    {savedPresent.map((name) => (
                      <div key={name} className="relative inline-flex items-center">
                        <Pill label={name} selected={selectedPresent.includes(name)} onClick={() => togglePresent(name)} />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSavedPresent(prev => prev.filter(n => n !== name));
                            setSelectedPresent(prev => prev.filter(n => n !== name));
                          }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-400 hover:bg-red-500 text-white flex items-center justify-center text-[10px] leading-none"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={handleOtherClick}
                      className="px-4 py-2 rounded-full border text-sm font-medium hover:border-gray-400 transition-colors"
                      style={{ borderColor: "var(--border2)", color: "var(--text2)" }}
                    >
                      Other
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      ref={customPresentRef}
                      type="text" value={customPresent}
                      onChange={(e) => setCustomPresent(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSavePresent()}
                      placeholder="Add name..."
                      className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <button
                      onClick={handleSavePresent}
                      disabled={!customPresent.trim()}
                      className="px-3 py-2 rounded-lg text-[13px] font-medium text-white disabled:opacity-40"
                      style={{ background: "var(--teal)" }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Session Conditions */}
            <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
              <SectionHeader title="Session Conditions" />
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>Environmental Changes</p>
                    <p className="text-[11px]" style={{ color: "var(--text3)" }}>Any changes to the session environment today?</p>
                  </div>
                  <Toggle checked={environmentalChange} onChange={setEnvironmentalChange} />
                </div>
                {environmentalChange && (
                  <textarea
                    value={environmentalChangeDesc}
                    onChange={(e) => setEnvironmentalChangeDesc(e.target.value)}
                    placeholder="Describe the environmental change..."
                    className="w-full border rounded-xl px-4 py-3 text-sm h-20 resize-none focus:outline-none"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                )}
                <div className="flex items-center justify-between py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>Medication Changes</p>
                    <p className="text-[11px]" style={{ color: "var(--text3)" }}>Was medication consumed or changed today?</p>
                  </div>
                  <Toggle checked={medicationConsumed} onChange={setMedicationConsumed} />
                </div>

                {/* Compliance */}
                <div className="py-3">
                  <p className="text-[13px] font-medium mb-2" style={{ color: "var(--text1)" }}>Client Compliance Today</p>
                  {outOfOrdinary && complianceLevel === "" && (
                    <p className="text-[11px] mb-2" style={{ color: "#B45309" }}>
                      Something out of the ordinary was reported — please indicate the session&apos;s compliance level (below typical or poor).
                    </p>
                  )}
                  <div className="flex gap-2">
                    {(["typical", "below_typical", "poor"] as const).map((level) => {
                      const labels = { typical: "Typical", below_typical: "Below typical", poor: "Poor" };
                      const isSelected = complianceLevel === level;
                      // When something out of the ordinary was reported, "typical" is unavailable.
                      const disabled = outOfOrdinary && level === "typical";
                      return (
                        <button
                          key={level} type="button"
                          disabled={disabled}
                          title={disabled ? "Something out of the ordinary was reported — choose below typical or poor" : undefined}
                          onClick={() => { if (disabled) return; setComplianceChoice(level); setComplianceTouched(true); }}
                          className="flex-1 py-2 rounded-xl border text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            background: isSelected ? (level === "typical" ? "var(--teal)" : level === "below_typical" ? "#F59E0B" : "#DC2626") : "white",
                            borderColor: isSelected ? (level === "typical" ? "var(--teal)" : level === "below_typical" ? "#F59E0B" : "#DC2626") : "var(--border)",
                            color: isSelected ? "white" : "var(--text2)",
                          }}
                        >
                          {labels[level]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Behaviors */}
            <div className="bg-white rounded-[10px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
                <SectionHeader title="Maladaptive Behaviors" />
                <span
                  className="text-[12px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 -mt-5"
                  style={{ background: selectedBehaviors.length > 0 ? "var(--teal-light)" : "var(--bg)", color: selectedBehaviors.length > 0 ? "var(--teal)" : "var(--text3)" }}
                >
                  {selectedBehaviors.length} selected
                </span>
              </div>
              {bcbaOverlapContext && !bcbaOverlapContext.empty && (
                <div className="mx-6 mb-3 px-4 py-3 rounded-xl text-[12px]" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF" }}>
                  <p className="font-semibold mb-1">🔷 BCBA observed this session</p>
                  {bcbaOverlapContext.behaviors && bcbaOverlapContext.behaviors.length > 0 && (
                    <p>Behaviors observed: <span className="font-medium">{bcbaOverlapContext.behaviors.join(", ")}</span></p>
                  )}
                  {bcbaOverlapContext.skills && bcbaOverlapContext.skills.length > 0 && (
                    <p>Skills observed: <span className="font-medium">{bcbaOverlapContext.skills.join(", ")}</span></p>
                  )}
                  {bcbaOverlapContext.interventions && bcbaOverlapContext.interventions.length > 0 && (
                    <p>Interventions used: <span className="font-medium">{bcbaOverlapContext.interventions.join(", ")}</span></p>
                  )}
                </div>
              )}
              {behaviors.length === 0 ? (
                <p className="px-6 py-4 text-[13px]" style={{ color: "var(--text3)" }}>No maladaptive behaviors in this profile.</p>
              ) : (
                <div>
                  {behaviors.map((b, i) => {
                    const name = getName(b);
                    const functions: string[] = typeof b === 'object' ? (b.functions || b.function || []) : [];
                    const funcLabel = functions.length > 0 ? functions.join(', ') : null;
                    const observedByBcba = bcbaOverlapContext?.behaviors?.includes(name);
                    // Incomplete (no operational definition and/or function) → shown but NOT selectable; the
                    // generator can't write its ABC. keepActiveBehaviorNames enforces the same rule server-side.
                    const missing = behaviorMissingFields(b);
                    const incomplete = missing.length > 0;
                    return (
                      <CheckboxRow
                        key={i}
                        name={name}
                        description={incomplete ? incompleteBehaviorReason(missing) : observedByBcba ? `🔷 Observed by BCBA · Function: ${funcLabel || 'unknown'}` : funcLabel ? `Function: ${funcLabel}` : (typeof b === "object" ? b.topography : undefined)}
                        checked={selectedBehaviors.includes(name)}
                        disabled={incomplete}
                        onToggle={() => toggleBehavior(name)}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 4: Skills */}
            <div className="bg-white rounded-[10px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
                <SectionHeader title="Replacement Skills" />
                <span
                  className="text-[12px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 -mt-5"
                  style={{ background: selectedSkills.length > 0 ? "var(--teal-light)" : "var(--bg)", color: selectedSkills.length > 0 ? "var(--teal)" : "var(--text3)" }}
                >
                  {selectedSkills.length} selected
                </span>
              </div>
              {skills.length === 0 ? (
                <p className="px-6 py-4 text-[13px]" style={{ color: "var(--text3)" }}>No replacement skills in this profile.</p>
              ) : (
                <div>
                  {(() => {
                    // Functions of selected behaviors — used ONLY to BADGE functionally-equivalent skills (a
                    // non-demoting FCT hint). We deliberately do NOT reorder or demote by function match:
                    // replacement programs are taught proactively, so a skill whose function doesn't match a
                    // selected behavior — including general programs with no single function (empty
                    // targetFunction) — must stay equally visible and in its natural order.
                    const selectedFunctions = selectedBehaviors.flatMap(bName => {
                      const b = behaviors.find((bx: any) => getName(bx) === bName);
                      return (typeof b === 'object' && b?.functions) ? b.functions : [];
                    });

                    return skills.map((s: any, i: number) => {
                      const name = getName(s);
                      const func = typeof s === 'object' ? (s.targetFunction || '') : '';
                      const isMatch = selectedFunctions.length > 0 && selectedFunctions.includes(func);
                      return (
                        <CheckboxRow
                          key={i}
                          name={name}
                          description={isMatch ? `✦ Functionally equivalent` : undefined}
                          checked={selectedSkills.includes(name)}
                          disabled={false}
                          onToggle={() => toggleSkill(name)}
                        />
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            {/* Generate button + output */}
            <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
              <div className="mt-4 mb-4">
                <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--text3)" }}>
                  Next Appointment Date
                </p>
                <input
                  type="date"
                  value={nextApptDate}
                  onChange={e => setNextApptDate(e.target.value)}
                  className="w-full border rounded-xl px-4 py-2 text-[13px]"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                />
              </div>
              <button
                onClick={handleGenerateNote}
                disabled={!canGenerate || generating}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                style={{ background: "var(--teal)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
                </svg>
                {generating ? "Generating..." : "Generate Note"}
              </button>
              {!canGenerate && !generating && (
                <p className="mt-3 text-[13px]" style={{ color: "var(--text3)" }}>
                  {outOfOrdinary && complianceLevel === ""
                    ? "Something out of the ordinary was reported — please indicate the session's compliance level (below typical or poor)."
                    : "Complete all fields: date, location, someone present, at least one behavior, and at least one skill."}
                </p>
              )}
              {status && <p className="mt-2 text-[13px] text-red-500">{status}</p>}
              {/* Before the first token: a calm indicator (never red). Once tokens arrive the note streams live. */}
              {generating && !generatedNote && (
                <div className="mt-4 flex items-center gap-3 rounded-xl px-4 py-3 border" style={{ background: "#F0FDFA", borderColor: "#99F6E4", color: "#0F766E" }}>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                  </svg>
                  <span className="text-[13px] font-medium">Generating your note…</span>
                </div>
              )}
              {similarityWarning && (
                <p className="mt-3 text-[13px] rounded-xl px-4 py-3 border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                  ⚠️ This note may be similar to a previous session. Consider editing before submitting.
                </p>
              )}
              {/* Option (a): the note streams in LIVE. On the coverage retry it FREEZES and dims with a calm
                  overlay (never a wipe/restart), then swaps to the finished text. */}
              {generatedNote && (
                <div style={{ position: "relative" }}>
                  <div style={{ opacity: finalizing ? 0.45 : 1, transition: "opacity .2s", pointerEvents: finalizing ? "none" : "auto" }}>
                    <NoteOutput
                      note={generatedNote}
                      onChange={handleNoteEdit}
                      onCopy={() => navigator.clipboard.writeText(generatedNote)}
                      onStartNew={handleStartNewNote}
                      onBlur={handleNoteBlur}
                      saveState={saveState}
                      onRetry={() => { void queueSave(generatedNote, { withMetadata: true }); }}
                      generating={generating}
                    />
                  </div>
                  {finalizing && (
                    <div role="status" aria-live="polite" className="absolute left-1/2 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold"
                      style={{ top: 12, transform: "translateX(-50%)", background: "#F0FDFA", borderColor: "#99F6E4", color: "#0F766E" }}>
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                      </svg>
                      Finalizing your note…
                    </div>
                  )}
                </div>
              )}
              {sessionSummary && (
                <div className="mt-4 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>Session Summary — Ready to Copy</p>
                  {[
                    { label: "Maladaptive Behaviors", items: sessionSummary.behaviors, color: "#DC2626", bg: "#FEF2F2" },
                    { label: "Replacement Skills", items: sessionSummary.skills, color: "#0D9488", bg: "#F0FDF4" },
                    { label: "Interventions Used", items: sessionSummary.interventions, color: "#2563EB", bg: "#EFF6FF" },
                  ].map(section => (
                    <div key={section.label} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: section.bg }}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: section.color }}>{section.label}</p>
                        <CopySection items={section.items} color={section.color} />
                      </div>
                      {section.items.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {section.items.map((item, i) => (
                            <span key={i} className="text-[12px] px-2.5 py-1 rounded-full font-medium" style={{ background: "white", color: section.color, border: `1px solid ${section.color}20` }}>
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px]" style={{ color: "var(--text3)" }}>None detected</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Notes Tab ── */}
        {activeTab === "notes" && (
          <div className="max-w-[780px]">
            <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
              <SectionHeader title="Note History" />
              {dailyNotes.length === 0 ? (
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>No notes saved yet.</p>
              ) : (
                <div className="space-y-4">
                  {dailyNotes.map((note) => (
                    <div key={note.id} className="rounded-xl p-4" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{note.date}</span>
                        <button
                          onClick={() => handleDeleteNote(note.id, note.fromSupabase)}
                          className="text-[12px] font-medium text-red-400 hover:text-red-600 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-7" style={{ color: "var(--text2)" }}>{note.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Data Tab ── */}
        {activeTab === "data" && <DataTab client={client} complianceLevel={complianceLevel || "typical"} />}

      </div>

      {/* ── Share with BCBA modal ── */}
      {showShareModal && shareCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
            <h2 className="text-[18px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Share this client with your BCBA</h2>
            <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>
              Give this code to your BCBA. It expires in 7 days.
            </p>
            <div
              className="flex items-center justify-between px-4 py-3 rounded-xl mb-4 font-mono text-[20px] font-bold tracking-widest"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text1)" }}
            >
              {shareCode}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareCode);
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 2000);
                }}
                className="ml-3 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors"
                style={{ background: codeCopied ? "#16A34A" : "var(--teal)", color: "white", fontFamily: "var(--font-dm-sans, sans-serif)" }}
              >
                {codeCopied ? "Copied!" : "Copy"}
              </button>
            </div>
            <button
              onClick={() => { setShowShareModal(false); setCodeCopied(false); }}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium border"
              style={{ borderColor: "var(--border)", color: "var(--text2)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Update Assessment modal ── */}
      {showUpdateAssessment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Update Assessment</p>
              <button onClick={() => setShowUpdateAssessment(false)} className="text-[20px] leading-none" style={{ color: "var(--text3)" }}>×</button>
            </div>

            {updateAssessSuccess ? (
              <>
                <p className="text-[13px] mb-4" style={{ color: "#16A34A" }}>
                  ✓ Assessment updated. New behaviors added, mastered behaviors removed.
                </p>
                <button
                  onClick={() => setShowUpdateAssessment(false)}
                  className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white"
                  style={{ background: "var(--teal)" }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] mb-4" style={{ color: "var(--text3)" }}>
                  Upload a new ABA assessment PDF to update this client's clinical profile. New behaviors will be added; mastered behaviors will be removed.
                </p>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                  Assessment PDF <span style={{ color: "#DC2626" }}>*</span>
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={e => { setUpdateAssessFile(e.target.files?.[0] || null); setUpdateAssessError(""); }}
                  className="w-full text-[13px] mb-3"
                  style={{ color: "var(--text1)" }}
                />
                {updateAssessFile && (
                  <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>{updateAssessFile.name}</p>
                )}
                {updateAssessError && (
                  <p className="text-[12px] mb-3 px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                    {updateAssessError}
                  </p>
                )}
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={handleUpdateAssessment}
                    disabled={!updateAssessFile || updateAssessing}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "var(--teal)" }}
                  >
                    {updateAssessing ? "Updating…" : "Upload & Update"}
                  </button>
                  <button
                    onClick={() => setShowUpdateAssessment(false)}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border"
                    style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
