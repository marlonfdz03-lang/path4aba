"use client";

import { usePathname } from "next/navigation";

export function ContentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noSidebar = ["/", "/login", "/pricing", "/onboarding", "/privacy", "/terms", "/admin"];
  const hasSidebar = !noSidebar.some(p => pathname === p || pathname.startsWith(p + "/"));
  return (
    <div
      className={hasSidebar ? "pl-[60px]" : ""}
      style={{ flex: 1, width: "100%", minWidth: 0, overflowX: "hidden" }}
    >
      {children}
    </div>
  );
}
