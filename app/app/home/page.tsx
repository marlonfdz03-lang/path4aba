import Link from "next/link";

// ── Mock data (replace with real session data later) ────────────────────────
const SESSIONS = [
  { name: "Alexandra", time: "3:00 PM", note: "pending", signature: "signed" },
  { name: "Daniel", time: "5:00 PM", note: "pending", signature: "pending" },
];

// ── Icons (same inline-stroke approach as login/page.tsx) ───────────────────
const IconClock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

// A "done" status is anything signed/completed; everything else reads as pending.
const isDone = (status: string) => status === "signed" || status === "completed";

function StatusPill({ label, status }: { label: string; status: string }) {
  const done = isDone(status);
  return (
    <span className={`app-pill ${done ? "app-pill--done" : "app-pill--pending"}`}>
      <span className="app-pill__dot" />
      {label}
    </span>
  );
}

function greeting(): string {
  // Computed at request time (server clock). Fine for this mock screen; a real
  // build should derive this from the user's timezone.
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const initials = (name: string) => name.slice(0, 2).toUpperCase();

export default function AppHomePage() {
  return (
    <main className="app-screen">
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />

      <div className="app-screen__content">
        {/* 1. Header */}
        <header className="app-home__header">
          <div>
            <p className="app-home__greeting">{greeting()}</p>
            <h1 className="app-home__name">Marlon</h1>
          </div>
          <div className="app-home__avatar" aria-hidden="true">MF</div>
        </header>

        {/* 2. Progress card */}
        <section className="app-progress app-glass">
          <p className="app-progress__label">Today&apos;s progress</p>
          <p className="app-progress__count">1 of 3 completed</p>
          <div className="app-progress__bar">
            <div className="app-progress__fill" style={{ width: "33%" }} />
          </div>
        </section>

        {/* 3. Section label */}
        <p className="app-section-label">Pending today</p>

        {/* 4. Session cards */}
        <div className="app-session-list">
          {SESSIONS.map((s) => (
            <Link key={s.name} href="/app/note" className="app-session-card">
              <span className="app-session-card__avatar">{initials(s.name)}</span>
              <span className="app-session-card__body">
                <span className="app-session-card__name">{s.name}</span>
                <span className="app-session-card__time">
                  <IconClock /> {s.time}
                </span>
                <span className="app-session-card__pills">
                  <StatusPill label="Note" status={s.note} />
                  <StatusPill label="Signature" status={s.signature} />
                </span>
              </span>
            </Link>
          ))}
        </div>

        {/* 5. Primary action */}
        <Link href="/app/note" className="app-btn app-btn--primary app-home__cta">
          Complete now
        </Link>
      </div>
    </main>
  );
}
