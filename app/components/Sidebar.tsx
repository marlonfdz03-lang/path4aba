"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
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

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const IconClipboard = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <rect x="8" y="2" width="8" height="4" rx="1"/>
  </svg>
);

const IconGraduationCap = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
    <path d="M6 12v5c3 3 9 3 12 0v-5"/>
  </svg>
);

const IconLock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const IconNotes = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
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
      <img src="/logo.png" alt="Path4ABA" width={36} height={36} style={{ objectFit: "contain" }} />
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
  const { data: session } = useSession();
  const [clientCount, setClientCount] = useState(0);
  const [hasBCBAStudents, setHasBCBAStudents] = useState(false);
  const [hasActiveRBT, setHasActiveRBT] = useState(false);
  const [user, setUser] = useState<{ name: string; profession: string; initials: string } | null>(null);

  useEffect(() => {
    setClientCount(getClientProfiles().length);

    if (session?.user) {
      const role = ((session.user as any).role as string) || "";
      const name = session.user.name || session.user.email?.split("@")[0] || "User";
      const initials = name.split(/\s+/).filter(Boolean).map((w: string) => w[0].toUpperCase()).slice(0, 2).join("") || "??";
      setUser({ name, profession: role, initials });

      fetch("/api/user/subscription")
        .then((r) => r.json())
        .then((d) => {
          setHasBCBAStudents(!!d.hasBCBAStudents);
          setHasActiveRBT(!!d.hasActiveRBT);
        })
        .catch(() => {});
    }
  }, [session]);

  const isBCBA = ["bcba", "bcaba"].includes((user?.profession || "").toLowerCase());

  if (["/login", "/pricing", "/onboarding", "/privacy", "/terms"].some(p => pathname === p || pathname.startsWith(p + "/"))) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  async function handleLogout() {
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <nav
      className="fixed left-0 top-0 bottom-0 flex flex-col z-50"
      style={{ width: 200, background: "var(--navy)" }}
    >
      <Logo />

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-[10px] py-3 space-y-5">
        {isBCBA ? (
          <>
            {/* BCBA Workspace */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                Workspace
              </p>
              <div className="space-y-0.5">
                <NavItem href="/bcba" label="My Clients" icon={IconUsers} active={isActive("/bcba")} />
                <NavItem href="/schedule" label="Schedule" icon={IconCalendar} active={isActive("/schedule")} />
              </div>
            </div>
            {/* BCBA Students */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                BCBA Students
              </p>
              <div className="space-y-0.5">
                {hasBCBAStudents ? (
                  <>
                    <NavItem href="/bcba-students" label="Dashboard" icon={IconGraduationCap} active={isActive("/bcba-students") && !isActive("/bcba-students/log") && !isActive("/bcba-students/monthly") && !isActive("/bcba-students/settings")} />
                    <NavItem href="/bcba-students/log" label="Log session" icon={IconFileText} active={isActive("/bcba-students/log")} />
                    <NavItem href="/bcba-students/monthly" label="Monthly view" icon={IconCalendar} active={isActive("/bcba-students/monthly")} />
                    <NavItem href="/bcba-students/settings" label="Settings" icon={IconSettings} active={isActive("/bcba-students/settings")} />
                  </>
                ) : (
                  <Link
                    href="/bcba-students"
                    className="flex items-center gap-[10px] px-[10px] py-[9px] rounded-[6px] text-sm font-medium"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    <IconGraduationCap />
                    <span className="flex-1">Fieldwork tracker</span>
                    <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: "rgba(27,168,160,0.22)", color: "#24BDB4" }}>
                      <IconLock /> {hasActiveRBT ? "$9.99/mo" : "$14.99/mo"}
                    </span>
                  </Link>
                )}
              </div>
            </div>
            {/* Account */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                Account
              </p>
              <div className="space-y-0.5">
                <NavItem href="/settings" label="Settings" icon={IconSettings} active={isActive("/settings")} />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* RBT Workspace */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                Workspace
              </p>
              <div className="space-y-0.5">
                <NavItem href="/" label="Dashboard" icon={IconDashboard} active={isActive("/")} />
                <NavItem href="/clients" label="Clients" icon={IconUsers} active={isActive("/clients")} badge={clientCount} />
                <NavItem href="/schedule" label="Schedule" icon={IconCalendar} active={isActive("/schedule")} />
              </div>
            </div>
            {/* BCBA Students */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                BCBA Students
              </p>
              <div className="space-y-0.5">
                {hasBCBAStudents ? (
                  <>
                    <NavItem href="/bcba-students" label="Dashboard" icon={IconGraduationCap} active={isActive("/bcba-students") && !isActive("/bcba-students/log") && !isActive("/bcba-students/monthly") && !isActive("/bcba-students/settings")} />
                    <NavItem href="/bcba-students/log" label="Log session" icon={IconFileText} active={isActive("/bcba-students/log")} />
                    <NavItem href="/bcba-students/monthly" label="Monthly view" icon={IconCalendar} active={isActive("/bcba-students/monthly")} />
                    <NavItem href="/bcba-students/settings" label="Settings" icon={IconSettings} active={isActive("/bcba-students/settings")} />
                  </>
                ) : (
                  <Link
                    href="/bcba-students"
                    className="flex items-center gap-[10px] px-[10px] py-[9px] rounded-[6px] text-sm font-medium"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    <IconGraduationCap />
                    <span className="flex-1">Fieldwork tracker</span>
                    <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: "rgba(27,168,160,0.22)", color: "#24BDB4" }}>
                      <IconLock /> {hasActiveRBT ? "$9.99/mo" : "$14.99/mo"}
                    </span>
                  </Link>
                )}
              </div>
            </div>
            {/* Account */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                Account
              </p>
              <div className="space-y-0.5">
                <NavItem href="/settings" label="Settings" icon={IconSettings} active={isActive("/settings")} />
              </div>
            </div>
          </>
        )}
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

        {/* Admin link — only for admin role */}
        {(session?.user as any)?.role === 'admin' && (
          <Link
            href="/admin"
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>Admin</span>
          </Link>
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
