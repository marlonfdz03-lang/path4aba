import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export interface ProgressReportInput {
  clientId: string
  rbtId: string
  bcbaId?: string
  periodStart: string
  periodEnd: string
  periodLabel: string
}

export interface BehaviorTrend {
  name: string
  weeklyFrequencies: number[]
  trend: 'improving' | 'stable' | 'worsening' | 'insufficient_data'
  avgFrequency: number
  changePercent: number | null
}

export interface SkillTrend {
  name: string
  weeklyPercentages: number[]
  trend: 'improving' | 'stable' | 'worsening' | 'insufficient_data'
  avgPercentage: number
  changePercent: number | null
}

export interface GoalProgress {
  targetName: string
  targetType: string
  baselineValue: number
  goalValue: number
  currentValue: number | null
  status: string
  goalStatus: 'On Track' | 'Needs Attention' | 'Mastered' | 'Insufficient Data'
  percentToGoal: number | null
}

export interface ContinuityContext {
  version: number
  generatedAt: string
  periodLabel: string
  behaviorTrends: Record<string, 'improving' | 'stable' | 'worsening' | 'insufficient_data'>
  skillTrends: Record<string, 'improving' | 'stable' | 'worsening' | 'insufficient_data'>
  frequentlyUsedInterventions: string[]
  summary: string
}

function calculateBehaviorTrend(values: number[]): {
  trend: 'improving' | 'stable' | 'worsening' | 'insufficient_data'
  changePercent: number | null
} {
  if (values.length < 2) return { trend: 'insufficient_data', changePercent: null }
  const first = values[0]
  const last = values[values.length - 1]
  const changePercent = first === 0 ? null : ((last - first) / first) * 100
  if (changePercent === null) return { trend: last === 0 ? 'improving' : 'stable', changePercent: null }
  if (Math.abs(changePercent) < 10) return { trend: 'stable', changePercent }
  return { trend: changePercent < 0 ? 'improving' : 'worsening', changePercent }
}

function calculateSkillTrend(values: number[]): {
  trend: 'improving' | 'stable' | 'worsening' | 'insufficient_data'
  changePercent: number | null
} {
  if (values.length < 2) return { trend: 'insufficient_data', changePercent: null }
  const first = values[0]
  const last = values[values.length - 1]
  const changePercent = first === 0 ? null : ((last - first) / first) * 100
  if (changePercent === null) return { trend: last > 0 ? 'improving' : 'stable', changePercent: null }
  if (Math.abs(changePercent) < 10) return { trend: 'stable', changePercent }
  return { trend: changePercent > 0 ? 'improving' : 'worsening', changePercent }
}

function calculatePercentToGoal(
  targetType: string,
  baselineValue: number,
  goalValue: number,
  currentValue: number
): number | null {
  const range = Math.abs(goalValue - baselineValue)
  if (range === 0) return null

  if (targetType === 'replacement_skill') {
    const progress = currentValue - baselineValue
    return Math.min(100, Math.max(0, (progress / range) * 100))
  } else {
    const totalReduction = baselineValue - goalValue
    if (totalReduction <= 0) return null
    const achieved = baselineValue - currentValue
    return Math.min(100, Math.max(0, (achieved / totalReduction) * 100))
  }
}

function deriveGoalStatus(
  trend: 'improving' | 'stable' | 'worsening' | 'insufficient_data',
  percentToGoal: number | null,
  stoStatus: string,
  dataPointCount: number
): 'On Track' | 'Needs Attention' | 'Mastered' | 'Insufficient Data' {
  if (stoStatus === 'mastered') return 'Mastered'
  if (dataPointCount < 2) return 'Insufficient Data'
  if (trend === 'worsening') return 'Needs Attention'
  if (percentToGoal !== null && percentToGoal < 25) return 'Needs Attention'
  if (trend === 'improving' || (percentToGoal !== null && percentToGoal >= 50)) return 'On Track'
  return 'Needs Attention'
}

export async function generateProgressReport(
  input: ProgressReportInput,
  onChunk?: (text: string) => void
): Promise<{
  behaviorTrends: BehaviorTrend[]
  skillTrends: SkillTrend[]
  goalProgress: GoalProgress[]
  narrative: string
  continuityContext: ContinuityContext
  authorizedHours: number
  deliveredHours: number
  missedHours: number
  attendanceRate: number | null
  missedReasons: string[]
}> {
  const { clientId, periodStart, periodEnd, periodLabel } = input

  const client = await prisma.clients.findUnique({
    where: { id: clientId },
    select: { clinical_profile: true },
  })
  const clinicalProfile = (client?.clinical_profile as any) || {}

  const maladaptiveData = await prisma.maladaptive_data.findMany({
    where: { client_id: clientId, week_start: { gte: periodStart, lte: periodEnd } },
    orderBy: { week_start: 'asc' },
  })

  const replacementData = await prisma.replacement_data.findMany({
    where: { client_id: clientId, week_start: { gte: periodStart, lte: periodEnd } },
    orderBy: { week_start: 'asc' },
  })

  const stos = await prisma.stos.findMany({
    where: { client_id: clientId },
    orderBy: { created_at: 'asc' },
  })

  const sessionNotes = await prisma.session_notes.findMany({
    where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
    select: { interventions_used: true },
  })

  const missedHoursData = await prisma.missed_hours.findMany({
    where: { client_id: clientId, date: { gte: periodStart, lte: periodEnd } },
    select: { hours: true, reason: true },
  })

  const totalMissedHours = missedHoursData.reduce((sum, m) => sum + (m.hours || 0), 0)
  const missedReasons = [...new Set(missedHoursData.map(m => m.reason).filter(Boolean))] as string[]

  const clientHours = await prisma.clients.findUnique({
    where: { id: clientId },
    select: { authorized_hours_weekly: true },
  })
  const daysInPeriod = Math.floor((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (24 * 60 * 60 * 1000)) + 1
  const weeksInPeriod = daysInPeriod / 7
  const authorizedHours = (clientHours?.authorized_hours_weekly || 0) * weeksInPeriod
  const deliveredHours = Math.max(0, authorizedHours - totalMissedHours)
  const attendanceRate = authorizedHours > 0 ? Math.round((deliveredHours / authorizedHours) * 100) : null

  let bcbaSessionCount = 0
  if (input.bcbaId) {
    const [xpNotes, supervisionNotes] = await Promise.all([
      prisma.supervision_notes_97153xp.findMany({
        where: { client_id: clientId, bcba_id: input.bcbaId, session_date: { gte: periodStart, lte: periodEnd } },
        select: { note_text: true },
      }),
      prisma.supervision_notes.findMany({
        where: { client_id: clientId, bcba_id: input.bcbaId, session_date: { gte: periodStart, lte: periodEnd } },
        select: { note_text: true },
      }),
    ])
    bcbaSessionCount = xpNotes.length + supervisionNotes.length
  }

  const behaviorMap = new Map<string, number[]>()
  for (const row of maladaptiveData) {
    if (!behaviorMap.has(row.behavior_name)) behaviorMap.set(row.behavior_name, [])
    behaviorMap.get(row.behavior_name)!.push(row.frequency ?? 0)
  }
  const behaviorTrends: BehaviorTrend[] = Array.from(behaviorMap.entries()).map(([name, freqs]) => {
    const { trend, changePercent } = calculateBehaviorTrend(freqs)
    return { name, weeklyFrequencies: freqs, trend, avgFrequency: freqs.reduce((a, b) => a + b, 0) / freqs.length, changePercent }
  })

  const skillMap = new Map<string, number[]>()
  for (const row of replacementData) {
    if (!skillMap.has(row.replacement_skill)) skillMap.set(row.replacement_skill, [])
    skillMap.get(row.replacement_skill)!.push(row.observed_percentage ?? 0)
  }
  const skillTrends: SkillTrend[] = Array.from(skillMap.entries()).map(([name, pcts]) => {
    const { trend, changePercent } = calculateSkillTrend(pcts)
    return { name, weeklyPercentages: pcts, trend, avgPercentage: pcts.reduce((a, b) => a + b, 0) / pcts.length, changePercent }
  })

  const latestSkillData = new Map<string, number>()
  for (const row of replacementData) latestSkillData.set(row.replacement_skill, row.observed_percentage ?? 0)
  const latestBehaviorData = new Map<string, number>()
  for (const row of maladaptiveData) latestBehaviorData.set(row.behavior_name, row.frequency ?? 0)

  const goalProgress: GoalProgress[] = stos.map(sto => {
    const currentValue = sto.target_type === 'replacement_skill'
      ? (latestSkillData.get(sto.target_name) ?? null)
      : (latestBehaviorData.get(sto.target_name) ?? null)

    const percentToGoal = currentValue !== null
      ? calculatePercentToGoal(sto.target_type, sto.baseline_value, sto.goal_value, currentValue)
      : null

    const trendData = sto.target_type === 'replacement_skill'
      ? skillTrends.find(s => s.name === sto.target_name)
      : behaviorTrends.find(b => b.name === sto.target_name)

    const dataPointCount = (trendData as any)?.weeklyFrequencies?.length
      ?? (trendData as any)?.weeklyPercentages?.length
      ?? (currentValue !== null ? 1 : 0)

    const goalStatus = deriveGoalStatus(
      trendData?.trend ?? 'insufficient_data',
      percentToGoal,
      sto.status,
      dataPointCount
    )

    return {
      targetName: sto.target_name,
      targetType: sto.target_type,
      baselineValue: sto.baseline_value,
      goalValue: sto.goal_value,
      currentValue,
      status: sto.status,
      goalStatus,
      percentToGoal,
    }
  })

  const interventionCount = new Map<string, number>()
  for (const note of sessionNotes) {
    for (const i of (note.interventions_used || [])) {
      interventionCount.set(i, (interventionCount.get(i) || 0) + 1)
    }
  }
  const frequentlyUsedInterventions = Array.from(interventionCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name)

  const diagnosis = (clinicalProfile.diagnosis || []).join(', ') || 'Not specified'
  const approvedInterventions = (clinicalProfile.interventions || [])
    .map((i: any) => typeof i === 'string' ? i : i?.name || '').filter(Boolean).join(', ')

  const systemPrompt = `You are a licensed BCBA generating a monthly ABA therapy progress report. This report serves as clinical documentation of treatment response and medical necessity. Write a narrative that clearly answers: WHY does this client still need ABA services?

═══ PARAGRAPH STRUCTURE ═══
Paragraph 1 — CLINICAL GAINS:
Document what improved this month. Connect every gain to ABA intervention. Use language like "consistent implementation of [intervention] supported emerging [skill/behavior control]". Never say "the client improved" without explaining why.

Paragraph 2 — ONGOING BARRIERS:
Document what behaviors continue to occur and what skills remain in acquisition. Even improving behaviors must be documented as ongoing targets. Use language like "Although [behavior] demonstrated reduced frequency, it continues to occur during [context] and requires continued structured intervention to support maintenance and generalization."

Paragraph 3 — GENERALIZATION & MEDICAL NECESSITY:
This is the most important paragraph for insurance. Document:
- The client's need for intervention across multiple environments (home, school, community)
- The involvement of multiple caregivers requiring consistent implementation
- New socially significant behaviors emerging as the client develops
- Why service intensity cannot be reduced based on age alone — must be based on individual clinical need
- Use: "Continued ABA services at the current authorized intensity remain clinically indicated based on the client's active behavioral profile and ongoing acquisition needs."

Paragraph 4 — CONTINUED TREATMENT NEEDS:
Summarize the active behavior-reduction and skill-acquisition areas that require continued intervention. Do not label only some targets as priorities — all active treatment targets remain part of the treatment plan unless discontinued by the BCBA. Emphasize that continued structured intervention is necessary across all active programs.

═══ MEDICAL NECESSITY LANGUAGE — MANDATORY ═══
Every report must contain at least one sentence from each of these:

SERVICE JUSTIFICATION:
"Continued ABA services at the current authorized intensity remain clinically indicated."
"Service needs are determined by individual behavioral profile, not age-based criteria."

GENERALIZATION RATIONALE:
"The client continues to require structured support to generalize acquired skills across environments and communication partners."
"As the client develops and encounters new social, academic, and functional demands, ongoing ABA intervention remains necessary."

ONGOING NEED DESPITE PROGRESS:
"Although [behavior/skill] demonstrated [improvement], continued intervention is necessary to support maintenance, generalization, and the emergence of new treatment targets."

═══ RULES ═══
- Third person only — "the client" — never names or identifiers
- Objective ABA language — no mentalistic language
- NEVER say "the client is doing well" without connecting to continued need
- NEVER imply services could be reduced
- NEVER say a behavior is resolved — use "emerging behavioral control with consistent intervention"
- NEVER use: refused, wanted, felt, enjoyed, frustrated, upset, happy
- Do not reference specific frequencies or percentages — use qualitative language
- Output the narrative only. No headers, no bullets. Flowing clinical paragraphs.`

  const userPrompt = `Generate a monthly progress report for:
Period: ${periodLabel} (${periodStart} to ${periodEnd})
Diagnosis: ${diagnosis}
Approved interventions: ${approvedInterventions || 'Not specified'}
Sessions documented by RBT: ${sessionNotes.length}${bcbaSessionCount ? `\nSessions documented by BCBA: ${bcbaSessionCount}` : ''}
Authorized hours this period: ${authorizedHours > 0 ? authorizedHours + ' hrs' : 'Not configured'}
Delivered hours: ${authorizedHours > 0 ? deliveredHours + ' hrs' : 'N/A'}
Missed hours: ${totalMissedHours > 0 ? totalMissedHours + ' hrs' : 'None recorded'}
Attendance rate: ${attendanceRate !== null ? attendanceRate + '%' : 'N/A'}
Missed hour reasons: ${missedReasons.length > 0 ? missedReasons.join(', ') : 'None'}

--- BEHAVIOR TRENDS ---
${behaviorTrends.length > 0
    ? behaviorTrends.map(b => `${b.name}: ${b.trend} (avg ${b.avgFrequency.toFixed(1)}/week${b.changePercent !== null ? `, ${b.changePercent > 0 ? '+' : ''}${b.changePercent.toFixed(0)}% change` : ''})`).join('\n')
    : 'No behavior data'}

--- SKILL TRENDS ---
${skillTrends.length > 0
    ? skillTrends.map(s => `${s.name}: ${s.trend} (avg ${s.avgPercentage.toFixed(0)}%${s.changePercent !== null ? `, ${s.changePercent > 0 ? '+' : ''}${s.changePercent.toFixed(0)}% change` : ''})`).join('\n')
    : 'No skill data'}

--- FREQUENTLY USED INTERVENTIONS ---
${frequentlyUsedInterventions.join(', ') || 'No session data'}

Write the narrative now.`

  let narrative = ''
  if (onChunk) {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o', temperature: 0.4, max_tokens: 1000, stream: true,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    })
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) { narrative += delta; onChunk(delta) }
    }
  } else {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o', temperature: 0.4, max_tokens: 1000,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    })
    narrative = resp.choices[0].message.content || ''
  }

  const behaviorTrendMap: Record<string, any> = {}
  for (const b of behaviorTrends) behaviorTrendMap[b.name] = b.trend
  const skillTrendMap: Record<string, any> = {}
  for (const s of skillTrends) skillTrendMap[s.name] = s.trend

  const sentences = narrative.split(/(?<=[.!?])\s+/)
  const summary = sentences.slice(0, 2).join(' ')

  const continuityContext: ContinuityContext = {
    version: 1,
    generatedAt: new Date().toISOString().split('T')[0],
    periodLabel,
    behaviorTrends: behaviorTrendMap,
    skillTrends: skillTrendMap,
    frequentlyUsedInterventions,
    summary,
  }

  return { behaviorTrends, skillTrends, goalProgress, narrative, continuityContext, authorizedHours, deliveredHours, missedHours: totalMissedHours, attendanceRate, missedReasons }
}
