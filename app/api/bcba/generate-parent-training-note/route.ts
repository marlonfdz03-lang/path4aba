import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'
import { generateParentTrainingNote } from '@/lib/generateParentTrainingNote'

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

  // Verify BCBA is connected to this client
  const { data: connection } = await supabaseServer
    .from('bcba_clients')
    .select('id')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let result: Awaited<ReturnType<typeof generateParentTrainingNote>>
  try {
    result = await generateParentTrainingNote({
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
    })
  } catch (e: any) {
    console.error('[generate-parent-training-note]', e)
    return NextResponse.json({ error: e.message || 'Generation failed' }, { status: 500 })
  }

  // Save to parent_training_notes
  const { error: saveError } = await supabaseServer.from('parent_training_notes').insert({
    client_id: clientId,
    bcba_id: user.id,
    session_date: sessionDate,
    caregiver_name: caregiverName,
    caregiver_relation: caregiverRelation || null,
    note_text: result.note,
    status: 'draft',
  })

  if (saveError) {
    console.error('[generate-parent-training-note] save error:', saveError)
  }

  return NextResponse.json({ note: result.note, similarityWarning: result.similarityWarning || undefined })
}
