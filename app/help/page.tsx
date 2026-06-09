"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function HelpPage() {
  const { data: session } = useSession();
  const email = session?.user?.email || "";

  // ── Send message (email) ───────────────────────────────────────────────────
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  async function handleSend() {
    const text = message.trim();
    if (!text || sending) return;
    setSendError("");
    setSending(true);
    try {
      const res = await fetch("/api/help/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSendError(d.error || "Failed to send message. Please try again.");
      } else {
        setSent(true);
      }
    } catch {
      setSendError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  // ── AI Chat ────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! I'm the Path4ABA support assistant. How can I help you today?" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const reply = data.reply || data.error || "Sorry, I couldn't get a response. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Network error. Please try again." }]);
    }
    setChatLoading(false);
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

        {/* Contact info */}
        <div className="bg-white rounded-xl p-6 mb-4" style={{ border: "1px solid var(--border)" }}>
          <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--text1)" }}>Contact Us</p>
          <div className="space-y-3">
            <div>
              <p className="text-[12px] uppercase tracking-wide font-medium mb-1" style={{ color: "var(--text3)" }}>
                Email us directly
              </p>
              <a href="mailto:support@path4aba.com" className="text-[14px] font-medium hover:underline" style={{ color: "var(--teal)" }}>
                support@path4aba.com
              </a>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
              <p className="text-[12px] uppercase tracking-wide font-medium mb-1" style={{ color: "var(--text3)" }}>
                Visit our website
              </p>
              <a href="https://path4aba.app" target="_blank" rel="noopener noreferrer" className="text-[14px] font-medium hover:underline" style={{ color: "var(--teal)" }}>
                path4aba.app
              </a>
            </div>
          </div>
        </div>

        {/* AI Chat */}
        <div className="bg-white rounded-xl p-6 mb-4" style={{ border: "1px solid var(--border)" }}>
          <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--text1)" }}>
            Support Assistant
          </p>
          <div className="flex flex-col" style={{ height: 400 }}>
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
              {chatLoading && (
                <div className="flex justify-start">
                  <div
                    className="px-4 py-3 rounded-2xl text-[13px]"
                    style={{ background: "var(--navy)", color: "rgba(255,255,255,0.5)", borderBottomLeftRadius: 4 }}
                  >
                    Typing…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="flex gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder="Ask a question…"
                className="flex-1 border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2 transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                disabled={chatLoading}
              />
              <button
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--teal)" }}
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Send message (email) */}
        <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
          <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>
            Send a Message
          </p>
          <p className="text-[13px] mb-4" style={{ color: "var(--text3)" }}>
            Need to reach the team directly? Send us a message and we&apos;ll get back to you.
          </p>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your issue or question…"
            className="w-full border rounded-xl px-4 py-3 text-[13px] focus:outline-none focus:ring-2 transition-colors resize-none mb-4"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            disabled={sent}
          />
          {sendError && (
            <p className="text-[13px] rounded-xl px-4 py-3 border mb-4" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
              {sendError}
            </p>
          )}
          {sent ? (
            <p className="text-[13px] rounded-xl px-4 py-3 border" style={{ background: "#F0FDF4", borderColor: "#BBF7D0", color: "#15803D" }}>
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
