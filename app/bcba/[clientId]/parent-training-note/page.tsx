"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const CAREGIVER_RELATIONS = [
  "Mother", "Father", "Grandparent", "Foster Parent", "Legal Guardian", "Stepparent", "Sibling", "Other",
];

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

  // Session info
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [timeRange, setTimeRange] = useState("");
  const [location, setLocation] = useState("");
  const [caregiverName, setCaregiverName] = useState("");
  const [caregiverRelation, setCaregiverRelation] = useState("Mother");

  // Session details
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [selectedProcedures, setSelectedProcedures] = useState<string[]>([]);
  const [whatBCBAModeled, setWhatBCBAModeled] = useState("");
  const [caregiverPractice, setCaregiverPractice] = useState("");
  const [feedbackProvided, setFeedbackProvided] = useState("");
  const [caregiverOutcome, setCaregiverOutcome] = useState("");
  const [generalizationTopics, setGeneralizationTopics] = useState("");
  const [nextSessionGoals, setNextSessionGoals] = useState("");

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
      loadData(data.user.id);
    });
  }, [clientId]);

  async function loadData(_userId: string) {
    const res = await fetch(`/api/bcba/client/${clientId}`);
    if (!res.ok) { router.push("/bcba"); return; }
    const { client: clientData } = await res.json();
    setClient(clientData);
    setLoading(false);
  }

  const profile = client?.clinical_profile || {};
  const allBehaviors: string[] = profile?.activePrograms?.maladaptive || profile?.maladaptiveBehaviors || [];
  const allInterventions: string[] = profile?.approvedInterventions || [];

  function toggleBehavior(b: string) {
    setSelectedBehaviors(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);
  }

  function toggleProcedure(p: string) {
    setSelectedProcedures(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }

  async function handleGenerate() {
    if (!sessionDate || !caregiverName.trim() || selectedBehaviors.length === 0 || !whatBCBAModeled.trim() || !caregiverPractice.trim()) {
      setGenError("Please fill in date, caregiver name, select at least one behavior, and describe what was modeled and practiced.");
      return;
    }
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
          timeRange,
          location,
          bcbaName,
          caregiverName,
          caregiverRelation,
          sessionDetails: {
            behaviorsObservedDuringSession: selectedBehaviors,
            proceduresTrainedToday: selectedProcedures,
            whatBCBAModeled,
            caregiverPracticeDescription: caregiverPractice,
            feedbackProvided,
            caregiverOutcome,
            generalizationTopicsDiscussed: generalizationTopics,
            nextSessionGoals,
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

  const canGenerate =
    sessionDate &&
    caregiverName.trim().length > 0 &&
    selectedBehaviors.length > 0 &&
    whatBCBAModeled.trim().length > 0 &&
    caregiverPractice.trim().length > 0;

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
      <Topbar clientName={client?.client_name || client?.internal_code || "Client"} clientId={clientId} />

      <div className="px-8 py-6 max-w-3xl">
        <div className="bg-white rounded-xl border p-6 space-y-5" style={{ borderColor: "var(--border)" }}>
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>New Parent Training Note (97156)</p>

          {/* Date */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Session Date</label>
            <input
              type="date"
              value={sessionDate}
              onChange={e => setSessionDate(e.target.value)}
              className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            />
          </div>

          {/* Time range + Location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Time Range</label>
              <input
                type="text"
                value={timeRange}
                onChange={e => setTimeRange(e.target.value)}
                placeholder="e.g. 3:00 PM – 4:00 PM"
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Location</label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Client home"
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>
          </div>

          {/* Caregiver */}
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

          {/* Behaviors observed during session */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>
              Behaviors Observed During Session <span style={{ color: "#DC2626" }}>*</span>{" "}
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
                    onClick={() => toggleBehavior(b)}
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

          {/* Procedures trained */}
          {allInterventions.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>
                Procedures Trained Today{" "}
                <span style={{ color: "var(--text3)" }}>({selectedProcedures.length} selected)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {allInterventions.map((i: string) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleProcedure(i)}
                    className="px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors"
                    style={{
                      background: selectedProcedures.includes(i) ? "var(--teal)" : "white",
                      borderColor: selectedProcedures.includes(i) ? "var(--teal)" : "var(--border)",
                      color: selectedProcedures.includes(i) ? "white" : "var(--text2)",
                    }}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* What BCBA modeled */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
              What the BCBA Modeled <span style={{ color: "#DC2626" }}>*</span>
            </label>
            <textarea
              value={whatBCBAModeled}
              onChange={e => setWhatBCBAModeled(e.target.value)}
              placeholder="Describe the specific procedure or technique you demonstrated for the caregiver…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* Caregiver practice description */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
              Caregiver Practice Description <span style={{ color: "#DC2626" }}>*</span>
            </label>
            <textarea
              value={caregiverPractice}
              onChange={e => setCaregiverPractice(e.target.value)}
              placeholder="Describe how the caregiver rehearsed the procedure — what they did, how many trials, what conditions…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* Feedback provided */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Feedback Provided by BCBA</label>
            <textarea
              value={feedbackProvided}
              onChange={e => setFeedbackProvided(e.target.value)}
              placeholder="What specifically did you reinforce or correct — timing, prompt delivery, response quality?…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* Caregiver outcome */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Caregiver Outcome</label>
            <textarea
              value={caregiverOutcome}
              onChange={e => setCaregiverOutcome(e.target.value)}
              placeholder="Did they implement independently? What measurably improved? What needs continued practice?…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* Generalization */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Generalization Topics Discussed</label>
            <textarea
              value={generalizationTopics}
              onChange={e => setGeneralizationTopics(e.target.value)}
              placeholder="What home routines or settings will the caregiver practice this in?…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 64 }}
            />
          </div>

          {/* Next session goals — internal only */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
              Next Session Goals <span className="font-normal" style={{ color: "var(--text3)" }}>(internal reference only — not included in generated note)</span>
            </label>
            <textarea
              value={nextSessionGoals}
              onChange={e => setNextSessionGoals(e.target.value)}
              placeholder="Your own notes for the next parent training contact…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 64 }}
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
            {generating ? "Generating…" : "Generate Parent Training Note"}
          </button>
          {!canGenerate && !generating && (
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>
              Date, caregiver name, at least one behavior, BCBA modeling description, and caregiver practice description are required.
            </p>
          )}
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
