"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getClientProfiles } from "@/lib/clientStorage";
import { supabase } from "@/lib/supabase";
import { saveNote, getNotesByClientId, deleteNote } from "@/lib/noteStorage";

const LOCATION_OPTIONS = [
  { label: "Home", value: "home" },
  { label: "School", value: "school" },
  { label: "Clinic", value: "clinic" },
];

const FIXED_PRESENT = ["Caregiver", "Teacher"];

type Tab = "overview" | "generate" | "refine" | "notes";

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
  onSave,
  saved,
}: {
  note: string;
  onChange: (v: string) => void;
  onCopy: () => void;
  onSave?: () => void;
  saved?: boolean;
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
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors"
            style={{ borderColor: copied ? "#16A34A" : "var(--border)", color: copied ? "#16A34A" : "var(--text2)" }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
          {onSave && (
            <button
              onClick={onSave}
              className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: saved ? "#16A34A" : "var(--teal)" }}
            >
              {saved ? "Saved ✓" : "Save Note"}
            </button>
          )}
        </div>
      </div>
      <textarea
        value={note}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border p-4 rounded-xl text-sm leading-7 h-64 resize-none focus:outline-none focus:ring-2"
        style={{ borderColor: "var(--border)", color: "var(--text1)" }}
      />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ClientProfilePage() {
  const params = useParams();

  const [client, setClient] = useState<any>(null);
  const [dailyNotes, setDailyNotes] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Generate Note state
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [selectedPresent, setSelectedPresent] = useState<string[]>([]);
  const [savedPresent, setSavedPresent] = useState<string[]>([]);
  const [customPresent, setCustomPresent] = useState("");
  const customPresentRef = useRef<HTMLInputElement>(null);
  const [environmentalChange, setEnvironmentalChange] = useState(false);
  const [environmentalChangeDesc, setEnvironmentalChangeDesc] = useState("");
  const [medicationConsumed, setMedicationConsumed] = useState(false);
  const [complianceLevel, setComplianceLevel] = useState<"typical" | "below_typical" | "poor">("typical");
  const [missedHoursToggle, setMissedHoursToggle] = useState(false);
  const [missedHoursCount, setMissedHoursCount] = useState("");
  const [missedHoursReason, setMissedHoursReason] = useState("");
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [generatedNote, setGeneratedNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);

  // Share with BCBA state
  const [shareCode, setShareCode] = useState("");
  const [generatingCode, setGeneratingCode] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareError, setShareError] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  // BCBA supervision suggestion banner
  const [bcbaSuggestion, setBcbaSuggestion] = useState<{ notePreview: string; isTruncated: boolean; supervisionTypeLabel: string } | null>(null);

  // Refine Note state
  const [pastedNote, setPastedNote] = useState("");
  const [perfectingNote, setPerfectingNote] = useState(false);
  const [perfectStatus, setPerfectStatus] = useState("");
  const [perfectedNote, setPerfectedNote] = useState("");
  const [perfectSimilarityWarning, setPerfectSimilarityWarning] = useState(false);
  const [refinedNoteSaved, setRefinedNoteSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const id = params.id as string;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("clients")
          .select("id, internal_code, clinical_profile")
          .eq("id", id)
          .eq("rbt_id", user.id)
          .maybeSingle();
        if (data) {
          const found = { id: data.id, clientName: data.clinical_profile?.name || data.internal_code, clinicalProfile: data.clinical_profile };
          setClient(found);
          setDailyNotes(getNotesByClientId(found.id));
          if (data.clinical_profile?.whoWasPresent?.length) {
            setSavedPresent(data.clinical_profile.whoWasPresent);
          } else {
            const raw = localStorage.getItem(`path4aba_saved_present_${found.id}`);
            if (raw) { try { setSavedPresent(JSON.parse(raw)); } catch {} }
          }
          return;
        }
      }
      const clients = getClientProfiles();
      const foundClient = clients.find((c: any) => c.id === id);
      if (foundClient) {
        setClient(foundClient);
        setDailyNotes(getNotesByClientId(foundClient.id));
        const raw = localStorage.getItem(`path4aba_saved_present_${foundClient.id}`);
        if (raw) { try { setSavedPresent(JSON.parse(raw)); } catch {} }
      }
    }
    load();
  }, [params.id]);

  if (!client) {
    return (
      <main className="min-h-screen p-10" style={{ background: "var(--bg)" }}>
        <p className="text-lg font-medium" style={{ color: "var(--text3)" }}>Client not found.</p>
      </main>
    );
  }

  const behaviors: any[] = client.clinicalProfile?.maladaptiveBehaviors || [];
  const skills: any[] = [
    ...(client.clinicalProfile?.replacementBehaviors || []),
    ...(client.clinicalProfile?.skillAcquisition || []),
  ];

  function getName(item: any): string {
    return typeof item === "string" ? item : item?.name || "";
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
    supabase.from("clients")
      .update({ clinical_profile: { ...client.clinicalProfile, whoWasPresent: updated } })
      .eq("id", client.id);
    if (!selectedPresent.includes(name)) setSelectedPresent((prev) => [...prev, name]);
    setCustomPresent("");
  }

  function toggleBehavior(name: string) {
    setSelectedBehaviors((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 5) return prev;
      return [...prev, name];
    });
  }

  function toggleSkill(name: string) {
    setSelectedSkills((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 2) return prev;
      return [...prev, name];
    });
  }

  const canGenerate =
    date.trim() !== "" && location !== "" && selectedPresent.length > 0 &&
    selectedBehaviors.length === 5 && selectedSkills.length === 2;

  async function handleGenerateNote() {
    if (!canGenerate) return;
    setGenerating(true);
    setStatus("Generating note...");
    setGeneratedNote("");

    const body = {
      clientId: client.id,
      sessionInfo: { date, location, caregiver: presentPerson },
      behaviorsObserved: selectedBehaviors.map((name) => ({ name, topography: "", frequency: 1, antecedentContext: "", function: "" })),
      replacementSkillsAddressed: selectedSkills.map((name) => ({ name, promptLevel: "", clientResponse: "", successful: true })),
      activitiesUsed: [],
      reinforcersUsed: [],
      clientProfile: {
        diagnosis: client.diagnosis || [],
        setting: location,
        approvedInterventions: client.clinicalProfile?.interventions?.map((i: any) => typeof i === "string" ? i : i.name) || [],
        prohibitedInterventions: ["Punishment", "ResponseCost", "Restraint", "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive"],
        reinforcers: {
          tangibles: client.clinicalProfile?.reinforcers?.slice(0, 5).join(", ") || "",
          activities: client.clinicalProfile?.homeActivities?.slice(0, 3).join(", ") || "",
          social: "verbal praise, high fives, behavior-specific praise",
          people: presentPerson,
        },
        activePrograms: {
          maladaptive: client.clinicalProfile?.maladaptiveBehaviors?.map((b: any) => typeof b === "string" ? b : b.name) || [],
          replacementSkills: [
            ...(client.clinicalProfile?.replacementBehaviors?.map((b: any) => typeof b === "string" ? b : b.name) || []),
            ...(client.clinicalProfile?.skillAcquisition?.map((s: any) => typeof s === "string" ? s : s.name) || []),
          ],
        },
      },
      clinicalEvents: medicationConsumed ? "Medication consumed today." : "",
      complianceLevel: complianceLevel !== "typical" ? complianceLevel : undefined,
      environmentalChangeDescription: environmentalChange && environmentalChangeDesc ? environmentalChangeDesc : undefined,
      missedHoursData: missedHoursToggle && missedHoursCount
        ? { totalHours: parseFloat(missedHoursCount), reason: missedHoursReason }
        : undefined,
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
      let fullText = "";
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__META__")) {
          const parts = chunk.split("__META__");
          if (parts[0]) { fullText += parts[0]; setGeneratedNote(fullText); }
          try { const meta = JSON.parse(parts[1]); if (meta.error) { setStatus(meta.error); return; } setSimilarityWarning(!!meta.similarityWarning); } catch {}
          break outer;
        }
        if (chunk.includes("__REGEN__")) {
          fullText = "";
          setGeneratedNote("");
          setStatus("Regenerating for uniqueness…");
          continue;
        }
        fullText += chunk;
        setGeneratedNote(fullText);
      }
      setStatus("");
      if (fullText.trim()) {
        const backupNote = { id: crypto.randomUUID(), clientId: client.id, date: date || new Date().toLocaleDateString(), note: fullText };
        saveNote(backupNote);
        setDailyNotes(prev => [backupNote, ...prev]);
      }
    } catch {
      setStatus("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function handleSaveNote() {
    if (!generatedNote.trim()) { alert("Generate a note before saving."); return; }
    const noteObject = { id: crypto.randomUUID(), clientId: client.id, date: date || new Date().toLocaleDateString(), note: generatedNote };
    saveNote(noteObject);
    setDailyNotes((prev) => [noteObject, ...prev]);
    alert("Note saved successfully.");
  }

  async function handlePerfectNote() {
    if (!pastedNote.trim()) return;
    setPerfectingNote(true);
    setPerfectStatus("Perfecting your note...");
    setPerfectedNote("");

    const body = {
      originalNote: pastedNote,
      clientId: client.id,
      clientProfile: {
        approvedInterventions: client.clinicalProfile?.interventions?.map((i: any) => typeof i === "string" ? i : i.name) || [],
        prohibitedInterventions: ["Punishment", "ResponseCost", "Restraint", "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive"],
        reinforcers: {
          tangibles: client.clinicalProfile?.reinforcers?.slice(0, 5).join(", ") || "",
          social: "verbal praise, behavior-specific praise, high fives",
        },
      },
    };

    try {
      const res = await fetch("/api/refine-note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setPerfectStatus(data?.error || "Note perfection failed.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      setPerfectSimilarityWarning(false);
      outer2: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__META__")) {
          const parts = chunk.split("__META__");
          if (parts[0]) { fullText += parts[0]; setPerfectedNote(fullText); }
          try { const meta = JSON.parse(parts[1]); if (meta.error) { setPerfectStatus(meta.error); return; } setPerfectSimilarityWarning(!!meta.similarityWarning); } catch {}
          break outer2;
        }
        if (chunk.includes("__REGEN__")) {
          fullText = "";
          setPerfectedNote("");
          setPerfectStatus("Regenerating for uniqueness…");
          continue;
        }
        fullText += chunk;
        setPerfectedNote(fullText);
      }
      setPerfectStatus("");
    } catch {
      setPerfectStatus("Network error. Please try again.");
    } finally {
      setPerfectingNote(false);
    }
  }

  async function handleSaveRefinedNote() {
    if (!perfectedNote.trim()) return;
    const today = new Date();
    const noteObject = {
      id: crypto.randomUUID(),
      clientId: client.id,
      date: today.toLocaleDateString(),
      note: perfectedNote,
    };
    saveNote(noteObject);
    setDailyNotes(prev => [noteObject, ...prev]);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("session_notes").insert({
        client_id: client.id,
        user_id: user.id,
        note_text: perfectedNote,
        session_date: today.toISOString().split("T")[0],
      });
    }
    setRefinedNoteSaved(true);
    setTimeout(() => setRefinedNoteSaved(false), 2000);
  }

  function handleDeleteNote(noteId: string) {
    if (!window.confirm("Are you sure you want to delete this note?")) return;
    deleteNote(noteId);
    setDailyNotes((prev) => prev.filter((note) => note.id !== noteId));
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

  async function checkBCBASuggestion() {
    try {
      const res = await fetch(`/api/rbt/bcba-daily-summary?clientId=${client.id}`);
      if (!res.ok) return;
      const { summary } = await res.json();
      if (summary) setBcbaSuggestion(summary);
    } catch {}
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    if (tab === "generate") checkBCBASuggestion();
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "generate", label: "Generate Note" },
    { key: "refine", label: "Refine Note" },
    { key: "notes", label: "Notes" },
  ];

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
            </div>
            {shareError && <p className="text-[12px] text-red-500 mt-1">{shareError}</p>}
          </div>

          {/* Meta fields */}
          <div className="grid grid-cols-3 gap-6" style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
            {[
              { label: "Behaviors", value: (client.clinicalProfile?.maladaptiveBehaviors?.length || 0) + " tracked" },
              { label: "Interventions", value: (client.clinicalProfile?.interventions?.length || 0) + " approved" },
              { label: "Skills", value: ((client.clinicalProfile?.skillAcquisition?.length || 0) + (client.clinicalProfile?.replacementBehaviors?.length || 0)) + " programs" },
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
                  {[
                    { label: "Maladaptive Behaviors", value: client.clinicalProfile?.maladaptiveBehaviors?.length || 0 },
                    { label: "Approved Interventions", value: client.clinicalProfile?.interventions?.length || 0 },
                    { label: "Replacement Behaviors", value: client.clinicalProfile?.replacementBehaviors?.length || 0 },
                    { label: "Skill Programs", value: client.clinicalProfile?.skillAcquisition?.length || 0 },
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
                <SectionHeader title="Active Interventions" />
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
                <SectionHeader title="Maladaptive Behaviors" />
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
                <div className="flex flex-wrap gap-2">
                  {[
                    ...(client.clinicalProfile?.replacementBehaviors || []),
                    ...(client.clinicalProfile?.skillAcquisition || []),
                  ].map((s: any, idx: number) => (
                    <span
                      key={idx}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full"
                      style={{ background: "var(--teal-light)", color: "var(--teal)" }}
                    >
                      {typeof s === "string" ? s : s.name}
                    </span>
                  ))}
                  {!skills.length && (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>No skills recorded.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
          </div>
        )}

        {/* ── Generate Note Tab ── */}
        {activeTab === "generate" && (
          <div className="space-y-5 max-w-[780px]">

            {/* BCBA supervision suggestion banner */}
            {bcbaSuggestion && (
              <div className="px-4 py-4 rounded-xl border" style={{ background: "rgba(27,168,160,0.05)", borderColor: "rgba(27,168,160,0.2)", borderLeftWidth: "3px", borderLeftColor: "var(--teal)" }}>
                <p className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--teal)" }}>
                  BCBA Supervision Today — {bcbaSuggestion.supervisionTypeLabel}
                </p>
                <p className="text-[12px] leading-relaxed mb-1.5" style={{ color: "var(--text2)" }}>
                  {bcbaSuggestion.notePreview}{bcbaSuggestion.isTruncated ? "…" : ""}
                </p>
                <p className="text-[11px]" style={{ color: "var(--text3)" }}>Based on today's BCBA supervision note</p>
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
                  style={{ background: selectedBehaviors.length === 5 && selectedSkills.length === 2 ? "#E6F9F5" : "var(--bg)", color: selectedBehaviors.length === 5 && selectedSkills.length === 2 ? "#0D8A6A" : "var(--text3)" }}
                >
                  {selectedBehaviors.length}/5 behaviors · {selectedSkills.length}/2 skills
                </span>
              </div>
            </div>

            {/* Section 1: Session Overview */}
            <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
              <SectionHeader title="Session Overview" />

              <div className="mb-4">
                <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text3)" }}>DATE</label>
                <input
                  type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text3)" }}>LOCATION</label>
                  <div className="flex gap-2">
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
                </div>

                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text3)" }}>WHO WAS PRESENT</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {[...FIXED_PRESENT, ...savedPresent].map((name) => (
                      <Pill key={name} label={name} selected={selectedPresent.includes(name)} onClick={() => togglePresent(name)} />
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

                {/* Missed hours */}
                <div className="flex items-center justify-between py-3" style={{ borderBottom: missedHoursToggle ? "none" : "1px solid var(--border)" }}>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>Missed Sessions This Week</p>
                    <p className="text-[11px]" style={{ color: "var(--text3)" }}>Did this client miss any scheduled hours in the last 7 days?</p>
                  </div>
                  <Toggle checked={missedHoursToggle} onChange={setMissedHoursToggle} />
                </div>
                {missedHoursToggle && (
                  <div className="pb-3 space-y-2" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number" min="0.5" max="40" step="0.5"
                        value={missedHoursCount}
                        onChange={(e) => setMissedHoursCount(e.target.value)}
                        placeholder="Hours missed"
                        className="w-32 border rounded-xl px-3 py-2 text-sm focus:outline-none"
                        style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                      />
                      <span className="text-[13px]" style={{ color: "var(--text3)" }}>hours missed</span>
                    </div>
                    <input
                      type="text"
                      value={missedHoursReason}
                      onChange={(e) => setMissedHoursReason(e.target.value)}
                      placeholder="Reason (e.g. illness, family travel)"
                      className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                  </div>
                )}

                {/* Compliance */}
                <div className="py-3">
                  <p className="text-[13px] font-medium mb-2" style={{ color: "var(--text1)" }}>Client Compliance Today</p>
                  <div className="flex gap-2">
                    {(["typical", "below_typical", "poor"] as const).map((level) => {
                      const labels = { typical: "Typical", below_typical: "Below typical", poor: "Poor" };
                      const isSelected = complianceLevel === level;
                      return (
                        <button
                          key={level} type="button"
                          onClick={() => setComplianceLevel(level)}
                          className="flex-1 py-2 rounded-xl border text-[13px] font-medium transition-colors"
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
                <SectionHeader title="Maladaptive Behaviors (select up to 5)" />
                <span
                  className="text-[12px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 -mt-5"
                  style={{ background: selectedBehaviors.length === 5 ? "var(--teal-light)" : "var(--bg)", color: selectedBehaviors.length === 5 ? "var(--teal)" : "var(--text3)" }}
                >
                  {selectedBehaviors.length} of 5
                </span>
              </div>
              {behaviors.length === 0 ? (
                <p className="px-6 py-4 text-[13px]" style={{ color: "var(--text3)" }}>No maladaptive behaviors in this profile.</p>
              ) : (
                <div>
                  {behaviors.map((b, i) => {
                    const name = getName(b);
                    return (
                      <CheckboxRow
                        key={i}
                        name={name}
                        description={typeof b === "object" ? b.topography : undefined}
                        checked={selectedBehaviors.includes(name)}
                        disabled={!selectedBehaviors.includes(name) && selectedBehaviors.length >= 5}
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
                <SectionHeader title="Replacement Skills (select up to 2)" />
                <span
                  className="text-[12px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 -mt-5"
                  style={{ background: selectedSkills.length === 2 ? "var(--teal-light)" : "var(--bg)", color: selectedSkills.length === 2 ? "var(--teal)" : "var(--text3)" }}
                >
                  {selectedSkills.length} of 2
                </span>
              </div>
              {skills.length === 0 ? (
                <p className="px-6 py-4 text-[13px]" style={{ color: "var(--text3)" }}>No replacement skills in this profile.</p>
              ) : (
                <div>
                  {skills.map((s, i) => {
                    const name = getName(s);
                    return (
                      <CheckboxRow
                        key={i}
                        name={name}
                        checked={selectedSkills.includes(name)}
                        disabled={!selectedSkills.includes(name) && selectedSkills.length >= 2}
                        onToggle={() => toggleSkill(name)}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Generate button + output */}
            <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
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
                  Complete all fields: date, location, someone present, 5 behaviors, and 2 skills.
                </p>
              )}
              {status && <p className="mt-2 text-[13px] text-red-500">{status}</p>}
              {similarityWarning && (
                <p className="mt-3 text-[13px] rounded-xl px-4 py-3 border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                  ⚠️ This note may be similar to a previous session. Consider editing before submitting.
                </p>
              )}
              {generatedNote && (
                <NoteOutput
                  note={generatedNote}
                  onChange={setGeneratedNote}
                  onCopy={() => navigator.clipboard.writeText(generatedNote)}
                  onSave={handleSaveNote}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Refine Note Tab ── */}
        {activeTab === "refine" && (
          <div className="max-w-[780px]">
            <div className="bg-white rounded-[10px] border p-6" style={{ borderColor: "var(--border)" }}>
              <SectionHeader title="Refine Note" />
              <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>
                Paste a note from ABA Matrix or any other system. Path4ABA will elevate it to audit-ready quality without changing the clinical facts.
              </p>
              <textarea
                value={pastedNote}
                onChange={(e) => setPastedNote(e.target.value)}
                placeholder="Paste your note here..."
                className="w-full border rounded-xl px-4 py-3 text-sm leading-7 resize-none mb-4 focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 200 }}
              />
              <button
                onClick={handlePerfectNote}
                disabled={!pastedNote.trim() || perfectingNote}
                className="px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                style={{ background: "var(--teal)" }}
              >
                {perfectingNote ? "Refining..." : "Refine Note"}
              </button>
              {perfectStatus && <p className="mt-3 text-[13px] text-red-500">{perfectStatus}</p>}
              {perfectSimilarityWarning && (
                <p className="mt-3 text-[13px] px-3 py-2 rounded-lg border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                  ⚠️ This refined note may be similar to a previous session. Consider editing before submitting.
                </p>
              )}
              {perfectedNote && (
                <NoteOutput
                  note={perfectedNote}
                  onChange={setPerfectedNote}
                  onCopy={() => navigator.clipboard.writeText(perfectedNote)}
                  onSave={handleSaveRefinedNote}
                  saved={refinedNoteSaved}
                />
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
                          onClick={() => handleDeleteNote(note.id)}
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
    </div>
  );
}
