"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export const dynamic = "force-dynamic";

type Mode = "signin" | "signup" | "forgot";

// ── CSS animations ────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes float1 { 0%,100%{transform:translateY(0) rotate(-4deg)} 50%{transform:translateY(-8px) rotate(-4deg)} }
@keyframes float2 { 0%,100%{transform:translateY(0) rotate(3deg)}  50%{transform:translateY(-6px) rotate(3deg)}  }
@keyframes float3 { 0%,100%{transform:translateY(0) rotate(-2deg)} 50%{transform:translateY(-10px) rotate(-2deg)} }
.btn-gradient {
  background: linear-gradient(135deg, #0F62FE, #1B5BE8);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.btn-gradient:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(15,98,254,0.35);
}
.btn-gradient:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// ── Icons ─────────────────────────────────────────────────────────────────────

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

// ── Left panel ────────────────────────────────────────────────────────────────

function BrandPanel({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return (
      <div className="flex items-center gap-3 px-6 py-5"
        style={{ background: "linear-gradient(135deg, #040D21 0%, #071A52 60%, #0F3496 100%)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #0F62FE, #3FA9F5)" }}>
          <img src="/logo.png" alt="" width={18} height={18} style={{ objectFit: "contain" }} />
        </div>
        <div>
          <p className="text-[14px] font-bold text-white">Path4ABA</p>
          <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
            Documentation · Supervision · Fieldwork
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #040D21 0%, #071A52 35%, #0F3496 65%, #1B5BE8 100%)",
      }}
    >
      {/* Dot grid overlay */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Glow circles */}
      <div className="pointer-events-none" style={{ position:"absolute", width:500, height:500, borderRadius:"50%", background:"rgba(63,169,245,0.12)", filter:"blur(90px)", top:-150, right:-100 }} />
      <div className="pointer-events-none" style={{ position:"absolute", width:350, height:350, borderRadius:"50%", background:"rgba(15,98,254,0.18)", filter:"blur(70px)", top:"35%", left:-100 }} />
      <div className="pointer-events-none" style={{ position:"absolute", width:250, height:250, borderRadius:"50%", background:"rgba(99,179,255,0.1)", filter:"blur(50px)", bottom:100, right:50 }} />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full px-12 py-10" style={{ justifyContent: "space-between", paddingBottom: 32 }}>

        {/* Logo */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #0F62FE, #3FA9F5)" }}>
            <img src="/logo.png" alt="" width={22} height={22} style={{ objectFit: "contain" }} />
          </div>
          <span className="text-[17px] font-bold text-white tracking-tight">Path4ABA</span>
        </div>

        {/* Headline */}
        <div className="mt-10 flex-shrink-0">
          <h1 style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15, margin: 0 }}>
            <span className="text-white">Documentation.</span><br />
            <span style={{ color: "#60A5FA" }}>Supervision.</span><br />
            <span className="text-white">Fieldwork.</span>
          </h1>
          <p className="mt-3 text-[18px] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
            All in one place.
          </p>
        </div>

        {/* Floating cards */}
        <div style={{ position: "relative", marginTop: 32, height: 420 }}>

            {/* Card 3 — Chrome Extension, bottom-center */}
            <div style={{
              position: "absolute", bottom: 0, left: 20, width: 220, zIndex: 1,
              animation: "float3 5s ease-in-out infinite",
              background: "rgba(7,26,82,0.9)", borderRadius: 16, padding: 20,
              border: "1px solid rgba(255,255,255,0.15)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-bold text-white">Path4ABA Extension</p>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(63,169,245,0.2)", color: "#60A5FA" }}>Chrome</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white"
                  style={{ background: "#0F62FE" }}>Generate Note</button>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>AI analyzing session…</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>Note generated in 2.3s</span>
              </div>
            </div>

            {/* Card 2 — Fieldwork Progress, center-right */}
            <div style={{
              position: "absolute", top: 60, right: 0, width: 240, zIndex: 2,
              animation: "float2 4.5s ease-in-out infinite",
              background: "rgba(255,255,255,0.92)", borderRadius: 16, padding: 20,
              borderTop: "3px solid #3FA9F5",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-bold" style={{ color: "#071A52" }}>Fieldwork Progress</p>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "#DCFCE7", color: "#16A34A" }}>On Track</span>
              </div>
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-[11px]" style={{ color: "#94A3B8" }}>872 / 2000 hrs</span>
                <span className="text-[12px] font-bold" style={{ color: "#0F62FE" }}>43.6%</span>
              </div>
              <div style={{ height: 6, background: "#EFF6FF", borderRadius: 99 }}>
                <div style={{ width: "43.6%", height: "100%", background: "linear-gradient(90deg, #0F62FE, #3FA9F5)", borderRadius: 99 }} />
              </div>
            </div>

            {/* Card 1 — Recent Activity, top-left */}
            <div style={{
              position: "absolute", top: 0, left: 0, width: 260, zIndex: 3,
              animation: "float1 4s ease-in-out infinite",
              background: "rgba(255,255,255,0.95)", borderRadius: 16, padding: 20,
              borderTop: "3px solid #0F62FE",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-bold" style={{ color: "#071A52" }}>Recent Activity</p>
                <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "#DCFCE7", color: "#16A34A" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#16A34A", display: "inline-block" }} />
                  Live
                </span>
              </div>
              <div className="space-y-2 mb-3">
                {[
                  { label: "Session note generated", name: "J. Martinez", time: "2m ago", color: "#0F62FE" },
                  { label: "Fieldwork hours logged", name: "A. Chen", time: "14m ago", color: "#3FA9F5" },
                  { label: "Progress report ready", name: "M. Torres", time: "1h ago", color: "#10B981" },
                ].map((item) => (
                  <div key={item.name} className="flex items-center gap-2.5">
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: item.color, flexShrink: 0, display: "inline-block" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold truncate" style={{ color: "#0F172A" }}>{item.label}</p>
                      <p className="text-[10px]" style={{ color: "#94A3B8" }}>{item.name} · {item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-0 pt-2.5" style={{ borderTop: "1px solid #F1F5F9" }}>
                {[
                  { n: "12", label: "Sessions" },
                  { n: "4", label: "Clients" },
                  { n: "98%", label: "Compliance" },
                ].map((s, i) => (
                  <div key={s.label} className="flex-1 text-center" style={{ borderLeft: i > 0 ? "1px solid #F1F5F9" : undefined }}>
                    <p className="text-[13px] font-bold" style={{ color: "#071A52" }}>{s.n}</p>
                    <p className="text-[9px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

        </div>

        {/* HIPAA badge */}
        <div style={{
          marginTop: "auto",
          padding: "12px 20px",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "rgba(255,255,255,0.85)",
          fontSize: 13,
          fontWeight: 500,
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          HIPAA Compliant · Your data is encrypted and secure
        </div>

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
    setError(""); setSuccess(""); setPassword("");
    setFirstName(""); setLastName(""); setConfirmPassword(""); setProfession("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);

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
          email, password,
          name: `${firstName.trim()} ${lastName.trim()}`.trim() || email.split("@")[0],
          role: profession || "rbt",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoading(false);
        if (res.status === 409) setError("__duplicate__");
        else setError(data.error || "Registration failed");
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
  const INPUT_STYLE = { borderColor: "#E2E8F0", color: "#0F172A" };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <div
        className="flex flex-col lg:flex-row"
        style={{ fontFamily: "var(--font-dm-sans, sans-serif)", height: "100vh", overflow: "hidden" }}
      >
        {/* ── Right panel (form) — first in DOM = top on mobile ── */}
        <div className="order-1 lg:order-2"
          style={{ flex: "1 1 50%", height: "100vh", overflowY: "auto", background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}
        >
          <div style={{
            background: "white", borderRadius: 20, padding: 48,
            boxShadow: "0 4px 40px rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.06)",
            width: "100%", maxWidth: 440,
          }}>
            {/* Logo tile + Secure badge */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #0F62FE, #3FA9F5)" }}>
                  <img src="/logo.png" alt="" width={20} height={20} style={{ objectFit: "contain" }} />
                </div>
                <span className="text-[15px] font-bold" style={{ color: "#071A52" }}>Path4ABA</span>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: "#EFF6FF", color: "#0F62FE" }}>🔒 Secure Login</span>
            </div>

            {/* Heading */}
            <div className="mb-7">
              <h2 className="text-[24px] font-bold mb-1" style={{ color: "#0F172A" }}>
                {headings[mode].title}
              </h2>
              <p className="text-[13.5px]" style={{ color: "#94A3B8" }}>
                {headings[mode].subtitle}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* First + Last — signup */}
              {isSignUp && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#64748B" }}>First Name</label>
                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      required autoComplete="given-name" placeholder="Jane"
                      className={`${INPUT_BASE} px-4 py-3`} style={INPUT_STYLE} />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#64748B" }}>Last Name</label>
                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                      required autoComplete="family-name" placeholder="Smith"
                      className={`${INPUT_BASE} px-4 py-3`} style={INPUT_STYLE} />
                  </div>
                </div>
              )}

              {/* Email */}
              <div>
                <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#64748B" }}>Email</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#94A3B8" }}>
                    <IconEnvelope />
                  </span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    required autoComplete="email" placeholder="you@example.com"
                    className={`${INPUT_BASE} pl-10 pr-4 py-3`} style={INPUT_STYLE} />
                </div>
              </div>

              {/* Profession — signup */}
              {isSignUp && (
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#64748B" }}>Profession</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {[{ label: "RBT", value: "rbt" }, { label: "BCBA", value: "bcba" }, { label: "BCaBA", value: "bcaba" }].map(({ label, value }) => (
                      <button key={value} type="button" onClick={() => setProfession(value)}
                        className="py-2.5 rounded-xl border text-sm font-medium transition-colors"
                        style={{ background: profession === value ? "#0F62FE" : "white", borderColor: profession === value ? "#0F62FE" : "#E2E8F0", color: profession === value ? "white" : "#64748B" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ label: "BCBA Student", value: "bcba_student" }, { label: "BCaBA Student", value: "bcaba_student" }].map(({ label, value }) => (
                      <button key={value} type="button" onClick={() => setProfession(value)}
                        className="py-2.5 rounded-xl border text-sm font-medium transition-colors"
                        style={{ background: profession === value ? "#0F62FE" : "white", borderColor: profession === value ? "#0F62FE" : "#E2E8F0", color: profession === value ? "white" : "#64748B" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Password */}
              {!isForgot && (
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#64748B" }}>Password</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#94A3B8" }}>
                      <IconLock />
                    </span>
                    <input type={showPassword ? "text" : "password"}
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      required autoComplete={isSignUp ? "new-password" : "current-password"}
                      placeholder="••••••••"
                      className={`${INPUT_BASE} pl-10 pr-10 py-3`} style={INPUT_STYLE} />
                    <button type="button" onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 hover:opacity-70 transition-opacity"
                      style={{ color: "#94A3B8" }}>
                      <IconEye open={showPassword} />
                    </button>
                  </div>
                </div>
              )}

              {/* Confirm password — signup */}
              {isSignUp && (
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#64748B" }}>Confirm Password</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#94A3B8" }}>
                      <IconLock />
                    </span>
                    <input type={showConfirm ? "text" : "password"}
                      value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      required autoComplete="new-password" placeholder="••••••••"
                      className={`${INPUT_BASE} pl-10 pr-10 py-3`} style={INPUT_STYLE} />
                    <button type="button" onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 hover:opacity-70 transition-opacity"
                      style={{ color: "#94A3B8" }}>
                      <IconEye open={showConfirm} />
                    </button>
                  </div>
                </div>
              )}

              {/* Remember me + Forgot — signin */}
              {!isSignUp && !isForgot && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded" style={{ accentColor: "#0F62FE" }} />
                    <span className="text-[13px]" style={{ color: "#64748B" }}>Remember me</span>
                  </label>
                  <button type="button" onClick={() => switchMode("forgot")}
                    className="text-[13px] font-medium hover:underline" style={{ color: "#0F62FE" }}>
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
              <button type="submit"
                disabled={loading || (isSignUp && (!profession || !firstName.trim() || !lastName.trim()))}
                className="btn-gradient w-full py-3 rounded-xl text-[14px] font-semibold text-white">
                {loading
                  ? (mode === "signin" ? "Signing in…" : mode === "signup" ? "Creating account…" : "Sending…")
                  : (mode === "signin" ? "Continue" : mode === "signup" ? "Create Account" : "Send Reset Link")}
              </button>

              {/* OR + Google — signin */}
              {!isSignUp && !isForgot && (
                <>
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px" style={{ background: "#E2E8F0" }} />
                    <span className="text-[12px]" style={{ color: "#94A3B8" }}>or</span>
                    <div className="flex-1 h-px" style={{ background: "#E2E8F0" }} />
                  </div>
                  <button type="button"
                    className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border text-[13px] font-medium transition-colors hover:bg-gray-50"
                    style={{ borderColor: "#E2E8F0", color: "#374151" }}>
                    <IconGoogle />
                    Continue with Google
                  </button>
                </>
              )}

              {/* Bottom link */}
              <p className="text-center text-[13px]" style={{ color: "#94A3B8" }}>
                {isForgot ? (
                  <button type="button" onClick={() => switchMode("signin")} className="font-semibold hover:underline" style={{ color: "#0F172A" }}>
                    Back to Sign In
                  </button>
                ) : isSignUp ? (
                  <>Already have an account?{" "}
                    <button type="button" onClick={() => switchMode("signin")} className="font-semibold hover:underline" style={{ color: "#0F62FE" }}>
                      Sign In
                    </button>
                  </>
                ) : (
                  <>Don&apos;t have an account?{" "}
                    <a href="/pricing" className="font-semibold hover:underline" style={{ color: "#0F62FE" }}>
                      Create an Account
                    </a>
                  </>
                )}
              </p>

            </form>

            {/* Policy links */}
            <p className="text-center text-[12px] mt-6" style={{ color: "#CBD5E1" }}>
              <a href="/privacy" className="hover:underline" style={{ color: "#CBD5E1" }}>Privacy Policy</a>
              <span className="mx-2">·</span>
              <a href="/terms" className="hover:underline" style={{ color: "#CBD5E1" }}>Terms of Service</a>
            </p>

            {/* Tagline */}
            <p className="text-center text-[12px] mt-4" style={{ color: "#CBD5E1" }}>
              Built for ABA professionals, students, and supervisors.
            </p>

          </div>
        </div>

        {/* ── Left panel (branding) — second in DOM = bottom on mobile ── */}
        <div className="order-2 lg:order-1 hidden lg:block"
          style={{ flex: "0 0 50%", width: "50%", height: "100vh", overflow: "hidden" }}>
          <BrandPanel />
        </div>
        <div className="order-2 lg:hidden">
          <BrandPanel mobile />
        </div>

      </div>
    </>
  );
}
