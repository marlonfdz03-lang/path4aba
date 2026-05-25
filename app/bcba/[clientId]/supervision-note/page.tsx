"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const CONTACT_TYPES = [
  { value: "individual_supervision", label: "Individual" },
  { value: "group_supervision",      label: "Group" },
  { value: "client_observation",     label: "Client Observation" },
] as const;

type ContactType = typeof CONTACT_TYPES[number]["value"];

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

  // Session info
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [timeRange, setTimeRange] = useState("");
  const [location, setLocation] = useState("");
  const [supervisorName, setSupervisorName] = useState("");
  const [rbtName, setRbtName] = useState("");
  const [contactType, setContactType] = useState<ContactType>("individual_supervision");

  // Supervision details
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [protocolModifications, setProtocolModifications] = useState("");
  const [feedbackProvided, setFeedbackProvided] = useState("");
  const [rbtPerformanceNotes, setRbtPerformanceNotes] = useState("");
  const [clinicalDecisions, setClinicalDecisions] = useState("");
  const [nextSteps, setNextSteps] = useState("");

  // Output
  const [generating, setGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState("");
  const [similarityWarning, setSimilarityWarning] = useState(false);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
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

  function toggleBehavior(b: string) {
    setSelectedBehaviors(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);
  }

  async function handleGenerate() {
    if (!sessionDate || selectedBehaviors.length === 0 || !protocolModifications.trim()) {
      setGenError("Please fill in date, select at least one behavior, and describe the protocol modification.");
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
          timeRange,
          location,
          supervisorName,
          rbtName,
          contactType,
          supervisionDetails: {
            behaviorsObservedDuringVisit: selectedBehaviors,
            protocolModificationsMade: protocolModifications,
            feedbackProvidedToRBT: feedbackProvided,
            rbtPerformanceNotes,
            clinicalDecisionsMade: clinicalDecisions,
            nextSteps,
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

  const canGenerate = sessionDate && selectedBehaviors.length > 0 && protocolModifications.trim().length > 0;

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
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>New Supervision Note (97155)</p>

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

          {/* Time Range + Location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Time Range</label>
              <input
                type="text"
                value={timeRange}
                onChange={e => setTimeRange(e.target.value)}
                placeholder="e.g. 9:00 AM – 10:00 AM"
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
                placeholder="e.g. Client home, school"
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>
          </div>

          {/* Supervisor + RBT names */}
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

          {/* Contact type */}
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

          {/* Behaviors observed during visit */}
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>
              Behaviors Observed During Visit{" "}
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

          {/* Protocol modification — required */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
              Protocol Modification Made <span style={{ color: "#DC2626" }}>*</span>
            </label>
            <textarea
              value={protocolModifications}
              onChange={e => setProtocolModifications(e.target.value)}
              placeholder="Describe any protocol adjustments, schedule changes, prompt level changes, or clinical decisions made during this contact…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* Feedback provided to RBT */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Feedback Provided to RBT</label>
            <textarea
              value={feedbackProvided}
              onChange={e => setFeedbackProvided(e.target.value)}
              placeholder="What corrective, confirmatory, or instructional feedback did you deliver to the RBT?…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* RBT performance notes */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>RBT Performance Notes</label>
            <textarea
              value={rbtPerformanceNotes}
              onChange={e => setRbtPerformanceNotes(e.target.value)}
              placeholder="Fidelity observations, strengths demonstrated, areas for development…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* Clinical decisions made */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Clinical Decisions Made</label>
            <textarea
              value={clinicalDecisions}
              onChange={e => setClinicalDecisions(e.target.value)}
              placeholder="What clinical decisions did you make during this contact and why?…"
              className="w-full border rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 80 }}
            />
          </div>

          {/* Next steps (internal use only — not sent to AI) */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
              Next Steps <span className="font-normal" style={{ color: "var(--text3)" }}>(internal reference only — not included in generated note)</span>
            </label>
            <textarea
              value={nextSteps}
              onChange={e => setNextSteps(e.target.value)}
              placeholder="Your own notes for the next supervision contact…"
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
            {generating ? "Generating…" : "Generate Supervision Note"}
          </button>
          {!canGenerate && !generating && (
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>
              Date, at least one behavior, and a protocol modification are required.
            </p>
          )}
        </div>

        {/* Output */}
        {generatedNote && (
          <div className="mt-5 bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Generated Supervision Note (97155)</p>
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
