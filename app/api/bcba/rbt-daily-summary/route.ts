import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

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
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  // Verify BCBA is connected to this client and get the connected RBT's id
  const { data: connection } = await supabaseServer
    .from('bcba_clients')
    .select('rbt_id')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!connection.rbt_id) return NextResponse.json({ summary: null })

  const today = new Date().toISOString().split('T')[0]

  const { data: note } = await supabaseServer
    .from('session_notes')
    .select('behaviors_addressed, skills_addressed, interventions_used')
    .eq('client_id', clientId)
    .eq('user_id', connection.rbt_id)
    .eq('session_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!note) return NextResponse.json({ summary: null })

  return NextResponse.json({
    summary: {
      behaviors: (note.behaviors_addressed as string[]) || [],
      skills: (note.skills_addressed as string[]) || [],
      interventions: (note.interventions_used as string[]) || [],
    }
  })
}
