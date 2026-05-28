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
  const { data: { user } } = await authClient.auth.getUser()
  return user
}

export async function GET(req: Request) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const { data: notes } = await supabaseServer
    .from('session_notes')
    .select('id, note_text, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ notes: notes || [] })
}

export async function POST(req: Request) {
  const user = await getAuthUser()
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
