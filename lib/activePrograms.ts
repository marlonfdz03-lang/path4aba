// A mastered skill or behavior is clinical PROGRESS HISTORY — it is no longer in active programming, so it
// must NOT be offered as selectable for a session note (documenting it records work on a program that no
// longer exists). Active vs mastered is already reconciled into separate profile fields
// (replacementBehaviors/skillAcquisition, maladaptiveBehaviors/masteredBehaviors) with a per-item `status`;
// this module reads that existing status — it does not invent a new flag — and produces the ACTIVE-only
// lists the note form should offer. Mastered items are NOT dropped from the profile; they stay wherever they
// legitimately belong (progress reports, BCBA dashboard, the profile view).

const asArr = (v: any): any[] => (Array.isArray(v) ? v : []);
const nameOf = (x: any): string => (typeof x === 'string' ? x : (x?.name ?? '')).toString().trim();
const norm = (x: any): string => nameOf(x).toLowerCase();
const isMasteredItem = (x: any): boolean =>
  typeof x === 'object' && x != null && String(x.status || '').toLowerCase() === 'mastered';

// Names the profile considers MASTERED behaviors (the separate masteredBehaviors array + any inline
// status:'mastered' entry). Lower-cased for matching.
export function masteredBehaviorNameSet(profile: any): Set<string> {
  const set = new Set<string>();
  for (const n of asArr(profile?.masteredBehaviors)) { const k = norm(n); if (k) set.add(k); }
  for (const b of asArr(profile?.maladaptiveBehaviors)) if (isMasteredItem(b)) { const k = norm(b); if (k) set.add(k); }
  return set;
}

// Names the profile considers MASTERED skills (the skillAcquisition field + any inline status:'mastered').
export function masteredSkillNameSet(profile: any): Set<string> {
  const set = new Set<string>();
  for (const s of asArr(profile?.skillAcquisition)) { const k = norm(s); if (k) set.add(k); }
  for (const s of [...asArr(profile?.replacementBehaviors), ...asArr(profile?.activePrograms?.replacementSkills)]) {
    if (isMasteredItem(s)) { const k = norm(s); if (k) set.add(k); }
  }
  return set;
}

// Filter an arbitrary BEHAVIOR list (objects or names) to the ACTIVE ones for this profile.
export function activeBehaviors<T>(behaviors: T[], profile: any): T[] {
  const mastered = masteredBehaviorNameSet(profile);
  return asArr(behaviors).filter((b) => !isMasteredItem(b) && !mastered.has(norm(b)));
}

// Filter an arbitrary SKILL list (objects or names) to the ACTIVE ones for this profile.
export function activeSkills<T>(skills: T[], profile: any): T[] {
  const mastered = masteredSkillNameSet(profile);
  return asArr(skills).filter((s) => !isMasteredItem(s) && !mastered.has(norm(s)));
}

// Server backstop: keep only the selected NAMES that are active behaviors/skills for this profile. A UI-only
// filter is not a filter — a mastered name that slips through (stale client, tampered payload) is dropped
// here before it can reach generation / preselection.
export function keepActiveBehaviorNames(selected: string[], profile: any): string[] {
  const mastered = masteredBehaviorNameSet(profile);
  const incomplete = incompleteBehaviorNameSet(profile);
  return asArr(selected)
    .map((n) => String(n))
    .filter((n) => {
      const k = n.trim().toLowerCase();
      // Drop mastered (history) AND incomplete (no topography/function → the generator can't write its ABC).
      // Server backstop for the note form's Option-B greying: a UI-only filter is not a filter.
      return k && !mastered.has(k) && !incomplete.has(k);
    });
}
export function keepActiveSkillNames(selected: string[], profile: any): string[] {
  const mastered = masteredSkillNameSet(profile);
  return asArr(selected).map((n) => String(n)).filter((n) => n.trim() && !mastered.has(n.trim().toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR COMPLETENESS — a behavior is DOCUMENTABLE only if the note generator has what it needs to write
// an ABC: at least one topography (operational definition) AND at least one function. The partial-accept
// refresh APPLIES a behavior that is missing either, but it must not be SELECTABLE until a BCBA completes
// it. This is a pure predicate over fields the profile already carries — no stored "incomplete" flag — so
// it can never go stale: fill topography/function and the behavior is complete everywhere at once.
// ─────────────────────────────────────────────────────────────────────────────
export type MissingBehaviorField = 'function' | 'topography';

export function behaviorMissingFields(b: any): MissingBehaviorField[] {
  const topos = Array.isArray(b?.topographies) ? b.topographies : (b?.topography ? [b.topography] : []);
  const funcs = Array.isArray(b?.functions) ? b.functions : (Array.isArray(b?.function) ? b.function : []);
  const missing: MissingBehaviorField[] = [];
  if (!topos.filter(Boolean).length) missing.push('topography');
  if (!funcs.filter(Boolean).length) missing.push('function');
  return missing;
}

export function behaviorIsComplete(b: any): boolean {
  return behaviorMissingFields(b).length === 0;
}

// Plain-language reason for the note form (Option B greyed row) and elsewhere.
export function incompleteBehaviorReason(missing: MissingBehaviorField[]): string {
  const parts = missing.map((m) => (m === 'topography' ? 'an operational definition' : 'a documented function'));
  return `Needs ${parts.join(' and ')} before it can be documented — ask your BCBA.`;
}

// Lower-cased names of the ACTIVE behaviors that are incomplete for this profile (the server-backstop set).
export function incompleteBehaviorNameSet(profile: any): Set<string> {
  const set = new Set<string>();
  for (const b of activeBehaviors(asArr(profile?.maladaptiveBehaviors), profile)) {
    if (!behaviorIsComplete(b)) { const k = norm(b); if (k) set.add(k); }
  }
  return set;
}

// For the note form: every ACTIVE behavior with whether it can be documented. Incomplete ones are shown
// (Option B) but not selectable; `missing`/`reason` name what a BCBA must supply.
export function activeBehaviorsForSelection(
  profile: any,
): { name: string; incomplete: boolean; missing: MissingBehaviorField[]; reason: string | null }[] {
  return activeBehaviors(asArr(profile?.maladaptiveBehaviors), profile)
    .map((b) => {
      const missing = behaviorMissingFields(b);
      return {
        name: nameOf(b),
        incomplete: missing.length > 0,
        missing,
        reason: missing.length ? incompleteBehaviorReason(missing) : null,
      };
    })
    .filter((x) => x.name);
}
