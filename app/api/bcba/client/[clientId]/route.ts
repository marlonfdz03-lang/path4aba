import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

async function getAuthUser() {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  return authClient.auth.getUser()
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { data: { user } } = await getAuthUser()
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { data: { user } } = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  // Verify BCBA is connected to this client
  const { data: conn } = await supabaseServer
    .from('bcba_clients')
    .select('id')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!conn) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { clinicalProfile?: any }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clinicalProfile } = body
  if (!clinicalProfile || typeof clinicalProfile !== 'object') {
    return NextResponse.json({ error: 'Missing clinicalProfile' }, { status: 400 })
  }

  const { data: updated, error } = await supabaseServer
    .from('clients')
    .update({ clinical_profile: clinicalProfile })
    .eq('id', clientId)
    .select('id, internal_code, clinical_profile')
    .maybeSingle()

  if (error || !updated) {
    console.error('[PATCH client] update error:', error)
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 })
  }

  return NextResponse.json({
    client: {
      id: updated.id,
      internal_code: updated.internal_code,
      clinical_profile: updated.clinical_profile,
      client_name: updated.clinical_profile?.name || updated.internal_code || 'Unknown Client',
    },
  })
}
