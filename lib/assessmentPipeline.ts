// Shared assessment extraction pipeline.
// Used by: app/api/extract-assessment/route.ts
//           app/api/rbt/clients/create/route.ts
// Do not add route-specific logic here.

import PDFParser from 'pdf2json'
import { ExtractedAssessment } from '@/lib/extractAssessment'
import { prisma } from '@/lib/prisma'
import { parseReinforcers } from '@/lib/reinforcers'
import { buildActivityLists } from '@/lib/curatedActivities'
import { normalizeDiagnosis } from '@/lib/diagnosis'

// ── PDF parsing ───────────────────────────────────────────────────────────────

function safeDecode(text: string) {
  try { return decodeURIComponent(text) } catch { return text }
}

export function parsePdf(buffer: Buffer): Promise<string> {
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
    reinforcers: parseReinforcers(extracted.reinforcers),
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

export async function saveKnowledgeBase(extracted: ExtractedAssessment): Promise<void> {
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
