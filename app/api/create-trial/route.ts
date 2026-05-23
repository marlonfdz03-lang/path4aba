import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: Request) {
  const { userId, plan } = await request.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabaseServer
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan: plan || 'trial',
      status: 'trialing',
      trial_ends_at: trialEndsAt,
    })

  if (error) console.error('Trial creation error:', error)

  return NextResponse.json({ ok: true })
}
