"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAllNotes, StoredNote } from "@/lib/noteStorage";

type NoteResult = {
  note: StoredNote;
  status: "pending" | "ok" | "failed";
  reason?: string;
};

export default function MigrateNotesPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [results, setResults] = useState<NoteResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
      setUserId(data.user.id);

      const notes = getAllNotes();
      setResults(notes.map(n => ({ note: n, status: "pending" })));
    });
  }, []);

  async function runMigration() {
    if (!userId || results.length === 0) return;

    for (let i = 0; i < results.length; i++) {
      setCurrentIndex(i);
      const n = results[i].note;

      const { error } = await supabase.from("session_notes").insert({
        client_id: n.clientId,
        user_id: userId,
        note_text: n.note,
      });

      setResults(prev => {
        const next = [...prev];
        next[i] = {
          ...next[i],
          status: error ? "failed" : "ok",
          reason: error?.message,
        };
        return next;
      });
    }

    setCurrentIndex(null);
    setDone(true);
  }

  const migrated = results.filter(r => r.status === "ok").length;
  const failed = results.filter(r => r.status === "failed").length;
  const running = currentIndex !== null;

  return (
    <div className="min-h-screen px-8 py-10 max-w-2xl mx-auto" style={{ background: "var(--bg)" }}>
      <h1 className="text-[20px] font-semibold mb-1" style={{ color: "var(--text1)" }}>
        Migrate Notes to Supabase
      </h1>
      <p className="text-[13px] mb-6" style={{ color: "var(--text3)" }}>
        Moves RBT session notes from localStorage into the database so BCBAs can see them.
        Notes with localStorage-only client IDs will fail — that is expected.
      </p>

      {results.length === 0 && userId !== null && (
        <p className="text-[13px]" style={{ color: "var(--text3)" }}>No notes found in localStorage.</p>
      )}

      {results.length > 0 && !running && !done && (
        <button
          onClick={runMigration}
          className="px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white mb-6 hover:opacity-90 transition-opacity"
          style={{ background: "var(--teal)" }}
        >
          Migrate {results.length} note{results.length !== 1 ? "s" : ""}
        </button>
      )}

      {running && currentIndex !== null && (
        <p className="text-[13px] font-medium mb-4" style={{ color: "var(--text2)" }}>
          Migrating note {currentIndex + 1} of {results.length}…
        </p>
      )}

      {done && (
        <p className="text-[13px] font-semibold mb-4" style={{ color: migrated > 0 ? "var(--teal)" : "var(--text2)" }}>
          Done — {migrated} migrated successfully, {failed} failed
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={r.note.id}
              className="bg-white rounded-xl border px-4 py-3 flex items-start gap-3"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-[15px] mt-0.5 flex-shrink-0">
                {r.status === "ok" ? "✅" : r.status === "failed" ? "❌" : currentIndex === i ? "⏳" : "·"}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium truncate" style={{ color: "var(--text2)" }}>
                  {r.note.date} — client {r.note.clientId.slice(0, 8)}…
                </p>
                <p className="text-[12px] truncate" style={{ color: "var(--text3)" }}>
                  {r.note.note.slice(0, 80)}…
                </p>
                {r.status === "failed" && r.reason && (
                  <p className="text-[11px] mt-0.5" style={{ color: "#DC2626" }}>{r.reason}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
