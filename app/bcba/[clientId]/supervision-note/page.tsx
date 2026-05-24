"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const SUPERVISION_TYPES = [
  { value: "face_to_face", label: "Face to Face" },
  { value: "remote", label: "Remote" },
] as const;

const COMPLIANCE_OPTIONS = [
  { value: "satisfactory", label: "Satisfactory", color: "#16A34A", bg: "#DCFCE7" },
  { value: "needs_improvement", label: "Needs Improvement", color: "#D97706", bg: "#FEF3C7" },
  { value: "unsatisfactory", label: "Unsatisfactory", color: "#DC2626", bg: "#FEE2E2" },
] as const;

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
  const [rbtNotes, setRbtNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [supervisionType, setSupervisionType] = useState<"face_to_face" | "remote">("face_to_face");
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [selectedInterventions, setSelectedInterventions] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [complianceLevel, setComplianceLevel] = useState<"satisfactory" | "needs_improvement" | "unsatisfactory">("satisfactory");
  const [linkedRbtNoteId, setLinkedRbtNoteId] = useState("");
  const [feedbackProvided, setFeedbackProvided] = useState("");

  // Output state
  const [generating, setGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);
  const [genError, setGenError] = useState("");
  const [preFilledBanner, setPreFilledBanner] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
      loadData(data.user.id);
    });
  }, [clientId]);

  async function loadData(userId: string) {
    const { data: conn } = await supabase
      .from("bcba_clients")
      .select("clients(id, client_name, diagnosis, clinical_profile)")
      .eq("bcba_id", userId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (!conn) { router.push("/bcba"); return; }
    setClient((conn as any).clients);

    // Fetch RBT notes for this client (for linking + pre-fill)
    const res = await fetch(`/api/bcba/rbt-notes?clientId=${clientId}`);
    if (res.ok) {
      const d = await res.json();
      setRbtNotes(d.notes || []);

      // Check if RBT submitted a note today — pre-fill if so
      const today = new Date().toISOString().split("T")[0];
      const todayNote = (d.notes || []).find((n: any) => n.session_date === today);
      if (todayNote && todayNote.raw_session_data) {
        try {
          const raw = typeof todayNote.raw_session_data === "string"
            ? JSON.parse(todayNote.raw_session_data)
            : todayNote.raw_session_data;
          const behaviors = raw?.behaviorsObserved?.map((b: any) => b.name || b).filter(Boolean) || [];
          const interventions = raw?.clientProfile?.approvedInterventions || [];
          const skills = raw?.replacementSkillsAddressed?.map((s: any) => s.name || s).filter(Boolean) || [];
          if (behaviors.length || interventions.length || skills.length) {
            setSelectedBehaviors(behaviors.slice(0, 8));
            setSelectedInterventions(interventions.slice(0, 8));
            setSelectedSkills(skills.slice(0, 8));
            setLinkedRbtNoteId(todayNote.id);
            setPreFilledBanner(true);
          }
        } catch {}
      }
    }
    setLoading(false);
  }

  const profile = client?.clinical_profile || {};
  const allBehaviors: string[] = profile?.activePrograms?.maladaptive || profile?.maladaptiveBehaviors || [];
  const allInterventions: string[] = profile?.approvedInterventions || [];
  const allSkills: string[] = [
    ...(profile?.activePrograms?.replacementSkills || []),
    ...(profile?.replacementBehaviors || []),
    ...(profile?.skillAcquisition || []),
  ];

  function toggle(arr: string[], setArr: (v: string[]) => void, item: string) {
    setArr(arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]);
  }

  async function handleGenerate() {
    if (!sessionDate || selectedBehaviors.length === 0 || selectedInterventions.length === 0) {
      setGenError("Please fill in date, behaviors, and interventions.");
      return;
    }
    setGenerating(true);
    setGenError("");
    setGeneratedNote("");
    setSimilarityWarning(false);

    try {
      const res = await fetch("/api/bcba/generate-supervision-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sessionDate,
          supervisionType,
          rbtNoteId: linkedRbtNoteId || undefined,
          behaviors: selectedBehaviors,
          interventions: selectedInterventions,
          replacementSkills: selectedSkills,
          feedbackProvided: feedbackProvided || undefined,
          complianceLevel,
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

  const canGenerate = sessionDate && selectedBehaviors.length > 0 && selectedInterventions.length > 0;

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <Topbar clientName="" clientId={clientId} />
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <Topbar clientName={client?.client_name || "Client"} clientId={clientId} />

      <div className="px-8 py-6 max-w-3xl">

        {preFilledBanner && (
          <div className="mb-5 px-4 py-3 rounded-xl border text-[13px]" style={{ background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" }}>
            Pre-filled from RBT note submitted today. Review and adjust as needed.
          </div>
        )}

        <div className="bg-white rounded-xl border p-6 space-y-5" style={{ borderColor: "var(--border)" }}>
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>New Supervision Note</p>

          {/* Session date */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Session Date</label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            />
          </div>

          {/* Supervision type */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Supervision Type</label>
            <div className="flex gap-2">
              {SUPERVISION_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSupervisionType(t.value)}
                  className="flex-1 py-2.5 rounded-xl border text-[13px] font-medium transition-colors"
                  style={{
                    background: supervisionType === t.value ? "var(--teal)" : "white",
                    borderColor: supervisionType === t.value ? "var(--teal)" : "var(--border)",
                    color: supervisionType === t.value ? "white" : "var(--text2)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Behaviors */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>
              Behaviors Observed{" "}
              <span style={{ color: "var(--text3)" }}>({selectedBehaviors.length} selected)</span>
            </label>
            {allBehaviors.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>No behaviors in client profile.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allBehaviors.map((b: string) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggle(selectedBehaviors, setSelectedBehaviors, b)}
                    className="px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors"
                    style={{
                      background: selectedBehaviors.includes(b) ? "var(--teal)" : "white",
                      borderColor: selectedBehaviors.includes(b) ? "var(--teal)" : "var(--border)",
                      color: selectedBehaviors.includes(b) ? "white" : "var(--text2)",
                    }}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Interventions */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>
              Interventions Supervised{" "}
              <span style={{ color: "var(--text3)" }}>({selectedInterventions.length} selected)</span>
            </label>
            {allInterventions.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>No interventions in client profile.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allInterventions.map((i: string) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggle(selectedInterventions, setSelectedInterventions, i)}
                    className="px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors"
                    style={{
                      background: selectedInterventions.includes(i) ? "var(--teal)" : "white",
                      borderColor: selectedInterventions.includes(i) ? "var(--teal)" : "var(--border)",
                      color: selectedInterventions.includes(i) ? "white" : "var(--text2)",
                    }}
                  >
                    {i}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Replacement Skills */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>
              Replacement Skills Targeted{" "}
              <span style={{ color: "var(--text3)" }}>({selectedSkills.length} selected)</span>
            </label>
            {allSkills.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>No replacement skills in client profile.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allSkills.map((s: string) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggle(selectedSkills, setSelectedSkills, s)}
                    className="px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors"
                    style={{
                      background: selectedSkills.includes(s) ? "var(--teal)" : "white",
                      borderColor: selectedSkills.includes(s) ? "var(--teal)" : "var(--border)",
                      color: selectedSkills.includes(s) ? "white" : "var(--text2)",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* RBT compliance */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>RBT Performance</label>
            <div className="flex gap-2">
              {COMPLIANCE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setComplianceLevel(opt.value)}
                  className="flex-1 py-2 rounded-xl border text-[12px] font-semibold transition-colors"
                  style={{
                    background: complianceLevel === opt.value ? opt.bg : "white",
                    borderColor: complianceLevel === opt.value ? opt.color : "var(--border)",
                    color: complianceLevel === opt.value ? opt.color : "var(--text2)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Link to RBT note */}
          {rbtNotes.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                Link to RBT Note (optional)
              </label>
              <select
                value={linkedRbtNoteId}
                onChange={(e) => setLinkedRbtNoteId(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              >
                <option value="">None</option>
                {rbtNotes.map(n => {
                  const dateLabel = n.session_date
                    ? new Date(n.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <option key={n.id} value={n.id}>RBT Note — {dateLabel}</option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Feedback / context */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
              Additional Context for AI (optional)
            </label>
            <textarea
              value={feedbackProvided}
              onChange={(e) => setFeedbackProvided(e.target.value)}
              placeholder="Specific feedback you provided, areas of concern, modeling topics…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {genError && (
            <p className="text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
              {genError}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--teal)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
            </svg>
            {generating ? "Generating…" : "Generate Supervision Note"}
          </button>
          {!canGenerate && !generating && (
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>
              Select a date, at least one behavior, and at least one intervention to generate.
            </p>
          )}
        </div>

        {/* Output */}
        {generatedNote && (
          <div className="mt-5 bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Generated Supervision Note</p>
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
                ⚠️ This note may be similar to a previous supervision note. Consider editing before submitting.
              </p>
            )}
            <textarea
              value={generatedNote}
              onChange={(e) => setGeneratedNote(e.target.value)}
              className="w-full border p-4 rounded-xl text-[13px] leading-7 resize-none focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 280 }}
            />
            <p className="mt-3 text-[12px]" style={{ color: "var(--text3)" }}>
              This note has been saved to the supervision notes for this client.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
