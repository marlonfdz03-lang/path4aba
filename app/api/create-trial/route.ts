import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: Request) {
  let body: { userId?: string; plan?: string; promoCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { userId, plan } = body

  console.log('[create-trial] request:', { userId, plan })

  if (!userId) {
    console.error('[create-trial] Missing userId')
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  // Verify user exists in Supabase Auth before inserting
  const { data: { user }, error: userError } = await supabaseServer.auth.admin.getUserById(userId)
  if (userError || !user) {
    console.error('[create-trial] User not found:', userError?.message)
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const resolvedPlan = plan || 'rbt'

  console.log('[create-trial] inserting subscription:', { userId, plan: resolvedPlan, trialEndsAt })

  const { error } = await supabaseServer
    .from('subscriptions')
    .upsert({
      user_id: userId,
      plan: resolvedPlan,
      status: 'trialing',
      trial_ends_at: trialEndsAt,
    }, { onConflict: 'user_id' })

  if (error) {
    console.error('[create-trial] DB error:', error.message, error.details, error.hint)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log('[create-trial] success for user:', userId)
  return NextResponse.json({ ok: true })
}
