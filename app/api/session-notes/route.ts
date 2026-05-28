import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { clientId, noteText, sessionDate } = body
  if (!clientId || !noteText) {
    return NextResponse.json({ error: 'Missing clientId or noteText' }, { status: 400 })
  }

  const { error } = await supabaseServer
    .from('session_notes')
    .insert({
      client_id: clientId,
      user_id: user.id,
      note_text: noteText,
      session_date: sessionDate || new Date().toISOString().split('T')[0],
    })

  if (error) return NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
