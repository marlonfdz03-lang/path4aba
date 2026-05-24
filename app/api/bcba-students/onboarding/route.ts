import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { certificationTrack?: string; fieldworkType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { certificationTrack, fieldworkType } = body
  if (!certificationTrack || !fieldworkType) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Get authenticated user from cookie session
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabaseServer
    .from('fieldwork_profiles')
    .upsert({
      user_id: user.id,
      certification_track: certificationTrack,
      fieldwork_type: fieldworkType,
      onboarding_complete: true,
    }, { onConflict: 'user_id' })

  if (error) {
    console.error('[bcba-students/onboarding] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
