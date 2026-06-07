"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

type Section = "rbt" | "bcba" | "students";

type Plan = {
  key: string;
  name: string;
  subtitle: string;
  monthlyPrice: number;
  yearlyPrice: number;
  clientLimit?: string;
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

const STUDENT_PLANS: Plan[] = [
  {
    key: "bcba_students_standalone",
    name: "BCBA Students — Standalone",
    subtitle: "No existing Path4ABA subscription required.",
    monthlyPrice: 19.99,
    yearlyPrice: 199,
    features: [
      "Track concentrated & supervised hours",
      "BACB compliance calculations",
      "Monthly M-FVF PDF export",
      "200+ BACB-compliant note descriptions",
      "7-day free trial",
    ],
  },
];

function defaultSection(role: string | undefined): Section {
  if (role === "bcba_student" || role === "bcaba_student") return "students";
  if (role === "bcba" || role === "bcaba") return "bcba";
  return "rbt";
}

function PlanCard({
  plan,
  interval,
  loading,
  disabled,
  onSelect,
}: {
  plan: Plan;
  interval: "month" | "year";
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
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
          <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
            style={{ background: "rgba(27,168,160,0.22)", color: "#24BDB4" }}>
            {plan.badge}
          </span>
        </div>
      )}
      <div className="p-7 flex flex-col flex-1">
        <p className="text-[11px] uppercase tracking-widest font-semibold mb-1"
          style={{ color: hl ? "rgba(255,255,255,0.45)" : "var(--text3)" }}>
          {plan.name}
        </p>
        <p className="text-[13px] mb-5 leading-relaxed"
          style={{ color: hl ? "rgba(255,255,255,0.6)" : "var(--text3)" }}>
          {plan.subtitle}
        </p>

        <div className="flex items-end gap-1 mb-1">
          <span className="text-[38px] font-semibold leading-none"
            style={{ color: hl ? "white" : "var(--text1)" }}>
            ${price}
          </span>
          <span className="text-[13px] mb-1.5"
            style={{ color: hl ? "rgba(255,255,255,0.4)" : "var(--text3)" }}>
            /{interval === "month" ? "mo" : "yr"}
          </span>
        </div>
        <div className="mb-4 h-5">
          {interval === "year" && (
            <p className="text-[12px] font-medium" style={{ color: hl ? "rgba(27,168,160,0.9)" : "var(--teal)" }}>
              Save ${savings}/year vs monthly
            </p>
          )}
        </div>

        {plan.clientLimit && (
          <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full mb-5 self-start"
            style={{ background: hl ? "rgba(27,168,160,0.2)" : "var(--teal-light, #E6F9F5)", color: "var(--teal)" }}>
            {plan.clientLimit}
          </span>
        )}

        <button
          onClick={onSelect}
          disabled={disabled}
          className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed mb-3"
          style={{ background: hl ? "var(--teal)" : "var(--navy)" }}
        >
          {loading ? "Redirecting to checkout…" : "Start Free Trial"}
        </button>

        <p className="text-[11px] text-center mb-6"
          style={{ color: hl ? "rgba(255,255,255,0.35)" : "var(--text3)" }}>
          Your card will not be charged until your 7-day trial ends.
        </p>

        <div className="h-px mb-5"
          style={{ background: hl ? "rgba(255,255,255,0.1)" : "var(--border)" }} />

        <ul className="space-y-2.5 flex-1">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>{CHECK_ICON}</span>
              <span className="text-[13px]"
                style={{ color: hl ? "rgba(255,255,255,0.75)" : "var(--text2)" }}>
                {f}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;

  const [activeSection, setActiveSection] = useState<Section>(() => defaultSection(role));
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState("");
  const [hasActiveRBT, setHasActiveRBT] = useState(false);

  useEffect(() => {
    const userId = (session?.user as any)?.id;
    if (!userId) return;
    fetch("/api/user/subscription")
      .then((r) => r.json())
      .then((d) => setHasActiveRBT(!!d.hasActiveRBT))
      .catch(() => {});
  }, [session]);

  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsWarning, setTermsWarning] = useState(false);

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
    if (valid) setPromoApplied(true);
    else setPromoError(error || "Invalid promo code");
  }

  async function handleSelectPlan(planKey: string) {
    if (!agreedToTerms) { setTermsWarning(true); return; }
    setTermsWarning(false);
    setLoadingPlan(planKey);
    setPlanError("");

    const userId = (session?.user as any)?.id;
    if (!userId) { router.push("/login"); return; }

    const timeout = new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 10000)
    );

    try {
      const res = await Promise.race([
        fetch("/api/create-trial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            plan: planKey,
            interval,
            promoCode: promoApplied ? promoInput.toUpperCase().trim() : undefined,
          }),
        }),
        timeout,
      ]);
      const data = await (res as Response).json();
      if (!data.url) {
        setPlanError(data.error || "Something went wrong, please try again.");
        setLoadingPlan(null);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      const msg = err instanceof Error && err.message === "timeout"
        ? "Something went wrong, please try again."
        : "Network error, please try again.";
      setPlanError(msg);
      setLoadingPlan(null);
    }
  }

  const SECTIONS: { key: Section; label: string }[] = [
    { key: "rbt", label: "RBT" },
    { key: "bcba", label: "BCBA / BCaBA" },
    { key: "students", label: "BCBA Students" },
  ];

  const plans = activeSection === "rbt" ? RBT_PLANS : activeSection === "bcba" ? BCBA_PLANS : STUDENT_PLANS;

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
        <p className="text-[15px] max-w-sm mx-auto mb-8" style={{ color: "var(--text3)" }}>
          7-day free trial — no credit card charged until day 8. Cancel any time.
        </p>

        {/* Monthly / Annual toggle */}
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
                  style={{
                    background: interval === "year" ? "rgba(255,255,255,0.2)" : "var(--teal-light, #E6F9F5)",
                    color: interval === "year" ? "white" : "var(--teal)",
                  }}>
                  SAVE
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex justify-center gap-2 px-6 mb-6">
        {SECTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className="px-5 py-2 rounded-xl text-[13px] font-semibold border transition-colors"
            style={{
              background: activeSection === key ? "var(--teal)" : "white",
              borderColor: activeSection === key ? "var(--teal)" : "var(--border)",
              color: activeSection === key ? "white" : "var(--text2)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Plan error */}
      {planError && (
        <div className="max-w-3xl mx-auto px-6 mb-4 w-full">
          <p className="text-[13px] rounded-xl px-4 py-3 border text-center"
            style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
            {planError}
          </p>
        </div>
      )}

      {/* Plan cards */}
      <div className="flex flex-col lg:flex-row gap-5 justify-center px-6 pb-6 max-w-4xl mx-auto w-full">
        {activeSection === "students" && hasActiveRBT ? (
          <div className="max-w-md w-full mx-auto bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(13,43,78,0.08)" }}>
            <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
            <div className="p-8 text-center">
              <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(27,168,160,0.1)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
                </svg>
              </div>
              <h2 className="text-[20px] font-semibold mb-2" style={{ color: "var(--text1)" }}>Already have an RBT plan?</h2>
              <p className="text-[14px] mb-6 leading-relaxed" style={{ color: "var(--text3)" }}>
                Log in — Fieldwork Tracker is included in your sidebar.
              </p>
              <button
                onClick={() => router.push("/login")}
                className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--teal)" }}
              >
                Log in
              </button>
            </div>
          </div>
        ) : (
          plans.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              interval={interval}
              loading={loadingPlan === plan.key}
              disabled={!!loadingPlan || !agreedToTerms}
              onSelect={() => handleSelectPlan(plan.key)}
            />
          ))
        )}
      </div>

      {/* Add-on — shown only for RBT and BCBA sections */}
      {activeSection !== "students" && (
        <div className="max-w-4xl mx-auto px-6 pb-6 w-full">
          <p className="text-[11px] uppercase tracking-widest font-semibold mb-3 text-center"
            style={{ color: "var(--text3)" }}>
            Optional Add-on
          </p>
          <div className="bg-white rounded-2xl overflow-hidden flex flex-col md:flex-row"
            style={{ border: "1px solid var(--border)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
            <div className="w-1 md:w-auto flex-shrink-0"
              style={{ background: "linear-gradient(180deg, var(--teal), var(--sky))", minWidth: 4 }} />
            <div className="p-6 flex flex-col md:flex-row gap-6 flex-1 items-center">
              <div className="flex-1">
                {activeSection === "rbt" ? (
                  <>
                    <p className="text-[11px] uppercase tracking-widest font-semibold mb-0.5"
                      style={{ color: "var(--text3)" }}>RBT Add-on</p>
                    <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Data Tool</p>
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>
                      Track behavior and skill data from the Chrome extension. Weekly summaries, anomaly detection.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] uppercase tracking-widest font-semibold mb-0.5"
                      style={{ color: "var(--text3)" }}>BCBA Add-on</p>
                    <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Assessment Tools</p>
                    <p className="text-[13px]" style={{ color: "var(--text3)" }}>
                      PDF assessment parsing and clinical profile generation.{" "}
                      <strong>Not included in any BCBA plan — purchased separately.</strong>
                    </p>
                  </>
                )}
              </div>
              <div className="text-center md:text-right flex-shrink-0">
                <p className="text-[28px] font-semibold leading-none mb-0.5" style={{ color: "var(--text1)" }}>
                  {activeSection === "rbt"
                    ? (interval === "month" ? "$5.99" : "$59")
                    : (interval === "month" ? "$9.99" : "$99")}
                </p>
                <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>
                  /{interval === "month" ? "mo" : "yr"} · add after signup
                </p>
                <span className="text-[12px] px-3 py-1.5 rounded-full font-medium"
                  style={{ background: "var(--teal-light, #E6F9F5)", color: "var(--teal)" }}>
                  Available in billing settings
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Promo code */}
      <div className="flex justify-center pb-4 px-6">
        <div className="w-full max-w-sm">
          <p className="text-[13px] font-medium mb-2 text-center" style={{ color: "var(--text3)" }}>Have a promo code?</p>
          {promoApplied ? (
            <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold"
              style={{ background: "#E6F9F5", border: "1px solid #A7F3D0", color: "#065F46" }}>
              {CHECK_ICON}
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
      <div className="flex justify-center pb-16 px-6">
        <div className="w-full max-w-sm">
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
    </div>
  );
}
