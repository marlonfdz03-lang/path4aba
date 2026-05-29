"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const CONTACT_TYPES = [
  { value: "individual_supervision", label: "Individual" },
  { value: "group_supervision",      label: "Group" },
  { value: "client_observation",     label: "Client Observation" },
] as const;

type ContactType = typeof CONTACT_TYPES[number]["value"];

const PARTICIPANT_OPTIONS = ["Client", "BCBA", "RBT", "Caregiver", "Teacher", "Other"];

const WHY_BCBA_OPTIONS = [
  "Prompt dependency observed",
  "Lack of progress toward goals",
  "Increase in maladaptive behavior",
  "Treatment integrity concerns",
  "Generalization deficits observed",
  "Protocol modification required",
  "RBT implementation concerns",
  "Escalation in behavior severity",
  "Skill acquisition plateau",
  "Data trends required clinical review",
  "Other",
];

const BCBA_ACTIONS_OPTIONS = [
  "Modified prompting procedures",
  "Modified reinforcement procedures",
  "Adjusted behavior intervention strategies",
  "Updated teaching procedures",
  "Modified task analysis",
  "Reviewed and analyzed data",
  "Modeled procedures for RBT",
  "Provided live coaching",
  "Conducted BST",
  "Provided corrective feedback",
  "Monitored treatment integrity",
  "Other",
];

const RBT_FEEDBACK_OPTIONS = [
  "BCBA modeled procedures",
  "Immediate corrective feedback provided",
  "Prompting hierarchy reviewed",
  "Reinforcement timing reviewed",
  "Error correction procedures reviewed",
  "BST completed",
  "Live coaching provided",
  "Treatment integrity monitored",
  "Data collection reviewed",
  "Other",
];

const NEXT_STEPS_OPTIONS = [
  "Continue monitoring prompt dependency",
  "Continue modified reinforcement schedule",
  "Continue BCBA supervision and observation",
  "Monitor treatment integrity",
  "Reassess protocol effectiveness next session",
  "Continue RBT coaching",
  "Continue data collection review",
  "Monitor maladaptive behavior trends",
  "Continue fading prompts",
  "Continue caregiver collaboration",
  "Review progress toward goals",
  "Reevaluate intervention effectiveness",
  "Other",
];

const OBJECTIVE_OBS_OPTIONS = [
  "Increased prompt dependency observed",
  "Reduced independent responding observed",
  "Elevated maladaptive behavior frequency observed",
  "Increased latency to respond observed",
  "Inconsistent responding across targets observed",
  "Reduced task engagement observed",
  "Treatment integrity concerns observed",
  "Inconsistent reinforcement delivery observed",
  "Difficulty transitioning between activities observed",
  "Increased vocal protest observed",
  "Increased task refusal observed",
  "Generalization deficits observed",
  "Reduced attending behavior observed",
  "Difficulty maintaining instructional control observed",
  "Client required increased prompting levels",
  "Reduced motivation for programmed reinforcers observed",
  "Inconsistent error correction implementation observed",
  "Escalation during transitions observed",
  "Reduced tolerance to denied access observed",
  "Skill acquisition plateau observed",
  "Other",
];

const CLIENT_RESPONSE_OPTIONS = [
  "Increased independent responding observed",
  "Reduced maladaptive behavior observed",
  "Improved task engagement observed",
  "Improved transition tolerance observed",
  "Reduced prompt dependency observed",
  "Increased compliance with demands observed",
  "Improved instructional control observed",
  "Increased attending behavior observed",
  "Reduced latency to respond observed",
  "Improved reinforcement effectiveness observed",
  "Improved tolerance to denied access observed",
  "Improved participation during teaching activities observed",
  "Increased appropriate communication observed",
  "Improved responding across skill acquisition targets observed",
  "Reduced escalation during transitions observed",
  "Improved treatment participation observed",
  "Improved behavioral regulation observed",
  "Increased successful transitions observed",
  "Improved consistency across trials observed",
  "Other",
];

const ADDITIONAL_FEEDBACK_OPTIONS = [
  "Reinforcement timing reviewed with RBT",
  "Prompt hierarchy implementation reviewed",
  "Error correction procedures reviewed",
  "Treatment integrity feedback provided",
  "Live modeling completed by BCBA",
  "RBT rehearsed modified procedures",
  "BCBA provided live coaching during session",
  "Data collection procedures reviewed",
  "Prompt fading procedures reviewed",
  "Antecedent strategies reviewed",
  "Replacement behavior implementation reviewed",
  "Behavioral momentum procedures reviewed",
  "Transition procedures reviewed",
  "Reinforcement schedule implementation reviewed",
  "BCBA monitored RBT procedural fidelity",
  "Corrective feedback provided regarding prompting consistency",
  "Corrective feedback provided regarding reinforcement delivery",
  "RBT demonstrated improved implementation following feedback",
  "Additional supervision recommended",
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

function YesNoToggle({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      {([true, false] as const).map(v => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className="px-5 py-2 rounded-xl border text-[12px] font-medium transition-colors"
          style={{
            background: value === v ? "var(--teal)" : "white",
            borderColor: value === v ? "var(--teal)" : "var(--border)",
            color: value === v ? "white" : "var(--text2)",
          }}
        >
          {v ? "Yes" : "No"}
        </button>
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
      <span className="font-medium" style={{ color: "var(--text1)" }}>Supervision Note</span>
    </div>
  );
}

export default function SupervisionNotePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Section 1 — Session Information
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [location, setLocation] = useState("");
  const [participantsPresent, setParticipantsPresent] = useState<string[]>([]);
  const [participantsOther, setParticipantsOther] = useState("");
  const [rbtPresent, setRbtPresent] = useState<boolean | null>(null);
  const [directObservation, setDirectObservation] = useState<boolean | null>(null);
  const [supervisorName, setSupervisorName] = useState("");
  const [rbtName, setRbtName] = useState("");
  const [contactType, setContactType] = useState<ContactType>("individual_supervision");

  // Section 2 — Maladaptive Behaviors
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [behaviorsFreeText, setBehaviorsFreeText] = useState("");

  // Section 3 — Skill Targets
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillsFreeText, setSkillsFreeText] = useState("");

  // Section 4 — Why BCBA involvement needed
  const [whyBCBA, setWhyBCBA] = useState<string[]>([]);
  const [whyBCBAOther, setWhyBCBAOther] = useState("");

  // Section 5 — What BCBA did
  const [bcbaActions, setBcbaActions] = useState<string[]>([]);
  const [bcbaActionsOther, setBcbaActionsOther] = useState("");

  // Section 6 — Objective observations
  const [objectiveObs, setObjectiveObs] = useState<string[]>([]);
  const [objectiveObsOther, setObjectiveObsOther] = useState("");

  // Section 7 — Client response
  const [clientResponseSel, setClientResponseSel] = useState<string[]>([]);
  const [clientResponseOther, setClientResponseOther] = useState("");

  // Section 8 — RBT feedback
  const [rbtFeedback, setRbtFeedback] = useState<string[]>([]);
  const [rbtFeedbackOther, setRbtFeedbackOther] = useState("");

  // Section 9 — Additional RBT feedback
  const [additionalFeedbackSel, setAdditionalFeedbackSel] = useState<string[]>([]);
  const [additionalFeedbackOther, setAdditionalFeedbackOther] = useState("");

  // Section 10 — Next steps
  const [nextStepsSel, setNextStepsSel] = useState<string[]>([]);
  const [nextStepsOther, setNextStepsOther] = useState("");

  // Section 11 — Additional next steps
  const [additionalNextSteps, setAdditionalNextSteps] = useState("");

  // Output
  const [generating, setGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);
  const [genError, setGenError] = useState("");
  const [noteCopied, setNoteCopied] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
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
      console.error("[supervision-note] loadData error:", e);
      setLoadError("Failed to load client data. Please go back and try again.");
    } finally {
      setLoading(false);
    }
  }

  const profile = client?.clinical_profile || {};

  const allBehaviors: string[] = (
    profile?.activePrograms?.maladaptive || profile?.maladaptiveBehaviors || []
  ).map((b: any) => (typeof b === "string" ? b : b?.name || "")).filter(Boolean);

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

    const behaviorsForAPI = selectedBehaviors.length > 0
      ? selectedBehaviors
      : behaviorsFreeText.trim() ? [behaviorsFreeText.trim()] : [];

    const skillsContext = selectedSkills.length > 0
      ? selectedSkills
      : skillsFreeText.trim() ? [skillsFreeText.trim()] : [];

    const objectiveStr = [
      objectiveObs.filter(o => o !== "Other").join(", "),
      objectiveObsOther.trim(),
    ].filter(Boolean).join(", ");

    const clientResponseStr = [
      clientResponseSel.filter(o => o !== "Other").join(", "),
      clientResponseOther.trim(),
    ].filter(Boolean).join(", ");

    const additionalFeedbackStr = [
      additionalFeedbackSel.filter(o => o !== "Other").join(", "),
      additionalFeedbackOther.trim(),
    ].filter(Boolean).join(", ");

    const protocolMods = [
      bcbaActions.length > 0 ? bcbaActions.join(", ") : "",
      bcbaActionsOther.trim(),
      skillsContext.length > 0 ? `Skill targets addressed: ${skillsContext.join(", ")}` : "",
      clientResponseStr,
    ].filter(Boolean).join(". ");

    const feedbackStr = [
      rbtFeedback.join(", "),
      rbtFeedbackOther.trim(),
      additionalFeedbackStr,
    ].filter(Boolean).join(". ");

    const clinicalDecisionsStr = [
      whyBCBA.length > 0 ? `BCBA involvement needed because: ${whyBCBA.join(", ")}` : "",
      whyBCBAOther.trim(),
      objectiveStr,
    ].filter(Boolean).join(". ");

    const nextStepsStr = [
      nextStepsSel.join(", "),
      nextStepsOther.trim(),
      additionalNextSteps.trim(),
    ].filter(Boolean).join(". ");

    try {
      const res = await fetch("/api/bcba/generate-supervision-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sessionDate,
          timeRange: "",
          location,
          supervisorName,
          rbtName,
          contactType,
          supervisionDetails: {
            behaviorsObservedDuringVisit: behaviorsForAPI,
            protocolModificationsMade: protocolMods,
            feedbackProvidedToRBT: feedbackStr,
            rbtPerformanceNotes: objectiveStr,
            clinicalDecisionsMade: clinicalDecisionsStr,
            nextSteps: nextStepsStr,
          },
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setGenError(data.error || "Generation failed.");
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
          try { const meta = JSON.parse(parts[1]); if (meta.error) { setGenError(meta.error); return; } setSimilarityWarning(!!meta.similarityWarning); } catch {}
          break outer;
        }
        if (chunk.includes("__REGEN__")) {
          fullText = "";
          setGeneratedNote("");
          continue;
        }
        fullText += chunk;
        setGeneratedNote(fullText);
      }
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
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>New Supervision Note (97155)</p>

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

              <div>
                <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Participants Present</label>
                <CheckboxGroup
                  options={PARTICIPANT_OPTIONS}
                  selected={participantsPresent}
                  onToggle={val => toggle(setParticipantsPresent, val)}
                  otherValue={participantsOther}
                  onOtherChange={setParticipantsOther}
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Was the RBT present?</label>
                <YesNoToggle value={rbtPresent} onChange={setRbtPresent} />
              </div>

              <div>
                <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Was direct client observation completed?</label>
                <YesNoToggle value={directObservation} onChange={setDirectObservation} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Supervisor Name</label>
                  <input
                    type="text"
                    value={supervisorName}
                    onChange={e => setSupervisorName(e.target.value)}
                    placeholder="Your name"
                    className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>RBT Name</label>
                  <input
                    type="text"
                    value={rbtName}
                    onChange={e => setRbtName(e.target.value)}
                    placeholder="RBT being supervised"
                    className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Contact Type</label>
                <div className="flex gap-2">
                  {CONTACT_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setContactType(t.value)}
                      className="flex-1 py-2.5 rounded-xl border text-[12px] font-medium transition-colors"
                      style={{
                        background: contactType === t.value ? "var(--teal)" : "white",
                        borderColor: contactType === t.value ? "var(--teal)" : "var(--border)",
                        color: contactType === t.value ? "white" : "var(--text2)",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── SECTION 2 — Maladaptive Behaviors ── */}
          <div>
            <SectionHeader title="Section 2 — Maladaptive Behaviors Addressed" />
            <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>Maladaptive Behaviors Addressed (from client profile)</p>
            {allBehaviors.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {allBehaviors.map(b => (
                  <label key={b} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedBehaviors.includes(b)}
                      onChange={() => toggle(setSelectedBehaviors, b)}
                      className="mt-0.5 flex-shrink-0"
                      style={{ accentColor: "var(--teal)" }}
                    />
                    <span className="text-[13px]" style={{ color: "var(--text1)" }}>{b}</span>
                  </label>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={behaviorsFreeText}
                onChange={e => setBehaviorsFreeText(e.target.value)}
                placeholder="No behaviors in profile — describe behaviors addressed"
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            )}
          </div>

          {/* ── SECTION 3 — Replacement / Skill Targets ── */}
          <div>
            <SectionHeader title="Section 3 — Replacement / Skill Acquisition Targets Addressed" />
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

          {/* ── SECTION 4 — Why BCBA Involvement Needed ── */}
          <div>
            <SectionHeader title="Section 4 — Why Was BCBA Involvement Needed?" />
            <CheckboxGroup
              options={WHY_BCBA_OPTIONS}
              selected={whyBCBA}
              onToggle={val => toggle(setWhyBCBA, val)}
              otherValue={whyBCBAOther}
              onOtherChange={setWhyBCBAOther}
            />
          </div>

          {/* ── SECTION 5 — What Did the BCBA Do ── */}
          <div>
            <SectionHeader title="Section 5 — What Did the BCBA Do?" />
            <CheckboxGroup
              options={BCBA_ACTIONS_OPTIONS}
              selected={bcbaActions}
              onToggle={val => toggle(setBcbaActions, val)}
              otherValue={bcbaActionsOther}
              onOtherChange={setBcbaActionsOther}
            />
          </div>

          {/* ── SECTION 6 — Objective Observations / Data ── */}
          <div>
            <SectionHeader title="Section 6 — Objective Observations / Data" />
            <CheckboxGroup
              options={OBJECTIVE_OBS_OPTIONS}
              selected={objectiveObs}
              onToggle={val => toggle(setObjectiveObs, val)}
              otherValue={objectiveObsOther}
              onOtherChange={setObjectiveObsOther}
            />
          </div>

          {/* ── SECTION 7 — Client Response After Modifications ── */}
          <div>
            <SectionHeader title="Section 7 — Client Response After Modifications" />
            <CheckboxGroup
              options={CLIENT_RESPONSE_OPTIONS}
              selected={clientResponseSel}
              onToggle={val => toggle(setClientResponseSel, val)}
              otherValue={clientResponseOther}
              onOtherChange={setClientResponseOther}
            />
          </div>

          {/* ── SECTION 8 — RBT Feedback / Training Provided ── */}
          <div>
            <SectionHeader title="Section 8 — RBT Feedback / Training Provided" />
            <CheckboxGroup
              options={RBT_FEEDBACK_OPTIONS}
              selected={rbtFeedback}
              onToggle={val => toggle(setRbtFeedback, val)}
              otherValue={rbtFeedbackOther}
              onOtherChange={setRbtFeedbackOther}
            />
          </div>

          {/* ── SECTION 9 — Additional RBT Feedback Details ── */}
          <div>
            <SectionHeader title="Section 9 — Additional RBT Feedback Details" />
            <CheckboxGroup
              options={ADDITIONAL_FEEDBACK_OPTIONS}
              selected={additionalFeedbackSel}
              onToggle={val => toggle(setAdditionalFeedbackSel, val)}
              otherValue={additionalFeedbackOther}
              onOtherChange={setAdditionalFeedbackOther}
            />
          </div>

          {/* ── SECTION 10 — Next Steps ── */}
          <div>
            <SectionHeader title="Section 10 — Next Steps" />
            <CheckboxGroup
              options={NEXT_STEPS_OPTIONS}
              selected={nextStepsSel}
              onToggle={val => toggle(setNextStepsSel, val)}
              otherValue={nextStepsOther}
              onOtherChange={setNextStepsOther}
            />
          </div>

          {/* ── SECTION 11 — Additional Next Steps Details ── */}
          <div>
            <SectionHeader title="Section 11 — Additional Next Steps Details" />
            <textarea
              value={additionalNextSteps}
              onChange={e => setAdditionalNextSteps(e.target.value)}
              placeholder="Add any additional next steps or clinical recommendations."
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
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
            {generating ? "Generating…" : "Generate Supervision Note"}
          </button>
        </div>

        {/* Output */}
        {generatedNote && (
          <div className="mt-5 bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Generated Supervision Note (97155)</p>
              <button
                onClick={() => { navigator.clipboard.writeText(generatedNote); setNoteCopied(true); setTimeout(() => setNoteCopied(false), 2000); }}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors"
                style={{ borderColor: noteCopied ? "#16A34A" : "var(--border)", color: noteCopied ? "#16A34A" : "var(--text2)" }}
              >
                {noteCopied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            {similarityWarning && (
              <p className="mb-3 text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                ⚠ This note may be similar to a previous supervision note. Review before submitting.
              </p>
            )}
            <textarea
              value={generatedNote}
              onChange={e => setGeneratedNote(e.target.value)}
              className="w-full border p-4 rounded-xl text-[13px] leading-7 resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 280 }}
            />
            <p className="mt-3 text-[12px]" style={{ color: "var(--text3)" }}>
              Saved to supervision notes for this client.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
