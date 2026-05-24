import { createClient } from '@supabase/supabase-js'
import {
  recalculateMonthSummary,
  adjustHoursForSupervisedFieldwork,
  checkMonthEligibility,
  type Session,
  type FieldworkType,
} from './calculations'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function recalculateMonth(userId: string, monthYear: string): Promise<void> {
  const supabase = getSupabase()

  // Fetch sessions for this user + month
  const { data: sessions, error: sessErr } = await supabase
    .from('fieldwork_sessions')
    .select('id, session_date, independent_hours, supervised_hours, total_hours, activity_type, contact_type')
    .eq('user_id', userId)
    .eq('month_year', monthYear)

  if (sessErr) {
    console.error('[recalculate-month] sessions fetch error:', sessErr)
    return
  }

  console.log(`[recalculate-month] user=${userId} month=${monthYear} found ${sessions?.length ?? 0} sessions:`, JSON.stringify(sessions?.map(s => ({ id: s.id, indep: s.independent_hours, sup: s.supervised_hours, total: s.total_hours }))))

  // Fetch fieldwork type from profile
  const { data: profile } = await supabase
    .from('fieldwork_profiles')
    .select('fieldwork_type')
    .eq('user_id', userId)
    .maybeSingle()

  const fieldworkType: FieldworkType = (profile?.fieldwork_type as FieldworkType) || 'supervised'

  // Fetch current MVF status
  const { data: existing } = await supabase
    .from('fieldwork_monthly_summaries')
    .select('mvf_signed, mvf_signed_at')
    .eq('user_id', userId)
    .eq('month_year', monthYear)
    .maybeSingle()

  let summary = recalculateMonthSummary((sessions || []) as Session[])

  if (fieldworkType === 'supervised') {
    summary = adjustHoursForSupervisedFieldwork(summary)
  }

  const { eligible, reason } = checkMonthEligibility(summary, fieldworkType, existing?.mvf_signed ?? false)

  const upsertData = {
    user_id: userId,
    month_year: monthYear,
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

  console.log(`[recalculate-month] upserting summary for month=${monthYear}: total_hours=${upsertData.total_hours} indep=${upsertData.total_independent_hours} sup=${upsertData.total_supervised_hours} eligible=${upsertData.is_eligible}`)

  const { error: upsertErr } = await supabase
    .from('fieldwork_monthly_summaries')
    .upsert(upsertData, { onConflict: 'user_id,month_year' })

  if (upsertErr) {
    console.error('[recalculate-month] upsert error:', upsertErr)
  } else {
    console.log(`[recalculate-month] upsert OK for month=${monthYear}`)
  }
}
