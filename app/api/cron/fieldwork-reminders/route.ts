import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const FROM = 'Path4ABA <hello@path4abaapp.com>'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!)
}

function wrap(content: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;max-width:560px;width:100%;box-shadow:0 1px 4px rgba(0,0,0,0.07);">
<tr><td style="background:#0D2B4E;padding:24px 36px;"><p style="margin:0;font-size:20px;font-weight:700;color:white;">Path<span style="color:#1BA8A0">4</span>ABA</p></td></tr>
<tr><td style="padding:36px 36px 28px;">${content}</td></tr>
<tr><td style="padding:20px 36px;background:#F8FAFC;border-top:1px solid #E2E8F0;">
<p style="margin:0;font-size:12px;color:#94A3B8;">Path4ABA by Marlon FM Services Corp · Sunrise, Florida</p>
</td></tr></table></td></tr></table></body></html>`
}

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = getSupabase()
  const resend = getResend()
  const now = new Date()
  const dayOfMonth = now.getDate()
  const currentMonthYear = now.toISOString().slice(0, 7) // YYYY-MM

  // Last day of the month
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const isLastDay = dayOfMonth === lastDay

  // First day of current month = last day of following month for MVF deadline
  // MVF deadline = last day of month following the fieldwork month
  // e.g., January fieldwork → MVF due last day of February
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthYear = prevMonth.toISOString().slice(0, 7)

  // Fetch all users with bcba_students subscription
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('user_id, bcba_students_status')
    .eq('bcba_students_status', 'active')

  if (!subs?.length) return NextResponse.json({ ok: true, processed: 0 })

  let processed = 0

  for (const sub of subs) {
    const userId = sub.user_id

    // Get user email + name
    const { data: { user } } = await supabase.auth.admin.getUserById(userId)
    if (!user?.email) continue
    const name = user.user_metadata?.full_name || user.email.split('@')[0] || 'there'
    const email = user.email

    // Fetch profile for fieldwork type + total required
    const { data: profile } = await supabase
      .from('fieldwork_profiles')
      .select('fieldwork_type, certification_track')
      .eq('user_id', userId)
      .maybeSingle()

    if (!profile) continue
    const totalRequired = profile.fieldwork_type === 'concentrated' ? 1500 : 2000

    // Fetch current month summary
    const { data: currentSummary } = await supabase
      .from('fieldwork_monthly_summaries')
      .select('total_hours, is_eligible, individual_contacts, group_contacts, client_observations, mvf_signed, supervisor_contacts')
      .eq('user_id', userId)
      .eq('month_year', currentMonthYear)
      .maybeSingle()

    // 1. Day 28 reminder (3 days before month end — approximate)
    if (dayOfMonth === 28) {
      const hoursThisMonth = currentSummary?.total_hours ?? 0
      const pending = []
      if (!currentSummary?.client_observations) pending.push('Client observation not recorded')
      if ((currentSummary?.individual_contacts ?? 0) < 1) pending.push('Individual supervision contact missing')
      if (hoursThisMonth < 20) pending.push(`Only ${hoursThisMonth.toFixed(1)}h logged (minimum 20)`)

      const checklistHtml = pending.length
        ? `<ul style="margin:8px 0 24px;padding-left:20px;color:#475569;font-size:14px;">${pending.map(i => `<li style="margin-bottom:4px;">${i}</li>`).join('')}</ul>`
        : `<p style="color:#16A34A;margin:0 0 24px;font-size:14px;">✅ All compliance items on track!</p>`

      await resend.emails.send({
        from: FROM,
        to: email,
        subject: '3 days left to close your fieldwork month',
        html: wrap(`
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0D2B4E;">3 days left to close your fieldwork month</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;">Hi ${name}, you've logged <strong>${hoursThisMonth.toFixed(1)} hours</strong> this month. Here's what's still pending:</p>
          ${checklistHtml}
          <a href="https://path4aba.app/bcba-students" style="display:inline-block;padding:13px 28px;background:#1BA8A0;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View Dashboard</a>
        `),
      }).catch(err => console.error('[fieldwork-reminders] day-28 email error:', err))
      processed++
    }

    // 2. M-FVF deadline: last day of current month → covers previous month's fieldwork
    if (isLastDay) {
      const { data: prevSummary } = await supabase
        .from('fieldwork_monthly_summaries')
        .select('mvf_signed, total_hours')
        .eq('user_id', userId)
        .eq('month_year', prevMonthYear)
        .maybeSingle()

      if (prevSummary && !prevSummary.mvf_signed && (prevSummary.total_hours ?? 0) > 0) {
        const prevMonthLabel = new Date(prevMonthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        await resend.emails.send({
          from: FROM,
          to: email,
          subject: `Today is the last day to sign your ${prevMonthLabel} M-FVF`,
          html: wrap(`
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0D2B4E;">M-FVF deadline today</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#475569;">Hi ${name}, today is the last day to have your <strong>${prevMonthLabel}</strong> Monthly Fieldwork Verification Form signed. Unsigned forms mean those hours don't count toward your ${profile.certification_track} certification.</p>
            <a href="https://path4aba.app/bcba-students/monthly" style="display:inline-block;padding:13px 28px;background:#DC2626;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Sign M-FVF Now</a>
          `),
        }).catch(err => console.error('[fieldwork-reminders] mvf-deadline email error:', err))
        processed++
      }
    }

    // 3. Milestone emails (25%, 50%, 75%, 100%)
    const { data: allSummaries } = await supabase
      .from('fieldwork_monthly_summaries')
      .select('total_hours')
      .eq('user_id', userId)

    const totalLogged = (allSummaries || []).reduce((sum: number, s: any) => sum + (s.total_hours || 0), 0)
    const pct = (totalLogged / totalRequired) * 100

    for (const milestone of [25, 50, 75, 100]) {
      // Check if we just crossed this milestone today by seeing if yesterday we were below
      const prevTotal = totalLogged - (currentSummary?.total_hours ?? 0)
      const prevPct = (prevTotal / totalRequired) * 100
      if (pct >= milestone && prevPct < milestone) {
        const label = milestone === 100 ? '100% — you\'re done!' : `${milestone}%`
        await resend.emails.send({
          from: FROM,
          to: email,
          subject: `You've reached ${label} of your fieldwork goal!`,
          html: wrap(`
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0D2B4E;">🎉 Fieldwork milestone reached!</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#475569;">You've reached <strong>${label}</strong> — <strong>${totalLogged.toFixed(0)} hours</strong> logged toward your ${profile.certification_track} certification. Keep going!</p>
            <a href="https://path4aba.app/bcba-students" style="display:inline-block;padding:13px 28px;background:#1BA8A0;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View Progress</a>
          `),
        }).catch(err => console.error('[fieldwork-reminders] milestone email error:', err))
        processed++
      }
    }
  }

  return NextResponse.json({ ok: true, processed })
}
