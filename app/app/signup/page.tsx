"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// ── Placeholder signup screen. Reads ?role= and shows what's coming next. ───
const IconBack = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);

const ROLE_LABELS: Record<string, string> = {
  clinician: "Clinician sign-up",
  parent: "Parent sign-up",
};

function SignupContent() {
  const role = useSearchParams().get("role") ?? "";
  const title = ROLE_LABELS[role] ?? "Create your account";

  return (
    <div className="app-screen__content">
      <Link href="/app/role" className="app-back" aria-label="Back to role selection">
        <IconBack />
      </Link>

      <div className="app-placeholder">
        <h1 className="app-placeholder__title">{title}</h1>
        <p className="app-placeholder__text">Coming next.</p>
      </div>
    </div>
  );
}

export default function AppSignupPage() {
  return (
    <main className="app-screen">
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />
      {/* useSearchParams requires a Suspense boundary (matches website login) */}
      <Suspense fallback={null}>
        <SignupContent />
      </Suspense>
    </main>
  );
}
