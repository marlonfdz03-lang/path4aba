"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import type { PlanKey } from "@/lib/stripe";

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

type Profession = "rbt" | "bcba" | "student";

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

function WaitlistCard({
  planLabel,
  email,
  onEmailChange,
  onSubmit,
  loading,
  done,
  error,
}: {
  planLabel: string;
  email: string;
  onEmailChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  done: boolean;
  error: string;
}) {
  return (
    <div className="max-w-md mx-auto w-full">
      <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}>
        <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
        <div className="p-8 flex flex-col items-center text-center">
          <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-5" style={{ background: "rgba(27,168,160,0.12)", color: "#24BDB4" }}>
            Coming Soon — Join the Waitlist
          </span>
          <h3 className="text-[20px] font-semibold mb-2" style={{ color: "var(--text1)" }}>
            {planLabel} plans are on the way
          </h3>
          <p className="text-[14px] mb-8 leading-relaxed" style={{ color: "var(--text3)" }}>
            We&apos;re finishing up {planLabel} features. Enter your email and we&apos;ll notify you the moment they launch.
          </p>
          {done ? (
            <div className="w-full px-5 py-3.5 rounded-xl text-[14px] font-semibold" style={{ background: "#E6F9F5", border: "1px solid #A7F3D0", color: "#065F46" }}>
              ✓ You&apos;re on the list! We&apos;ll email you when plans launch.
            </div>
          ) : (
            <div className="w-full flex flex-col gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="your@email.com"
                className="w-full border rounded-xl px-4 py-3 text-[14px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); } }}
              />
              <button
                onClick={onSubmit}
                disabled={loading || !email.trim()}
                className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "var(--teal)" }}
              >
                {loading ? "Sending…" : "Notify Me"}
              </button>
              {error && <p className="text-[12px] text-center" style={{ color: "#DC2626" }}>{error}</p>}
            </div>
          )}
          <p className="text-[12px] mt-5" style={{ color: "var(--text3)" }}>
            No spam. We&apos;ll only email you when your plan is ready.
          </p>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  interval,
  onStart,
  loading,
  disabled,
  promoApplied,
}: {
  plan: Plan;
  interval: "month" | "year";
  onStart: () => void;
  loading: boolean;
  disabled?: boolean;
  promoApplied?: boolean;
}) {
  const price = interval === "month" ? plan.monthlyPrice : plan.yearlyPrice;
  const promoDiscount = interval === "month" ? 5 : 60;
  const discountedPrice = promoApplied ? parseFloat((price - promoDiscount).toFixed(2)) : null;
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
        <div className="flex items-end gap-1.5 mb-1">
          {discountedPrice !== null && (
            <span className="text-[22px] font-medium leading-none line-through self-end mb-0.5" style={{ color: hl ? "rgba(255,255,255,0.35)" : "var(--text3)" }}>
              ${price}
            </span>
          )}
          <span className="text-[38px] font-semibold leading-none" style={{ color: hl ? "white" : "var(--text1)" }}>
            ${discountedPrice !== null ? discountedPrice : price}
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
          disabled={loading || !!disabled}
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

function PricingContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const addonOnly = searchParams.get("tab") === "students" && searchParams.get("plan") === "addon";
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [profession, setProfession] = useState<Profession>(addonOnly ? "student" : "rbt");
  const [hasActiveRBT, setHasActiveRBT] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsWarning, setTermsWarning] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistError, setWaitlistError] = useState("");

  useEffect(() => {
    if (addonOnly) return;
    const role = (session?.user as any)?.role as string | undefined;
    if (role === "bcba" || role === "bcaba") setProfession("bcba");
    else if (role === "bcba_student" || role === "bcaba_student") setProfession("student");
  }, [session, addonOnly]);

  useEffect(() => {
    const userId = (session?.user as any)?.id;
    if (!userId) return;
    fetch("/api/user/subscription")
      .then((r) => r.json())
      .then((d) => setHasActiveRBT(!!d.hasActiveRBT))
      .catch(() => {});
  }, [session]);

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
    if (valid) setPromoApplied(true);
    else setPromoError(error || "Invalid promo code");
  }

  async function handleWaitlist(plan: string) {
    const email = waitlistEmail.trim();
    if (!email) return;
    setWaitlistLoading(true);
    setWaitlistError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setWaitlistDone(true);
    } catch (err: any) {
      setWaitlistError(err.message || "Something went wrong. Please try again.");
    } finally {
      setWaitlistLoading(false);
    }
  }

  async function handleStart(planKey: PlanKey) {
    if (!agreedToTerms) { setTermsWarning(true); return; }
    setTermsWarning(false);
    setLoadingPlan(planKey);
    const userId = (session?.user as any)?.id;
    if (!userId) { router.push("/login?redirect=/pricing"); return; }
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

  async function handleStartStandalone() {
    if (!agreedToTerms) { setTermsWarning(true); return; }
    setTermsWarning(false);
    setLoadingPlan("bcba_students_standalone");
    const userId = (session?.user as any)?.id;
    if (!userId) { router.push("/login?redirect=/pricing"); return; }
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

  const PROFESSIONS: { key: Profession; label: string; comingSoon?: boolean }[] = [
    { key: "rbt", label: "RBT" },
    { key: "bcba", label: "BCBA / BCaBA", comingSoon: true },
    { key: "student", label: "BCBA / BCaBA Student", comingSoon: true },
  ];

  const standalonePrice = interval === "month" ? 19.99 : 199;
  const standaloneSavings = Math.round(19.99 * 12 - 199);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-8 h-16 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-[17px] font-semibold">
          <span style={{ color: "var(--text1)" }}>Path</span>
          <span style={{ color: "var(--teal)" }}>4</span>
          <span style={{ color: "var(--text1)" }}>ABA</span>
        </span>
        <a href="/login?redirect=/pricing" className="text-sm font-medium hover:underline" style={{ color: "var(--teal)" }}>Sign in</a>
      </div>

      {/* Hero */}
      <div className="text-center py-10 px-6">
        <p className="text-[12px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--teal)" }}>Pricing</p>
        <h1 className="text-[32px] font-semibold leading-tight mb-3" style={{ color: "var(--text1)" }}>
          Simple, transparent pricing
        </h1>
        <p className="text-[15px] max-w-sm mx-auto mb-8" style={{ color: "var(--text3)" }}>
          Start free for 7 days — no credit card required. Cancel any time.
        </p>

        {/* Profession selector */}
        <div className="flex justify-center gap-2 flex-wrap mb-6">
          {PROFESSIONS.map(({ key, label, comingSoon }) => (
            <button
              key={key}
              onClick={() => setProfession(key)}
              className="px-5 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors"
              style={{
                background: profession === key ? "var(--navy)" : "white",
                borderColor: profession === key ? "var(--navy)" : "var(--border)",
                color: profession === key ? "white" : "var(--text2)",
              }}
            >
              {label}
              {comingSoon && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: profession === key ? "rgba(255,255,255,0.25)" : "#F1F5F9", color: profession === key ? "white" : "#64748B" }}>
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>

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

      {/* Plan cards */}
      <div className="px-6 pb-8 max-w-4xl mx-auto w-full">

        {/* RBT Plans */}
        {profession === "rbt" && (
          <div className="flex flex-col md:flex-row gap-5">
            {RBT_PLANS.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                interval={interval}
                onStart={() => handleStart(plan.key)}
                loading={loadingPlan === plan.key}
                disabled={!agreedToTerms || !!loadingPlan}
                promoApplied={promoApplied}
              />
            ))}
          </div>
        )}

        {/* BCBA Plans — Coming Soon */}
        {profession === "bcba" && (
          <WaitlistCard
            planLabel="BCBA / BCaBA"
            email={waitlistEmail}
            onEmailChange={(v) => { setWaitlistEmail(v); setWaitlistError(""); }}
            onSubmit={() => handleWaitlist("bcba")}
            loading={waitlistLoading}
            done={waitlistDone}
            error={waitlistError}
          />
        )}

        {/* BCBA Students — Coming Soon */}
        {profession === "student" && (
          <WaitlistCard
            planLabel="BCBA / BCaBA Student"
            email={waitlistEmail}
            onEmailChange={(v) => { setWaitlistEmail(v); setWaitlistError(""); }}
            onSubmit={() => handleWaitlist("bcba_student")}
            loading={waitlistLoading}
            done={waitlistDone}
            error={waitlistError}
          />
        )}

        {/* Add-ons — only for RBT and BCBA */}
        {profession !== "student" && (
          <div className="mt-10">
            <p className="text-[11px] uppercase tracking-widest font-semibold mb-4 text-center" style={{ color: "var(--text3)" }}>Add-ons</p>
            <div className="flex flex-col md:flex-row gap-5">
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
        )}
      </div>

      {/* Promo code + Terms */}
      <>
        {/* Promo code */}
          <div className="flex justify-center px-6 pb-4 max-w-sm mx-auto w-full">
            <div className="w-full">
              <p className="text-[13px] font-medium mb-2 text-center" style={{ color: "var(--text3)" }}>Have a promo code?</p>
              {promoApplied ? (
                <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold"
                  style={{ background: "#E6F9F5", border: "1px solid #A7F3D0", color: "#065F46" }}>
                  {CHECK}
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
                      className="flex-1 border rounded-xl px-4 py-2.5 text-sm focus:outline-none uppercase tracking-widest"
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

          {/* Terms checkbox */}
          <div className="flex justify-center px-6 pb-10 max-w-sm mx-auto w-full">
            <div className="w-full">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => { setAgreedToTerms(e.target.checked); setTermsWarning(false); }}
                  className="mt-0.5 w-4 h-4 rounded flex-shrink-0"
                  style={{ accentColor: "var(--teal)" }}
                />
                <span className="text-[13px]" style={{ color: "var(--text2)" }}>
                  I agree to the{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80"
                    style={{ color: "var(--teal)" }}>Terms of Service</a>
                  {" "}and{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80"
                    style={{ color: "var(--teal)" }}>Privacy Policy</a>
                </span>
              </label>
              {termsWarning && (
                <p className="text-[12px] mt-2 ml-7" style={{ color: "#DC2626" }}>
                  Please accept the Terms of Service and Privacy Policy to continue.
                </p>
              )}
            </div>
          </div>
      </>

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

export default function PricingPage() {
  return (
    <Suspense fallback={<div />}>
      <PricingContent />
    </Suspense>
  );
}
