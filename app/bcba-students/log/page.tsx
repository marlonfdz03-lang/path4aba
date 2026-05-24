"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { type FieldworkType } from "@/lib/bcba-students/calculations";
import LogSessionForm from "@/app/components/bcba-students/LogSessionForm";

export default function LogSessionPage() {
  const router = useRouter();
  const [fieldworkType, setFieldworkType] = useState<FieldworkType>("supervised");
  const [supervisorName, setSupervisorName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const res = await fetch("/api/bcba-students/profile");
      const data = await res.json();
      if (data.profile) {
        setFieldworkType(data.profile.fieldwork_type || "supervised");
        setSupervisorName(data.profile.supervisor_name || "");
      }
      setLoading(false);
    }
    load();
  }, [router]);

  function handleSaved() {
    setSaved(true);
    setTimeout(() => { router.push("/bcba-students"); }, 1500);
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      {/* Topbar */}
      <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link href="/bcba-students" className="hover:underline" style={{ color: "var(--text3)" }}>BCBA Students</Link>
        <span style={{ color: "var(--border2)" }}>/</span>
        <span className="font-medium" style={{ color: "var(--text1)" }}>Log Session</span>
      </div>

      <div className="px-8 py-8 max-w-2xl">
        {saved ? (
          <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid var(--border)" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#DCFCE7" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-[16px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Session saved!</p>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>Redirecting to dashboard…</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-7" style={{ border: "1px solid var(--border)" }}>
            <h1 className="text-[18px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Log Fieldwork Session</h1>
            <p className="text-[13px] mb-7" style={{ color: "var(--text3)" }}>
              Record your hours. Compliance metrics update automatically.
            </p>
            <LogSessionForm
              fieldworkType={fieldworkType}
              defaultSupervisorName={supervisorName}
              onSaved={handleSaved}
            />
          </div>
        )}
      </div>
    </main>
  );
}
