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

// Maps each BACB activityCategory to the real bcba_notes.category strings
// (verified against: SELECT DISTINCT category FROM bcba_notes ORDER BY category)
// Verified against live DB — SELECT DISTINCT category, activity_type FROM bcba_notes
// Restricted buckets: 'behavior change procedures' (40), 'functional assessment' (20)
// Unrestricted buckets: assessment(5), behavior change procedures(86),
//   data analysis & graphing(44), ethics & professional conduct(49),
//   experimental design(4), functional assessment(64), general behavior analysis(37),
//   measurement & data systems(22), staff training & supervision(56), treatment planning(33)
export const ACTIVITY_CATEGORY_TO_NOTE_CATEGORY: Record<string, string[]> = {
  // Unrestricted
  DATA_ANALYSIS:           ['data analysis & graphing', 'measurement & data systems'],
  PROGRAM_MODIFICATION:    ['behavior change procedures', 'treatment planning'],
  CAREGIVER_TRAINING:      ['staff training & supervision'],
  STAFF_TRAINING:          ['staff training & supervision'],
  RESEARCH_CLIENT_RELATED: ['experimental design', 'general behavior analysis'],
  REPORT_WRITING:          ['assessment', 'treatment planning'],
  MEETING_CLIENT_RELATED:  ['treatment planning', 'general behavior analysis'],
  // Restricted — only map to categories that have restricted notes in the DB
  DIRECT_OBSERVATION:      ['functional assessment'],     // 20 restricted notes
  BEHAVIOR_INTERVENTION:   ['behavior change procedures'], // 40 restricted notes
  SKILL_ACQUISITION:       ['behavior change procedures'], // 40 restricted notes
  CRISIS_SUPPORT:          ['behavior change procedures'], // 40 restricted notes
}

// Returns the note categories for a given activityCategory, or [] if no mapping.
export function noteCategories(activityCategory: string): string[] {
  return ACTIVITY_CATEGORY_TO_NOTE_CATEGORY[activityCategory] ?? []
}
