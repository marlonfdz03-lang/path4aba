import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import {
  isInvalidCategory,
  isValidCategory,
  invalidReason,
} from '@/lib/bcba-students/activity-categories'

export const dynamic = 'force-dynamic'

// Generic phrases that indicate a vague, audit-risky description.
const VAGUE_PHRASES = [
  'worked on programs',
  'did session',
  'reviewed stuff',
  'did work',
  'worked with client',
  'session was conducted',
  'worked on goals',
  'completed session',
  'ran session',
  'general session',
  'regular session',
  'typical session',
]

// Specificity indicators — phrases that reference observable, documented work.
const SPECIFIC_INDICATORS = [
  'trial', 'dtT', 'mand', 'tact', 'intraverbal', 'echoic', 'prompt',
  'reinforcement', 'extinction', 'ABC', 'data', 'percentage', 'accuracy',
  'behavior reduction', 'skill acquisition', 'baseline', 'probe', 'criterion',
  'target', 'mastery', 'program', 'VB-MAPP', 'ABLLS', 'AFLS', 'EIBI',
  'token', 'schedule', 'transition', 'communication', 'functional',
  'antecedent', 'consequence', 'intervention',
]

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { activityCategory?: string; description?: string; clientReference?: string; hours?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { activityCategory = '', description = '', clientReference = '', hours = 0 } = body

  let score = 100
  const issues: string[] = []

  // -40: invalid category
  if (activityCategory && isInvalidCategory(activityCategory)) {
    score -= 40
    issues.push(`"${activityCategory}" is not eligible BACB fieldwork. ${invalidReason(activityCategory)}`)
  } else if (activityCategory && !isValidCategory(activityCategory)) {
    score -= 40
    issues.push(`Unknown category "${activityCategory}". Select a recognized BACB activity.`)
  }

  // -30: missing or empty client reference
  const trimmedRef = clientReference.trim()
  if (!trimmedRef) {
    score -= 30
    issues.push('No client reference provided. BACB requires fieldwork to be tied to specific client programming.')
  }

  // -25: vague or too-short description
  const trimmedDesc = description.trim().toLowerCase()
  const isVague =
    trimmedDesc.length < 30 ||
    VAGUE_PHRASES.some(p => trimmedDesc.includes(p))

  if (isVague) {
    score -= 25
    issues.push('Description is too vague or too short. Include the specific behavior, program, or observable outcome you worked on.')
  }

  // -15: suspiciously long session (> 8 hours is a BACB audit flag)
  if (hours > 8) {
    score -= 15
    issues.push(`Session duration (${hours} hrs) exceeds 8 hours — may be flagged in a BACB audit. Verify actual time worked.`)
  }

  // +10: description contains specific clinical terminology
  const hasSpecific = SPECIFIC_INDICATORS.some(term =>
    trimmedDesc.includes(term.toLowerCase())
  )
  if (hasSpecific && !isVague) {
    score += 10
  }

  score = Math.max(0, Math.min(100, score))

  const riskLevel: RiskLevel = score >= 80 ? 'LOW' : score >= 50 ? 'MEDIUM' : 'HIGH'

  const bacbReasonMap: Record<RiskLevel, string> = {
    LOW:    'This session entry meets BACB documentation standards and is unlikely to be challenged in a fieldwork audit.',
    MEDIUM: 'This session entry has one or more characteristics that may require clarification during a BACB audit.',
    HIGH:   'This session entry has serious documentation gaps that could result in hours being rejected in a BACB audit.',
  }

  return NextResponse.json({
    score,
    valid: score >= 50,
    riskLevel,
    issues,
    bacbReason: bacbReasonMap[riskLevel],
    disclaimer: 'This score does not guarantee BACB approval. Final determination of hour eligibility remains with your supervisor and the BACB.',
  })
}
