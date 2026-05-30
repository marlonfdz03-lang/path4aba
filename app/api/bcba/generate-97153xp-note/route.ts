import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import OpenAI from 'openai'
import { build97153XPPrompt } from '@/app/prompts/supervision97153xpPrompt'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  let body: {
    clientId?: string
    sessionDate?: string
    location?: string
    rbtSessionContext?: { empty: boolean; behaviors?: string[]; skills?: string[]; interventions?: string[]; activities?: string[] } | null
    bcbaActionsPerformed?: string
    treatmentIntegrityConcerns?: string
    clientResponseDuringOverlap?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, sessionDate, location, rbtSessionContext, bcbaActionsPerformed, treatmentIntegrityConcerns, clientResponseDuringOverlap } = body

  if (!clientId || !sessionDate) {
    return NextResponse.json({ error: 'Missing clientId or sessionDate' }, { status: 400 })
  }

  if (!UUID_RE.test(userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { id: true },
  })

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { systemPrompt, userPrompt } = build97153XPPrompt({
    sessionDate,
    location: location || '',
    rbtSessionContext: rbtSessionContext ?? null,
    bcbaActionsPerformed: bcbaActionsPerformed || '',
    treatmentIntegrityConcerns: treatmentIntegrityConcerns || '',
    clientResponseDuringOverlap: clientResponseDuringOverlap || '',
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const aiStream = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: true,
          max_tokens: 1200,
          temperature: 0.3,
        })

        let fullNote = ''
        for await (const chunk of aiStream) {
          const delta = chunk.choices[0]?.delta?.content || ''
          if (delta) {
            fullNote += delta
            controller.enqueue(encoder.encode(delta))
          }
        }

        let savedId: string | undefined
        try {
          const inserted = await prisma.supervision_notes_97153xp.create({
            data: {
              client_id: clientId,
              bcba_id: userId,
              session_date: sessionDate,
              note_text: fullNote,
              rbt_session_context: rbtSessionContext || undefined,
            },
            select: { id: true },
          })
          savedId = inserted.id
        } catch (saveError) {
          console.error('[generate-97153xp-note] save error:', saveError)
        }

        controller.enqueue(encoder.encode(`__META__${JSON.stringify({ saved: !!savedId })}`))
      } catch (err: any) {
        controller.enqueue(encoder.encode(`__META__${JSON.stringify({ error: err.message || 'Generation failed' })}`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
