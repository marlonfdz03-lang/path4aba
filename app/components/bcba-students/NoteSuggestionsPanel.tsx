"use client";

import { useEffect, useState } from "react";

const CATEGORIES = [
  "Functional assessment",
  "General behavior analysis",
  "Behavior change procedures",
  "Ethics & professional conduct",
  "Staff training & supervision",
  "Treatment planning",
  "Measurement & data systems",
  "Data analysis & graphing",
  "Experimental design",
  "Assessment",
];

interface Note {
  id: number;
  note: string;
  category: string;
  activity_type: string;
}

interface Props {
  activityType: "unrestricted" | "restricted";
  onSelect: (text: string) => void;
  onClose: () => void;
}

export default function NoteSuggestionsPanel({ activityType, onSelect, onClose }: Props) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ category, activityType });
    if (query) params.set("q", query);
    fetch(`/api/bcba-students/notes?${params}`)
      .then(r => r.json())
      .then(d => { setNotes(d.notes || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [category, activityType, query]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerated("");
    const res = await fetch("/api/bcba-students/generate-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityType, contactType: "none", setting: "" }),
    });
    const data = await res.json();
    setGenerated(data.note || "");
    setGenerating(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(0,0,0,0.4)" }}>
      {/* Backdrop close */}
      <div className="flex-1" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-md bg-white flex flex-col" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Note Suggestions</p>
          <button onClick={onClose} className="text-[13px] hover:opacity-70" style={{ color: "var(--text3)" }}>Close</button>
        </div>

        {/* Disclaimer */}
        <div className="px-6 py-3 text-[12px] leading-relaxed" style={{ background: "#FFF8E1", color: "#92400E", borderBottom: "1px solid #FDE68A" }}>
          These are suggestions only. All notes must be reviewed and approved by you and your supervisor before use in official documentation.
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 overflow-x-auto px-6 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors"
              style={{
                background: category === c ? "var(--navy)" : "var(--border)",
                color: category === c ? "white" : "var(--text2)",
              }}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-6 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full border rounded-xl px-4 py-2 text-[13px] focus:outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          />
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
          {loading ? (
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
          ) : notes.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>No notes found for this category and activity type.</p>
          ) : notes.map(n => (
            <div key={n.id} className="rounded-xl p-4" style={{ border: "1px solid var(--border)" }}>
              <p className="text-[13px] leading-relaxed mb-3" style={{ color: "var(--text2)" }}>{n.note}</p>
              <button
                onClick={() => onSelect(n.note)}
                className="text-[12px] font-semibold hover:opacity-80"
                style={{ color: "var(--teal)" }}
              >
                Use this note
              </button>
            </div>
          ))}
        </div>

        {/* AI Generate */}
        <div className="px-6 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          {generated && (
            <div className="mb-3 rounded-xl p-4" style={{ background: "#F0FDF4", border: "1px solid #A7F3D0" }}>
              <p className="text-[13px] leading-relaxed mb-2" style={{ color: "#065F46" }}>{generated}</p>
              <button
                onClick={() => onSelect(generated)}
                className="text-[12px] font-semibold"
                style={{ color: "#16A34A" }}
              >
                Use this note
              </button>
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--navy)" }}
          >
            {generating ? "Generating…" : "Generate with AI"}
          </button>
        </div>
      </div>
    </div>
  );
}
