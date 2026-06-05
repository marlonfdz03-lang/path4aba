"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { buildClinicalProfile } from "@/lib/buildClinicalProfile";

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-[12px] uppercase tracking-widest font-semibold" style={{ color: "var(--text3)" }}>{title}</p>
      {count !== undefined && (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>
          {count}
        </span>
      )}
    </div>
  );
}

function UploadAssessmentContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientIdFromUrl = searchParams.get("clientId") || "";

  const [selectedClientId, setSelectedClientId] = useState(clientIdFromUrl);
  const [clients, setClients] = useState<any[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractedProfile, setExtractedProfile] = useState<any>(null);
  const [extractError, setExtractError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }
    const role = (session.user as any)?.role;
    if (role && role !== "bcba") { router.push("/"); return; }
    if (!clientIdFromUrl) loadClients();
  }, [status, session]);

  async function loadClients() {
    setLoadingClients(true);
    try {
      const res = await fetch("/api/bcba/clients");
      if (res.ok) {
        const json = await res.json();
        setClients(Array.isArray(json.clients) ? json.clients : []);
      }
    } catch {}
    finally { setLoadingClients(false); }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setPdfFile(file);
    setExtractedProfile(null);
    setExtractError("");
    setSaveSuccess(false);
    setSaveError("");
  }

  async function handleExtract() {
    if (!pdfFile) return;
    setExtracting(true);
    setExtractError("");
    setExtractedProfile(null);

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      const res = await fetch("/api/extract-assessment", {
        method: "POST",
        body: formData,
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        setExtractError("Server returned invalid response.");
        return;
      }
      if (!res.ok) {
        setExtractError(data?.details || data?.error || "Extraction failed.");
        return;
      }
      const profile = buildClinicalProfile(data);
      setExtractedProfile(profile);
    } catch {
      setExtractError("Network error. Please try again.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (!selectedClientId || !extractedProfile) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/bcba/client/${selectedClientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicalProfile: extractedProfile }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error || "Failed to save. Please try again.");
        return;
      }
      setSaveSuccess(true);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const behaviors = extractedProfile?.maladaptiveBehaviors || [];
  const replacements = extractedProfile?.replacementBehaviors || [];
  const skills = extractedProfile?.skillAcquisition || [];
  const reinforcers = extractedProfile?.reinforcers || [];
  const diagnosis = extractedProfile?.diagnosis || [];
  const ptGoals = extractedProfile?.parentTrainingGoals || [];

  if (status === "loading") return null;

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* Topbar */}
      <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link href="/bcba" className="hover:underline" style={{ color: "var(--text3)" }}>My Clients</Link>
        {selectedClientId && (
          <>
            <span style={{ color: "var(--border2)" }}>/</span>
            <Link href={`/bcba/${selectedClientId}`} className="hover:underline" style={{ color: "var(--text3)" }}>Client</Link>
          </>
        )}
        <span style={{ color: "var(--border2)" }}>/</span>
        <span className="font-medium" style={{ color: "var(--text1)" }}>Upload Assessment</span>
      </div>

      <div className="px-8 py-6 max-w-3xl">

        {saveSuccess ? (
          <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
            <p className="text-[15px] font-semibold mb-2" style={{ color: "#16A34A" }}>Assessment saved successfully</p>
            <p className="text-[13px] mb-4" style={{ color: "var(--text2)" }}>
              Assessment saved to client profile. Parent training goals and clinical data are now available in the 97156 form.
            </p>
            <Link
              href={`/bcba/${selectedClientId}`}
              className="text-[13px] font-semibold hover:underline"
              style={{ color: "var(--teal)" }}
            >
              ← Back to Client
            </Link>
          </div>
        ) : (
          <div className="space-y-5">

            {/* Step 1: Select client */}
            <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
              <p className="text-[15px] font-semibold mb-4" style={{ color: "var(--text1)" }}>Upload / Update Assessment (97156 Profile)</p>

              {!clientIdFromUrl && (
                <div className="mb-5">
                  <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                    Select Client <span style={{ color: "#DC2626" }}>*</span>
                  </label>
                  {loadingClients ? (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading clients…</p>
                  ) : (
                    <select
                      value={selectedClientId}
                      onChange={e => setSelectedClientId(e.target.value)}
                      className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: selectedClientId ? "var(--text1)" : "var(--text3)" }}
                    >
                      <option value="">Select a client…</option>
                      {clients.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.client_name || c.internal_code || c.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Step 2: Upload PDF */}
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>
                  ABA Assessment PDF <span style={{ color: "#DC2626" }}>*</span>
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="w-full text-[13px]"
                  style={{ color: "var(--text1)" }}
                />
                {pdfFile && (
                  <p className="mt-1.5 text-[12px]" style={{ color: "var(--text3)" }}>{pdfFile.name}</p>
                )}
              </div>

              {extractError && (
                <p className="mt-3 text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                  {extractError}
                </p>
              )}

              <button
                onClick={handleExtract}
                disabled={!pdfFile || !selectedClientId || extracting}
                className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--teal)" }}
              >
                {extracting ? "Extracting…" : "Extract Assessment"}
              </button>
            </div>

            {/* Step 3: Preview extracted profile */}
            {extractedProfile && (
              <div className="bg-white rounded-xl border p-6 space-y-6" style={{ borderColor: "var(--border)" }}>
                <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>Extracted Clinical Profile — Review Before Saving</p>

                {/* Diagnosis */}
                {diagnosis.length > 0 && (
                  <div>
                    <SectionHeader title="Diagnosis" count={diagnosis.length} />
                    <div className="flex flex-wrap gap-2">
                      {diagnosis.map((d: string, i: number) => (
                        <span key={i} className="text-[12px] px-2.5 py-1 rounded-full font-medium" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>{d}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Maladaptive Behaviors */}
                <div>
                  <SectionHeader title="Maladaptive Behaviors" count={behaviors.length} />
                  {behaviors.length === 0 ? (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>None extracted.</p>
                  ) : (
                    <div className="space-y-2">
                      {behaviors.map((b: any, i: number) => (
                        <div key={i} className="px-3 py-2 rounded-lg" style={{ background: "#FEF3E2", border: "1px solid #F6AD5580" }}>
                          <p className="text-[13px] font-semibold" style={{ color: "#92400E" }}>
                            {typeof b === "string" ? b : b?.name}
                          </p>
                          {typeof b === "object" && b?.topographies?.[0] && (
                            <p className="text-[12px]" style={{ color: "#B7791F" }}>{b.topographies[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Replacement Behaviors + Skills */}
                <div>
                  <SectionHeader title="Replacement Behaviors &amp; Skills" count={replacements.length + skills.length} />
                  {replacements.length === 0 && skills.length === 0 ? (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>None extracted.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {[...replacements, ...skills].map((s: any, i: number) => (
                        <span key={i} className="text-[12px] px-2.5 py-1 rounded-full font-medium" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                          {typeof s === "string" ? s : s?.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reinforcers */}
                <div>
                  <SectionHeader title="Reinforcers" count={reinforcers.length} />
                  {reinforcers.length === 0 ? (
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>None extracted.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {reinforcers.map((r: string, i: number) => (
                        <span key={i} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>{r}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Parent Training Goals — highlighted */}
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--teal)", background: "var(--teal-light)" }}>
                  <SectionHeader title="Parent Training Goals (97156)" count={ptGoals.length} />
                  {ptGoals.length === 0 ? (
                    <p className="text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
                      No parent training goals were extracted. You can still save the assessment, but 97156 will not auto-fill goals until they are added to the client profile.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {ptGoals.map((g: string, i: number) => (
                        <p key={i} className="text-[13px]" style={{ color: "var(--text1)" }}>• {g}</p>
                      ))}
                    </div>
                  )}
                </div>

                {saveError && (
                  <p className="text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                    {saveError}
                  </p>
                )}

                <button
                  onClick={handleSave}
                  disabled={saving || !extractedProfile}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "var(--teal)" }}
                >
                  {saving ? "Saving…" : "Save Assessment to Client Profile"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function UploadAssessmentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading...</p>
      </div>
    }>
      <UploadAssessmentContent />
    </Suspense>
  );
}
