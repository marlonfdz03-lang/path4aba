"use client";

import { usePathname } from "next/navigation";

export function ContentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noSidebar = ["/login", "/pricing", "/onboarding", "/privacy", "/terms", "/admin"];
  return (
    <div className={noSidebar.some(p => pathname === p || pathname.startsWith(p + "/")) ? "" : "pl-[60px]"}>
      {children}
    </div>
  );
}
