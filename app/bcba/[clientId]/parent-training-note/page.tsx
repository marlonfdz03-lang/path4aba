"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const CAREGIVER_RELATIONS = [
  "Mother", "Father", "Grandparent", "Foster Parent", "Legal Guardian", "Stepparent", "Sibling", "Other",
];

const PARTICIPANT_OPTIONS = ["BCBA", "Caregiver", "Client", "RBT", "Other"];

const CAREGIVER_GOALS_OPTIONS = [
  "Improve reinforcement consistency",
  "Improve prompting implementation",
  "Increase consistency during home routines",
  "Improve implementation of behavior reduction strategies",
  "Improve transition support implementation",
  "Increase use of replacement behavior strategies",
  "Improve implementation of communication strategies",
  "Improve generalization across settings",
  "Increase caregiver confidence implementing ABA procedures",
  "Improve consistency with behavior intervention plan",
  "Increase independent caregiver implementation",
  "Other",
];

const TRAINING_FOCUS_OPTIONS = [
  "Reinforcement strategies",
  "Prompting procedures",
  "Behavior reduction strategies",
  "Communication strategies",
  "Transition support strategies",
  "Replacement behavior implementation",
  "Daily living routines",
  "Functional communication training",
  "Error correction procedures",
  "Behavior intervention plan review",
  "Generalization strategies",
  "Other",
];

const BST_OPTIONS = [
  "Instruction provided",
  "Modeling completed",
  "Caregiver rehearsal completed",
  "Corrective feedback provided",
  "Live coaching provided",
  "Role-play completed",
  "Performance feedback provided",
];

const CAREGIVER_PERF_OPTIONS = [
  "Caregiver implemented procedures independently",
  "Caregiver required verbal prompting",
  "Caregiver demonstrated improved consistency",
  "Caregiver required additional coaching",
  "Caregiver demonstrated appropriate reinforcement delivery",
  "Caregiver demonstrated improved prompting consistency",
  "Generalization difficulties observed",
  "Environmental distractions impacted implementation",
  "Caregiver demonstrated increased confidence implementing procedures",
  "Additional caregiver support recommended",
  "Other",
];

const CLIENT_RESPONSE_OPTIONS = [
  "Increased appropriate communication observed",
  "Reduced maladaptive behavior observed",
  "Improved transition tolerance observed",
  "Increased engagement observed",
  "Improved compliance observed",
  "Increased independent responding observed",
  "Improved participation observed",
  "Improved generalization across caregiver interactions observed",
  "Reduced prompt dependency observed",
  "Other",
];

const NEXT_STEPS_OPTIONS = [
  "Continue caregiver coaching",
  "Continue reinforcement training",
  "Continue prompting procedure training",
  "Monitor caregiver implementation consistency",
  "Continue generalization training",
  "Continue BST during future sessions",
  "Reassess caregiver fidelity next session",
  "Continue collaboration with caregiver",
  "Review progress toward goals next session",
  "Continue home implementation support",
  "Other",
];

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <p className="text-[11px] uppercase tracking-widest font-semibold whitespace-nowrap" style={{ color: "var(--text3)" }}>
        {title}
      </p>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}

function CheckboxGroup({
  options,
  selected,
  onToggle,
  otherValue,
  onOtherChange,
}: {
  options: string[];
  selected: string[];
  onToggle: (val: string) => void;
  otherValue?: string;
  onOtherChange?: (val: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {options.map(opt => (
        <div key={opt}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={() => onToggle(opt)}
              className="mt-0.5 flex-shrink-0"
              style={{ accentColor: "var(--teal)" }}
            />
            <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
          </label>
          {opt === "Other" && selected.includes("Other") && (
            <input
              type="text"
              value={otherValue ?? ""}
              onChange={e => onOtherChange?.(e.target.value)}
              placeholder="Specify…"
              className="mt-1.5 ml-5 w-[calc(100%-1.25rem)] border rounded-lg px-3 py-1.5 text-[12px] focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Topbar({ clientName, clientId }: { clientName: string; clientId: string }) {
  return (
    <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
      <Link href="/bcba" className="hover:underline" style={{ color: "var(--text3)" }}>My Clients</Link>
      <span style={{ color: "var(--border2)" }}>/</span>
      <Link href={`/bcba/${clientId}`} className="hover:underline" style={{ color: "var(--text3)" }}>{clientName || "Client"}</Link>
      <span style={{ color: "var(--border2)" }}>/</span>
      <span className="font-medium" style={{ color: "var(--text1)" }}>Parent Training Note</span>
    </div>
  );
}

export default function ParentTrainingNotePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<any>(null);
  const [bcbaName, setBcbaName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Section 1 — Session Information
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [location, setLocation] = useState("");
  const [caregiverName, setCaregiverName] = useState("");
  const [caregiverRelation, setCaregiverRelation] = useState("Mother");

  // Section 2 — Participants Present
  const [participantsPresent, setParticipantsPresent] = useState<string[]>([]);
  const [participantsOther, setParticipantsOther] = useState("");

  // Section 3 — Was client present?
  const [clientPresent, setClientPresent] = useState<"yes" | "no" | "partial" | null>(null);

  // Section 4 — Skill Targets
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillsFreeText, setSkillsFreeText] = useState("");

  // Section 5 — Caregiver Goals
  const [caregiverGoals, setCaregiverGoals] = useState<string[]>([]);
  const [caregiverGoalsOther, setCaregiverGoalsOther] = useState("");

  // Section 6 — Training Focus
  const [trainingFocus, setTrainingFocus] = useState<string[]>([]);
  const [trainingFocusOther, setTrainingFocusOther] = useState("");

  // Section 7 — BST Components
  const [bstComponents, setBstComponents] = useState<string[]>([]);

  // Section 8 — Caregiver Performance
  const [caregiverPerf, setCaregiverPerf] = useState<string[]>([]);
  const [caregiverPerfOther, setCaregiverPerfOther] = useState("");

  // Section 9 — Client Response
  const [clientResponse, setClientResponse] = useState<string[]>([]);
  const [clientResponseOther, setClientResponseOther] = useState("");

  // Section 10 — Additional Details
  const [additionalDetails, setAdditionalDetails] = useState("");

  // Section 11 — Next Steps
  const [nextStepsSel, setNextStepsSel] = useState<string[]>([]);
  const [nextStepsOther, setNextStepsOther] = useState("");

  // Output
  const [generating, setGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
      const name = data.user.user_metadata?.full_name || data.user.email?.split("@")[0] || "";
      setBcbaName(name);
      loadData();
    });
  }, [clientId]);

  async function loadData() {
    try {
      const res = await fetch(`/api/bcba/client/${clientId}`);
      if (!res.ok) { router.push("/bcba"); return; }
      const json = await res.json();
      setClient(json.client);
    } catch (e) {
      console.error("[parent-training-note] loadData error:", e);
      setLoadError("Failed to load client data. Please go back and try again.");
    } finally {
      setLoading(false);
    }
  }

  const profile = client?.clinical_profile || {};

  const allSkills: string[] = [
    ...(profile?.replacementBehaviors || []),
    ...(profile?.skillAcquisition || []),
  ].map((s: any) => (typeof s === "string" ? s : s?.name || "")).filter(Boolean);

  function toggle(setter: React.Dispatch<React.SetStateAction<string[]>>, val: string) {
    setter(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenError("");
    setGeneratedNote("");
    setSimilarityWarning(false);

    const skillsArr = selectedSkills.length > 0
      ? selectedSkills
      : skillsFreeText.trim() ? [skillsFreeText.trim()] : [];

    const behaviorsObserved = [
      ...skillsArr,
      ...clientResponse.filter(r => r !== "Other"),
      ...(clientResponseOther.trim() ? [clientResponseOther.trim()] : []),
    ];

    const proceduresTrained = [
      ...trainingFocus.filter(f => f !== "Other"),
      ...(trainingFocusOther.trim() ? [trainingFocusOther.trim()] : []),
      ...bstComponents,
    ];

    const whatModeled = [
      ...trainingFocus.filter(f => f !== "Other"),
      ...bstComponents.filter(b => b === "Instruction provided" || b === "Modeling completed"),
    ].filter(Boolean).join(", ");

    const caregiverPracticeStr = [
      ...bstComponents.filter(b => ["Caregiver rehearsal completed", "Role-play completed", "Live coaching provided"].includes(b)),
      ...caregiverPerf.filter(p => p !== "Other"),
      ...(caregiverPerfOther.trim() ? [caregiverPerfOther.trim()] : []),
    ].filter(Boolean).join(", ");

    const feedbackStr = [
      ...bstComponents.filter(b => b === "Corrective feedback provided" || b === "Performance feedback provided"),
      ...caregiverGoals.filter(g => g !== "Other"),
      ...(caregiverGoalsOther.trim() ? [caregiverGoalsOther.trim()] : []),
    ].filter(Boolean).join(", ");

    const caregiverOutcomeStr = [
      ...caregiverPerf.filter(p => p !== "Other"),
      ...(caregiverPerfOther.trim() ? [caregiverPerfOther.trim()] : []),
      additionalDetails.trim(),
    ].filter(Boolean).join(". ");

    const generalizationStr = [
      ...caregiverGoals.filter(g => g !== "Other"),
      ...(caregiverGoalsOther.trim() ? [caregiverGoalsOther.trim()] : []),
    ].filter(Boolean).join(", ");

    const nextStepsStr = [
      ...nextStepsSel.filter(s => s !== "Other"),
      ...(nextStepsOther.trim() ? [nextStepsOther.trim()] : []),
    ].filter(Boolean).join(", ");

    try {
      const res = await fetch("/api/bcba/generate-parent-training-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sessionDate,
          timeRange: "",
          location,
          bcbaName,
          caregiverName,
          caregiverRelation,
          sessionDetails: {
            behaviorsObservedDuringSession: behaviorsObserved,
            proceduresTrainedToday: proceduresTrained,
            whatBCBAModeled: whatModeled,
            caregiverPracticeDescription: caregiverPracticeStr,
            feedbackProvided: feedbackStr,
            caregiverOutcome: caregiverOutcomeStr,
            generalizationTopicsDiscussed: generalizationStr,
            nextSessionGoals: nextStepsStr,
            clientPresent: clientPresent ?? "",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) { setGenError(data.error || "Generation failed."); return; }
      setGeneratedNote(data.note || "");
      setSimilarityWarning(!!data.similarityWarning);
    } catch {
      setGenError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <Topbar clientName="" clientId={clientId} />
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <Topbar clientName="" clientId={clientId} />
        <div className="px-8 py-8">
          <p className="text-[13px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
            {loadError}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <Topbar clientName={client?.client_name || client?.internal_code || "Client"} clientId={clientId} />

      <div className="px-8 py-6 max-w-3xl">
        <div className="bg-white rounded-xl border p-6 space-y-8" style={{ borderColor: "var(--border)" }}>
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>New Parent Training Note (97156)</p>

          {/* ── SECTION 1 — Session Information ── */}
          <div>
            <SectionHeader title="Section 1 — Session Information" />
            <div className="space-y-5">

              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Date</label>
                <input
                  type="date"
                  value={sessionDate}
                  onChange={e => setSessionDate(e.target.value)}
                  className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Location</label>
                <select
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                  style={{ borderColor: "var(--border)", color: location ? "var(--text1)" : "var(--text3)" }}
                >
                  <option value="">Select location…</option>
                  <option value="home">Home</option>
                  <option value="clinic">Clinic</option>
                  <option value="school">School</option>
                  <option value="telehealth">Telehealth</option>
                  <option value="community">Community</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                    Caregiver Name <span style={{ color: "#DC2626" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={caregiverName}
                    onChange={e => setCaregiverName(e.target.value)}
                    placeholder="First and last name"
                    className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Relation to Client</label>
                  <select
                    value={caregiverRelation}
                    onChange={e => setCaregiverRelation(e.target.value)}
                    className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  >
                    {CAREGIVER_RELATIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* ── SECTION 2 — Participants Present ── */}
          <div>
            <SectionHeader title="Section 2 — Participants Present" />
            <CheckboxGroup
              options={PARTICIPANT_OPTIONS}
              selected={participantsPresent}
              onToggle={val => toggle(setParticipantsPresent, val)}
              otherValue={participantsOther}
              onOtherChange={setParticipantsOther}
            />
          </div>

          {/* ── SECTION 3 — Was the client present? ── */}
          <div>
            <SectionHeader title="Section 3 — Was the Client Present During Training?" />
            <div className="flex gap-2">
              {(["yes", "no", "partial"] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setClientPresent(v)}
                  className="flex-1 py-2.5 rounded-xl border text-[12px] font-medium transition-colors"
                  style={{
                    background: clientPresent === v ? "var(--teal)" : "white",
                    borderColor: clientPresent === v ? "var(--teal)" : "var(--border)",
                    color: clientPresent === v ? "white" : "var(--text2)",
                  }}
                >
                  {v === "yes" ? "Yes" : v === "no" ? "No" : "Partial Session"}
                </button>
              ))}
            </div>
          </div>

          {/* ── SECTION 4 — Replacement / Skill Targets ── */}
          <div>
            <SectionHeader title="Section 4 — Replacement / Skill Acquisition Targets Addressed" />
            <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>Replacement / Skill Targets Addressed (from client profile)</p>
            {allSkills.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {allSkills.map(s => (
                  <label key={s} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(s)}
                      onChange={() => toggle(setSelectedSkills, s)}
                      className="mt-0.5 flex-shrink-0"
                      style={{ accentColor: "var(--teal)" }}
                    />
                    <span className="text-[13px]" style={{ color: "var(--text1)" }}>{s}</span>
                  </label>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={skillsFreeText}
                onChange={e => setSkillsFreeText(e.target.value)}
                placeholder="No skills in profile — describe targets addressed"
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            )}
          </div>

          {/* ── SECTION 5 — Caregiver Goals Addressed ── */}
          <div>
            <SectionHeader title="Section 5 — Caregiver Goals Addressed" />
            <CheckboxGroup
              options={CAREGIVER_GOALS_OPTIONS}
              selected={caregiverGoals}
              onToggle={val => toggle(setCaregiverGoals, val)}
              otherValue={caregiverGoalsOther}
              onOtherChange={setCaregiverGoalsOther}
            />
          </div>

          {/* ── SECTION 6 — Parent Training Focus ── */}
          <div>
            <SectionHeader title="Section 6 — Parent Training Focus" />
            <CheckboxGroup
              options={TRAINING_FOCUS_OPTIONS}
              selected={trainingFocus}
              onToggle={val => toggle(setTrainingFocus, val)}
              otherValue={trainingFocusOther}
              onOtherChange={setTrainingFocusOther}
            />
          </div>

          {/* ── SECTION 7 — BST Components Completed ── */}
          <div>
            <SectionHeader title="Section 7 — BST Components Completed" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {BST_OPTIONS.map(opt => (
                <label key={opt} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bstComponents.includes(opt)}
                    onChange={() => toggle(setBstComponents, opt)}
                    className="mt-0.5 flex-shrink-0"
                    style={{ accentColor: "var(--teal)" }}
                  />
                  <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── SECTION 8 — Caregiver Performance / Observations ── */}
          <div>
            <SectionHeader title="Section 8 — Caregiver Performance / Observations" />
            <CheckboxGroup
              options={CAREGIVER_PERF_OPTIONS}
              selected={caregiverPerf}
              onToggle={val => toggle(setCaregiverPerf, val)}
              otherValue={caregiverPerfOther}
              onOtherChange={setCaregiverPerfOther}
            />
          </div>

          {/* ── SECTION 9 — Client Response During Parent Training ── */}
          <div>
            <SectionHeader title="Section 9 — Client Response During Parent Training" />
            <CheckboxGroup
              options={CLIENT_RESPONSE_OPTIONS}
              selected={clientResponse}
              onToggle={val => toggle(setClientResponse, val)}
              otherValue={clientResponseOther}
              onOtherChange={setClientResponseOther}
            />
          </div>

          {/* ── SECTION 10 — Additional Parent Training Details ── */}
          <div>
            <SectionHeader title="Section 10 — Additional Parent Training Details" />
            <textarea
              value={additionalDetails}
              onChange={e => setAdditionalDetails(e.target.value)}
              placeholder="Describe caregiver participation, barriers, implementation challenges, client response, or specific coaching provided."
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 96 }}
            />
          </div>

          {/* ── SECTION 11 — Next Steps ── */}
          <div>
            <SectionHeader title="Section 11 — Next Steps" />
            <CheckboxGroup
              options={NEXT_STEPS_OPTIONS}
              selected={nextStepsSel}
              onToggle={val => toggle(setNextStepsSel, val)}
              otherValue={nextStepsOther}
              onOtherChange={setNextStepsOther}
            />
          </div>

          {genError && (
            <p className="text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
              {genError}
            </p>
          )}

          {/* ── SECTION 12 — Generate Note ── */}
          <button
            onClick={handleGenerate}
            disabled={!sessionDate || generating}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--teal)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
            </svg>
            {generating ? "Generating…" : "Generate Parent Training Note"}
          </button>
        </div>

        {/* Output */}
        {generatedNote && (
          <div className="mt-5 bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Generated Parent Training Note (97156)</p>
              <button
                onClick={() => navigator.clipboard.writeText(generatedNote)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:border-gray-400 transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text2)" }}
              >
                Copy
              </button>
            </div>
            {similarityWarning && (
              <p className="mb-3 text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                ⚠ This note may be similar to a previous parent training note. Review before submitting.
              </p>
            )}
            <textarea
              value={generatedNote}
              onChange={e => setGeneratedNote(e.target.value)}
              className="w-full border p-4 rounded-xl text-[13px] leading-7 resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 320 }}
            />
            <p className="mt-3 text-[12px]" style={{ color: "var(--text3)" }}>
              Saved to parent training notes for this client.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
