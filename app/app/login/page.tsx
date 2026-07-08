"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

// ── Inline icons (match the website's stroke-icon style) ────────────────────
const IconBack = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);
const IconMail = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" />
  </svg>
);
const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const IconFaceId = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <line x1="9" y1="9" x2="9" y2="10" /><line x1="15" y1="9" x2="15" y2="10" />
    <path d="M12 9v3.5a1 1 0 0 1-1 1" /><path d="M8.5 15.5a4 4 0 0 0 7 0" />
  </svg>
);

export default function AppLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Reuse the SAME NextAuth credentials flow as the website login.
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid email or password. Please try again.");
        return;
      }
      router.push("/app/home");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-screen">
      {/* Ambient corner glows for depth */}
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />

      <div className="app-screen__content">
        <Link href="/app" className="app-back" aria-label="Back to welcome">
          <IconBack />
        </Link>

        <h1 className="app-auth__title">Welcome back</h1>
        <p className="app-auth__subtitle">Sign in to continue.</p>

        <form className="app-form" onSubmit={handleSubmit} noValidate>
          {error && <div className="app-error" role="alert">{error}</div>}

          <label className="app-field">
            <span className="app-field__icon"><IconMail /></span>
            <input
              className="app-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="app-field">
            <span className="app-field__icon"><IconLock /></span>
            <input
              className="app-input"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <div className="app-form__row">
            {/* Placeholder — reset flow wired later */}
            <button type="button" className="app-link">Forgot password?</button>
          </div>

          <button type="submit" className="app-btn app-btn--primary" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {/* Visual-only placeholder — biometric auth wired later */}
          <button type="button" className="app-btn app-btn--secondary">
            <span className="app-btn__icon"><IconFaceId /></span>
            Face ID
          </button>
        </form>

        <p className="app-auth__foot">
          New here?{" "}
          <Link href="/app/role" className="app-link">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
