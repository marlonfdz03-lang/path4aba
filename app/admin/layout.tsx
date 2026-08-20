"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
    </svg>
  )},
  { href: "/admin/users", label: "Users", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )},
  { href: "/admin/subscriptions", label: "Subscriptions", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  )},
  { href: "/admin/clients", label: "Clients", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )},
  { href: "/admin/gate-findings", label: "Gate findings", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )},
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const adminName = (session?.user as any)?.name || (session?.user as any)?.email || "Admin";

  return (
    <div className="flex min-h-screen" style={{ fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      {/* Sidebar */}
      <aside className="w-56 flex flex-col flex-shrink-0" style={{ background: "var(--navy, #0F172A)", borderRight: "1px solid rgba(255,255,255,0.07)" }}>
        {/* Header */}
        <div className="px-5 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-[11px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Path4ABA</p>
          <p className="text-[13px] font-semibold" style={{ color: "white" }}>Admin Panel</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, label, icon }) => {
            const exact = href === "/admin";
            const active = exact ? pathname === "/admin" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors"
                style={{
                  background: active ? "rgba(27,168,160,0.15)" : "transparent",
                  color: active ? "var(--teal, #1BA8A0)" : "rgba(255,255,255,0.55)",
                }}
              >
                {icon}
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-[12px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{adminName}</p>
          <Link
            href="/clients"
            className="flex items-center gap-2 text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to app
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto" style={{ background: "var(--bg, #F8FAFC)" }}>
        {children}
      </main>
    </div>
  );
}
