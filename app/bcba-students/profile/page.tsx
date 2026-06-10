"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
];

export default function TraineeProfilePage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [traineeName,      setTraineeName]      = useState("");
  const [traineeBackbId,   setTraineeBackbId]   = useState("");
  const [stateOfFieldwork, setStateOfFieldwork] = useState("");
  const [supervisorName,   setSupervisorName]   = useState("");
  const [supervisorBackbId,setSupervisorBackbId]= useState("");
  const [supervisorEmail,  setSupervisorEmail]  = useState("");
  const [startDate,        setStartDate]        = useState("");

  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState("");
  const [loaded,  setLoaded]  = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }

    setTraineeName(session.user.name || "");

    fetch("/api/bcba-students/profile")
      .then(r => r.json())
      .then(d => {
        const p = d.profile;
        if (p) {
          setTraineeBackbId(p.trainee_bacb_id    || "");
          setStateOfFieldwork(p.state_of_fieldwork || "");
          setSupervisorName(p.supervisor_name     || "");
          setSupervisorBackbId(p.supervisor_bacb_id || "");
          setSupervisorEmail(p.supervisor_email   || "");
          setStartDate(p.start_date               || "");
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [status, session, router]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");

    try {
      const calls: Promise<Response>[] = [
        fetch("/api/bcba-students/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trainee_bacb_id:    traineeBackbId  || null,
            state_of_fieldwork: stateOfFieldwork || null,
            supervisor_name:    supervisorName   || null,
            supervisor_bacb_id: supervisorBackbId || null,
            supervisor_email:   supervisorEmail  || null,
            start_date:         startDate        || null,
          }),
        }),
      ];

      if (traineeName.trim()) {
        calls.push(
          fetch("/api/user/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: traineeName.trim() }),
          })
        );
      }

      const results = await Promise.all(calls);
      for (const res of results) {
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || "Failed to save");
        }
      }

      setSaved(true);
      setTimeout(() => router.push("/bcba-students"), 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Trainee Profile</p>
        </div>
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  const INPUT = "w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal-300";
  const INPUT_STYLE = { borderColor: "var(--border)", color: "var(--text1)" };
  const LABEL = "block text-[12px] font-medium mb-1.5";
  const LABEL_STYLE = { color: "var(--text2)" };

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Fieldwork Tracker → Trainee Profile</p>
      </div>

      <div className="px-8 py-8 max-w-2xl">
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--text1)" }}>Trainee Profile</h1>
        <p className="text-[13.5px] mb-6" style={{ color: "var(--text3)" }}>
          Used to generate monthly verification forms and supervision records. Matches your official BACB account information.
        </p>

        <div className="bg-white rounded-xl p-6" style={{ border: "1px solid var(--border)" }}>
          <div className="h-[3px] -mx-6 -mt-6 mb-6 rounded-t-xl" style={{ background: "linear-gradient(90deg, var(--teal), var(--sky))" }} />

          <div className="space-y-5">

            {/* Trainee Name */}
            <div>
              <label className={LABEL} style={LABEL_STYLE}>
                Trainee Name{" "}
                <span style={{ color: "var(--text3)", fontWeight: 400 }}>(as it appears on official BACB forms)</span>
              </label>
              <input
                type="text"
                value={traineeName}
                onChange={e => setTraineeName(e.target.value)}
                placeholder="Full legal name"
                className={INPUT}
                style={INPUT_STYLE}
              />
            </div>

            {/* BACB Trainee ID + State */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL} style={LABEL_STYLE}>BACB Trainee ID</label>
                <input
                  type="text"
                  value={traineeBackbId}
                  onChange={e => setTraineeBackbId(e.target.value)}
                  placeholder="e.g. 1-23456789"
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </div>
              <div>
                <label className={LABEL} style={LABEL_STYLE}>State of Fieldwork</label>
                <select
                  value={stateOfFieldwork}
                  onChange={e => setStateOfFieldwork(e.target.value)}
                  className={INPUT}
                  style={{ ...INPUT_STYLE, background: "white" }}
                >
                  <option value="">Select state…</option>
                  {US_STATES.map(s => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Divider + section label */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 4 }} />
            <p className="text-[11px] font-semibold uppercase tracking-widest -mt-1" style={{ color: "var(--text3)" }}>
              Supervisor Information
            </p>

            {/* Supervisor Name */}
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Supervisor Name</label>
              <input
                type="text"
                value={supervisorName}
                onChange={e => setSupervisorName(e.target.value)}
                placeholder="Full name of supervising BCBA"
                className={INPUT}
                style={INPUT_STYLE}
              />
            </div>

            {/* Supervisor BACB ID + Email */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL} style={LABEL_STYLE}>Supervisor BACB ID</label>
                <input
                  type="text"
                  value={supervisorBackbId}
                  onChange={e => setSupervisorBackbId(e.target.value)}
                  placeholder="e.g. 1-23456789"
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </div>
              <div>
                <label className={LABEL} style={LABEL_STYLE}>Supervisor Email</label>
                <input
                  type="email"
                  value={supervisorEmail}
                  onChange={e => setSupervisorEmail(e.target.value)}
                  placeholder="supervisor@example.com"
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </div>
            </div>

            {/* Start Date */}
            <div>
              <label className={LABEL} style={LABEL_STYLE}>Fieldwork Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
              />
            </div>

            {/* Messages */}
            {error && (
              <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#fef2f2", color: "#991b1b" }}>{error}</p>
            )}
            {saved && (
              <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#f0fdf4", color: "#166534" }}>
                Profile saved! Redirecting to dashboard…
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || saved}
                className="px-6 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-60 transition-opacity hover:opacity-90"
                style={{ background: "var(--teal)" }}
              >
                {saving ? "Saving…" : saved ? "Saved ✓" : "Save Profile"}
              </button>
              <a
                href="/bcba-students"
                className="px-6 py-2.5 rounded-xl text-[13px] font-medium border transition-opacity hover:opacity-80"
                style={{ borderColor: "var(--border)", color: "var(--text2)" }}
              >
                Skip for now
              </a>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}
