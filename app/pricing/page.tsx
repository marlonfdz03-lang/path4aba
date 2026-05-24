"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { PlanKey } from "@/lib/stripe";

const CHECK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SOON_BADGE = (
  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: "rgba(27,168,160,0.15)", color: "var(--teal)" }}>
    Soon
  </span>
);

type Plan = {
  key: PlanKey;
  name: string;
  subtitle: string;
  monthlyPrice: number;
  yearlyPrice: number;
  highlighted?: boolean;
  badge?: string;
  features: Array<{ label: string; soon?: boolean }>;
};

const PLANS: Plan[] = [
  {
    key: "rbt",
    name: "RBT",
    subtitle: "For Registered Behavior Technicians running daily sessions.",
    monthlyPrice: 14.99,
    yearlyPrice: 149,
    features: [
      { label: "Generate unlimited session notes" },
      { label: "Up to 3 client profiles" },
      { label: "Note refinement with AI" },
      { label: "Schedule tracker" },
      { label: "7-day free trial" },
    ],
  },
  {
    key: "bcba_starter",
    name: "BCBA / BCaBA Starter",
    subtitle: "For analysts supervising a growing caseload.",
    monthlyPrice: 29.99,
    yearlyPrice: 299,
    highlighted: true,
    badge: "Most Popular",
    features: [
      { label: "Everything in RBT" },
      { label: "Up to 15 client profiles" },
      { label: "Assessment PDF upload & parsing" },
      { label: "Priority support" },
      { label: "7-day free trial" },
    ],
  },
  {
    key: "bcba_pro",
    name: "BCBA / BCaBA Pro",
    subtitle: "For analysts running a full practice with no limits.",
    monthlyPrice: 39.99,
    yearlyPrice: 399,
    features: [
      { label: "Everything in Starter" },
      { label: "Unlimited client profiles" },
      { label: "Reassessment tools", soon: true },
      { label: "Multi-RBT management", soon: true },
      { label: "7-day free trial" },
    ],
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  function yearlySavings(plan: Plan) {
    return Math.round(plan.monthlyPrice * 12 - plan.yearlyPrice);
  }

  async function handleStart(planKey: PlanKey) {
    setLoadingPlan(planKey);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey, interval, userId: user.id }),
      });
      const { url, error } = await res.json();
      if (error || !url) throw new Error(error || "No checkout URL");
      window.location.href = url;
    } catch (err) {
      console.error("Checkout error:", err);
      setLoadingPlan(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-8 h-16 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 28C16 28 4 21 4 12.5C4 8.9 6.9 6 10.5 6C12.8 6 14.8 7.2 16 9C17.2 7.2 19.2 6 21.5 6C25.1 6 28 8.9 28 12.5C28 21 16 28 16 28Z" fill="url(#pricingPuzzleGrad)"/>
            <path d="M16 6V28M4 17H28" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8"/>
            <circle cx="16" cy="13" r="2" fill="rgba(255,255,255,0.6)"/>
            <circle cx="11" cy="19" r="1.5" fill="rgba(255,255,255,0.4)"/>
            <circle cx="21" cy="19" r="1.5" fill="rgba(255,255,255,0.4)"/>
            <defs>
              <linearGradient id="pricingPuzzleGrad" x1="4" y1="6" x2="28" y2="28">
                <stop offset="0%" stopColor="#1BA8A0"/>
                <stop offset="100%" stopColor="#4AB5E3"/>
              </linearGradient>
            </defs>
          </svg>
          <span className="text-[17px] font-semibold">
            <span style={{ color: "var(--text1)" }}>Path</span>
            <span style={{ color: "var(--teal)" }}>4</span>
            <span style={{ color: "var(--text1)" }}>ABA</span>
          </span>
        </div>
        <a href="/login" className="text-sm font-medium hover:underline" style={{ color: "var(--teal)" }}>
          Sign in
        </a>
      </div>

      {/* Hero */}
      <div className="text-center py-12 px-6">
        <p className="text-[12px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--teal)" }}>Pricing</p>
        <h1 className="text-[32px] font-semibold leading-tight mb-3" style={{ color: "var(--text1)" }}>
          Simple, transparent pricing
        </h1>
        <p className="text-[15px] max-w-sm mx-auto" style={{ color: "var(--text3)" }}>
          Start free for 7 days — no credit card required. Cancel any time.
        </p>

        {/* Interval toggle */}
        <div className="inline-flex items-center mt-8 p-1 rounded-full border bg-white" style={{ borderColor: "var(--border)" }}>
          {(["month", "year"] as const).map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className="px-5 py-2 rounded-full text-[13px] font-semibold transition-colors"
              style={{
                background: interval === iv ? "var(--navy)" : "transparent",
                color: interval === iv ? "white" : "var(--text2)",
              }}
            >
              {iv === "month" ? "Monthly" : "Annual"}
              {iv === "year" && (
                <span
                  className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: interval === "year" ? "rgba(255,255,255,0.2)" : "var(--teal-light)",
                    color: interval === "year" ? "white" : "var(--teal)",
                  }}
                >
                  SAVE
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards — 3 up */}
      <div className="flex flex-col lg:flex-row gap-5 justify-center px-6 pb-16 max-w-5xl mx-auto w-full">
        {PLANS.map((plan) => {
          const price = interval === "month" ? plan.monthlyPrice : plan.yearlyPrice;
          const savings = yearlySavings(plan);
          const isHighlighted = !!plan.highlighted;
          const loading = loadingPlan === plan.key;

          return (
            <div
              key={plan.key}
              className="flex-1 rounded-2xl overflow-hidden flex flex-col relative"
              style={{
                background: isHighlighted ? "var(--navy)" : "white",
                border: isHighlighted ? "none" : "1px solid var(--border)",
                boxShadow: isHighlighted
                  ? "0 20px 60px rgba(13,43,78,0.22)"
                  : "0 1px 4px rgba(0,0,0,0.05)",
              }}
            >
              {/* Gradient top bar */}
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />

              {/* Most Popular badge */}
              {plan.badge && (
                <div className="absolute top-5 right-5">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(27,168,160,0.22)", color: "#24BDB4" }}
                  >
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="p-7 flex flex-col flex-1">
                <p
                  className="text-[11px] uppercase tracking-widest font-semibold mb-1"
                  style={{ color: isHighlighted ? "rgba(255,255,255,0.5)" : "var(--text3)" }}
                >
                  {plan.name}
                </p>
                <p
                  className="text-[13px] mb-6 leading-relaxed"
                  style={{ color: isHighlighted ? "rgba(255,255,255,0.65)" : "var(--text3)" }}
                >
                  {plan.subtitle}
                </p>

                {/* Price */}
                <div className="flex items-end gap-1 mb-1">
                  <span
                    className="text-[42px] font-semibold leading-none"
                    style={{ color: isHighlighted ? "white" : "var(--text1)" }}
                  >
                    ${price}
                  </span>
                  <span
                    className="text-[13px] mb-1.5"
                    style={{ color: isHighlighted ? "rgba(255,255,255,0.45)" : "var(--text3)" }}
                  >
                    /{interval === "month" ? "mo" : "yr"}
                  </span>
                </div>

                <div className="mb-6 h-5">
                  {interval === "year" && (
                    <p className="text-[12px] font-medium" style={{ color: isHighlighted ? "rgba(27,168,160,0.9)" : "var(--teal)" }}>
                      Save ${savings}/year vs monthly
                    </p>
                  )}
                </div>

                {/* CTA */}
                <button
                  onClick={() => handleStart(plan.key)}
                  disabled={!!loadingPlan}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed mb-3"
                  style={{
                    background: isHighlighted ? "var(--teal)" : "var(--navy)",
                    color: "white",
                  }}
                >
                  {loading ? "Redirecting…" : "Start Free Trial"}
                </button>

                <p
                  className="text-[11px] text-center mb-6"
                  style={{ color: isHighlighted ? "rgba(255,255,255,0.35)" : "var(--text3)" }}
                >
                  7 days free · No credit card required
                </p>

                <div
                  className="h-px mb-5"
                  style={{ background: isHighlighted ? "rgba(255,255,255,0.1)" : "var(--border)" }}
                />

                {/* Features */}
                <ul className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f.label} className="flex items-start gap-2.5">
                      <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>{CHECK_ICON}</span>
                      <span
                        className="text-[13px]"
                        style={{ color: isHighlighted ? "rgba(255,255,255,0.75)" : "var(--text2)" }}
                      >
                        {f.label}{f.soon ? SOON_BADGE : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="text-center text-[12px] pb-12" style={{ color: "var(--text3)" }}>
        Questions?{" "}
        <a href="mailto:support@path4aba.com" className="hover:underline" style={{ color: "var(--teal)" }}>
          support@path4aba.com
        </a>
      </p>
    </div>
  );
}
