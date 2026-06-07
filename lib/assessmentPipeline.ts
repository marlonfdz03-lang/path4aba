// Shared assessment extraction pipeline.
// Used by: app/api/extract-assessment/route.ts
//           app/api/rbt/clients/create/route.ts
// Do not add route-specific logic here.

import PDFParser from 'pdf2json'
import { ExtractedAssessment } from '@/lib/extractAssessment'
import { prisma } from '@/lib/prisma'

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
    reinforcers: [
      extracted.reinforcers.tangibles,
      extracted.reinforcers.activities,
      extracted.reinforcers.social,
      extracted.reinforcers.people,
    ]
      .filter(Boolean)
      .flatMap(r => {
        const str = Array.isArray(r) ? r.join(', ') : String(r)
        return str.split(',').map(s => s.trim())
      })
      .filter(r => r && !hasBlockedTerm(r))
      .map(cleanText),
    homeActivities: [],
    schoolActivities: [],
    parentTrainingGoals: extracted.parentTrainingGoals ||
      (extracted as any).caregiverTrainingGoals ||
      (extracted as any).familyTrainingGoals ||
      (extracted as any).parentEducationGoals ||
      (extracted as any).caregiverObjectives || [],
    diagnosis: extracted.diagnosis || [],
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
