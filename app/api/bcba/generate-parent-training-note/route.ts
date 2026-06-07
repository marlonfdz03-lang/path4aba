import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { generateParentTrainingNote } from '@/lib/generateParentTrainingNote'


export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string

  let body: {
    clientId?: string
    sessionDate?: string
    location?: string
    caregiverName?: string
    caregiverRelation?: string
    participantsPresent?: string[]
    clientPresent?: 'yes' | 'no' | 'partial' | ''
    trainingTopics?: string[]
    parentTrainingGoals?: string[]
    manualPTGoal?: string
    proceduresTrained?: string[]
    bstComponents?: string[]
    caregiverPerformance?: string
    didNotPracticeReason?: string
    feedbackProvided?: string[]
    clientResponse?: string[]
    barriersIdentified?: string[]
    homeImplementationPlan?: string
    followUpPlan?: string[]
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    clientId, sessionDate, location, caregiverName, caregiverRelation,
    clientPresent, trainingTopics, parentTrainingGoals, manualPTGoal,
    proceduresTrained, bstComponents, caregiverPerformance, didNotPracticeReason,
    feedbackProvided, clientResponse, barriersIdentified,
    homeImplementationPlan, followUpPlan,
  } = body

  if (!clientId || !sessionDate || !caregiverName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }


  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { id: true },
  })

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parentTrainingInput = {
    sessionInfo: {
      date: sessionDate,
      location: location || '',
      caregiverName: caregiverName,
      caregiverRelation: caregiverRelation || '',
    },
    clientId,
    clientPresent: clientPresent || '' as 'yes' | 'no' | 'partial' | '',
    trainingTopics: trainingTopics || [],
    parentTrainingGoals: parentTrainingGoals || [],
    manualPTGoal: manualPTGoal || '',
    proceduresTrained: proceduresTrained || [],
    bstComponents: bstComponents || [],
    caregiverPerformance: caregiverPerformance || '',
    didNotPracticeReason: didNotPracticeReason || '',
    feedbackProvided: feedbackProvided || [],
    clientResponse: clientResponse || [],
    barriersIdentified: barriersIdentified || [],
    homeImplementationPlan: homeImplementationPlan || '',
    followUpPlan: followUpPlan || [],
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
