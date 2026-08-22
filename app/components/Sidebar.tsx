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

const IconChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
);

const IconChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const IconHelp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

const IconChrome = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="4"/>
    <line x1="21.17" y1="8" x2="12" y2="8"/>
    <line x1="3.95" y1="6.06" x2="8.54" y2="14"/>
    <line x1="10.88" y1="21.94" x2="15.46" y2="14"/>
  </svg>
);

const IconFolder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);

const IconBarChart = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const IconAward = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="6"/>
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>
  </svg>
);

const IconProfile = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

// ── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  badge,
  expanded,
}: {
  href: string;
  label: string;
  icon: React.FC;
  active: boolean;
  badge?: number;
  expanded: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className="flex items-center rounded-[6px] text-sm font-medium transition-colors"
      style={{
        gap: expanded ? 10 : 0,
        padding: "9px 10px",
        justifyContent: expanded ? "flex-start" : "center",
        color: active ? "white" : "rgba(255,255,255,0.65)",
        background: active ? "rgba(37,99,235,0.22)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <span className="flex-shrink-0"><Icon /></span>
      <span
        style={{
          opacity: expanded ? 1 : 0,
          maxWidth: expanded ? 160 : 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          transition: "opacity 0.15s, max-width 0.2s",
          flex: expanded ? "1" : undefined,
        }}
      >
        {label}
      </span>
      {badge !== undefined && badge > 0 && expanded && (
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
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [clientCount, setClientCount] = useState(0);
  const [hasBCBAStudents, setHasBCBAStudents] = useState(false);
  const [fieldworkOpen, setFieldworkOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; profession: string; initials: string } | null>(null);

  useEffect(() => {
    if (pathname.startsWith("/bcba-students")) setFieldworkOpen(true);
  }, [pathname]);

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
        })
        .catch(() => {});
    }
  }, [session]);

  const role = (user?.profession || "").toLowerCase();
  const isBCBA = ["bcba", "bcaba"].includes(role);
  const isAdmin = role === "admin";
  const isStudentOnly = ["bcba_student", "bcaba_student"].includes(role);
  const isOwner = session?.user?.email === "marlonfdz03@gmail.com";

  if (["/" , "/login", "/pricing", "/onboarding", "/privacy", "/terms", "/admin", "/app"].some(p => pathname === p || pathname.startsWith(p + "/"))) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  async function handleLogout() {
    await signOut({ callbackUrl: "/login" });
  }

  async function handleFieldworkUpgrade() {
    const userId = (session?.user as any)?.id;
    if (!userId) { router.push("/login"); return; }
    try {
      const res = await fetch("/api/create-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan: "bcba_students_addon", interval: "month" }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      router.push("/pricing");
    }
  }

  const sectionHeader = (label: string) =>
    expanded ? (
      <p
        className="text-[10px] uppercase tracking-widest font-medium mb-1 px-[10px]"
        style={{ color: "rgba(255,255,255,0.35)" }}
      >
        {label}
      </p>
    ) : null;

  return (
    <nav
      className="fixed left-0 top-0 bottom-0 flex flex-col z-50"
      style={{
        width: expanded ? 220 : 60,
        background: "var(--navy)",
        transition: "width 0.2s ease",
        overflow: "hidden",
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo */}
      <div
        className="flex items-center px-[10px] py-5 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", gap: expanded ? 12 : 0, justifyContent: expanded ? "flex-start" : "center" }}
      >
        <img src="/logo.png" alt="Path4ABA" width={36} height={36} style={{ objectFit: "contain", flexShrink: 0 }} />
        <div
          style={{
            opacity: expanded ? 1 : 0,
            maxWidth: expanded ? 160 : 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            transition: "opacity 0.15s, max-width 0.2s",
          }}
        >
          <p className="text-[15px] font-semibold leading-none">
            <span className="text-white">Path</span>
            <span style={{ color: "var(--teal2)" }}>4</span>
            <span className="text-white">ABA</span>
          </p>
          <p className="text-[10px] uppercase tracking-widest mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
            Clinical Intelligence
          </p>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-[10px] py-3 space-y-5">
        {isStudentOnly ? (
          // ── BCBA Student / BCaBA Student ─────────────────────────────────
          <>
            <div>
              {sectionHeader("Fieldwork")}
              <div className="space-y-0.5">
                {hasBCBAStudents ? (
                  <>
                    <NavItem href="/bcba-students" label="Dashboard" icon={IconDashboard}
                      active={isActive("/bcba-students") && !isActive("/bcba-students/log") && !isActive("/bcba-students/monthly") && !isActive("/bcba-students/documents") && !isActive("/bcba-students/reports") && !isActive("/bcba-students/settings")}
                      expanded={expanded} />
                    <NavItem href="/bcba-students/log" label="Log Session" icon={IconFileText} active={isActive("/bcba-students/log")} expanded={expanded} />
                    <NavItem href="/bcba-students/monthly" label="Monthly View" icon={IconCalendar} active={isActive("/bcba-students/monthly")} expanded={expanded} />
                    <NavItem href="/bcba-students/documents" label="Documents" icon={IconFolder} active={isActive("/bcba-students/documents")} expanded={expanded} />
                    <NavItem href="/bcba-students/reports" label="Reports" icon={IconBarChart} active={isActive("/bcba-students/reports")} expanded={expanded} />
                    <NavItem href="/bcba-students/bacb" label="BACB Requirements" icon={IconAward} active={isActive("/bcba-students/bacb")} expanded={expanded} />
                    <NavItem href="/bcba-students/profile" label="Profile" icon={IconProfile} active={isActive("/bcba-students/profile")} expanded={expanded} />
                  </>
                ) : (
                  <Link
                    href="/pricing"
                    title="Fieldwork Tracker"
                    className="flex items-center rounded-[6px] text-sm font-medium"
                    style={{ gap: expanded ? 10 : 0, padding: "9px 10px", justifyContent: expanded ? "flex-start" : "center", color: "rgba(255,255,255,0.45)" }}
                  >
                    <span className="flex-shrink-0"><IconGraduationCap /></span>
                    {expanded && (
                      <>
                        <span className="flex-1 whitespace-nowrap overflow-hidden">Fieldwork tracker</span>
                        <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(37,99,235,0.22)", color: "var(--teal2)" }}>
                          <IconLock /> Add-on
                        </span>
                      </>
                    )}
                  </Link>
                )}
              </div>
            </div>
            <div>
              {sectionHeader("Account")}
              <div className="space-y-0.5">
                <NavItem href="/settings" label="Settings" icon={IconSettings} active={isActive("/settings")} expanded={expanded} />
                <NavItem href="/help" label="Help" icon={IconHelp} active={isActive("/help")} expanded={expanded} />
              </div>
            </div>
            {/* Motivational card — only shown when expanded */}
            {expanded && hasBCBAStudents && (
              <div
                className="mx-1 rounded-xl p-3 text-center"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <p className="text-[16px] mb-1">✨</p>
                <p className="text-[12px] font-semibold text-white leading-snug mb-1">
                  You&apos;re building a better future.
                </p>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Keep going, you&apos;ve got this! 💙
                </p>
              </div>
            )}
          </>
        ) : isBCBA ? (
          // ── BCBA / BCaBA ──────────────────────────────────────────────────
          <>
            <div>
              {sectionHeader("Workspace")}
              <div className="space-y-0.5">
                <NavItem href="/dashboard" label="Dashboard" icon={IconDashboard} active={isActive("/dashboard")} expanded={expanded} />
                <NavItem href="/bcba" label="Clients" icon={IconUsers} active={isActive("/bcba")} expanded={expanded} />
                {/* BCBA-only: the Assessment Builder lives directly below Clients. RBTs never render this branch. */}
                <NavItem href="/assessment" label="Assessment Builder" icon={IconFileText} active={isActive("/assessment")} expanded={expanded} />
                <NavItem href="/schedule" label="Schedule" icon={IconCalendar} active={isActive("/schedule")} expanded={expanded} />
                <a
                  href="https://chromewebstore.google.com/detail/imignknofjahdlgopbfkpopcdnffchgk"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Chrome Extension"
                  className="flex items-center rounded-[6px] text-sm font-medium transition-colors"
                  style={{
                    gap: expanded ? 10 : 0,
                    padding: "9px 10px",
                    justifyContent: expanded ? "flex-start" : "center",
                    color: "rgba(255,255,255,0.65)",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span className="flex-shrink-0"><IconChrome /></span>
                  <span style={{ opacity: expanded ? 1 : 0, maxWidth: expanded ? 160 : 0, overflow: "hidden", whiteSpace: "nowrap", transition: "opacity 0.15s, max-width 0.2s" }}>
                    Chrome Extension
                  </span>
                </a>
              </div>
            </div>
            <div>
              {sectionHeader("Account")}
              <div className="space-y-0.5">
                <NavItem href="/settings" label="Settings" icon={IconSettings} active={isActive("/settings")} expanded={expanded} />
                <NavItem href="/help" label="Help" icon={IconHelp} active={isActive("/help")} expanded={expanded} />
              </div>
            </div>
          </>
        ) : (
          // ── RBT (and all other roles) ─────────────────────────────────────
          <>
            {/* WORKSPACE */}
            <div>
              {sectionHeader("Workspace")}
              <div className="space-y-0.5">
                <NavItem href="/dashboard" label="Dashboard" icon={IconDashboard} active={isActive("/dashboard")} expanded={expanded} />
                <NavItem href="/clients" label="Clients" icon={IconUsers} active={isActive("/clients")} badge={clientCount} expanded={expanded} />
                {/* Assessment Builder is BCBA-only. This branch also renders for admin (and any non-BCBA role),
                    so it is shown ONLY when admin — never to an RBT. */}
                {isAdmin && (
                  <NavItem href="/assessment" label="Assessment Builder" icon={IconFileText} active={isActive("/assessment")} expanded={expanded} />
                )}
                <NavItem href="/schedule" label="Schedule" icon={IconCalendar} active={isActive("/schedule")} expanded={expanded} />
                <a
                  href="https://chromewebstore.google.com/detail/imignknofjahdlgopbfkpopcdnffchgk"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Chrome Extension"
                  className="flex items-center rounded-[6px] text-sm font-medium transition-colors"
                  style={{ gap: expanded ? 10 : 0, padding: "9px 10px", justifyContent: expanded ? "flex-start" : "center", color: "rgba(255,255,255,0.65)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span className="flex-shrink-0"><IconChrome /></span>
                  <span style={{ opacity: expanded ? 1 : 0, maxWidth: expanded ? 160 : 0, overflow: "hidden", whiteSpace: "nowrap", transition: "opacity 0.15s, max-width 0.2s" }}>
                    Chrome Extension
                  </span>
                </a>
              </div>
            </div>

            {/* TOOLS — Fieldwork Tracker accordion */}
            <div>
              {sectionHeader("Tools")}
              <div className="space-y-0.5">
                {hasBCBAStudents ? (
                  <>
                    {/* Accordion header */}
                    <button
                      onClick={() => setFieldworkOpen((o) => !o)}
                      title="Fieldwork Tracker"
                      className="flex items-center rounded-[6px] text-sm font-medium w-full transition-colors"
                      style={{
                        gap: expanded ? 10 : 0,
                        padding: "9px 10px",
                        justifyContent: expanded ? "flex-start" : "center",
                        color: isActive("/bcba-students") ? "white" : "rgba(255,255,255,0.65)",
                        background: isActive("/bcba-students") ? "rgba(37,99,235,0.22)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { if (!isActive("/bcba-students")) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                      onMouseLeave={(e) => { if (!isActive("/bcba-students")) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span className="flex-shrink-0"><IconGraduationCap /></span>
                      <span style={{ opacity: expanded ? 1 : 0, maxWidth: expanded ? 160 : 0, overflow: "hidden", whiteSpace: "nowrap", transition: "opacity 0.15s, max-width 0.2s", flex: expanded ? "1" : undefined, textAlign: "left" }}>
                        Fieldwork Tracker
                      </span>
                      {expanded && (
                        <span style={{ flexShrink: 0, transition: "transform 0.2s", transform: fieldworkOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
                          <IconChevronDown />
                        </span>
                      )}
                    </button>
                    {/* Accordion subitems */}
                    {fieldworkOpen && expanded && (
                      <div className="space-y-0.5 pl-4">
                        <NavItem href="/bcba-students" label="Dashboard" icon={IconDashboard}
                          active={pathname === "/bcba-students"} expanded={expanded} />
                        <NavItem href="/bcba-students/log" label="Log Session" icon={IconFileText} active={isActive("/bcba-students/log")} expanded={expanded} />
                        <NavItem href="/bcba-students/monthly" label="Monthly View" icon={IconCalendar} active={isActive("/bcba-students/monthly")} expanded={expanded} />
                        <NavItem href="/bcba-students/documents" label="Documents" icon={IconFolder} active={isActive("/bcba-students/documents")} expanded={expanded} />
                        <NavItem href="/bcba-students/reports" label="Reports" icon={IconBarChart} active={isActive("/bcba-students/reports")} expanded={expanded} />
                        <NavItem href="/bcba-students/bacb" label="BACB Requirements" icon={IconAward} active={isActive("/bcba-students/bacb")} expanded={expanded} />
                        <NavItem href="/bcba-students/profile" label="Profile" icon={IconProfile} active={isActive("/bcba-students/profile")} expanded={expanded} />
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => router.push("/pricing?tab=students&plan=addon")}
                    title="Fieldwork Tracker"
                    className="flex items-center rounded-[6px] text-sm font-medium w-full"
                    style={{ gap: expanded ? 10 : 0, padding: "9px 10px", justifyContent: expanded ? "flex-start" : "center", color: "rgba(255,255,255,0.45)", background: "transparent", border: "none", cursor: "pointer" }}
                  >
                    <span className="flex-shrink-0"><IconGraduationCap /></span>
                    {expanded && (
                      <>
                        <span className="flex-1 whitespace-nowrap overflow-hidden text-left">Fieldwork Tracker</span>
                        <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(37,99,235,0.22)", color: "var(--teal2)" }}>
                          <IconLock /> Add-on
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* ACCOUNT */}
            <div>
              {sectionHeader("Account")}
              <div className="space-y-0.5">
                <NavItem href="/settings" label="Settings" icon={IconSettings} active={isActive("/settings")} expanded={expanded} />
                <NavItem href="/help" label="Help" icon={IconHelp} active={isActive("/help")} expanded={expanded} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {/* User card — click to open profile settings */}
        {user && (
          <div
            role="button"
            onClick={() => router.push("/settings?tab=profile")}
            className="flex items-center cursor-pointer transition-colors px-[10px] py-3"
            style={{
              color: "white",
              gap: expanded ? 10 : 0,
              justifyContent: expanded ? "flex-start" : "center",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
              style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
            >
              {user.initials}
            </div>
            <div
              style={{
                opacity: expanded ? 1 : 0,
                maxWidth: expanded ? 160 : 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                transition: "opacity 0.15s, max-width 0.2s",
                flex: "1",
                minWidth: 0,
              }}
            >
              <p className="text-[13px] font-medium truncate">{user.name}</p>
              <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{user.profession}</p>
            </div>
            {expanded && <IconChevronUp />}
          </div>
        )}

        {/* Admin link — only for admin role */}
        {(session?.user as any)?.role === 'admin' && (
          <Link
            href="/admin"
            title="Admin"
            className="w-full flex items-center transition-colors px-[10px] py-3 text-sm"
            style={{
              gap: expanded ? 10 : 0,
              justifyContent: expanded ? "flex-start" : "center",
              color: "rgba(255,255,255,0.5)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)";
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)";
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span
              style={{
                opacity: expanded ? 1 : 0,
                maxWidth: expanded ? 160 : 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                transition: "opacity 0.15s, max-width 0.2s",
              }}
            >
              Admin
            </span>
          </Link>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          title="Sign out"
          className="w-full flex items-center transition-colors px-[10px] py-3 text-sm"
          style={{
            gap: expanded ? 10 : 0,
            justifyContent: expanded ? "flex-start" : "center",
            color: "rgba(255,255,255,0.5)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)";
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <span style={{ flexShrink: 0 }}><IconLogout /></span>
          <span
            style={{
              opacity: expanded ? 1 : 0,
              maxWidth: expanded ? 160 : 0,
              overflow: "hidden",
              whiteSpace: "nowrap",
              transition: "opacity 0.15s, max-width 0.2s",
            }}
          >
            Sign out
          </span>
        </button>
      </div>
    </nav>
  );
}
