import Link from "next/link";

// ── "Who are you?" role selection. Two paths: clinician or parent. ──────────
const IconBack = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);
const IconClinician = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1Z" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <path d="M9 14h.01M9 18h.01M13 14h3M13 18h3" />
  </svg>
);
const IconParent = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.8 8.6a3.6 3.6 0 0 0-5.1 0l-.7.7-.7-.7a3.6 3.6 0 1 0-5.1 5.1l5.8 5.8 5.8-5.8a3.6 3.6 0 0 0 0-5.1Z" />
  </svg>
);
const IconChevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export default function AppRolePage() {
  return (
    <main className="app-screen">
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />

      <div className="app-screen__content">
        <Link href="/app" className="app-back" aria-label="Back to welcome">
          <IconBack />
        </Link>

        <h1 className="app-auth__title">Who are you?</h1>
        <p className="app-auth__subtitle">Choose how you&apos;ll use Path4ABA.</p>

        <div className="app-role-list">
          <Link href="/app/signup?role=clinician" className="app-role-card">
            <span className="app-role-card__icon"><IconClinician /></span>
            <span className="app-role-card__body">
              <span className="app-role-card__title">Clinician</span>
              <span className="app-role-card__desc">
                RBT, BCBA, or student — write notes &amp; track data.
              </span>
            </span>
            <span className="app-role-card__chevron"><IconChevron /></span>
          </Link>

          <Link href="/app/signup?role=parent" className="app-role-card">
            <span className="app-role-card__icon"><IconParent /></span>
            <span className="app-role-card__body">
              <span className="app-role-card__title">Parent or caregiver</span>
              <span className="app-role-card__desc">
                Follow your child&apos;s progress &amp; sign off.
              </span>
            </span>
            <span className="app-role-card__chevron"><IconChevron /></span>
          </Link>
        </div>
      </div>
    </main>
  );
}
