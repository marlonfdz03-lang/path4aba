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

  let body: { noteId?: string; status?: 'accepted' | 'rejected'; comment?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { noteId, status, comment } = body
  if (!noteId || !status || !['accepted', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Missing or invalid noteId or status' }, { status: 400 })
  }

  // Verify the note belongs to one of this BCBA's clients
  const { data: note } = await supabaseServer
    .from('session_notes')
    .select('client_id')
    .eq('id', noteId)
    .maybeSingle()

  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  const { data: connection } = await supabaseServer
    .from('bcba_clients')
    .select('id')
    .eq('bcba_id', user.id)
    .eq('client_id', note.client_id)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabaseServer.from('session_notes').update({
    review_status: status,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    review_comment: comment || null,
  }).eq('id', noteId)

  if (error) {
    console.error('[bcba/review-note]', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
