"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

const CHECK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const FEATURES = [
  "Track BACB fieldwork hours (concentrated & supervised)",
  "Automatic compliance calculations per BACB rules",
  "Monthly eligibility tracking & M-FVF management",
  "Note bank with 200+ BACB-compliant descriptions",
  "AI-generated session notes",
  "Month-end and milestone reminder emails",
];

export default function PaywallScreen() {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleStart() {
    setLoading(true);
    setError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/login"; return; }

    try {
      const res = await fetch("/api/bcba-students/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, interval }),
      });
      const { url, error: err } = await res.json();
      if (err || !url) throw new Error(err || "No checkout URL");
      window.location.href = url;
    } catch (e: any) {
      setError(e.message || "Something went wrong");
      setLoading(false);
    }
  }

  const monthlyPrice = "$14.99";
  const yearlyPrice = "$149";
  const addonMonthly = "$9.99";
  const addonYearly = "$99";

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(13,43,78,0.12)" }}>
          <div className="h-[3px]" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
          <div className="p-8">
            {/* Badge */}
            <div className="flex justify-center mb-5">
              <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full" style={{ background: "rgba(27,168,160,0.12)", color: "var(--teal)" }}>
                BCBA Students Add-on
              </span>
            </div>

            <h1 className="text-[24px] font-semibold text-center mb-2" style={{ color: "var(--text1)" }}>
              Track your BACB fieldwork
            </h1>
            <p className="text-[14px] text-center mb-7" style={{ color: "var(--text3)" }}>
              Automatically calculate hours, track compliance, and never miss a deadline.
            </p>

            {/* Interval toggle */}
            <div className="flex gap-1 p-1 rounded-xl mb-6 mx-auto" style={{ background: "var(--border)", width: "fit-content" }}>
              {(["month", "year"] as const).map((iv) => (
                <button
                  key={iv}
                  onClick={() => setInterval(iv)}
                  className="px-4 py-1.5 rounded-[10px] text-[13px] font-semibold transition-all"
                  style={{
                    background: interval === iv ? "white" : "transparent",
                    color: interval === iv ? "var(--text1)" : "var(--text3)",
                    boxShadow: interval === iv ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  {iv === "month" ? "Monthly" : "Annual"}
                  {iv === "year" && <span className="ml-1.5 text-[10px] font-bold" style={{ color: "var(--teal)" }}>SAVE</span>}
                </button>
              ))}
            </div>

            {/* Price */}
            <div className="text-center mb-2">
              <span className="text-[38px] font-semibold" style={{ color: "var(--text1)" }}>
                {interval === "month" ? monthlyPrice : yearlyPrice}
              </span>
              <span className="text-[14px] ml-1" style={{ color: "var(--text3)" }}>/{interval === "month" ? "mo" : "yr"}</span>
            </div>
            <p className="text-[12px] text-center mb-1" style={{ color: "var(--text3)" }}>
              or {interval === "month" ? addonMonthly : addonYearly}/{interval === "month" ? "mo" : "yr"} with an active RBT plan
            </p>
            <p className="text-[12px] text-center mb-7" style={{ color: "var(--text3)" }}>
              7-day free trial · Card required · Cancel anytime
            </p>

            {error && (
              <p className="text-[13px] px-4 py-3 rounded-xl mb-4 text-center border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                {error}
              </p>
            )}

            <button
              onClick={handleStart}
              disabled={loading}
              className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 mb-6"
              style={{ background: "var(--teal)" }}
            >
              {loading ? "Redirecting…" : "Start Free Trial"}
            </button>

            <div className="h-px mb-5" style={{ background: "var(--border)" }} />

            {/* Features */}
            <ul className="space-y-2.5">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>{CHECK_ICON}</span>
                  <span className="text-[13px]" style={{ color: "var(--text2)" }}>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
