import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: Request) {
  console.log('[connect-with-code] === START ===')

  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  console.log('[connect-with-code] auth:', { userId: user?.id, authError })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string }
  try { body = await request.json() } catch (e) {
    console.error('[connect-with-code] body parse error:', e)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { code } = body
  console.log('[connect-with-code] raw code received:', JSON.stringify(code))
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const normalizedCode = code.toUpperCase().trim()
  console.log('[connect-with-code] normalized code:', normalizedCode, '| bcba_id:', user.id)

  // Step 1: Look up the access code
  const { data: accessCode, error: codeError } = await supabaseServer
    .from('client_access_codes')
    .select('id, client_id, rbt_id, used, expires_at')
    .eq('code', normalizedCode)
    .maybeSingle()

  console.log('[connect-with-code] STEP 1 — code lookup:', {
    found: !!accessCode,
    accessCode,
    codeError: codeError ? { message: codeError.message, code: codeError.code, details: codeError.details } : null,
  })

  if (codeError) {
    console.error('[connect-with-code] STEP 1 FAILED — DB error on code lookup:', JSON.stringify(codeError))
    return NextResponse.json({ error: 'Invalid code. Please check and try again.' }, { status: 404 })
  }
  if (!accessCode) {
    console.log('[connect-with-code] STEP 1 FAILED — no row found for code:', normalizedCode)
    return NextResponse.json({ error: 'Invalid code. Please check and try again.' }, { status: 404 })
  }
  if (accessCode.used) {
    console.log('[connect-with-code] STEP 1 FAILED — code already used')
    return NextResponse.json({ error: 'This code has already been used.' }, { status: 409 })
  }
  if (accessCode.expires_at && new Date(accessCode.expires_at) < new Date()) {
    console.log('[connect-with-code] STEP 1 FAILED — code expired at:', accessCode.expires_at)
    return NextResponse.json({ error: 'This code has expired. Ask your RBT for a new one.' }, { status: 410 })
  }

  console.log('[connect-with-code] STEP 1 OK — client_id:', accessCode.client_id, '| rbt_id:', accessCode.rbt_id)

  const connectedAt = new Date().toISOString()

  // Step 2: Upsert bcba_clients
  const upsertPayload = {
    bcba_id: user.id,
    client_id: accessCode.client_id,
    rbt_id: accessCode.rbt_id,
    connected_at: connectedAt,
  }
  console.log('[connect-with-code] STEP 2 — upserting bcba_clients:', upsertPayload)

  const { data: upsertData, error: connectError } = await supabaseServer
    .from('bcba_clients')
    .upsert(upsertPayload, { onConflict: 'bcba_id,client_id' })
    .select()

  console.log('[connect-with-code] STEP 2 result:', {
    upsertData,
    connectError: connectError ? { message: connectError.message, code: connectError.code, details: connectError.details, hint: connectError.hint } : null,
  })

  if (connectError) {
    console.error('[connect-with-code] STEP 2 FAILED — full error:', JSON.stringify(connectError))
    return NextResponse.json({ error: 'Failed to connect client' }, { status: 500 })
  }

  // Step 3: Mark code as used
  const { error: markUsedError } = await supabaseServer
    .from('client_access_codes')
    .update({ used: true, used_by: user.id })
    .eq('id', accessCode.id)

  console.log('[connect-with-code] STEP 3 — mark used:', { markUsedError })

  // Step 4: Fetch client data
  const { data: clientRow, error: clientError } = await supabaseServer
    .from('clients')
    .select('id, internal_code, clinical_profile')
    .eq('id', accessCode.client_id)
    .maybeSingle()

  console.log('[connect-with-code] STEP 4 — client fetch:', {
    found: !!clientRow,
    clientError: clientError ? { message: clientError.message, code: clientError.code } : null,
  })

  const client = clientRow ? {
    id: clientRow.id,
    client_name: clientRow.clinical_profile?.name || clientRow.internal_code || 'Unknown Client',
    diagnosis: clientRow.clinical_profile?.maladaptiveBehaviors?.map((b: any) => b.name).slice(0, 2) || [],
    connected_at: connectedAt,
    rbt_id: accessCode.rbt_id,
  } : null

  console.log('[connect-with-code] === SUCCESS === returning client:', client?.id)
  return NextResponse.json({ client })
}
