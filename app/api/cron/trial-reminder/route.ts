import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
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

  let subs: { user_id: string; trial_ends_at: Date | null }[]
  try {
    subs = await prisma.subscriptions.findMany({
      where: {
        status: 'trialing',
        trial_ends_at: { gte: windowStart, lte: windowEnd },
      },
      select: { user_id: true, trial_ends_at: true },
    })
  } catch (err) {
    console.error('[trial-reminder] DB error:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (!subs.length) {
    return NextResponse.json({ sent: 0 })
  }

  let sent = 0
  const errors: string[] = []

  for (const sub of subs) {
    try {
      const user = await prisma.users.findUnique({
        where: { id: sub.user_id },
        select: { email: true, name: true },
      })
      if (!user?.email) continue

      const daysLeft = Math.ceil(
        (new Date(sub.trial_ends_at!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )
      const name = user.name || user.email.split('@')[0] || 'there'

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
