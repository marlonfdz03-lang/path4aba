import type { Viewport } from "next";
import "./theme.css";

/**
 * Layout for the mobile-app-only experience under /app.
 *
 * This is intentionally standalone: it does NOT render the website's Sidebar
 * or ContentShell. Because the Next.js App Router has a single root <html>/
 * <body> (app/layout.tsx), this layout nests inside it — so `.app-shell` uses
 * position:fixed with a high z-index to fully cover the website chrome and
 * present an always-dark, full-screen surface.
 */

export const viewport: Viewport = {
  themeColor: "#0A1628",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover", // draw under the notch / home indicator
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="app-shell">{children}</div>;
}
