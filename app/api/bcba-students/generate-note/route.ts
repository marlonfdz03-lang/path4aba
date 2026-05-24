import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { BCBA_STUDENTS_NOTE_PROMPT } from '@/app/prompts/bcbaStudentsNotePrompt'

export const dynamic = 'force-dynamic'

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

export async function POST(req: Request) {
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

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: BCBA_STUDENTS_NOTE_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 250,
    })
    const note = response.choices[0]?.message?.content?.trim() || ''
    return NextResponse.json({ note })
  } catch (err: any) {
    console.error('[generate-note] OpenAI error:', err?.message)
    return NextResponse.json({ error: 'Failed to generate note' }, { status: 500 })
  }
}
