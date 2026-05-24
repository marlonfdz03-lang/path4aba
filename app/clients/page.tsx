"use client";

import { supabase } from '@/lib/supabase'

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getClientProfiles,
  deleteClientProfile,
} from "@/lib/clientStorage";

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function handleDeleteClient(clientId: string) {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this client profile?"
    );

    if (!confirmDelete) return;

    deleteClientProfile(clientId);
    await supabase.from("clients").delete().eq("id", clientId);

    setClients((prev) =>
      prev.filter(
        (client) => client.id !== clientId
      )
    );
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("clients")
          .select("id, client_name, clinical_profile")
          .eq("rbt_id", user.id);
        if (data && data.length > 0) {
          setClients(data.map(row => ({
            id: row.id,
            clientName: row.client_name,
            clinicalProfile: row.clinical_profile,
          })));
          setLoaded(true);
          return;
        }
      }
      setClients(getClientProfiles());
      setLoaded(true);
    }
    load();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 p-10 text-black">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">
            Client Profiles
          </h1>

          <Link
            href="/upload-assessment"
            className="bg-black text-white px-6 py-3 rounded-2xl"
          >
            New Client
          </Link>
        </div>

        {!loaded ? (
          <div className="bg-white p-10 rounded-3xl shadow">
            Loading client profiles...
          </div>
        ) : clients.length === 0 ? (
          <div className="bg-white p-10 rounded-3xl shadow">
            No client profiles created yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {clients.map((client: any) => (
              <div
                key={client.id}
                className="bg-white p-6 rounded-3xl shadow"
              >
                <h2 className="text-2xl font-bold mb-4">
                  {client.clientName}
                </h2>

                <div className="space-y-2 text-sm mb-6">
                  <p>
                    Maladaptives:{" "}
                    {client
                      .clinicalProfile
                      ?.maladaptiveBehaviors
                      ?.length || 0}
                  </p>

                  <p>
                    Interventions:{" "}
                    {client
                      .clinicalProfile
                      ?.interventions
                      ?.length || 0}
                  </p>

                  <p>
                    Skills:{" "}
                    {client
                      .clinicalProfile
                      ?.skillAcquisition
                      ?.length || 0}
                  </p>

                  <p>
                    Replacements:{" "}
                    {client
                      .clinicalProfile
                      ?.replacementBehaviors
                      ?.length || 0}
                  </p>

                  <p>
                    Reinforcers:{" "}
                    {client
                      .clinicalProfile
                      ?.reinforcers
                      ?.length || 0}
                  </p>
                </div>

                <div className="flex gap-3">
                  <Link
                    href={`/clients/${client.id}`}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl"
                  >
                    Open Profile
                  </Link>

                  <button
                    onClick={() =>
                      handleDeleteClient(
                        client.id
                      )
                    }
                    className="bg-red-500 text-white px-4 py-2 rounded-xl"
                  >
                    Delete Client
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}