import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import Sidebar from "./components/Sidebar";
import { ContentShell } from "./components/ContentShell";
import { Providers } from "./components/Providers";
import { PushInit } from "./components/PushInit";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Path4ABA — AI-Powered Clinical Documentation for ABA Professionals",
  description:
    "Generate session notes, manage clients, and track fieldwork hours. Built for RBTs, BCBAs and ABA Students. HIPAA compliant. Start free for 7 days.",
  keywords:
    "ABA therapy software, RBT session notes, BCBA documentation, fieldwork tracker, ABA student hours, BACB compliant",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  verification: {
    google: "idSyjMLg7SdGz4-4rhm-OCpk2vRDD9F_CUKzlCTvSbg",
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
          <PushInit />
          <Sidebar />
          <ContentShell>{children}</ContentShell>
        </Providers>
      </body>
    </html>
  );
}
