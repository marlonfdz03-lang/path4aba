"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { BACB_RULES } from "@/lib/bcba-students/calculations";

interface Profile {
  certification_track: string;
  fieldwork_type: string;
  supervisor_name: string | null;
}

interface MonthSummary {
  month_year: string;
  total_hours: number;
  total_supervised_hours: number;
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

function Check({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span style={{ fontSize: 16 }}>—</span>;
  return <span style={{ fontSize: 16 }}>{ok ? "✅" : "❌"}</span>;
}

function Row({
  label,
  required,
  current,
  ok,
}: {
  label: string;
  required: string;
  current: string;
  ok: boolean | null;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{
        background: ok === null ? "var(--bg)" : ok ? "#F0FDF4" : "#FEF2F2",
        border: `1px solid ${ok === null ? "var(--border)" : ok ? "#BBF7D0" : "#FECACA"}`,
      }}
    >
      <Check ok={ok} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{label}</p>
        <p className="text-[11px]" style={{ color: "var(--text3)" }}>Required: {required}</p>
      </div>
      <p
        className="text-[12px] font-semibold flex-shrink-0"
        style={{ color: ok === null ? "var(--text3)" : ok ? "#16A34A" : "#DC2626" }}
      >
        {current}
      </p>
    </div>
  );
}

export default function BACBRequirementsPage() {
  const { data: session, status } = useSession();
  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [currentMonth, setCurrentMonth] = useState<MonthSummary | null>(null);
  const [loaded,       setLoaded]       = useState(false);

  useEffect(() => {
    if (status === "loading" || !session?.user) return;

    Promise.all([
      fetch("/api/bcba-students/profile").then(r => r.json()),
      fetch("/api/bcba-students/monthly").then(r => r.json()),
    ]).then(([profileData, monthlyData]) => {
      setProfile(profileData.profile ?? null);

      const now = new Date().toISOString().slice(0, 7);
      const summaries: MonthSummary[] = monthlyData.summaries ?? [];
      setCurrentMonth(summaries.find(s => s.month_year === now) ?? null);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [status, session]);

  const certTrack = profile?.certification_track === "BCaBA" ? "BCaBA" : "BCBA";
  const fwType    = profile?.fieldwork_type === "concentrated" ? "concentrated" : "supervised";
  const rules     = BACB_RULES[certTrack][fwType];
  const shared    = BACB_RULES.shared;

  const trackLabel = `${certTrack} — ${fwType === "concentrated" ? "Concentrated Supervised" : "Supervised"} Fieldwork`;

  // Current month compliance values
  const cm = currentMonth;

  const supPct       = cm ? cm.supervision_pct : null;
  const supOk        = cm ? cm.supervision_pct >= rules.supervisionPctMin : null;

  const supContacts  = cm ? cm.individual_contacts + cm.group_contacts : null;
  const indivPct     = supContacts != null && supContacts > 0
    ? Math.round((cm!.individual_contacts / supContacts) * 100)
    : (cm ? 100 : null); // if no supervision at all, treat as 100% individual (vacuously)
  const indivOk      = supContacts != null
    ? (supContacts === 0 ? null : (cm!.individual_contacts / supContacts) >= shared.individualSupervisionMin / 100)
    : null;

  const unrestrictedPct = cm && cm.total_hours > 0
    ? Math.round((cm.unrestricted_hours / cm.total_hours) * 100)
    : (cm ? 0 : null);
  const unrestrictedOk = cm && cm.total_hours > 0
    ? cm.unrestricted_hours / cm.total_hours >= shared.unrestrictedPctMin / 100
    : null;

  const contactsOk   = cm ? cm.supervisor_contacts >= rules.contactsPerMonth : null;
  const hoursOk      = cm ? cm.total_hours >= rules.minHoursPerMonth : null;
  const observOk     = cm ? cm.client_observations >= shared.clientObservationsPerMonth : null;
  const mvfOk        = cm ? cm.mvf_signed : null;

  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Fieldwork Tracker → BACB Requirements</p>
      </div>

      <div className="px-8 py-8 max-w-2xl">
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--text1)" }}>BACB Requirements</h1>
        <p className="text-[13.5px] mb-6" style={{ color: "var(--text3)" }}>
          Monthly eligibility rules for your certification track.
        </p>

        {/* Track card */}
        <div className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid var(--border)" }}>
          <div className="h-[3px] -mx-5 -mt-5 mb-5 rounded-t-xl" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
          <p className="text-[12px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>Your Track</p>
          <p className="text-[18px] font-semibold mb-3" style={{ color: "var(--text1)" }}>{trackLabel}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Hours",       value: `${rules.totalHoursRequired.toLocaleString()}h` },
              { label: "Monthly Minimum",   value: `${rules.minHoursPerMonth}h` },
              { label: "Monthly Cap",       value: "130h" },
              { label: "Min Supervision",   value: `${rules.supervisionPctMin}%/mo` },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl p-3" style={{ background: "var(--bg)" }}>
                <p className="text-[18px] font-bold" style={{ color: "var(--teal)" }}>{value}</p>
                <p className="text-[11px]" style={{ color: "var(--text3)" }}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* This month compliance */}
        <div className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid var(--border)" }}>
          <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>
            This Month Compliance
          </p>
          <p className="text-[12px] mb-4" style={{ color: "var(--text3)" }}>
            {monthLabel}{cm ? "" : " — no sessions logged yet"}
          </p>

          {!loaded ? (
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
          ) : (
            <div className="space-y-2">
              <Row
                label="Total Hours This Month"
                required={`≥ ${rules.minHoursPerMonth}h`}
                current={cm ? `${cm.total_hours.toFixed(1)}h` : "—"}
                ok={hoursOk}
              />
              <Row
                label="Supervision Percentage"
                required={`≥ ${rules.supervisionPctMin}% of total hours`}
                current={supPct !== null ? `${supPct.toFixed(1)}%` : "—"}
                ok={supOk}
              />
              <Row
                label="Individual Supervision"
                required={`≥ ${shared.individualSupervisionMin}% of supervision contacts`}
                current={indivPct !== null ? `${indivPct}%` : "—"}
                ok={indivOk}
              />
              <Row
                label="Unrestricted Hours"
                required={`≥ ${shared.unrestrictedPctMin}% of total hours`}
                current={unrestrictedPct !== null ? `${unrestrictedPct}%` : "—"}
                ok={unrestrictedOk}
              />
              <Row
                label="Supervision Contacts"
                required={`≥ ${rules.contactsPerMonth} contacts/month`}
                current={cm ? `${cm.supervisor_contacts}` : "—"}
                ok={contactsOk}
              />
              <Row
                label="Client Observation"
                required="≥ 1 per month"
                current={cm ? `${cm.client_observations}` : "—"}
                ok={observOk}
              />
              <Row
                label="M-FVF Signed"
                required="Must be signed before month end"
                current={mvfOk === null ? "—" : mvfOk ? "Signed" : "Not signed"}
                ok={mvfOk}
              />
            </div>
          )}
        </div>

        {/* Rules reference */}
        <div className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid var(--border)" }}>
          <p className="text-[14px] font-semibold mb-3" style={{ color: "var(--text1)" }}>Rules Reference</p>
          <div className="space-y-1.5 text-[13px]" style={{ color: "var(--text2)" }}>
            {[
              ["Total fieldwork hours required",                  `${rules.totalHoursRequired.toLocaleString()} hours`],
              ["Monthly hour minimum",                            `${rules.minHoursPerMonth} hours`],
              ["Monthly hour cap",                                "130 hours"],
              ["Minimum supervision per month",                   `${rules.supervisionPctMin}% of hours`],
              ["Individual supervision minimum",                  `${shared.individualSupervisionMin}% of all supervision contacts`],
              ["Group supervision maximum",                       `${shared.groupSupervisionMax}% of all supervision contacts`],
              ["Unrestricted activity minimum",                   `${shared.unrestrictedPctMin}% of total hours`],
              ["Restricted activity maximum",                     `${shared.restrictedPctMax}% of total hours`],
              ["Minimum supervision contacts per month",          `${rules.contactsPerMonth} contacts`],
              ["Client observation required per month",           "At least 1"],
              ["Monthly Fieldwork Verification Form (M-FVF)",     "Must be signed by supervisor"],
            ].map(([rule, value]) => (
              <div key={rule} className="flex items-start justify-between gap-4 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <span>{rule}</span>
                <span className="font-semibold flex-shrink-0" style={{ color: "var(--teal)" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Official link */}
        <a
          href="https://www.bacb.com/bcba/fieldwork/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between px-5 py-4 rounded-xl transition-opacity hover:opacity-80"
          style={{ background: "var(--navy)", color: "white" }}
        >
          <div>
            <p className="text-[13px] font-semibold">View Official BACB Requirements</p>
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>bacb.com/bcba/fieldwork</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>
    </main>
  );
}
