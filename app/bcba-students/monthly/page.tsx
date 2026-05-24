"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { type FieldworkType } from "@/lib/bcba-students/calculations";
import MonthlyTable from "@/app/components/bcba-students/MonthlyTable";
import MonthDrawer from "@/app/components/bcba-students/MonthDrawer";

interface Summary {
  id: string;
  month_year: string;
  total_independent_hours: number;
  total_supervised_hours: number;
  total_hours: number;
  supervision_pct: number;
  unrestricted_hours: number;
  restricted_hours: number;
  supervisor_contacts: number;
  individual_contacts: number;
  group_contacts: number;
  client_observations: number;
  is_eligible: boolean;
  ineligibility_reason: string | null;
  mvf_signed: boolean;
  mvf_signed_at: string | null;
}

interface Profile {
  fieldwork_type: string;
  supervisor_name: string | null;
  supervisor_bacb_id: string | null;
  state_of_fieldwork: string | null;
  country_of_fieldwork: string | null;
  trainee_bacb_id: string | null;
}

export default function MonthlyPage() {
  const router = useRouter();
  const [fieldworkType, setFieldworkType] = useState<FieldworkType>("supervised");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [traineeName, setTraineeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    setTraineeName(user.user_metadata?.full_name || user.email?.split("@")[0] || "");

    const [profileRes, monthlyRes] = await Promise.all([
      fetch("/api/bcba-students/profile"),
      fetch("/api/bcba-students/monthly"),
    ]);

    const profileData = await profileRes.json();
    const monthlyData = await monthlyRes.json();

    if (profileData.profile) {
      setProfile(profileData.profile);
      setFieldworkType(profileData.profile.fieldwork_type || "supervised");
    }
    setSummaries(monthlyData.summaries || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const selectedSummary = selectedMonth ? summaries.find(s => s.month_year === selectedMonth) ?? null : null;

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
        <span className="font-medium" style={{ color: "var(--text1)" }}>Monthly View</span>
      </div>

      <div className="px-8 py-8 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[20px] font-semibold" style={{ color: "var(--text1)" }}>Monthly Breakdown</h1>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--text3)" }}>
              Click any month to view sessions, compliance, and sign your M-FVF.
            </p>
          </div>
          <Link
            href="/bcba-students/log"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: "var(--teal)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Log Session
          </Link>
        </div>

        <MonthlyTable
          summaries={summaries}
          fieldworkType={fieldworkType}
          onSelectMonth={setSelectedMonth}
        />
      </div>

      {selectedMonth && (
        <MonthDrawer
          monthYear={selectedMonth}
          summary={selectedSummary}
          fieldworkType={fieldworkType}
          profile={profile}
          traineeName={traineeName}
          onClose={() => setSelectedMonth(null)}
          onMvfSigned={() => { setSelectedMonth(null); loadData(); }}
        />
      )}
    </main>
  );
}
