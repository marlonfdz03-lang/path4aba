import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

function calculateSimilarity(a: string, b: string): number {
  const w1 = new Set(a.toLowerCase().split(/\s+/))
  const w2 = new Set(b.toLowerCase().split(/\s+/))
  const intersection = new Set([...w1].filter(w => w2.has(w)))
  const union = new Set([...w1, ...w2])
  return intersection.size / union.size
}

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
  const { note_text, client_id, session_date } = body
  if (!client_id || !note_text) {
    return NextResponse.json({ error: 'Missing client_id or note_text' }, { status: 400 })
  }

  // Similarity check against the last 10 notes for this client
  const { data: prevNotes } = await supabaseServer
    .from('session_notes')
    .select('note_text')
    .eq('client_id', client_id)
    .order('created_at', { ascending: false })
    .limit(10)

  if (prevNotes) {
    for (const prev of prevNotes) {
      if (prev.note_text && calculateSimilarity(note_text, prev.note_text) >= 0.60) {
        return NextResponse.json({
          error: 'too_similar',
          message: 'Note is too similar to a previous session. Please vary your session details.',
        }, { status: 422 })
      }
    }
  }

  const { data: inserted, error } = await supabaseServer
    .from('session_notes')
    .insert({
      client_id,
      user_id: user.id,
      note_text,
      session_date: session_date || new Date().toISOString().split('T')[0],
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  return NextResponse.json({ success: true, id: inserted?.id })
}
