import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
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
    where: { id: clientId, rbt_id: userId },
    select: { clinical_profile: true, internal_code: true },
  })
  if (!client) return Response.json({ error: 'Client not found' }, { status: 404 })

  const [maladaptiveData, replacementData, sessionNotes, progressReports] = await Promise.all([
    prisma.maladaptive_data.findMany({
      where: { client_id: clientId, week_start: { gte: periodStart, lte: periodEnd } },
      orderBy: { week_start: 'asc' },
    }),
    prisma.replacement_data.findMany({
      where: { client_id: clientId, week_start: { gte: periodStart, lte: periodEnd } },
      orderBy: { week_start: 'asc' },
    }),
    prisma.session_notes.findMany({
      where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
      select: { interventions_used: true, session_date: true },
    }),
    prisma.progress_reports.findMany({
      where: { client_id: clientId, period_start: { gte: periodStart }, period_end: { lte: periodEnd } },
      select: { period_label: true, narrative: true },
      orderBy: { period_start: 'asc' },
    }),
  ])

  const behaviorSummary = new Map<string, number[]>()
  for (const row of maladaptiveData) {
    if (!behaviorSummary.has(row.behavior_name)) behaviorSummary.set(row.behavior_name, [])
    behaviorSummary.get(row.behavior_name)!.push(row.frequency ?? 0)
  }

  const skillSummary = new Map<string, number[]>()
  for (const row of replacementData) {
    if (!skillSummary.has(row.replacement_skill)) skillSummary.set(row.replacement_skill, [])
    skillSummary.get(row.replacement_skill)!.push(row.observed_percentage ?? 0)
  }

  const behaviorLines = Array.from(behaviorSummary.entries()).map(([name, freqs]) => {
    const first = freqs[0]; const last = freqs[freqs.length - 1]
    const change = first > 0 ? ((last - first) / first * 100).toFixed(0) : 'N/A'
    return `${name}: started at ${first}/wk, ended at ${last}/wk (${change}% change)`
  }).join('\n')

  const skillLines = Array.from(skillSummary.entries()).map(([name, pcts]) => {
    const first = pcts[0]; const last = pcts[pcts.length - 1]
    return `${name}: started at ${first.toFixed(0)}%, ended at ${last.toFixed(0)}%`
  }).join('\n')

  const systemPrompt = `You are a licensed BCBA writing a clinical reassessment period summary. This document will be used as supporting clinical documentation in an ABA reassessment. It must clearly demonstrate why the client continues to require ABA services.

STRUCTURE:
Paragraph 1: Overview of the treatment period — what was targeted, what improved, what remained active
Paragraph 2: Behaviors that continue to require intervention — document ongoing barriers even when improvement occurred
Paragraph 3: Replacement skills and acquisition progress — document what was learned and what still needs teaching
Paragraph 4: Medical necessity statement — why services remain clinically indicated, generalization needs, multiple environments, emerging treatment targets
Paragraph 5: Recommendations for the upcoming reassessment period

MANDATORY LANGUAGE:
- "Continued ABA services remain clinically indicated based on the client's active behavioral profile"
- "The client's service needs are determined by individual clinical need, not age-based criteria"
- "Although [skill/behavior] demonstrated progress, continued intervention is necessary to support maintenance and generalization across environments and communication partners"
- "As the client continues to develop and engage across multiple environments including home, school, and community settings, new socially significant treatment targets have emerged requiring structured ABA support"

RULES:
- Third person, no identifiers
- Objective ABA language only
- 4-5 clinical paragraphs
- Do not suggest reducing services
- Do not reference specific numbers or frequencies
- Output narrative only. No headers, no bullets.`

  const userPrompt = `Write a reassessment period summary for the period ${periodStart} to ${periodEnd}.

Sessions documented: ${sessionNotes.length}
Monthly reports available: ${progressReports.length}

BEHAVIOR DATA:
${behaviorLines || 'No behavior data available'}

REPLACEMENT SKILL DATA:
${skillLines || 'No skill data available'}

${progressReports.length > 0 ? `MONTHLY NARRATIVE SUMMARIES:\n${progressReports.map(r => `${r.period_label}: ${r.narrative?.slice(0, 200)}...`).join('\n\n')}` : ''}

Write the reassessment summary now.`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const aiStream = await openai.chat.completions.create({
          model: 'gpt-4o', temperature: 0.4, max_tokens: 1200, stream: true,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        })
        for await (const chunk of aiStream) {
          const delta = chunk.choices[0]?.delta?.content || ''
          if (delta) controller.enqueue(encoder.encode(delta))
        }
      } catch (err: any) {
        controller.enqueue(encoder.encode(`Error: ${err.message}`))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
