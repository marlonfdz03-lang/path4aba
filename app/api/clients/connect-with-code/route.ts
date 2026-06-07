import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  console.log('[connect-with-code] === START ===')

  const session = await auth()
  const userId = (session?.user as any)?.id as string | undefined
  console.log('[connect-with-code] auth:', { userId })
  if (!session?.user || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string }
  try { body = await request.json() } catch (e) {
    console.error('[connect-with-code] body parse error:', e)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { code } = body
  console.log('[connect-with-code] raw code received:', JSON.stringify(code))
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const normalizedCode = code.toUpperCase().trim()
  console.log('[connect-with-code] normalized code:', normalizedCode, '| bcba_id:', userId)

  // Step 1: Look up the access code
  const accessCode = await prisma.client_access_codes.findFirst({
    where: { code: normalizedCode },
    select: { id: true, client_id: true, rbt_id: true, used: true, expires_at: true },
  })

  console.log('[connect-with-code] STEP 1 — code lookup:', { found: !!accessCode })

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

  const connectedAt = new Date()

  // Step 2: Upsert bcba_clients
  console.log('[connect-with-code] STEP 2 — upserting bcba_clients')
  try {
    await prisma.bcba_clients.upsert({
      where: { bcba_id_client_id: { bcba_id: userId, client_id: accessCode.client_id } },
      update: { rbt_id: accessCode.rbt_id, connected_at: connectedAt },
      create: { bcba_id: userId, client_id: accessCode.client_id, rbt_id: accessCode.rbt_id, connected_at: connectedAt },
    })
    console.log('[connect-with-code] STEP 2 OK')
  } catch (e: any) {
    console.error('[connect-with-code] STEP 2 FAILED:', e.message)
    return NextResponse.json({ error: 'Failed to connect client' }, { status: 500 })
  }

  // Step 3: Mark code as used
  try {
    await prisma.client_access_codes.update({
      where: { id: accessCode.id },
      data: { used: true, used_by: userId },
    })
    console.log('[connect-with-code] STEP 3 — mark used OK')
  } catch (e) {
    console.error('[connect-with-code] STEP 3 — mark used error:', e)
  }

  // Step 4: Fetch client data
  const clientRow = await prisma.clients.findFirst({
    where: { id: accessCode.client_id },
    select: { id: true, internal_code: true, clinical_profile: true },
  })

  console.log('[connect-with-code] STEP 4 — client fetch:', { found: !!clientRow })

  const client = clientRow ? {
    id: clientRow.id,
    client_name: (clientRow.clinical_profile as any)?.name || clientRow.internal_code || 'Unknown Client',
    diagnosis: (clientRow.clinical_profile as any)?.diagnosis || [],
    connected_at: connectedAt.toISOString(),
    rbt_id: accessCode.rbt_id,
  } : null

  console.log('[connect-with-code] === SUCCESS === returning client:', client?.id)
  return NextResponse.json({ client })
}
