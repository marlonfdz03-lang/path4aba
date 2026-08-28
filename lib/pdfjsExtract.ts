// SINGLE COPY of the pdfjs runtime setup + text extraction, shared by the admin probe
// (app/api/admin/pdfjs-probe) and parsePdf's fallback path so the preamble can never drift between them.
//
// A bare `import pdfjs` does NOT survive the Next.js standalone build in the Azure Node runtime. Three
// things this module handles, each verified against the live Azure App Service via the probe:
//   1. CANVAS STUBS — pd.mjs references DOMMatrix/ImageData/Path2D at MODULE INIT (its Node canvas polyfill),
//      and @napi-rs/canvas is pruned by the tracer, so init throws "DOMMatrix is not defined". getTextContent
//      never calls their methods (verified: byte-identical extraction with empty stubs), so stubs that merely
//      EXIST suffice. Installed with ??= so a real @napi-rs/canvas impl, if ever present, is never clobbered.
//   2. MAIN-THREAD WORKER — pd.mjs loads its worker via a RUNTIME-VARIABLE import(this.workerSrc) that
//      @vercel/nft cannot follow, so pdf.worker.mjs is pruned and the fake-worker setup fails. We import it by
//      LITERAL specifier (traced) and expose its WorkerMessageHandler via globalThis.pdfjsWorker, so pdfjs
//      runs the worker on the MAIN THREAD and never imports the external file.
//   3. LITERAL SPECIFIERS — pd.mjs and pd.worker.mjs are imported by literal string so nft includes both.

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

export interface PdfjsRuntimeProvenance {
  stubs: Record<string, "installed-stub" | "already-present">;
  workerHandler: "installed" | "already-present";
}

// Idempotent: install the canvas stubs and preload the main-thread worker handler. Returns provenance so
// callers (the probe) can report which world they are in. Safe to call repeatedly.
export async function ensurePdfjsRuntime(): Promise<PdfjsRuntimeProvenance> {
  const stubs = {
    DOMMatrix: installStub("DOMMatrix", DOMMatrixStub),
    ImageData: installStub("ImageData", ImageDataStub),
    Path2D: installStub("Path2D", Path2DStub),
  };

  const g = globalThis as any;
  let workerHandler: "installed" | "already-present";
  if (g.pdfjsWorker?.WorkerMessageHandler) {
    workerHandler = "already-present";
  } else {
    // @ts-ignore - pdfjs-dist ships no type declarations for this subpath.
    const wk: any = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    g.pdfjsWorker ??= { WorkerMessageHandler: wk.WorkerMessageHandler };
    workerHandler = "installed";
  }
  return { stubs, workerHandler };
}

// Extract the full text of a PDF via pdfjs (layout-aware, correct advance-width word reconstruction).
// Joins each text item, inserting a newline on hasEOL. Caller applies normalizeLigatures.
export async function extractTextWithPdfjs(data: Uint8Array | Buffer): Promise<string> {
  await ensurePdfjsRuntime();
  // @ts-ignore - pdfjs-dist ships no type declarations for this subpath.
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = "";
    for (const it of tc.items) {
      line += (it as any).str;
      if ((it as any).hasEOL) line += "\n";
    }
    out += line + "\n";
  }
  await doc.destroy();
  return out;
}
