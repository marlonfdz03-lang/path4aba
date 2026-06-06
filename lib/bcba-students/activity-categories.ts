// BACB fieldwork activity classification.
// Source: BACB Experience Standards (2022) and 2025 Task List clarifications.

export const RESTRICTED_CATEGORIES = [
  'DIRECT_OBSERVATION',
  'BEHAVIOR_INTERVENTION',
  'SKILL_ACQUISITION',
  'CRISIS_SUPPORT',
] as const

export const UNRESTRICTED_CATEGORIES = [
  'DATA_ANALYSIS',
  'PROGRAM_MODIFICATION',
  'CAREGIVER_TRAINING',
  'STAFF_TRAINING',
  'RESEARCH_CLIENT_RELATED',
  'REPORT_WRITING',
  'MEETING_CLIENT_RELATED',
] as const

// Activities that are NOT valid fieldwork hours — reject before saving.
export const INVALID_CATEGORIES = [
  'PODCAST',
  'CEU_COURSE',
  'COURSEWORK',
  'CPR_TRAINING',
  'MOCK_CASE',
  'CONFERENCE',
  'STUDYING',
] as const

export type RestrictedCategory = typeof RESTRICTED_CATEGORIES[number]
export type UnrestrictedCategory = typeof UNRESTRICTED_CATEGORIES[number]
export type ActivityCategory = RestrictedCategory | UnrestrictedCategory

export const ALL_VALID_CATEGORIES: string[] = [
  ...RESTRICTED_CATEGORIES,
  ...UNRESTRICTED_CATEGORIES,
]

export const INVALID_CATEGORIES_LIST: string[] = [...INVALID_CATEGORIES]

export const CATEGORY_LABELS: Record<string, string> = {
  // Restricted
  DIRECT_OBSERVATION:     'Direct Client Observation',
  BEHAVIOR_INTERVENTION:  'Behavior Intervention Implementation',
  SKILL_ACQUISITION:      'Skill Acquisition Programming',
  CRISIS_SUPPORT:         'Crisis Support',
  // Unrestricted
  DATA_ANALYSIS:           'Data Analysis & Review',
  PROGRAM_MODIFICATION:    'Program Modification & Development',
  CAREGIVER_TRAINING:      'Caregiver Training',
  STAFF_TRAINING:          'Staff Training',
  RESEARCH_CLIENT_RELATED: 'Client-Related Research',
  REPORT_WRITING:          'Report Writing (client-related)',
  MEETING_CLIENT_RELATED:  'Client-Related Meeting',
}

export const INVALID_CATEGORY_REASONS: Record<string, string> = {
  PODCAST:      'Podcasts are not BACB-eligible fieldwork activities.',
  CEU_COURSE:   'CEU courses count toward continuing education, not fieldwork hours.',
  COURSEWORK:   'Academic coursework does not count as fieldwork.',
  CPR_TRAINING: 'CPR/first aid training is not BACB-eligible fieldwork.',
  MOCK_CASE:    'Mock or hypothetical cases do not count as fieldwork.',
  CONFERENCE:   'Conference attendance is not BACB-eligible fieldwork.',
  STUDYING:     'Independent studying does not count as fieldwork hours.',
}

export function deriveActivityType(category: string): 'restricted' | 'unrestricted' {
  return (RESTRICTED_CATEGORIES as readonly string[]).includes(category)
    ? 'restricted'
    : 'unrestricted'
}

export function isInvalidCategory(category: string): boolean {
  return INVALID_CATEGORIES_LIST.includes(category)
}

export function isValidCategory(category: string): boolean {
  return ALL_VALID_CATEGORIES.includes(category)
}

export function invalidReason(category: string): string {
  return INVALID_CATEGORY_REASONS[category] ?? 'This activity is not eligible for BACB fieldwork hours.'
}
