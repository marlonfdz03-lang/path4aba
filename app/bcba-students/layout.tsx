"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import PaywallScreen from "@/app/components/bcba-students/PaywallScreen";

export default function BCBAStudentsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [state, setState] = useState<"loading" | "paywall" | "onboarding" | "ready">("loading");

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }

    async function check() {
      const [subRes, profileRes] = await Promise.all([
        fetch("/api/user/subscription"),
        fetch("/api/bcba-students/profile"),
      ]);
      const subData = await subRes.json();
      const profileData = await profileRes.json();

      if (!subData.hasBCBAStudents) {
        setState("paywall");
        return;
      }

      if (!profileData.profile?.onboarding_complete) {
        setState("onboarding");
        router.push("/bcba-students/onboarding");
        return;
      }

      setState("ready");
    }
    check();
  }, [status, session, router]);

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
