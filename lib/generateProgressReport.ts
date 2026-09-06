import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { activeNotesWhere } from './sessionNotes.ts'
import { redactText } from '@/lib/pdfGeometry'

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
  serviceUtilization?: any
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
  serviceUtilization: any
  behaviorWeeklyTable: any
  skillWeeklyTable: any
  activeTreatmentAreas: any
  clinicalBarriers: string[]
}> {
  const { clientId, periodStart, periodEnd, periodLabel } = input

  const client = await prisma.clients.findUnique({
    where: { id: clientId },
    select: { clinical_profile: true },
  })
  const clinicalProfile = (client?.clinical_profile as any) || {}
  // PHI FIREWALL (progress-report prompt): scrub the CLIENT's own name from client-originated free-text that
  // reaches the prompt — missed-hour reasons and profile-sourced barriers. Client name only, names-only,
  // fail-open if absent. The trend tables / program name-lists are structured. No caregiver named in this report.
  const clientName = String(clinicalProfile?.name || '')
  const scrub = (s: string) => (clientName ? redactText(String(s || ''), [clientName], { namesOnly: true }) : s)

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
    where: { ...activeNotesWhere(clientId), session_date: { gte: periodStart, lte: periodEnd } },  // active only — a replaced note must not skew frequentlyUsedInterventions
    select: { interventions_used: true, behaviors_addressed: true, skills_addressed: true },
  })

  const missedHoursData = await prisma.missed_hours.findMany({
    where: { client_id: clientId, date: { gte: periodStart, lte: periodEnd } },
    select: { hours: true, reason: true },
  })

  const totalMissedHours = missedHoursData.reduce((sum, m) => sum + (m.hours || 0), 0)
  const missedReasons = ([...new Set(missedHoursData.map(m => m.reason).filter(Boolean))] as string[]).map(scrub)

  const authorizedHoursPerWeek = (clinicalProfile as any)?.authorizedHoursPerWeek || 0
  const weeksInPeriod = Math.round(
    (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (7 * 24 * 60 * 60 * 1000)
  )
  const authorizedHoursTotal = authorizedHoursPerWeek * weeksInPeriod
  const deliveredHours = Math.max(0, authorizedHoursTotal - totalMissedHours)
  const attendanceRate = authorizedHoursTotal > 0 ? Math.round((deliveredHours / authorizedHoursTotal) * 100) : null

  const missedReasonCounts = missedHoursData
    .map((m: any) => m.reason)
    .filter(Boolean)
    .reduce((acc: Record<string, number>, r: string) => {
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    }, {})

  const serviceUtilization = {
    authorizedHoursPerWeek,
    authorizedHoursTotal,
    deliveredHours,
    missedHoursTotal: totalMissedHours,
    attendanceRate,
    missedReasons: missedReasonCounts,
    sessionCount: sessionNotes.length,
  }

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

  const behaviorWeeklyTable: Record<string, { baseline: number | null; weeks: (number | null)[]; monthlyAvg: number | null }> = {}
  for (const [name, freqs] of behaviorMap.entries()) {
    const avg = freqs.length > 0 ? freqs.reduce((a, b) => a + b, 0) / freqs.length : null
    behaviorWeeklyTable[name] = {
      baseline: null,
      weeks: [freqs[0] ?? null, freqs[1] ?? null, freqs[2] ?? null, freqs[3] ?? null],
      monthlyAvg: avg !== null ? Math.round(avg * 10) / 10 : null,
    }
  }

  const skillWeeklyTable: Record<string, { baseline: number | null; weeks: (number | null)[]; monthlyAvg: number | null }> = {}
  for (const [name, pcts] of skillMap.entries()) {
    const avg = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null
    skillWeeklyTable[name] = {
      baseline: null,
      weeks: [pcts[0] ?? null, pcts[1] ?? null, pcts[2] ?? null, pcts[3] ?? null],
      monthlyAvg: avg !== null ? Math.round(avg * 10) / 10 : null,
    }
  }

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

  const behaviorsWorked = [...new Set(sessionNotes.flatMap(n => n.behaviors_addressed || []))]
  const skillsWorked = [...new Set(sessionNotes.flatMap(n => n.skills_addressed || []))]

  const activeTreatmentAreas = {
    behaviorReductionTargets: behaviorsWorked,
    replacementPrograms: skillsWorked,
    frequentlyUsedInterventions,
    rbtSessionCount: sessionNotes.length,
    bcbaSessionCount: bcbaSessionCount,
  }

  const clinicalBarriers: string[] = []
  if (totalMissedHours > 0) clinicalBarriers.push('Missed treatment hours during reporting period')
  if (attendanceRate !== null && attendanceRate < 80) clinicalBarriers.push('Reduced treatment exposure may have impacted progress')
  if (missedReasons.length > 0) missedReasons.forEach(r => clinicalBarriers.push(r))
  const profileBarriers = ((clinicalProfile as any)?.commonBarriers || []).map(scrub)
  profileBarriers.forEach((b: string) => { if (!clinicalBarriers.includes(b)) clinicalBarriers.push(b) })

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
"As the client develops and encounters new social, functional, and developmental demands, ongoing ABA intervention remains necessary."

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

  const behaviorTableText = Object.entries(behaviorWeeklyTable).map(([name, data]) => {
    const avg = data.monthlyAvg !== null ? String(data.monthlyAvg) : '—'
    return `${name}: W1 ${data.weeks[0] ?? '—'} | W2 ${data.weeks[1] ?? '—'} | W3 ${data.weeks[2] ?? '—'} | W4 ${data.weeks[3] ?? '—'} | Avg ${avg}`
  }).join('\n') || 'Data unavailable'

  const skillTableText = Object.entries(skillWeeklyTable).map(([name, data]) => {
    const avg = data.monthlyAvg !== null ? `${data.monthlyAvg}%` : '—'
    return `${name}: W1 ${data.weeks[0] !== null ? data.weeks[0] + '%' : '—'} | W2 ${data.weeks[1] !== null ? data.weeks[1] + '%' : '—'} | W3 ${data.weeks[2] !== null ? data.weeks[2] + '%' : '—'} | W4 ${data.weeks[3] !== null ? data.weeks[3] + '%' : '—'} | Avg ${avg}`
  }).join('\n') || 'Data unavailable'

  const userPrompt = `Generate a monthly ABA therapy progress report narrative for:
Period: ${periodLabel} (${periodStart} to ${periodEnd})
RBT Sessions documented: ${sessionNotes.length}
BCBA Sessions documented: ${bcbaSessionCount}
Authorized hours this period: ${authorizedHoursTotal > 0 ? authorizedHoursTotal + ' hrs' : 'Not configured'}
Delivered hours: ${authorizedHoursTotal > 0 ? deliveredHours + ' hrs' : 'N/A'}
Missed hours: ${totalMissedHours > 0 ? totalMissedHours + ' hrs' : 'None recorded'}
Attendance rate: ${attendanceRate !== null ? attendanceRate + '%' : 'N/A'}
Missed hour reasons: ${missedReasons.length > 0 ? missedReasons.join(', ') : 'None'}

--- MALADAPTIVE BEHAVIOR DATA ---
${behaviorTableText}

--- REPLACEMENT SKILL DATA ---
${skillTableText}

--- ACTIVE TREATMENT AREAS ---
Behavior reduction targets worked: ${activeTreatmentAreas.behaviorReductionTargets.join(', ') || 'None documented'}
Replacement programs worked: ${activeTreatmentAreas.replacementPrograms.join(', ') || 'None documented'}
Frequently used interventions: ${frequentlyUsedInterventions.join(', ') || 'None documented'}

--- CLINICAL BARRIERS ---
${clinicalBarriers.length > 0 ? clinicalBarriers.join('\n') : 'No specific barriers documented'}

Write the 4-paragraph narrative now. Follow the structure exactly.`

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
    serviceUtilization,
  }

  return { behaviorTrends, skillTrends, goalProgress, narrative, continuityContext, serviceUtilization, authorizedHours: authorizedHoursTotal, deliveredHours, missedHours: totalMissedHours, attendanceRate, missedReasons, behaviorWeeklyTable, skillWeeklyTable, activeTreatmentAreas, clinicalBarriers }
}
