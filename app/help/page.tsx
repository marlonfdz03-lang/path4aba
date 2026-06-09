"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useSession } from "next-auth/react";

export default function HelpPage() {
  const { data: session } = useSession();
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const email = session?.user?.email || "";

  async function handleSend() {
    const text = message.trim();
    if (!text || sending) return;
    setError("");
    setSending(true);
    try {
      const res = await fetch("/api/help/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed to send message. Please try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="px-8 py-7 max-w-2xl">

        {/* Header */}
        <div className="mb-7">
          <h1 className="text-[22px] font-semibold mb-1" style={{ color: "var(--text1)" }}>
            Help & Support
          </h1>
          <p className="text-[14px]" style={{ color: "var(--text3)" }}>
            We&apos;re here to help.
          </p>
        </div>

        {/* Contact info card */}
        <div
          className="bg-white rounded-xl p-6 mb-4"
          style={{ border: "1px solid var(--border)" }}
        >
          <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--text1)" }}>
            Contact Us
          </p>
          <div className="space-y-3">
            <div>
              <p className="text-[12px] uppercase tracking-wide font-medium mb-1" style={{ color: "var(--text3)" }}>
                Email us directly
              </p>
              <a
                href="mailto:support@path4aba.com"
                className="text-[14px] font-medium hover:underline"
                style={{ color: "var(--teal)" }}
              >
                support@path4aba.com
              </a>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
              <p className="text-[12px] uppercase tracking-wide font-medium mb-1" style={{ color: "var(--text3)" }}>
                Visit our website
              </p>
              <a
                href="https://path4aba.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] font-medium hover:underline"
                style={{ color: "var(--teal)" }}
              >
                path4aba.app
              </a>
            </div>
          </div>
        </div>

        {/* Send message card */}
        <div
          className="bg-white rounded-xl p-6"
          style={{ border: "1px solid var(--border)" }}
        >
          <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>
            Send a Message
          </p>
          <p className="text-[13px] mb-4" style={{ color: "var(--text3)" }}>
            Describe your issue or question and we&apos;ll get back to you.
          </p>

          <textarea
            id="message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your issue or question…"
            className="w-full border rounded-xl px-4 py-3 text-[13px] focus:outline-none focus:ring-2 transition-colors resize-none mb-4"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            disabled={sent}
          />

          {error && (
            <p
              className="text-[13px] rounded-xl px-4 py-3 border mb-4"
              style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}
            >
              {error}
            </p>
          )}

          {sent ? (
            <p
              className="text-[13px] rounded-xl px-4 py-3 border"
              style={{ background: "#F0FDF4", borderColor: "#BBF7D0", color: "#15803D" }}
            >
              Message sent! We&apos;ll get back to you at {email || "your email"} soon.
            </p>
          ) : (
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--teal)" }}
            >
              {sending ? "Sending…" : "Send Message"}
            </button>
          )}
        </div>

      </div>
    </main>
  );
}
