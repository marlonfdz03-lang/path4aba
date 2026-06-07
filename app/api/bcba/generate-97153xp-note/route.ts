import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import type * as Prisma from '@/lib/generated/prisma/internal/prismaNamespace'
import OpenAI from 'openai'
import { build97153XPPrompt } from '@/app/prompts/supervision97153xpPrompt'


const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
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
    rbtSessionContext?: Record<string, unknown> | null
    rbtBehaviorsReported?: string[]
    rbtInterventionsUsed?: string[]
    rbtProgramsWorked?: string[]
    bcbaObservedPrograms?: string[]
    bcbaObservedBehaviors?: string[]
    supervisionFocus?: string[]
    integrityReview?: {
      prompting: string
      reinforcement: string
      behaviorReduction: string
      dataCollection: string
    }
    bcbaActionsPerformed?: string[]
    feedbackToRbt?: string[]
    clientResponseDuringOverlap?: string[]
    recommendations?: string[]
    narrativeStyle?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    clientId, sessionDate, location, rbtSessionContext,
    rbtBehaviorsReported, rbtInterventionsUsed, rbtProgramsWorked,
    bcbaObservedPrograms, bcbaObservedBehaviors, supervisionFocus,
    integrityReview, bcbaActionsPerformed, feedbackToRbt,
    clientResponseDuringOverlap, recommendations, narrativeStyle,
  } = body

  if (!clientId || !sessionDate) {
    return NextResponse.json({ error: 'Missing clientId or sessionDate' }, { status: 400 })
  }


  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { id: true },
  })

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { systemPrompt, userPrompt } = build97153XPPrompt({
    sessionDate,
    location: location || '',
    rbtSessionContext: rbtSessionContext ?? null,
    rbtBehaviorsReported: rbtBehaviorsReported || [],
    rbtInterventionsUsed: rbtInterventionsUsed || [],
    rbtProgramsWorked: rbtProgramsWorked || [],
    bcbaObservedPrograms: bcbaObservedPrograms || [],
    bcbaObservedBehaviors: bcbaObservedBehaviors || [],
    supervisionFocus: supervisionFocus || [],
    integrityReview,
    bcbaActionsPerformed: bcbaActionsPerformed || [],
    feedbackToRbt: feedbackToRbt || [],
    clientResponseDuringOverlap: clientResponseDuringOverlap || [],
    recommendations: recommendations || [],
    narrativeStyle: narrativeStyle || 'Insurance-Friendly',
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
              rbt_session_context: rbtSessionContext
                ? (rbtSessionContext as Prisma.InputJsonValue)
                : undefined,
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
