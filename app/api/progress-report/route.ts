import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { generateProgressReport } from '@/lib/generateProgressReport'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { clientId, periodStart, periodEnd, periodLabel } = await req.json()
  if (!clientId || !periodStart || !periodEnd || !periodLabel) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const client = await prisma.clients.findFirst({
    where: { id: clientId, rbt_id: userId },
  })
  if (!client) return Response.json({ error: 'Client not found' }, { status: 404 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await generateProgressReport(
          { clientId, rbtId: userId, periodStart, periodEnd, periodLabel },
          (chunk) => { controller.enqueue(encoder.encode(chunk)) }
        )

        await prisma.progress_reports.create({
          data: {
            client_id: clientId,
            rbt_id: userId,
            period_start: periodStart,
            period_end: periodEnd,
            period_label: periodLabel,
            behavior_trends: result.behaviorTrends as any,
            skill_trends: result.skillTrends as any,
            goal_progress: result.goalProgress as any,
            narrative: result.narrative,
            continuity_context: result.continuityContext as any,
          },
        })

        const existingProfile = (client.clinical_profile as any) || {}
        await prisma.clients.update({
          where: { id: clientId },
          data: {
            clinical_profile: {
              ...existingProfile,
              continuityContext: result.continuityContext,
            },
          },
        })

        controller.enqueue(encoder.encode(
          `\n__META__${JSON.stringify({
            saved: true,
            behaviorTrends: result.behaviorTrends,
            skillTrends: result.skillTrends,
            goalProgress: result.goalProgress,
            continuityContext: result.continuityContext,
          })}`
        ))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed'
        controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ error: msg })}`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  const latest = searchParams.get('latest') === 'true'
  if (!clientId) return Response.json({ error: 'Missing clientId' }, { status: 400 })

  if (latest) {
    const report = await prisma.progress_reports.findFirst({
      where: { client_id: clientId, rbt_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, period_label: true, period_start: true, period_end: true,
        narrative: true, behavior_trends: true, skill_trends: true,
        goal_progress: true, continuity_context: true, created_at: true,
      },
    })
    return Response.json({ report: report ?? null })
  }

  const reports = await prisma.progress_reports.findMany({
    where: { client_id: clientId, rbt_id: userId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true, period_label: true, period_start: true, period_end: true,
      narrative: true, behavior_trends: true, skill_trends: true,
      goal_progress: true, continuity_context: true, created_at: true,
    },
  })

  return Response.json({ reports })
}
