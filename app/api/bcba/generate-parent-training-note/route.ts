import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { generateParentTrainingNote } from '@/lib/generateParentTrainingNote'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string

  let body: {
    clientId?: string
    sessionDate?: string
    timeRange?: string
    location?: string
    bcbaName?: string
    caregiverName?: string
    caregiverRelation?: string
    sessionDetails?: {
      behaviorsObservedDuringSession: string[]
      proceduresTrainedToday: string[]
      whatBCBAModeled: string
      caregiverPracticeDescription: string
      feedbackProvided: string
      caregiverOutcome: string
      generalizationTopicsDiscussed: string
      nextSessionGoals: string
      clientPresent?: string
    }
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, sessionDate, timeRange, location, bcbaName, caregiverName, caregiverRelation, sessionDetails } = body

  if (!clientId || !sessionDate || !caregiverName || !sessionDetails) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!UUID_RE.test(userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { id: true },
  })

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parentTrainingInput = {
    sessionInfo: {
      date: sessionDate,
      timeRange: timeRange || '',
      location: location || '',
      bcbaName: bcbaName || '',
      caregiverName,
      caregiverRelation: caregiverRelation || '',
    },
    clientId,
    sessionDetails,
  }

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const result = await generateParentTrainingNote(parentTrainingInput, (text) => {
          controller.enqueue(encoder.encode(text))
        })

        try {
          await prisma.parent_training_notes.create({
            data: {
              client_id: clientId,
              bcba_id: userId,
              session_date: sessionDate,
              caregiver_name: caregiverName,
              caregiver_relation: caregiverRelation || null,
              note_text: result.note,
              status: 'draft',
            },
          })
        } catch (saveError) {
          console.error('[generate-parent-training-note] save error:', saveError)
        }

        controller.enqueue(encoder.encode(
          `\n__META__${JSON.stringify({ similarityWarning: result.similarityWarning || false })}`
        ))
      } catch (e: any) {
        console.error('[generate-parent-training-note]', e)
        controller.enqueue(encoder.encode(
          `\n__META__${JSON.stringify({ error: e.message || 'Generation failed' })}`
        ))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
