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

  let body: { activityType?: string; contactType?: string; setting?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { activityType = 'unrestricted', contactType = 'none', setting = '' } = body

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

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const systemPrompt = BCBA_STUDENTS_NOTE_PROMPT + buildCombinationInstruction(activityType, contactType)

  async function generate(systemContent: string): Promise<string> {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
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
