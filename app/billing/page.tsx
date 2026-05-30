"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Sub = {
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  stripe_customer_id: string | null;
};

const PLAN_LABELS: Record<string, string> = {
  trial: "Free Trial",
  rbt: "RBT Plan",
  bcba_starter: "BCBA / BCaBA Starter",
  bcba_pro: "BCBA / BCaBA Pro",
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  trialing: { bg: "#EFF6FF", color: "#1D4ED8", label: "Trial" },
  active: { bg: "#E6F9F5", color: "#0D8A6A", label: "Active" },
  canceled: { bg: "#FEF2F2", color: "#DC2626", label: "Canceled" },
  expired: { bg: "#FEF2F2", color: "#DC2626", label: "Expired" },
};

function daysRemaining(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BillingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [sub, setSub] = useState<Sub | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }

    fetch("/api/user/subscription")
      .then((r) => r.json())
      .then((d) => {
        setSub(d.sub ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [status, session, router]);

  const userId = (session?.user as any)?.id ?? null;

  async function handleManage() {
    if (!userId) return;
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const { url, error } = await res.json();
      if (error || !url) throw new Error(error || "No portal URL");
      window.location.href = url;
    } catch {
      setPortalLoading(false);
    }
  }

  const statusStyle = sub ? (STATUS_STYLES[sub.status] ?? STATUS_STYLES.expired) : null;
  const isTrialing = sub?.status === "trialing";
  const isActive = sub?.status === "active";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Topbar */}
      <div
        className="flex items-center px-8 h-14 bg-white"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Billing</p>
      </div>

      <div className="px-8 py-8 max-w-2xl">
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--text1)" }}>Billing & Subscription</h1>
        <p className="text-[13.5px] mb-7" style={{ color: "var(--text3)" }}>Manage your plan and billing details.</p>

        {!loaded ? (
          <div className="bg-white rounded-xl p-10 text-center text-sm" style={{ color: "var(--text3)", border: "1px solid var(--border)" }}>
            Loading…
          </div>
        ) : !sub ? (
          <div className="bg-white rounded-xl p-8" style={{ border: "1px solid var(--border)" }}>
            <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text1)" }}>No active subscription</p>
            <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>Start a free 7-day trial to get full access.</p>
            <a
              href="/pricing"
              className="inline-flex px-5 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: "var(--teal)" }}
            >
              View Plans
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current plan card */}
            <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
              {/* Gradient top bar */}
              <div className="h-[3px] -mx-6 -mt-6 mb-6 rounded-t-xl" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[13px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>Current Plan</p>
                  <p className="text-[20px] font-semibold" style={{ color: "var(--text1)" }}>
                    {PLAN_LABELS[sub.plan] ?? sub.plan}
                  </p>
                </div>
                {statusStyle && (
                  <span
                    className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-full flex-shrink-0"
                    style={{ background: statusStyle.bg, color: statusStyle.color }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {statusStyle.label}
                  </span>
                )}
              </div>

              <div className="mt-5 space-y-3">
                {isTrialing && sub.trial_ends_at && (
                  <div className="flex items-center justify-between">
                    <p className="text-[13px]" style={{ color: "var(--text2)" }}>Trial ends</p>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>
                      {formatDate(sub.trial_ends_at)}{" "}
                      <span style={{ color: "var(--teal)", fontWeight: 500 }}>
                        ({daysRemaining(sub.trial_ends_at)} days remaining)
                      </span>
                    </p>
                  </div>
                )}

                {isActive && sub.current_period_ends_at && (
                  <div className="flex items-center justify-between">
                    <p className="text-[13px]" style={{ color: "var(--text2)" }}>Next billing date</p>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>
                      {formatDate(sub.current_period_ends_at)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
              <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Manage subscription</p>
              <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>
                Update payment method, change plan, or cancel your subscription via the Stripe billing portal.
              </p>

              {sub.stripe_customer_id ? (
                <button
                  onClick={handleManage}
                  disabled={portalLoading}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: "var(--navy)" }}
                >
                  {portalLoading ? "Opening portal…" : "Manage Subscription"}
                </button>
              ) : (
                <a
                  href="/pricing"
                  className="inline-flex px-5 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                  style={{ background: "var(--teal)" }}
                >
                  {isTrialing ? "Subscribe Now" : "Choose a Plan"}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
