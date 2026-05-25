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
  console.log('[missing-hours] bcba_id:', user.id, 'clientId param:', clientId)

  const { data: connections, error: connError } = await supabaseServer
    .from('bcba_clients')
    .select('client_id')
    .eq('bcba_id', user.id)

  console.log('[missing-hours] bcba_clients connections:', connections?.length, 'connError:', connError?.message)

  const clientIds = connections?.map(c => c.client_id) || []
  if (clientIds.length === 0) {
    console.log('[missing-hours] no connected clients — returning empty')
    return NextResponse.json({ entries: [] })
  }

  const targetIds = clientId ? [clientId] : clientIds
  console.log('[missing-hours] querying missed_hours for client_ids:', targetIds)

  const { data: entries, error } = await supabaseServer
    .from('missed_hours')
    .select('id, client_id, date, reason, hours, notes, created_at')
    .in('client_id', targetIds)
    .order('date', { ascending: false })

  console.log('[missing-hours] rows:', entries?.length, 'error code:', error?.code, 'error msg:', error?.message)

  if (error) {
    // PGRST205 = table not in schema cache (table doesn't exist yet)
    if (error.code === 'PGRST205' || error.message?.includes('relation') || error.message?.includes('does not exist')) {
      console.log('[missing-hours] missed_hours table does not exist yet — returning empty')
    } else {
      console.error('[missing-hours] unexpected DB error:', error)
    }
    return NextResponse.json({ entries: [] })
  }

  const { data: clients } = await supabaseServer
    .from('clients')
    .select('id, internal_code, clinical_profile')
    .in('id', targetIds)

  const clientMap = Object.fromEntries(
    (clients || []).map(c => [c.id, c.clinical_profile?.name || c.internal_code || 'Unknown Client'])
  )
  const enriched = (entries || []).map(e => ({ ...e, clientName: clientMap[e.client_id] || 'Unknown Client' }))

  console.log('[missing-hours] returning', enriched.length, 'entries')
  return NextResponse.json({ entries: enriched })
}
