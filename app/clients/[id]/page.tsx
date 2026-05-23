"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getClientProfiles } from "@/lib/clientStorage";
import { saveNote, getNotesByClientId, deleteNote } from "@/lib/noteStorage";

const LOCATION_OPTIONS = [
  { label: "Home", value: "home" },
  { label: "School", value: "school" },
  { label: "Clinic", value: "clinic" },
];

const FIXED_PRESENT = ["Caregiver", "Teacher"];

type ActiveMode = "generate" | "perfect" | null;

export default function ClientProfilePage() {
  const params = useParams();

  const [client, setClient] = useState<any>(null);
  const [dailyNotes, setDailyNotes] = useState<any[]>([]);
  const [activeMode, setActiveMode] = useState<ActiveMode>(null);

  // Generate Note state
  const [date, setDate] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [location, setLocation] = useState("");
  const [selectedPresent, setSelectedPresent] = useState<string[]>([]);
  const [savedPresent, setSavedPresent] = useState<string[]>([]);
  const [customPresent, setCustomPresent] = useState("");
  const customPresentRef = useRef<HTMLInputElement>(null);
  const [environmentalChange, setEnvironmentalChange] = useState(false);
  const [environmentalChangeDesc, setEnvironmentalChangeDesc] = useState("");
  const [medicationConsumed, setMedicationConsumed] = useState(false);
  const [selectedBehaviors, setSelectedBehaviors] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [generatedNote, setGeneratedNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");

  // Perfect My Note state
  const [pastedNote, setPastedNote] = useState("");
  const [perfectingNote, setPerfectingNote] = useState(false);
  const [perfectStatus, setPerfectStatus] = useState("");
  const [perfectedNote, setPerfectedNote] = useState("");

  useEffect(() => {
    const clients = getClientProfiles();
    const foundClient = clients.find((c: any) => c.id === params.id);
    if (foundClient) {
      setClient(foundClient);
      setDailyNotes(getNotesByClientId(foundClient.id));
      const raw = localStorage.getItem(`path4aba_saved_present_${foundClient.id}`);
      if (raw) {
        try { setSavedPresent(JSON.parse(raw)); } catch {}
      }
    }
  }, [params.id]);

  if (!client) {
    return (
      <main className="min-h-screen p-10">
        <h1 className="text-3xl font-bold">Client not found.</h1>
      </main>
    );
  }

  const behaviors: any[] = client.clinicalProfile?.maladaptiveBehaviors || [];
  const skills: any[] = [
    ...(client.clinicalProfile?.replacementBehaviors || []),
    ...(client.clinicalProfile?.skillAcquisition || []),
  ];

  function getName(item: any): string {
    return typeof item === "string" ? item : item?.name || "";
  }

  const presentPerson = selectedPresent.join(" and ");

  function togglePresent(name: string) {
    setSelectedPresent((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  function handleOtherClick() {
    customPresentRef.current?.focus();
  }

  function handleSavePresent() {
    const name = customPresent.trim();
    if (!name) return;
    const updated = [...new Set([...savedPresent, name])];
    setSavedPresent(updated);
    localStorage.setItem(
      `path4aba_saved_present_${client.id}`,
      JSON.stringify(updated)
    );
    if (!selectedPresent.includes(name)) {
      setSelectedPresent((prev) => [...prev, name]);
    }
    setCustomPresent("");
  }

  function toggleBehavior(name: string) {
    setSelectedBehaviors((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 5) return prev;
      return [...prev, name];
    });
  }

  function toggleSkill(name: string) {
    setSelectedSkills((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 2) return prev;
      return [...prev, name];
    });
  }

  const canGenerate =
    date.trim() !== "" &&
    location !== "" &&
    selectedPresent.length > 0 &&
    selectedBehaviors.length === 5 &&
    selectedSkills.length === 2;

  async function handleGenerateNote() {
    if (!canGenerate) return;
    setGenerating(true);
    setStatus("Generating note...");
    setGeneratedNote("");

    const body = {
      clientId: client.id,
      sessionInfo: {
        date,
        timeRange: timeIn && timeOut ? `${timeIn} - ${timeOut}` : "",
        location,
        caregiver: presentPerson,
      },
      behaviorsObserved: selectedBehaviors.map((name) => ({
        name,
        topography: "",
        frequency: 1,
        antecedentContext: "",
        function: "",
      })),
      replacementSkillsAddressed: selectedSkills.map((name) => ({
        name,
        promptLevel: "",
        clientResponse: "",
        successful: true,
      })),
      activitiesUsed: [],
      reinforcersUsed: [],
      clientProfile: {
        diagnosis: client.diagnosis || [],
        setting: location,
        approvedInterventions:
          client.clinicalProfile?.interventions?.map((i: any) =>
            typeof i === "string" ? i : i.name
          ) || [],
        prohibitedInterventions: [
          "Punishment", "ResponseCost", "Restraint",
          "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive",
        ],
        reinforcers: {
          tangibles: client.clinicalProfile?.reinforcers?.slice(0, 5).join(", ") || "",
          activities: client.clinicalProfile?.homeActivities?.slice(0, 3).join(", ") || "",
          social: "verbal praise, high fives, behavior-specific praise",
          people: presentPerson,
        },
        activePrograms: {
          maladaptive:
            client.clinicalProfile?.maladaptiveBehaviors?.map((b: any) =>
              typeof b === "string" ? b : b.name
            ) || [],
          replacementSkills: [
            ...(client.clinicalProfile?.replacementBehaviors?.map((b: any) =>
              typeof b === "string" ? b : b.name
            ) || []),
            ...(client.clinicalProfile?.skillAcquisition?.map((s: any) =>
              typeof s === "string" ? s : s.name
            ) || []),
          ],
        },
      },
      clinicalEvents: [
        environmentalChange && environmentalChangeDesc
          ? `Environmental change reported: ${environmentalChangeDesc}`
          : "",
        medicationConsumed ? "Medication consumed today." : "",
      ]
        .filter(Boolean)
        .join(" "),
    };

    try {
      const res = await fetch("/api/generate-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data?.details || data?.error || "Note generation failed.");
        return;
      }
      setGeneratedNote(data.note || "");
      setStatus("");
    } catch {
      setStatus("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function handleSaveNote() {
    if (!generatedNote.trim()) {
      alert("Generate a note before saving.");
      return;
    }
    const noteObject = {
      id: crypto.randomUUID(),
      clientId: client.id,
      date: date || new Date().toLocaleDateString(),
      note: generatedNote,
    };
    saveNote(noteObject);
    setDailyNotes((prev) => [noteObject, ...prev]);
    alert("Note saved successfully.");
  }

  async function handlePerfectNote() {
    if (!pastedNote.trim()) return;
    setPerfectingNote(true);
    setPerfectStatus("Perfecting your note...");
    setPerfectedNote("");

    const body = {
      originalNote: pastedNote,
      clientProfile: {
        approvedInterventions:
          client.clinicalProfile?.interventions?.map((i: any) =>
            typeof i === "string" ? i : i.name
          ) || [],
        prohibitedInterventions: [
          "Punishment", "ResponseCost", "Restraint",
          "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive",
        ],
        reinforcers: {
          tangibles: client.clinicalProfile?.reinforcers?.slice(0, 5).join(", ") || "",
          social: "verbal praise, behavior-specific praise, high fives",
        },
      },
    };

    try {
      const res = await fetch("/api/refine-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setPerfectStatus(data?.details || data?.error || "Note perfection failed.");
        return;
      }
      setPerfectedNote(data.note || "");
      setPerfectStatus("");
    } catch {
      setPerfectStatus("Network error. Please try again.");
    } finally {
      setPerfectingNote(false);
    }
  }

  function handleDeleteNote(noteId: string) {
    const confirmed = window.confirm("Are you sure you want to delete this note?");
    if (!confirmed) return;
    deleteNote(noteId);
    setDailyNotes((prev) => prev.filter((note) => note.id !== noteId));
  }

  function CheckboxRow({
    name,
    checked,
    disabled,
    onToggle,
  }: {
    name: string;
    checked: boolean;
    disabled: boolean;
    onToggle: () => void;
  }) {
    return (
      <div
        onClick={() => !disabled && onToggle()}
        className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
          checked
            ? "bg-black text-white border-black"
            : disabled
            ? "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
            : "bg-white text-black border-gray-200 hover:border-gray-400 cursor-pointer"
        }`}
      >
        <div
          className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
            checked ? "bg-white border-white" : disabled ? "border-gray-300" : "border-gray-400"
          }`}
        >
          {checked && (
            <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 12 12">
              <path d="M10 3L5 8.5 2 5.5 1 6.5l4 4 6-7z" />
            </svg>
          )}
        </div>
        <span className="text-sm font-medium">{name}</span>
      </div>
    );
  }

  function Pill({
    label,
    selected,
    onClick,
  }: {
    label: string;
    selected: boolean;
    onClick: () => void;
  }) {
    return (
      <button
        onClick={onClick}
        className={`px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
          selected
            ? "bg-black text-white border-black"
            : "bg-white text-gray-700 border-gray-300 hover:border-gray-500"
        }`}
      >
        {label}
      </button>
    );
  }

  function NoteOutput({
    note,
    onChange,
    onCopy,
    onSave,
  }: {
    note: string;
    onChange: (v: string) => void;
    onCopy: () => void;
    onSave?: () => void;
  }) {
    return (
      <div className="mt-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold">Generated Note</h3>
          <div className="flex gap-2">
            <button
              onClick={onCopy}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-200"
            >
              Copy
            </button>
            {onSave && (
              <button
                onClick={onSave}
                className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-80"
              >
                Save Note
              </button>
            )}
          </div>
        </div>
        <textarea
          value={note}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border p-4 rounded-2xl text-sm leading-7 h-64 resize-none"
        />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-10 text-black">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Client Header */}
        <div className="bg-white rounded-3xl shadow p-8">
          <h1 className="text-4xl font-bold mb-1">{client.clientName}</h1>
          <p className="text-gray-500">Individual ABA Clinical Profile</p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-2 gap-4">
          <div
            className={`bg-white rounded-3xl shadow p-6 border-2 transition-colors ${
              activeMode === "generate" ? "border-black" : "border-transparent"
            }`}
          >
            <div className="text-3xl mb-3">📝</div>
            <h2 className="text-xl font-bold mb-2">Generate Note</h2>
            <p className="text-gray-500 text-sm mb-5">
              Create a new session note from scratch
            </p>
            <button
              onClick={() => setActiveMode(activeMode === "generate" ? null : "generate")}
              className={`w-full py-3 rounded-2xl text-sm font-semibold transition-colors ${
                activeMode === "generate"
                  ? "bg-black text-white"
                  : "bg-gray-900 text-white hover:opacity-80"
              }`}
            >
              {activeMode === "generate" ? "Active" : "Start"}
            </button>
          </div>

          <div
            className={`bg-white rounded-3xl shadow p-6 border-2 transition-colors ${
              activeMode === "perfect" ? "border-black" : "border-transparent"
            }`}
          >
            <div className="text-3xl mb-3">✨</div>
            <h2 className="text-xl font-bold mb-2">Refine Note</h2>
            <p className="text-gray-500 text-sm mb-5">
              Paste a note from another system and elevate it to audit-ready quality
            </p>
            <button
              onClick={() => setActiveMode(activeMode === "perfect" ? null : "perfect")}
              className={`w-full py-3 rounded-2xl text-sm font-semibold transition-colors ${
                activeMode === "perfect"
                  ? "bg-black text-white"
                  : "bg-gray-900 text-white hover:opacity-80"
              }`}
            >
              {activeMode === "perfect" ? "Active" : "Start"}
            </button>
          </div>
        </div>

        {/* ── Generate Note Form ── */}
        {activeMode === "generate" && (
          <>
            {/* Session Information */}
            <div className="bg-white rounded-3xl shadow p-6">
              <h2 className="text-2xl font-bold mb-6">Session Information</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                <div className="md:col-span-2">
                  <label className="block text-sm font-bold mb-2">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full border p-3 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2">Time In</label>
                  <input
                    type="time"
                    value={timeIn}
                    onChange={(e) => setTimeIn(e.target.value)}
                    className="w-full border p-3 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2">Time Out</label>
                  <input
                    type="time"
                    value={timeOut}
                    onChange={(e) => setTimeOut(e.target.value)}
                    className="w-full border p-3 rounded-xl"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-bold mb-2">Location</label>
                  <div className="flex gap-2">
                    {LOCATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setLocation(opt.value)}
                        className={`flex-1 py-3 rounded-xl border text-sm font-semibold transition-colors ${
                          location === opt.value
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-bold mb-3">Who Was Present</label>

                  <div className="flex flex-wrap gap-2 mb-3">
                    {FIXED_PRESENT.map((name) => (
                      <Pill
                        key={name}
                        label={name}
                        selected={selectedPresent.includes(name)}
                        onClick={() => togglePresent(name)}
                      />
                    ))}
                    {savedPresent.map((name) => (
                      <Pill
                        key={name}
                        label={name}
                        selected={selectedPresent.includes(name)}
                        onClick={() => togglePresent(name)}
                      />
                    ))}
                    <button
                      onClick={handleOtherClick}
                      className="px-4 py-2 rounded-full border text-sm font-semibold bg-white text-gray-700 border-gray-300 hover:border-gray-500"
                    >
                      Other
                    </button>
                  </div>

                  {selectedPresent.length > 0 && (
                    <p className="text-xs text-gray-500 mb-3">
                      Present: <span className="font-semibold text-black">{presentPerson}</span>
                    </p>
                  )}

                  <div className="flex gap-2">
                    <input
                      ref={customPresentRef}
                      type="text"
                      value={customPresent}
                      onChange={(e) => setCustomPresent(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSavePresent()}
                      placeholder="Add name (optional)"
                      className="flex-1 border p-3 rounded-xl text-sm"
                    />
                    <button
                      onClick={handleSavePresent}
                      disabled={!customPresent.trim()}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                        customPresent.trim()
                          ? "bg-black text-white border-black hover:opacity-80 cursor-pointer"
                          : "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      }`}
                    >
                      Save to profile
                    </button>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-bold mb-2">Environmental Changes</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setEnvironmentalChange(false)}
                      className={`px-5 py-2 rounded-xl border text-sm font-semibold ${
                        !environmentalChange
                          ? "bg-black text-white border-black"
                          : "bg-white text-gray-600 border-gray-300"
                      }`}
                    >
                      No
                    </button>
                    <button
                      onClick={() => setEnvironmentalChange(true)}
                      className={`px-5 py-2 rounded-xl border text-sm font-semibold ${
                        environmentalChange
                          ? "bg-black text-white border-black"
                          : "bg-white text-gray-600 border-gray-300"
                      }`}
                    >
                      Yes
                    </button>
                  </div>
                  {environmentalChange && (
                    <textarea
                      value={environmentalChangeDesc}
                      onChange={(e) => setEnvironmentalChangeDesc(e.target.value)}
                      placeholder="Describe the environmental change..."
                      className="w-full border p-3 rounded-xl h-24 mt-3"
                    />
                  )}
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-bold mb-2">Medication Consumed Today</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setMedicationConsumed(false)}
                      className={`px-5 py-2 rounded-xl border text-sm font-semibold ${
                        !medicationConsumed
                          ? "bg-black text-white border-black"
                          : "bg-white text-gray-600 border-gray-300"
                      }`}
                    >
                      No
                    </button>
                    <button
                      onClick={() => setMedicationConsumed(true)}
                      className={`px-5 py-2 rounded-xl border text-sm font-semibold ${
                        medicationConsumed
                          ? "bg-black text-white border-black"
                          : "bg-white text-gray-600 border-gray-300"
                      }`}
                    >
                      Yes
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Behavior Selector */}
            <div className="bg-white rounded-3xl shadow p-6">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-2xl font-bold">Select 5 maladaptive behaviors addressed today</h2>
                <span
                  className={`text-sm font-bold px-3 py-1 rounded-full ${
                    selectedBehaviors.length === 5
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {selectedBehaviors.length} of 5 selected
                </span>
              </div>

              {behaviors.length === 0 ? (
                <p className="text-gray-500 text-sm">No maladaptive behaviors found in this client's profile.</p>
              ) : (
                <div className="space-y-2">
                  {behaviors.map((b, i) => {
                    const name = getName(b);
                    const checked = selectedBehaviors.includes(name);
                    const disabled = !checked && selectedBehaviors.length >= 5;
                    return (
                      <CheckboxRow
                        key={i}
                        name={name}
                        checked={checked}
                        disabled={disabled}
                        onToggle={() => toggleBehavior(name)}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Replacement Skills Selector */}
            <div className="bg-white rounded-3xl shadow p-6">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-2xl font-bold">Select 2 replacement skills addressed today</h2>
                <span
                  className={`text-sm font-bold px-3 py-1 rounded-full ${
                    selectedSkills.length === 2
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {selectedSkills.length} of 2 selected
                </span>
              </div>

              {skills.length === 0 ? (
                <p className="text-gray-500 text-sm">No replacement skills found in this client's profile.</p>
              ) : (
                <div className="space-y-2">
                  {skills.map((s, i) => {
                    const name = getName(s);
                    const checked = selectedSkills.includes(name);
                    const disabled = !checked && selectedSkills.length >= 2;
                    return (
                      <CheckboxRow
                        key={i}
                        name={name}
                        checked={checked}
                        disabled={disabled}
                        onToggle={() => toggleSkill(name)}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Generate Button + Output */}
            <div className="bg-white rounded-3xl shadow p-6">
              <div className="flex gap-3 mb-4">
                <button
                  onClick={handleGenerateNote}
                  disabled={!canGenerate || generating}
                  className={`px-8 py-3 rounded-2xl text-white font-semibold transition-opacity ${
                    canGenerate && !generating
                      ? "bg-black cursor-pointer hover:opacity-80"
                      : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  {generating ? "Generating..." : "Generate Note"}
                </button>
              </div>

              {!canGenerate && !generating && (
                <p className="text-gray-400 text-sm">
                  Fill in date, select a location, select who was present, then choose exactly 5 behaviors and 2 skills to enable note generation.
                </p>
              )}

              {status && <p className="text-red-500 text-sm mt-2">{status}</p>}

              {generatedNote && (
                <NoteOutput
                  note={generatedNote}
                  onChange={setGeneratedNote}
                  onCopy={() => navigator.clipboard.writeText(generatedNote)}
                  onSave={handleSaveNote}
                />
              )}
            </div>
          </>
        )}

        {/* ── Perfect My Note Form ── */}
        {activeMode === "perfect" && (
          <div className="bg-white rounded-3xl shadow p-6">
            <h2 className="text-2xl font-bold mb-2">Refine Note</h2>
            <p className="text-gray-500 text-sm mb-5">
              Paste a note from ABA Matrix or any other system. Path4ABA will elevate it to audit-ready quality without changing the clinical facts.
            </p>

            <textarea
              value={pastedNote}
              onChange={(e) => setPastedNote(e.target.value)}
              placeholder="Paste your note here from ABA Matrix or any other system..."
              className="w-full border p-4 rounded-2xl text-sm leading-7 resize-none mb-4"
              style={{ minHeight: 200 }}
            />

            <button
              onClick={handlePerfectNote}
              disabled={!pastedNote.trim() || perfectingNote}
              className={`px-8 py-3 rounded-2xl text-white font-semibold transition-opacity ${
                pastedNote.trim() && !perfectingNote
                  ? "bg-black cursor-pointer hover:opacity-80"
                  : "bg-gray-400 cursor-not-allowed"
              }`}
            >
              {perfectingNote ? "Refining your note..." : "Refine Note"}
            </button>

            {perfectStatus && (
              <p className="text-red-500 text-sm mt-3">{perfectStatus}</p>
            )}

            {perfectedNote && (
              <NoteOutput
                note={perfectedNote}
                onChange={setPerfectedNote}
                onCopy={() => navigator.clipboard.writeText(perfectedNote)}
              />
            )}
          </div>
        )}

        {/* Note History */}
        <div className="bg-white rounded-3xl shadow p-6">
          <h2 className="text-2xl font-bold mb-4">Note History</h2>

          {dailyNotes.length === 0 ? (
            <p className="text-gray-500">No notes saved yet.</p>
          ) : (
            <div className="space-y-6">
              {dailyNotes.map((note) => (
                <div key={note.id} className="bg-gray-100 p-4 rounded-2xl">
                  <div className="flex justify-between items-center mb-3">
                    <div className="font-bold text-sm">{note.date}</div>
                    <button
                      onClick={() => handleDeleteNote(note.id)}
                      className="bg-red-500 text-white px-3 py-1 rounded-xl text-sm"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-7">{note.note}</div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
