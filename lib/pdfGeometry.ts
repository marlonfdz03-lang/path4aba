// lib/pdfGeometry.ts  —  FAST/MAS step 2: DETERMINISTIC geometric table reconstruction. NO LLM.
//
// GENERALIZATION: every function here keys on GEOMETRY (x/y clustering) + anchor TEXT (label phrases like
// "Hypothesized Function", "MASTERED:", "confirmed diagnoses") — NEVER a client name or a ground-truth list.
// It reads whatever structure an assessment contains, for every future upload. The 3 test PDFs only PROVE
// the reader recovers structure; they are never referenced in the code. Red-flag check: no "if client == X".
//
// The reader is heterogeneous BY NECESSITY (the offline exploration proved assessments are not uniform grids):
//   • behavior→function : a "Hypothesized Function: <value>" labeled field inside each behavior's detail block
//   • mastered skills    : names under a "MASTERED:" heading in the skills section
//   • confirmed diagnosis: the codes in the "confirmed diagnoses of ..." statement (differentials excluded)
//
// STRIP-BEFORE-LLM (point 4b) is baked in: redactFragments() strips identifiers from positioned fragments so
// that when step 3 (transcription) consumes this output, the LLM never sees a raw name. Step 2 uses no LLM.

import PDFParser from 'pdf2json'

export interface Fragment { text: string; x: number; y: number; page: number }

const ROW_TOL = 0.4 // fragments within this y-distance share a row (measured: behavior rows ~0.75 apart)

// Typographic ligatures (ﬁ, ﬃ, …) are extracted as single glyphs and break word matching
// ("confirmed" → "con<ﬁ>rmed"). Normalize them so anchor phrases match. Deterministic, lossless.
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'ft', 'ﬆ': 'st' }
export function normalizeLigatures(s: string): string {
  return s.replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g, (m) => LIGATURES[m] || m)
}

export function parsePositioned(buffer: Buffer): Promise<Fragment[]> {
  return new Promise((resolve, reject) => {
    const p = new PDFParser()
    p.on('pdfParser_dataError', (e: any) => reject(e?.parserError || e))
    p.on('pdfParser_dataReady', (d: any) => {
      const out: Fragment[] = []
      ;(d?.Pages || []).forEach((page: any, pi: number) => {
        ;(page?.Texts || []).forEach((t: any) => {
          const text = normalizeLigatures(
            (t?.R || [])
              .map((r: any) => { try { return decodeURIComponent(r?.T || '') } catch { return r?.T || '' } })
              .join(''),
          )
            .replace(/\s+/g, ' ')
            .trim()
          if (text) out.push({ text, x: t.x, y: t.y, page: pi })
        })
      })
      resolve(out)
    })
    p.parseBuffer(buffer)
  })
}

// ── STRIP-BEFORE-LLM (point 4b) — TARGETED, not blind ──────────────────────────────────────────────────
// LESSON from the offline run: a blind "two-capitalized-words → name" regex destroys CLINICAL terms
// ("Hypothesized Function", "Property Destruction", "Autism Spectrum Disorder"). Redaction must strip the
// KNOWN identifiers for THIS client — the caller passes them from the DB record (clientName, caregivers) —
// plus pronouns and caregiver-relation words. This is general: the lib hardcodes NO name; the caller supplies
// the record's identifiers. Applied to positioned fragments BEFORE any transcription (step 3 sees only this).
const CAREGIVER = /\b(mom|dad|mother|father|grandmother|grandfather|grandma|grandpa|guardian|stepmother|stepfather)\b/gi
const PRONOUN = /\b(he|him|his|she|her|hers)\b/gi
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function redactText(text: string, names: string[] = []): string {
  let t = text
  // Strip each known identifier token (full names AND their individual name-words, e.g. "Alexandra").
  // Tokenize full names + their word-parts, but skip short particles (de, la, del…) and <3-char words so a
  // surname particle can't blanket-redact. Full multi-word names are tried first (longest-first below).
  const PARTICLES = new Set(['de', 'la', 'del', 'los', 'las', 'van', 'von', 'da', 'di'])
  const tokens = [...new Set(
    names.flatMap((n) => [n, ...n.split(/\s+/)])
      .map((s) => s.trim())
      .filter((s) => s.length >= 3 && !PARTICLES.has(s.toLowerCase())),
  )]
  for (const tok of tokens.sort((a, b) => b.length - a.length)) {
    t = t.replace(new RegExp(`\\b${escapeRe(tok)}\\b(?:'s)?`, 'gi'), (m) => (m.endsWith("'s") ? "the client's" : 'the client'))
  }
  return t.replace(CAREGIVER, 'caregiver').replace(PRONOUN, 'the client')
}
export function redactFragments(frags: Fragment[], names: string[] = []): Fragment[] {
  return frags.map((f) => ({ ...f, text: redactText(f.text, names) }))
}

// ── Row clustering (deterministic) ─────────────────────────────────────────────────────────────────────
export interface Row { page: number; y: number; cells: Fragment[] }
export function clusterRows(frags: Fragment[]): Row[] {
  const byPage: Record<number, Fragment[]> = {}
  for (const f of frags) (byPage[f.page] ||= []).push(f)
  const rows: Row[] = []
  for (const [pageStr, pf] of Object.entries(byPage)) {
    const page = Number(pageStr)
    const sorted = [...pf].sort((a, b) => a.y - b.y || a.x - b.x)
    const pageRows: Row[] = []
    for (const f of sorted) {
      const r = pageRows.find((r) => Math.abs(r.y - f.y) < ROW_TOL)
      if (r) { r.cells.push(f); r.y = (r.y * r.cells.length + f.y) / (r.cells.length + 1) }
      else pageRows.push({ page, y: f.y, cells: [f] })
    }
    for (const r of pageRows) r.cells.sort((a, b) => a.x - b.x)
    rows.push(...pageRows)
  }
  return rows
}

const cellsInX = (row: Row, lo: number, hi: number) => row.cells.filter((c) => c.x >= lo && c.x < hi)
const rowText = (row: Row) => row.cells.map((c) => c.text).join(' ')

// ── READER 1: behavior → function (the Hypothesized Function labeled field per behavior block) ───────────
// A behavior is ACTIVE iff it has a detail block containing a "Hypothesized Function:" field. The behavior
// name is the LEFT column (small x); the function value is the middle column on the anchor row. Completeness
// = count of such blocks (deterministic), which is exactly what closes the 10-vs-9 wobble + the phantom.
const FUNC_WORD = /^(escape|attention|tangible|tangibles|automatic|sensory)$/i
// Column-header phrases that live in the same left column as behavior names but are NOT behaviors.
const HEADER_PHRASE = /^(target|behavior|definition|hypothesi[sz]ed|data collection|baseline|intensity|level|frequency|operational|topography|function|measurable)\b/i

// A "value cell" is one whose text is DOMINATED by function-vocabulary tokens (e.g. "Attention/Escape",
// "Escape/Automatic", "Escape") — as opposed to a definition sentence that merely CONTAINS "escape". This
// is what generalizes across layouts: we don't care whether the value sits right-of or below the label,
// only that a function-dominated cell is in the anchor's immediate neighborhood.
function functionsFromCell(text: string): string[] {
  const toks = text.split(/[\/,]|\bor\b|\band\b|\s+/i).map((s) => s.trim()).filter(Boolean)
  if (!toks.length) return []
  const fns = toks.filter((t) => FUNC_WORD.test(t))
  // Dominated: at least half the tokens are function words (excludes prose like "escape-maintained isolation").
  if (fns.length && fns.length * 2 >= toks.length) {
    return [...new Set(fns.map((t) => t.toLowerCase().replace(/s$/, '')))].map((t) => (t === 'tangible' ? 'tangible' : t))
  }
  return []
}

export interface BehaviorFunctionRow { behavior: string; functions: string[]; page: number; y: number }
export function readBehaviorFunctions(rows: Row[]): BehaviorFunctionRow[] {
  const anchors = rows.filter((r) => /hypothesi[sz]ed function/i.test(rowText(r)))
  if (!anchors.length) return []
  const anchorPages = new Set(anchors.map((a) => a.page))
  // Name column = the leftmost x-band on the anchor pages. Build name blocks (consecutive leftmost fragments),
  // EXCLUDING header phrases (structural headers, not behaviors). General: no client name, no absolute x.
  const pageRows = rows.filter((r) => anchorPages.has(r.page))
  const minX = Math.min(...pageRows.flatMap((r) => r.cells.map((c) => c.x)))
  const leftFrags = pageRows
    .flatMap((r) => r.cells)
    .filter((c) => c.x < minX + 2 && !HEADER_PHRASE.test(c.text)) // leftmost column, headers excluded
    .sort((a, b) => a.page - b.page || a.y - b.y)
  const blocks: { name: string; page: number; yStart: number; yEnd: number }[] = []
  for (const f of leftFrags) {
    const last = blocks[blocks.length - 1]
    if (last && last.page === f.page && f.y - last.yEnd < 1.5) { last.name += ' ' + f.text; last.yEnd = f.y }
    else blocks.push({ name: f.text, page: f.page, yStart: f.y, yEnd: f.y })
  }

  const out: BehaviorFunctionRow[] = []
  for (const a of anchors) {
    const labelCell = [...a.cells].sort((c1, c2) => c1.x - c2.x).find((c) => /function/i.test(c.text))
    const lx = labelCell?.x ?? 0
    // Neighborhood: same row + the next ~2 rows, cells at or right of the label's column (excludes the far-left
    // definition/name columns). Value = function-dominated cell(s) in that neighborhood — direction-agnostic.
    const near = rows
      .filter((r) => r.page === a.page && r.y >= a.y - ROW_TOL && r.y <= a.y + 1.7)
      .flatMap((r) => r.cells)
      .filter((c) => c.x >= lx - 2)
    const functions = [...new Set(near.flatMap((c) => functionsFromCell(c.text)))]
    const block = blocks
      .filter((b) => b.page === a.page && b.yStart <= a.y + ROW_TOL)
      .sort((b1, b2) => b2.yStart - b1.yStart)[0]
    out.push({ behavior: (block?.name || '(unresolved)').replace(/\s+/g, ' ').trim(), functions, page: a.page, y: a.y })
  }
  return out
}

// ── READER 2: mastered skills (names under a "MASTERED:" heading in the skills section) ──────────────────
export function readMasteredSkills(rows: Row[]): { heading: string; page: number; y: number; items: string[] }[] {
  const headings = rows.filter((r) => /\bMASTERED\s*:/i.test(rowText(r)))
  const out: { heading: string; page: number; y: number; items: string[] }[] = []
  for (const h of headings) {
    const hx = h.cells.find((c) => /MASTERED/i.test(c.text))?.x ?? 0
    // Items: same-or-following rows on the page, in the same x-column band as the heading, until the next
    // section. Include text on the heading row after "MASTERED:" and rows just below within the column.
    const sameCol = rows
      .filter((r) => r.page === h.page && r.y >= h.y - ROW_TOL && r.y < h.y + 6)
      .flatMap((r) => r.cells)
      .filter((c) => Math.abs(c.x - hx) < 8 && !/MASTERED\s*:/i.test(c.text) && c.text.trim())
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((c) => c.text.trim())
    out.push({ heading: rowText(h).trim(), page: h.page, y: h.y, items: sameCol })
  }
  return out
}

// ── READER 3: confirmed diagnosis (the "confirmed diagnoses of ..." statement — differentials excluded) ──
// Felix proves the grid alone is NOT enough: a differential (F82) sits inside a diagnosis table. The clean
// deterministic signal is the confirmed-statement anchor; codes in that sentence are the confirmed set.
const ICD = /\b[A-Za-z]\d{2}(?:\.\d+)?\b/g
export function readConfirmedDiagnosis(rows: Row[]): { source: string; codes: string[] } | null {
  // Find the row(s) containing "confirmed diagnos..." and gather ICD codes on that row + the next few.
  const anchorIdx = rows.findIndex((r) => /confirmed diagnos/i.test(rowText(r)))
  if (anchorIdx >= 0) {
    const window = rows.slice(anchorIdx, anchorIdx + 3).map(rowText).join(' ')
    const codes = [...new Set((window.match(ICD) || []).map((c) => c.toUpperCase()).filter((c) => !/^Z/.test(c)))]
    return { source: 'confirmed-diagnoses statement', codes }
  }
  return null
}
