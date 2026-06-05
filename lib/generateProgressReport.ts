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

  const systemPrompt = `You are a licensed BCBA generating a monthly progress report for an ABA therapy client. Write a clinical narrative summary based on the data.

RULES:
- Write 3-5 paragraphs
- Third person — "the client", never names
- Objective ABA language only
- Reference specific trends (improving/stable/worsening)
- Reference Goal Status (On Track, Needs Attention, Mastered)
- Mention frequently used interventions
- If behaviors worsened, acknowledge clinically without attributing cause
- NEVER use mentalistic language
- NEVER include client name, DOB, or any identifier
- NEVER label interventions as effective or ineffective based on trends alone
- End with a forward-looking clinical statement

Output the narrative only. No headers, no bullets.`

  const userPrompt = `Generate a monthly progress report for:
Period: ${periodLabel} (${periodStart} to ${periodEnd})
Diagnosis: ${diagnosis}
Approved interventions: ${approvedInterventions || 'Not specified'}
Sessions documented: ${sessionNotes.length}

--- BEHAVIOR TRENDS ---
${behaviorTrends.length > 0
    ? behaviorTrends.map(b => `${b.name}: ${b.trend} (avg ${b.avgFrequency.toFixed(1)}/week${b.changePercent !== null ? `, ${b.changePercent > 0 ? '+' : ''}${b.changePercent.toFixed(0)}% change` : ''})`).join('\n')
    : 'No behavior data'}

--- SKILL TRENDS ---
${skillTrends.length > 0
    ? skillTrends.map(s => `${s.name}: ${s.trend} (avg ${s.avgPercentage.toFixed(0)}%${s.changePercent !== null ? `, ${s.changePercent > 0 ? '+' : ''}${s.changePercent.toFixed(0)}% change` : ''})`).join('\n')
    : 'No skill data'}

--- GOAL PROGRESS ---
${goalProgress.length > 0
    ? goalProgress.map(g => `${g.targetName} (${g.targetType}): ${g.goalStatus} — baseline ${g.baselineValue} → goal ${g.goalValue}${g.currentValue !== null ? `, current ${g.currentValue}` : ''}${g.percentToGoal !== null ? ` (${g.percentToGoal.toFixed(0)}% to goal)` : ''}`).join('\n')
    : 'No STOs defined'}

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

  return { behaviorTrends, skillTrends, goalProgress, narrative, continuityContext }
}
