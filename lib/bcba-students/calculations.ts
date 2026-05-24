export const BACB_RULES = {
  concentrated: {
    totalHoursRequired: 1500,
    supervisionPctMin: 10,
    contactsPerMonth: 6,
    minHoursPerMonth: 20,
    maxHoursPerMonth: 130,
    canProrate: false,
  },
  supervised: {
    totalHoursRequired: 2000,
    supervisionPctMin: 5,
    contactsPerMonth: 4,
    minHoursPerMonth: 20,
    maxHoursPerMonth: 130,
    canProrate: true,
  },
  unrestrictedPctMin: 60,
  individualSupervisionMin: 50,
  groupSupervisionMax: 50,
  clientObservationsPerMonth: 1,
} as const

export type FieldworkType = 'concentrated' | 'supervised'

export interface Session {
  id: string
  session_date: string
  independent_hours: number
  supervised_hours: number
  total_hours: number
  activity_type: 'unrestricted' | 'restricted'
  contact_type: 'none' | 'individual_supervision' | 'group_supervision' | 'client_observation'
}

export interface MonthSummary {
  total_independent_hours: number
  total_supervised_hours: number
  total_hours: number
  supervision_pct: number
  unrestricted_hours: number
  restricted_hours: number
  supervisor_contacts: number
  individual_contacts: number
  group_contacts: number
  client_observations: number
  is_eligible: boolean
  ineligibility_reason: string | null
}

export function calcSupervisionPct(supervised: number, total: number): number {
  if (total === 0) return 0
  return (supervised / total) * 100
}

export function checkMonthEligibility(
  summary: MonthSummary,
  fieldworkType: FieldworkType,
  mvfSigned: boolean
): { eligible: boolean; reason?: string } {
  const rules = BACB_RULES[fieldworkType]

  if (summary.client_observations < BACB_RULES.clientObservationsPerMonth) {
    return { eligible: false, reason: 'No client observation recorded this month' }
  }
  if (summary.total_hours < rules.minHoursPerMonth) {
    return { eligible: false, reason: `Total hours (${summary.total_hours.toFixed(2)}) below minimum ${rules.minHoursPerMonth}` }
  }
  if (!mvfSigned) {
    return { eligible: false, reason: 'M-FVF not signed' }
  }
  return { eligible: true }
}

export function prorateHours(
  total: number,
  contactsMet: number,
  contactsRequired: number
): number {
  if (contactsRequired === 0) return total
  return total * (contactsMet / contactsRequired)
}

export function estimatedCompletion(
  hoursLogged: number,
  totalRequired: number,
  monthsActive: number
): Date | null {
  if (monthsActive === 0 || hoursLogged === 0) return null
  const avgPerMonth = hoursLogged / monthsActive
  const remaining = totalRequired - hoursLogged
  if (remaining <= 0) return new Date()
  const monthsLeft = remaining / avgPerMonth
  const result = new Date()
  result.setMonth(result.getMonth() + Math.ceil(monthsLeft))
  return result
}

export function recalculateMonthSummary(sessions: Session[]): MonthSummary {
  let totalIndependent = 0
  let totalSupervised = 0
  let unrestricted = 0
  let restricted = 0
  let individual = 0
  let group = 0
  let clientObs = 0

  for (const s of sessions) {
    totalIndependent += s.independent_hours
    totalSupervised += s.supervised_hours
    if (s.activity_type === 'unrestricted') unrestricted += s.total_hours
    else restricted += s.total_hours
    if (s.contact_type === 'individual_supervision') individual++
    if (s.contact_type === 'group_supervision') group++
    if (s.contact_type === 'client_observation') clientObs++
  }

  const total = totalIndependent + totalSupervised
  const supervisionPct = calcSupervisionPct(totalSupervised, total)
  const supervisorContacts = individual + group + clientObs

  return {
    total_independent_hours: totalIndependent,
    total_supervised_hours: totalSupervised,
    total_hours: total,
    supervision_pct: supervisionPct,
    unrestricted_hours: unrestricted,
    restricted_hours: restricted,
    supervisor_contacts: supervisorContacts,
    individual_contacts: individual,
    group_contacts: group,
    client_observations: clientObs,
    is_eligible: false,
    ineligibility_reason: null,
  }
}

export function adjustHoursForSupervisedFieldwork(summary: MonthSummary): MonthSummary {
  const rules = BACB_RULES.supervised
  let { total_independent_hours, total_supervised_hours, total_hours } = summary

  // Cap total at 130 by removing independent hours
  if (total_hours > rules.maxHoursPerMonth) {
    const excess = total_hours - rules.maxHoursPerMonth
    total_independent_hours = Math.max(0, total_independent_hours - excess)
    total_hours = total_supervised_hours + total_independent_hours
  }

  // Reduce group supervision if it exceeds individual supervision
  let { individual_contacts, group_contacts } = summary
  if (group_contacts > individual_contacts) {
    group_contacts = individual_contacts
  }

  const supervisionPct = calcSupervisionPct(total_supervised_hours, total_hours)

  return {
    ...summary,
    total_independent_hours,
    total_hours,
    supervision_pct: supervisionPct,
    individual_contacts,
    group_contacts,
  }
}
