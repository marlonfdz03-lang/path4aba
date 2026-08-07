// lib/clinicalFilters.ts
// Migrated from generateDailyNote.ts — clinical vocabulary filters and normalizers
// Used by generateSmartNote.ts to pre-process session input before sending to GPT

export const PROHIBITED_INTERVENTIONS = [
  'response blocking',
  'response block',
  'punishment',
  'restraint',
  'physical restraint',
  'response cost',
  'overcorrection',
  'aversive',
  'escape extinction',
  'standalone extinction',
  'time out',
  'timeout',
];

export const PROHIBITED_SCOPE_TERMS = [
  'speech therapy',
  'speech/language therapy',
  'speech-language therapy',
  'occupational therapy',
  'ot',
  'physical therapy',
  'pt',
  'counseling',
  'tutoring',
  'homework',
  'academic tutoring',
  'feeding therapy',
  'speech services',
  'educational tutoring',
  'teacher assistant',
  'academic support',
];

export const INVALID_ACTIVITIES = [
  'summer program',
  'learning/academics',
  'speech/language therapy',
  'speech therapy',
  'occupational therapy',
  'homework',
  'increasing attention and time on task',
  'engaging appropriately with peers and teachers',
  'attending kindergarten and upcoming first grade',
];

export const HOME_ONLY_PROGRAMS = [
  'daily living',
  'toothbrushing',
  'meal routine',
  'hygiene',
  'chores',
  'shower',
  'bedtime',
  'couch',
  // Play-Doh is a home-context activity — filtered from SCHOOL notes so it can't leak in when the flat
  // assessment activity list is shared to both lists. (Deliberately NOT adding 'toy play'/'sensory play':
  // those can legitimately occur in classrooms — Marlon's clinical call.)
  'play-doh',
  'playdoh',
];

export const INVALID_LANGUAGE_PATTERNS = [
  'following during',
  'following after',
  'after during',
  'during participating',
  'while engaged in treatment activities, during',
  'by occurs',
  'by engages',
  'by turns',
  'during increasing attention',
  'during following',
  'following waiting',
];

export function containsAny(text: string, blocked: string[]): boolean {
  const lower = text.toLowerCase();
  return blocked.some(term => lower.includes(term));
}

export function isAllowedIntervention(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase().trim();
  if (containsAny(lower, PROHIBITED_INTERVENTIONS)) return false;
  if (containsAny(lower, PROHIBITED_SCOPE_TERMS)) return false;
  if (lower.includes('escape independent response delivery')) return false;
  if (lower.includes('attention independent response delivery')) return false;
  return true;
}

export function normalizeInterventionName(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('planned ignore')) return 'Planned Ignoring';
  if (lower.includes('activity schedule')) return 'Visual Activity Schedule';
  if (lower.includes('response block')) return '';
  if (lower.includes('escape independent response delivery')) return '';
  if (lower.includes('attention independent response delivery')) return '';
  return text;
}

export function cleanBehaviorLabel(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('rude')) return 'inappropriate social interaction';
  if (lower.includes('noncompliance') || lower.includes('non-compliance')) return 'refusal to follow directions';
  if (lower.includes('defiant')) return 'turning away from instructions';
  return text;
}

export function isValidActivity(activity: string, location: string): boolean {
  if (containsAny(activity, INVALID_ACTIVITIES)) return false;
  if (containsAny(activity, PROHIBITED_SCOPE_TERMS)) return false;
  if (location === 'school' && containsAny(activity.toLowerCase(), HOME_ONLY_PROGRAMS)) return false;
  return true;
}

export function isValidSkillForLocation(skillName: string, location: string): boolean {
  if (location !== 'school') return true;
  return !containsAny(skillName.toLowerCase(), HOME_ONLY_PROGRAMS);
}

export function filterApprovedInterventions(interventions: string[]): string[] {
  return interventions
    .map(normalizeInterventionName)
    .filter(Boolean)
    .filter(isAllowedIntervention);
}
