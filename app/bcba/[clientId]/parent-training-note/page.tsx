"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

const CAREGIVER_RELATIONS = [
  "Mother","Father","Grandmother","Grandfather","Aunt","Uncle",
  "Foster Parent","Legal Guardian","Sibling","Other",
];

const PARTICIPANT_OPTIONS = [
  "BCBA","Caregiver","Client","Sibling","Other Caregiver","Teacher",
];

const TRAINING_TOPIC_OPTIONS = [
  "Reinforcement","Prompting","Functional Communication",
  "Tantrum Management","Aggression Management","Transitions",
  "Daily Living Skills","Replacement Behavior Training",
  "Data Collection","Generalization","Antecedent Strategies",
  "Consequence Strategies",
];

const PROCEDURES_TRAINED_OPTIONS = [
  "DRA","FCT","Prompting Hierarchy","First-Then","Token Economy",
  "Redirection","Planned Ignoring","Premack Principle",
  "Differential Reinforcement","Visual Schedule",
  "Error Correction","Task Analysis",
];

const BST_OPTIONS = [
  "Instruction","Modeling","Rehearsal","Feedback",
];

const CAREGIVER_PERFORMANCE_OPTIONS = [
  "Independent","Minimal Prompting","Moderate Prompting",
  "Maximum Prompting","Did Not Practice",
];

const FEEDBACK_OPTIONS = [
  "Reinforcement Timing","Prompt Fading",
  "Consistency with Instructions","Response Blocking / Safety",
  "Behavior-Specific Praise","Data Recording",
  "Follow-Through with Routines","Reducing Repeated Prompts",
  "Increasing Wait Time",
];

const CLIENT_RESPONSE_OPTIONS_97156 = [
  "Increased Engagement","Required Redirection",
  "Demonstrated Replacement Behavior","Demonstrated Challenging Behavior",
  "Tolerated Caregiver Implementation","Required Prompting",
  "No Direct Client Response Observed",
];

const BARRIERS_OPTIONS = [
  "Time Constraints","Inconsistent Caregiver Implementation",
  "Multiple Caregivers","Limited Practice Opportunities",
  "Client Resistance / Challenging Behavior",
  "Caregiver Needed Additional Prompting",
  "Environmental Distractions","No Barriers Identified",
];

const FOLLOW_UP_OPTIONS_97156 = [
  "Continue BST","Review Caregiver Implementation",
  "Monitor Generalization","Review Data Collected by Caregiver",
  "Provide Additional Modeling","Increase Caregiver Independence",
  "Continue Current Caregiver Goal",
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
}: {
  options: string[];
  selected: string[];
  onToggle: (val: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {options.map(opt => (
        <label key={opt} className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(opt)}
            onChange={() => onToggle(opt)}
            className="mt-0.5 flex-shrink-0"
            style={{ accentColor: "var(--teal)" }}
          />
          <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
        </label>
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
  const { data: session, status } = useSession();

  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Section 1
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [location, setLocation] = useState("");
  const [caregiverName, setCaregiverName] = useState("");
  const [caregiverRelation, setCaregiverRelation] = useState("");
  const [participantsPresent, setParticipantsPresent] = useState<string[]>([]);
  const [clientPresent, setClientPresent] = useState<"yes" | "no" | "partial" | "">("");

  // Section 2
  const [trainingTopics, setTrainingTopics] = useState<string[]>([]);

  // Section 3
  const [selectedPTGoals, setSelectedPTGoals] = useState<string[]>([]);
  const [manualPTGoal, setManualPTGoal] = useState("");

  // Section 4
  const [proceduresTrained, setProceduresTrained] = useState<string[]>([]);

  // Section 5
  const [bstComponents, setBstComponents] = useState<string[]>([]);

  // Section 6
  const [caregiverPerformance, setCaregiverPerformance] = useState("");
  const [didNotPracticeReason, setDidNotPracticeReason] = useState("");

  // Section 7
  const [feedbackProvided, setFeedbackProvided] = useState<string[]>([]);

  // Section 8
  const [clientResponse, setClientResponse] = useState<string[]>([]);

  // Section 9
  const [barriersIdentified, setBarriersIdentified] = useState<string[]>([]);

  // Section 10
  const [homeImplementationPlan, setHomeImplementationPlan] = useState("");

  // Section 11
  const [followUpPlan, setFollowUpPlan] = useState<string[]>([]);

  // Output
  const [generating, setGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);
  const [genError, setGenError] = useState("");
  const [noteCopied, setNoteCopied] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }
    loadData();
  }, [clientId, status]);

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

  const parentTrainingGoals: string[] = (
    profile?.parentTrainingGoals ||
    profile?.caregiverGoals ||
    profile?.familyTrainingGoals ||
    []
  ).map((g: any) => (typeof g === "string" ? g : g?.goal || g?.name || "")).filter(Boolean);

  function toggle(setter: React.Dispatch<React.SetStateAction<string[]>>, val: string) {
    setter(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  }

  const isDisabled =
    !sessionDate ||
    !location ||
    caregiverName.trim() === "" ||
    caregiverRelation === "" ||
    trainingTopics.length === 0 ||
    bstComponents.length < 2 ||
    caregiverPerformance === "" ||
    (caregiverPerformance === "Did Not Practice" && didNotPracticeReason.trim() === "") ||
    homeImplementationPlan.trim() === "" ||
    ((clientPresent === "yes" || clientPresent === "partial") && clientResponse.length === 0) ||
    generating;

  async function handleGenerate() {
    setGenerating(true);
    setGenError("");
    setGeneratedNote("");
    setSimilarityWarning(false);

    try {
      const res = await fetch("/api/bcba/generate-parent-training-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sessionDate,
          location,
          caregiverName,
          caregiverRelation,
          participantsPresent,
          clientPresent,
          trainingTopics,
          parentTrainingGoals: selectedPTGoals,
          manualPTGoal: manualPTGoal.trim(),
          proceduresTrained,
          bstComponents,
          caregiverPerformance,
          didNotPracticeReason: caregiverPerformance === "Did Not Practice" ? didNotPracticeReason : "",
          feedbackProvided,
          clientResponse,
          barriersIdentified,
          homeImplementationPlan,
          followUpPlan,
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
          try {
            const meta = JSON.parse(parts[1]);
            if (meta.error) { setGenError(meta.error); return; }
            setSimilarityWarning(!!meta.similarityWarning);
          } catch {}
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                  Location <span style={{ color: "#DC2626" }}>*</span>
                </label>
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
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                    Relation to Client <span style={{ color: "#DC2626" }}>*</span>
                  </label>
                  <select
                    value={caregiverRelation}
                    onChange={e => setCaregiverRelation(e.target.value)}
                    className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                    style={{ borderColor: "var(--border)", color: caregiverRelation ? "var(--text1)" : "var(--text3)" }}
                  >
                    <option value="">Select relation…</option>
                    {CAREGIVER_RELATIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Participants Present</label>
                <CheckboxGroup
                  options={PARTICIPANT_OPTIONS}
                  selected={participantsPresent}
                  onToggle={val => toggle(setParticipantsPresent, val)}
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Client Present During Training?</label>
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
                      {v === "yes" ? "Yes" : v === "no" ? "No" : "Partial"}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* ── SECTION 2 — Training Topic ── */}
          <div>
            <SectionHeader title="Section 2 — Training Topic" />
            <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>What was the focus of this caregiver training session?</p>
            <CheckboxGroup
              options={TRAINING_TOPIC_OPTIONS}
              selected={trainingTopics}
              onToggle={val => toggle(setTrainingTopics, val)}
            />
          </div>

          {/* ── SECTION 3 — Parent Training Goals Addressed ── */}
          <div>
            <SectionHeader title="Section 3 — Parent Training Goals Addressed" />
            <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>Goals from the approved treatment plan</p>
            {parentTrainingGoals.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
                {parentTrainingGoals.map(g => (
                  <label key={g} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPTGoals.includes(g)}
                      onChange={() => toggle(setSelectedPTGoals, g)}
                      className="mt-0.5 flex-shrink-0"
                      style={{ accentColor: "var(--teal)" }}
                    />
                    <span className="text-[13px]" style={{ color: "var(--text1)" }}>{g}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[12px] mb-4 px-3 py-2 rounded-lg border" style={{ background: "#F9FAFB", borderColor: "var(--border)", color: "var(--text3)" }}>
                No parent training goals found in client profile. Update the client profile or assessment extraction.
              </p>
            )}
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Other / Not in Profile</label>
              <input
                type="text"
                value={manualPTGoal}
                onChange={e => setManualPTGoal(e.target.value)}
                placeholder="Add a goal — must be clinically approved and part of the treatment plan"
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
              <p className="mt-1.5 text-[11px] px-1" style={{ color: "#92400E" }}>
                Only add goals that are clinically approved and documented in the treatment plan.
              </p>
            </div>
          </div>

          {/* ── SECTION 4 — Procedures Trained ── */}
          <div>
            <SectionHeader title="Section 4 — Procedures Trained" />
            <CheckboxGroup
              options={PROCEDURES_TRAINED_OPTIONS}
              selected={proceduresTrained}
              onToggle={val => toggle(setProceduresTrained, val)}
            />
          </div>

          {/* ── SECTION 5 — BST Components Used ── */}
          <div>
            <SectionHeader title="Section 5 — BST Components Used" />
            <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>Minimum 2 components required for 97156 documentation</p>
            <CheckboxGroup
              options={BST_OPTIONS}
              selected={bstComponents}
              onToggle={val => toggle(setBstComponents, val)}
            />
            {bstComponents.length === 1 && (
              <p className="mt-2 text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                At least 2 BST components are required to generate a 97156 note.
              </p>
            )}
          </div>

          {/* ── SECTION 6 — Caregiver Performance ── */}
          <div>
            <SectionHeader title="Section 6 — Caregiver Performance" />
            <div className="space-y-2.5">
              {CAREGIVER_PERFORMANCE_OPTIONS.map(opt => (
                <label key={opt} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="caregiverPerformance"
                    value={opt}
                    checked={caregiverPerformance === opt}
                    onChange={() => setCaregiverPerformance(opt)}
                    className="flex-shrink-0"
                    style={{ accentColor: "var(--teal)" }}
                  />
                  <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
                </label>
              ))}
            </div>
            {caregiverPerformance === "Did Not Practice" && (
              <div className="mt-3">
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                  Explain why caregiver did not practice <span style={{ color: "#DC2626" }}>*</span>
                </label>
                <textarea
                  value={didNotPracticeReason}
                  onChange={e => setDidNotPracticeReason(e.target.value)}
                  placeholder="Required — explain reason caregiver did not practice"
                  className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
                />
              </div>
            )}
          </div>

          {/* ── SECTION 7 — Feedback Provided to Caregiver ── */}
          <div>
            <SectionHeader title="Section 7 — Feedback Provided to Caregiver" />
            <CheckboxGroup
              options={FEEDBACK_OPTIONS}
              selected={feedbackProvided}
              onToggle={val => toggle(setFeedbackProvided, val)}
            />
          </div>

          {/* ── SECTION 8 — Client Response (only if present) ── */}
          {(clientPresent === "yes" || clientPresent === "partial") && (
            <div>
              <SectionHeader title="Section 8 — Client Response During Session (Required)" />
              <CheckboxGroup
                options={CLIENT_RESPONSE_OPTIONS_97156}
                selected={clientResponse}
                onToggle={val => toggle(setClientResponse, val)}
              />
            </div>
          )}

          {/* ── SECTION 9 — Barriers Identified ── */}
          <div>
            <SectionHeader title="Section 9 — Barriers Identified" />
            <CheckboxGroup
              options={BARRIERS_OPTIONS}
              selected={barriersIdentified}
              onToggle={val => toggle(setBarriersIdentified, val)}
            />
          </div>

          {/* ── SECTION 10 — Home Implementation Plan ── */}
          <div>
            <SectionHeader title="Section 10 — Home Implementation Plan" />
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
              Home Implementation Plan — Required for Note Generation <span style={{ color: "#DC2626" }}>*</span>
            </label>
            <textarea
              value={homeImplementationPlan}
              onChange={e => setHomeImplementationPlan(e.target.value)}
              placeholder="What should the caregiver implement at home before the next caregiver training contact? Be specific."
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 100 }}
            />
          </div>

          {/* ── SECTION 11 — Follow-Up Plan ── */}
          <div>
            <SectionHeader title="Section 11 — Follow-Up Plan" />
            <CheckboxGroup
              options={FOLLOW_UP_OPTIONS_97156}
              selected={followUpPlan}
              onToggle={val => toggle(setFollowUpPlan, val)}
            />
          </div>

          {genError && (
            <p className="text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
              {genError}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={isDisabled}
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
                onClick={() => { navigator.clipboard.writeText(generatedNote); setNoteCopied(true); setTimeout(() => setNoteCopied(false), 2000); }}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors"
                style={{ borderColor: noteCopied ? "#16A34A" : "var(--border)", color: noteCopied ? "#16A34A" : "var(--text2)" }}
              >
                {noteCopied ? "✓ Copied" : "Copy"}
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
