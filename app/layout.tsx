import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import Sidebar from "./components/Sidebar";
import { ContentShell } from "./components/ContentShell";
import { Providers } from "./components/Providers";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Path4ABA",
  description: "Clinical Intelligence for ABA",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} h-full antialiased`}>
      <body className="min-h-full font-[family-name:var(--font-dm-sans)]">
        <Providers>
          <Sidebar />
          <ContentShell>{children}</ContentShell>
        </Providers>
      </body>
    </html>
  );
}
