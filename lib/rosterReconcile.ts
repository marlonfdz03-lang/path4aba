// lib/rosterReconcile.ts — deterministic replacement/intervention reconciliation, shared by the two ingest
// routes (extract-assessment + admin/reprocess-assessment) so they can never drift.
//
// WHY: the LLM under-segments a run-together, weakly-delimited program list ("Behaviors to Increase": Brandon's
// 11 active programs came out as 4). The POSITIONED rows preserve one program per line, so we READ the roster
// deterministically (lib/pdfGeometry readReplacementRoster) and prefer it when it is at least as complete as the
// LLM — the plan's programs then come from a READ of the new document, not from preservation of the old catalog.
//
// The completeness guards then use a deterministic REGION COUNT (how many programs the source actually lists) to
// tell a READ FAILURE (source lists many, we extracted few → flag under-read, do NOT silently preserve) from a
// REAL plan shrinkage (source genuinely lists few → refresh). See lib/llmBehaviorCredibility assessCompleteness.
//
// Fails safe throughout: roster not found / less complete than the LLM → keep the LLM result; no region signal
// → the guard falls back to the previous-count heuristic (legacy behavior). Pure aside from the geometry read.

import type { Row } from './pdfGeometry.ts'
import { readReplacementRoster, readInterventionRoster, readPreferenceTable, readReplacementDataTable, readReduceTargets, looksLikePrograms } from './pdfGeometry.ts'
import { assessReplacementCompleteness, assessInterventionCompleteness, reconcileMastery } from './llmBehaviorCredibility.ts'
import { parseReinforcers } from './reinforcers.ts'
import { looksEdible } from './edibleReinforcer.ts'
import { looksLikePersonReinforcer } from './clinicalLibrary.ts'

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const nmeq = (a: unknown, b: unknown) => { const x = norm(a), y = norm(b); return !!x && !!y && x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)) }

export type ReplacementSource = 'roster-read' | 'llm' | 'preserved' | 'under-read'
export type InterventionSource = 'llm' | 'preserved' | 'under-read'
export interface RosterProvenance {
  masteryDemoted: string[] // names moved out of mastered because they are active/target (the mastery-authority rule)
  replacement: { source: ReplacementSource; newCount: number; region: number; rosterActive: number; rosterMastered: number; refresh: boolean; readFailure: boolean }
  interventions: { source: InterventionSource; newCount: number; region: number; refresh: boolean; readFailure: boolean }
  reinforcers: { source: 'prose+table' | 'prose'; tableFound: boolean; before: number; proseCount: number; tableItems: number; after: number; underReadFlag: boolean }
}

interface FlagLike { field: string; source: string; reason: string }

// Mutates `assessmentProfile` (replacementBehaviors / skillAcquisition / interventions) and pushes review flags.
// Returns provenance for the route's verification response — which domain came from a READ vs PRESERVATION.
export function reconcileRosters(
  assessmentProfile: any,
  existingProfile: any,
  rows: Row[],
  reviewFlags: FlagLike[],
  replacementDomainFound: boolean,
  interventionDomainFound: boolean,
): RosterProvenance {
  const behaviorNames = [
    ...((assessmentProfile.maladaptiveBehaviors || []) as any[]).map((b) => String(b?.name || '')),
    ...((assessmentProfile.masteredBehaviors || []) as string[]),
  ].filter(Boolean)

  // ── REPLACEMENTS ──
  const llmRepl = (assessmentProfile.replacementBehaviors || []) as any[]
  let roster = readReplacementRoster(rows, behaviorNames)
  // OBJECTIVES-TABLE FORMAT (Ximena): the real roster is the progress DATA TABLE (Name | monthly % columns),
  // NOT the "Replacement Behaviors" heading (which covers DRA/DRI/DRO procedure prose — correctly rejected by
  // the plausibility gate). If the prose-heading roster wasn't usable, read the data table (must ALSO pass the
  // plausibility gate). Fail safe: neither usable → keep the LLM result.
  if (!roster.found || roster.active.length < llmRepl.length) {
    const dt = readReplacementDataTable(rows, behaviorNames)
    if (dt.length >= 3 && looksLikePrograms(dt) && dt.length > roster.active.length) {
      roster = { active: dt, mastered: [], discontinued: [], found: true, rawItemCount: dt.length }
    }
  }
  let source: ReplacementSource = 'llm'
  if (roster.found && roster.active.length > 0 && roster.active.length >= llmRepl.length) {
    source = 'roster-read'
    // Programs read deterministically from the roster; carry the LLM's targetFunction where the name matches.
    assessmentProfile.replacementBehaviors = roster.active.map((name) => {
      const m = llmRepl.find((r) => nmeq(r?.name, name))
      return { name, status: 'active', targetFunction: m?.targetFunction || '' }
    })
    // The roster is the AUTHORITY on the active/mastered split of the increase block. Two corrections to
    // skillAcquisition (the mastered-skills field):
    //   1. DROP any entry that the roster classifies as ACTIVE — the geometry "MASTERED:" reader can over-run a
    //      reduction-block "MASTERED: <behavior>" heading into the first active increase items (Brandon: "Share a
    //      toy", "End structured games", "Compliance" leaked in as mastered). They must not be in BOTH lists.
    //   2. UNION the roster's MASTERED programs (real progress history — same treatment as mastered behaviors),
    //      deduped against whatever the geometry MASTERED-section read already captured.
    const activeKeys = new Set(roster.active.map((n) => norm(n)))
    const skills = ((assessmentProfile.skillAcquisition || []) as any[]).filter((s) => !activeKeys.has(norm(s?.name)))
    for (const name of roster.mastered) if (!skills.some((s) => norm(s?.name) === norm(name))) skills.push({ name, status: 'mastered', targetFunction: '' })
    assessmentProfile.skillAcquisition = skills
  }

  const region = roster.found && roster.active.length > 0 ? roster.active.length : -1
  const newReplCount = (assessmentProfile.replacementBehaviors || []).length
  const prevRepl = (existingProfile.replacementBehaviors || []) as any[]
  const replCheck = assessReplacementCompleteness(newReplCount, prevRepl.length, replacementDomainFound, region)
  if (!replCheck.refresh) {
    if (replCheck.readFailure) {
      reviewFlags.push({ field: 'replacementBehaviors', source: 'llm-fallback', reason: replCheck.reason }) // flag, do NOT preserve
      source = 'under-read'
    } else if (prevRepl.length) {
      assessmentProfile.replacementBehaviors = existingProfile.replacementBehaviors
      reviewFlags.push({ field: 'replacementBehaviors', source: 'guard-preserved', reason: replCheck.reason })
      source = 'preserved'
    }
  }

  // ── INTERVENTIONS ── (region count only; the two-column split garbles item NAMES, but the LLM reads them
  // cleanly. We use the deterministic count purely as the guard's read-failure signal.)
  const intRoster = readInterventionRoster(rows, [...behaviorNames, ...roster.active, ...roster.mastered])
  const intRegion = intRoster.found && intRoster.rawItemCount > 0 ? intRoster.rawItemCount : -1
  const newIntCount = (assessmentProfile.interventions || []).length
  const prevInt = (existingProfile.interventions || []) as any[]
  const intCheck = assessInterventionCompleteness(newIntCount, prevInt.length, interventionDomainFound, intRegion)
  let intSource: InterventionSource = 'llm'
  if (!intCheck.refresh) {
    if (intCheck.readFailure) {
      reviewFlags.push({ field: 'interventions', source: 'llm-fallback', reason: intCheck.reason })
      intSource = 'under-read'
    } else if (prevInt.length) {
      assessmentProfile.interventions = existingProfile.interventions
      reviewFlags.push({ field: 'interventions', source: 'guard-preserved', reason: intCheck.reason })
      intSource = 'preserved'
    }
  }

  // ── REINFORCERS ── The prose "Reinforcement" summary the LLM read (assessmentProfile.reinforcers) is correct
  // but INCOMPLETE — the structured "STIMULUS PREFERENCE ASSESSMENT" grid holds more. Read that grid from
  // geometry (columns kept apart; the People column dropped at the source so no name leaks), parse its
  // Tangibles/Activities/Other columns the same way as the prose, and MERGE (deduped). Defense in depth: the
  // final set still passes the edible + person filters. Fails safe: no table → keep the prose set unchanged.
  const proseReinf = ((assessmentProfile.reinforcers || []) as string[]).map(String)
  const table = readPreferenceTable(rows)
  let tableItems: string[] = []
  const merged: string[] = [...proseReinf]
  const seenR = new Set(proseReinf.map((r) => norm(r)))
  if (table) {
    tableItems = parseReinforcers(table).filter((r) => !looksEdible(r))
    for (const it of tableItems) { const k = norm(it); if (k && !seenR.has(k)) { seenR.add(k); merged.push(it) } }
  }
  // Belt-and-suspenders on the WHOLE set (prose + table): never an edible, never a person-like item.
  const finalReinf = merged.filter((r) => r && !looksEdible(r) && !looksLikePersonReinforcer(r))
  assessmentProfile.reinforcers = finalReinf

  // Reinforcer completeness — the last note-consumed domain without a check (Brandon went 16 → 8 unnoticed).
  // Reinforcers change legitimately, and they are not clinical-safety-critical, so this FLAGS for review (never
  // silently preserves): a large drop with NO structured preference table located is the suspicious case.
  const prevReinf = (existingProfile.reinforcers || []) as string[]
  let reinfUnderRead = false
  if (!table && prevReinf.length >= 8 && finalReinf.length < Math.ceil(prevReinf.length * 0.6)) {
    reviewFlags.push({ field: 'reinforcers', source: 'llm-fallback', reason: `reinforcers dropped from ${prevReinf.length} to ${finalReinf.length} and no structured preference table was located — verify the reinforcer list against the source` })
    reinfUnderRead = true
  }

  // MASTERY AUTHORITY (Part A — protects every client): any name in BOTH the active/target set and the mastered
  // set is ACTIVE → drop it from masteredBehaviors / skillAcquisition, and strip "(STO#…)" progress annotations.
  // The active/target set = active behaviors + active replacement programs + the reduce-target capsule.
  const activeTargetNames = [
    ...((assessmentProfile.maladaptiveBehaviors || []) as any[]).map((b) => String(b?.name || '')),
    ...((assessmentProfile.replacementBehaviors || []) as any[]).map((b) => String(b?.name || '')),
    ...readReduceTargets(rows),
  ].filter(Boolean)
  const masteredBefore = ((assessmentProfile.masteredBehaviors || []) as any[]).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean)
  const mb = reconcileMastery(activeTargetNames, masteredBefore)
  assessmentProfile.masteredBehaviors = mb.mastered
  const skillNames = ((assessmentProfile.skillAcquisition || []) as any[]).map((s) => s?.name).filter(Boolean)
  const sk = reconcileMastery(activeTargetNames, skillNames)
  const keepSkill = new Set(sk.mastered.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
  assessmentProfile.skillAcquisition = ((assessmentProfile.skillAcquisition || []) as any[]).filter((s) => keepSkill.has(String(s?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))

  return {
    masteryDemoted: [...mb.demoted, ...sk.demoted],
    replacement: { source, newCount: (assessmentProfile.replacementBehaviors || []).length, region, rosterActive: roster.active.length, rosterMastered: roster.mastered.length, refresh: replCheck.refresh, readFailure: replCheck.readFailure },
    interventions: { source: intSource, newCount: (assessmentProfile.interventions || []).length, region: intRegion, refresh: intCheck.refresh, readFailure: intCheck.readFailure },
    reinforcers: { source: table ? 'prose+table' : 'prose', tableFound: !!table, before: prevReinf.length, proseCount: proseReinf.length, tableItems: tableItems.length, after: finalReinf.length, underReadFlag: reinfUnderRead },
  }
}
