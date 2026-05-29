import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const date = url.searchParams.get('date')
  if (!clientId || !date) return NextResponse.json({ error: 'Missing clientId or date' }, { status: 400 })

  const { data: connection } = await supabaseServer
    .from('bcba_clients')
    .select('rbt_id')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!connection.rbt_id) return NextResponse.json({ empty: true })

  const { data: note } = await supabaseServer
    .from('session_notes')
    .select('behaviors_addressed, skills_addressed, interventions_used, activities_used, note_text')
    .eq('client_id', clientId)
    .eq('user_id', connection.rbt_id)
    .eq('session_date', date)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!note) return NextResponse.json({ empty: true })

  return NextResponse.json({
    empty: false,
    behaviors: (note.behaviors_addressed as string[]) || [],
    skills: (note.skills_addressed as string[]) || [],
    interventions: (note.interventions_used as string[]) || [],
    activities: (note.activities_used as string[]) || [],
    noteText: note.note_text || '',
  })
}
