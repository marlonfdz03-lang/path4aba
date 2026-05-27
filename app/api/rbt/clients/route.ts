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

  const { data: rows, error } = await supabaseServer
    .from('clients')
    .select('id, internal_code, clinical_profile')
    .eq('rbt_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
  }

  const clientList = (rows || []).map(row => ({
    id: row.id,
    client_name: row.clinical_profile?.name || row.internal_code || 'Unknown Client',
    internal_code: row.internal_code,
    clinical_profile: row.clinical_profile,
  }))

  return NextResponse.json({ clients: clientList })
}
