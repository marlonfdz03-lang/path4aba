import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  // Verify BCBA is connected to this client
  const { data: conn } = await supabaseServer
    .from('bcba_clients')
    .select('rbt_id, connected_at')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!conn) {
    return NextResponse.json({ error: 'Not connected to this client' }, { status: 403 })
  }

  // Fetch client data bypassing RLS
  const { data: clientRow, error } = await supabaseServer
    .from('clients')
    .select('id, internal_code, clinical_profile')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !clientRow) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({
    client: {
      id: clientRow.id,
      internal_code: clientRow.internal_code,
      clinical_profile: clientRow.clinical_profile,
      client_name: clientRow.clinical_profile?.name || clientRow.internal_code || 'Unknown Client',
      rbt_id: conn.rbt_id,
      connected_at: conn.connected_at,
    },
  })
}
