"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Client = { id: string; name: string };

const IconChevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// Time-of-day greeting from the device clock.
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// First letters of the first two words, e.g. "Alex Doe" -> "AD".
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join("") || "?";

const firstName = (name: string) => name.split(/\s+/)[0] || name;

export default function AppHomePage() {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "";

  const [clients, setClients] = useState<Client[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    // Same-origin fetch: the session cookie is sent automatically.
    fetch("/api/clients")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: Client[] = (Array.isArray(data) ? data : []).map((row: { id: string; internal_code?: string; clinical_profile?: { name?: string } | null }) => ({
          id: row.id,
          name: row.clinical_profile?.name || row.internal_code || "Unnamed Client",
        }));
        setClients(list);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-screen">
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />

      <div className="app-screen__content">
        {/* Header */}
        <header className="app-home__header">
          <div>
            <p className="app-home__greeting" suppressHydrationWarning>{greeting()}</p>
            <h1 className="app-home__name">{userName ? firstName(userName) : "Welcome"}</h1>
          </div>
          <div className="app-home__avatar" aria-hidden="true">
            {userName ? initials(userName) : ""}
          </div>
        </header>

        {/* Your clients */}
        <p className="app-section-label">Your clients</p>

        {state === "loading" && <p className="app-empty">Loading your clients…</p>}

        {state === "error" && (
          <p className="app-empty">Couldn&apos;t load your clients. Please try again.</p>
        )}

        {state === "ready" && clients.length === 0 && (
          <p className="app-empty">No clients yet.</p>
        )}

        {state === "ready" && clients.length > 0 && (
          <div className="app-session-list">
            {clients.map((c) => (
              <Link
                key={c.id}
                href={`/app/note?clientId=${c.id}`}
                className="app-session-card app-session-card--compact"
              >
                <span className="app-session-card__avatar">{initials(c.name)}</span>
                <span className="app-session-card__body">
                  <span className="app-session-card__name">{c.name}</span>
                </span>
                <span className="app-role-card__chevron"><IconChevron /></span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
