"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsTab = "billing" | "help";

type Sub = {
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  stripe_customer_id: string | null;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

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
  const [sub, setSub] = useState<Sub | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, trial_ends_at, current_period_ends_at, stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();
      setSub(data as Sub | null);
      setLoaded(true);
    }
    load();
  }, [router]);

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

// ── Help tab ──────────────────────────────────────────────────────────────────

function HelpTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! I'm the Path4ABA support assistant. How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const reply = data.reply || data.error || "Sorry, I couldn't get a response. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Network error. Please try again." }]);
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: 400 }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[80%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed"
              style={
                m.role === "user"
                  ? { background: "var(--teal)", color: "white", borderBottomRightRadius: 4 }
                  : { background: "var(--navy)", color: "rgba(255,255,255,0.9)", borderBottomLeftRadius: 4 }
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl text-[13px]" style={{ background: "var(--navy)", color: "rgba(255,255,255,0.5)", borderBottomLeftRadius: 4 }}>
              Typing…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Contact us */}
      <div className="py-2 text-center">
        <p className="text-[12px]" style={{ color: "var(--text3)" }}>
          Still need help?{" "}
          <a href="mailto:hello@path4abaapp.com" className="font-medium hover:underline" style={{ color: "var(--teal)" }}>
            Contact us
          </a>
        </p>
      </div>

      {/* Input */}
      <div className="flex gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask a question…"
          className="flex-1 border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2 transition-colors"
          style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--teal)" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("billing");

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "billing", label: "Billing" },
    { id: "help", label: "Help" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Topbar */}
      <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Settings</p>
      </div>

      <div className="px-8 py-8 max-w-2xl">
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--text1)" }}>Settings</h1>
        <p className="text-[13.5px] mb-6" style={{ color: "var(--text3)" }}>Manage your account, billing, and support.</p>

        {/* Tab bar */}
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

        {tab === "billing" && <BillingTab />}
        {tab === "help" && <HelpTab />}
      </div>
    </div>
  );
}
