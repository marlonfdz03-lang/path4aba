"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export const dynamic = "force-dynamic";

type Mode = "signin" | "signup" | "forgot";

// ── Icons ────────────────────────────────────────────────────────────────────

function IconEnvelope() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function IconEye({ open }: { open: boolean }) {
  return open ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function IconGoogle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
    </svg>
  );
}

// ── Left branding panel ───────────────────────────────────────────────────────

function BrandPanel({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    // Mobile: compact strip with navy background + logo
    return (
      <div
        className="flex items-center gap-3 px-6 py-5"
        style={{ background: "var(--navy)" }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
        >
          <img src="/logo.png" alt="" width={18} height={18} style={{ objectFit: "contain" }} />
        </div>
        <span className="text-[15px] font-bold text-white tracking-tight">
          Path<span style={{ color: "var(--teal2)" }}>4</span>ABA
        </span>
        <p className="text-[12px] ml-1" style={{ color: "rgba(255,255,255,0.45)" }}>
          · AI-powered ABA tools
        </p>
      </div>
    );
  }

  // Desktop: hero image with dark overlay + logo top-left
  return (
    <div
      className="relative flex flex-col h-full"
      style={{
        backgroundImage: "url('/login-hero.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Dark overlay for readability */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(10, 22, 40, 0.55)" }}
      />

      {/* Logo — positioned top-left over the overlay */}
      <div className="relative z-10 flex items-center gap-3 p-8">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
        >
          <img src="/logo.png" alt="" width={22} height={22} style={{ objectFit: "contain" }} />
        </div>
        <span className="text-[16px] font-bold text-white tracking-tight">
          Path<span style={{ color: "var(--teal2)" }}>4</span>ABA
        </span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectMessage = searchParams.get("message");
  const initialMode = (searchParams.get("mode") as Mode) || "signin";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profession, setProfession] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setSuccess("");
    setPassword("");
    setFirstName("");
    setLastName("");
    setConfirmPassword("");
    setProfession("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (mode === "signin") {
      const result = await signIn("credentials", { email, password, redirect: false });
      setLoading(false);
      if (result?.error) { setError("Invalid email or password. Please try again."); return; }
      router.push("/dashboard");

    } else if (mode === "signup") {
      if (password !== confirmPassword) { setError("Passwords do not match."); setLoading(false); return; }

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: `${firstName.trim()} ${lastName.trim()}`.trim() || email.split("@")[0],
          role: profession || "rbt",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setLoading(false);
        if (res.status === 409) { setError("__duplicate__"); }
        else { setError(data.error || "Registration failed"); }
        return;
      }

      await signIn("credentials", { email, password, redirect: false });
      setLoading(false);
      router.push("/pricing");
      return;

    } else {
      await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setLoading(false);
      setSuccess("✅ Check your email for a password reset link. (Check spam folder if you don't see it)");
    }
  }

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  const headings: Record<Mode, { title: string; subtitle: string }> = {
    signin: { title: "Welcome Back", subtitle: "Sign in to your Path4ABA account" },
    signup: { title: "Create Account", subtitle: "Join Path4ABA today" },
    forgot: { title: "Reset Password", subtitle: "Enter your email and we'll send a reset link" },
  };

  const INPUT_BASE = "w-full border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors";
  const INPUT_STYLE = { borderColor: "var(--border)", color: "var(--text1)" };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row"
      style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}
    >
      {/* Right panel (form) — first in DOM = top on mobile */}
      <div className="order-1 lg:order-2 flex-1 flex items-center justify-center bg-white p-8 lg:p-12">
        <div className="w-full max-w-[400px]">

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-[26px] font-bold mb-1.5" style={{ color: "var(--text1)" }}>
              {headings[mode].title}
            </h2>
            <p className="text-[14px]" style={{ color: "var(--text3)" }}>
              {headings[mode].subtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* First + Last Name — signup only */}
            {isSignUp && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>First Name</label>
                  <input
                    type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    required autoComplete="given-name" placeholder="Jane"
                    className={`${INPUT_BASE} px-4 py-3`} style={INPUT_STYLE}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Last Name</label>
                  <input
                    type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                    required autoComplete="family-name" placeholder="Smith"
                    className={`${INPUT_BASE} px-4 py-3`} style={INPUT_STYLE}
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Email</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text3)" }}>
                  <IconEnvelope />
                </span>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required autoComplete="email" placeholder="you@example.com"
                  className={`${INPUT_BASE} pl-10 pr-4 py-3`} style={INPUT_STYLE}
                />
              </div>
            </div>

            {/* Profession — signup only */}
            {isSignUp && (
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Profession</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { label: "RBT", value: "rbt" },
                    { label: "BCBA", value: "bcba" },
                    { label: "BCaBA", value: "bcaba" },
                  ].map(({ label, value }) => (
                    <button key={value} type="button" onClick={() => setProfession(value)}
                      className="py-2.5 rounded-xl border text-sm font-medium transition-colors"
                      style={{ background: profession === value ? "var(--teal)" : "white", borderColor: profession === value ? "var(--teal)" : "var(--border)", color: profession === value ? "white" : "var(--text2)" }}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "BCBA Student", value: "bcba_student" },
                    { label: "BCaBA Student", value: "bcaba_student" },
                  ].map(({ label, value }) => (
                    <button key={value} type="button" onClick={() => setProfession(value)}
                      className="py-2.5 rounded-xl border text-sm font-medium transition-colors"
                      style={{ background: profession === value ? "var(--teal)" : "white", borderColor: profession === value ? "var(--teal)" : "var(--border)", color: profession === value ? "white" : "var(--text2)" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Password */}
            {!isForgot && (
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Password</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text3)" }}>
                    <IconLock />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    required autoComplete={isSignUp ? "new-password" : "current-password"}
                    placeholder="••••••••"
                    className={`${INPUT_BASE} pl-10 pr-10 py-3`} style={INPUT_STYLE}
                  />
                  <button
                    type="button" onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 hover:opacity-70 transition-opacity"
                    style={{ color: "var(--text3)" }}
                  >
                    <IconEye open={showPassword} />
                  </button>
                </div>
              </div>
            )}

            {/* Confirm password — signup only */}
            {isSignUp && (
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Confirm Password</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text3)" }}>
                    <IconLock />
                  </span>
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    required autoComplete="new-password"
                    placeholder="••••••••"
                    className={`${INPUT_BASE} pl-10 pr-10 py-3`} style={INPUT_STYLE}
                  />
                  <button
                    type="button" onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 hover:opacity-70 transition-opacity"
                    style={{ color: "var(--text3)" }}
                  >
                    <IconEye open={showConfirm} />
                  </button>
                </div>
              </div>
            )}

            {/* Remember me + Forgot password — signin only */}
            {!isSignUp && !isForgot && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded" style={{ accentColor: "var(--teal)" }}
                  />
                  <span className="text-[13px]" style={{ color: "var(--text2)" }}>Remember me</span>
                </label>
                <button
                  type="button" onClick={() => switchMode("forgot")}
                  className="text-[13px] font-medium hover:underline" style={{ color: "var(--teal)" }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {/* Messages */}
            {redirectMessage && !error && !success && (
              <p className="text-[13px] rounded-xl px-4 py-3 border" style={{ background: "#F0FDF4", borderColor: "#BBF7D0", color: "#15803D" }}>
                {redirectMessage}
              </p>
            )}
            {error && error !== "__duplicate__" && (
              <p className="text-[13px] rounded-xl px-4 py-3 border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                {error}
              </p>
            )}
            {error === "__duplicate__" && (
              <div className="text-[13px] rounded-xl px-4 py-3 border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                An account with this email already exists.{" "}
                <button type="button" onClick={() => switchMode("signin")} className="font-semibold underline hover:opacity-80">
                  Sign in instead
                </button>
              </div>
            )}
            {success && (
              <p className="text-[13px] rounded-xl px-4 py-3 border" style={{ background: "#F0FDF4", borderColor: "#BBF7D0", color: "#15803D" }}>
                {success}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || (isSignUp && (!profession || !firstName.trim() || !lastName.trim()))}
              className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--teal)" }}
            >
              {loading
                ? (mode === "signin" ? "Signing in…" : mode === "signup" ? "Creating account…" : "Sending…")
                : (mode === "signin" ? "Continue" : mode === "signup" ? "Create Account" : "Send Reset Link")}
            </button>

            {/* OR divider + Google — signin only */}
            {!isSignUp && !isForgot && (
              <>
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                  <span className="text-[12px]" style={{ color: "var(--text3)" }}>or</span>
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                </div>
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border text-[13px] font-medium transition-colors hover:bg-gray-50"
                  style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                >
                  <IconGoogle />
                  Continue with Google
                </button>
              </>
            )}

            {/* Bottom link */}
            <p className="text-center text-[13px]" style={{ color: "var(--text3)" }}>
              {isForgot ? (
                <button type="button" onClick={() => switchMode("signin")} className="font-semibold hover:underline" style={{ color: "var(--text1)" }}>
                  Back to Sign In
                </button>
              ) : isSignUp ? (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => switchMode("signin")} className="font-semibold hover:underline" style={{ color: "var(--teal)" }}>
                    Sign In
                  </button>
                </>
              ) : (
                <>
                  Don&apos;t have an account?{" "}
                  <a href="/pricing" className="font-semibold hover:underline" style={{ color: "var(--teal)" }}>
                    Create an Account
                  </a>
                </>
              )}
            </p>

          </form>

          {/* Policy links */}
          <p className="text-center text-[12px] mt-8" style={{ color: "var(--text3)" }}>
            <a href="/privacy" className="hover:underline" style={{ color: "var(--text3)" }}>Privacy Policy</a>
            <span className="mx-2">·</span>
            <a href="/terms" className="hover:underline" style={{ color: "var(--text3)" }}>Terms of Service</a>
          </p>

        </div>
      </div>

      {/* Left panel (branding) — second in DOM = bottom on mobile */}
      <div className="order-2 lg:order-1 lg:w-[480px] lg:flex-shrink-0 lg:min-h-screen">
        <div className="hidden lg:flex lg:flex-col lg:min-h-screen">
          <BrandPanel />
        </div>
        <div className="lg:hidden">
          <BrandPanel mobile />
        </div>
      </div>

    </div>
  );
}
