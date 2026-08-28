// Shared assessment extraction pipeline.
// Used by: app/api/extract-assessment/route.ts
//           app/api/rbt/clients/create/route.ts
// Do not add route-specific logic here.

import PDFParser from 'pdf2json'
import { normalizeLigatures } from '@/lib/pdfGeometry'
import { capSplitSignature, shouldUsePdfjs, SIGNATURE_THRESHOLD } from '@/lib/extractorSignature'
import { extractTextWithPdfjs } from '@/lib/pdfjsExtract'
import { emitAdminAlert } from '@/lib/adminAlerts'
import { ExtractedAssessment } from '@/lib/extractAssessment'
import { prisma } from '@/lib/prisma'
import { parseReinforcers } from '@/lib/reinforcers'
import { buildActivityLists } from '@/lib/curatedActivities'
import { normalizeDiagnosis } from '@/lib/diagnosis'
import { looksEdible } from '@/lib/edibleReinforcer'
import { canonicalKey, collectLibraryEntries, collectLibraryEntriesFromProfile, filterLibraryEntries, looksLikePersonReinforcer, unionCI, LibraryEntry, DiscardRecord } from '@/lib/clinicalLibrary'

// ── PDF parsing ───────────────────────────────────────────────────────────────

function safeDecode(text: string) {
  try { return decodeURIComponent(text) } catch { return text }
}

// The original pd2json extractor: flatten every text run with spaces. Returns RAW text (ligature
// normalization is applied by parsePdf on whichever extractor wins).
function parsePdf2json(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser()

    pdfParser.on('pdfParser_dataError', (errData: any) => {
      reject(errData?.parserError || errData)
    })

    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      try {
        const text = (pdfData?.Pages || [])
          .map((page: any) =>
            (page?.Texts || [])
              .map((textItem: any) =>
                (textItem?.R || [])
                  .map((r: any) => safeDecode(r?.T || ''))
                  .join(' ')
              )
              .join(' ')
          )
          .join('\n')
        resolve(text)
      } catch (error) {
        reject(error)
      }
    })

    pdfParser.parseBuffer(buffer)
  })
}

// PDF -> text. pd2json runs FIRST, exactly as today. We then measure the leading-capital-split signature
// (lib/extractorSignature): below threshold the pd2json text is returned UNCHANGED — byte-identical to the
// historical output for every clean document. At or above threshold the font fragments words in a way
// pd2json's flat join cannot recover, so we re-extract with pdfjs (layout-aware, correct advance widths).
//
// FAIL-SOFT: any pdfjs error falls back to the pd2json text rather than failing the upload. normalizeLigatures
// applies to whichever text wins (a no-op when there are no ligatures). An admin alert is emitted ONLY when
// the fallback path is entered (the clean path stays silent), recording extractor + signature + client so we
// can see how often it fires in production. `opts.clientId` is passed by the refresh routes; the create
// routes have no client id at parse time and leave it null.
export async function parsePdf(buffer: Buffer, opts: { clientId?: string | null } = {}): Promise<string> {
  const raw = await parsePdf2json(buffer)
  const signature = capSplitSignature(raw)

  if (!shouldUsePdfjs(signature)) {
    return normalizeLigatures(raw)
  }

  let text = raw
  let extractor: 'pdfjs' | 'pdf2json' = 'pdf2json'
  let failure: string | null = null
  try {
    text = await extractTextWithPdfjs(buffer)
    extractor = 'pdfjs'
  } catch (e: any) {
    text = raw // fail-soft: keep the (imperfect) pd2json text; never fail the upload over the fallback
    failure = e?.message || String(e)
    console.error('[parsePdf] pdfjs fallback failed — using pd2json text:', failure)
  }

  // Observability: emitAdminAlert is fail-soft by contract (never throws, never blocks). Fires only on the
  // fallback path, so "how often did the corrupted-document fallback trigger" is directly countable.
  await emitAdminAlert({
    source: 'system',
    type: 'assessment.extractor_fallback',
    severity: failure ? 'warning' : 'info',
    clientId: opts.clientId ?? null,
    payload: {
      extractor,
      signature: Math.round(signature * 100) / 100,
      threshold: SIGNATURE_THRESHOLD,
      chars: text.length,
      ...(failure ? { pdfjsError: failure } : {}),
    },
  })

  return normalizeLigatures(text)
}

// ── Content filtering ─────────────────────────────────────────────────────────

const BLOCKED_TERMS = [
  'speech therapy', 'speech/language therapy', 'speech-language therapy',
  'occupational therapy', 'physical therapy', 'counseling', 'tutoring',
  'homework', 'academic tutoring', 'feeding therapy', 'response blocking',
  'response block', 'restraint', 'punishment', 'response cost', 'overcorrection',
  'aversive', 'escape independent response delivery', 'attention independent response delivery',
]

export function hasBlockedTerm(text: string): boolean {
  const lower = text.toLowerCase()
  return BLOCKED_TERMS.some(term => lower.includes(term))
}

export function cleanText(text: string): string {
  return text
    .replace(/Summer program/gi, 'classroom activity')
    .replace(/Learning\/Academics/gi, 'classroom activity')
    .replace(/Speech\/language therapy/gi, 'classroom activity')
    .replace(/Response Block/gi, '')
    .replace(/Response Blocking/gi, '')
    .replace(/Escape Independent Response Delivery/gi, '')
    .replace(/Attention Independent Response Delivery/gi, '')
    .replace(/being rude to others when things do not go his way/gi, 'using a loud voice toward peers')
    .replace(/turns his head/gi, 'turning his head away')
    .replace(/throwing any item against any hard surface/gi, 'throwing nearby materials')
    .replace(/occurs when ignored by adults/gi, 'crying or vocalizing when attention is unavailable')
    .replace(/by occurs/gi, 'by engaging in')
    .replace(/by engages/gi, 'by engaging in')
    .replace(/by turns/gi, 'by turning')
    .replace(/following during/gi, 'during')
    .replace(/following waiting/gi, 'while waiting')
    .replace(/following after/gi, 'after')
    .replace(/after during/gi, 'during')
    .replace(/during participating/gi, 'while participating')
    .replace(/during following/gi, 'while following')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Normalized profile builder ────────────────────────────────────────────────

export function mapToLegacyFormat(extracted: ExtractedAssessment) {
  return {
    maladaptiveBehaviors: extracted.maladaptiveBehaviors
      .filter(b => !hasBlockedTerm(b.name))
      .map(b => ({
        name: cleanText(b.name),
        status: 'active',
        topographies: [cleanText(b.topography)].filter(t => t && !hasBlockedTerm(t)),
        functions: Array.isArray(b.function) ? b.function : b.function ? [b.function] : [],
      })),
    interventions: extracted.approvedInterventions
      .filter(i => !hasBlockedTerm(i))
      .map(i => ({ name: cleanText(i), status: 'active' })),
    skillAcquisition: extracted.replacementSkills
      .filter(s => s.status?.toLowerCase() === 'mastered' && !hasBlockedTerm(s.name))
      .map(s => ({ name: cleanText(s.name), status: 'active', targetFunction: s.targetFunction || '' })),
    replacementBehaviors: extracted.replacementSkills
      .filter(s => s.status?.toLowerCase() !== 'mastered' && !hasBlockedTerm(s.name))
      .map(s => ({ name: cleanText(s.name), status: 'active', targetFunction: s.targetFunction || '' })),
    reinforcers: parseReinforcers(extracted.reinforcers)
      .filter(r => !hasBlockedTerm(r))
      .filter(r => !looksEdible(r))   // edibles never enter the profile from an assessment (defense in depth)
      .map(cleanText),
    // Activities = curated baseline + the assessment's SPLIT activities (home→home, school→school). The
    // assessment's FLAT preferredActivities is intentionally NOT used here — an untagged list has no
    // home/school signal, so it is discarded rather than misplaced into both (see buildActivityLists).
    // The curated list guarantees both lists are always populated; the home/school tags keep them distinct.
    ...buildActivityLists({ home: extracted.homeActivities, school: extracted.schoolActivities }),
    parentTrainingGoals: extracted.parentTrainingGoals ||
      (extracted as any).caregiverTrainingGoals ||
      (extracted as any).familyTrainingGoals ||
      (extracted as any).parentEducationGoals ||
      (extracted as any).caregiverObjectives || [],
    diagnosis: normalizeDiagnosis(extracted.diagnosis),
    caregivers: extracted.caregivers || [],
  }
}

// ── Full-refresh profile builder (Update Assessment) ──────────────────────────
// Unlike mapToLegacyFormat, this deliberately does NOT apply cleanText/hasBlockedTerm. Update Assessment
// is a source-of-truth REFRESH: assessment-sourced keys are replaced wholesale, so there is no old profile
// for a filtered-out item to survive into — silently dropping (hasBlockedTerm) or rewriting (cleanText)
// real clinical text would corrupt the assessment. It carries the assessment's masteredBehaviors and drops
// any mastered name from the active list. Output keys match the clinical_profile shape the gates/UI read
// (skillAcquisition = mastered skills, replacementBehaviors = active skills — same convention as
// mapToLegacyFormat). homeActivities/schoolActivities = the curated clinician-approved baseline (always
// present) + the assessment's SPLIT activities (home→home, school→school); a FLAT/untagged list is
// discarded, never misplaced into both (see buildActivityLists). Activities are the one ENRICHABLE field —
// clinical content here is still faithful-only, never fabricated.
// Behavior/skill status is the SINGLE SOURCE OF TRUTH for mastery (Commit B). The old build routed
// behaviors by masteredBehaviors[] (a second source) AND hardcoded status:'active', which (a) flattened
// every non-active behavior to active and (b) let the two sources disagree (split-brain). Now: fold
// masteredBehaviors[] into the behavior list by CREATING name-only entries for any mastered name that has
// no detail row (so a name-only "Mastered" section is captured, never dropped), then classify EVERYTHING
// by per-item status — mastered behaviors go to masteredBehaviors[], the rest stay with their REAL status.
const behaviorStatus = (item: { status?: string }): string => {
  const s = String(item?.status || '').toLowerCase().trim()
  return ['mastered', 'maintenance', 'active', 'discontinued'].includes(s) ? s : 'unknown'
}

export function buildAssessmentProfile(extracted: ExtractedAssessment) {
  const behaviors: any[] = (extracted.maladaptiveBehaviors || []).filter(b => b && b.name)
  // Fold masteredBehaviors[] into the SAME list: create a name-only mastered entry for any mastered name
  // that has no behavior row. Never override an EXISTING entry's per-item status (status stays the source).
  const present = new Set(behaviors.map(b => String(b.name).toLowerCase().trim()))
  for (const raw of (extracted.masteredBehaviors || [])) {
    const n = String(raw || '').toLowerCase().trim()
    if (n && !present.has(n)) { behaviors.push({ name: String(raw), status: 'mastered', topography: '', function: [] }); present.add(n) }
  }
  const mastered = behaviors.filter(b => behaviorStatus(b) === 'mastered')
  const active = behaviors.filter(b => behaviorStatus(b) !== 'mastered')

  return {
    maladaptiveBehaviors: active.map(b => ({
      name: b.name.trim(),
      status: behaviorStatus(b), // carry the REAL status (active/maintenance/unknown/discontinued) — never hardcoded
      topographies: b.topography && String(b.topography).trim() ? [String(b.topography).trim()] : [],
      functions: Array.isArray(b.function) ? b.function : (b.function ? [b.function] : []),
    })),
    // Derived from the ONE source (status), so it can never disagree with the items' status.
    masteredBehaviors: [...new Set(mastered.map(b => String(b.name).trim()).filter(Boolean))],
    interventions: (extracted.approvedInterventions || [])
      .filter(Boolean)
      .map(i => ({ name: String(i).trim(), status: 'active' })),
    skillAcquisition: (extracted.replacementSkills || [])
      .filter(s => s.name && behaviorStatus(s) === 'mastered')
      .map(s => ({ name: s.name.trim(), status: 'mastered', targetFunction: s.targetFunction || '' })),
    replacementBehaviors: (extracted.replacementSkills || [])
      .filter(s => s.name && behaviorStatus(s) !== 'mastered')
      .map(s => ({ name: s.name.trim(), status: behaviorStatus(s), targetFunction: s.targetFunction || '' })),
    reinforcers: parseReinforcers(extracted.reinforcers).filter(r => !looksEdible(r)), // edibles never enter the profile (defense in depth; note-gen also filters at selection)
    // Curated clinician-approved baseline (always present) + the assessment's SPLIT activities (home→home,
    // school→school). A FLAT/untagged preferredActivities list is DISCARDED, never misplaced into both. Same
    // buildActivityLists helper the create/merge paths use. On this held branch the extractor may not yet
    // emit the split fields (they arrive when harden rebases onto the shipped activities work) — until then
    // this yields the curated baseline, which is the correct graceful result. The read-time home/school
    // split (buildServerSessionInput + isValidActivity) still applies per session location.
    ...buildActivityLists({
      home: (extracted as any).homeActivities,
      school: (extracted as any).schoolActivities,
    }),
    parentTrainingGoals: extracted.parentTrainingGoals || [],
    diagnosis: normalizeDiagnosis(extracted.diagnosis),
    caregivers: extracted.caregivers || [],
  }
}

// ── Knowledge base persistence (fire-and-forget) ──────────────────────────────

// ── Clinical Library accumulation (Step 3) ────────────────────────────────────
// Admin-curated corpus for the future Assessment Builder. Runs BEFORE the existing KB writes and is fully
// fail-soft: it can never throw into ingest, the KB writes below, or note generation. If the library tables
// are not migrated yet, it no-ops silently (like recordGateFindings). Separate from the note-gen KB above —
// curating this corpus cannot affect note generation.
// Shared library writer: log discards (count + reason only, never text) and upsert entries on
// UNIQUE(kind, canonical_key) — on a match, UNION new variants/functions into the existing row rather than
// duplicating (the anti-"diez líneas de tantrum" rule). IDEMPOTENT: re-running with the same input re-unions
// identical values, so nothing duplicates. Used by BOTH the live ingest and the historical backfill, so both
// paths get identical treatment. Returns per-run counts. Assumes the tables exist (callers probe first).
export interface LibraryWriteStats {
  created: number; updated: number; discarded: number
  createdByKind: Record<string, number>; updatedByKind: Record<string, number>
  discardsByReason: Record<string, number>
}
function emptyStats(): LibraryWriteStats {
  return { created: 0, updated: 0, discarded: 0, createdByKind: {}, updatedByKind: {}, discardsByReason: {} }
}
function bump(m: Record<string, number>, k: string) { m[k] = (m[k] || 0) + 1 }

async function writeLibrary(kept: LibraryEntry[], discards: DiscardRecord[], stats: LibraryWriteStats = emptyStats()): Promise<LibraryWriteStats> {
  for (const d of discards) {
    try { await (prisma as any).clinical_library_discards.create({ data: { kind: d.kind, reason: d.reason } }); stats.discarded++; bump(stats.discardsByReason, d.reason) } catch { /* fail-soft */ }
  }
  for (const entry of kept) {
    const key = canonicalKey(entry.name)
    if (!key) continue
    try {
      const existing = await (prisma as any).clinical_library.findFirst({
        where: { kind: entry.kind, canonical_key: key },
        select: { id: true, variants: true, functions: true },
      })
      if (existing) {
        await (prisma as any).clinical_library.update({
          where: { id: existing.id },
          data: {
            variants: unionCI([...(existing.variants || []), ...entry.variants]),
            functions: unionCI([...(existing.functions || []), ...entry.functions]),
          },
        })
        stats.updated++; bump(stats.updatedByKind, entry.kind)
      } else {
        await (prisma as any).clinical_library.create({
          data: {
            kind: entry.kind, canonical_key: key, display_name: entry.name.trim(),
            variants: unionCI(entry.variants), functions: unionCI(entry.functions), meta: entry.meta ?? undefined,
          },
        })
        stats.created++; bump(stats.createdByKind, entry.kind)
      }
    } catch { /* one entry failed (or a race on the unique index) — skip it, keep going */ }
  }
  return stats
}

// ── Clinical Library accumulation (Step 3) ────────────────────────────────────
// Admin-curated corpus for the future Assessment Builder. Runs BEFORE the existing KB writes and is fully
// fail-soft: it can never throw into ingest, the KB writes below, or note generation. If the library tables
// are not migrated yet, it no-ops silently (like recordGateFindings). Separate from the note-gen KB above —
// curating this corpus cannot affect note generation.
export async function saveClinicalLibrary(extracted: ExtractedAssessment): Promise<void> {
  try {
    // Probe: if the migration hasn't been run, bail silently rather than firing N failing calls.
    await (prisma as any).clinical_library.count()
    const { kept, discards } = filterLibraryEntries(collectLibraryEntries(extracted))
    await writeLibrary(kept, discards)
  } catch { /* tables missing or DB blip — no-op; the library must never break ingest */ }
}

// ── Clinical Library backfill (historical) ────────────────────────────────────
// Populate the library from ONE stored clinical_profile — admin-triggered, one client at a time. Uses the
// SAME helpers as live (canonicalKey + phiDiscardReason via filterLibraryEntries + writeLibrary upsert), so
// backfilled entries are treated identically. Extra safeguard: the person-name reinforcer guard (parity with
// the live path's people-category exclusion, which the flattened stored profile lost) — dropped reinforcers
// are logged as 'proper-name' discards so they appear in the summary. NEVER writes back to clinical_profile.
export async function backfillLibraryFromProfile(profile: any, stats: LibraryWriteStats = emptyStats()): Promise<LibraryWriteStats> {
  const raw = collectLibraryEntriesFromProfile(profile)
  // Extra reinforcer person guard BEFORE the standard PHI filter, counted as discards.
  const guardDiscards: DiscardRecord[] = []
  const guarded = raw.filter((e) => {
    if (e.kind === 'reinforcer' && looksLikePersonReinforcer(e.name)) { guardDiscards.push({ kind: 'reinforcer', reason: 'proper-name' }); return false }
    return true
  })
  const { kept, discards } = filterLibraryEntries(guarded)
  return writeLibrary(kept, [...guardDiscards, ...discards], stats)
}

// Backfill EVERY stored profile into the library. Admin-triggered, idempotent (writeLibrary upserts). Never
// writes back to clinical_profile — reads it only. Probes the tables first so it reports pendingMigration
// cleanly rather than throwing.
export async function backfillLibraryAll(): Promise<LibraryWriteStats & { clients: number } | { pendingMigration: true }> {
  try { await (prisma as any).clinical_library.count() } catch { return { pendingMigration: true } }
  const clients = await (prisma as any).clients.findMany({
    where: { clinical_profile: { not: null } },
    select: { id: true, clinical_profile: true },
  })
  const stats = emptyStats()
  for (const c of clients) {
    try { await backfillLibraryFromProfile(c.clinical_profile, stats) } catch { /* skip a bad profile, keep going */ }
  }
  return { ...stats, clients: clients.length }
}

export async function saveKnowledgeBase(extracted: ExtractedAssessment): Promise<void> {
  // Accumulate the admin Clinical Library first, isolated — it never throws (see above), so a library
  // failure cannot affect the note-gen KB writes that follow.
  await saveClinicalLibrary(extracted).catch(() => {})

  for (const behavior of extracted.maladaptiveBehaviors) {
    if (!behavior.name || hasBlockedTerm(behavior.name)) continue
    const cleanName = cleanText(behavior.name)
    const existing = await prisma.behaviors.findFirst({
      where: { name: { equals: cleanName, mode: 'insensitive' } },
      select: { id: true },
    })
    let behaviorId = existing?.id
    if (!behaviorId) {
      const inserted = await prisma.behaviors.create({
        data: { name: cleanName, category: behavior.function?.[0] || 'unknown' },
        select: { id: true },
      })
      behaviorId = inserted.id
    }
    if (behaviorId && behavior.topography) {
      const cleanTop = cleanText(behavior.topography)
      if (!hasBlockedTerm(cleanTop)) {
        const existingTop = await prisma.topographies.findFirst({
          where: { behavior_id: behaviorId, description: { equals: cleanTop, mode: 'insensitive' } },
          select: { id: true },
        })
        if (!existingTop) {
          await prisma.topographies.create({
            data: {
              behavior_id: behaviorId,
              description: cleanTop,
              measurable_unit: behavior.measurableUnit || 'frequency',
              severity_level: behavior.intensity || 3,
            },
          })
        }
      }
    }
  }

  for (const skill of extracted.replacementSkills) {
    if (!skill.name || hasBlockedTerm(skill.name)) continue
    const cleanName = cleanText(skill.name)
    const existing = await prisma.replacement_skills.findFirst({
      where: { skill_description: { equals: cleanName, mode: 'insensitive' } },
      select: { id: true },
    })
    if (!existing) {
      const matchingBehavior = await prisma.behaviors.findFirst({
        where: { category: { equals: skill.targetFunction, mode: 'insensitive' } },
        select: { id: true },
      })
      await prisma.replacement_skills.create({
        data: {
          skill_description: cleanName,
          function_targeted: skill.targetFunction || 'unknown',
          behavior_id: matchingBehavior?.id || null,
        },
      })
    }
  }
}
