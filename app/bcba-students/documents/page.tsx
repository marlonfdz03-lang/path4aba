"use client";

export const dynamic = "force-dynamic";

export default function DocumentsPage() {
  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <div className="flex items-center px-8 h-14 bg-white" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text3)" }}>Documents</p>
      </div>
      <div className="px-8 py-10 max-w-2xl flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "var(--teal-light)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <h1 className="text-[18px] font-semibold mb-2" style={{ color: "var(--text1)" }}>Documents</h1>
        <p className="text-[14px]" style={{ color: "var(--text3)" }}>
          Document management is coming soon. You'll be able to upload and manage your BACB forms, supervision agreements, and other fieldwork documents here.
        </p>
      </div>
    </main>
  );
}
