"use client";

import { useState } from "react";

interface Props {
  onClose: () => void;
  onConnected: (client: any) => void;
}

export function ConnectModal({ onClose, onConnected }: Props) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect() {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clients/connect-with-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to connect"); setLoading(false); return; }
      onConnected(data.client);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
        <h2 className="text-[18px] font-semibold mb-1" style={{ color: "var(--text1)" }}>Connect a Client</h2>
        <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>
          Ask the RBT to generate a client code from their client profile, then enter it below.
        </p>
        <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Client Code</label>
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
          placeholder="e.g. AB-123456"
          className="w-full border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 mb-3 uppercase tracking-widest"
          style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
          autoFocus
        />
        {error && (
          <p className="text-[12px] mb-3 px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={handleConnect}
            disabled={loading || !code.trim()}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--teal)" }}
          >
            {loading ? "Connecting…" : "Connect"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border"
            style={{ borderColor: "var(--border)", color: "var(--text2)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
