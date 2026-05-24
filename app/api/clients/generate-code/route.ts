import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part1 = Array.from({ length: 2 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const part2 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${part1}-${part2}`
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { clientId?: string; clientName?: string; clientProfile?: any }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, clientName, clientProfile } = body
  if (!clientId || !clientName) {
    return NextResponse.json({ error: 'Missing clientId or clientName' }, { status: 400 })
  }

  // Upsert client into Supabase so the FK reference in client_access_codes works
  await supabaseServer.from('clients').upsert({
    id: clientId,
    client_name: clientName,
    diagnosis: clientProfile?.diagnosis || [],
    primary_setting: clientProfile?.setting || '',
    clinical_profile: clientProfile || {},
    rbt_id: user.id,
  }, { onConflict: 'id' })

  const code = randomCode()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabaseServer.from('client_access_codes').insert({
    client_id: clientId,
    rbt_id: user.id,
    code,
    expires_at: expiresAt,
  })

  if (error) {
    console.error('[generate-code]', error)
    return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
  }

  return NextResponse.json({ code, expiresAt })
}
