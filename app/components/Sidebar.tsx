"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getClientProfiles } from "@/lib/clientStorage";

// ── Inline SVG icons ────────────────────────────────────────────────────────

const IconDashboard = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
  </svg>
);

const IconUsers = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const IconCalendar = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const IconFileText = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    <line x1="10" y1="9" x2="8" y2="9"/>
  </svg>
);

const IconSparkles = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
    <path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/>
    <path d="M19 13l.5 1.5L21 15l-1.5.5L19 17l-.5-1.5L17 15l1.5-.5z"/>
  </svg>
);

const IconLogout = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

const IconCreditCard = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2"/>
    <line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
);

const IconChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
);

// ── Logo ─────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-3 px-4 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <Image src="/logo.png" alt="Path4ABA logo" width={36} height={36} style={{ borderRadius: "6px" }} />
      <div>
        <p className="text-[15px] font-semibold leading-none">
          <span className="text-white">Path</span>
          <span style={{ color: "#24BDB4" }}>4</span>
          <span className="text-white">ABA</span>
        </p>
        <p className="text-[10px] uppercase tracking-widest mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
          Clinical Intelligence
        </p>
      </div>
    </div>
  );
}

// ── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: React.FC;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-[10px] px-[10px] py-[9px] rounded-[6px] text-sm font-medium transition-colors"
      style={{
        color: active ? "white" : "rgba(255,255,255,0.65)",
        background: active ? "rgba(27,168,160,0.22)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <Icon />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--teal)" }}>
          {badge}
        </span>
      )}
    </Link>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [clientCount, setClientCount] = useState(0);
  const [user, setUser] = useState<{ name: string; profession: string; initials: string } | null>(null);

  useEffect(() => {
    setClientCount(getClientProfiles().length);
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        const meta = data.user.user_metadata || {};
        const email = data.user.email || "";
        const name = meta.full_name || email.split("@")[0] || "User";
        const profession = meta.profession || "Clinician";
        const initials = name.split(/\s+/).filter(Boolean).map((w: string) => w[0].toUpperCase()).slice(0, 2).join("") || "??";
        setUser({ name, profession, initials });
      }
    });
  }, []);

  if (pathname === "/login" || pathname === "/pricing") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  async function handleLogout() {
    await signOut();
    router.push("/login");
  }

  return (
    <nav
      className="fixed left-0 top-0 bottom-0 flex flex-col z-50"
      style={{ width: 220, background: "var(--navy)" }}
    >
      <Logo />

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-[10px] py-3 space-y-5">
        {/* Workspace group */}
        <div>
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            Workspace
          </p>
          <div className="space-y-0.5">
            <NavItem href="/" label="Dashboard" icon={IconDashboard} active={isActive("/")} />
            <NavItem href="/clients" label="Clients" icon={IconUsers} active={isActive("/clients")} badge={clientCount} />
            <NavItem href="/schedule" label="Schedule" icon={IconCalendar} active={isActive("/schedule")} />
          </div>
        </div>

        {/* Tools group */}
        <div>
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            Tools
          </p>
          <div className="space-y-0.5">
            <NavItem href="/generate-note" label="Generate Note" icon={IconFileText} active={isActive("/generate-note")} />
            <NavItem href="/clients" label="Refine Note" icon={IconSparkles} active={false} />
          </div>
        </div>

        {/* Account group */}
        <div>
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            Account
          </p>
          <div className="space-y-0.5">
            <NavItem href="/billing" label="Billing" icon={IconCreditCard} active={isActive("/billing")} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {/* User card */}
        {user && (
          <div
            className="flex items-center gap-2.5 px-4 py-3 cursor-pointer transition-colors"
            style={{ color: "white" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
              style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
            >
              {user.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate">{user.name}</p>
              <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{user.profession}</p>
            </div>
            <IconChevronUp />
          </div>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-[10px] px-4 py-3 text-sm transition-colors"
          style={{ color: "rgba(255,255,255,0.5)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)";
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <IconLogout />
          <span>Sign out</span>
        </button>
      </div>
    </nav>
  );
}
