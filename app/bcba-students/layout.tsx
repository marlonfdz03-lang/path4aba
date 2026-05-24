"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PaywallScreen from "@/app/components/bcba-students/PaywallScreen";

export default function BCBAStudentsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "paywall" | "onboarding" | "ready">("loading");

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      // Check bcba_students_status on subscriptions row
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("bcba_students_status, bcba_students_trial_ends_at")
        .eq("user_id", user.id)
        .maybeSingle();

      const now = new Date();
      const hasAccess =
        sub?.bcba_students_status === "active" ||
        (sub?.bcba_students_status === "trialing" &&
          sub.bcba_students_trial_ends_at &&
          new Date(sub.bcba_students_trial_ends_at) > now);

      if (!hasAccess) {
        setState("paywall");
        return;
      }

      // Check onboarding
      const { data: profile } = await supabase
        .from("fieldwork_profiles")
        .select("onboarding_complete")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile?.onboarding_complete) {
        setState("onboarding");
        router.push("/bcba-students/onboarding");
        return;
      }

      setState("ready");
    }
    check();
  }, [router]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
      </div>
    );
  }

  if (state === "paywall") {
    return <PaywallScreen />;
  }

  return <>{children}</>;
}
