import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'

const SUPERVISION_TYPE_LABELS: Record<string, string> = {
  individual_supervision: 'Individual Supervision',
  group_supervision: 'Group Supervision',
  client_observation: 'Client Observation',
  face_to_face: 'Face-to-Face',
  remote: 'Remote',
}

export async function GET(request: Request) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  // Verify this client belongs to this RBT
  const { data: clientRow } = await supabaseServer
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('rbt_id', user.id)
    .maybeSingle()

  if (!clientRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const today = new Date().toISOString().split('T')[0]

  const { data: note } = await supabaseServer
    .from('supervision_notes')
    .select('note_text, supervision_type')
    .eq('client_id', clientId)
    .eq('session_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!note) return NextResponse.json({ summary: null })

  const preview = (note.note_text || '').slice(0, 300)
  const typeLabel = SUPERVISION_TYPE_LABELS[note.supervision_type] || 'Supervision'

  return NextResponse.json({
    summary: {
      notePreview: preview,
      isTruncated: (note.note_text || '').length > 300,
      supervisionTypeLabel: typeLabel,
    }
  })
}
