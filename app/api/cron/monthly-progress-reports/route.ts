import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateProgressReport } from '@/lib/generateProgressReport'
import { sendProgressReportReadyEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1)
  const periodLabel = periodEnd.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const periodStartStr = periodStart.toISOString().split('T')[0]
  const periodEndStr = periodEnd.toISOString().split('T')[0]

  const clients = await prisma.clients.findMany({
    where: { rbt_id: { not: null } },
    select: {
      id: true,
      internal_code: true,
      rbt_id: true,
    },
  })

  let generated = 0
  let errors = 0

  for (const client of clients) {
    try {
      const existing = await prisma.progress_reports.findFirst({
        where: { client_id: client.id, period_start: periodStartStr, period_end: periodEndStr },
      })
      if (existing) continue

      const connection = await prisma.bcba_clients.findFirst({
        where: { client_id: client.id },
        select: { bcba_id: true },
      })

      const result = await generateProgressReport({
        clientId: client.id,
        rbtId: client.rbt_id!,
        bcbaId: connection?.bcba_id || undefined,
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
        periodLabel,
      })

      await prisma.progress_reports.create({
        data: {
          client_id: client.id,
          rbt_id: client.rbt_id!,
          period_start: periodStartStr,
          period_end: periodEndStr,
          period_label: periodLabel,
          behavior_trends: result.behaviorTrends as any,
          skill_trends: result.skillTrends as any,
          goal_progress: result.goalProgress as any,
          narrative: result.narrative,
          continuity_context: result.continuityContext as any,
        },
      })

      const existingProfile = (await prisma.clients.findUnique({
        where: { id: client.id },
        select: { clinical_profile: true },
      }))?.clinical_profile as any || {}

      await prisma.clients.update({
        where: { id: client.id },
        data: { clinical_profile: { ...existingProfile, continuityContext: result.continuityContext } },
      })

      const rbt = await prisma.users.findUnique({ where: { id: client.rbt_id! }, select: { email: true } })
      if (rbt?.email && typeof rbt.email === 'string') {
        await sendProgressReportReadyEmail(rbt.email, client.internal_code ?? 'Client', periodLabel, 'rbt')
      }

      if (connection?.bcba_id) {
        const bcba = await prisma.users.findUnique({ where: { id: connection.bcba_id }, select: { email: true } })
        if (bcba?.email && typeof bcba.email === 'string') {
          await sendProgressReportReadyEmail(bcba.email, client.internal_code ?? 'Client', periodLabel, 'bcba')
        }
      }

      generated++
    } catch (err) {
      console.error(`[monthly-progress-reports] Error for client ${client.id}:`, err)
      errors++
    }
  }

  return NextResponse.json({ generated, errors, period: periodLabel })
}
