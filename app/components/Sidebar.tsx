"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/clients", icon: "👥", label: "Clients" },
  { href: "/schedule", icon: "📅", label: "Schedule" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  async function handleLogout() {
    await signOut();
    router.push("/login");
  }

  return (
    <nav className="fixed left-0 top-0 bottom-0 w-16 bg-gray-900 flex flex-col items-center py-6 gap-2 z-50">
      {NAV_ITEMS.map(({ href, icon, label }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl text-xl transition-colors ${
              active
                ? "bg-white text-gray-900"
                : "text-gray-400 hover:bg-gray-700 hover:text-white"
            }`}
          >
            <span>{icon}</span>
          </Link>
        );
      })}

      <button
        onClick={handleLogout}
        title="Sign out"
        className="mt-auto w-12 h-12 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </nav>
  );
}
