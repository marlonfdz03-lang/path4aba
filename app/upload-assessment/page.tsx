"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { buildClinicalProfile } from "@/lib/buildClinicalProfile";
import { saveClientProfile } from "@/lib/clientStorage";

interface StoRow {
  _id: string;
  name: string;
  targetType: "replacement" | "maladaptive";
  baselineValue: string;
  goalValue: string;
  totalWeeks: string;
  targetDate: string;
}

interface HistoryRow {
  _id: string;
  name: string;
  targetType: "replacement" | "maladaptive";
  weekStart: string;
  weekEnd: string;
  value: string;
}

export default function UploadAssessment() {
  const { data: session } = useSession();
  const [clientName, setClientName] = useState("");
  const [summaryTable, setSummaryTable] = useState<any>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [reviewStos, setReviewStos] = useState<StoRow[]>([]);
  const [reviewHistory, setReviewHistory] = useState<HistoryRow[]>([]);
  const [currentValues, setCurrentValues] = useState<{ name: string; type: "replacement" | "maladaptive"; value: string }[]>([]);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setFileName(file.name);
    setStatus("Reading PDF and extracting clinical profile...");
    setResult(null);
    setSaved(false);
    setReviewStos([]);
    setReviewHistory([]);
    setCurrentValues([]);
    setSummaryTable(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/extract-assessment", {
        method: "POST",
        body: formData,
      });

      const responseText = await response.text();
      console.log("RAW RESPONSE:", responseText);

      let extractedData;

      try {
        extractedData = JSON.parse(responseText);
      } catch (error) {
        console.error("JSON PARSE ERROR:", error);
        setStatus("Server returned invalid response. Check terminal console.");
        return;
      }

      if (!response.ok) {
        console.error("SERVER ERROR:", extractedData);
        setStatus(
          extractedData?.details ||
            extractedData?.error ||
            "Extraction failed."
        );
        return;
      }

      const clinicalProfile = buildClinicalProfile(extractedData);
      const st = extractedData.extractedSummaryTable ?? null;
      setSummaryTable(st);
      setResult({ clinicalProfile, summaryTable: st });

      const stos: StoRow[] = (extractedData.extractedStos ?? []).map(
        (s: any) => ({
          _id: crypto.randomUUID(),
          name: s.name ?? "",
          targetType: s.targetType === "maladaptive" ? "maladaptive" : "replacement",
          baselineValue: String(s.baselineValue ?? ""),
          goalValue: String(s.goalValue ?? ""),
          totalWeeks: s.totalWeeks != null ? String(s.totalWeeks) : "16",
          targetDate: s.targetDate ?? "",
        })
      );
      setReviewStos(stos);

      const history: HistoryRow[] = (extractedData.extractedHistoricalData ?? []).map(
        (h: any) => ({
          _id: crypto.randomUUID(),
          name: h.name ?? "",
          targetType: h.targetType === "maladaptive" ? "maladaptive" : "replacement",
          weekStart: h.weekStart ?? "",
          weekEnd: h.weekEnd ?? "",
          value: String(h.value ?? ""),
        })
      );
      setReviewHistory(history);

      // Build latest-value lookup from extracted historical data
      const latestByName: Record<string, number> = {};
      for (const h of extractedData.extractedHistoricalData ?? []) {
        const key = (h.name ?? "").toLowerCase();
        if (latestByName[key] == null || (h.weekStart ?? "") >= (latestByName[key + "_date"] ?? "")) {
          latestByName[key] = h.value;
          latestByName[key + "_date"] = h.weekStart ?? "";
        }
      }

      const cvRows: { name: string; type: "replacement" | "maladaptive"; value: string }[] = [];
      for (const b of extractedData.maladaptiveBehaviors ?? []) {
        const n = typeof b === "string" ? b : b.name;
        if (!n) continue;
        const latest = latestByName[n.toLowerCase()];
        cvRows.push({ name: n, type: "maladaptive", value: latest != null ? String(latest) : "" });
      }
      for (const s of [...(extractedData.replacementBehaviors ?? []), ...(extractedData.skillAcquisition ?? [])]) {
        const n = typeof s === "string" ? s : s.name;
        if (!n) continue;
        const latest = latestByName[n.toLowerCase()];
        cvRows.push({ name: n, type: "replacement", value: latest != null ? String(latest) : "" });
      }
      setCurrentValues(cvRows);

      setStatus("Clinical profile extracted. Review and save the client profile.");
    } catch (error) {
      console.error("UPLOAD ERROR:", error);
      setStatus("Extraction failed. Please try another PDF.");
    }
  }

  function updateSto(index: number, field: keyof StoRow, value: string) {
    setReviewStos(prev =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function removeSto(index: number) {
    setReviewStos(prev => prev.filter((_, i) => i !== index));
  }

  function updateHistory(index: number, field: keyof HistoryRow, value: string) {
    setReviewHistory(prev =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function removeHistory(index: number) {
    setReviewHistory(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSaveClientProfile() {
    if (!clientName.trim()) {
      alert("Please enter the client name first.");
      return;
    }

    if (!result?.clinicalProfile) {
      alert("Please upload an assessment first.");
      return;
    }

    const userId = (session?.user as any)?.id;
    if (!userId) {
      alert("You must be logged in to save a client. Please refresh and sign in again.");
      return;
    }

    const newClient = {
      id: crypto.randomUUID(),
      clientName: clientName.trim(),
      clinicalProfile: result.clinicalProfile,
    };

    saveClientProfile(newClient);

    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newClient.id,
        clientName: newClient.clientName,
        clinicalProfile: summaryTable
          ? { ...newClient.clinicalProfile, summaryTable }
          : newClient.clinicalProfile,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      console.error("[upload] client save error:", err);
      alert("Error saving client: " + (err.error || "Unknown error"));
      return;
    }

    // Save STOs
    const validStos = reviewStos.filter(s => s.name.trim());
    if (validStos.length > 0) {
      await fetch("/api/stos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validStos.map(s => ({
            clientId: newClient.id,
            targetName: s.name.trim(),
            targetType: s.targetType,
            baselineValue: parseFloat(s.baselineValue) || 0,
            goalValue: parseFloat(s.goalValue) || 0,
            totalWeeks: s.totalWeeks ? parseInt(s.totalWeeks) : 16,
            targetDate: s.targetDate || null,
            startDate: null,
            status: "active",
          }))
        ),
      }).catch(err => console.error("[upload] STO save error:", err));
    }

    // Save replacement skill historical data
    const replacementHistory = reviewHistory.filter(
      h => h.targetType === "replacement" && h.name.trim()
    );
    if (replacementHistory.length > 0) {
      await fetch("/api/replacement-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          replacementHistory.map(h => ({
            clientId: newClient.id,
            replacementSkill: h.name.trim(),
            weekStart: h.weekStart || null,
            weekEnd: h.weekEnd || null,
            observedPercentage: parseFloat(h.value) || 0,
            totalTrials: 10,
            userConfirmed: true,
          }))
        ),
      }).catch(err => console.error("[upload] replacement history save error:", err));
    }

    // Save maladaptive behavior historical data
    const maladaptiveHistory = reviewHistory.filter(
      h => h.targetType === "maladaptive" && h.name.trim()
    );
    if (maladaptiveHistory.length > 0) {
      await fetch("/api/maladaptive-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          maladaptiveHistory.map(h => ({
            clientId: newClient.id,
            behaviorName: h.name.trim(),
            weekStart: h.weekStart || null,
            weekEnd: h.weekEnd || null,
            frequency: parseInt(h.value) || 0,
            userConfirmed: true,
          }))
        ),
      }).catch(err => console.error("[upload] maladaptive history save error:", err));
    }

    // Save current starting values (today's baseline for each target)
    const today = new Date().toISOString().split("T")[0];
    const weekStart = today.substring(0, 7) + "-01";

    const cvReplacement = currentValues.filter(
      (cv) => cv.type === "replacement" && cv.name.trim() && cv.value.trim()
    );
    if (cvReplacement.length > 0) {
      await fetch("/api/replacement-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          cvReplacement.map((cv) => ({
            clientId: newClient.id,
            replacementSkill: cv.name.trim(),
            sessionDate: today,
            weekStart,
            observedPercentage: parseFloat(cv.value) || 0,
            totalTrials: 10,
            userConfirmed: true,
          }))
        ),
      }).catch((err) => console.error("[upload] current values (replacement) save error:", err));
    }

    const cvMaladaptive = currentValues.filter(
      (cv) => cv.type === "maladaptive" && cv.name.trim() && cv.value.trim()
    );
    if (cvMaladaptive.length > 0) {
      await fetch("/api/maladaptive-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          cvMaladaptive.map((cv) => ({
            clientId: newClient.id,
            behaviorName: cv.name.trim(),
            sessionDate: today,
            weekStart,
            frequency: parseInt(cv.value) || 0,
            userConfirmed: true,
          }))
        ),
      }).catch((err) => console.error("[upload] current values (maladaptive) save error:", err));
    }

    setSaved(true);
    setStatus("Client profile saved successfully.");
  }

  return (
    <main className="min-h-screen bg-gray-50 text-black p-10">
      <div className="max-w-4xl mx-auto bg-white p-8 rounded-3xl shadow">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-4xl font-bold">Upload Assessment</h1>

          <Link href="/clients" className="text-blue-600 underline">
            View Clients
          </Link>
        </div>

        <p className="text-gray-600 mb-8">
          Create a client profile by uploading an ABA assessment. Path4ABA will
          extract maladaptive behaviors, interventions, skill acquisition goals,
          replacement behaviors, and reinforcers from the PDF.
        </p>

        <input
          type="text"
          placeholder="Client name, example: Brandon Cruz"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          className="w-full border p-4 rounded-xl mb-6"
        />

        <div className="border-2 border-dashed border-gray-300 rounded-3xl p-10 text-center">
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileUpload}
            className="mb-6"
          />

          {fileName && <p className="text-gray-600 mb-2">File: {fileName}</p>}

          {status && <p className="text-gray-600">Status: {status}</p>}
        </div>

        {result && (
          <div className="mt-10 space-y-8">

            {/* ── Extracted Clinical Profile ── */}
            <div className="bg-gray-100 p-6 rounded-2xl">
              <h2 className="text-2xl font-bold mb-6">Path4ABA Clinical Output</h2>
              <div>
                <h3 className="text-xl font-bold mb-2">Extracted Clinical Profile</h3>
                <pre className="bg-white p-4 rounded-xl text-sm whitespace-pre-wrap">
                  {JSON.stringify(result.clinicalProfile, null, 2)}
                </pre>
              </div>
            </div>

            {/* ── STO Review ── */}
            {reviewStos.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 p-6 rounded-2xl">
                <h3 className="text-xl font-bold mb-1">
                  Extracted Short-Term Objectives ({reviewStos.length})
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Review and edit before saving. Remove any that are incorrect.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-blue-100 text-left">
                        <th className="p-2 font-semibold">Name</th>
                        <th className="p-2 font-semibold">Type</th>
                        <th className="p-2 font-semibold">Baseline</th>
                        <th className="p-2 font-semibold">Goal</th>
                        <th className="p-2 font-semibold">Weeks</th>
                        <th className="p-2 font-semibold">Target Date</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewStos.map((sto, i) => (
                        <tr key={sto._id} className="border-t border-blue-100">
                          <td className="p-1">
                            <input
                              className="w-full border rounded px-2 py-1 text-sm"
                              value={sto.name}
                              onChange={e => updateSto(i, "name", e.target.value)}
                            />
                          </td>
                          <td className="p-1">
                            <select
                              className="border rounded px-2 py-1 text-sm"
                              value={sto.targetType}
                              onChange={e =>
                                updateSto(i, "targetType", e.target.value as any)
                              }
                            >
                              <option value="replacement">Replacement</option>
                              <option value="maladaptive">Maladaptive</option>
                            </select>
                          </td>
                          <td className="p-1">
                            <input
                              className="w-20 border rounded px-2 py-1 text-sm"
                              type="number"
                              value={sto.baselineValue}
                              onChange={e => updateSto(i, "baselineValue", e.target.value)}
                            />
                          </td>
                          <td className="p-1">
                            <input
                              className="w-20 border rounded px-2 py-1 text-sm"
                              type="number"
                              value={sto.goalValue}
                              onChange={e => updateSto(i, "goalValue", e.target.value)}
                            />
                          </td>
                          <td className="p-1">
                            <input
                              className="w-16 border rounded px-2 py-1 text-sm"
                              type="number"
                              value={sto.totalWeeks}
                              onChange={e => updateSto(i, "totalWeeks", e.target.value)}
                            />
                          </td>
                          <td className="p-1">
                            <input
                              className="w-32 border rounded px-2 py-1 text-sm"
                              type="date"
                              value={sto.targetDate}
                              onChange={e => updateSto(i, "targetDate", e.target.value)}
                            />
                          </td>
                          <td className="p-1 text-center">
                            <button
                              onClick={() => removeSto(i)}
                              className="text-red-500 hover:text-red-700 font-bold text-lg leading-none"
                              title="Remove"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Historical Data Review ── */}
            {reviewHistory.length > 0 && (
              <div className="bg-green-50 border border-green-200 p-6 rounded-2xl">
                <h3 className="text-xl font-bold mb-1">
                  Extracted Historical Data ({reviewHistory.length} points)
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  These data points will be saved to the client&apos;s progress graphs. Remove any that are incorrect.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-green-100 text-left">
                        <th className="p-2 font-semibold">Name</th>
                        <th className="p-2 font-semibold">Type</th>
                        <th className="p-2 font-semibold">Week Start</th>
                        <th className="p-2 font-semibold">Week End</th>
                        <th className="p-2 font-semibold">Value</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewHistory.map((row, i) => (
                        <tr key={row._id} className="border-t border-green-100">
                          <td className="p-1">
                            <input
                              className="w-full border rounded px-2 py-1 text-sm"
                              value={row.name}
                              onChange={e => updateHistory(i, "name", e.target.value)}
                            />
                          </td>
                          <td className="p-1">
                            <select
                              className="border rounded px-2 py-1 text-sm"
                              value={row.targetType}
                              onChange={e =>
                                updateHistory(i, "targetType", e.target.value as any)
                              }
                            >
                              <option value="replacement">Replacement</option>
                              <option value="maladaptive">Maladaptive</option>
                            </select>
                          </td>
                          <td className="p-1">
                            <input
                              className="w-32 border rounded px-2 py-1 text-sm"
                              type="date"
                              value={row.weekStart}
                              onChange={e => updateHistory(i, "weekStart", e.target.value)}
                            />
                          </td>
                          <td className="p-1">
                            <input
                              className="w-32 border rounded px-2 py-1 text-sm"
                              type="date"
                              value={row.weekEnd}
                              onChange={e => updateHistory(i, "weekEnd", e.target.value)}
                            />
                          </td>
                          <td className="p-1">
                            <input
                              className="w-20 border rounded px-2 py-1 text-sm"
                              type="number"
                              value={row.value}
                              title={row.targetType === "replacement" ? "Percentage (0–100)" : "Frequency count"}
                              onChange={e => updateHistory(i, "value", e.target.value)}
                            />
                          </td>
                          <td className="p-1 text-center">
                            <button
                              onClick={() => removeHistory(i)}
                              className="text-red-500 hover:text-red-700 font-bold text-lg leading-none"
                              title="Remove"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Current Starting Values ── */}
            {currentValues.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-2xl">
                <h3 className="text-xl font-bold mb-1">Current Starting Values</h3>
                <p className="text-sm text-gray-500 mb-4">
                  These become the first data point on each progress chart. Pre-filled from the assessment — update any values that have changed since the assessment was written.
                </p>
                <div className="grid grid-cols-1 gap-3">
                  {currentValues.map((cv, i) => (
                    <div key={i} className="flex items-center gap-3 bg-white border border-yellow-100 rounded-xl px-4 py-3">
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{
                          background: cv.type === "maladaptive" ? "#FEF3E2" : "#E6F9F5",
                          color: cv.type === "maladaptive" ? "#B7791F" : "#0D8A6A",
                        }}
                      >
                        {cv.type === "maladaptive" ? "BEHAVIOR" : "SKILL"}
                      </span>
                      <span className="flex-1 text-sm font-medium text-gray-800 truncate">{cv.name}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <input
                          type="number"
                          min="0"
                          max={cv.type === "replacement" ? "100" : undefined}
                          value={cv.value}
                          onChange={(e) =>
                            setCurrentValues((prev) =>
                              prev.map((row, j) => (j === i ? { ...row, value: e.target.value } : row))
                            )
                          }
                          placeholder={cv.type === "replacement" ? "0–100" : "count"}
                          className="w-24 border rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none"
                          style={{ borderColor: "#FCD34D" }}
                        />
                        <span className="text-xs text-gray-400">
                          {cv.type === "replacement" ? "%" : "/ wk"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Save ── */}
            <div className="bg-gray-100 p-6 rounded-2xl">
              <button
                type="button"
                onClick={handleSaveClientProfile}
                className="bg-black text-white px-8 py-4 rounded-2xl text-lg cursor-pointer hover:opacity-80"
              >
                Save Client Profile
                {(reviewStos.length > 0 || reviewHistory.length > 0) && (
                  <span className="ml-2 text-sm opacity-70">
                    + {reviewStos.length} STO{reviewStos.length !== 1 ? "s" : ""}
                    {reviewHistory.length > 0 &&
                      ` + ${reviewHistory.length} data point${reviewHistory.length !== 1 ? "s" : ""}`}
                  </span>
                )}
              </button>

              {saved && (
                <div className="mt-4 bg-green-100 text-green-800 p-4 rounded-xl">
                  Client profile saved. Go to{" "}
                  <Link href="/clients" className="underline font-bold">
                    Client Profiles
                  </Link>
                  .
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
