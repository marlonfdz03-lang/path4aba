import { NextResponse } from "next/server";
import { auth } from "@/auth";

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

// Minimal canvas-API stubs. pdf.mjs references DOMMatrix/ImageData/Path2D at MODULE INIT (its Node canvas
// polyfill) — that is what threw "DOMMatrix is not defined" and produced the opaque 500. getTextContent()
// never calls their methods (verified: extraction is byte-identical with empty stubs), so these only need to
// EXIST. We install with a strict absence check so a real @napi-rs/canvas implementation, when present, is
// NEVER clobbered — and we report which happened so the caller can see whether Azure has canvas or not.
class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: unknown) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
    }
  }
}
class ImageDataStub {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w = 0, h = 0) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
class Path2DStub {}

function installStub(name: string, Ctor: unknown): "installed-stub" | "already-present" {
  const g = globalThis as any;
  if (g[name] === undefined) { g[name] = Ctor; return "installed-stub"; }
  return "already-present";
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Install BEFORE the dynamic import below, so pdf.mjs's module-init sees them and skips the canvas load.
  const stubs = {
    DOMMatrix: installStub("DOMMatrix", DOMMatrixStub),
    ImageData: installStub("ImageData", ImageDataStub),
    Path2D: installStub("Path2D", Path2DStub),
  };

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
  let workerHandler = "not-reached";
  try {
    // Preload the worker handler for MAIN-THREAD mode, BEFORE importing pdf.mjs. pdf.mjs loads its worker via
    // a RUNTIME VARIABLE (import(this.workerSrc)) that @vercel/nft cannot follow, so pdf.worker.mjs was pruned
    // from the standalone build and the fake-worker setup failed. Importing it here by LITERAL specifier both
    // (a) makes nft trace pdf.worker.mjs into the bundle, and (b) lets us hand its WorkerMessageHandler to
    // pdfjs via globalThis.pdfjsWorker — pdfjs then runs the worker on the MAIN THREAD and never imports the
    // external file. ??= so a real handler (if one is ever present) is never clobbered.
    const g = globalThis as any;
    if (g.pdfjsWorker?.WorkerMessageHandler) {
      workerHandler = "already-present";
    } else {
      // @ts-ignore - pdfjs-dist ships no type declarations for this subpath.
      const wk: any = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      g.pdfjsWorker ??= { WorkerMessageHandler: wk.WorkerMessageHandler };
      workerHandler = "installed";
    }

    // DYNAMIC import with a LITERAL specifier — required (a static import is hoisted ahead of the stubs above
    // by ESM, which is what caused the 500). @vercel/nft traces literal dynamic imports into the Next.js
    // standalone build the same as static ones, so pdfjs stays in the bundle; and if that ever failed, it now
    // surfaces here as catchable JSON ("Cannot find module …") instead of an opaque 500.
    // @ts-ignore - pdfjs-dist ships no type declarations for this subpath; used dynamically-typed.
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjsVersion = pdfjs.version || "?";
    const bytes = new Uint8Array(Buffer.from(PROBE_PDF_B64, "base64"));
    const doc = await pdfjs.getDocument({
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
    // Per stub: "installed-stub" = we added it (Azure has no canvas here); "already-present" = a real impl
    // (e.g. @napi-rs/canvas) was already on globalThis and we left it untouched.
    stubs,
    // "installed" = we preloaded pdf.worker.mjs into globalThis.pdfjsWorker (main-thread mode);
    // "already-present" = a handler was already there and we left it. "not-reached" = threw before this ran.
    workerHandler,
    // Only the notices that decide the go/no-go; font notices are expected and filtered so they don't drown
    // a real failure.
    warnings: warnings.filter((x) => /worker|DOMMatrix|Path2D|canvas|font/i.test(x)),
  });
}
