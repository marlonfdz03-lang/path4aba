"use client";

import { usePathname } from "next/navigation";

export function ContentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noSidebar = ["/login", "/pricing", "/onboarding"];
  return (
    <div className={noSidebar.some(p => pathname === p || pathname.startsWith(p + "/")) ? "" : "pl-[220px]"}>
      {children}
    </div>
  );
}
