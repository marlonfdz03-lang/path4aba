// Pure guard logic for the Update-Assessment full-refresh, extracted from app/api/extract-assessment so
// it can be UNIT-TESTED — this is what turns the route's "correct by reading" into "proven" (see
// assessmentRefresh.test.mjs). No prisma, no pdf2json, no network: both functions are pure data->data.
//
// The two guards these back:
//   GUARD 1 (validateAssessmentProfile): a partial/empty/failed extraction must NEVER wipe a real
//            clinical profile — the route 422s and writes nothing when this returns any problems.
//   GUARD 2 (buildRefreshedProfile): the refresh preserves non-assessment keys, replaces assessment
//            keys wholesale, and snapshots the pre-refresh profile as `previousProfile` for one-level
//            undo (restored by app/api/clients/[id]/profile/restore).

// Minimal structural shapes — we validate PRESENCE, deliberately not correctness (see the residual note
// in the route + the hardening report: a plausible-but-wrong extraction can still pass these checks; the
// restore route is the mitigation).
type BuiltBehavior = { name?: string; status?: string; functions?: string[]; topographies?: string[] };
type BuiltProfile = {
  maladaptiveBehaviors?: BuiltBehavior[];
  masteredBehaviors?: string[];
  interventions?: unknown[];
  reinforcers?: unknown[];
  [k: string]: unknown;
};

// GUARD 1 — required-field validation. Returns a list of human-readable problems; an empty list means
// the extraction is clinically complete enough to apply. A NON-empty list means the route must respond
// 422 and leave the stored profile byte-for-byte unchanged. Presence-only by design.
export function validateAssessmentProfile(
  assessmentProfile: BuiltProfile,
  extracted: { replacementSkills?: unknown[] },
): string[] {
  const problems: string[] = [];
  const behaviors = assessmentProfile.maladaptiveBehaviors ?? [];
  const mastered = assessmentProfile.masteredBehaviors ?? [];
  // ZERO behaviors means the extraction FAILED → fatal. But a per-behavior gap (an active behavior missing
  // its function and/or topography) is NO LONGER fatal: partial-accept APPLIES the complete behaviors and
  // surfaces the incomplete ones as reviewFlags (source 'behavior-incomplete', emitted by the route via
  // lib/activePrograms), instead of discarding the whole refresh. The incomplete behaviors are also filtered
  // out of note selection (activeBehaviorsForSelection + keepActiveBehaviorNames), so an unusable behavior
  // can never reach the generator. This is why (b) missing-function and (c) missing-topography were removed
  // from the fatal set — see the assessment partial-accept change.
  if (behaviors.length === 0 && mastered.length === 0) {
    problems.push("no target behaviors found");
  }
  if ((assessmentProfile.interventions ?? []).length === 0) problems.push("no interventions found");
  if ((assessmentProfile.reinforcers ?? []).length === 0) problems.push("no reinforcers found");
  // Raw replacementSkills (any status): an all-mastered reassessment is clinically valid, so require
  // only that at least one replacement program EXISTS.
  if (!extracted.replacementSkills?.length) problems.push("no replacement skills / programs found");
  return problems;
}

// GUARD 2 — the refresh merge. PURE (never mutates its inputs). Preserves non-assessment keys
// (observedCatalog / functionsByBehavior, blockedNarrativeTerms, continuityContext, and any future key
// such as functionalAssessment), replaces the assessment-sourced keys wholesale, and snapshots the
// pre-refresh profile as `previousProfile` for one-level undo. The snapshot is a WHOLE-profile copy taken
// AFTER stripping any prior snapshot (so backups never nest/compound) — which is exactly why a future
// `functionalAssessment` grid is included in the undo automatically, never stranded.
export function buildRefreshedProfile(
  existingProfile: Record<string, any> | null | undefined,
  assessmentProfile: Record<string, any>,
): Record<string, any> {
  const existing = existingProfile || {};
  const { previousProfile: _stalePrev, ...existingSansPrev } = existing;
  return {
    ...existingSansPrev, // PRESERVE non-assessment keys
    ...assessmentProfile, // REPLACE assessment-sourced keys wholesale
    previousProfile: existingSansPrev, // one-level undo snapshot (whole profile, sans prior snapshot)
  };
}
