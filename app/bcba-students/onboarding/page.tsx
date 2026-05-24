"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2;

export default function BCBAStudentsOnboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [certTrack, setCertTrack] = useState<"BCBA" | "BCaBA" | "">("");
  const [fieldworkType, setFieldworkType] = useState<"concentrated" | "supervised" | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleFinish() {
    if (!certTrack || !fieldworkType) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/bcba-students/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ certificationTrack: certTrack, fieldworkType }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Something went wrong"); setSaving(false); return; }
    router.push("/bcba-students");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div className="w-full max-w-sm">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {([1, 2] as const).map(s => (
            <div
              key={s}
              className="w-2 h-2 rounded-full transition-colors"
              style={{ background: step >= s ? "var(--teal)" : "var(--border)" }}
            />
          ))}
        </div>

        <div className="bg-white rounded-2xl p-8" style={{ border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(13,43,78,0.08)" }}>
          {step === 1 && (
            <>
              <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--text3)" }}>Step 1 of 2</p>
              <h2 className="text-[20px] font-semibold mb-2" style={{ color: "var(--text1)" }}>What are you working toward?</h2>
              <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>
                This determines your total hours requirement and supervision rules.
              </p>
              <div className="space-y-3 mb-6">
                {(["BCBA", "BCaBA"] as const).map(track => (
                  <label
                    key={track}
                    className="flex items-center gap-3 p-4 rounded-xl cursor-pointer border transition-colors"
                    style={{
                      borderColor: certTrack === track ? "var(--teal)" : "var(--border)",
                      background: certTrack === track ? "rgba(27,168,160,0.05)" : "white",
                    }}
                  >
                    <input
                      type="radio"
                      name="certTrack"
                      value={track}
                      checked={certTrack === track}
                      onChange={() => setCertTrack(track)}
                      className="accent-teal-500"
                    />
                    <span className="text-[14px] font-medium" style={{ color: "var(--text1)" }}>{track}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => setStep(2)}
                disabled={!certTrack}
                className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--teal)" }}
              >
                Continue
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--text3)" }}>Step 2 of 2</p>
              <h2 className="text-[20px] font-semibold mb-2" style={{ color: "var(--text1)" }}>Which type of fieldwork?</h2>
              <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>Choose the fieldwork category your supervisor approved.</p>
              <div className="space-y-3 mb-6">
                <label
                  className="flex items-start gap-3 p-4 rounded-xl cursor-pointer border transition-colors"
                  style={{
                    borderColor: fieldworkType === "concentrated" ? "var(--teal)" : "var(--border)",
                    background: fieldworkType === "concentrated" ? "rgba(27,168,160,0.05)" : "white",
                  }}
                >
                  <input
                    type="radio"
                    name="fieldworkType"
                    value="concentrated"
                    checked={fieldworkType === "concentrated"}
                    onChange={() => setFieldworkType("concentrated")}
                    className="accent-teal-500 mt-0.5 flex-shrink-0"
                  />
                  <div>
                    <p className="text-[14px] font-medium" style={{ color: "var(--text1)" }}>Concentrated Supervised Fieldwork</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>1,500 hours · ≥10% supervision/month</p>
                  </div>
                </label>
                <label
                  className="flex items-start gap-3 p-4 rounded-xl cursor-pointer border transition-colors"
                  style={{
                    borderColor: fieldworkType === "supervised" ? "var(--teal)" : "var(--border)",
                    background: fieldworkType === "supervised" ? "rgba(27,168,160,0.05)" : "white",
                  }}
                >
                  <input
                    type="radio"
                    name="fieldworkType"
                    value="supervised"
                    checked={fieldworkType === "supervised"}
                    onChange={() => setFieldworkType("supervised")}
                    className="accent-teal-500 mt-0.5 flex-shrink-0"
                  />
                  <div>
                    <p className="text-[14px] font-medium" style={{ color: "var(--text1)" }}>Supervised Fieldwork</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>2,000 hours · ≥5% supervision/month</p>
                  </div>
                </label>
              </div>

              {error && (
                <p className="text-[13px] px-4 py-3 rounded-xl mb-4 border text-center" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 rounded-xl text-[14px] font-medium border transition-opacity hover:opacity-80"
                  style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                >
                  Back
                </button>
                <button
                  onClick={handleFinish}
                  disabled={!fieldworkType || saving}
                  className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "var(--teal)" }}
                >
                  {saving ? "Saving…" : "Get Started"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
