"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BCBATab = "notes" | "schedule" | "supervision" | "parent_training" | "reassessment";

const SUPERVISION_TYPE_LABELS: Record<string, string> = {
  face_to_face: "Face-to-Face",
  remote: "Remote",
  individual_supervision: "Individual Supervision",
  group_supervision: "Group Supervision",
  client_observation: "Client Observation",
};

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

function TabBar({ active, onChange, isBCBAPro }: { active: BCBATab; onChange: (t: BCBATab) => void; isBCBAPro: boolean | null }) {
  const tabs: { id: BCBATab; label: string; proOnly?: boolean }[] = [
    { id: "notes",           label: "RBT Notes" },
    { id: "schedule",        label: "Schedule" },
    { id: "supervision",     label: "Supervision Notes" },
    { id: "parent_training", label: "Parent Training" },
    { id: "reassessment",    label: "Assessment Tools", proOnly: true },
  ];
  return (
    <div className="flex border-b bg-white px-8 overflow-x-auto" style={{ borderColor: "var(--border)" }}>
      {tabs.map(t => {
        const isDisabled = t.proOnly && isBCBAPro === false;
        return (
          <button
            key={t.id}
            onClick={() => !isDisabled && onChange(t.id)}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap disabled:cursor-not-allowed"
            style={{
              borderColor: active === t.id ? "var(--teal)" : "transparent",
              color: isDisabled ? "var(--text3)" : active === t.id ? "var(--teal)" : "var(--text3)",
              opacity: isDisabled ? 0.6 : 1,
            }}
          >
            {t.label}
            {t.proOnly && isBCBAPro === false && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(27,168,160,0.12)", color: "var(--teal)" }}>
                Pro
              </span>
            )}
          </button>
        );
      })}
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
  const [isBCBAPro, setIsBCBAPro] = useState<boolean | null>(null);

  const [client, setClient] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [supervisionNotes, setSupervisionNotes] = useState<any[]>([]);
  const [parentTrainingNotes, setParentTrainingNotes] = useState<any[]>([]);
  const [missingHours, setMissingHours] = useState<any[]>([]);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push("/login"); return; }

      // Check BCBA Pro plan
      supabase
        .from("subscriptions")
        .select("status, plan, trial_ends_at")
        .eq("user_id", data.user.id)
        .maybeSingle()
        .then(({ data: sub }) => {
          const now = new Date();
          const isPro =
            sub?.plan === "bcba_pro" &&
            (sub.status === "active" ||
              (sub.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at) > now));
          setIsBCBAPro(!!isPro);
        });

      loadAll(data.user.id as string);
    });
  }, [clientId]);

  async function loadAll(userId: string) {
    // Verify connection + fetch client via server-side route (bypasses RLS)
    const clientRes = await fetch(`/api/bcba/client/${clientId}`);
    if (!clientRes.ok) { router.push("/bcba"); return; }
    const { client: clientData } = await clientRes.json();
    setClient(clientData);

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

    // Fetch parent training notes
    const { data: ptNotes } = await supabase
      .from("parent_training_notes")
      .select("id, session_date, caregiver_name, caregiver_relation, note_text, status, created_at")
      .eq("client_id", clientId)
      .eq("bcba_id", userId)
      .order("session_date", { ascending: false });
    setParentTrainingNotes(ptNotes || []);

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
            {(client?.client_name || client?.internal_code || "?")[0].toUpperCase()}
          </div>
          <div>
            <p className="text-[16px] font-semibold" style={{ color: "var(--text1)" }}>{client?.client_name || client?.internal_code}</p>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>
              {client?.clinical_profile?.diagnosis?.join(", ") || client?.internal_code || ""}
            </p>
          </div>
        </div>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} isBCBAPro={isBCBAPro} />

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

        {/* ── Schedule Tab ── */}
        {activeTab === "schedule" && (
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
                  const typeLabel = SUPERVISION_TYPE_LABELS[sn.supervision_type] || sn.supervision_type || "Supervision";
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

        {/* ── Parent Training Tab ── */}
        {activeTab === "parent_training" && (
          <div>
            <div className="flex justify-end mb-4">
              <Link
                href={`/bcba/${clientId}/parent-training-note`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Parent Training Note
              </Link>
            </div>
            {parentTrainingNotes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No parent training notes yet.</p>
            ) : (
              <div className="space-y-4">
                {parentTrainingNotes.map(pt => {
                  const isExpanded = expandedNoteId === pt.id;
                  const dateLabel = new Date(pt.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <div key={pt.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          {pt.caregiver_name && (
                            <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>
                              {pt.caregiver_name}{pt.caregiver_relation ? ` · ${pt.caregiver_relation}` : ""}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => setExpandedNoteId(isExpanded ? null : pt.id)}
                          className="text-[12px] font-medium hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Collapse" : "View"}
                        </button>
                      </div>
                      {!isExpanded && (
                        <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(pt.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                          {pt.note_text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Assessment Tools Tab ── */}
        {activeTab === "reassessment" && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(27,168,160,0.1)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4" style={{ background: "rgba(27,168,160,0.15)", color: "var(--teal)" }}>
              Coming Soon
            </span>
            <p className="text-[15px] font-semibold mb-2" style={{ color: "var(--text1)" }}>Assessment Tools</p>
            <p className="text-[13px] max-w-xs" style={{ color: "var(--text3)" }}>
              Reassessment tools will be available here for BCBA Pro plan members.
            </p>
          </div>
        )}

      </div>
    </main>
  );
}
