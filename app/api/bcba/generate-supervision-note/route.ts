import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'
import { generateSupervisionNote } from '@/lib/generateSupervisionNote'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    clientId?: string
    sessionDate?: string
    timeRange?: string
    location?: string
    supervisorName?: string
    rbtName?: string
    contactType?: 'individual_supervision' | 'group_supervision' | 'client_observation'
    supervisionDetails?: {
      behaviorsObservedDuringVisit: string[]
      protocolModificationsMade: string
      feedbackProvidedToRBT: string
      rbtPerformanceNotes: string
      clinicalDecisionsMade: string
      nextSteps: string
    }
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, sessionDate, timeRange, location, supervisorName, rbtName, contactType, supervisionDetails } = body

  if (!clientId || !sessionDate || !contactType || !supervisionDetails) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify BCBA is connected to this client
  const { data: connection } = await supabaseServer
    .from('bcba_clients')
    .select('id, rbt_id')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supervisionInput = {
    sessionInfo: {
      date: sessionDate,
      timeRange: timeRange || '',
      location: location || '',
      supervisorName: supervisorName || '',
      rbtName: rbtName || '',
      contactType,
    },
    clientId,
    supervisionDetails,
  }

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const result = await generateSupervisionNote(supervisionInput, (text) => {
          controller.enqueue(encoder.encode(text))
        })

        const { error: saveError } = await supabaseServer.from('supervision_notes').insert({
          client_id: clientId,
          bcba_id: user.id,
          rbt_id: connection.rbt_id,
          session_date: sessionDate,
          supervision_type: contactType,
          note_text: result.note,
          status: 'draft',
        })
        if (saveError) console.error('[generate-supervision-note] save error:', saveError)

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
