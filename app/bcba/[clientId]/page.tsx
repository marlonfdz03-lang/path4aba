"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BCBATab = "overview" | "notes" | "schedule" | "supervision" | "parent_training" | "reassessment";

const SUPERVISION_TYPE_LABELS: Record<string, string> = {
  face_to_face: "Face-to-Face",
  remote: "Remote",
  individual_supervision: "Individual Supervision",
  group_supervision: "Group Supervision",
  client_observation: "Client Observation",
};


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

function Topbar({ clientName }: { clientName: string }) {
  return (
    <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
      <Link href="/bcba" className="hover:underline" style={{ color: "var(--text3)" }}>My Clients</Link>
      <span style={{ color: "var(--border2)" }}>/</span>
      <span className="font-medium" style={{ color: "var(--text1)" }}>{clientName || "Client"}</span>
    </div>
  );
}

function TabBar({ active, onChange, isBCBAPro }: { active: BCBATab; onChange: (t: BCBATab) => void; isBCBAPro: boolean | null }) {
  const tabs: { id: BCBATab; label: string; proOnly?: boolean }[] = [
    { id: "overview",       label: "Overview" },
    { id: "notes",          label: "RBT Notes" },
    { id: "schedule",       label: "Schedule" },
    { id: "supervision",    label: "Supervision Notes" },
    { id: "parent_training",label: "Parent Training" },
    { id: "reassessment",   label: "Assessment Tools", proOnly: true },
  ];
  return (
    <div className="flex border-b bg-white px-8 overflow-x-auto" style={{ borderColor: "var(--border)" }}>
      {tabs.map(t => {
        const isDisabled = t.proOnly && isBCBAPro === false;
        return (
          <button
            key={t.id}
            onClick={() => !isDisabled && onChange(t.id)}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap disabled:cursor-not-allowed"
            style={{
              borderColor: active === t.id ? "var(--teal)" : "transparent",
              color: isDisabled ? "var(--text3)" : active === t.id ? "var(--teal)" : "var(--text3)",
              opacity: isDisabled ? 0.6 : 1,
            }}
          >
            {t.label}
            {t.proOnly && isBCBAPro === false && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(27,168,160,0.12)", color: "var(--teal)" }}>
                Pro
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}


export default function BCBAClientPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [activeTab, setActiveTab] = useState<BCBATab>("overview");
  const [isBCBAPro, setIsBCBAPro] = useState<boolean | null>(null);

  const [client, setClient] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [supervisionNotes, setSupervisionNotes] = useState<any[]>([]);
  const [parentTrainingNotes, setParentTrainingNotes] = useState<any[]>([]);
  const [missingHours, setMissingHours] = useState<any[]>([]);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rbtDailySummary, setRbtDailySummary] = useState<{ behaviors: string[]; skills: string[]; interventions: string[] } | null>(null);

  // Clinical profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [editBehaviors, setEditBehaviors] = useState<{ name: string; topography: string; function: string }[]>([]);
  const [editInterventions, setEditInterventions] = useState<string[]>([]);
  const [editSkills, setEditSkills] = useState<string[]>([]);
  const [newBehaviorName, setNewBehaviorName] = useState("");
  const [newBehaviorTopography, setNewBehaviorTopography] = useState("");
  const [newBehaviorFunction, setNewBehaviorFunction] = useState("");
  const [newIntervention, setNewIntervention] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    if (activeTab === "supervision") {
      fetch(`/api/bcba/rbt-daily-summary?clientId=${clientId}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.summary) setRbtDailySummary(d.summary); })
        .catch(() => {});
    }
  }, [activeTab, clientId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }

      supabase
        .from("subscriptions")
        .select("status, plan, trial_ends_at")
        .eq("user_id", data.user.id)
        .maybeSingle()
        .then(({ data: sub }) => {
          const now = new Date();
          const isPro =
            sub?.plan === "bcba_pro" &&
            (sub.status === "active" ||
              (sub.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at) > now));
          setIsBCBAPro(!!isPro);
        });

      loadAll(data.user.id as string);
    });
  }, [clientId]);

  async function loadAll(userId: string) {
    const clientRes = await fetch(`/api/bcba/client/${clientId}`);
    if (!clientRes.ok) { router.push("/bcba"); return; }
    const { client: clientData } = await clientRes.json();
    setClient(clientData);

    const notesRes = await fetch(`/api/bcba/rbt-notes?clientId=${clientId}`);
    if (notesRes.ok) { const d = await notesRes.json(); setNotes(d.notes || []); }

    const { data: supNotes } = await supabase
      .from("supervision_notes")
      .select("id, session_date, supervision_type, note_text, status, created_at")
      .eq("client_id", clientId)
      .eq("bcba_id", userId)
      .order("session_date", { ascending: false });
    setSupervisionNotes(supNotes || []);

    const { data: ptNotes } = await supabase
      .from("parent_training_notes")
      .select("id, session_date, caregiver_name, caregiver_relation, note_text, status, created_at")
      .eq("client_id", clientId)
      .eq("bcba_id", userId)
      .order("session_date", { ascending: false });
    setParentTrainingNotes(ptNotes || []);

    const hoursRes = await fetch(`/api/bcba/missing-hours?clientId=${clientId}`);
    if (hoursRes.ok) { const d = await hoursRes.json(); setMissingHours(d.entries || []); }

    setLoading(false);
  }

  function enterEditMode() {
    const cp = client?.clinical_profile || {};
    setEditBehaviors(
      (cp.maladaptiveBehaviors || []).map((b: any) =>
        typeof b === "string"
          ? { name: b, topography: "", function: "" }
          : { name: b?.name || "", topography: b?.topography || "", function: b?.function || b?.behaviorFunction || "" }
      )
    );
    setEditInterventions(
      (cp.interventions || []).map((i: any) => typeof i === "string" ? i : (i?.name || ""))
    );
    setEditSkills([
      ...(cp.replacementBehaviors || []).map((s: any) => typeof s === "string" ? s : (s?.name || "")),
      ...(cp.skillAcquisition || []).map((s: any) => typeof s === "string" ? s : (s?.name || "")),
    ]);
    setNewBehaviorName(""); setNewBehaviorTopography(""); setNewBehaviorFunction("");
    setNewIntervention(""); setNewSkill("");
    setSaveError(""); setProfileSaved(false);
    setEditingProfile(true);
  }

  function addBehavior() {
    if (!newBehaviorName.trim()) return;
    setEditBehaviors(prev => [...prev, { name: newBehaviorName.trim(), topography: newBehaviorTopography.trim(), function: newBehaviorFunction.trim() }]);
    setNewBehaviorName(""); setNewBehaviorTopography(""); setNewBehaviorFunction("");
  }

  function addIntervention() {
    if (!newIntervention.trim()) return;
    setEditInterventions(prev => [...prev, newIntervention.trim()]);
    setNewIntervention("");
  }

  function addSkill() {
    if (!newSkill.trim()) return;
    setEditSkills(prev => [...prev, newSkill.trim()]);
    setNewSkill("");
  }

  async function handleSaveProfile() {
    setSaving(true); setSaveError(""); setProfileSaved(false);
    const cp = client?.clinical_profile || {};
    const newProfile = {
      ...cp,
      maladaptiveBehaviors: editBehaviors,
      interventions: editInterventions,
      replacementBehaviors: editSkills,
      skillAcquisition: [],
    };
    try {
      const res = await fetch(`/api/bcba/client/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicalProfile: newProfile }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || "Save failed"); return; }
      setClient((prev: any) => ({ ...prev, clinical_profile: data.client.clinical_profile }));
      setProfileSaved(true);
      setEditingProfile(false);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <Topbar clientName="" />
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  const cp = client?.clinical_profile || {};

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <Topbar clientName={client?.client_name || "Client"} />

      {/* Client header */}
      <div className="px-8 py-5 bg-white border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
          >
            {(client?.client_name || client?.internal_code || "?")[0].toUpperCase()}
          </div>
          <div>
            <p className="text-[16px] font-semibold" style={{ color: "var(--text1)" }}>{client?.client_name || client?.internal_code}</p>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>
              {cp.diagnosis?.join(", ") || ""}
            </p>
          </div>
        </div>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} isBCBAPro={isBCBAPro} />

      <div className="px-8 py-6 max-w-5xl">

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div>

            {/* Edit mode */}
            {editingProfile ? (
              <div className="space-y-5 max-w-[700px]">
                <div className="flex items-center justify-between">
                  <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Edit Clinical Profile</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingProfile(false)}
                      className="px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors hover:border-gray-400"
                      style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      disabled={saving}
                      className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
                      style={{ background: "var(--teal)" }}
                    >
                      {saving ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </div>
                {saveError && <p className="text-[13px] text-red-500">{saveError}</p>}

                {/* Section 1: Maladaptive Behaviors */}
                <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Maladaptive Behaviors" />
                  <div className="space-y-2 mb-4">
                    {editBehaviors.length === 0 && (
                      <p className="text-[13px]" style={{ color: "var(--text3)" }}>No behaviors yet.</p>
                    )}
                    {editBehaviors.map((b, i) => (
                      <div key={i} className="flex items-start gap-2 px-4 py-3 rounded-xl" style={{ background: "#FEF3E2", border: "1px solid #F6AD5580" }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold" style={{ color: "#92400E" }}>{b.name}</p>
                          {b.topography && <p className="text-[12px]" style={{ color: "#B7791F" }}>Topography: {b.topography}</p>}
                          {b.function && <p className="text-[12px]" style={{ color: "#B7791F" }}>Function: {b.function}</p>}
                        </div>
                        <button
                          onClick={() => setEditBehaviors(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-[18px] leading-none flex-shrink-0 hover:opacity-60 transition-opacity"
                          style={{ color: "#B7791F" }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 p-3 rounded-lg border border-dashed" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text3)" }}>Add Behavior</p>
                    <input
                      placeholder="Behavior name (required)"
                      value={newBehaviorName}
                      onChange={e => setNewBehaviorName(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <input
                      placeholder="Topography (optional)"
                      value={newBehaviorTopography}
                      onChange={e => setNewBehaviorTopography(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <input
                      placeholder="Function (optional)"
                      value={newBehaviorFunction}
                      onChange={e => setNewBehaviorFunction(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addBehavior()}
                      className="w-full border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <button
                      onClick={addBehavior}
                      disabled={!newBehaviorName.trim()}
                      className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--teal)" }}
                    >
                      Add Behavior
                    </button>
                  </div>
                </div>

                {/* Section 2: Approved Interventions */}
                <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Approved Interventions" />
                  <div className="flex flex-wrap gap-2 mb-4">
                    {editInterventions.length === 0 && (
                      <p className="text-[13px]" style={{ color: "var(--text3)" }}>No interventions yet.</p>
                    )}
                    {editInterventions.map((item, i) => (
                      <span key={i} className="flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>
                        {item}
                        <button onClick={() => setEditInterventions(prev => prev.filter((_, idx) => idx !== i))} className="ml-0.5 text-[14px] leading-none hover:opacity-60">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Add intervention"
                      value={newIntervention}
                      onChange={e => setNewIntervention(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addIntervention()}
                      className="flex-1 border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <button
                      onClick={addIntervention}
                      disabled={!newIntervention.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--teal)" }}
                    >Add</button>
                  </div>
                </div>

                {/* Section 3: Replacement Skills */}
                <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Replacement Skills &amp; Skill Acquisition" />
                  <div className="flex flex-wrap gap-2 mb-4">
                    {editSkills.length === 0 && (
                      <p className="text-[13px]" style={{ color: "var(--text3)" }}>No skills yet.</p>
                    )}
                    {editSkills.map((s, i) => (
                      <span key={i} className="flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                        {s}
                        <button onClick={() => setEditSkills(prev => prev.filter((_, idx) => idx !== i))} className="ml-0.5 text-[14px] leading-none hover:opacity-60">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Add skill"
                      value={newSkill}
                      onChange={e => setNewSkill(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addSkill()}
                      className="flex-1 border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <button
                      onClick={addSkill}
                      disabled={!newSkill.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--teal)" }}
                    >Add</button>
                  </div>
                </div>
              </div>
            ) : (

              /* Read mode */
              <div>
                <div className="flex justify-end mb-4">
                  {profileSaved && (
                    <span className="mr-3 text-[13px] font-medium" style={{ color: "#16A34A" }}>Saved ✓</span>
                  )}
                  <button
                    onClick={enterEditMode}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                    style={{ background: "var(--teal)" }}
                  >
                    Edit Clinical Profile
                  </button>
                </div>
                <div className="grid grid-cols-[280px_1fr] gap-5">

                  {/* Left column */}
                  <div className="space-y-5">

                    {/* Clinical Snapshot */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Clinical Snapshot" />
                      <div className="space-y-3">
                        {[
                          { label: "Diagnosis", value: cp.diagnosis?.join(", ") || "—" },
                          { label: "Maladaptive Behaviors", value: cp.maladaptiveBehaviors?.length || 0 },
                          { label: "Approved Interventions", value: cp.interventions?.length || 0 },
                          { label: "Replacement Behaviors", value: (cp.replacementBehaviors?.length || 0) + (cp.skillAcquisition?.length || 0) },
                          { label: "Reinforcers", value: cp.reinforcers?.length || 0 },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-start gap-4">
                            <span className="text-[13px]" style={{ color: "var(--text2)" }}>{label}</span>
                            <span className="text-[13px] font-medium text-right" style={{ color: "var(--text1)" }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Reinforcers */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Reinforcers" />
                      {cp.reinforcers?.length ? (
                        <div className="mb-3">
                          <p className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--text3)" }}>Tangibles</p>
                          <div className="flex flex-wrap gap-1.5">
                            {cp.reinforcers.map((r: string, i: number) => (
                              <span key={i} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>{r}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {cp.homeActivities?.length ? (
                        <div>
                          <p className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--text3)" }}>Activities</p>
                          <div className="flex flex-wrap gap-1.5">
                            {cp.homeActivities.map((a: string, i: number) => (
                              <span key={i} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>{a}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {!cp.reinforcers?.length && !cp.homeActivities?.length && (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>No reinforcers in profile.</p>
                      )}
                    </div>

                  </div>

                  {/* Right column */}
                  <div className="space-y-5">

                    {/* Maladaptive Behaviors */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Maladaptive Behaviors" />
                      {!cp.maladaptiveBehaviors?.length ? (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>No behaviors recorded.</p>
                      ) : (
                        <div className="space-y-2">
                          {cp.maladaptiveBehaviors.map((b: any, i: number) => {
                            const name = typeof b === "string" ? b : (b?.name || "");
                            const topography = typeof b === "object" ? (b?.topography || "") : "";
                            const fn = typeof b === "object" ? (b?.function || b?.behaviorFunction || "") : "";
                            return (
                              <div key={i} className="px-4 py-3 rounded-xl" style={{ background: "#FEF3E2", border: "1px solid #F6AD5580" }}>
                                <p className="text-[13px] font-semibold" style={{ color: "#92400E" }}>{name}</p>
                                {topography && <p className="text-[12px] mt-0.5" style={{ color: "#B7791F" }}><span className="font-medium">Topography:</span> {topography}</p>}
                                {fn && <p className="text-[12px]" style={{ color: "#B7791F" }}><span className="font-medium">Function:</span> {fn}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Approved Interventions */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Approved Interventions" />
                      {!cp.interventions?.length ? (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>No interventions in profile.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {cp.interventions.map((item: any, i: number) => (
                            <span key={i} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>
                              {typeof item === "string" ? item : (item?.name || "")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Replacement Skills */}
                    {(cp.replacementBehaviors?.length || cp.skillAcquisition?.length) ? (
                      <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                        <SectionHeader title="Replacement Skills &amp; Skill Acquisition" />
                        <div className="flex flex-wrap gap-2">
                          {[...(cp.replacementBehaviors || []), ...(cp.skillAcquisition || [])].map((s: any, i: number) => (
                            <span key={i} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                              {typeof s === "string" ? s : (s?.name || "")}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── RBT Notes Tab ── */}
        {activeTab === "notes" && (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No session notes from the RBT yet.</p>
            ) : notes.map(note => {
              const isExpanded = expandedNoteId === note.id;
              const dateLabel = new Date(note.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              return (
                <div key={note.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                      {!isExpanded && (
                        <p className="text-[12px] mt-1 line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(note.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setExpandedNoteId(isExpanded ? null : note.id)}
                      className="text-[12px] font-medium hover:underline flex-shrink-0"
                      style={{ color: "var(--teal)" }}
                    >
                      {isExpanded ? "Collapse" : "Expand"}
                    </button>
                  </div>
                  {isExpanded && (
                    <p className="text-[13px] leading-7 whitespace-pre-wrap" style={{ color: "var(--text2)" }}>
                      {note.note_text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Schedule Tab ── */}
        {activeTab === "schedule" && (
          <div>
            {missingHours.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text1)" }}>No missed hours recorded</p>
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>Missed session data will appear here as the RBT records it.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {missingHours.map(entry => (
                  <div key={entry.id} className="bg-white rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{entry.date}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>{entry.reason}</p>
                        {entry.notes && <p className="text-[12px] mt-1" style={{ color: "var(--text2)" }}>{entry.notes}</p>}
                      </div>
                      <span className="text-[13px] font-semibold" style={{ color: "#DC2626" }}>{entry.hours}h missed</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Supervision Notes Tab ── */}
        {activeTab === "supervision" && (
          <div>
            {/* RBT daily session banner */}
            {rbtDailySummary && (
              <div className="mb-4 px-4 py-4 rounded-xl border" style={{ background: "rgba(27,168,160,0.05)", borderColor: "rgba(27,168,160,0.2)", borderLeftWidth: "3px", borderLeftColor: "var(--teal)" }}>
                <p className="text-[13px] font-semibold mb-2" style={{ color: "var(--teal)" }}>RBT Session Today — Recommended Focus Areas</p>
                {rbtDailySummary.behaviors.length > 0 && (
                  <p className="text-[12px] mb-1" style={{ color: "var(--text2)" }}>
                    <span className="font-medium">Behaviors addressed: </span>{rbtDailySummary.behaviors.join(", ")}
                  </p>
                )}
                {rbtDailySummary.skills.length > 0 && (
                  <p className="text-[12px] mb-1" style={{ color: "var(--text2)" }}>
                    <span className="font-medium">Skills targeted: </span>{rbtDailySummary.skills.join(", ")}
                  </p>
                )}
                {rbtDailySummary.interventions.length > 0 && (
                  <p className="text-[12px] mb-1" style={{ color: "var(--text2)" }}>
                    <span className="font-medium">Interventions used: </span>{rbtDailySummary.interventions.slice(0, 5).join(", ")}
                  </p>
                )}
                <p className="text-[11px] mt-2" style={{ color: "var(--text3)" }}>Based on today's RBT session note</p>
              </div>
            )}
            <div className="flex justify-end mb-4">
              <Link
                href={`/bcba/${clientId}/supervision-note`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Supervision Note
              </Link>
            </div>
            {supervisionNotes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No supervision notes yet.</p>
            ) : (
              <div className="space-y-4">
                {supervisionNotes.map(sn => {
                  const isExpanded = expandedNoteId === sn.id;
                  const dateLabel = new Date(sn.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  const typeLabel = SUPERVISION_TYPE_LABELS[sn.supervision_type] || sn.supervision_type || "Supervision";
                  return (
                    <div key={sn.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>{typeLabel}</p>
                        </div>
                        <button
                          onClick={() => setExpandedNoteId(isExpanded ? null : sn.id)}
                          className="text-[12px] font-medium hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Collapse" : "View"}
                        </button>
                      </div>
                      {!isExpanded && (
                        <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(sn.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                          {sn.note_text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Parent Training Tab ── */}
        {activeTab === "parent_training" && (
          <div>
            <div className="flex justify-end mb-4">
              <Link
                href={`/bcba/${clientId}/parent-training-note`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Parent Training Note
              </Link>
            </div>
            {parentTrainingNotes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No parent training notes yet.</p>
            ) : (
              <div className="space-y-4">
                {parentTrainingNotes.map(pt => {
                  const isExpanded = expandedNoteId === pt.id;
                  const dateLabel = new Date(pt.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <div key={pt.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          {pt.caregiver_name && (
                            <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>
                              {pt.caregiver_name}{pt.caregiver_relation ? ` · ${pt.caregiver_relation}` : ""}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => setExpandedNoteId(isExpanded ? null : pt.id)}
                          className="text-[12px] font-medium hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Collapse" : "View"}
                        </button>
                      </div>
                      {!isExpanded && (
                        <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(pt.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                          {pt.note_text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Assessment Tools Tab ── */}
        {activeTab === "reassessment" && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(27,168,160,0.1)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4" style={{ background: "rgba(27,168,160,0.15)", color: "var(--teal)" }}>
              Coming Soon
            </span>
            <p className="text-[15px] font-semibold mb-2" style={{ color: "var(--text1)" }}>Assessment Tools</p>
            <p className="text-[13px] max-w-xs" style={{ color: "var(--text3)" }}>
              Reassessment tools will be available here for BCBA Pro plan members.
            </p>
          </div>
        )}

      </div>
    </main>
  );
}
