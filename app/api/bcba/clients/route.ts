import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  console.log('[bcba/clients] fetching clients for bcba_id:', user.id)

  const { data: rows, error } = await supabaseServer
    .from('bcba_clients')
    .select('client_id, rbt_id, connected_at')
    .eq('bcba_id', user.id)
    .order('connected_at', { ascending: false })

  if (error) {
    console.error('[bcba/clients] bcba_clients fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
  }

  console.log('[bcba/clients] found', rows?.length, 'connections')

  if (!rows || rows.length === 0) {
    return NextResponse.json({ clients: [] })
  }

  const clientIds = rows.map((r) => r.client_id)
  const { data: clientRows, error: clientError } = await supabaseServer
    .from('clients')
    .select('id, internal_code, clinical_profile')
    .in('id', clientIds)

  console.log('[bcba/clients] client rows fetched:', clientRows?.length, 'error:', clientError)

  const clientMap = new Map((clientRows || []).map((c) => [c.id, c]))

  const clients = rows.map((row) => {
    const clientRow = clientMap.get(row.client_id)
    return {
      id: row.client_id,
      client_name: clientRow?.clinical_profile?.name || clientRow?.internal_code || 'Unknown Client',
      diagnosis: clientRow?.clinical_profile?.maladaptiveBehaviors?.map((b: any) => b.name).slice(0, 2) || [],
      connected_at: row.connected_at,
      rbt_id: row.rbt_id,
    }
  })

  return NextResponse.json({ clients })
}
