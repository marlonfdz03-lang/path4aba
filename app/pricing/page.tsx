"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { PlanKey } from "@/lib/stripe";

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

type Plan = {
  key: PlanKey;
  name: string;
  subtitle: string;
  monthlyPrice: number;
  yearlyPrice: number;
  clientLimit: string;
  highlighted?: boolean;
  badge?: string;
  features: string[];
};

const RBT_PLANS: Plan[] = [
  {
    key: "rbt_1",
    name: "RBT — 1 Client",
    subtitle: "For RBTs working with a single client.",
    monthlyPrice: 14.99,
    yearlyPrice: 149,
    clientLimit: "1 client",
    features: [
      "1 client profile",
      "Unlimited session notes",
      "AI note generation",
      "Note refinement",
      "Schedule tracker",
      "7-day free trial",
    ],
  },
  {
    key: "rbt_2",
    name: "RBT — 2 Clients",
    subtitle: "For RBTs managing a small caseload.",
    monthlyPrice: 19.99,
    yearlyPrice: 199,
    clientLimit: "2 clients",
    highlighted: true,
    badge: "Most Popular",
    features: [
      "2 client profiles",
      "Unlimited session notes",
      "AI note generation",
      "Note refinement",
      "Schedule tracker",
      "7-day free trial",
    ],
  },
];

const BCBA_PLANS: Plan[] = [
  {
    key: "bcba_starter",
    name: "BCBA / BCaBA Starter",
    subtitle: "For analysts supervising a growing caseload.",
    monthlyPrice: 29.99,
    yearlyPrice: 299,
    clientLimit: "Up to 15 clients",
    features: [
      "Up to 15 client profiles",
      "Clinical profile management",
      "BCBA dashboard",
      "Priority support",
      "7-day free trial",
    ],
  },
  {
    key: "bcba_pro",
    name: "BCBA / BCaBA Pro",
    subtitle: "For analysts running a full practice.",
    monthlyPrice: 39.99,
    yearlyPrice: 399,
    clientLimit: "Unlimited clients",
    highlighted: true,
    badge: "Best Value",
    features: [
      "Unlimited client profiles",
      "Everything in Starter",
      "Protocol reassessment tools",
      "Multi-RBT management",
      "7-day free trial",
    ],
  },
];

function PlanCard({
  plan,
  interval,
  onStart,
  loading,
}: {
  plan: Plan;
  interval: "month" | "year";
  onStart: () => void;
  loading: boolean;
}) {
  const price = interval === "month" ? plan.monthlyPrice : plan.yearlyPrice;
  const savings = Math.round(plan.monthlyPrice * 12 - plan.yearlyPrice);
  const hl = !!plan.highlighted;

  return (
    <div
      className="flex-1 rounded-2xl overflow-hidden flex flex-col relative"
      style={{
        background: hl ? "var(--navy)" : "white",
        border: hl ? "none" : "1px solid var(--border)",
        boxShadow: hl ? "0 20px 60px rgba(13,43,78,0.22)" : "0 1px 4px rgba(0,0,0,0.05)",
      }}
    >
      <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
      {plan.badge && (
        <div className="absolute top-5 right-5">
          <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: "rgba(27,168,160,0.22)", color: "#24BDB4" }}>
            {plan.badge}
          </span>
        </div>
      )}
      <div className="p-7 flex flex-col flex-1">
        <p className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: hl ? "rgba(255,255,255,0.45)" : "var(--text3)" }}>
          {plan.name}
        </p>
        <p className="text-[13px] mb-5 leading-relaxed" style={{ color: hl ? "rgba(255,255,255,0.6)" : "var(--text3)" }}>
          {plan.subtitle}
        </p>
        <div className="flex items-end gap-1 mb-1">
          <span className="text-[38px] font-semibold leading-none" style={{ color: hl ? "white" : "var(--text1)" }}>
            ${price}
          </span>
          <span className="text-[13px] mb-1.5" style={{ color: hl ? "rgba(255,255,255,0.4)" : "var(--text3)" }}>
            /{interval === "month" ? "mo" : "yr"}
          </span>
        </div>
        <div className="mb-5 h-5">
          {interval === "year" && (
            <p className="text-[12px] font-medium" style={{ color: hl ? "rgba(27,168,160,0.9)" : "var(--teal)" }}>
              Save ${savings}/year vs monthly
            </p>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full mb-5 self-start"
          style={{ background: hl ? "rgba(27,168,160,0.2)" : "var(--teal-light, #E6F9F5)", color: "var(--teal)" }}>
          {plan.clientLimit}
        </span>
        <button
          onClick={onStart}
          disabled={loading}
          className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed mb-3"
          style={{ background: hl ? "var(--teal)" : "var(--navy)" }}
        >
          {loading ? "Redirecting…" : "Start Free Trial"}
        </button>
        <p className="text-[11px] text-center mb-6" style={{ color: hl ? "rgba(255,255,255,0.3)" : "var(--text3)" }}>
          7 days free · No credit card required
        </p>
        <div className="h-px mb-5" style={{ background: hl ? "rgba(255,255,255,0.1)" : "var(--border)" }} />
        <ul className="space-y-2.5 flex-1">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>{CHECK}</span>
              <span className="text-[13px]" style={{ color: hl ? "rgba(255,255,255,0.75)" : "var(--text2)" }}>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function PricingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  async function handleStart(planKey: PlanKey) {
    setLoadingPlan(planKey);
    const userId = (session?.user as any)?.id;
    if (!userId) { router.push("/login"); return; }
    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey, interval, userId }),
      });
      const { url, error } = await res.json();
      if (error || !url) throw new Error(error || "No checkout URL");
      window.location.href = url;
    } catch {
      setLoadingPlan(null);
    }
  }

  async function handleStartBCBAStudents(type: "addon" | "standalone") {
    setLoadingPlan(`bcba_students_${type}`);
    const userId = (session?.user as any)?.id;
    if (!userId) { router.push("/login"); return; }
    try {
      const res = await fetch("/api/bcba-students/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, interval }),
      });
      const { url, error } = await res.json();
      if (error || !url) throw new Error(error || "No checkout URL");
      window.location.href = url;
    } catch {
      setLoadingPlan(null);
    }
  }

  const SectionLabel = ({ label }: { label: string }) => (
    <p className="text-[11px] uppercase tracking-widest font-semibold mb-4 text-center" style={{ color: "var(--text3)" }}>
      {label}
    </p>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-8 h-16 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-[17px] font-semibold">
          <span style={{ color: "var(--text1)" }}>Path</span>
          <span style={{ color: "var(--teal)" }}>4</span>
          <span style={{ color: "var(--text1)" }}>ABA</span>
        </span>
        <a href="/login" className="text-sm font-medium hover:underline" style={{ color: "var(--teal)" }}>Sign in</a>
      </div>

      {/* Hero */}
      <div className="text-center py-12 px-6">
        <p className="text-[12px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--teal)" }}>Pricing</p>
        <h1 className="text-[32px] font-semibold leading-tight mb-3" style={{ color: "var(--text1)" }}>
          Simple, transparent pricing
        </h1>
        <p className="text-[15px] max-w-sm mx-auto mb-8" style={{ color: "var(--text3)" }}>
          Start free for 7 days — no credit card required. Cancel any time.
        </p>

        {/* Interval toggle */}
        <div className="inline-flex items-center p-1 rounded-full border bg-white" style={{ borderColor: "var(--border)" }}>
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
                <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: interval === "year" ? "rgba(255,255,255,0.2)" : "var(--teal-light, #E6F9F5)", color: interval === "year" ? "white" : "var(--teal)" }}>
                  SAVE
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pb-8 max-w-5xl mx-auto w-full space-y-12">

        {/* RBT Plans */}
        <div>
          <SectionLabel label="RBT Plans" />
          <div className="flex flex-col md:flex-row gap-5">
            {RBT_PLANS.map(plan => (
              <PlanCard
                key={plan.key}
                plan={plan}
                interval={interval}
                onStart={() => handleStart(plan.key)}
                loading={loadingPlan === plan.key}
              />
            ))}
          </div>
        </div>

        {/* BCBA Plans */}
        <div>
          <SectionLabel label="BCBA / BCaBA Plans" />
          <div className="flex flex-col md:flex-row gap-5">
            {BCBA_PLANS.map(plan => (
              <PlanCard
                key={plan.key}
                plan={plan}
                interval={interval}
                onStart={() => handleStart(plan.key)}
                loading={loadingPlan === plan.key}
              />
            ))}
          </div>
        </div>

        {/* BCBA Students */}
        <div>
          <SectionLabel label="BCBA Students — Fieldwork Hour Tracker" />
          <div className="flex flex-col md:flex-row gap-5">
            {/* With RBT plan */}
            <div className="flex-1 bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
              <div className="p-7">
                <p className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>With RBT account</p>
                <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text1)" }}>BCBA Students</p>
                <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>Already a Path4ABA RBT member.</p>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-[38px] font-semibold leading-none" style={{ color: "var(--text1)" }}>
                    {interval === "month" ? "$14.99" : "$149"}
                  </span>
                  <span className="text-[13px] mb-1.5" style={{ color: "var(--text3)" }}>/{interval === "month" ? "mo" : "yr"}</span>
                </div>
                {interval === "year" && <p className="text-[12px] font-medium mb-4" style={{ color: "var(--teal)" }}>Save $30.88/year vs monthly</p>}
                <button
                  onClick={() => handleStartBCBAStudents("addon")}
                  disabled={!!loadingPlan}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 mb-3 mt-4"
                  style={{ background: "var(--navy)" }}
                >
                  {loadingPlan === "bcba_students_addon" ? "Redirecting…" : "Start Free Trial"}
                </button>
                <p className="text-[11px] text-center" style={{ color: "var(--text3)" }}>7 days free · Card required</p>
                <div className="h-px my-5" style={{ background: "var(--border)" }} />
                <ul className="space-y-2">
                  {["Track fieldwork hours", "BACB compliance calculations", "Monthly M-FVF PDF export", "200+ BACB-compliant notes"].map(f => (
                    <li key={f} className="flex items-center gap-2.5">
                      <span style={{ color: "var(--teal)" }}>{CHECK}</span>
                      <span className="text-[13px]" style={{ color: "var(--text2)" }}>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* No RBT plan */}
            <div className="flex-1 bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
              <div className="p-7">
                <p className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>Standalone</p>
                <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text1)" }}>BCBA Students</p>
                <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>No existing Path4ABA subscription.</p>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-[38px] font-semibold leading-none" style={{ color: "var(--text1)" }}>
                    {interval === "month" ? "$19.99" : "$199"}
                  </span>
                  <span className="text-[13px] mb-1.5" style={{ color: "var(--text3)" }}>/{interval === "month" ? "mo" : "yr"}</span>
                </div>
                {interval === "year" && <p className="text-[12px] font-medium mb-4" style={{ color: "var(--teal)" }}>Save $40.88/year vs monthly</p>}
                <button
                  onClick={() => handleStartBCBAStudents("standalone")}
                  disabled={!!loadingPlan}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 mb-3 mt-4"
                  style={{ background: "var(--navy)" }}
                >
                  {loadingPlan === "bcba_students_standalone" ? "Redirecting…" : "Start Free Trial"}
                </button>
                <p className="text-[11px] text-center" style={{ color: "var(--text3)" }}>7 days free · Card required</p>
                <div className="h-px my-5" style={{ background: "var(--border)" }} />
                <ul className="space-y-2">
                  {["Track fieldwork hours", "BACB compliance calculations", "Monthly M-FVF PDF export", "200+ BACB-compliant notes"].map(f => (
                    <li key={f} className="flex items-center gap-2.5">
                      <span style={{ color: "var(--teal)" }}>{CHECK}</span>
                      <span className="text-[13px]" style={{ color: "var(--text2)" }}>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Add-ons */}
        <div>
          <SectionLabel label="Add-ons" />
          <div className="flex flex-col md:flex-row gap-5">
            {/* Data Tool */}
            <div className="flex-1 bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, #8B5CF6, #A78BFA)" }} />
              <div className="p-6">
                <p className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>RBT Add-on</p>
                <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Data Tool</p>
                <p className="text-[13px] mb-4" style={{ color: "var(--text3)" }}>Track behavior and skill data from your Chrome extension.</p>
                <div className="flex items-end gap-1">
                  <span className="text-[32px] font-semibold leading-none" style={{ color: "var(--text1)" }}>
                    {interval === "month" ? "$5.99" : "$59"}
                  </span>
                  <span className="text-[13px] mb-1.5" style={{ color: "var(--text3)" }}>/{interval === "month" ? "mo" : "yr"}</span>
                </div>
                {interval === "year" && <p className="text-[12px] font-medium mt-1" style={{ color: "#8B5CF6" }}>Save $12.88/year</p>}
              </div>
            </div>

            {/* Assessment Tool */}
            <div className="flex-1 bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, #F59E0B, #FCD34D)" }} />
              <div className="p-6">
                <p className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>BCBA Add-on</p>
                <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Assessment Tools</p>
                <p className="text-[13px] mb-4" style={{ color: "var(--text3)" }}>PDF assessment parsing and clinical profile generation.</p>
                <div className="flex items-end gap-1">
                  <span className="text-[32px] font-semibold leading-none" style={{ color: "var(--text1)" }}>
                    {interval === "month" ? "$9.99" : "$99"}
                  </span>
                  <span className="text-[13px] mb-1.5" style={{ color: "var(--text3)" }}>/{interval === "month" ? "mo" : "yr"}</span>
                </div>
                {interval === "year" && <p className="text-[12px] font-medium mt-1" style={{ color: "#D97706" }}>Save $20.88/year</p>}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Footer */}
      <p className="text-center text-[12px] pb-12 pt-4" style={{ color: "var(--text3)" }}>
        Questions?{" "}
        <a href="mailto:support@path4aba.com" className="hover:underline" style={{ color: "var(--teal)" }}>
          support@path4aba.com
        </a>
      </p>
    </div>
  );
}
