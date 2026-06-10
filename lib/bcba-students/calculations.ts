export const BACB_RULES = {
  BCBA: {
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
  },
  BCaBA: {
    concentrated: {
      totalHoursRequired: 1000,
      supervisionPctMin: 10,
      contactsPerMonth: 4,
      minHoursPerMonth: 20,
      maxHoursPerMonth: 130,
      canProrate: false,
    },
    supervised: {
      totalHoursRequired: 1300,
      supervisionPctMin: 5,
      contactsPerMonth: 4,
      minHoursPerMonth: 20,
      maxHoursPerMonth: 130,
      canProrate: true,
    },
  },
  shared: {
    unrestrictedPctMin: 60,
    restrictedPctMax: 40,
    individualSupervisionMin: 50,
    groupSupervisionMax: 50,
    clientObservationsPerMonth: 1,
  },
} as const

export type FieldworkType = 'concentrated' | 'supervised'
export type CertificationTrack = 'BCBA' | 'BCaBA'

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
  mvfSigned: boolean,
  certificationTrack: CertificationTrack = 'BCBA'
): { eligible: boolean; reason?: string } {
  const rules  = BACB_RULES[certificationTrack][fieldworkType]
  const shared = BACB_RULES.shared

  if (summary.total_hours < rules.minHoursPerMonth) {
    return { eligible: false, reason: `Total hours (${summary.total_hours.toFixed(2)}) below minimum ${rules.minHoursPerMonth}` }
  }

  if (summary.supervision_pct < rules.supervisionPctMin) {
    return { eligible: false, reason: `Supervision (${summary.supervision_pct.toFixed(1)}%) below required ${rules.supervisionPctMin}%` }
  }

  const supContacts = summary.individual_contacts + summary.group_contacts
  if (supContacts > 0 && summary.individual_contacts / supContacts < shared.individualSupervisionMin / 100) {
    return {
      eligible: false,
      reason: `Individual supervision (${((summary.individual_contacts / supContacts) * 100).toFixed(0)}%) below required 50%`,
    }
  }

  if (summary.total_hours > 0 && summary.unrestricted_hours / summary.total_hours < shared.unrestrictedPctMin / 100) {
    return {
      eligible: false,
      reason: `Unrestricted hours (${((summary.unrestricted_hours / summary.total_hours) * 100).toFixed(0)}%) below required ${shared.unrestrictedPctMin}%`,
    }
  }

  if (summary.supervisor_contacts < rules.contactsPerMonth) {
    return { eligible: false, reason: `Supervision contacts (${summary.supervisor_contacts}) below required ${rules.contactsPerMonth}` }
  }

  if (summary.client_observations < shared.clientObservationsPerMonth) {
    return { eligible: false, reason: 'No client observation recorded this month' }
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

export function adjustHoursForSupervisedFieldwork(
  summary: MonthSummary,
  certificationTrack: CertificationTrack = 'BCBA'
): MonthSummary {
  const rules = BACB_RULES[certificationTrack].supervised
  let { total_independent_hours, total_supervised_hours, total_hours } = summary

  // Cap total at maxHoursPerMonth by removing independent hours
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
