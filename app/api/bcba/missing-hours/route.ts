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

  const { data: connections } = await supabaseServer
    .from('bcba_clients')
    .select('client_id')
    .eq('bcba_id', user.id)

  const clientIds = connections?.map(c => c.client_id) || []
  if (clientIds.length === 0) return NextResponse.json({ entries: [] })

  const targetIds = clientId ? [clientId] : clientIds

  const { data: entries, error } = await supabaseServer
    .from('missed_hours')
    .select('id, client_id, date, reason, hours, notes, created_at')
    .in('client_id', targetIds)
    .order('date', { ascending: false })

  if (error) {
    // Table may not exist yet — return empty gracefully
    return NextResponse.json({ entries: [] })
  }

  const { data: clients } = await supabaseServer
    .from('clients')
    .select('id, client_name')
    .in('id', targetIds)

  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c.client_name]))
  const enriched = (entries || []).map(e => ({ ...e, clientName: clientMap[e.client_id] || 'Unknown Client' }))

  return NextResponse.json({ entries: enriched })
}
