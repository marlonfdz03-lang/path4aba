"use client";
import { useState } from "react";

export default function WaitlistSection() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="waitlist" style={{ background: "#F0F7FF", padding: "80px 24px", borderTop: "1px solid #DBEAFE" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
        <p
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            fontWeight: 700,
            color: "#2563EB",
            marginBottom: 12,
          }}
        >
          Coming Soon
        </p>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>
          BCBA &amp; Student plans are almost here
        </h2>
        <p style={{ fontSize: 15, color: "#718096", marginBottom: 32, lineHeight: 1.65 }}>
          We&apos;re putting the finishing touches on BCBA and ABA Student plans. Join the waitlist and
          we&apos;ll notify you the moment they launch.
        </p>

        {done ? (
          <div
            style={{
              padding: "16px 24px",
              borderRadius: 12,
              background: "#E6F9F5",
              border: "1px solid #A7F3D0",
              color: "#065F46",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            ✓ You&apos;re on the list! We&apos;ll email you when plans launch.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="your@email.com"
              style={{
                flex: 1,
                minWidth: 200,
                maxWidth: 300,
                padding: "11px 16px",
                borderRadius: 10,
                border: "1px solid #E2E8F0",
                fontSize: 14,
                color: "#0A1628",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "11px 24px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                background: "linear-gradient(135deg, #0F62FE, #1B5BE8)",
                color: "white",
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Sending…" : "Notify Me"}
            </button>
            {error && (
              <p style={{ width: "100%", fontSize: 13, color: "#DC2626", marginTop: 4, textAlign: "center" }}>
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
