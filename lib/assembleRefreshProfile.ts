// lib/assembleRefreshProfile.ts — FAST/MAS wiring, Commit 1: overlay GEOMETRY-AUTHORITATIVE diagnosis +
// mastered-skills onto the LLM baseline profile; LLM value kept as FLAGGED fallback where geometry can't
// read the structure. Architecture (b): geometry authoritative where it reads cleanly, LLM flagged fallback.
//
// FIREWALL: geometry never guesses (reads the confirmed-diagnosis table / MASTERED section, or returns
// nothing); a fallback value is always FLAGGED (never presented as a clean structured read); the diagnosis
// normalizer stays behind BOTH paths (belt-and-suspenders). No client name / coordinate here — keys on
// structure only. (Behaviors are NOT touched in Commit 1 — that is the guarded refresh in Commit 2.)

import type { Row } from './pdfGeometry.ts'
import { readConfirmedDiagnosis, readMasteredSkills, readBehaviorFunctions, readTargetList } from './pdfGeometry.ts'
import { assessConfidence } from './fastMasConfidence.ts'
import { normalizeDiagnosis } from './diagnosis.ts'
import { subtractMasteredFromActive } from './skillReconcile.ts'
import { matchByName, matchByDefinition } from './behaviorReconcile.ts'
import { tokenSubsetMatch } from './skillReconcile.ts'
import { reconcileBehaviors, assessLlmBehaviorCredibility } from './llmBehaviorCredibility.ts'
import { readObjectivesFormat, objMatch } from './objectivesFormat.ts'

export interface ReviewFlag { field: string; reason: string; source: 'llm-fallback' | 'guard-preserved' | 'behavior-review' | 'target-undefined' | 'behavior-incomplete' | 'intervention-section-unread' | 'section-unlocated' | 'human-edit-dropped' | 'human-edit-superseded' }

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
    // LAYER 1 — a skill the MASTERED section declares mastered is NOT an active replacement target. Subtract
    // the mastered names (token-subset match) from replacementBehaviors so the two fields are DISJOINT. Keys
    // purely on the geometry MASTERED section — no skill name, no client rule, no threshold. Non-destructive:
    // mastered skills stay in skillAcquisition; only their duplicate leak into the active list is removed.
    profile.replacementBehaviors = subtractMasteredFromActive(
      profile.replacementBehaviors,
      profile.skillAcquisition.map((s: any) => s.name),
    )
  } else if ((profile.skillAcquisition || []).length) {
    flags.push({ field: 'skillAcquisition', reason: 'mastered skills read from LLM, not a structured MASTERED section — verify', source: 'llm-fallback' })
  }

  return { profile, reviewFlags: flags }
}

// ── Commit 2: GUARDED behavior refresh ──────────────────────────────────────────────────────────────────
// Applies the confidence guard to the ACTIVE behavior set. HIGH → refresh from geometry (authoritative set +
// functions; LLM supplies topography, matched by name; per-behavior flags for unresolved-name/unknown-
// function). LOW/UNREAD → PRESERVE the existing behavior classification (maladaptiveBehaviors +
// masteredBehaviors); the overwrite NEVER happens. On CREATE (no existing) LOW/UNREAD keeps the LLM
// behaviors, FLAGGED (nothing to preserve; flagged-LLM beats empty). Keys on intrinsic signals only.
export function assembleRefreshProfile(
  llmProfile: any,
  rows: Row[],
  existingProfile?: any,
): { profile: any; reviewFlags: ReviewFlag[]; confidence: ReturnType<typeof assessConfidence> } {
  const { profile, reviewFlags } = assembleCommit1(llmProfile, rows) // diagnosis + mastered (Commit 1)
  const conf = assessConfidence(rows)
  const llmBehaviors: any[] = llmProfile.maladaptiveBehaviors || []

  // Did we APPLY the assessment's behavior set (HIGH refresh or create)? If so, the target-undefined check
  // below runs; on LOW/UNREAD-preserve nothing was applied, so it is skipped.
  let appliedAssessmentSet = false
  if (conf.level === 'HIGH') {
    appliedAssessmentSet = true
    // REFRESH behaviors from geometry: authoritative active SET + FUNCTIONS. The behavior's NAME + operational
    // definition (topography) come from the LLM read of the SAME behavior, reconciled two ways (both require a
    // UNIQUE candidate, so the wrong topography can never attach):
    //   FIX 2  — by name: containment → token-subset (order-independent; survives a mangled/re-ordered geometry
    //            name like "SIB (Self-Injury"). On match we adopt the LLM's CLEAN name, not the geometry string.
    //   FIX 3a — if unnamed/unmatched: by the anchor's definition text vs each LLM topography's DISCRIMINATING
    //            tokens (resolves a block whose name wasn't located, e.g. Defiant Behavior).
    // No match either way → keep the geometry name (may be "(unresolved)") with EMPTY topography, so GUARD 1
    // hard-422s the upload (firewall: never apply an unresolvable behavior, never mix new+old).
    const bf = readBehaviorFunctions(rows)
    profile.maladaptiveBehaviors = bf.map((b) => {
      const match = matchByName(b.behavior, llmBehaviors) || matchByDefinition(b.defText, llmBehaviors)
      return {
        name: match?.name ? String(match.name) : b.behavior,      // adopt the LLM's clean name on a match
        status: 'active',
        functions: b.functions,                                   // geometry authoritative (no prose-guessed flicker)
        topographies: match?.topographies || match?.topography ? (match.topographies || [match.topography]) : [],
      }
    })
    // masteredBehaviors stays the LLM baseline (geometry's active set already excludes mastered — they have
    // no Hypothesized-Function block). The active set is geometry; mastery classification is unchanged here.
    for (const f of conf.perBehaviorFlags)
      reviewFlags.push({ field: `behavior:${f.name}`, reason: `${f.issue} — not structurally verified, please confirm`, source: 'behavior-review' })
  } else {
    // LOW / UNREAD — geometry could not read the behavior structure (prose-woven layout). Do NOT blindly
    // preserve: that strands STALE behaviors against a REFRESHED skills/interventions set — an inconsistent
    // hybrid, worse than a cleanly-stale profile. Instead, run DISCONTINUED-AUTHORITY reconciliation on the
    // LLM read (a formal "Status: Discontinued" outranks an incidental active mention) and a CONSERVATIVE
    // credibility check. Credible → use the NEW behaviors (llm-fallback, requires review). Not credible →
    // preserve previous (guard-preserved), as before. The guard still protects against a bad read.
    const existingBeh: any[] = existingProfile?.maladaptiveBehaviors || []
    // OBJECTIVES-TABLE FORMAT (Ximena) — try a DETERMINISTIC geometry read first: the reduce-target capsule +
    // per-target STO status (active unless all STOs mastered) + Description-block definitions. This removes the
    // SIB non-determinism (the LLM was reading SIB from its Objectives table, where STO rows say "Mastered",
    // instead of from its Description block). Functions aren't in her document (no FAST/MAS) — borrow them from
    // the LLM read by name where present, else leave empty (inferred). Only when it reads credibly.
    const objFmt = readObjectivesFormat(rows)
    if (objFmt.found) {
      // Deterministic structured read — NO llm-fallback flag (not an AI guess). functionsEvidence stays
      // 'inferred' downstream (no functional assessment in the document).
      appliedAssessmentSet = true
      profile.maladaptiveBehaviors = objFmt.behaviors.map((b) => {
        // Functions aren't in her document (no FAST/MAS) — borrow the LLM's INFERRED functions for the same
        // behavior, matched acronym-aware ("SIB" ↔ the LLM's "Self-Injurious Behavior"). Empty → inferred later.
        const m = (llmBehaviors as any[]).find((x) => objMatch(b.name, String(x?.name || '')))
        const fns = (m?.functions && Array.isArray(m.functions)) ? m.functions : (m?.function ? [m.function] : [])
        return { name: b.name, status: 'active', functions: fns, topographies: b.topography ? [b.topography] : [] }
      })
      profile.masteredBehaviors = objFmt.masteredNames // targets whose STOs are ALL mastered (target-level completion); Ximena: none
    } else {
      const { active: reconciled } = reconcileBehaviors(llmBehaviors)
      const cred = assessLlmBehaviorCredibility(reconciled, existingBeh.length)
      const shapeLlm = () => reconciled.map((b) => ({
        name: String(b.name).trim(),
        status: 'active',
        functions: Array.isArray(b.functions) ? b.functions : [],
        topographies: b.topographies || (b.topography ? [b.topography] : []),
      }))
      if (cred.credible) {
        // USE the new AI-extracted set — but it is NOT structurally verified, so require prominent review.
        appliedAssessmentSet = true
        profile.maladaptiveBehaviors = shapeLlm()
        profile.masteredBehaviors = llmProfile.masteredBehaviors || []
        reviewFlags.push({ field: 'behaviors', reason: `the assessment layout could not be verified automatically — the behavior list was EXTRACTED BY AI FALLBACK. Review the behavior list before using it for clinical documentation.`, source: 'llm-fallback' })
      } else if (existingBeh.length) {
        // Not credible AND we have a prior profile → preserve it (the original guard behavior).
        profile.maladaptiveBehaviors = existingProfile.maladaptiveBehaviors
        profile.masteredBehaviors = existingProfile.masteredBehaviors || []
        reviewFlags.push({ field: 'behaviors', reason: `read confidence ${conf.level} and the AI read was not credible (${cred.reasons.join('; ')}) — behaviors remain from the PREVIOUS assessment, not overwritten. Re-upload a structured assessment or enter behaviors manually.`, source: 'guard-preserved' })
      } else {
        // Create path (no prior profile) and not credible: a flagged AI read still beats an empty profile.
        appliedAssessmentSet = true
        profile.maladaptiveBehaviors = shapeLlm()
        profile.masteredBehaviors = llmProfile.masteredBehaviors || []
        reviewFlags.push({ field: 'behaviors', reason: `the assessment layout could not be verified automatically — the behavior list was extracted by AI fallback. Review before clinical use.`, source: 'llm-fallback' })
      }
    }
  }

  // TARGET-UNDEFINED — a behavior NAMED in the assessment's target list ("Behavior to Reduce" capsule) but
  // given NO detail block (no operational definition/baseline) and NOT mastered. We do NOT add it (an empty
  // behavior), but we SURFACE it for the BCBA. Structural: named-in-list minus (detailed ∪ mastered), matched
  // fuzzily so a variant ("Hygiene" vs "Non-Compliance with Hygiene Routines") is not falsely flagged. Only
  // when we actually applied the assessment's set (HIGH/create) — on LOW/UNREAD-preserve nothing was applied.
  if (appliedAssessmentSet) {
    const targetNames = readTargetList(rows)
    if (targetNames.length) {
      const known = [
        ...((profile.maladaptiveBehaviors || []) as any[]).map((b) => String(b?.name || '')),
        ...((profile.masteredBehaviors || []) as string[]),
        ...((profile.skillAcquisition || []) as any[]).map((s) => String(s?.name || '')),
      ].filter(Boolean)
      for (const t of targetNames) {
        if (!known.some((k) => nameMatch(k, t) || tokenSubsetMatch(k, t)))
          reviewFlags.push({ field: `target:${t}`, source: 'target-undefined', reason: `${t} is listed as a target behavior but has no operational definition or baseline data` })
      }
    }
  }
  return { profile, reviewFlags, confidence: conf }
}
