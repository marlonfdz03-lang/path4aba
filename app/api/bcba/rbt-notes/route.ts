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
  console.log('[rbt-notes] bcba_id:', user.id, 'clientId param:', clientId)

  const { data: connections, error: connError } = await supabaseServer
    .from('bcba_clients')
    .select('client_id')
    .eq('bcba_id', user.id)

  console.log('[rbt-notes] bcba_clients connections:', connections?.length, 'connError:', connError?.message)

  const clientIds = connections?.map(c => c.client_id) || []
  if (clientIds.length === 0) {
    console.log('[rbt-notes] no connected clients — returning empty')
    return NextResponse.json({ notes: [] })
  }

  const targetIds = clientId ? [clientId] : clientIds
  console.log('[rbt-notes] querying session_notes for client_ids:', targetIds)

  const { data: notes, error } = await supabaseServer
    .from('session_notes')
    .select('id, client_id, rbt_id, session_date, generated_note, created_at')
    .in('client_id', targetIds)
    .order('created_at', { ascending: false })

  console.log('[rbt-notes] rows:', notes?.length, 'error:', error?.message)

  if (error) {
    console.error('[rbt-notes] DB error:', error)
    return NextResponse.json({ error: 'Failed to fetch notes', detail: error.message }, { status: 500 })
  }

  const { data: clients } = await supabaseServer
    .from('clients')
    .select('id, internal_code, clinical_profile')
    .in('id', targetIds)

  const clientMap = Object.fromEntries(
    (clients || []).map(c => [c.id, c.clinical_profile?.name || c.internal_code || 'Unknown Client'])
  )
  const enriched = (notes || []).map(n => ({
    ...n,
    clientName: clientMap[n.client_id] || 'Unknown Client',
  }))

  console.log('[rbt-notes] returning', enriched.length, 'notes')
  return NextResponse.json({ notes: enriched })
}
