import Link from "next/link";

// ── Placeholder for the session note form (built later). ────────────────────
const IconBack = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);

export default function AppNotePage() {
  return (
    <main className="app-screen">
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />

      <div className="app-screen__content">
        <Link href="/app/home" className="app-back" aria-label="Back to home">
          <IconBack />
        </Link>

        <div className="app-placeholder">
          <h1 className="app-placeholder__title">Note form</h1>
          <p className="app-placeholder__text">Coming soon.</p>
        </div>
      </div>
    </main>
  );
}
