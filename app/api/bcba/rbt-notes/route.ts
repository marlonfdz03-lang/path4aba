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

  // Get all clients this BCBA is connected to
  const { data: connections } = await supabaseServer
    .from('bcba_clients')
    .select('client_id')
    .eq('bcba_id', user.id)

  const clientIds = connections?.map(c => c.client_id) || []
  if (clientIds.length === 0) return NextResponse.json({ notes: [] })

  const targetIds = clientId ? [clientId] : clientIds

  const { data: notes, error } = await supabaseServer
    .from('session_notes')
    .select('id, client_id, session_date, generated_note, review_status, reviewed_at, review_comment, created_at')
    .in('client_id', targetIds)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[bcba/rbt-notes]', error)
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
  }

  // Attach client names
  const { data: clients } = await supabaseServer
    .from('clients')
    .select('id, client_name')
    .in('id', targetIds)

  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c.client_name]))
  const enriched = (notes || []).map(n => ({ ...n, clientName: clientMap[n.client_id] || 'Unknown Client' }))

  return NextResponse.json({ notes: enriched })
}
