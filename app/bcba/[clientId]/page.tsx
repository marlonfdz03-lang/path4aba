"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BCBATab = "notes" | "missing_hours" | "supervision";

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending:  { bg: "#FFF8E1", color: "#92400E", label: "Pending" },
  accepted: { bg: "#E6F9F5", color: "#065F46", label: "Accepted" },
  rejected: { bg: "#FEF2F2", color: "#DC2626", label: "Rejected" },
};

function Topbar({ clientName }: { clientName: string }) {
  return (
    <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
      <Link href="/bcba" className="hover:underline" style={{ color: "var(--text3)" }}>My Clients</Link>
      <span style={{ color: "var(--border2)" }}>/</span>
      <span className="font-medium" style={{ color: "var(--text1)" }}>{clientName || "Client"}</span>
    </div>
  );
}

function TabBar({ active, onChange }: { active: BCBATab; onChange: (t: BCBATab) => void }) {
  const tabs: { id: BCBATab; label: string }[] = [
    { id: "notes", label: "RBT Notes" },
    { id: "missing_hours", label: "Missing Hours" },
    { id: "supervision", label: "Supervision Notes" },
  ];
  return (
    <div className="flex border-b bg-white px-8" style={{ borderColor: "var(--border)" }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="px-4 py-3 text-[13px] font-medium border-b-2 transition-colors"
          style={{
            borderColor: active === t.id ? "var(--teal)" : "transparent",
            color: active === t.id ? "var(--teal)" : "var(--text3)",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ReviewButtons({ noteId, currentStatus, onReviewed }: { noteId: string; currentStatus: string; onReviewed: () => void }) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  if (currentStatus !== "pending") return null;

  async function submit(status: "accepted" | "rejected") {
    setLoading(true);
    await fetch("/api/bcba/review-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId, status, comment: comment || undefined }),
    });
    setLoading(false);
    onReviewed();
  }

  return (
    <div className="mt-3">
      {showComment && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Reason for rejection (optional)…"
          className="w-full border rounded-xl px-3 py-2 text-[12px] resize-none mb-2 focus:outline-none"
          style={{ borderColor: "var(--border)", color: "var(--text2)", minHeight: 60 }}
        />
      )}
      <div className="flex gap-2">
        <button
          onClick={() => submit("accepted")}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#16A34A" }}
        >
          Accept
        </button>
        <button
          onClick={() => { if (!showComment) { setShowComment(true); } else { submit("rejected"); } }}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#DC2626" }}
        >
          {showComment ? "Confirm Reject" : "Reject"}
        </button>
        {showComment && (
          <button onClick={() => setShowComment(false)} className="px-3 py-1.5 rounded-lg text-[12px] border" style={{ borderColor: "var(--border)", color: "var(--text3)" }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default function BCBAClientPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [activeTab, setActiveTab] = useState<BCBATab>("notes");
  const [client, setClient] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [supervisionNotes, setSupervisionNotes] = useState<any[]>([]);
  const [missingHours, setMissingHours] = useState<any[]>([]);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }
      loadAll(data.user.id);
    });
  }, [clientId]);

  async function loadAll(userId: string) {
    // Verify connection + fetch client
    const { data: conn } = await supabase
      .from("bcba_clients")
      .select("clients(id, client_name, diagnosis, clinical_profile)")
      .eq("bcba_id", userId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (!conn) { router.push("/bcba"); return; }
    setClient((conn as any).clients);

    // Fetch RBT notes
    const notesRes = await fetch(`/api/bcba/rbt-notes?clientId=${clientId}`);
    if (notesRes.ok) { const d = await notesRes.json(); setNotes(d.notes || []); }

    // Fetch supervision notes
    const { data: supNotes } = await supabase
      .from("supervision_notes")
      .select("id, session_date, supervision_type, note_text, status, created_at")
      .eq("client_id", clientId)
      .eq("bcba_id", userId)
      .order("session_date", { ascending: false });
    setSupervisionNotes(supNotes || []);

    // Fetch missing hours
    const hoursRes = await fetch(`/api/bcba/missing-hours?clientId=${clientId}`);
    if (hoursRes.ok) { const d = await hoursRes.json(); setMissingHours(d.entries || []); }

    setLoading(false);
  }

  function refreshNotes() {
    fetch(`/api/bcba/rbt-notes?clientId=${clientId}`)
      .then(r => r.json())
      .then(d => setNotes(d.notes || []));
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <Topbar clientName="" />
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <Topbar clientName={client?.client_name || "Client"} />

      {/* Client header */}
      <div className="px-8 py-5 bg-white border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
          >
            {client?.client_name?.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
          </div>
          <div>
            <p className="text-[16px] font-semibold" style={{ color: "var(--text1)" }}>{client?.client_name}</p>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>{client?.diagnosis?.join(", ") || "ASD"}</p>
          </div>
        </div>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} />

      <div className="px-8 py-6 max-w-4xl">

        {/* ── RBT Notes Tab ── */}
        {activeTab === "notes" && (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No session notes from the RBT yet.</p>
            ) : notes.map(note => {
              const s = STATUS_STYLES[note.review_status] || STATUS_STYLES.pending;
              const isExpanded = expandedNoteId === note.id;
              const dateLabel = note.session_date
                ? new Date(note.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : new Date(note.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              return (
                <div key={note.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                      {!isExpanded && (
                        <p className="text-[12px] mt-1 line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(note.generated_note || "").slice(0, 120)}…
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
                        {s.label}
                      </span>
                      <button
                        onClick={() => setExpandedNoteId(isExpanded ? null : note.id)}
                        className="text-[12px] font-medium hover:underline"
                        style={{ color: "var(--teal)" }}
                      >
                        {isExpanded ? "Collapse" : "Expand"}
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <>
                      <p className="text-[13px] leading-7 whitespace-pre-wrap mb-4" style={{ color: "var(--text2)" }}>
                        {note.generated_note}
                      </p>
                      {note.review_status === "rejected" && note.review_comment && (
                        <p className="text-[12px] mb-3 px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                          Rejected: {note.review_comment}
                        </p>
                      )}
                      <ReviewButtons noteId={note.id} currentStatus={note.review_status || "pending"} onReviewed={refreshNotes} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Missing Hours Tab ── */}
        {activeTab === "missing_hours" && (
          <div>
            {missingHours.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text1)" }}>No missed hours recorded</p>
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>Missed session data will appear here as the RBT records it.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {missingHours.map(entry => (
                  <div key={entry.id} className="bg-white rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{entry.date}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>{entry.reason}</p>
                        {entry.notes && <p className="text-[12px] mt-1" style={{ color: "var(--text2)" }}>{entry.notes}</p>}
                      </div>
                      <span className="text-[13px] font-semibold" style={{ color: "#DC2626" }}>{entry.hours}h missed</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Supervision Notes Tab ── */}
        {activeTab === "supervision" && (
          <div>
            <div className="flex justify-end mb-4">
              <Link
                href={`/bcba/${clientId}/supervision-note`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Supervision Note
              </Link>
            </div>
            {supervisionNotes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No supervision notes yet.</p>
            ) : (
              <div className="space-y-4">
                {supervisionNotes.map(sn => {
                  const isExpanded = expandedNoteId === sn.id;
                  const dateLabel = new Date(sn.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  const typeLabel = sn.supervision_type === "face_to_face" ? "Face-to-Face" : "Remote";
                  return (
                    <div key={sn.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>{typeLabel}</p>
                        </div>
                        <button
                          onClick={() => setExpandedNoteId(isExpanded ? null : sn.id)}
                          className="text-[12px] font-medium hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Collapse" : "View"}
                        </button>
                      </div>
                      {!isExpanded && (
                        <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(sn.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                          {sn.note_text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
