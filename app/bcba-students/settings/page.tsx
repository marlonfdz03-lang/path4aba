"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

interface Profile {
  certification_track: string;
  fieldwork_type: string;
  trainee_bacb_id: string | null;
  supervisor_name: string | null;
  supervisor_bacb_id: string | null;
  supervisor_email: string | null;
  start_date: string | null;
  state_of_fieldwork: string | null;
  country_of_fieldwork: string | null;
}

export default function BCBAStudentsSettingsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Editable fields
  const [traineeBacbId, setTraineeBacbId] = useState("");
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorBacbId, setSupervisorBacbId] = useState("");
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [startDate, setStartDate] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("United States");

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }

    fetch("/api/bcba-students/profile").then(r => r.json()).then(data => {
      if (data.profile) {
        const p = data.profile as Profile;
        setProfile(p);
        setTraineeBacbId(p.trainee_bacb_id || "");
        setSupervisorName(p.supervisor_name || "");
        setSupervisorBacbId(p.supervisor_bacb_id || "");
        setSupervisorEmail(p.supervisor_email || "");
        setStartDate(p.start_date || "");
        setState(p.state_of_fieldwork || "");
        setCountry(p.country_of_fieldwork || "United States");
      }
      setLoading(false);
    });
  }, [status, session, router]);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/bcba-students/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trainee_bacb_id: traineeBacbId || null,
        supervisor_name: supervisorName || null,
        supervisor_bacb_id: supervisorBacbId || null,
        supervisor_email: supervisorEmail || null,
        start_date: startDate || null,
        state_of_fieldwork: state || null,
        country_of_fieldwork: country,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Save failed"); setSaving(false); return; }
    setSaved(true);
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  const fieldworkLabel = profile?.fieldwork_type === "concentrated" ? "Concentrated Supervised Fieldwork" : "Supervised Fieldwork";

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      {/* Topbar */}
      <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link href="/bcba-students" className="hover:underline" style={{ color: "var(--text3)" }}>BCBA Students</Link>
        <span style={{ color: "var(--border2)" }}>/</span>
        <span className="font-medium" style={{ color: "var(--text1)" }}>Profile Settings</span>
      </div>

      <div className="px-8 py-8 max-w-xl space-y-5">
        {/* Read-only section */}
        <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
          <p className="text-[13px] font-semibold mb-4" style={{ color: "var(--text1)" }}>Certification Details</p>
          <div className="space-y-3">
            <div className="flex justify-between">
              <p className="text-[13px]" style={{ color: "var(--text2)" }}>Certification Track</p>
              <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{profile?.certification_track}</p>
            </div>
            <div className="flex justify-between">
              <p className="text-[13px]" style={{ color: "var(--text2)" }}>Fieldwork Type</p>
              <p className="text-[13px] font-medium" style={{ color: "var(--text1)" }}>{fieldworkLabel}</p>
            </div>
          </div>
          <p className="text-[11px] mt-4" style={{ color: "var(--text3)" }}>
            To change your certification track or fieldwork type, contact{" "}
            <a href="mailto:hello@path4abaapp.com" className="underline" style={{ color: "var(--teal)" }}>hello@path4abaapp.com</a>.
          </p>
        </div>

        {/* Editable section */}
        <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
          <p className="text-[13px] font-semibold mb-5" style={{ color: "var(--text1)" }}>Supervisor & Fieldwork Info</p>

          <div className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Your BACB ID</label>
              <input type="text" value={traineeBacbId} onChange={e => setTraineeBacbId(e.target.value)}
                placeholder="e.g. 1-23-45678"
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Supervisor Name</label>
              <input type="text" value={supervisorName} onChange={e => setSupervisorName(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Supervisor BACB ID</label>
              <input type="text" value={supervisorBacbId} onChange={e => setSupervisorBacbId(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Supervisor Email</label>
              <input type="email" value={supervisorEmail} onChange={e => setSupervisorEmail(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Fieldwork Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>State</label>
                <input type="text" value={state} onChange={e => setState(e.target.value)}
                  placeholder="e.g. Florida"
                  className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Country</label>
                <input type="text" value={country} onChange={e => setCountry(e.target.value)}
                  className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                  style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
              </div>
            </div>
          </div>

          {error && (
            <p className="text-[13px] px-4 py-3 rounded-xl mt-4 border text-center" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
              {error}
            </p>
          )}
          {saved && (
            <p className="text-[13px] mt-4 text-center" style={{ color: "#16A34A" }}>✓ Saved successfully</p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-5 w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--teal)" }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </main>
  );
}
