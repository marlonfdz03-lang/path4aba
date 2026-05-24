import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { code } = body
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const { data: accessCode, error: codeError } = await supabaseServer
    .from('client_access_codes')
    .select('id, client_id, rbt_id, used, expires_at')
    .eq('code', code.toUpperCase().trim())
    .maybeSingle()

  if (codeError || !accessCode) {
    return NextResponse.json({ error: 'Invalid code. Please check and try again.' }, { status: 404 })
  }
  if (accessCode.used) {
    return NextResponse.json({ error: 'This code has already been used.' }, { status: 409 })
  }
  if (accessCode.expires_at && new Date(accessCode.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This code has expired. Ask your RBT for a new one.' }, { status: 410 })
  }

  // Connect BCBA to client
  const { error: connectError } = await supabaseServer.from('bcba_clients').upsert({
    bcba_id: user.id,
    client_id: accessCode.client_id,
    rbt_id: accessCode.rbt_id,
  }, { onConflict: 'bcba_id,client_id' })

  if (connectError) {
    console.error('[connect-with-code]', connectError)
    return NextResponse.json({ error: 'Failed to connect client' }, { status: 500 })
  }

  // Mark code as used
  await supabaseServer.from('client_access_codes').update({
    used: true,
    used_by: user.id,
  }).eq('id', accessCode.id)

  // Fetch full client data to return
  const { data: client } = await supabaseServer
    .from('clients')
    .select('*')
    .eq('id', accessCode.client_id)
    .maybeSingle()

  return NextResponse.json({ client })
}
