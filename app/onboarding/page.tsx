"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const CHECK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

type Plan = {
  key: string;
  name: string;
  subtitle: string;
  price: string;
  highlighted?: boolean;
  badge?: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    key: "rbt",
    name: "RBT",
    subtitle: "For Registered Behavior Technicians running daily sessions.",
    price: "$14.99/mo",
    features: ["Unlimited session notes", "Up to 3 client profiles", "Note refinement with AI", "Schedule tracker"],
  },
  {
    key: "bcba_starter",
    name: "BCBA / BCaBA Starter",
    subtitle: "For analysts supervising a growing caseload.",
    price: "$29.99/mo",
    highlighted: true,
    badge: "Most Popular",
    features: ["Everything in RBT", "Up to 15 client profiles", "Assessment PDF upload & parsing", "Priority support"],
  },
  {
    key: "bcba_pro",
    name: "BCBA / BCaBA Pro",
    subtitle: "For analysts running a full practice with no limits.",
    price: "$39.99/mo",
    features: ["Everything in Starter", "Unlimited client profiles", "Reassessment tools (soon)", "Multi-RBT management (soon)"],
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState("");

  const [promoInput, setPromoInput] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError] = useState("");

  async function handleApplyPromo() {
    if (!promoInput.trim()) return;
    setPromoLoading(true);
    setPromoError("");
    setPromoApplied(false);

    const res = await fetch("/api/validate-promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: promoInput }),
    });
    const { valid, error } = await res.json();
    setPromoLoading(false);

    if (valid) {
      setPromoApplied(true);
    } else {
      setPromoError(error || "Invalid promo code");
    }
  }

  async function handleSelectPlan(planKey: string) {
    setLoadingPlan(planKey);
    setPlanError("");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const timeout = new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 10000)
    );

    try {
      const res = await Promise.race([
        fetch("/api/create-trial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            plan: planKey,
            promoCode: promoApplied ? promoInput.toUpperCase().trim() : undefined,
          }),
        }),
        timeout,
      ]);

      const data = await (res as Response).json();
      if (!data.ok) {
        setPlanError(data.error || "Something went wrong, please try again.");
        setLoadingPlan(null);
        return;
      }
    } catch (err) {
      const msg = err instanceof Error && err.message === "timeout"
        ? "Something went wrong, please try again."
        : "Network error, please try again.";
      setPlanError(msg);
      setLoadingPlan(null);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* Header */}
      <div className="flex items-center justify-center px-8 h-16 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-[18px] font-semibold">
          <span style={{ color: "var(--text1)" }}>Path</span>
          <span style={{ color: "var(--teal)" }}>4</span>
          <span style={{ color: "var(--text1)" }}>ABA</span>
        </span>
      </div>

      {/* Hero */}
      <div className="text-center py-10 px-6">
        <h1 className="text-[28px] font-semibold leading-tight mb-3" style={{ color: "var(--text1)" }}>
          Choose your plan
        </h1>
        <p className="text-[15px] max-w-sm mx-auto" style={{ color: "var(--text3)" }}>
          14-day free trial — no credit card required. Cancel any time.
        </p>
      </div>

      {/* Plan error */}
      {planError && (
        <div className="max-w-xl mx-auto px-6 mb-2 w-full">
          <p className="text-[13px] rounded-xl px-4 py-3 border text-center" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
            {planError}
          </p>
        </div>
      )}

      {/* Plan cards */}
      <div className="flex flex-col lg:flex-row gap-5 justify-center px-6 pb-8 max-w-5xl mx-auto w-full">
        {PLANS.map((plan) => {
          const isHighlighted = !!plan.highlighted;
          const loading = loadingPlan === plan.key;

          return (
            <div
              key={plan.key}
              className="flex-1 rounded-2xl overflow-hidden flex flex-col"
              style={{
                background: isHighlighted ? "var(--navy)" : "white",
                border: isHighlighted ? "none" : "1px solid var(--border)",
                boxShadow: isHighlighted ? "0 20px 60px rgba(13,43,78,0.22)" : "0 1px 4px rgba(0,0,0,0.05)",
              }}
            >
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />

              {plan.badge && (
                <div className="flex justify-end px-7 pt-5">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: "rgba(27,168,160,0.22)", color: "#24BDB4" }}>
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="p-7 flex flex-col flex-1">
                <p className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: isHighlighted ? "rgba(255,255,255,0.5)" : "var(--text3)" }}>
                  {plan.name}
                </p>
                <p className="text-[13px] mb-5 leading-relaxed" style={{ color: isHighlighted ? "rgba(255,255,255,0.65)" : "var(--text3)" }}>
                  {plan.subtitle}
                </p>

                <p className="text-[28px] font-semibold mb-1" style={{ color: isHighlighted ? "white" : "var(--text1)" }}>
                  {plan.price}
                  {promoApplied && <span className="text-[16px] ml-2 line-through opacity-50">${plan.price}</span>}
                </p>
                {promoApplied && (
                  <p className="text-[13px] font-medium mb-1" style={{ color: "#1BA8A0" }}>$5 off every month, forever</p>
                )}
                <p className="text-[12px] mb-6" style={{ color: isHighlighted ? "rgba(255,255,255,0.4)" : "var(--text3)" }}>
                  after free trial
                </p>

                <button
                  onClick={() => handleSelectPlan(plan.key)}
                  disabled={!!loadingPlan}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed mb-3"
                  style={{ background: isHighlighted ? "var(--teal)" : "var(--navy)", color: "white" }}
                >
                  {loading ? "Starting trial…" : "Start Free Trial"}
                </button>

                <p className="text-[11px] text-center mb-6" style={{ color: isHighlighted ? "rgba(255,255,255,0.35)" : "var(--text3)" }}>
                  14 days free · No credit card required
                </p>

                <div className="h-px mb-5" style={{ background: isHighlighted ? "rgba(255,255,255,0.1)" : "var(--border)" }} />

                <ul className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>{CHECK_ICON}</span>
                      <span className="text-[13px]" style={{ color: isHighlighted ? "rgba(255,255,255,0.75)" : "var(--text2)" }}>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* Promo code */}
      <div className="flex justify-center pb-16 px-6">
        <div className="w-full max-w-sm">
          <p className="text-[13px] font-medium mb-2 text-center" style={{ color: "var(--text3)" }}>Have a promo code?</p>

          {promoApplied ? (
            <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold" style={{ background: "#E6F9F5", border: "1px solid #A7F3D0", color: "#065F46" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Code applied! $5 off every month while your subscription is active
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoInput}
                  onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(""); }}
                  placeholder="e.g. PATH5"
                  className="flex-1 border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-colors uppercase"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleApplyPromo(); } }}
                />
                <button
                  type="button"
                  onClick={handleApplyPromo}
                  disabled={promoLoading || !promoInput.trim()}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "var(--navy)" }}
                >
                  {promoLoading ? "…" : "Apply"}
                </button>
              </div>
              {promoError && (
                <p className="text-[12px] mt-2 text-center" style={{ color: "#DC2626" }}>{promoError}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
