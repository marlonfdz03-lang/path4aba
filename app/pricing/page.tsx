"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PLANS = [
  {
    key: "rbt" as const,
    name: "RBT",
    monthlyPrice: 14.99,
    yearlyPrice: 149,
    description: "Built for Registered Behavior Technicians running daily sessions.",
    features: [
      "Unlimited session note generation",
      "Note refinement with AI",
      "Up to 10 client profiles",
      "Schedule tracker",
      "14-day free trial",
    ],
  },
  {
    key: "bcba" as const,
    name: "BCBA / BCaBA",
    monthlyPrice: 29.99,
    yearlyPrice: 299,
    description: "Everything an analyst needs to supervise, plan, and document.",
    features: [
      "Everything in RBT",
      "Unlimited client profiles",
      "Assessment PDF upload & parsing",
      "Priority support",
      "14-day free trial",
    ],
    highlighted: true,
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  function yearlySavings(plan: (typeof PLANS)[number]) {
    const monthlyCost = plan.monthlyPrice * 12;
    return Math.round(monthlyCost - plan.yearlyPrice);
  }

  async function handleStart(plan: "rbt" | "bcba") {
    setLoadingPlan(plan);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval, userId: user.id }),
      });
      const { url, error } = await res.json();
      if (error || !url) throw new Error(error || "No checkout URL returned");
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
          <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
            <defs>
              <linearGradient id="p-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1BA8A0" /><stop offset="1" stopColor="#4AB5E3" />
              </linearGradient>
            </defs>
            <rect width="36" height="36" rx="9" fill="url(#p-grad)" />
            <path d="M18 27s-9-5.8-9-12.5A6 6 0 0 1 18 9.5a6 6 0 0 1 9 5c0 6.7-9 12.5-9 12.5z" fill="white" fillOpacity="0.9" />
            <circle cx="14.5" cy="16" r="1.8" fill="url(#p-grad)" />
            <circle cx="21.5" cy="19" r="1.8" fill="url(#p-grad)" />
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
      <div className="text-center py-14 px-6">
        <p className="text-[12px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--teal)" }}>Pricing</p>
        <h1 className="text-[34px] font-semibold leading-tight mb-3" style={{ color: "var(--text1)" }}>
          Simple, transparent pricing
        </h1>
        <p className="text-[15px] max-w-sm mx-auto" style={{ color: "var(--text3)" }}>
          Start free for 14 days — no credit card required. Cancel any time.
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
                  style={{ background: interval === "year" ? "rgba(255,255,255,0.2)" : "var(--teal-light)", color: interval === "year" ? "white" : "var(--teal)" }}
                >
                  SAVE
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="flex flex-col sm:flex-row gap-6 justify-center px-6 pb-16 max-w-3xl mx-auto w-full">
        {PLANS.map((plan) => {
          const price = interval === "month" ? plan.monthlyPrice : plan.yearlyPrice;
          const savings = yearlySavings(plan);
          const isHighlighted = plan.highlighted;
          const loading = loadingPlan === plan.key;

          return (
            <div
              key={plan.key}
              className="flex-1 rounded-2xl overflow-hidden flex flex-col"
              style={{
                background: isHighlighted ? "var(--navy)" : "white",
                border: isHighlighted ? "none" : "1px solid var(--border)",
                boxShadow: isHighlighted ? "0 20px 60px rgba(13,43,78,0.25)" : "0 1px 4px rgba(0,0,0,0.06)",
              }}
            >
              {/* Gradient top bar */}
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />

              <div className="p-7 flex flex-col flex-1">
                {/* Plan name */}
                <p
                  className="text-[12px] uppercase tracking-widest font-semibold mb-1"
                  style={{ color: isHighlighted ? "rgba(255,255,255,0.55)" : "var(--text3)" }}
                >
                  {plan.name}
                </p>
                <p
                  className="text-[13.5px] mb-6"
                  style={{ color: isHighlighted ? "rgba(255,255,255,0.7)" : "var(--text3)" }}
                >
                  {plan.description}
                </p>

                {/* Price */}
                <div className="mb-1 flex items-end gap-1">
                  <span
                    className="text-[44px] font-semibold leading-none"
                    style={{ color: isHighlighted ? "white" : "var(--text1)" }}
                  >
                    ${price}
                  </span>
                  <span
                    className="text-[13px] mb-1.5"
                    style={{ color: isHighlighted ? "rgba(255,255,255,0.5)" : "var(--text3)" }}
                  >
                    /{interval === "month" ? "mo" : "yr"}
                  </span>
                </div>

                {interval === "year" && (
                  <p
                    className="text-[12px] font-medium mb-6"
                    style={{ color: isHighlighted ? "rgba(27,168,160,0.9)" : "var(--teal)" }}
                  >
                    Save ${savings}/year vs monthly
                  </p>
                )}
                {interval === "month" && <div className="mb-6" />}

                {/* CTA */}
                <button
                  onClick={() => handleStart(plan.key)}
                  disabled={!!loadingPlan}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed mb-6"
                  style={{
                    background: isHighlighted ? "var(--teal)" : "var(--navy)",
                    color: "white",
                  }}
                >
                  {loading ? "Redirecting…" : "Start Free Trial"}
                </button>

                <p
                  className="text-[11.5px] text-center mb-6"
                  style={{ color: isHighlighted ? "rgba(255,255,255,0.4)" : "var(--text3)" }}
                >
                  14 days free · No credit card required
                </p>

                {/* Divider */}
                <div
                  className="h-px mb-6"
                  style={{ background: isHighlighted ? "rgba(255,255,255,0.1)" : "var(--border)" }}
                />

                {/* Features */}
                <ul className="space-y-3 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>{CHECK_ICON}</span>
                      <span
                        className="text-[13.5px]"
                        style={{ color: isHighlighted ? "rgba(255,255,255,0.75)" : "var(--text2)" }}
                      >
                        {f}
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
        Questions? Email{" "}
        <a href="mailto:support@path4aba.com" className="hover:underline" style={{ color: "var(--teal)" }}>
          support@path4aba.com
        </a>
      </p>
    </div>
  );
}
