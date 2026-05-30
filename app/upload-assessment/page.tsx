"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { buildClinicalProfile } from "@/lib/buildClinicalProfile";
import { saveClientProfile } from "@/lib/clientStorage";

export default function UploadAssessment() {
  const { data: session } = useSession();
  const [clientName, setClientName] = useState("");
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<any>(null);
  const [saved, setSaved] = useState(false);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setFileName(file.name);
    setStatus("Reading PDF and extracting clinical profile...");
    setResult(null);
    setSaved(false);

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

      setResult({ clinicalProfile });

      setStatus("Clinical profile extracted. Review and save the client profile.");
    } catch (error) {
      console.error("UPLOAD ERROR:", error);
      setStatus("Extraction failed. Please try another PDF.");
    }
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
      alert('You must be logged in to save a client. Please refresh and sign in again.');
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
        clinicalProfile: newClient.clinicalProfile,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[upload] client save error:', err);
      alert('Error saving client: ' + (err.error || 'Unknown error'));
      return;
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
          <div className="mt-10 bg-gray-100 p-6 rounded-2xl">
            <h2 className="text-2xl font-bold mb-6">
              Path4ABA Clinical Output
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold mb-2">
                  Extracted Clinical Profile
                </h3>

                <pre className="bg-white p-4 rounded-xl text-sm whitespace-pre-wrap">
                  {JSON.stringify(result.clinicalProfile, null, 2)}
                </pre>
              </div>

              <button
                type="button"
                onClick={handleSaveClientProfile}
                className="bg-black text-white px-8 py-4 rounded-2xl text-lg cursor-pointer hover:opacity-80"
              >
                Save Client Profile
              </button>

              {saved && (
                <div className="bg-green-100 text-green-800 p-4 rounded-xl">
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
