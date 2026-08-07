// lib/assembleRefreshProfile.ts — FAST/MAS wiring, Commit 1: overlay GEOMETRY-AUTHORITATIVE diagnosis +
// mastered-skills onto the LLM baseline profile; LLM value kept as FLAGGED fallback where geometry can't
// read the structure. Architecture (b): geometry authoritative where it reads cleanly, LLM flagged fallback.
//
// FIREWALL: geometry never guesses (reads the confirmed-diagnosis table / MASTERED section, or returns
// nothing); a fallback value is always FLAGGED (never presented as a clean structured read); the diagnosis
// normalizer stays behind BOTH paths (belt-and-suspenders). No client name / coordinate here — keys on
// structure only. (Behaviors are NOT touched in Commit 1 — that is the guarded refresh in Commit 2.)

import type { Row } from './pdfGeometry.ts'
import { readConfirmedDiagnosis, readMasteredSkills } from './pdfGeometry.ts'
import { normalizeDiagnosis } from './diagnosis.ts'

export interface ReviewFlag { field: string; reason: string; source: 'llm-fallback' | 'guard-preserved' | 'behavior-review' }

const CODE = (s: string) => (String(s).match(/[A-Za-z]\d{2}(?:\.\d+)?/) || [])[0]?.toUpperCase()
const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const nameMatch = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)) }

export function assembleCommit1(baseProfile: any, rows: Row[]): { profile: any; reviewFlags: ReviewFlag[] } {
  const profile = { ...baseProfile }
  const flags: ReviewFlag[] = []

  // ── DIAGNOSIS — geometry confirmed-diagnosis table is AUTHORITATIVE on membership (F82 excluded at
  // source because it is not in the confirmed statement); the LLM supplies the display strings for those
  // confirmed codes. If no confirmed table is located, keep the LLM diagnosis but FLAG it. Normalizer runs
  // on both paths (drops Z-codes, dedupes) as belt-and-suspenders.
  const dx = readConfirmedDiagnosis(rows)
  const llmDiag = normalizeDiagnosis(baseProfile.diagnosis)
  if (dx && dx.codes.length) {
    const confirmed = new Set(dx.codes.map((c) => c.toUpperCase()))
    const kept = llmDiag.filter((s) => { const c = CODE(s); return c && confirmed.has(c) })
    const keptCodes = new Set(kept.map((s) => CODE(s)))
    const codeOnly = [...confirmed].filter((c) => !keptCodes.has(c)) // confirmed code with no LLM display string
    profile.diagnosis = normalizeDiagnosis([...kept, ...codeOnly])
  } else {
    profile.diagnosis = llmDiag
    if (llmDiag.length) flags.push({ field: 'diagnosis', reason: 'diagnosis read from LLM text, not a structured confirmed-diagnosis table — verify', source: 'llm-fallback' })
  }

  // ── MASTERED SKILLS — the geometry "MASTERED:" section is AUTHORITATIVE for skillAcquisition. Exclude any
  // located item that matches a behavior name (a mastered BEHAVIOR belongs in masteredBehaviors, not
  // skillAcquisition — e.g. Brandon's "Tantrum"). If no MASTERED section is located, keep the LLM mastered
  // skills but FLAG them.
  const behaviorNames = [
    ...((baseProfile.maladaptiveBehaviors || []) as any[]).map((b) => String(b?.name || '')),
    ...((baseProfile.masteredBehaviors || []) as string[]),
  ].filter(Boolean)
  const geoMastered = readMasteredSkills(rows)
    .flatMap((h) => h.items)
    .filter((it) => it && !behaviorNames.some((bn) => nameMatch(it, bn)))
  if (geoMastered.length) {
    const seen = new Set<string>()
    profile.skillAcquisition = geoMastered
      .filter((n) => { const k = norm(n); if (!k || seen.has(k)) return false; seen.add(k); return true })
      .map((name) => ({ name: name.trim(), status: 'mastered', targetFunction: '' }))
  } else if ((profile.skillAcquisition || []).length) {
    flags.push({ field: 'skillAcquisition', reason: 'mastered skills read from LLM, not a structured MASTERED section — verify', source: 'llm-fallback' })
  }

  return { profile, reviewFlags: flags }
}
