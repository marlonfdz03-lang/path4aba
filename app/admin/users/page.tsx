"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  admin: { bg: "#FEE2E2", color: "#DC2626" },
  bcba:  { bg: "#E6F9F5", color: "#1BA8A0" },
  rbt:   { bg: "#EFF6FF", color: "#1D4ED8" },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [roleTarget, setRoleTarget] = useState<User | null>(null);
  const [newRole, setNewRole] = useState("rbt");
  const [roleLoading, setRoleLoading] = useState(false);

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function loadUsers(q = search) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setUsers(data.users || []);
    } catch { setError("Failed to load users"); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadUsers(""); }, []);

  async function handleRoleChange() {
    if (!roleTarget) return;
    setRoleLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: roleTarget.id, role: newRole }),
      });
      const data = await res.json();
      if (data.ok) {
        setUsers(prev => prev.map(u => u.id === roleTarget.id ? { ...u, role: newRole } : u));
        setRoleTarget(null);
      }
    } finally { setRoleLoading(false); }
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    setResetLoading(true);
    setResetMsg("");
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (data.ok) { setResetMsg("Password updated."); setNewPassword(""); }
      else setResetMsg(data.error || "Failed");
    } finally { setResetLoading(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/users?id=${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } finally { setDeleteLoading(false); }
  }

  return (
    <div className="px-8 py-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold mb-1" style={{ color: "var(--text1)" }}>Users</h1>
          <p className="text-[13px]" style={{ color: "var(--text3)" }}>{users.length} total</p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && loadUsers(search)}
            placeholder="Search by email…"
            className="border rounded-xl px-4 py-2 text-[13px] focus:outline-none w-56"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          />
          <button
            onClick={() => loadUsers(search)}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white"
            style={{ background: "var(--teal)" }}
          >
            Search
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}

      <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
              {["Email", "Name", "Role", "Joined", "Actions"].map(h => (
                <th key={h} className="px-5 py-3 text-left font-semibold" style={{ color: "var(--text3)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-6 text-center" style={{ color: "var(--text3)" }}>Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-6 text-center" style={{ color: "var(--text3)" }}>No users found.</td></tr>
            ) : users.map(u => {
              const rc = ROLE_COLORS[u.role] || ROLE_COLORS.rbt;
              return (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium" style={{ color: "var(--text1)" }}>{u.email}</td>
                  <td className="px-5 py-3" style={{ color: "var(--text2)" }}>{u.name || "—"}</td>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: rc.bg, color: rc.color }}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3" style={{ color: "var(--text3)" }}>
                    {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setRoleTarget(u); setNewRole(u.role); }}
                        className="text-[12px] font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
                        style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                      >
                        Role
                      </button>
                      <button
                        onClick={() => { setResetTarget(u); setNewPassword(""); setResetMsg(""); }}
                        className="text-[12px] font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
                        style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                      >
                        Password
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
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

      {/* Role Modal */}
      {roleTarget && (
        <Modal title={`Change Role — ${roleTarget.email}`} onClose={() => setRoleTarget(null)}>
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value)}
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none mb-4"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          >
            {["rbt", "bcba", "admin"].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <ModalActions
            onCancel={() => setRoleTarget(null)}
            onConfirm={handleRoleChange}
            loading={roleLoading}
            confirmLabel="Save"
          />
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <Modal title={`Reset Password — ${resetTarget.email}`} onClose={() => setResetTarget(null)}>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none mb-3"
            style={{ borderColor: "var(--border)", color: "var(--text1)" }}
          />
          {resetMsg && <p className="text-[12px] mb-3" style={{ color: resetMsg === "Password updated." ? "#16A34A" : "#DC2626" }}>{resetMsg}</p>}
          <ModalActions
            onCancel={() => setResetTarget(null)}
            onConfirm={handleResetPassword}
            loading={resetLoading}
            confirmLabel="Reset"
          />
        </Modal>
      )}

      {/* Delete Modal */}
      {deleteTarget && (
        <Modal title="Delete User" onClose={() => setDeleteTarget(null)}>
          <p className="text-[13px] mb-5" style={{ color: "var(--text2)" }}>
            Permanently delete <strong>{deleteTarget.email}</strong>? This cannot be undone.
          </p>
          <ModalActions
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleDelete}
            loading={deleteLoading}
            confirmLabel="Delete"
            danger
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
        <div className="flex items-center justify-between mb-5">
          <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>{title}</p>
          <button onClick={onClose} className="text-[18px] leading-none" style={{ color: "var(--text3)" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onCancel, onConfirm, loading, confirmLabel, danger }: {
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  confirmLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onConfirm}
        disabled={loading}
        className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
        style={{ background: danger ? "#DC2626" : "var(--teal)" }}
      >
        {loading ? "…" : confirmLabel}
      </button>
      <button
        onClick={onCancel}
        className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border"
        style={{ borderColor: "var(--border)", color: "var(--text2)" }}
      >
        Cancel
      </button>
    </div>
  );
}
