"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PasswordInput } from "@/app/components/PasswordInput";

type Mode = "signin" | "signup" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectMessage = searchParams.get("message");
  const [mode, setMode] = useState<Mode>("signin");
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
      if (authError) {
        setError("Invalid email or password. Please try again.");
        return;
      }
      router.push("/clients");

    } else if (mode === "signup") {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setLoading(false);
        return;
      }
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { profession } },
      });
      setLoading(false);
      if (authError) {
        setError(authError.message);
        return;
      }
      setSuccess("Check your email to confirm your account before signing in.");

    } else {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset-password",
      });
      setLoading(false);
      if (authError) {
        setError(authError.message);
        return;
      }
      setSuccess("Check your email for a password reset link.");
    }
  }

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  const headings: Record<Mode, { title: string; subtitle: string }> = {
    signin: { title: "Welcome back", subtitle: "Sign in to path4aba" },
    signup: { title: "Create an account", subtitle: "Sign up for path4aba" },
    forgot: { title: "Reset your password", subtitle: "Enter your email and we'll send you a reset link" },
  };

  const submitLabel: Record<Mode, [string, string]> = {
    signin: ["Signing in…", "Sign In"],
    signup: ["Creating account…", "Sign Up"],
    forgot: ["Sending…", "Send Reset Link"],
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-10">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{headings[mode].title}</h1>
          <p className="text-sm text-gray-500 mt-1">{headings[mode].subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email — always shown */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-300 text-gray-900"
            />
          </div>

          {/* Profession — sign up only */}
          {isSignUp && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Profession</label>
              <div className="flex gap-2">
                {["BCBA", "BCaBA", "RBT"].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProfession(p)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                      profession === p
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Password — signin and signup only */}
          {!isForgot && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />
              {!isSignUp && (
                <div className="text-right mt-1.5">
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-xs text-gray-500 hover:text-gray-900 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Confirm password — signup only */}
          {isSignUp && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Confirm Password
              </label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
          )}

          {redirectMessage && !error && !success && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              {redirectMessage}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          {success && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || (isSignUp && !profession)}
            className="w-full bg-gray-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? submitLabel[mode][0] : submitLabel[mode][1]}
          </button>

          {/* Bottom toggle links */}
          <p className="text-center text-sm text-gray-500">
            {isForgot ? (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="font-semibold text-gray-900 hover:underline"
              >
                Back to Sign In
              </button>
            ) : isSignUp ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="font-semibold text-gray-900 hover:underline"
                >
                  Sign In
                </button>
              </>
            ) : (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="font-semibold text-gray-900 hover:underline"
                >
                  Sign Up
                </button>
              </>
            )}
          </p>
        </form>

      </div>
    </div>
  );
}
