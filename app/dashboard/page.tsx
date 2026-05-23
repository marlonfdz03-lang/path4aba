"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const PLAN_LABELS: Record<string, string> = {
  trial: "Free Trial",
  rbt: "RBT Plan",
  bcba_starter: "BCBA / BCaBA Starter",
  bcba_pro: "BCBA / BCaBA Pro",
};

function daysRemaining(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const subscriptionSuccess = searchParams.get("subscription") === "success";

  const [userName, setUserName] = useState("");
  const [sub, setSub] = useState<{ plan: string; status: string; trial_ends_at: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const meta = user.user_metadata || {};
      const email = user.email || "";
      setUserName(meta.full_name || email.split("@")[0] || "there");

      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, trial_ends_at")
        .eq("user_id", user.id)
        .maybeSingle();

      setSub(data as typeof sub);
      setLoaded(true);
    }
    load();
  }, [router]);

  const isTrialing = sub?.status === "trialing";
  const daysLeft = isTrialing && sub?.trial_ends_at ? daysRemaining(sub.trial_ends_at) : null;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Topbar */}
      <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Dashboard</p>
      </div>

      <div className="px-8 py-8 max-w-3xl">

        {/* Success banner */}
        {subscriptionSuccess && (
          <div className="mb-6 flex items-center gap-3 px-5 py-4 rounded-xl text-sm font-medium" style={{ background: "#E6F9F5", border: "1px solid #A7F3D0", color: "#065F46" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            You&apos;re all set! Your subscription is active.
          </div>
        )}

        {/* Welcome */}
        <h1 className="text-2xl font-semibold mb-1" style={{ color: "var(--text1)" }}>
          Welcome to Path4ABA{loaded && userName ? `, ${userName}` : ""}
        </h1>
        <p className="text-[14px] mb-8" style={{ color: "var(--text3)" }}>
          Here&apos;s your workspace at a glance.
        </p>

        {/* Plan status */}
        {loaded && sub && (
          <div className="bg-white rounded-xl p-5 mb-6 flex items-center justify-between" style={{ border: "1px solid var(--border)" }}>
            <div>
              <p className="text-[12px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>Current Plan</p>
              <p className="text-[16px] font-semibold" style={{ color: "var(--text1)" }}>{PLAN_LABELS[sub.plan] ?? sub.plan}</p>
              {isTrialing && daysLeft !== null && (
                <p className="text-[13px] mt-0.5" style={{ color: "var(--teal)" }}>{daysLeft} days remaining in trial</p>
              )}
            </div>
            {isTrialing && (
              <Link
                href="/pricing"
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                Subscribe Now
              </Link>
            )}
          </div>
        )}

        {/* Quick actions */}
        <p className="text-[13px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text3)" }}>Quick Actions</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { href: "/clients", label: "Add Client", desc: "Create a new client profile", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
            { href: "/generate-note", label: "Generate Note", desc: "Create an AI session note", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" },
            { href: "/schedule", label: "View Schedule", desc: "Check upcoming sessions", icon: "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18" },
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="bg-white rounded-xl p-5 flex flex-col gap-3 hover:shadow-md transition-shadow"
              style={{ border: "1px solid var(--border)" }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(27,168,160,0.12)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={action.icon} />
                </svg>
              </div>
              <div>
                <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>{action.label}</p>
                <p className="text-[12px]" style={{ color: "var(--text3)" }}>{action.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
