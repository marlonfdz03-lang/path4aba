import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'
import { BCBA_STUDENTS_NOTE_PROMPT } from '@/app/prompts/bcbaStudentsNotePrompt'

export const dynamic = 'force-dynamic'

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/))
  const words2 = new Set(text2.toLowerCase().split(/\s+/))
  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])
  return intersection.size / union.size
}

const ACTIVITY_LABELS: Record<string, string> = {
  unrestricted: 'unrestricted fieldwork',
  restricted: 'restricted fieldwork',
}

const CONTACT_LABELS: Record<string, string> = {
  none: 'independent (no supervisor present)',
  individual_supervision: 'individual supervision contact',
  group_supervision: 'group supervision contact',
  client_observation: 'client observation with supervisor feedback',
}

const VARIATION_INSTRUCTION = `\n\nIMPORTANT: This note is too similar to a previously saved entry. You must vary the sentence structure, clinical action verb, ABA component referenced, and closing phrase significantly. Use a different starting verb and a different note-ending pattern than before. The note must read as a distinctly different clinical description.`

const CATEGORY_INSTRUCTIONS: Record<string, string> = {
  'functional assessment': `\n\nCATEGORY OVERRIDE: FUNCTIONAL ASSESSMENT\nThis session involved functional assessment activities. Use language referencing functional behavior assessments, indirect/descriptive/experimental analysis methods, or hypothesis development about behavior function. Preferred verbs: Conducted / Administered / Analyzed. Avoid generic "reviewed behavioral data" language — reference the assessment process specifically.`,
  'general behavior analysis': `\n\nCATEGORY OVERRIDE: GENERAL BEHAVIOR ANALYSIS\nThis session involved general behavior analysis activities. Reference visual analysis, data trends, graphing, or behavioral patterns across sessions. Language should reflect BCBA-level analytical reasoning, not direct service delivery.`,
  'behavior change procedures': `\n\nCATEGORY OVERRIDE: BEHAVIOR CHANGE PROCEDURES\nThis session involved behavior change programming. Reference intervention development, skill acquisition procedures, reinforcement systems, or behavior reduction strategies. Preferred verbs: Developed / Evaluated / Implemented / Reviewed.`,
  'ethics & professional conduct': `\n\nCATEGORY OVERRIDE: ETHICS & PROFESSIONAL CONDUCT\nThis session involved ethics or professional conduct activities. Reference ethical decision-making, professional standards, BACB guidelines, or consultation on ethical matters. Language should reflect professional-level reasoning.`,
  'staff training & supervision': `\n\nCATEGORY OVERRIDE: STAFF TRAINING & SUPERVISION\nThis session involved staff training or supervision activities. Reference supervision tasks, training procedures, feedback delivery, or procedural fidelity review. Language should reflect supervisory and training roles.`,
  'treatment planning': `\n\nCATEGORY OVERRIDE: TREATMENT PLANNING\nThis session involved treatment planning activities. Reference behavior intervention plan development, goal-setting, or individualized programming decisions. Preferred verbs: Developed / Reviewed / Updated.`,
  'measurement & data systems': `\n\nCATEGORY OVERRIDE: MEASUREMENT & DATA SYSTEMS\nThis session involved measurement or data system activities. Reference data collection procedures, measurement tools, inter-observer agreement, or data system design.`,
  'data analysis & graphing': `\n\nCATEGORY OVERRIDE: DATA ANALYSIS & GRAPHING\nThis session involved data analysis and graphing activities. Reference visual analysis of graphed data, trend identification, level and variability, or data-based decision-making from graphs.`,
  'experimental design': `\n\nCATEGORY OVERRIDE: EXPERIMENTAL DESIGN\nThis session involved experimental design activities. Reference single-case design, treatment integrity, experimental control, or evidence-based practice evaluation.`,
  'assessment': `\n\nCATEGORY OVERRIDE: ASSESSMENT\nThis session involved assessment activities. Reference standardized or informal assessment procedures, skill acquisition baselines, or evaluation of client performance across domains. Preferred verbs: Conducted / Administered / Evaluated.`,
}

const ACTIVITY_TYPE_INSTRUCTIONS: Record<string, string> = {
  restricted: `\n\nACTIVITY TYPE: RESTRICTED\nThis is a RESTRICTED fieldwork activity. The note must reflect direct client contact and implementation of ABA procedures (e.g., running programs, DTT, NET, prompting, reinforcement delivery, behavior reduction). Do NOT use analysis or planning language.`,
  unrestricted: `\n\nACTIVITY TYPE: UNRESTRICTED\nThis is an UNRESTRICTED fieldwork activity. The note must reflect BCBA-level analytical work (e.g., visual analysis, treatment planning, data review, programming decisions). Do NOT use direct implementation language.`,
}

function buildCombinationInstruction(activityType: string, contactType: string): string {
  if (contactType === 'client_observation' && activityType === 'restricted') {
    return `

COMBINATION OVERRIDE: CLIENT OBSERVATION — RESTRICTED HOURS
This is direct implementation with a client. Restricted fieldwork hours require direct service delivery language only.

REQUIRED: Use only direct service verbs to open sentences: Implemented / Applied / Delivered / Collected / Conducted
REQUIRED: Reference direct service delivery, therapy sessions, or instructional sessions — not data review.
EXAMPLE PHRASES:
  'Implemented behavior reduction procedures during direct service delivery with a client receiving ABA services'
  'Collected frequency and duration data during direct therapy sessions'
  'Applied prompting and reinforcement procedures during instructional sessions'
BANNED FOR THIS COMBINATION: Reviewed / Analyzed / Evaluated / Conducted visual analysis / assessment / evaluation / visual analysis language of any kind`
  }

  if (contactType === 'group_supervision' && activityType === 'unrestricted') {
    return `

COMBINATION OVERRIDE: GROUP SUPERVISION — UNRESTRICTED HOURS
This session occurred in a group supervision context. Use BCBA-level analysis language and reference the group setting.

REQUIRED: Reference group supervision activities, peer review, or group learning context.
EXAMPLE PHRASES:
  'Participated in group supervision activities focused on reviewing behavioral data and intervention procedures for clients receiving ABA services'
  'Reviewed treatment integrity and intervention outcomes during group supervision activities'
  'Analyzed behavioral data trends with peers during group supervision to inform data-based treatment decisions'`
  }

  // individual_supervision + unrestricted and none + unrestricted: standard BCBA analysis language (base prompt applies as-is)
  return ''
}

export async function POST(req: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { activityType?: string; contactType?: string; setting?: string; category?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { activityType = 'unrestricted', contactType = 'none', setting = '', category = '' } = body

  const userMessage = [
    `Generate one BACB-compliant fieldwork session description.`,
    `Activity type: ${ACTIVITY_LABELS[activityType] ?? activityType}`,
    `Contact type: ${CONTACT_LABELS[contactType] ?? contactType}`,
    setting ? `Setting: ${setting}` : null,
  ].filter(Boolean).join('\n')

  // Fetch existing session notes for this user to run similarity check
  const { data: noteRows } = await supabaseServer
    .from('fieldwork_sessions')
    .select('session_note')
    .eq('user_id', user.id)
    .not('session_note', 'is', null)

  const previousNotes = (noteRows || [])
    .map(r => r.session_note as string)
    .filter(Boolean)

  const openai = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
    defaultQuery: { 'api-version': '2024-11-20' },
    defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
  })

  const activityInstruction = ACTIVITY_TYPE_INSTRUCTIONS[activityType] ?? ''
  const categoryInstruction = category ? (CATEGORY_INSTRUCTIONS[category] ?? '') : ''
  const systemPrompt = BCBA_STUDENTS_NOTE_PROMPT + activityInstruction + buildCombinationInstruction(activityType, contactType) + categoryInstruction

  async function generate(systemContent: string): Promise<string> {
    const response = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 250,
    })
    return response.choices[0]?.message?.content?.trim() || ''
  }

  let note = await generate(systemPrompt)

  // Similarity check — same Jaccard pattern as lib/generateSmartNote.ts
  let similarityWarning = false
  if (previousNotes.length > 0) {
    const tooSimilar = previousNotes.some(prev => calculateSimilarity(note, prev) >= 0.80)
    if (tooSimilar) {
      note = await generate(systemPrompt + VARIATION_INSTRUCTION)

      const stillTooSimilar = previousNotes.some(prev => calculateSimilarity(note, prev) >= 0.80)
      if (stillTooSimilar) {
        similarityWarning = true
        console.warn('[generate-note] note similarity still >=80% after regeneration for user:', user.id)
      }
    }
  }

  return NextResponse.json({ note, ...(similarityWarning && { similarityWarning: true }) })
}
