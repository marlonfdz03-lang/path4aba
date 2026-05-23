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

  async function handleSelectPlan(planKey: string) {
    setLoadingPlan(planKey);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    await fetch("/api/create-trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, plan: planKey }),
    });

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
        <p className="text-[12px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--teal)" }}>Step 2 of 2</p>
        <h1 className="text-[28px] font-semibold leading-tight mb-3" style={{ color: "var(--text1)" }}>
          Choose your plan
        </h1>
        <p className="text-[15px] max-w-sm mx-auto" style={{ color: "var(--text3)" }}>
          14-day free trial — no credit card required. Cancel any time.
        </p>
      </div>

      {/* Plan cards */}
      <div className="flex flex-col lg:flex-row gap-5 justify-center px-6 pb-16 max-w-5xl mx-auto w-full">
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
                </p>
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
    </div>
  );
}
