import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { generateSupervisionNote } from '@/lib/generateSupervisionNote'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string

  let body: {
    clientId?: string
    sessionDate?: string
    location?: string
    contactType?: string
    // Individual / client observation fields
    reason97155?: string[]
    dataReviewed?: string[]
    programsReviewed?: {
      maladaptive: string[]
      replacement: string[]
      skillAcquisition: string[]
      manual?: string
    }
    clinicalFindings?: string[]
    protocolModifications?: string[]
    clinicalRationale?: string
    expectedOutcome?: string
    clientResponse?: string[]
    followUpPlan?: string[]
    // Group supervision fields
    groupSupervision?: {
      participantCount: number
      topicsReviewed: string[]
      clinicalTrends: string
      recommendations: string
      followUpPlan: string[]
    }
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    clientId, sessionDate, location, contactType,
    reason97155, dataReviewed, programsReviewed,
    clinicalFindings, protocolModifications, clinicalRationale,
    expectedOutcome, clientResponse, followUpPlan,
    groupSupervision,
  } = body

  if (!clientId || !sessionDate || !contactType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!UUID_RE.test(userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { rbt_id: true },
  })

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supervisionInput = {
    sessionInfo: {
      date: sessionDate,
      location: location || '',
      contactType: contactType || 'individual_supervision',
    },
    clientId,
    reason97155: reason97155 || [],
    dataReviewed: dataReviewed || [],
    programsReviewed: programsReviewed || { maladaptive: [], replacement: [], skillAcquisition: [] },
    clinicalFindings: clinicalFindings || [],
    protocolModifications: protocolModifications || [],
    clinicalRationale: clinicalRationale || '',
    expectedOutcome: expectedOutcome || '',
    clientResponse: clientResponse || [],
    followUpPlan: followUpPlan || [],
    groupSupervision,
  }

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const result = await generateSupervisionNote(supervisionInput, (text) => {
          controller.enqueue(encoder.encode(text))
        })

        try {
          await prisma.supervision_notes.create({
            data: {
              client_id: clientId,
              bcba_id: userId,
              rbt_id: connection.rbt_id,
              session_date: sessionDate,
              supervision_type: contactType,
              note_text: result.note,
              status: 'draft',
            },
          })
        } catch (saveError) {
          console.error('[generate-supervision-note] save error:', saveError)
        }

        controller.enqueue(encoder.encode(
          `\n__META__${JSON.stringify({ similarityWarning: result.similarityWarning || false })}`
        ))
      } catch (e: any) {
        console.error('[generate-supervision-note]', e)
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
