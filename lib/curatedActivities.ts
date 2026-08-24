// lib/curatedActivities.ts
// THE curated activity reference — a COMMITTED constant (in git), so it can never be lost in a DB
// migration the way the original Supabase list was. It is the clinician-approved baseline that every
// client's homeActivities/schoolActivities always includes (seeded at creation, backfilled for existing
// clients). Assessments are often poorly made and name few or no activities; rather than let note
// generation invent them (hidden fabrication), the activities live here — clinician-approved — and
// note-gen draws only from what the profile provides.
//
// Each item is tagged with the location(s) it is valid for. This tagging is what keeps homeActivities
// and schoolActivities from being identical: home-tagged items seed the home list, school-tagged the
// school list, and an item valid in both seeds both.
//
// Seed content is lifted verbatim from the two master-prompt activity menus (app/prompts/masterPrompt.ts
// "LOCATION-BASED ACTIVITY RULES"), tagged per that prompt's own home/school + BANNED rules. Marlon
// curates and expands this list over time by editing THIS file — a reviewable, version-controlled,
// auditable change, which is appropriate for a clinical reference.
//
// FIREWALL NOTE: activities are the one ENRICHABLE field (context, clinician-approved) — supplementing
// them is allowed. Clinical content (behaviors, functions, interventions, replacements, diagnosis) is
// NEVER enriched this way; only ever extracted faithfully from the assessment.

export type ActivityLocation = 'home' | 'school';

export interface CuratedActivity {
  name: string;
  locations: ActivityLocation[];
}

// Tagged from masterPrompt.ts:183-190 (HOME menu, SCHOOL menu, and the BANNED-in-X rules that separate
// them). Two items appear in both menus (structured table activity, fine motor task) → tagged ['home','school'].
export const CURATED_ACTIVITIES: CuratedActivity[] = [
  // valid in BOTH settings
  { name: 'structured table activity', locations: ['home', 'school'] },
  { name: 'fine motor task', locations: ['home', 'school'] },
  // HOME-only (banned in school per masterPrompt:190)
  { name: 'play-based instruction', locations: ['home'] },
  { name: 'puzzle activity', locations: ['home'] },
  { name: 'coloring activity', locations: ['home'] },
  { name: 'clean-up routine', locations: ['home'] },
  { name: 'meal routine', locations: ['home'] },
  { name: 'hygiene routine', locations: ['home'] },
  { name: 'sensory play activity', locations: ['home'] },
  { name: 'toy play activity', locations: ['home'] },
  { name: 'matching activity', locations: ['home'] },
  { name: 'building blocks activity', locations: ['home'] },
  { name: 'Play-Doh activity', locations: ['home'] },
  // SCHOOL-only (banned in home per masterPrompt:189)
  { name: 'classroom activity', locations: ['school'] },
  { name: 'small group instruction', locations: ['school'] },
  { name: 'group activity', locations: ['school'] },
  { name: 'independent work', locations: ['school'] },
  { name: 'classroom transition', locations: ['school'] },
  { name: 'peer interaction activity', locations: ['school'] },
  { name: 'circle time', locations: ['school'] },
  { name: 'classroom routine', locations: ['school'] },
  { name: 'worksheet activity', locations: ['school'] },
];

export const CURATED_HOME_ACTIVITIES: string[] = CURATED_ACTIVITIES
  .filter((a) => a.locations.includes('home'))
  .map((a) => a.name);

export const CURATED_SCHOOL_ACTIVITIES: string[] = CURATED_ACTIVITIES
  .filter((a) => a.locations.includes('school'))
  .map((a) => a.name);

// ── Activity list builder (curated baseline + assessment split; flat list discarded) ───────────────
// THE single source of truth for a profile's homeActivities/schoolActivities. Lives here (with the pure
// constant, no heavy deps) so every write path AND every creation path can call it without pulling in
// pdf2json/prisma. Marlon's rule:
//   1. The curated list is ALWAYS present — every client, every path, assessment or not.
//   2. Assessment activities are added ONLY when the assessment SPLIT them by setting (home[]/school[]).
//      A FLAT/untagged list is DISCARDED — adding it to both would mix home/school activities (the exact
//      defect we are fixing), so it is better to drop an untagged list than to misplace it.
// Called with no args → curated only (creation without an assessment, or an assessment that split none).
// Assessment's split activities lead so read-time (.slice(0,4)) prioritizes the client's REAL activities;
// the curated baseline is appended. Case-insensitive dedupe; the first occurrence's casing is kept.
export function buildActivityLists(
  split?: { home?: string[]; school?: string[] },
): { homeActivities: string[]; schoolActivities: string[] } {
  return {
    homeActivities: dedupeActivities([...(split?.home ?? []), ...CURATED_HOME_ACTIVITIES]),
    schoolActivities: dedupeActivities([...(split?.school ?? []), ...CURATED_SCHOOL_ACTIVITIES]),
  };
}

function dedupeActivities(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
