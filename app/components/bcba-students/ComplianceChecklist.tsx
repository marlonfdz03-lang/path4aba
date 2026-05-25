"use client";

import { BACB_RULES, type FieldworkType, type CertificationTrack } from "@/lib/bcba-students/calculations";

interface MonthData {
  total_hours: number;
  supervisor_contacts: number;
  individual_contacts: number;
  group_contacts: number;
  client_observations: number;
  supervision_pct: number;
  mvf_signed: boolean;
}

interface Props {
  month: MonthData | null;
  fieldworkType: FieldworkType;
  certificationTrack: CertificationTrack;
}

function CheckItem({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: met ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)" }}
      >
        {met ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        )}
      </div>
      <span className="text-[13px]" style={{ color: met ? "var(--text2)" : "var(--text1)" }}>{label}</span>
    </div>
  );
}

export default function ComplianceChecklist({ month, fieldworkType, certificationTrack }: Props) {
  const rules = BACB_RULES[certificationTrack][fieldworkType];
  const today = new Date().getDate();
  const showMvfReminder = today >= 25;

  const total = month?.total_hours ?? 0;
  const supervisorContacts = month?.supervisor_contacts ?? 0;
  const individualContacts = month?.individual_contacts ?? 0;
  const groupContacts = month?.group_contacts ?? 0;
  const clientObs = month?.client_observations ?? 0;
  const supervisionPct = month?.supervision_pct ?? 0;
  const mvfSigned = month?.mvf_signed ?? false;

  const items = [
    {
      label: `Supervisor contacts (${supervisorContacts} / ${rules.contactsPerMonth} required)`,
      met: supervisorContacts >= rules.contactsPerMonth,
    },
    {
      label: "At least 1 individual supervision contact",
      met: individualContacts >= 1,
    },
    {
      label: "Client observation completed this month",
      met: clientObs >= 1,
    },
    {
      label: `Minimum 20 hours logged (${total.toFixed(1)} hrs)`,
      met: total >= 20,
    },
    {
      label: `Supervision % on track (${supervisionPct.toFixed(1)}% / ${rules.supervisionPctMin}% min)`,
      met: supervisionPct >= rules.supervisionPctMin || total === 0,
    },
    {
      label: `Group supervision ≤ individual (${groupContacts} group / ${individualContacts} individual)`,
      met: groupContacts <= Math.max(individualContacts, 1) || groupContacts === 0,
    },
  ];

  if (showMvfReminder) {
    items.push({ label: "M-FVF signed (due by last day of next month)", met: mvfSigned });
  }

  const allMet = items.every(i => i.met);

  return (
    <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>
          This Month's Compliance
        </p>
        {allMet && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#DCFCE7", color: "#16A34A" }}>
            All Good
          </span>
        )}
      </div>
      <div>
        {items.map((item, i) => (
          <CheckItem key={i} label={item.label} met={item.met} />
        ))}
      </div>
    </div>
  );
}
