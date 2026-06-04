"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

const CONTACT_TYPES_97155 = [
  { value: "individual_supervision", label: "Individual Supervision / Protocol Modification" },
  { value: "client_observation",     label: "Client Observation" },
  { value: "group_supervision",      label: "Group Supervision" },
] as const;

const REASON_97155_OPTIONS = [
  "Lack of Progress","Regression","Goal Mastery",
  "New Maladaptive Behavior","Increase in Behavior Frequency",
  "Caregiver Concern","School Concern","Data Trend Review",
  "Assessment Review","Reauthorization Review",
];

const DATA_REVIEWED_OPTIONS = [
  "Skill Acquisition Data","Behavior Reduction Data","ABC Data",
  "Frequency Data","Duration Data","Graph Trends",
  "Caregiver Report","School Report",
];

const CLINICAL_FINDINGS_OPTIONS = [
  "Prompt Dependency","Skill Plateau","Regression",
  "Increased Behavior Frequency","Reduced Reinforcer Effectiveness",
  "Generalization Deficit","Maintenance Deficit",
  "Target Mastered","Reinforcer Lost Effectiveness",
  "Increased Response Variability","Insufficient Generalization",
  "Maintenance Concern Identified","Need for Clinical Adjustment",
];

const PROTOCOL_MODIFICATION_OPTIONS = [
  "Added Target","Modified Target","Discontinued Target",
  "Modified Prompting Procedure","Modified Reinforcement Schedule",
  "Modified Reinforcer","Modified Reinforcement Magnitude",
  "Modified Reinforcement Frequency","Modified Antecedent Strategy",
  "Modified Consequence Strategy","Modified Mastery Criteria",
  "Modified Data Collection Method","Modified Generalization Procedure",
  "Modified Maintenance Procedure",
];

const CLIENT_RESPONSE_97155 = [
  "Improved Responding","No Immediate Change","Increased Engagement",
  "Reduced Problem Behavior","Required Additional Support",
  "Demonstrated New Skill",
];

const FOLLOW_UP_OPTIONS = [
  "Continue Monitoring","Review Data Again",
  "Additional Protocol Review","Additional Parent Training",
  "Additional RBT Training","Continue Modified Procedure",
  "Monitor Client Response to Modification",
];

const GROUP_TOPICS_OPTIONS = [
  "Prompting Procedures","Reinforcement Strategies",
  "Behavior Reduction Procedures","Data Collection Methods",
  "Skill Acquisition Programming","Generalization Strategies",
  "Maintenance Procedures","Ethics and Professional Conduct",
  "BACB Supervision Requirements","Documentation Standards",
  "Crisis Procedures","Caregiver Collaboration",
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
      <span className="font-medium" style={{ color: "var(--text1)" }}>Supervision Note</span>
    </div>
  );
}

export default function SupervisionNotePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;
  const { data: session, status } = useSession();

  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Section 1 — always shared
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [location, setLocation] = useState("");
  const [contactType97155, setContactType97155] = useState("individual_supervision");

  // Individual / Client Observation fields
  const [reason97155, setReason97155] = useState<string[]>([]);
  const [dataReviewed, setDataReviewed] = useState<string[]>([]);
  const [selectedMaladaptive, setSelectedMaladaptive] = useState<string[]>([]);
  const [selectedReplacement, setSelectedReplacement] = useState<string[]>([]);
  const [selectedSkillAcq, setSelectedSkillAcq] = useState<string[]>([]);
  const [manualPrograms, setManualPrograms] = useState("");
  const [clinicalFindings, setClinicalFindings] = useState<string[]>([]);
  const [protocolMods, setProtocolMods] = useState<string[]>([]);
  const [clinicalRationale, setClinicalRationale] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [clientResponse97155, setClientResponse97155] = useState<string[]>([]);
  const [followUpPlan, setFollowUpPlan] = useState<string[]>([]);

  // Group Supervision fields
  const [groupParticipants, setGroupParticipants] = useState<number>(2);
  const [groupTopics, setGroupTopics] = useState<string[]>([]);
  const [groupClinicalTrends, setGroupClinicalTrends] = useState("");
  const [groupRecommendations, setGroupRecommendations] = useState("");
  const [groupFollowUpPlan, setGroupFollowUpPlan] = useState<string[]>([]);

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
  const allReplacements: string[] = (profile?.replacementBehaviors || [])
    .map((s: any) => (typeof s === "string" ? s : s?.name || "")).filter(Boolean);
  const allSkillAcq: string[] = (profile?.skillAcquisition || [])
    .map((s: any) => (typeof s === "string" ? s : s?.name || "")).filter(Boolean);

  function toggle(setter: React.Dispatch<React.SetStateAction<string[]>>, val: string) {
    setter(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  }

  const isDisabled = (() => {
    if (generating) return true;
    if (!sessionDate || !location) return true;
    if (contactType97155 === "group_supervision") {
      return groupTopics.length === 0 || groupClinicalTrends.trim() === "";
    }
    if (contactType97155 === "client_observation") {
      return (
        reason97155.length === 0 ||
        dataReviewed.length === 0 ||
        protocolMods.length === 0 ||
        clinicalRationale.trim() === "" ||
        expectedOutcome.trim() === "" ||
        clientResponse97155.length === 0
      );
    }
    // individual_supervision
    return (
      reason97155.length === 0 ||
      dataReviewed.length === 0 ||
      protocolMods.length === 0 ||
      clinicalRationale.trim() === "" ||
      expectedOutcome.trim() === ""
    );
  })();

  async function handleGenerate() {
    setGenerating(true);
    setGenError("");
    setGeneratedNote("");
    setSimilarityWarning(false);

    const bodyPayload = contactType97155 === "group_supervision"
      ? {
          clientId,
          sessionDate,
          location,
          contactType: contactType97155,
          groupSupervision: {
            participantCount: groupParticipants,
            topicsReviewed: groupTopics,
            clinicalTrends: groupClinicalTrends,
            recommendations: groupRecommendations,
            followUpPlan: groupFollowUpPlan,
          },
        }
      : {
          clientId,
          sessionDate,
          location,
          contactType: contactType97155,
          reason97155,
          dataReviewed,
          programsReviewed: {
            maladaptive: selectedMaladaptive,
            replacement: selectedReplacement,
            skillAcquisition: selectedSkillAcq,
            manual: manualPrograms.trim(),
          },
          clinicalFindings,
          protocolModifications: protocolMods,
          clinicalRationale,
          expectedOutcome,
          clientResponse: clientResponse97155,
          followUpPlan,
        };

    try {
      const res = await fetch("/api/bcba/generate-supervision-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
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

          {/* SECTION 1 — Always shown */}
          <div>
            <SectionHeader title="Section 1 — Session Information" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
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
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Contact Type</label>
                <div className="flex flex-col gap-2">
                  {CONTACT_TYPES_97155.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setContactType97155(t.value)}
                      className="w-full py-2.5 px-4 rounded-xl border text-[12px] font-medium transition-colors text-left"
                      style={{
                        background: contactType97155 === t.value ? "var(--teal)" : "white",
                        borderColor: contactType97155 === t.value ? "var(--teal)" : "var(--border)",
                        color: contactType97155 === t.value ? "white" : "var(--text2)",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── GROUP SUPERVISION SECTIONS ── */}
          {contactType97155 === "group_supervision" && (
            <>
              <div className="px-4 py-3 rounded-xl border text-[12px]" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                Group supervision notes document general clinical topics only. Do not include client-identifying information.
              </div>

              {/* G1 — Number of Participants */}
              <div>
                <SectionHeader title="Section G1 — Number of Participants" />
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={groupParticipants}
                    onChange={e => setGroupParticipants(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                    className="w-24 border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                    style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  />
                  <span className="text-[12px]" style={{ color: "var(--text3)" }}>RBT participants (2–10)</span>
                </div>
              </div>

              {/* G2 — Topics Reviewed */}
              <div>
                <SectionHeader title="Section G2 — Topics Reviewed" />
                <CheckboxGroup
                  options={GROUP_TOPICS_OPTIONS}
                  selected={groupTopics}
                  onToggle={val => toggle(setGroupTopics, val)}
                />
              </div>

              {/* G3 — General Clinical Trends Discussed */}
              <div>
                <SectionHeader title="Section G3 — General Clinical Trends Discussed" />
                <p className="text-[12px] mb-2" style={{ color: "var(--text3)" }}>Required</p>
                <textarea
                  value={groupClinicalTrends}
                  onChange={e => setGroupClinicalTrends(e.target.value)}
                  placeholder="Describe general clinical trends or themes discussed during this group supervision contact."
                  className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
                />
              </div>

              {/* G4 — General Recommendations */}
              <div>
                <SectionHeader title="Section G4 — General Recommendations" />
                <textarea
                  value={groupRecommendations}
                  onChange={e => setGroupRecommendations(e.target.value)}
                  placeholder="General recommendations or action items for the group."
                  className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
                />
              </div>

              {/* G5 — Follow-Up Plan */}
              <div>
                <SectionHeader title="Section G5 — Follow-Up Plan" />
                <CheckboxGroup
                  options={FOLLOW_UP_OPTIONS}
                  selected={groupFollowUpPlan}
                  onToggle={val => toggle(setGroupFollowUpPlan, val)}
                />
              </div>
            </>
          )}

          {/* ── INDIVIDUAL / CLIENT OBSERVATION SECTIONS ── */}
          {contactType97155 !== "group_supervision" && (
            <>
              {/* Section 2 — Reason for Clinical Review */}
              <div>
                <SectionHeader title="Section 2 — Reason for Clinical Review" />
                <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>Why was BCBA clinical involvement required today?</p>
                <CheckboxGroup
                  options={REASON_97155_OPTIONS}
                  selected={reason97155}
                  onToggle={val => toggle(setReason97155, val)}
                />
              </div>

              {/* Section 3 — Data Reviewed */}
              <div>
                <SectionHeader title="Section 3 — Data Reviewed" />
                <CheckboxGroup
                  options={DATA_REVIEWED_OPTIONS}
                  selected={dataReviewed}
                  onToggle={val => toggle(setDataReviewed, val)}
                />
              </div>

              {/* Section 4 — Programs / Behaviors Reviewed */}
              <div>
                <SectionHeader title="Section 4 — Programs / Behaviors Reviewed" />
                <p className="text-[12px] mb-4" style={{ color: "var(--text3)" }}>Select what was reviewed during this session</p>
                <div className="space-y-5">
                  <div>
                    <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Maladaptive Behaviors</p>
                    {allBehaviors.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {allBehaviors.map(b => (
                          <label key={b} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedMaladaptive.includes(b)}
                              onChange={() => toggle(setSelectedMaladaptive, b)}
                              className="mt-0.5 flex-shrink-0"
                              style={{ accentColor: "var(--teal)" }}
                            />
                            <span className="text-[13px]" style={{ color: "var(--text1)" }}>{b}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px]" style={{ color: "var(--text3)" }}>No maladaptive behaviors in client profile</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Replacement Programs</p>
                    {allReplacements.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {allReplacements.map(s => (
                          <label key={s} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedReplacement.includes(s)}
                              onChange={() => toggle(setSelectedReplacement, s)}
                              className="mt-0.5 flex-shrink-0"
                              style={{ accentColor: "var(--teal)" }}
                            />
                            <span className="text-[13px]" style={{ color: "var(--text1)" }}>{s}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px]" style={{ color: "var(--text3)" }}>No replacement programs in client profile</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Skill Acquisition Programs</p>
                    {allSkillAcq.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {allSkillAcq.map(s => (
                          <label key={s} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedSkillAcq.includes(s)}
                              onChange={() => toggle(setSelectedSkillAcq, s)}
                              className="mt-0.5 flex-shrink-0"
                              style={{ accentColor: "var(--teal)" }}
                            />
                            <span className="text-[13px]" style={{ color: "var(--text1)" }}>{s}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px]" style={{ color: "var(--text3)" }}>No skill acquisition programs in client profile</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Other / Not in Profile</label>
                    <input
                      type="text"
                      value={manualPrograms}
                      onChange={e => setManualPrograms(e.target.value)}
                      placeholder="Additional programs or behaviors reviewed..."
                      className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                  </div>
                </div>
              </div>

              {/* Section 5 — Clinical Findings */}
              <div>
                <SectionHeader title="Section 5 — Clinical Findings" />
                <CheckboxGroup
                  options={CLINICAL_FINDINGS_OPTIONS}
                  selected={clinicalFindings}
                  onToggle={val => toggle(setClinicalFindings, val)}
                />
              </div>

              {/* Section 6 — Protocol Modification Made */}
              <div>
                <SectionHeader title="Section 6 — Protocol Modification Made" />
                <div className="mb-3 px-3 py-2 rounded-lg border text-[12px]" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                  At least one protocol modification is required to generate a 97155 note.
                </div>
                <CheckboxGroup
                  options={PROTOCOL_MODIFICATION_OPTIONS}
                  selected={protocolMods}
                  onToggle={val => toggle(setProtocolMods, val)}
                />
              </div>

              {/* Section 7 — Clinical Rationale */}
              <div>
                <SectionHeader title="Section 7 — Clinical Rationale" />
                <p className="text-[12px] mb-2" style={{ color: "var(--text3)" }}>Required *</p>
                <textarea
                  value={clinicalRationale}
                  onChange={e => setClinicalRationale(e.target.value)}
                  placeholder="Why was this protocol modification clinically necessary? Reference specific data trends or clinical observations."
                  className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
                />
              </div>

              {/* Section 8 — Expected Outcome */}
              <div>
                <SectionHeader title="Section 8 — Expected Outcome" />
                <p className="text-[12px] mb-2" style={{ color: "var(--text3)" }}>Required *</p>
                <textarea
                  value={expectedOutcome}
                  onChange={e => setExpectedOutcome(e.target.value)}
                  placeholder="What should improve as a result of this modification? Be specific and measurable where possible."
                  className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
                />
              </div>

              {/* Section 9 — Client Response */}
              <div>
                <SectionHeader title={
                  contactType97155 === "client_observation"
                    ? "Section 9 — Client Response (Required)"
                    : "Section 9 — Client Response (Optional)"
                } />
                <CheckboxGroup
                  options={CLIENT_RESPONSE_97155}
                  selected={clientResponse97155}
                  onToggle={val => toggle(setClientResponse97155, val)}
                />
              </div>

              {/* Section 10 — Follow-Up Plan */}
              <div>
                <SectionHeader title="Section 10 — Follow-Up Plan" />
                <CheckboxGroup
                  options={FOLLOW_UP_OPTIONS}
                  selected={followUpPlan}
                  onToggle={val => toggle(setFollowUpPlan, val)}
                />
              </div>
            </>
          )}

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
