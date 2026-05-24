"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PasswordInput } from "@/app/components/PasswordInput";

export const dynamic = "force-dynamic";

type Mode = "signin" | "signup" | "forgot";

const INPUT_CLS = "w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 transition-colors";

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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profession, setProfession] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setSuccess("");
    setPassword("");
    setConfirmPassword("");
    setProfession("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (mode === "signin") {
      const { error: authError } = await signIn(email, password);
      setLoading(false);
      if (authError) { setError("Invalid email or password. Please try again."); return; }
      router.push("/dashboard");

    } else if (mode === "signup") {
      if (password !== confirmPassword) { setError("Passwords do not match."); setLoading(false); return; }
      
      // NOTE: Supabase Dashboard must be configured to send OTP codes, not magic links.
      // Authentication → Providers → Email → disable "Confirm email" link, enable OTP (6-digit code).
      const { data: signUpData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: undefined, // disable magic link — forces OTP code delivery
          data: { profession },
        }
      });
      
      if (authError) {
        setLoading(false);
        if (authError.message.toLowerCase().includes("already registered") || authError.message.toLowerCase().includes("already exists")) {
          setError("__duplicate__");
        } else {
          setError(authError.message);
        }
        return;
      }
      if (signUpData.user) {
        setLoading(false);
        router.push("/onboarding");
        return;
      }
      setLoading(false);

    } else {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      setLoading(false);
      if (authError) { setError(authError.message); return; }
      setSuccess("✅ Check your email for a password reset link. (Check spam folder if you don't see it)");
    }
  }

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  const headings: Record<Mode, { title: string; subtitle: string }> = {
    signin: { title: "Welcome back", subtitle: "Sign in to your Path4ABA account" },
    signup: { title: "Create an account", subtitle: "Join Path4ABA today" },
    forgot: { title: "Reset your password", subtitle: "Enter your email and we'll send you a reset link" },
  };

  const submitLabel: Record<Mode, [string, string]> = {
    signin: ["Signing in…", "Sign in"],
    signup: ["Creating account…", "Sign Up"],
    forgot: ["Sending…", "Send Reset Link"],
  };

  return (
    <div className="min-h-screen flex" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>

      {/* ── Left: Form panel ── */}
      <div className="flex-1 flex items-center justify-center p-10 bg-white">
        <div className="w-full max-w-[380px]">

          {/* Mobile logo (hidden on desktop when right panel is visible) */}
          <div className="mb-8">
            <h1 className="text-[22px] font-semibold mb-1" style={{ color: "var(--text1)" }}>
              {headings[mode].title}
            </h1>
            <p className="text-[13.5px]" style={{ color: "var(--text3)" }}>
              {headings[mode].subtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <div>
              <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Email</label>
              <input
                type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email" placeholder="you@example.com"
                className={INPUT_CLS}
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
            </div>

            {/* Profession — sign up only */}
            {isSignUp && (
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Profession</label>
                <div className="flex gap-2">
                  {["BCBA", "BCaBA", "RBT"].map((p) => (
                    <button
                      key={p} type="button" onClick={() => setProfession(p)}
                      className="flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors"
                      style={{
                        background: profession === p ? "var(--teal)" : "white",
                        borderColor: profession === p ? "var(--teal)" : "var(--border)",
                        color: profession === p ? "white" : "var(--text2)",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Password */}
            {!isForgot && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[13px] font-medium" style={{ color: "var(--text2)" }}>Password</label>
                  {!isSignUp && (
                    <button
                      type="button" onClick={() => switchMode("forgot")}
                      className="text-[12px] font-medium hover:underline"
                      style={{ color: "var(--teal)" }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <PasswordInput
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  required autoComplete={isSignUp ? "new-password" : "current-password"}
                />
              </div>
            )}

            {/* Confirm password */}
            {isSignUp && (
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Confirm Password</label>
                <PasswordInput
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  required autoComplete="new-password"
                />
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
              disabled={loading || (isSignUp && !profession)}
              className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--teal)" }}
            >
              {loading ? submitLabel[mode][0] : submitLabel[mode][1]}
            </button>

            {/* Divider + social (sign in only) */}
            {!isSignUp && !isForgot && (
              <>
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                  <span className="text-[12px]" style={{ color: "var(--text3)" }}>or continue with</span>
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                </div>
                <div className="flex gap-3">
                  {["Google", "Microsoft"].map((provider) => (
                    <button
                      key={provider} type="button"
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[13px] font-medium transition-colors hover:bg-gray-50"
                      style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                    >
                      {provider === "Google" ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M11.5 2H2v9.5h9.5V2z" fill="#F25022"/>
                          <path d="M22 2h-9.5v9.5H22V2z" fill="#7FBA00"/>
                          <path d="M11.5 12.5H2V22h9.5v-9.5z" fill="#00A4EF"/>
                          <path d="M22 12.5h-9.5V22H22v-9.5z" fill="#FFB900"/>
                        </svg>
                      )}
                      {provider}
                    </button>
                  ))}
                </div>
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
                  <button type="button" onClick={() => switchMode("signup")} className="font-semibold hover:underline" style={{ color: "var(--teal)" }}>
                    Sign up
                  </button>
                </>
              )}
            </p>

          </form>
        </div>
      </div>

      {/* ── Right: Brand panel ── */}
      <div
        className="hidden lg:flex flex-col items-center justify-center flex-1 p-12 relative overflow-hidden"
        style={{ background: "var(--navy)" }}
      >
        {/* Background glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 60% 40%, rgba(27,168,160,0.18) 0%, transparent 70%)" }}
        />

        <div className="relative z-10 text-center max-w-sm">
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <span style={{ fontSize: "32px", fontWeight: "700", color: "#ffffff", letterSpacing: "-0.5px" }}>
              Path<span style={{ color: "#1BA8A0" }}>4</span>ABA
            </span>
          </div>

          {/* Tagline */}
          <h2 className="text-[26px] font-semibold leading-snug mb-4 text-white">
            Clinical tools.<br />Smarter notes.<br />Better outcomes.
          </h2>
          <p className="text-[14px]" style={{ color: "rgba(255,255,255,0.5)" }}>
            Built for RBTs. Backed by BCBAs.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2 mt-10">
            {["AI Note Generation", "Clinical Profiles", "Session Tracking", "Audit-Ready"].map((f) => (
              <span
                key={f}
                className="text-[12px] font-medium px-3 py-1.5 rounded-full"
                style={{ background: "rgba(27,168,160,0.18)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(27,168,160,0.3)" }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
