import { prisma } from '@/lib/prisma'
import {
  recalculateMonthSummary,
  adjustHoursForSupervisedFieldwork,
  checkMonthEligibility,
  type Session,
  type FieldworkType,
  type CertificationTrack,
} from './calculations'

export async function recalculateMonth(userId: string, monthYear: string): Promise<void> {
  const sessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, month_year: monthYear },
    select: { id: true, session_date: true, independent_hours: true, supervised_hours: true, total_hours: true, activity_type: true, contact_type: true },
  })

  console.log(`[recalculate-month] user=${userId} month=${monthYear} found ${sessions.length} sessions:`, JSON.stringify(sessions.map(s => ({ id: s.id, indep: s.independent_hours, sup: s.supervised_hours, total: s.total_hours }))))

  const profile = await prisma.fieldwork_profiles.findUnique({
    where: { user_id: userId },
    select: { fieldwork_type: true, certification_track: true },
  })

  const fieldworkType: FieldworkType = (profile?.fieldwork_type as FieldworkType) || 'supervised'
  const certificationTrack: CertificationTrack = profile?.certification_track === 'BCaBA' ? 'BCaBA' : 'BCBA'

  const existing = await prisma.fieldwork_monthly_summaries.findFirst({
    where: { user_id: userId, month_year: monthYear },
    select: { mvf_signed: true, mvf_signed_at: true },
  })

  let summary = recalculateMonthSummary(sessions as Session[])

  if (fieldworkType === 'supervised') {
    summary = adjustHoursForSupervisedFieldwork(summary, certificationTrack)
  }

  const { eligible, reason } = checkMonthEligibility(summary, fieldworkType, existing?.mvf_signed ?? false, certificationTrack)

  const summaryData = {
    total_independent_hours: summary.total_independent_hours,
    total_supervised_hours: summary.total_supervised_hours,
    total_hours: summary.total_hours,
    supervision_pct: summary.supervision_pct,
    unrestricted_hours: summary.unrestricted_hours,
    restricted_hours: summary.restricted_hours,
    supervisor_contacts: summary.supervisor_contacts,
    individual_contacts: summary.individual_contacts,
    group_contacts: summary.group_contacts,
    client_observations: summary.client_observations,
    is_eligible: eligible,
    ineligibility_reason: reason ?? null,
    mvf_signed: existing?.mvf_signed ?? false,
    mvf_signed_at: existing?.mvf_signed_at ?? null,
  }

  console.log(`[recalculate-month] upserting summary for month=${monthYear}: total_hours=${summaryData.total_hours} indep=${summaryData.total_independent_hours} sup=${summaryData.total_supervised_hours} eligible=${summaryData.is_eligible}`)

  try {
    await prisma.fieldwork_monthly_summaries.upsert({
      where: { user_id_month_year: { user_id: userId, month_year: monthYear } },
      create: { user_id: userId, month_year: monthYear, ...summaryData },
      update: summaryData,
    })
    console.log(`[recalculate-month] upsert OK for month=${monthYear}`)
  } catch (upsertErr) {
    console.error('[recalculate-month] upsert error:', upsertErr)
  }
}
