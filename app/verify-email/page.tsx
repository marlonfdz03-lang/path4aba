"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!code || code.length < 6) {
      setError("Please enter a valid 6-digit code");
      setLoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: localStorage.getItem("signup_email") || "",
      token: code,
      type: "email",
    });

    setLoading(false);

    if (verifyError) {
      setError("Invalid code. Please try again.");
      return;
    }

    localStorage.removeItem("signup_email");

    // Check if user already has a subscription (returning user) or needs onboarding
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      router.push(sub ? "/dashboard" : "/onboarding");
    } else {
      router.push("/onboarding");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Verify your email</h1>
          <p className="text-sm text-gray-600 mt-2">
            Enter the 6-digit code we sent to your email
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Verification Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="000000"
              maxLength={6}
              className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-center text-2xl font-bold tracking-widest focus:outline-none focus:border-black transition-colors"
              autoComplete="off"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white rounded-xl py-3 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Verifying…" : "Verify Code"}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-6 text-center">
          Didn't receive a code? Check your spam folder or{" "}
          <button
            onClick={() => router.push("/login?mode=signup")}
            className="text-black font-semibold underline hover:opacity-70"
          >
            try signing up again
          </button>
        </p>
      </div>
    </div>
  );
}
