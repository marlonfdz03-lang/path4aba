"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSession } from "next-auth/react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsTab = "profile" | "billing" | "extension";

type Sub = {
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  stripe_customer_id: string | null;
};

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const { data: session, status } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (session?.user) {
      const parts = (session.user.name || "").split(" ");
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
      setEmail(session.user.email || "");
    }
  }, [session]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${firstName} ${lastName}`.trim(), email }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") return <div className="text-sm" style={{ color: "var(--text3)" }}>Loading…</div>;

  return (
    <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
      <div className="h-[3px] -mx-6 -mt-6 mb-6 rounded-t-xl" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
      <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Profile</p>
      <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>Update your name and email address.</p>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>First name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          />
        </div>
        {error && <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#fef2f2", color: "#991b1b" }}>{error}</p>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-60 transition-opacity hover:opacity-90"
          style={{ background: saved ? "#16a34a" : "var(--teal)" }}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ── Billing helpers ───────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  trial: "Free Trial",
  rbt: "RBT Plan",
  bcba_starter: "BCBA / BCaBA Starter",
  bcba_pro: "BCBA / BCaBA Pro",
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  trialing: { bg: "#EFF6FF", color: "#1D4ED8", label: "Trial" },
  active:   { bg: "#E6F9F5", color: "#0D8A6A", label: "Active" },
  canceled: { bg: "#FEF2F2", color: "#DC2626", label: "Canceled" },
  expired:  { bg: "#FEF2F2", color: "#DC2626", label: "Expired" },
};

function daysRemaining(dateStr: string) {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ── Billing tab ───────────────────────────────────────────────────────────────

function BillingTab() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [sub, setSub] = useState<Sub | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }

    fetch("/api/user/subscription")
      .then((r) => r.json())
      .then((d) => {
        setSub(d.sub ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [status, session, router]);

  const userId = (session?.user as any)?.id ?? null;

  async function handleManage() {
    if (!userId) return;
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const { url, error } = await res.json();
      if (error || !url) throw new Error(error || "No portal URL");
      window.location.href = url;
    } catch {
      setPortalLoading(false);
    }
  }

  const statusStyle = sub ? (STATUS_STYLES[sub.status] ?? STATUS_STYLES.expired) : null;
  const isTrialing = sub?.status === "trialing";
  const isActive = sub?.status === "active";

  if (!loaded) {
    return (
      <div className="bg-white rounded-xl p-10 text-center text-sm" style={{ color: "var(--text3)", border: "1px solid var(--border)" }}>
        Loading…
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="bg-white rounded-xl p-8" style={{ border: "1px solid var(--border)" }}>
        <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text1)" }}>No active subscription</p>
        <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>Start a free 7-day trial to get full access.</p>
        <a href="/pricing" className="inline-flex px-5 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: "var(--teal)" }}>
          View Plans
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current plan */}
      <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
        <div className="h-[3px] -mx-6 -mt-6 mb-6 rounded-t-xl" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text3)" }}>Current Plan</p>
            <p className="text-[20px] font-semibold" style={{ color: "var(--text1)" }}>{PLAN_LABELS[sub.plan] ?? sub.plan}</p>
          </div>
          {statusStyle && (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-full flex-shrink-0" style={{ background: statusStyle.bg, color: statusStyle.color }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {statusStyle.label}
            </span>
          )}
        </div>
        <div className="mt-5 space-y-3">
          {isTrialing && sub.trial_ends_at && (
            <div className="flex items-center justify-between">
              <p className="text-[13px]" style={{ color: "var(--text2)" }}>Trial ends</p>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>
                {formatDate(sub.trial_ends_at)}{" "}
                <span style={{ color: "var(--teal)", fontWeight: 500 }}>({daysRemaining(sub.trial_ends_at)} days remaining)</span>
              </p>
            </div>
          )}
          {isActive && sub.current_period_ends_at && (
            <div className="flex items-center justify-between">
              <p className="text-[13px]" style={{ color: "var(--text2)" }}>Next billing date</p>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{formatDate(sub.current_period_ends_at)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
        <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Manage subscription</p>
        <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>Update payment method, change plan, or cancel via the Stripe billing portal.</p>
        {sub.stripe_customer_id ? (
          <button
            onClick={handleManage}
            disabled={portalLoading}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: "var(--navy)" }}
          >
            {portalLoading ? "Opening portal…" : "Manage Subscription"}
          </button>
        ) : (
          <a href="/pricing" className="inline-flex px-5 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: "var(--teal)" }}>
            {isTrialing ? "Subscribe Now" : "Choose a Plan"}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Extension tab ─────────────────────────────────────────────────────────────

function fmtTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " at " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

function ExtensionTab() {
  const [hasToken, setHasToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/extension/token")
      .then((r) => r.json())
      .then((d) => {
        setHasToken(d.hasToken ?? false);
        setLastUsed(d.lastUsedAt ?? null);
        setCreatedAt(d.createdAt ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function generate() {
    setLoading(true);
    setNewToken(null);
    try {
      const res = await fetch("/api/extension/token", { method: "POST" });
      const d = await res.json();
      if (d.token) {
        setNewToken(d.token);
        setHasToken(true);
        setLastUsed(null);
        setCreatedAt(new Date().toISOString());
      }
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    if (!confirm("Revoke the extension token? The extension will stop working until you generate a new one.")) return;
    setLoading(true);
    try {
      await fetch("/api/extension/token", { method: "DELETE" });
      setHasToken(false);
      setNewToken(null);
      setLastUsed(null);
      setCreatedAt(null);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!loaded) return <div className="text-sm" style={{ color: "var(--text3)" }}>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
        <div className="h-[3px] -mx-6 -mt-6 mb-6 rounded-t-xl" style={{ background: "linear-gradient(90deg, #16a34a, #0d6e6e)" }} />
        <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Chrome Extension Token</p>
        <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>
          Generate a personal token to activate the Path4ABA Chrome extension. Only one token can be active at a time — generating a new one immediately revokes the previous. Revoke immediately if you suspect unauthorized access.
        </p>

        {newToken ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[12px] font-semibold text-green-700">✓ Token generated</span>
              <span className="text-[11px]" style={{ color: "var(--text3)" }}>— copy it now, it won&apos;t be shown again</span>
            </div>
            <div className="flex gap-2 mt-3 mb-4">
              <code className="flex-1 bg-gray-50 rounded-lg px-3 py-2.5 text-[11px] font-mono break-all leading-relaxed" style={{ border: "1px solid var(--border)", color: "var(--text1)" }}>
                {newToken}
              </code>
              <button
                onClick={copy}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white flex-shrink-0 self-start"
                style={{ background: copied ? "#16a34a" : "var(--teal)" }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-[12px]" style={{ color: "var(--text3)" }}>
              Open the Path4ABA extension → paste this token → click Activate.
            </p>
          </div>
        ) : hasToken ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <span className="text-[13px] text-green-700 font-medium">Token active</span>
            </div>
            <div className="space-y-1 mb-5 pl-4" style={{ borderLeft: "2px solid var(--border)" }}>
              {createdAt && (
                <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                  Created{" "}
                  <span style={{ color: "var(--text2)", fontWeight: 500 }}>
                    {fmtTimestamp(createdAt)}
                  </span>
                </p>
              )}
              <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                Last used{" "}
                {lastUsed ? (
                  <span style={{ color: "var(--text1)", fontWeight: 500 }}>
                    {fmtTimestamp(lastUsed)}
                  </span>
                ) : (
                  <span style={{ color: "var(--text3)" }}>never</span>
                )}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={generate} disabled={loading} className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: "var(--teal)" }}>
                {loading ? "Generating…" : "Regenerate Token"}
              </button>
              <button onClick={revoke} disabled={loading} className="px-5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-60" style={{ color: "var(--text3)", border: "1px solid var(--border)" }}>
                Revoke
              </button>
            </div>
          </div>
        ) : (
          <button onClick={generate} disabled={loading} className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: "var(--teal)" }}>
            {loading ? "Generating…" : "Generate Extension Token"}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
        <p className="text-[13px] font-semibold mb-3" style={{ color: "var(--text1)" }}>How to activate</p>
        <ol className="space-y-2">
          {["Generate a token using the button above.", "Click Copy to copy it to your clipboard.", "Open the Path4ABA Chrome extension popup.", "Paste the token in the activation field and click Activate."].map((step, i) => (
            <li key={i} className="flex gap-3 text-[13px]" style={{ color: "var(--text2)" }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ background: "var(--border)", color: "var(--text3)" }}>{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as SettingsTab) || "billing";
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "billing", label: "Billing" },
    { id: "extension", label: "Extension" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Settings</p>
      </div>

      <div className="px-8 py-8 max-w-2xl">
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--text1)" }}>Settings</h1>
        <p className="text-[13.5px] mb-6" style={{ color: "var(--text3)" }}>Manage your profile, subscription, and extension token.</p>

        <div className="flex gap-1 mb-7 p-1 rounded-xl" style={{ background: "var(--border)", width: "fit-content" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-5 py-2 rounded-[10px] text-[13px] font-semibold transition-all"
              style={{
                background: tab === t.id ? "white" : "transparent",
                color: tab === t.id ? "var(--text1)" : "var(--text3)",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "profile" && <ProfileTab />}
        {tab === "billing" && <BillingTab />}
        {tab === "extension" && <ExtensionTab />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div />}>
      <SettingsContent />
    </Suspense>
  );
}
