import { NextResponse } from "next/server";
import { auth } from "@/auth";
// STATIC import (not dynamic) ON PURPOSE. The Azure deploy runs the Next.js STANDALONE build, whose
// node_modules is pruned by the @vercel/nft tracer to only what deployed code imports — which is why
// pdfjs-dist was absent and could not be tested via the SSH console. A static import is the guaranteed
// way to make the tracer include pdfjs-dist/legacy/build/pdf.mjs in the standalone bundle. (A dynamic
// import() with a literal specifier is usually traced too, but static removes all doubt, and forcing pdfjs
// into the build is the entire purpose of this probe.) legacy/build is the Node-safe (non-worker) build.
// @ts-ignore — pdfjs-dist ships no type declarations for this subpath; this probe uses it dynamically-typed.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

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

  // pdfjs logs worker/font notices through console.warn/error — capture them so the go/no-go signal
  // (a DOMMatrix/Path2D/worker failure) is visible in the JSON rather than lost to the server log.
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
  try {
    pdfjsVersion = (pdfjs as any).version || "?";
    const bytes = new Uint8Array(Buffer.from(PROBE_PDF_B64, "base64"));
    const doc = await (pdfjs as any).getDocument({
      data: bytes,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 1,
    }).promise;
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    const text = tc.items.map((i: any) => i.str).join("");
    chars = text.length;
    extractedSample = text.slice(0, 120);
    ok = text.includes("Topography") && text.includes("probe");
    await doc.destroy();
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
    // Only the notices that decide the go/no-go (a missing browser global or a worker failure); font
    // notices are expected and filtered out so they don't drown the signal.
    warnings: warnings.filter((x) => /worker|DOMMatrix|Path2D|canvas|font/i.test(x)),
  });
}
