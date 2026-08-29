// Dedicated single-call interventions read. When an assessment carries an enumerated interventions section
// SMALL ENOUGH to read reproducibly, a bounded extraction call reads the DOCUMENT'S OWN list — measured
// 92–97% stable, ~0 menu-contamination — instead of the whole-packet extractor reciting the 48-name example
// menu (measured 32% stable, 35% contaminated on Hendrex). See the measurement arc.
//
// SCOPED BY MEASUREMENT (do not widen without re-measuring):
//  - SINGLE CALL only. Chunking degraded Brandon (61→46) and gave Felix two stable-but-divergent answers
//    (28 vs 78) with no way to adjudicate — so it is NOT used.
//  - GATED on the distinctive-heading SPAN fitting the stable window (≤ MAX_INTERVENTION_SPAN). A larger
//    span (Felix, ~37K) is NOT read here; the caller falls back to the whole-packet + menu path and records
//    it distinctly (assessment.intervention_section_oversized + a reviewFlag).
//  - Heading anchoring uses the VALIDATED distinctive-phrase set only. /intervention procedures/ is
//    DELIBERATELY EXCLUDED — it wrong-hits Felix prose ("modify intervention procedures based on …").

import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

// Validated to hit Hendrex/Felix/Brandon/Ximena's real interventions section and NEVER a wrong section
// across the five documents. NOTE the intentional absence of /intervention procedures/.
export const INTERVENTION_HEADINGS: RegExp[] = [
  /hypothesis[\s-]*based\s+interventions/i,
  /procedures\s+and\s+interventions\s+to\s+reduce/i,
  /assigned\s+interventions/i,
]

// Proven-stable read size (92–97% at 20K; stability degrades past ~30K). The gate uses the same value: if
// the first→last distinctive heading span exceeds it, the section is too large to read in one stable call.
export const READ_WINDOW = 20000
export const MAX_INTERVENTION_SPAN = 20000

export interface SectionLocation {
  matched: boolean
  heading: string | null
  start: number
  span: number // last heading offset − first heading offset
  oversized: boolean
}

// PURE: locate the enumerated interventions section by the distinctive headings and decide whether it fits
// the stable single-call window. No LLM, no IO — unit-tested.
export function locateInterventionSection(text: string): SectionLocation {
  const t = String(text || '')
  let first = -1
  let last = -1
  let heading: string | null = null
  for (const re of INTERVENTION_HEADINGS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of t.matchAll(g)) {
      const i = m.index ?? 0
      if (first < 0 || i < first) { first = i; heading = m[0] }
      if (i > last) last = i
    }
  }
  if (first < 0) return { matched: false, heading: null, start: -1, span: 0, oversized: false }
  const span = last - first
  return { matched: true, heading, start: first, span, oversized: span > MAX_INTERVENTION_SPAN }
}

// The dedicated extraction call — ONLY the section text, no example menu, extract names verbatim.
const SECTION_SYS = `You are extracting a list from clinical text. From the text below, extract EVERY intervention / procedure NAME that is described or listed. Return ONLY JSON: {"interventions": string[]}.
RULES: Extract each name EXACTLY as written. Include ONLY names present in this text. Do NOT add any procedure from general knowledge, no examples, no inference. Remove exact duplicates only.`

export async function extractInterventionsFromSection(sectionText: string): Promise<string[]> {
  const r = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    seed: 42,
    max_tokens: 3000,
    messages: [{ role: 'system', content: SECTION_SYS }, { role: 'user', content: sectionText }],
  })
  let parsed: any = {}
  try {
    parsed = JSON.parse((r.choices[0]?.message?.content || '').replace(/^```json?/i, '').replace(/```$/, '').trim())
  } catch {
    parsed = {}
  }
  return (Array.isArray(parsed.interventions) ? parsed.interventions : []).map((x: any) => String(x).trim()).filter(Boolean)
}

export interface SectionOutcome {
  outcome: 'read' | 'oversized' | 'none'
  heading: string | null
  windowChars: number
  span: number
  names: string[]
  // The exact section window that was read (only on 'read'; '' otherwise). The caller passes THIS — not the
  // whole document — to mergeInterventions so the source-presence filter is scoped to the section (see there).
  sectionText: string
}

// Orchestrate: locate → if it fits, read the bounded window and extract; if the span is too large, report
// oversized (caller falls back); no match or LLM error → 'none'. FAIL-SOFT: never throws to the caller.
export async function resolveInterventionSection(text: string): Promise<SectionOutcome> {
  const loc = locateInterventionSection(text)
  if (!loc.matched) return { outcome: 'none', heading: null, windowChars: 0, span: 0, names: [], sectionText: '' }
  if (loc.oversized) return { outcome: 'oversized', heading: loc.heading, windowChars: 0, span: loc.span, names: [], sectionText: '' }
  try {
    const section = String(text).slice(loc.start, loc.start + READ_WINDOW)
    const names = await extractInterventionsFromSection(section)
    return { outcome: 'read', heading: loc.heading, windowChars: section.length, span: loc.span, names, sectionText: section }
  } catch {
    return { outcome: 'none', heading: null, windowChars: 0, span: 0, names: [], sectionText: '' }
  }
}

// ── MERGE: union the dedicated names with the main extraction, then keep only names present in the SECTION
//    TEXT (not the whole document). Scoping to the section is deliberate:
//      • It drops the main pass's menu inventions — measured: on Hendrex the whole-document filter let 7 menu
//        names + 2 duplicate spellings back in (Task Analysis, NET, BST, Reinforcement Systems, Choice Making,
//        Prompt Hierarchy, Prompting; "…Alternative…" vs the section's "…Alternate…", "Response Blocking" vs
//        "Response Block") because their words appear SOMEWHERE in the 100K document. Scoping to the section
//        removes all 9 while keeping the real in-section names the dedicated pass omitted on a given run.
//      • RECALL TRADE (intended): a real intervention named ONLY OUTSIDE the enumerated section is also
//        dropped. The enumerated section is treated as the AUTHORITATIVE approved list, so a name that never
//        appears in it is not carried. This is an accepted precision-over-recall choice, not an oversight.
//    Near-duplicate spellings are handled by exact-phrase presence, NOT by fuzzy collapse — so DRA/DRI/DRO are
//    never merged into one another; each survives or drops on its own presence in the section.
//    Dedicated names come first (authoritative, document-spelled). ──
const clean = (s: string) =>
  String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// PURE: is this intervention name present in the given text? Word-boundary on the descriptive core, or the
// parenthetical acronym as a standalone token (so "Noncontingent Reinforcement (NCR)" matches a text "NCR").
export function nameInDocument(name: string, text: string): boolean {
  const hay = ' ' + clean(text) + ' '
  const core = clean(name)
  if (core.length >= 4 && hay.includes(' ' + core + ' ')) return true
  const acr = (String(name).match(/\(([A-Za-z]{2,6})\)/) || [])[1]
  if (acr && new RegExp('(^| )' + acr.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(hay)) return true
  return false
}

export function mergeInterventions(mainNames: string[], dedicatedNames: string[], sectionText: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of [...(dedicatedNames || []), ...(mainNames || [])]) {
    const k = clean(n)
    if (!k || seen.has(k)) continue
    if (nameInDocument(n, sectionText)) { seen.add(k); out.push(String(n).trim()) }
  }
  return out
}
