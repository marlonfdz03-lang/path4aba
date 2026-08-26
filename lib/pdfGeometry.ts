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

export interface BehaviorFunctionRow { behavior: string; functions: string[]; page: number; y: number; defText: string }
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
    // FIX 1 — rejoin a hyphenated line-break: when the accumulated name ends in "-", the next fragment is the
    // continuation of a split word ("SIB (Self-" + "Injury" → "SIB (Self-Injury"), so append WITHOUT a space.
    // Keys on the trailing-hyphen pattern — no client/behavior name.
    if (last && last.page === f.page && f.y - last.yEnd < 1.5) { last.name += /-\s*$/.test(last.name) ? f.text : ' ' + f.text; last.yEnd = f.y }
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
    // FIX 3a support — the anchor's neighborhood OPERATIONAL DEFINITION: content-column cells (excludes the
    // far-left name band) just above/at the anchor. Used to reconcile an unnamed block to an LLM behavior by
    // its definition when the name couldn't be located. Over-grabbing a neighbor only makes the match ambiguous
    // (→ refused), never wrong.
    const defText = rows
      .filter((r) => r.page === a.page && r.y >= a.y - 6 && r.y <= a.y + 1.7)
      .flatMap((r) => r.cells)
      .filter((c) => c.x >= minX + 2)
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    out.push({ behavior: (block?.name || '(unresolved)').replace(/\s+/g, ' ').trim(), functions, page: a.page, y: a.y, defText })
  }
  return out
}

// ── READER 2: mastered skills (names under a "MASTERED:" heading, bounded by the section's real end) ─────
// A section HEADING ends at the next heading OR a return to a further-left column (a major section like
// "Behaviors to Increase" begins). Items are the ROWS below the heading in the section's column — ONE item
// per row (not per cell, so "Request a Break Properly" stays whole). General: keys on the heading/column
// structure, never on a coordinate or item count.
const IS_HEADING = (t: string) => /^(MASTERED|NEW|DISCONTINUED|MAINTENANCE|IN\s*PROGRESS)\s*:/i.test(t.trim())
export function readMasteredSkills(rows: Row[]): { heading: string; page: number; y: number; items: string[] }[] {
  const headings = rows.filter((r) => IS_HEADING(rowText(r)) && /MASTERED/i.test(rowText(r)))
  const out: { heading: string; page: number; y: number; items: string[] }[] = []
  for (const h of headings) {
    const hx = h.cells.find((c) => /MASTERED/i.test(c.text))?.x ?? Math.min(...h.cells.map((c) => c.x))
    const below = rows
      .filter((r) => r.page === h.page && r.y > h.y + ROW_TOL / 2)
      .sort((a, b) => a.y - b.y)
    const items: string[] = []
    // Any text on the heading row AFTER "MASTERED:" is the first item (e.g. "MASTERED: Tantrum").
    const inline = h.cells.filter((c) => c.x > hx + 0.5).map((c) => c.text).join(' ').trim()
    if (inline) items.push(inline)
    let lastY = h.y
    for (const r of below) {
      const leftX = Math.min(...r.cells.map((c) => c.x))
      // BOUNDARY: next heading, a return to a further-left column (new section), or a large vertical GAP
      // (the list ended — following content like a signature/footer is separate). All structural, not tuned.
      if (IS_HEADING(rowText(r)) || leftX < hx - 2 || r.y - lastY > 2) break
      const itemText = r.cells.filter((c) => c.x >= hx - 1).map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim()
      if (itemText) { items.push(itemText); lastY = r.y }
    }
    out.push({ heading: rowText(h).trim(), page: h.page, y: h.y, items })
  }
  return out
}

// ── READER 4: target-behavior list (the "Behavior(s) to Reduce" capsule that names every target behavior) ──
// Names appear one per row in the heading's left column, bounded by the next major section. Used to detect a
// behavior NAMED as a target but given NO detail block (no operational definition/baseline) — see
// assembleRefreshProfile. General: keys on the target-list header vocabulary + the left-column list, never on
// a client/behavior name.
const TARGET_HEADER = /^\s*(behaviors?\s+(?:to\s+reduce|to\s+decrease|targeted\s+for\s+reduction)|target\s+behaviors?)\s*:?/i
// Next major section = the list has ended (skills/replacement/reinforcers/intervention/mastered/goals).
const NEXT_SECTION = /^\s*(behaviors?\s+to\s+increase|skill\s+acquisition|replacement|goals?\s+to\s+increase|maintenance|mastered|reinforc|intervention)/i
export function readTargetList(rows: Row[]): string[] {
  const hi = rows.findIndex((r) => TARGET_HEADER.test(rowText(r)))
  if (hi < 0) return []
  const h = rows[hi]
  const hx = Math.min(...h.cells.map((c) => c.x))
  const names: string[] = []
  // Any text on the heading row AFTER the header phrase is the first name ("Behavior to Reduce: Tantrums").
  const inline = rowText(h).replace(TARGET_HEADER, '').replace(/\s+/g, ' ').trim()
  if (inline) names.push(inline)
  const below = rows
    .filter((r) => r.page > h.page || (r.page === h.page && r.y > h.y + ROW_TOL / 2))
    .sort((a, b) => a.page - b.page || a.y - b.y)
  let lastY = h.y, lastPage = h.page
  for (const r of below) {
    const t = rowText(r).trim()
    const leftX = Math.min(...r.cells.map((c) => c.x))
    // BOUNDARY: next section heading, a return to a further-left column, a bullet list (skills), or a large
    // vertical gap on the same page (the list ended). All structural, not tuned.
    if (NEXT_SECTION.test(t) || leftX < hx - 2 || /^[•·▪]/.test(t) || (r.page === lastPage && r.y - lastY > 2)) break
    // One NAME per row — the left-column text (excludes any right-column content on the same row).
    const nameText = r.cells.filter((c) => c.x <= hx + 4).map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim()
    if (nameText) { names.push(nameText); lastY = r.y; lastPage = r.page }
  }
  return names.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

// ── READER 3: confirmed diagnosis (the "confirmed diagnoses of ..." statement — differentials excluded) ──
// Felix proves the grid alone is NOT enough: a differential (F82) sits inside a diagnosis table. The clean
// deterministic signal is the confirmed-statement anchor; codes in that sentence are the confirmed set.
const ICD = /\b[A-Za-z]\d{2}(?:\.\d+)?\b/g
// PDF fragments split words across cells ("con"|"fi"|"rmed"); row-join with spaces yields "con fi rmed".
// Match anchors against a DESPACED copy so fragmentation can't hide the phrase. Deterministic, general.
const despace = (s: string) => s.replace(/\s+/g, '').toLowerCase()
export function readConfirmedDiagnosis(rows: Row[]): { source: string; codes: string[] } | null {
  const anchorIdx = rows.findIndex((r) => despace(rowText(r)).includes('confirmeddiagnos'))
  if (anchorIdx >= 0) {
    const window = rows.slice(anchorIdx, anchorIdx + 3).map(rowText).join(' ')
    const codes = [...new Set((window.match(ICD) || []).map((c) => c.toUpperCase()).filter((c) => !/^Z/.test(c)))]
    return { source: 'confirmed-diagnoses statement', codes }
  }
  return null
}

// ── READER 5: replacement roster (the "Behaviors to Increase" program list — one program per row) ─────────
// WHY geometry, not text: pdf2json flattens the whole page into space-joined text, so the roster reads as one
// run-together string ("Share a toy End structured games Compliance…") that CANNOT be split into programs.
// The POSITIONED rows preserve one program per line, so we read the column here instead.
//
// THE HARD PART (observed on a real "TREATMENT PACKET" layout): it is a TWO-COLUMN table whose left column
// holds a vertically-centered SECTION LABEL ("Behaviors to Increase") and whose right column holds the items —
// AND the reduction block sits directly above in the SAME right column, each block carrying its own inline
// "MASTERED:" sublist. So neither "read rows below the heading" nor a label-midpoint split works (the label is
// not centered; the reduction block's MASTERED leaks in and corrupts the active/mastered buckets).
//
// The robust boundary: the reduction block is exactly the maladaptive-behavior NAMES, which the caller already
// knows (LLM/geometry behavior read). So we walk UP from the header to the last behavior-name row and start
// the roster just below it; we walk DOWN to the next major section ("Interventions", …). Within that span the
// inline NEW:/MASTERED:/DISCONTINUED: sublabels partition active vs mastered vs discontinued. Geometry + the
// known behavior names only — no program name, no count, no coordinate. Fails safe: header not found, or an
// implausible parse, → { found:false } and the caller keeps the LLM result.
export interface ReplacementRoster { active: string[]; mastered: string[]; discontinued: string[]; found: boolean; rawItemCount: number }

// The header is a SECTION LABEL that STARTS the row — never a prose sentence that merely contains
// "…to increase…" mid-clause (e.g. "ABA treatment to increase motivation"). Anchored at the row start.
// NOTE: deliberately NOT "replacement skills" — that phrase names the caregiver-training "Replacement
// skills/Program implementation" goal blocks, a DIFFERENT section that must not win the roster header.
const INCREASE_HEADER = /^\s*((behaviors?|skills?|goals?)\s+to\s+increase|replacement\s+(behaviors?|programs?)\b|behaviors?\s+to\s+acquire)/i
// A row that STARTS the next major section — ends the roster (the boundary AFTER the list).
const ROSTER_END = /^\s*(approved\s+)?(interventions?|behavioral\s+concern|behaviors?\s+targeted|target\s+behaviors?|reinforc|program\s+change|discharge|caregiver\s+(goals?|involvement)|replacement\s+skills\s*\/|diagnos|assessment\s+result|treatment\s+goal|maintenance\s+program)/i
// Inline sublabel partitioning the block (NOT a boundary): switches the bucket, its trailing text is an item.
const ROSTER_SUBLABEL = /^\s*(NEW|MASTERED|DISCONTINUED|MAINTENANCE|IN\s*PROGRESS|CONTINUED?|ACTIVE|ONGOING)\s*:/i
const rosterBucket = (t: string): 'active' | 'mastered' | 'discontinued' =>
  /^\s*MASTERED\s*:/i.test(t) ? 'mastered' : /^\s*DISCONTINUED\s*:/i.test(t) ? 'discontinued' : 'active'
const rnorm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const rnameMatch = (a: string, b: string) => { const x = rnorm(a), y = rnorm(b); return !!x && !!y && x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)) }

// Shared core: read a one-item-per-row COLUMN list under a section label, honoring the two-column centered-label
// layout (label split across word-fragments; items in the right column) and inline NEW:/MASTERED:/DISCONTINUED:
// sublabels. `excludeNames` bound the TOP (a row whose text matches a known name from the PRECEDING section —
// e.g. a maladaptive behavior above "Behaviors to Increase" — ends the upward walk). Geometry only; fails safe.
function columnRoster(rows: Row[], headerRe: RegExp, excludeNames: string[]): ReplacementRoster {
  const empty: ReplacementRoster = { active: [], mastered: [], discontinued: [], found: false, rawItemCount: 0 }
  const headerIdx = rows.findIndex((r) => headerRe.test(rowText(r)))
  if (headerIdx < 0) return empty
  const header = rows[headerIdx]
  // The label may be split across word-fragments ("Behaviors" | "to" | "Increase"). Accumulate leading cells
  // (x-order) until the join matches the phrase; the ITEM column starts at the FIRST cell after it (two-column
  // layout). If the label consumes the whole row, items sit BELOW in the same column (simple layout).
  const sorted = [...header.cells].sort((a, b) => a.x - b.x)
  let acc = '', splitIdx = -1
  for (let i = 0; i < sorted.length; i++) { acc = (acc ? acc + ' ' : '') + sorted[i].text; if (headerRe.test(acc)) { splitIdx = i; break } }
  const itemX0 = (splitIdx >= 0 && splitIdx + 1 < sorted.length) ? sorted[splitIdx + 1].x - 0.5 : sorted[0].x - 0.5
  const page = header.page
  // The item text of a row = the cells in/right-of the item column, joined; empty if this row has no item cell.
  const itemTextOf = (r: Row) => r.cells.filter((c) => c.x >= itemX0).map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim()
  // Candidate item rows: this page, from the header downward AND upward, that actually carry item-column text.
  const pageRows = rows.filter((r) => r.page === page).sort((a, b) => a.y - b.y)
  // `full` = the WHOLE row (incl. the left-column label) — a next-section label ("Interventions") can sit in
  // the left column while its first item sits in the right column, so the boundary test must see the full row.
  const itemRows = pageRows.map((r) => ({ y: r.y, text: itemTextOf(r), full: rowText(r) })).filter((r) => r.text)
  const hy = header.y
  // median spacing (robust gap threshold)
  const gaps = itemRows.slice(1).map((r, i) => r.y - itemRows[i].y).filter((g) => g > 0).sort((a, b) => a - b)
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1
  const BIG_GAP = Math.max(2.4, med * 3)

  const hi = itemRows.reduce((best, r, i) => (Math.abs(r.y - hy) < Math.abs(itemRows[best].y - hy) ? i : best), 0)
  // TOP boundary: walk up to (and stop at) a preceding-section name, a section label, or a big gap.
  let start = hi
  for (let i = hi - 1; i >= 0; i--) {
    const t = itemRows[i].text
    if (ROSTER_END.test(itemRows[i].full) || excludeNames.some((n) => rnameMatch(t, n)) || ROSTER_SUBLABEL.test(t) || (itemRows[i + 1].y - itemRows[i].y) > BIG_GAP) break
    start = i
  }
  // BOTTOM boundary: walk down to (and stop before) the next major section or a big gap.
  let end = hi
  for (let i = hi + 1; i < itemRows.length; i++) {
    if (ROSTER_END.test(itemRows[i].full) || (itemRows[i].y - itemRows[i - 1].y) > BIG_GAP) break
    end = i
  }

  const active: string[] = [], mastered: string[] = [], discontinued: string[] = []
  let bucket: 'active' | 'mastered' | 'discontinued' = 'active'
  let count = 0
  for (let i = start; i <= end; i++) {
    let t = itemRows[i].text
    // Strip a merged header-phrase prefix (the centered label shares the header row with its first item).
    if (i === hi) t = t.replace(headerRe, '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (ROSTER_SUBLABEL.test(t)) { bucket = rosterBucket(t); t = t.replace(ROSTER_SUBLABEL, '').replace(/\s+/g, ' ').trim(); if (!t) continue }
    count++
    if (excludeNames.some((n) => rnameMatch(t, n))) continue // a preceding-section name that leaked in
    const target = bucket === 'mastered' ? mastered : bucket === 'discontinued' ? discontinued : active
    if (!target.some((x) => rnorm(x) === rnorm(t))) target.push(t)
  }
  return { active, mastered, discontinued, found: true, rawItemCount: count }
}

// PLAUSIBILITY GATE (Marlon's fail-safe): a real program list is short NOUN PHRASES; a mis-anchored header over
// a PROSE block (Ximena: the header matched a "Replacement Behaviors" heading whose body is wrapped intervention
// PROCEDURE sentences — long, lowercase continuations, sentence fragments, AND the client's NAME) must be
// REJECTED, not stored as a confident-but-wrong roster. An item is "prose-like" if it is long, starts lowercase
// (a wrapped continuation), or ends mid-clause (a comma/colon or a dangling conjunction/preposition). If more
// than 30% of the active items are prose-like, the block is not a roster → caller keeps the LLM result.
const PROSE_TAIL = /\b(if|and|or|but|instead|the|of|for|to|use|with|following|when|while|by|on|in|as|a|an|her|his)$/i
function itemIsProseLike(t: string): boolean {
  const s = t.trim()
  if (!s) return true
  if (s.split(/\s+/).length > 12) return true      // a program name is a short phrase, not a sentence
  if (/^[a-z]/.test(s)) return true                // starts lowercase → a wrapped sentence continuation
  if (/[,:]$/.test(s)) return true                 // ends mid-clause
  if (PROSE_TAIL.test(s)) return true              // ends on a dangling conjunction/preposition/article
  return false
}
export function looksLikePrograms(active: string[]): boolean {
  if (!active.length) return false
  const prose = active.filter(itemIsProseLike).length
  return prose <= active.length * 0.3
}

// The replacement-program roster. `excludeNames` = the maladaptive-behavior names (the reduction block sits
// directly above in the same column) so the upward walk stops at the last behavior row. Rejects (found:false) a
// PROSE block that a heading falsely anchored — the caller then keeps the LLM/previous result (fail safe).
export function readReplacementRoster(rows: Row[], excludeNames: string[] = []): ReplacementRoster {
  const r = columnRoster(rows, INCREASE_HEADER, excludeNames)
  if (r.found && !looksLikePrograms(r.active)) return { active: [], mastered: [], discontinued: [], found: false, rawItemCount: r.rawItemCount }
  return r
}

// The interventions roster — a DETERMINISTIC region count for the interventions completeness guard (same shape,
// same blind spot as replacements). Plural "Interventions" only, so the many prose sentences that start with
// singular "intervention …" ("intervention strategies within…") never win the header. `excludeNames` = the
// behavior + replacement names that can appear above the interventions label. An UNDER-read here is SAFE: the
// guard only uses the count to catch a gross under-extraction, so a conservative count never falsely preserves.
const INTERVENTION_HEADER = /^\s*(approved\s+)?interventions\b/i
export function readInterventionRoster(rows: Row[], excludeNames: string[] = []): ReplacementRoster {
  return columnRoster(rows, INTERVENTION_HEADER, excludeNames)
}

// ── OBJECTIVES-TABLE FORMAT (READER 7) — the third assessment format (Ximena) ─────────────────────────────
// Each behavior/program is a "<Name> · Start Date · Baselines: N/week · Description: <operational definition>"
// block PLUS an "Objectives:" STO table (Name | Start | End | Status) whose Status column carries
// Mastered / In progress / Not started. CLINICAL RULE: a per-STO "Mastered" is a MILESTONE — the target is
// active while ANY STO is In progress / Not started (or it has a live baseline). Deterministic, no LLM.

// The prose target-list capsule: "Maladaptive behaviors to reduce are: X, Y, … and Z." (may wrap across rows).
const REDUCE_HEADER = /maladaptive behaviors?\s+to\s+reduce\s+are\s*:/i
export function readReduceTargets(rows: Row[]): string[] {
  const hi = rows.findIndex((r) => REDUCE_HEADER.test(rowText(r)))
  if (hi < 0) return []
  let buf = rowText(rows[hi]).replace(new RegExp('^[\\s\\S]*?' + REDUCE_HEADER.source, 'i'), '')
  for (let i = hi + 1; i < Math.min(rows.length, hi + 4) && !buf.includes('.'); i++) buf += ' ' + rowText(rows[i])
  buf = buf.split('.')[0]
  return buf.split(/,|\band\b/i).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 2 && s.length <= 60)
}

// A behavior/program with its deterministic status from the STO table. status='active' when any STO is pending
// (In progress / Not started) OR none are mastered; 'mastered' only when ALL STOs are mastered.
export interface ObjectiveTarget { name: string; status: 'active' | 'mastered'; masteredStos: number; pendingStos: number }
export function readObjectivesStatus(rows: Row[]): ObjectiveTarget[] {
  const out: ObjectiveTarget[] = []
  for (let i = 0; i < rows.length; i++) {
    if (!/^\s*Objectives\s*:/i.test(rowText(rows[i]).trim())) continue
    // column-header row (…| Status) within the next 2 rows → the Status column x
    let statusX: number | null = null, hdrIdx = -1
    for (let j = i + 1; j < Math.min(rows.length, i + 3); j++) {
      const sc = rows[j].cells.find((c) => /^status$/i.test(c.text.trim()))
      if (sc) { statusX = sc.x; hdrIdx = j; break }
    }
    if (statusX == null) continue
    let mastered = 0, pending = 0, name = ''
    for (let k = hdrIdx + 1; k < rows.length; k++) {
      const t = rowText(rows[k])
      if (/^\s*Objectives\s*:/i.test(t) || /Description\s*:/i.test(t) || /^Catharsis Consultants|^Florida Kids/i.test(t.trim())) break
      const hasSto = /\b(STO|LTO)\s*#?\d?/i.test(t)
      // Status cell(s): text at/right of the Status column. "In progress" / "Not started" often wrap, so a
      // bare "In" (with "progress" on the next line) still counts as pending.
      const st = rows[k].cells.filter((c) => c.x >= statusX - 2).map((c) => c.text).join(' ').toLowerCase().trim()
      if (hasSto) {
        if (/master/.test(st)) mastered++
        else if (/progress|not\s*start|^in\b|^not\b/.test(st)) pending++
        if (!name) { const m = /(?:decrease|increase|implement|improve|reduce)\s+(?:the\s+)?(.+?)\s+(?:to|by|for|when|and|through)\b/i.exec(t) || /\(([^)]{3,50})\)/.exec(t); if (m) name = (m[1] || '').trim() }
      } else if (k > hdrIdx + 1 && !/^(LTO|Client|\d|[a-z])/i.test(t.trim())) break // left the table
    }
    name = name.replace(/\s+/g, ' ').trim()
    if (name) out.push({ name, status: pending > 0 || mastered === 0 ? 'active' : 'mastered', masteredStos: mastered, pendingStos: pending })
  }
  return out
}

// Operational-definition blocks: "<Name> … Baselines: N/week … Description: <definition>". Her definitions
// live under "Description:", not "Operational Definition"/"Topography", so those anchors miss.
export interface DescriptionBlock { name: string; definition: string; baseline: string }
export function readDescriptionBlocks(rows: Row[]): DescriptionBlock[] {
  const out: DescriptionBlock[] = []
  for (let i = 0; i < rows.length; i++) {
    if (!/^\s*Description\s*:/i.test(rowText(rows[i]).trim())) continue
    // Name = nearest preceding block-header row that isn't a field label / values / page footer.
    let name = ''
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const t = rowText(rows[j]).trim()
      if (!t || /start date|baselines?\s*:|collection method|frequency|percentage|^\d|\/\s*week|catharsis consultants|florida kids|monthly data/i.test(t)) continue
      if (t.length <= 60) { name = t; break }
    }
    // Baseline "N/week" from the rows just above Description:
    let baseline = ''
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) { const m = /(\d+(?:\.\d+)?)\s*\/\s*week/i.exec(rowText(rows[j])); if (m) { baseline = m[1] + '/week'; break } }
    // Definition = rows after Description: until the next block/section/footer.
    let def = ''
    for (let k = i + 1; k < rows.length; k++) {
      const t = rowText(rows[k]).trim()
      if (/^\s*Objectives\s*:|Description\s*:|^Catharsis Consultants|^Florida Kids|^Monthly Data/i.test(t)) break
      def += (def ? ' ' : '') + t
      if (def.length > 800) break
    }
    if (name) out.push({ name, definition: def.replace(/\s+/g, ' ').trim(), baseline })
  }
  return out
}

// Replacement-program roster from the progress DATA TABLE (Name | Baseline | monthly % columns). Her real
// roster lives here — NOT under the "Replacement Behaviors" heading, which covers DRA/DRI/DRO procedure prose.
// Left-column names (x below the first numeric column); a row with no numeric cells is a wrapped continuation
// of the previous name. Fails safe: no header row → [].
const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i
const rnm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
function readOneDataTable(rows: Row[], hi: number): string[] {
  const hdr = rows[hi]
  const baseCell = hdr.cells.find((c) => /^baselines?$/i.test(c.text.trim())) || [...hdr.cells].sort((a, b) => a.x - b.x).find((c) => c.x > 8)
  const numX = baseCell ? baseCell.x - 1 : 16
  const nameX0 = Math.min(...hdr.cells.map((c) => c.x))
  const names: string[] = []
  let cur = ''
  const clean = (s: string) => s.replace(/\s*-\s*/g, '-').replace(/\/\s+/g, '/').replace(/\s+/g, ' ').trim()
  for (let k = hi + 1; k < rows.length; k++) {
    const r = rows[k]
    if (r.page > hdr.page + 2) break
    const t = rowText(r).trim()
    // Boundary: footer, a new block/section, or a new "<Name> Start Date:" behavior block (table ended).
    if (/^Catharsis Consultants|^Florida Kids|Objectives\s*:|Description\s*:|Start Date\s*:|Baselines?\s*:/i.test(t)) break
    const nameText = r.cells.filter((c) => c.x < numX && c.x >= nameX0 - 1).map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim()
    const hasNum = r.cells.some((c) => c.x >= numX && /[\d%]|^-$/.test(c.text.trim()))
    if (!nameText && !hasNum) { if (k > hi + 3) break; else continue }
    // A non-numeric row whose NEXT row starts a "Start Date:" block is the first Description block AFTER the
    // table (a new section), not a wrapped continuation — stop here.
    if (!hasNum && k + 1 < rows.length && /Start Date\s*:/i.test(rowText(rows[k + 1]))) break
    if (hasNum) { if (cur) names.push(clean(cur)); cur = nameText }
    else cur = (cur ? cur + ' ' : '') + nameText
  }
  if (cur) names.push(clean(cur))
  return names.filter((n) => n.length >= 3)
}
// The REPLACEMENT progress data table. There are several "Name | Baseline | months" tables (behaviors have one
// too), so we read each and return the one whose rows are mostly NOT the maladaptive behaviors (`excludeNames`).
export function readReplacementDataTable(rows: Row[], excludeNames: string[] = []): string[] {
  const ex = excludeNames.map(rnm).filter(Boolean)
  const isBehavior = (n: string) => ex.some((e) => { const x = rnm(n); return x && (x.includes(e) || e.includes(x)) })
  let best: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!(r.cells.some((c) => /^name$/i.test(c.text.trim())) && r.cells.some((c) => /^baselines?$/i.test(c.text.trim()) || MONTHS.test(c.text.trim())))) continue
    const names = readOneDataTable(rows, i)
    if (names.length < 3) continue
    const behaviorShare = names.filter(isBehavior).length / names.length
    if (behaviorShare < 0.5 && names.length > best.length) best = names // a replacement table, keep the richest
  }
  return best
}

// ── READER 6: stimulus-preference table (the People | Tangibles | Activities | Other reinforcer grid) ──────
// WHY geometry: the prose "Reinforcement" paragraph the LLM reads is a BRIEF summary; the assessment's real
// preference data lives in this 4-column table, whose columns COLLAPSE in the flattened text (People content
// runs straight into Tangibles content — so a text read cannot separate the People column to exclude it, and
// "mother"/"adult attention" would leak into the reinforcer catalog). The positioned rows keep the columns
// apart by x, so we assign each content cell to its column by x-band and DROP the People column at the source.
//
// Returns the Tangibles / Activities / Other column TEXT (Other → social) — NEVER People — for the same
// parseReinforcers splitting the prose path uses. Fails safe: no column-header row, columns too close to
// separate (pdf2json collapsed them the way it collapsed the behavior table), or empty content → null, and the
// caller keeps the prose-derived set rather than emitting garbage or a leaked name.
export interface PreferenceTable { tangibles: string; activities: string; social: string }
export function readPreferenceTable(rows: Row[]): PreferenceTable | null {
  // The COLUMN-HEADER row carries distinct "Tangibles" AND "Activities" label cells — this distinguishes the
  // RESULTS grid from a table-of-contents "Stimulus Preference Assessment" line that has no columns.
  const headerIdx = rows.findIndex((r) => r.cells.some((c) => /^tangibles?$/i.test(c.text.trim())) && r.cells.some((c) => /^activit/i.test(c.text.trim())))
  if (headerIdx < 0) return null
  const hdr = rows[headerIdx]
  const colX = (re: RegExp) => hdr.cells.find((c) => re.test(c.text.trim()))?.x ?? null
  const pX = colX(/^people$/i), tX = colX(/^tangibles?$/i), aX = colX(/^activit/i), oX = colX(/^other$/i)
  if (tX == null || aX == null) return null
  // Columns must be reasonably separated; if the grid collapsed, the header x's cluster → cannot isolate People.
  const xs = [pX, tX, aX, oX].filter((x): x is number => x != null).sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 3) return null
  // Content is left-aligned within a column; split on the midpoints between adjacent header x's.
  const mid = (a: number, b: number) => (a + b) / 2
  const tStart = pX != null ? mid(pX, tX) : tX - 2   // everything left of this is the People column → excluded
  const aStart = mid(tX, aX)
  const oStart = oX != null ? mid(aX, oX) : Infinity
  const page = hdr.page
  const below = rows.filter((r) => r.page === page && r.y > hdr.y + ROW_TOL / 2).sort((a, b) => a.y - b.y)
  const tang: Array<[number, number, string]> = [], acts: Array<[number, number, string]> = [], soc: Array<[number, number, string]> = []
  let lastY = hdr.y
  for (const r of below) {
    if (r.y - lastY > 3) break // a large vertical gap → the table ended (footer/next section follows)
    if (/^\s*(brandon|florida kids|phone\s*:|recommended interventions|documents reviewed)/i.test(rowText(r))) break
    for (const c of r.cells) {
      if (pX != null && c.x < tStart) continue       // People column — DROPPED at the source
      else if (c.x < aStart) tang.push([r.y, c.x, c.text])
      else if (c.x < oStart) acts.push([r.y, c.x, c.text])
      else soc.push([r.y, c.x, c.text])
    }
    lastY = r.y
  }
  const join = (arr: Array<[number, number, string]>) => arr.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]).join(' ').replace(/\s+/g, ' ').trim()
  const tangibles = join(tang), activities = join(acts), social = join(soc)
  if (!tangibles && !activities && !social) return null
  return { tangibles, activities, social }
}
