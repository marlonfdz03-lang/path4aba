"use client";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Reports</p>
      </div>
      <div className="px-8 py-10 max-w-2xl flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "var(--teal-light)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        </div>
        <h1 className="text-[18px] font-semibold mb-2" style={{ color: "var(--text1)" }}>Reports</h1>
        <p className="text-[14px]" style={{ color: "var(--text3)" }}>
          Advanced reporting is coming soon. You'll be able to generate progress summaries, export your fieldwork data, and track trends across your entire journey here.
        </p>
      </div>
    </main>
  );
}
