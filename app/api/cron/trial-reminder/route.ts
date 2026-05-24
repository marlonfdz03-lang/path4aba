import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { sendTrialEndingEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Vercel cron injects Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const windowStart = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)   // 2 days from now
  const windowEnd   = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)   // 3 days from now

  const { data: subs, error } = await supabaseServer
    .from('subscriptions')
    .select('user_id, trial_ends_at')
    .eq('status', 'trialing')
    .gte('trial_ends_at', windowStart.toISOString())
    .lte('trial_ends_at', windowEnd.toISOString())

  if (error) {
    console.error('[trial-reminder] DB error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  let sent = 0
  const errors: string[] = []

  for (const sub of subs) {
    try {
      const { data } = await supabaseServer.auth.admin.getUserById(sub.user_id)
      const user = data?.user
      if (!user?.email) continue

      const daysLeft = Math.ceil(
        (new Date(sub.trial_ends_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )
      const name = user.user_metadata?.full_name || user.email.split('@')[0] || 'there'

      await sendTrialEndingEmail(user.email, name, daysLeft)
      sent++
    } catch (err) {
      errors.push(String(err))
      console.error('[trial-reminder] send error for user', sub.user_id, err)
    }
  }

  console.log(`[trial-reminder] sent ${sent}/${subs.length} reminders`)
  return NextResponse.json({ sent, errors: errors.length > 0 ? errors : undefined })
}
