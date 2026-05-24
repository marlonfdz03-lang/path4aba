"use client";

import { useState } from "react";

const COUNTS: string[] = [
  "Observation and data collection on real clients",
  "Training staff and caregivers on behavior-analytic programs",
  "Conducting assessments related to behavioral intervention",
  "Meeting with clients about behavior-analytic programming",
  "Conducting behavior-analytic assessments (functional analyses, preference assessments)",
  "Data graphing and analysis related to a specific client",
  "Researching literature directly relevant to a current client's programming",
  "Writing and revising behavior-analytic programs for real clients",
];

const DOES_NOT_COUNT: string[] = [
  "Listening to podcasts",
  "Role-playing procedures not related to a real client",
  "Mock client assignments or fictional client scenarios",
  "CEUs, conferences, workshops, or university courses",
  "Homework assignments or non-client readings",
  "Non-behavior-analytic administrative tasks",
  "Crisis management, CPR, or billing system trainings",
  "Diagnostic or intellectual assessments not behavior-analytic in nature",
];

const REMINDERS: string[] = [
  "ALL hours must be related to a specific real client — not hypothetical or generalized activities.",
  "Taking a break from fieldwork under the same supervision contract ends that supervision experience. You must complete an F-FVF before the break.",
  "Concentrated fieldwork hours cannot be prorated or adjusted under any circumstances.",
  "These rules are retroactive — hours that don't meet requirements should not be counted even if already logged.",
];

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconInfo = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export default function ComplianceGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      {/* Header — always visible, click to toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(27,168,160,0.1)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>BACB Compliance Guide</p>
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>What counts as fieldwork, what doesn't, and critical reminders</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          <span
            className="text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full hidden sm:inline"
            style={{ background: "rgba(27,168,160,0.12)", color: "var(--teal)" }}
          >
            BACB Updated Aug 2025
          </span>
          <span style={{ color: "var(--text3)" }}>
            <IconChevron open={open} />
          </span>
        </div>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-5">

            {/* Column 1: What counts */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <span style={{ color: "#16A34A" }}><IconCheck /></span>
                <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#15803D" }}>What counts (unrestricted hours)</p>
              </div>
              <ul className="space-y-2">
                {COUNTS.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span style={{ color: "#16A34A", marginTop: 2 }}><IconCheck /></span>
                    <span className="text-[12px] leading-relaxed" style={{ color: "var(--text2)" }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 2: What does NOT count */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <span style={{ color: "#DC2626" }}><IconX /></span>
                <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#B91C1C" }}>What does NOT count</p>
              </div>
              <ul className="space-y-2">
                {DOES_NOT_COUNT.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span style={{ color: "#DC2626", marginTop: 2 }}><IconX /></span>
                    <span className="text-[12px] leading-relaxed" style={{ color: "var(--text2)" }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 3: Important reminders */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <span style={{ color: "#D97706" }}><IconInfo /></span>
                <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#B45309" }}>Important reminders</p>
              </div>
              <ul className="space-y-3">
                {REMINDERS.map((item) => (
                  <li key={item} className="flex items-start gap-2 px-3 py-2.5 rounded-lg" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                    <span style={{ color: "#D97706", marginTop: 1 }}><IconInfo /></span>
                    <span className="text-[12px] leading-relaxed" style={{ color: "#92400E" }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>

          {/* Footer disclaimer */}
          <div className="px-5 pb-4">
            <p className="text-[11px]" style={{ color: "var(--text3)" }}>
              Based on the BACB Fieldwork Standards updated August 2025. Always verify against the current official BACB documentation at{" "}
              <span style={{ color: "var(--teal)" }}>bacb.com</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
