"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { type FieldworkType, type CertificationTrack } from "@/lib/bcba-students/calculations";
import DashboardMetrics from "@/app/components/bcba-students/DashboardMetrics";
import ProgressBars from "@/app/components/bcba-students/ProgressBars";
import ComplianceChecklist from "@/app/components/bcba-students/ComplianceChecklist";
import ComplianceGuide from "@/app/components/bcba-students/ComplianceGuide";

interface Profile {
  fieldwork_type: FieldworkType;
  certification_track: string;
  start_date: string | null;
}

interface MonthSummary {
  month_year: string;
  total_hours: number;
  total_supervised_hours: number;
  total_independent_hours: number;
  supervision_pct: number;
  unrestricted_hours: number;
  restricted_hours: number;
  supervisor_contacts: number;
  individual_contacts: number;
  group_contacts: number;
  client_observations: number;
  is_eligible: boolean;
  mvf_signed: boolean;
}

export default function BCBAStudentsDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [profileRes, monthlyRes] = await Promise.all([
        fetch("/api/bcba-students/profile"),
        fetch("/api/bcba-students/monthly"),
      ]);

      const profileData = await profileRes.json();
      const monthlyData = await monthlyRes.json();

      setProfile(profileData.profile);
      setSummaries(monthlyData.summaries || []);
      setLoading(false);
    }
    load();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  const fieldworkType = profile?.fieldwork_type ?? "supervised";
  const certificationTrack: CertificationTrack = profile?.certification_track === "BCaBA" ? "BCaBA" : "BCBA";

  // Aggregate totals across ALL eligible months
  const allTotal = summaries.reduce((s, m) => s + m.total_hours, 0);
  const allSupervised = summaries.reduce((s, m) => s + m.total_supervised_hours, 0);
  const allUnrestricted = summaries.reduce((s, m) => s + m.unrestricted_hours, 0);
  const supervisionPct = allTotal > 0 ? (allSupervised / allTotal) * 100 : 0;
  const cumulativeUnrestrictedPct = allTotal > 0 ? (allUnrestricted / allTotal) * 100 : 0;

  // Months active (from start_date to now)
  let monthsActive = 0;
  if (profile?.start_date) {
    const start = new Date(profile.start_date);
    const now = new Date();
    monthsActive = Math.max(1, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1);
  } else if (summaries.length > 0) {
    monthsActive = summaries.length;
  }

  // Current month data
  const currentMonthYear = new Date().toISOString().slice(0, 7);
  const currentMonth = summaries.find(s => s.month_year === currentMonthYear) ?? null;

  // Warning: any past month ineligible
  const ineligiblePastMonths = summaries.filter(s => {
    const [y, m] = s.month_year.split("-").map(Number);
    const isPast = new Date(y, m - 1) < new Date(new Date().getFullYear(), new Date().getMonth());
    return isPast && !s.is_eligible;
  });

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      {/* Topbar */}
      <div className="flex items-center justify-between px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>
          BCBA Students · {profile?.certification_track} ({fieldworkType === "concentrated" ? "Concentrated" : "Supervised"})
        </p>
        <Link
          href="/bcba-students/log"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: "var(--teal)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Log Session
        </Link>
      </div>

      <div className="px-8 py-8 max-w-5xl space-y-6">
        {/* Warning banner */}
        {ineligiblePastMonths.length > 0 && (
          <div className="rounded-xl px-5 py-4 border" style={{ background: "#FEF2F2", borderColor: "#FECACA" }}>
            <p className="text-[13px] font-semibold mb-1" style={{ color: "#DC2626" }}>
              ⚠ {ineligiblePastMonths.length} past month{ineligiblePastMonths.length > 1 ? "s" : ""} ineligible
            </p>
            <p className="text-[12px]" style={{ color: "#B91C1C" }}>
              Hours from ineligible months don't count toward certification. Review your{" "}
              <Link href="/bcba-students/monthly" className="underline">Monthly View</Link> for details.
            </p>
          </div>
        )}

        {/* Metrics */}
        <DashboardMetrics
          totalHours={allTotal}
          supervisedHours={allSupervised}
          supervisionPct={supervisionPct}
          fieldworkType={fieldworkType}
          certificationTrack={certificationTrack}
          monthsActive={monthsActive}
        />

        {/* Progress bars */}
        <ProgressBars
          totalHours={allTotal}
          fieldworkType={fieldworkType}
          certificationTrack={certificationTrack}
          cumulativeUnrestrictedPct={cumulativeUnrestrictedPct}
          thisMonthSupervisionPct={currentMonth?.supervision_pct ?? 0}
        />

        {/* Compliance checklist */}
        <ComplianceChecklist month={currentMonth} fieldworkType={fieldworkType} certificationTrack={certificationTrack} />

        {/* BACB Compliance Guide — collapsible info panel */}
        <ComplianceGuide />

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-4">
          <Link href="/bcba-students/log" className="bg-white rounded-xl p-5 flex items-center gap-3 hover:opacity-90 transition-opacity" style={{ border: "1px solid var(--border)" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(27,168,160,0.1)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Log a Session</p>
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>Record today's fieldwork hours</p>
            </div>
          </Link>
          <Link href="/bcba-students/monthly" className="bg-white rounded-xl p-5 flex items-center gap-3 hover:opacity-90 transition-opacity" style={{ border: "1px solid var(--border)" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(27,168,160,0.1)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Monthly View</p>
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>Review all months & sign M-FVF</p>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
