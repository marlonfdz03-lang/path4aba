import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { activeNotesWhere } from '@/lib/sessionNotes'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  let body: { clientId?: string; periodStart?: string; periodEnd?: string; documentType?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, periodStart, periodEnd, documentType } = body
  if (!clientId || !periodStart || !periodEnd) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
  })
  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [
    client,
    sessionNotes,
    maladaptiveData,
    replacementData,
    missedHours,
    supervisionNotes,
    supervisionNotes97153xp,
    parentTrainingNotes,
    timelineEntries,
  ] = await Promise.all([
    prisma.clients.findUnique({
      where: { id: clientId },
      select: {
        diagnosis: true,
        primary_setting: true,
        authorized_hours_weekly: true,
        clinical_profile: true,
        treatment_map_data: true,
        treatment_map_approved: true,
      },
    }),
    prisma.session_notes.findMany({
      where: { ...activeNotesWhere(clientId), session_date: { gte: periodStart, lte: periodEnd } },  // active only — a replaced note must not feed assessment building
      select: {
        session_date: true,
        note_text: true,
        behaviors_addressed: true,
        skills_addressed: true,
        interventions_used: true,
      },
      orderBy: { session_date: 'asc' },
    }),
    prisma.maladaptive_data.findMany({
      where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
      select: {
        behavior_name: true,
        session_date: true,
        week_start: true,
        frequency: true,
        rate: true,
        duration: true,
        goal_met: true,
      },
      orderBy: { session_date: 'asc' },
    }),
    prisma.replacement_data.findMany({
      where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
      select: {
        replacement_skill: true,
        session_date: true,
        total_trials: true,
        observed_percentage: true,
      },
      orderBy: { session_date: 'asc' },
    }),
    prisma.missed_hours.findMany({
      where: { client_id: clientId, date: { gte: periodStart, lte: periodEnd } },
      select: { date: true, reason: true, hours: true, notes: true },
      orderBy: { date: 'asc' },
    }),
    prisma.supervision_notes.findMany({
      where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
      select: { session_date: true, supervision_type: true, note_text: true },
      orderBy: { session_date: 'asc' },
    }),
    prisma.supervision_notes_97153xp.findMany({
      where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
      select: { session_date: true, note_text: true, rbt_session_context: true },
      orderBy: { session_date: 'asc' },
    }),
    prisma.parent_training_notes.findMany({
      where: { client_id: clientId, session_date: { gte: periodStart, lte: periodEnd } },
      select: { session_date: true, caregiver_name: true, caregiver_relation: true, note_text: true },
      orderBy: { session_date: 'asc' },
    }),
    prisma.clinical_timeline_entries.findMany({
      where: { client_id: clientId, date: { gte: periodStart, lte: periodEnd } },
      select: { date: true, type: true, title: true, summary: true, importance: true, source: true },
      orderBy: { date: 'asc' },
    }),
  ])

  // Weeks in period
  const startMs = new Date(periodStart).getTime()
  const endMs = new Date(periodEnd).getTime()
  const weeksInPeriod = Math.max(1, Math.round((endMs - startMs) / (7 * 24 * 60 * 60 * 1000)))

  // Service utilization
  const authorizedHoursWeekly = client?.authorized_hours_weekly ?? 0
  const authorizedTotal = authorizedHoursWeekly * weeksInPeriod
  const missedTotal = missedHours.reduce((sum, m) => sum + (m.hours ?? 0), 0)
  const deliveredSessions = sessionNotes.length
  const utilizationPct = authorizedTotal > 0
    ? Math.round((deliveredSessions / (authorizedHoursWeekly > 0 ? weeksInPeriod * (authorizedHoursWeekly / 2) : weeksInPeriod)) * 100)
    : null

  // behaviorFirstLast — first and last data point per behavior in period
  const behaviorMap = new Map<string, { first: typeof maladaptiveData[0]; last: typeof maladaptiveData[0]; dataPoints: number }>()
  for (const row of maladaptiveData) {
    const existing = behaviorMap.get(row.behavior_name)
    if (!existing) {
      behaviorMap.set(row.behavior_name, { first: row, last: row, dataPoints: 1 })
    } else {
      existing.last = row
      existing.dataPoints++
    }
  }
  const behaviorFirstLast = Array.from(behaviorMap.entries()).map(([name, { first, last, dataPoints }]) => ({
    behaviorName: name,
    firstDate: first.session_date ?? first.week_start,
    firstValue: first.frequency ?? first.rate ?? first.duration,
    lastDate: last.session_date ?? last.week_start,
    lastValue: last.frequency ?? last.rate ?? last.duration,
    dataPoints,
    goalMet: last.goal_met,
  }))

  // skillFirstLast — first and last data point per skill in period
  const skillMap = new Map<string, { first: typeof replacementData[0]; last: typeof replacementData[0]; dataPoints: number }>()
  for (const row of replacementData) {
    const existing = skillMap.get(row.replacement_skill)
    if (!existing) {
      skillMap.set(row.replacement_skill, { first: row, last: row, dataPoints: 1 })
    } else {
      existing.last = row
      existing.dataPoints++
    }
  }
  const skillFirstLast = Array.from(skillMap.entries()).map(([name, { first, last, dataPoints }]) => ({
    skillName: name,
    firstDate: first.session_date,
    firstPct: first.observed_percentage,
    lastDate: last.session_date,
    lastPct: last.observed_percentage,
    dataPoints,
  }))

  // protocolModifications — from clinical_timeline_entries
  const protocolModifications = timelineEntries
    .filter(e => e.type === 'protocol_change')
    .map(e => ({ date: e.date, title: e.title, summary: e.summary, source: e.source }))

  // clinicalBarriers — missed hours grouped by reason
  const barrierMap = new Map<string, { count: number; totalHours: number }>()
  for (const m of missedHours) {
    const reason = m.reason || 'Unspecified'
    const existing = barrierMap.get(reason) ?? { count: 0, totalHours: 0 }
    existing.count++
    existing.totalHours += m.hours ?? 0
    barrierMap.set(reason, existing)
  }
  const clinicalBarriers = Array.from(barrierMap.entries()).map(([reason, { count, totalHours }]) => ({
    reason,
    count,
    totalHours,
  }))

  // bcbaDocumentation
  const bcbaDocumentation = {
    supervisionNoteCount: supervisionNotes.length,
    supervisionNotes97153xpCount: supervisionNotes97153xp.length,
    parentTrainingNoteCount: parentTrainingNotes.length,
    supervisionNotes: supervisionNotes.map(n => ({
      date: n.session_date,
      type: n.supervision_type,
      noteText: n.note_text,
    })),
    supervisionNotes97153xp: supervisionNotes97153xp.map(n => ({
      date: n.session_date,
      noteText: n.note_text,
      rbtSessionContext: n.rbt_session_context,
    })),
    parentTrainingNotes: parentTrainingNotes.map(n => ({
      date: n.session_date,
      caregiverName: n.caregiver_name,
      caregiverRelation: n.caregiver_relation,
      noteText: n.note_text,
    })),
  }

  // documentsAvailable
  const documentsAvailable = {
    sessionNotes: sessionNotes.length > 0,
    maladaptiveData: maladaptiveData.length > 0,
    replacementData: replacementData.length > 0,
    missedHours: missedHours.length > 0,
    supervisionNotes: supervisionNotes.length > 0,
    supervisionNotes97153xp: supervisionNotes97153xp.length > 0,
    parentTrainingNotes: parentTrainingNotes.length > 0,
    timelineEntries: timelineEntries.length > 0,
  }

  // Data confidence — based on total behavior + skill data points
  const totalDataPoints = maladaptiveData.length + replacementData.length
  const dataConfidence = totalDataPoints >= 16 ? 'high' : totalDataPoints >= 6 ? 'moderate' : 'low'

  // Aggregate behaviors/skills/interventions across all session notes
  const allBehaviorsAddressed = [...new Set(sessionNotes.flatMap(n => n.behaviors_addressed))]
  const allSkillsAddressed = [...new Set(sessionNotes.flatMap(n => n.skills_addressed))]
  const allInterventionsUsed = [...new Set(sessionNotes.flatMap(n => n.interventions_used))]

  return NextResponse.json({
    client: {
      diagnosis: client?.diagnosis ?? null,
      primarySetting: client?.primary_setting ?? null,
      authorizedHoursWeekly: client?.authorized_hours_weekly ?? null,
      clinicalProfile: client?.clinical_profile ?? null,
      treatmentMapData: client?.treatment_map_data ?? null,
      treatmentMapApproved: client?.treatment_map_approved ?? false,
    },
    period: {
      start: periodStart,
      end: periodEnd,
      weeksInPeriod,
      documentType: documentType ?? null,
    },
    serviceUtilization: {
      authorizedHoursWeekly,
      authorizedTotal,
      deliveredSessions,
      missedTotal,
      utilizationPct,
    },
    behaviorFirstLast,
    skillFirstLast,
    protocolModifications,
    clinicalBarriers,
    bcbaDocumentation,
    documentsAvailable,
    dataConfidence,
    sessionNotesSummary: {
      count: sessionNotes.length,
      behaviorsAddressed: allBehaviorsAddressed,
      skillsAddressed: allSkillsAddressed,
      interventionsUsed: allInterventionsUsed,
      notes: sessionNotes.map(n => ({ date: n.session_date, noteText: n.note_text })),
    },
    timelineEntries,
  })
}
