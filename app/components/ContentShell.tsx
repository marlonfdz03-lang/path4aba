"use client";

import { usePathname } from "next/navigation";

export function ContentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className={pathname === "/login" || pathname === "/pricing" ? "" : "pl-[220px]"}>
      {children}
    </div>
  );
}
