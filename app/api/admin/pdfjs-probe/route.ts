import { NextResponse } from "next/server";
import { auth } from "@/auth";
// The pdfjs preamble (canvas stubs + main-thread worker preload + extraction) lives in ONE place, shared with
// parsePdf's fallback — this probe must not carry a second copy.
import { ensurePdfjsRuntime, extractTextWithPdfjs } from "@/lib/pdfjsExtract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Same guard shape as every other admin route (local requireAdmin, role === "admin").
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return null;
  if ((session.user as any).role !== "admin") return null;
  return session;
}

// A trivial, self-contained 872-byte PDF whose text layer reads exactly "Topography probe 12345".
// Generated once with pdf-lib and embedded as base64 so this probe depends on NOTHING but pdfjs-dist —
// no pdf-lib (also untraced), no DB, no client_files. Verified locally that pdfjs extracts the string
// from these exact bytes, so the ONLY variable this probe measures is whether pdfjs loads and runs in
// the Azure runtime.
const PROBE_PDF_B64 =
  "JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAxMTUKPj4Kc3RyZWFtCnicHYq7CkJBDET7fEVqQcxjN9mFi4XgYmEj5AdErqJooYjfb5RhDmdgnrAJIPzldYHVbr5/5vf1dFw69VYaeevIBeMMktwD/6+MksjGA6ZabDjZMHcxTmvehZxyDROrQsoqqlq0rjFuEAvYBhzgC9oRGuoKZW5kc3RyZWFtCmVuZG9iagoKNyAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvT2JqU3RtCi9OIDUKL0ZpcnN0IDI2Ci9MZW5ndGggMzYyCj4+CnN0cmVhbQp4nNVSTUvDQBC976+Yox5kJ5uPTaUU+pEoSFFaQVE8pMlSImVXko3Uf+9M0lp6EM8SHrsz82b3beYFgKAgiiAEnUIEcaggBh0EMB4L+fj1YUA+FFvTCnlXVy28EgdhBW9Czl1nPQRiMhEn7rzwxc5txdAEAZOPjIfGVV1pGhjnWZ4jakRMIkKCqBa0zgkjgqKYaiqlPUFHB1BOh4jhlGr5gEQPPVzvufGhP6OVuAlzFgM3Sof4516+KxvOUH/pGU2EXLpqUXgDF4trhSrBlBTGcRDql0v6HY0pvPu/j+v1187++sKzOfN4eciNYQ/0U5Yr07quKWnszMsdVXhza3afxtdlcaVxlJJOnY7IYwdjyOf7zbspeyqH2d7frD1rGBKcW5qqLmZuT+5D+kKFECTIHpxa6zy7svej9aSGo+Tg0TPJLEjIdbfxfcjJQMhZ0Zpe6kknibClq2q7BflU26lt62OCT/wGOd/F8wplbmRzdHJlYW0KZW5kb2JqCgo4IDAgb2JqCjw8Ci9TaXplIDkKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCA0MQovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA5IF0KPj4Kc3RyZWFtCnicFcTBDQAgDAOxS4rEl/3FSOzUEj8MdJsNScmp0hIHxPv5wgBh1gOzCmVuZHN0cmVhbQplbmRvYmoKCnN0YXJ0eHJlZgo2NjgKJSVFT0Y=";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // pdfjs logs worker/font notices through console.warn/error — capture them so any go/no-go signal is in
  // the JSON rather than lost to the server log.
  const warnings: string[] = [];
  const _w = console.warn;
  const _e = console.error;
  console.warn = (...a: any[]) => { warnings.push("warn: " + a.map(String).join(" ")); };
  console.error = (...a: any[]) => { warnings.push("error: " + a.map(String).join(" ")); };

  let ok = false;
  let chars = 0;
  let extractedSample = "";
  let error: string | null = null;
  let pdfjsVersion = "?";
  let stubs: Record<string, string> | null = null;
  let workerHandler = "not-reached";
  try {
    // Install stubs + worker handler via the shared module (returns provenance for the report).
    const prov = await ensurePdfjsRuntime();
    stubs = prov.stubs;
    workerHandler = prov.workerHandler;

    const bytes = new Uint8Array(Buffer.from(PROBE_PDF_B64, "base64"));
    const text = await extractTextWithPdfjs(bytes);
    chars = text.length;
    extractedSample = text.slice(0, 120);
    ok = text.includes("Topography") && text.includes("probe");
    // @ts-ignore - no type declarations for this subpath; pd.mjs is already loaded (cached) by extract above.
    pdfjsVersion = (await import("pdfjs-dist/legacy/build/pdf.mjs")).version || "?";
  } catch (e: any) {
    error = (e && (e.stack || e.message)) || String(e);
  } finally {
    console.warn = _w;
    console.error = _e;
  }

  return NextResponse.json({
    ok,
    nodeVersion: process.version,
    pdfjsVersion,
    chars,
    extractedSample,
    error,
    // Per stub: "installed-stub" = we added it (Azure has no canvas here); "already-present" = a real impl
    // (e.g. @napi-rs/canvas) was already on globalThis and we left it untouched.
    stubs,
    // "installed" = we preloaded pdf.worker.mjs into globalThis.pdfjsWorker (main-thread mode);
    // "already-present" = a handler was already there. "not-reached" = threw before setup ran.
    workerHandler,
    // Only the notices that decide the go/no-go; font notices are expected and filtered.
    warnings: warnings.filter((x) => /worker|DOMMatrix|Path2D|canvas|font/i.test(x)),
  });
}
