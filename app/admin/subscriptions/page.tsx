"use client";

import { useEffect, useState } from "react";

interface Sub {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  plan: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  stripe_subscription_id: string | null;
  created_at: string | null;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active:   { bg: "#E6F9F5", color: "#1BA8A0" },
  trialing: { bg: "#EFF6FF", color: "#1D4ED8" },
  canceled: { bg: "#FEE2E2", color: "#DC2626" },
  past_due: { bg: "#FEF3C7", color: "#D97706" },
};

export default function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editTarget, setEditTarget] = useState<Sub | null>(null);
  const [newPlan, setNewPlan] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Sub | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [cancelTarget, setCancelTarget] = useState<Sub | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    fetch("/api/admin/subscriptions")
      .then(r => r.json())
      .then(data => { if (data.error) setError(data.error); else setSubs(data.subscriptions || []); })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleEdit() {
    if (!editTarget) return;
    setEditLoading(true);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editTarget.id, plan: newPlan || undefined, status: newStatus || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubs(prev => prev.map(s => s.id === editTarget.id ? { ...s, plan: newPlan || s.plan, status: newStatus || s.status } : s));
        setEditTarget(null);
      }
    } finally { setEditLoading(false); }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelLoading(true);
    setCancelError("");
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cancelTarget.id, status: "canceled" }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubs(prev => prev.map(s => s.id === cancelTarget.id ? { ...s, status: "canceled" } : s));
        setCancelTarget(null);
      } else {
        setCancelError(data.error || "Cancellation failed.");
      }
    } catch {
      setCancelError("Network error. Please try again.");
    } finally {
      setCancelLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubs(prev => prev.filter(s => s.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        setDeleteError(data.error || "Delete failed.");
      }
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleteLoading(false);
    }
  }

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="px-8 py-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold mb-1" style={{ color: "var(--text1)" }}>Subscriptions</h1>
        <p className="text-[13px]" style={{ color: "var(--text3)" }}>{subs.length} total</p>
      </div>

      {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

      <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
              {["User", "Plan", "Status", "Trial Ends", "Period Ends", "Actions"].map(h => (
                <th key={h} className="px-5 py-3 text-left font-semibold" style={{ color: "var(--text3)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-6 text-center" style={{ color: "var(--text3)" }}>Loading…</td></tr>
            ) : subs.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-6 text-center" style={{ color: "var(--text3)" }}>No subscriptions found.</td></tr>
            ) : subs.map(s => {
              const sc = STATUS_COLORS[s.status || ""] || { bg: "#F1F5F9", color: "#64748B" };
              return (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <p className="font-medium" style={{ color: "var(--text1)" }}>{s.user_email}</p>
                    {s.user_name && <p className="text-[12px]" style={{ color: "var(--text3)" }}>{s.user_name}</p>}
                  </td>
                  <td className="px-5 py-3" style={{ color: "var(--text2)" }}>{s.plan || "—"}</td>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                      {s.status || "none"}
                    </span>
                  </td>
                  <td className="px-5 py-3" style={{ color: "var(--text3)" }}>{fmt(s.trial_ends_at)}</td>
                  <td className="px-5 py-3" style={{ color: "var(--text3)" }}>{fmt(s.current_period_ends_at)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditTarget(s); setNewPlan(s.plan || ""); setNewStatus(s.status || ""); }}
                        className="text-[12px] font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
                        style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                      >
                        Edit
                      </button>
                      {s.status !== "canceled" && (
                        <button
                          onClick={() => { setCancelTarget(s); setCancelError(""); }}
                          className="text-[12px] font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
                          style={{ borderColor: "#FCD34D", color: "#D97706" }}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => { setDeleteTarget(s); setDeleteError(""); }}
                        className="text-[12px] font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
                        style={{ borderColor: "#FECACA", color: "#DC2626" }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
            <div className="flex items-center justify-between mb-5">
              <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Edit Subscription</p>
              <button onClick={() => setEditTarget(null)} className="text-[18px]" style={{ color: "var(--text3)" }}>×</button>
            </div>
            <p className="text-[12px] mb-4" style={{ color: "var(--text3)" }}>{editTarget.user_email}</p>

            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Plan</label>
            <input
              value={newPlan}
              onChange={e => setNewPlan(e.target.value)}
              placeholder="e.g. rbt, bcba"
              className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none mb-4"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            />

            <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Status</label>
            <select
              value={newStatus}
              onChange={e => setNewStatus(e.target.value)}
              className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none mb-5"
              style={{ borderColor: "var(--border)", color: "var(--text1)" }}
            >
              {["active", "trialing", "canceled", "past_due"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <div className="flex gap-3">
              <button
                onClick={handleEdit}
                disabled={editLoading}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--teal)" }}
              >
                {editLoading ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border"
                style={{ borderColor: "var(--border)", color: "var(--text2)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Cancel Subscription</p>
              <button onClick={() => setCancelTarget(null)} className="text-[18px]" style={{ color: "var(--text3)" }}>×</button>
            </div>
            <p className="text-[13px] mb-2" style={{ color: "var(--text2)" }}>
              Cancel subscription for <strong>{cancelTarget.user_email}</strong>?
            </p>
            <p className="text-[12px] mb-4 px-3 py-2 rounded-lg" style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FCD34D" }}>
              Status will be set to <strong>canceled</strong>. The subscription record is kept.
              {cancelTarget.current_period_ends_at && (
                <> Access continues until <strong>{fmt(cancelTarget.current_period_ends_at)}</strong>.</>
              )}
            </p>
            {cancelError && (
              <p className="text-[12px] mb-4 px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                {cancelError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: "#D97706" }}
              >
                {cancelLoading ? "Canceling…" : "Confirm Cancel"}
              </button>
              <button
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border"
                style={{ borderColor: "var(--border)", color: "var(--text2)" }}
              >
                Keep Active
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Delete Subscription</p>
              <button onClick={() => setDeleteTarget(null)} className="text-[18px]" style={{ color: "var(--text3)" }}>×</button>
            </div>
            <p className="text-[13px] mb-4" style={{ color: "var(--text2)" }}>
              Permanently delete subscription for <strong>{deleteTarget.user_email}</strong>? This cannot be undone.
            </p>
            {deleteError && (
              <p className="text-[12px] mb-4 px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                {deleteError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: "#DC2626" }}
              >
                {deleteLoading ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border"
                style={{ borderColor: "var(--border)", color: "var(--text2)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
