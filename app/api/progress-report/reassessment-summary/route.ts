import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { activeNotesWhere } from '@/lib/sessionNotes'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { clientId, periodStart, periodEnd } = await req.json()
  if (!clientId || !periodStart || !periodEnd) return Response.json({ error: 'Missing fields' }, { status: 400 })

  const client = await prisma.clients.findFirst({
    where: {
      id: clientId,
      OR: [
        { rbt_id: userId },
        { bcba_clients: { some: { bcba_id: userId } } }
      ]
    },
    select: { clinical_profile: true, internal_code: true },
  })
  if (!client) return Response.json({ error: 'Client not found' }, { status: 404 })

  // Fetch all data in parallel
  const [progressReports, timelineEntries, missedHoursData, sessionNotes, bcbaNotes] = await Promise.all([
    prisma.progress_reports.findMany({
      where: { client_id: clientId, period_start: { gte: periodStart }, period_end: { lte: periodEnd } },
      orderBy: { period_start: 'asc' },
    }),
    prisma.clinical_timeline_entries.findMany({
      where: { client_id: clientId, date: { gte: periodStart, lte: periodEnd } },
      orderBy: { date: 'asc' },
    }),
    prisma.missed_hours.findMany({
      where: { client_id: clientId, date: { gte: periodStart, lte: periodEnd } },
      select: { hours: true, reason: true },
    }),
    prisma.session_notes.findMany({
      where: { ...activeNotesWhere(clientId), session_date: { gte: periodStart, lte: periodEnd } },  // active only — a replaced note must not skew the reassessment summary
      select: { interventions_used: true, behaviors_addressed: true, skills_addressed: true },
    }),
    prisma.supervision_notes.findMany({
      where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
      select: { note_text: true, supervision_type: true },
    }),
  ])

  // Service utilization across all months
  const clinicalProfile = (client.clinical_profile as any) || {}
  const authorizedHoursPerWeek = clinicalProfile?.authorizedHoursPerWeek || 0
  const totalMissedHours = missedHoursData.reduce((sum, m) => sum + (m.hours || 0), 0)
  const missedReasons = [...new Set(missedHoursData.map(m => m.reason).filter(Boolean))] as string[]

  // Calculate months in period
  const startDate = new Date(periodStart)
  const endDate = new Date(periodEnd)
  const weeksInPeriod = Math.round((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
  const authorizedHoursTotal = authorizedHoursPerWeek * weeksInPeriod
  const deliveredHours = Math.max(0, authorizedHoursTotal - totalMissedHours)
  const attendanceRate = authorizedHoursTotal > 0 ? Math.round((deliveredHours / authorizedHoursTotal) * 100) : null

  // Behavior trends across monthly reports
  const behaviorFirstLast: Record<string, { first: number; last: number; months: number[] }> = {}
  for (const report of progressReports) {
    const trends = (report.behavior_trends as any[]) || []
    for (const t of trends) {
      if (!behaviorFirstLast[t.name]) behaviorFirstLast[t.name] = { first: t.avgFrequency, last: t.avgFrequency, months: [] }
      behaviorFirstLast[t.name].last = t.avgFrequency
      behaviorFirstLast[t.name].months.push(t.avgFrequency)
    }
  }

  // Skill trends across monthly reports
  const skillFirstLast: Record<string, { first: number; last: number; months: number[] }> = {}
  for (const report of progressReports) {
    const trends = (report.skill_trends as any[]) || []
    for (const t of trends) {
      if (!skillFirstLast[t.name]) skillFirstLast[t.name] = { first: t.avgPercentage, last: t.avgPercentage, months: [] }
      skillFirstLast[t.name].last = t.avgPercentage
      skillFirstLast[t.name].months.push(t.avgPercentage)
    }
  }

  // Clinical barriers from all monthly reports
  const allBarriers = new Set<string>()
  for (const report of progressReports) {
    const ctx = (report.continuity_context as any) || {}
    if (ctx.clinicalBarriers) ctx.clinicalBarriers.forEach((b: string) => allBarriers.add(b))
  }
  if (missedReasons.length > 0) missedReasons.forEach(r => allBarriers.add(r))

  // Active treatment areas from session notes
  const behaviorsWorked = [...new Set(sessionNotes.flatMap(n => n.behaviors_addressed || []))]
  const skillsWorked = [...new Set(sessionNotes.flatMap(n => n.skills_addressed || []))]
  const interventionCount = new Map<string, number>()
  for (const note of sessionNotes) {
    for (const i of (note.interventions_used || [])) {
      interventionCount.set(i, (interventionCount.get(i) || 0) + 1)
    }
  }
  const topInterventions = Array.from(interventionCount.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name)

  // Build behavior summary table text
  const behaviorSummaryText = Object.entries(behaviorFirstLast).map(([name, data]) => {
    const change = data.first > 0 ? ((data.last - data.first) / data.first * 100).toFixed(0) : 'N/A'
    const direction = data.last < data.first ? '↓' : data.last > data.first ? '↑' : '→'
    return `${name}: Initial avg ${data.first.toFixed(1)} → Current avg ${data.last.toFixed(1)} (${direction}${Math.abs(Number(change))}%)`
  }).join('\n') || 'No behavior data available'

  const skillSummaryText = Object.entries(skillFirstLast).map(([name, data]) => {
    const change = data.first > 0 ? ((data.last - data.first) / data.first * 100).toFixed(0) : 'N/A'
    const direction = data.last > data.first ? '↑' : data.last < data.first ? '↓' : '→'
    return `${name}: Initial avg ${data.first.toFixed(0)}% → Current avg ${data.last.toFixed(0)}% (${direction}${Math.abs(Number(change))}%)`
  }).join('\n') || 'No skill data available'

  const systemPrompt = `You are a licensed BCBA writing a clinical reassessment period summary. This document will be used as supporting clinical documentation in an ABA reassessment and must clearly demonstrate why the client continues to require ABA services.

STRUCTURE — write exactly 6 paragraphs:

Paragraph 1 — TREATMENT PERIOD OVERVIEW:
Summarize the assessment period. Reference how many months of service were provided, the general attendance pattern, and what treatment areas were active. Do not list specific numbers — describe them qualitatively.

Paragraph 2 — BEHAVIOR REDUCTION PROGRESS:
Document observed changes in maladaptive behaviors across the period. Connect any reductions to consistent ABA intervention. Even improving behaviors must be framed as ongoing targets. Use: "Although [behavior] demonstrated reduction, continued intervention remains necessary to support maintenance and generalization."

Paragraph 3 — REPLACEMENT SKILL ACQUISITION:
Document skill acquisition progress. Connect gains to structured ABA teaching procedures. Even high-performing skills must be framed as requiring continued support for generalization. Use: "Skills that demonstrated progress continue to require structured support to generalize across environments and communication partners."

Paragraph 4 — CLINICAL BARRIERS AND TREATMENT FACTORS:
Document barriers that impacted treatment. Reference missed hours, attendance inconsistencies, generalization challenges, and environmental factors. Connect barriers to ongoing need.

Paragraph 5 — MEDICAL NECESSITY AND SERVICE JUSTIFICATION:
This is the most critical paragraph. Must include:
"Continued ABA services at the current authorized intensity remain clinically indicated."
"Service needs are determined by the client's individual behavioral profile and treatment needs, not age-based criteria alone."
Reference that active targets remain present, generalization is ongoing, and BCBA oversight continues to be necessary.

Paragraph 6 — CONTINUED TREATMENT NEEDS:
Summarize ongoing needs. Reference all active treatment areas. Do not suggest reducing services. End with: "All active behavior-reduction and skill-acquisition targets remain part of the treatment plan unless modified or discontinued by the supervising BCBA."

RULES:
- Third person only — "the client"
- No names, DOB, insurance ID, diagnosis
- No specific frequencies or percentages in the narrative
- No mentalistic language
- Never suggest reducing services
- Never say behaviors are resolved
- Output narrative only. No headers, no bullets.`

  const userPrompt = `Write a reassessment period summary for ${periodStart} to ${periodEnd}.

Monthly reports available: ${progressReports.length}
Timeline events: ${timelineEntries.length}
RBT sessions documented: ${sessionNotes.length}
BCBA sessions documented: ${bcbaNotes.length}
Authorized hours: ${authorizedHoursTotal > 0 ? authorizedHoursTotal + ' hrs total' : 'Not configured'}
Delivered hours: ${deliveredHours > 0 ? deliveredHours + ' hrs' : 'N/A'}
Total missed hours: ${totalMissedHours > 0 ? totalMissedHours + ' hrs' : 'None recorded'}
Attendance rate: ${attendanceRate !== null ? attendanceRate + '%' : 'N/A'}

BEHAVIOR TRENDS ACROSS PERIOD:
${behaviorSummaryText}

REPLACEMENT SKILL TRENDS ACROSS PERIOD:
${skillSummaryText}

ACTIVE TREATMENT AREAS:
Behaviors worked: ${behaviorsWorked.join(', ') || 'None documented'}
Skills worked: ${skillsWorked.join(', ') || 'None documented'}
Top interventions: ${topInterventions.join(', ') || 'None documented'}

CLINICAL BARRIERS:
${[...allBarriers].join('\n') || 'None documented'}

TIMELINE EVENTS:
${timelineEntries.map(e => `${e.date}: ${e.title}`).join('\n') || 'None'}

Write the 6-paragraph reassessment narrative now.`

  // Save structured data for timeline
  const reassessmentData = {
    periodStart,
    periodEnd,
    monthsReviewed: progressReports.length,
    authorizedHoursTotal,
    deliveredHours,
    totalMissedHours,
    attendanceRate,
    behaviorSummary: behaviorFirstLast,
    skillSummary: skillFirstLast,
    clinicalBarriers: [...allBarriers],
    activeTreatmentAreas: { behaviorsWorked, skillsWorked, topInterventions },
    bcbaDocumentation: bcbaNotes.length > 0,
  }

  const encoder = new TextEncoder()
  let fullNarrative = ''

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const aiStream = await openai.chat.completions.create({
          model: 'gpt-4o', temperature: 0.4, max_tokens: 1800, stream: true,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        })
        for await (const chunk of aiStream) {
          const delta = chunk.choices[0]?.delta?.content || ''
          if (delta) {
            fullNarrative += delta
            controller.enqueue(encoder.encode(delta))
          }
        }

        // Save timeline entry
        try {
          const periodLabel = `${new Date(periodStart).toLocaleString('en-US', { month: 'long', year: 'numeric' })} – ${new Date(periodEnd).toLocaleString('en-US', { month: 'long', year: 'numeric' })}`
          await prisma.clinical_timeline_entries.upsert({
            where: { client_id_type_title: {
              client_id: clientId,
              type: 'reassessment_summary',
              title: `Reassessment Summary — ${periodLabel}`
            }},
            update: {
              date: periodEnd,
              summary: fullNarrative.split(/(?<=[.!?])\s+/).slice(0, 1).join(' '),
              metadata: reassessmentData,
              importance: 'high',
              source: 'auto',
            },
            create: {
              client_id: clientId,
              date: periodEnd,
              type: 'reassessment_summary',
              title: `Reassessment Summary — ${periodLabel}`,
              summary: fullNarrative.split(/(?<=[.!?])\s+/).slice(0, 1).join(' '),
              metadata: reassessmentData,
              importance: 'high',
              source: 'auto',
              created_by: userId,
            }
          })
        } catch (tlErr) {
          console.error('[reassessment timeline]', tlErr)
        }

        // Send structured data
        controller.enqueue(encoder.encode(
          `\n__REASSESS_META__${JSON.stringify(reassessmentData)}`
        ))
      } catch (err: any) {
        controller.enqueue(encoder.encode(`Error: ${err.message}`))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
